#!/usr/bin/env tsx
/**
 * Round-trip verification for /api/web/cowork/handoff-to-pages.
 *
 * Compares cowork's three artifacts (page_outlines / page_drafts /
 * page_critiques in roadmap_state) against the resulting web_pages +
 * web_sections rows, slug by slug. Exits non-zero if anything that
 * cowork carried got dropped at the handoff.
 *
 * This is the no-information-loss guarantee. The handoff endpoint
 * does its own round-trip check + refuses 422 when sections_written
 * != sections_in_draft, but this script verifies the full preservation
 * AFTER the writes have landed — catching schema or column drift the
 * endpoint can't see from inside its own transaction.
 *
 * Run against any project that has cowork artifacts + a handoff
 * timestamp:
 *
 *   npx tsx scripts/check-pages-handoff.ts <project_id>
 *
 * Default project_id (when called without an arg): Arvada Vineyard
 * (the audit-branch seed). Use a from-scratch project's id to verify
 * branch-agnostic behavior.
 *
 * Exit codes:
 *   0   — every atom_id / fact_id / topic_key / split-group / deferred
 *         item survived the handoff intact
 *   1   — any round-trip loss
 *   2   — script setup error (project not found, no artifacts, missing
 *         env)
 */

import { createClient } from '@supabase/supabase-js'
// @ts-ignore — dotenv not in devDependencies; installed at runtime
import 'dotenv/config'

interface CheckRow {
  slug:        string
  problem:     string
}

async function main(): Promise<void> {
  const projectId = process.argv[2] ?? '2eac7eb8-269d-4584-84a4-3dc9fdd6fcde' // Arvada Vineyard
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    console.error('Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env')
    process.exit(2)
  }
  const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  // 1. Load cowork artifacts from roadmap_state.
  const { data: proj, error: projErr } = await sb
    .from('strategy_web_projects')
    .select('id, name, roadmap_state, notion_database_id')
    .eq('id', projectId)
    .maybeSingle()
  if (projErr || !proj) {
    console.error(`project ${projectId} load failed: ${projErr?.message ?? 'not found'}`)
    process.exit(2)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const roadmap = (proj as any).roadmap_state ?? {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const outlines:  Record<string, any> = roadmap.page_outlines  ?? {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const drafts:    Record<string, any> = roadmap.page_drafts    ?? {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const critiques: Record<string, any> = roadmap.page_critiques ?? {}

  const slugs = new Set<string>([
    ...Object.keys(outlines),
    ...Object.keys(drafts),
    ...Object.keys(critiques),
  ])
  if (slugs.size === 0) {
    console.error(`project ${projectId} has no page_outlines / page_drafts / page_critiques in roadmap_state. Run the cowork pipeline first.`)
    process.exit(2)
  }

  // 2. Load the resulting web_pages + web_sections.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pages } = await sb
    .from('web_pages')
    .select('id, slug, audit_source, notion_url, cowork_handoff_at, cowork_handoff_meta')
    .eq('web_project_id', projectId)
    .eq('archived', false) as { data: any[] | null }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: sections } = await sb
    .from('web_sections')
    .select('id, web_page_id, content_template_id, cowork_section_meta, split_group_id, split_position, cowork_slot_values, field_values, sort_order')
    .in('web_page_id', (pages ?? []).map(p => p.id)) as { data: any[] | null }

  const pagesBySlug = new Map((pages ?? []).map(p => [p.slug, p]))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sectionsByPage = new Map<string, any[]>()
  for (const s of sections ?? []) {
    const arr = sectionsByPage.get(s.web_page_id) ?? []
    arr.push(s)
    sectionsByPage.set(s.web_page_id, arr)
  }

  // 3. Per-slug verification.
  const problems: CheckRow[] = []
  let total_atoms_in_drafts   = 0
  let total_facts_in_drafts   = 0
  let total_topics_in_drafts  = 0
  let total_atoms_preserved   = 0
  let total_facts_preserved   = 0
  let total_topics_preserved  = 0
  let total_deferred_in_drafts = 0
  let total_deferred_preserved = 0

  for (const slug of slugs) {
    const draft    = drafts[slug]
    const outline  = outlines[slug]
    const critique = critiques[slug]
    const page     = pagesBySlug.get(slug)
    const draftSections = Array.isArray(draft?.sections) ? draft.sections : []

    if (!page) {
      // A slug with only a critique (audit-branch placeholder for a missing
      // Notion page) should still produce a web_pages row.
      problems.push({ slug, problem: 'no matching web_pages row' })
      continue
    }
    if (!page.cowork_handoff_at) {
      problems.push({ slug, problem: 'cowork_handoff_at NULL — handoff endpoint never wrote this page' })
      continue
    }
    if (!page.cowork_handoff_meta) {
      problems.push({ slug, problem: 'cowork_handoff_meta NULL — page-level provenance lost' })
    }
    // audit_source: outline._meta wins, critique._meta fallback.
    const expectedAuditSource =
      (outline?._meta?.audit_source as string | undefined) ??
      (critique?._meta?.audit_source as string | undefined) ??
      (proj.notion_database_id ? 'notion' : 'generated')
    if (page.audit_source !== expectedAuditSource) {
      problems.push({ slug, problem: `audit_source = ${page.audit_source ?? 'NULL'}, expected ${expectedAuditSource}` })
    }

    const pageSections = sectionsByPage.get(page.id) ?? []
    if (draftSections.length > 0 && pageSections.length !== draftSections.length) {
      problems.push({ slug, problem: `section count mismatch: ${pageSections.length} written, ${draftSections.length} in draft` })
    }

    // Aggregate atoms / facts / topics across both sides for this slug.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const draftAtoms  = new Set<string>(draftSections.flatMap((s: any) => Array.isArray(s.atoms_used)        ? s.atoms_used.filter((x: unknown) => typeof x === 'string')        : []))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const draftFacts  = new Set<string>(draftSections.flatMap((s: any) => Array.isArray(s.facts_used)        ? s.facts_used.filter((x: unknown) => typeof x === 'string')        : []))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const draftTopics = new Set<string>(draftSections.flatMap((s: any) => Array.isArray(s.crawl_topics_used) ? s.crawl_topics_used.filter((x: unknown) => typeof x === 'string') : []))
    const draftDeferred = draftSections.reduce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (n: number, s: any) => n + (Array.isArray(s.deferred_atoms) ? s.deferred_atoms.length
                                : Array.isArray(s.deferred_items) ? s.deferred_items.length : 0),
      0,
    )

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writtenAtoms  = new Set<string>(pageSections.flatMap((s: any) => Array.isArray(s.cowork_section_meta?.atom_ids_used)        ? s.cowork_section_meta.atom_ids_used        : []))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writtenFacts  = new Set<string>(pageSections.flatMap((s: any) => Array.isArray(s.cowork_section_meta?.fact_ids_used)        ? s.cowork_section_meta.fact_ids_used        : []))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writtenTopics = new Set<string>(pageSections.flatMap((s: any) => Array.isArray(s.cowork_section_meta?.crawl_topic_keys_used) ? s.cowork_section_meta.crawl_topic_keys_used : []))
    const writtenDeferred = pageSections.reduce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (n: number, s: any) => n + (Array.isArray(s.cowork_section_meta?.deferred_items) ? s.cowork_section_meta.deferred_items.length : 0),
      0,
    )

    total_atoms_in_drafts  += draftAtoms.size
    total_facts_in_drafts  += draftFacts.size
    total_topics_in_drafts += draftTopics.size
    total_atoms_preserved  += writtenAtoms.size
    total_facts_preserved  += writtenFacts.size
    total_topics_preserved += writtenTopics.size
    total_deferred_in_drafts += draftDeferred
    total_deferred_preserved += writtenDeferred

    for (const id of draftAtoms)  if (!writtenAtoms.has(id))  problems.push({ slug, problem: `atom ${id.slice(0, 8)} cited in draft but absent in section meta` })
    for (const id of draftFacts)  if (!writtenFacts.has(id))  problems.push({ slug, problem: `fact ${id.slice(0, 8)} cited in draft but absent in section meta` })
    for (const k  of draftTopics) if (!writtenTopics.has(k))  problems.push({ slug, problem: `crawl topic ${k} cited in draft but absent in section meta` })
    if (writtenDeferred !== draftDeferred) problems.push({ slug, problem: `deferred-item count drift: written ${writtenDeferred}, draft ${draftDeferred}` })

    // SPLIT groups: every section with split_position should share a
    // split_group_id with its siblings (same original split_from).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const splitPositions = pageSections.filter((s: any) => s.split_position != null)
    if (splitPositions.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const byGroup = new Map<string, any[]>()
      for (const s of splitPositions) {
        const arr = byGroup.get(s.split_group_id ?? '') ?? []
        arr.push(s)
        byGroup.set(s.split_group_id ?? '', arr)
      }
      for (const [gid, arr] of byGroup) {
        if (!gid) {
          problems.push({ slug, problem: 'split_position set but split_group_id NULL on at least one section' })
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const positions = arr.map((s: any) => s.split_position).sort()
        for (let i = 0; i < positions.length; i++) {
          if (positions[i] !== i + 1) {
            problems.push({ slug, problem: `split_group ${gid?.slice(0, 8)}: positions not 1..N (got ${positions.join(',')})` })
            break
          }
        }
      }
    }
  }

  // 4. Report.
  console.log('────────────────────────────────────────────────────────────')
  console.log(`project_id: ${projectId}`)
  console.log(`project name: ${proj.name}`)
  console.log(`audit branch: ${proj.notion_database_id ? 'YES' : 'no'}`)
  console.log(`slugs audited: ${slugs.size}`)
  console.log('────────────────────────────────────────────────────────────')
  console.log(`atoms:        draft ${total_atoms_in_drafts}  →  preserved ${total_atoms_preserved}`)
  console.log(`facts:        draft ${total_facts_in_drafts}  →  preserved ${total_facts_preserved}`)
  console.log(`crawl topics: draft ${total_topics_in_drafts}  →  preserved ${total_topics_preserved}`)
  console.log(`deferred:     draft ${total_deferred_in_drafts}  →  preserved ${total_deferred_preserved}`)
  console.log('────────────────────────────────────────────────────────────')

  if (problems.length === 0) {
    console.log('✓ ZERO information loss across the handoff. Every atom/fact/crawl topic cited in a cowork draft survived into web_sections.cowork_section_meta.')
    process.exit(0)
  }

  console.error(`✗ ${problems.length} problem${problems.length === 1 ? '' : 's'} detected:`)
  for (const p of problems) console.error(`  · ${p.slug}: ${p.problem}`)
  process.exit(1)
}

main().catch(e => {
  console.error('fatal:', e)
  process.exit(2)
})
