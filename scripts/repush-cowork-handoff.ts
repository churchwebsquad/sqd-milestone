#!/usr/bin/env tsx
/**
 * CLI re-push: applies cowork's roadmap_state.page_drafts to live
 * web_pages + web_sections, using the SAME logic as the
 * /api/web/cowork/handoff-to-pages endpoint but bypassing the JWT
 * auth requirement via service-role.
 *
 * Use when:
 *   - The cowork audit re-ran and section counts changed
 *     (rederive-cowork-sections.ts only updates existing rows; it
 *     can't add new sections or remove old ones).
 *   - You want to verify a re-push before exposing the trigger to
 *     the strategist via the workspace UI.
 *
 * Behavior per slug:
 *   1. UPSERT web_pages row (insert if new, update meta otherwise).
 *   2. DELETE all existing web_sections for that page.
 *   3. INSERT fresh sections from page_drafts via the current
 *      composeFieldValuesForBrixies translator.
 *
 * Safety:
 *   - Refuses if any page is in partner_review / partner_approved
 *     (pass --force to override).
 *   - Stops on first error per slug (does NOT continue with a
 *     half-applied state).
 *
 * Run:  npx tsx scripts/repush-cowork-handoff.ts <project_id> [--force]
 */
/* eslint-disable no-console, @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import {
  composeFieldValuesForBrixies,
  type ManifestEntry,
} from '../src/lib/cowork/coworkToBrixies.js'

for (const envPath of ['.env.local', '.env']) {
  if (!existsSync(envPath)) continue
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const k = line.slice(0, eq).trim()
    const v = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (process.env[k] == null) process.env[k] = v
  }
}

function humanizeSlug(slug: string): string {
  if (slug === '/' || slug === 'home' || slug === '') return 'Home'
  return slug.split(/[-_/]+/).filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

async function main() {
  const args = process.argv.slice(2)
  const projectId = args.find(a => !a.startsWith('--')) ?? '2eac7eb8-269d-4584-84a4-3dc9fdd6fcde'
  const force = args.includes('--force')

  const url = process.env.VITE_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const sb = createClient(url, key, { auth: { persistSession: false } })

  // Load everything in parallel
  const [projRes, manRes, existingPagesRes] = await Promise.all([
    sb.from('strategy_web_projects')
      .select('id, name, member, roadmap_state, notion_database_id, notion_database_url')
      .eq('id', projectId).maybeSingle(),
    sb.schema('strategy').from('cowork_templates')
      .select('version, manifest')
      .order('updated_at', { ascending: false })
      .limit(1).maybeSingle(),
    sb.from('web_pages')
      .select('id, slug, sort_order, phase, content_status, cowork_handoff_at')
      .eq('web_project_id', projectId)
      .eq('archived', false),
  ])

  if (!projRes.data) { console.error(`project ${projectId} not found`); process.exit(2) }
  if (!manRes.data)  { console.error('manifest missing'); process.exit(2) }
  if (existingPagesRes.error) { console.error(`web_pages load failed: ${existingPagesRes.error.message}`); process.exit(2) }

  const project   = projRes.data as any
  const manifest  = (manRes.data as any).manifest as { page_section_templates: Record<string, ManifestEntry> }
  const templates = manifest.page_section_templates ?? {}
  const manifestVersion = (manRes.data as any).version as string

  const roadmap   = (project.roadmap_state ?? {}) as Record<string, any>
  const outlines  = (roadmap.page_outlines  ?? {}) as Record<string, any>
  const drafts    = (roadmap.page_drafts    ?? {}) as Record<string, any>
  const critiques = (roadmap.page_critiques ?? {}) as Record<string, any>

  const allSlugs = new Set<string>([
    ...Object.keys(outlines),
    ...Object.keys(drafts),
    ...Object.keys(critiques),
  ])

  if (allSlugs.size === 0) {
    console.error('no cowork artifacts in roadmap_state')
    process.exit(2)
  }

  const existingPages = (existingPagesRes.data ?? []) as Array<{
    id: string; slug: string; sort_order: number; phase: string; content_status: string; cowork_handoff_at: string | null
  }>
  const partnerLockedSlugs = existingPages
    .filter(p => (p.content_status === 'partner_review' || p.content_status === 'partner_approved') && allSlugs.has(p.slug))
    .map(p => p.slug)
  if (partnerLockedSlugs.length > 0 && !force) {
    console.error(`Refusing — ${partnerLockedSlugs.length} page(s) in partner_review/approved: ${partnerLockedSlugs.join(', ')}`)
    console.error(`Pass --force to override.`)
    process.exit(1)
  }

  const existingBySlug = new Map(existingPages.map(p => [p.slug, p]))
  let nextSortOrder = existingPages.length
    ? Math.max(...existingPages.map(p => p.sort_order ?? 0)) + 1
    : 0

  const projectAuditBranch = !!project.notion_database_id
  const handoffStartedAt = new Date().toISOString()

  console.log(`\nRe-pushing cowork handoff for ${project.name}`)
  console.log(`  project          ${projectId}`)
  console.log(`  manifest version ${manifestVersion}`)
  console.log(`  slugs            ${allSlugs.size}`)
  console.log()

  let totalSections = 0, totalPerfect = 0, totalPartial = 0, totalSkipped = 0

  for (const slug of Array.from(allSlugs).sort((a, b) => a.localeCompare(b))) {
    const draft    = drafts[slug]   ?? null
    const outline  = outlines[slug] ?? null
    const critique = critiques[slug] ?? null
    const existing = existingBySlug.get(slug) ?? null
    const draftSections = Array.isArray(draft?.sections) ? draft.sections as Array<Record<string, any>> : []

    if (draftSections.length === 0) {
      console.log(`  ${slug.padEnd(20)} 0 sections in draft — skipping`)
      totalSkipped++
      continue
    }

    const auditSourceForPage =
      (outline?._meta?.audit_source as string | undefined) ??
      (critique?._meta?.audit_source as string | undefined) ??
      (projectAuditBranch ? 'notion' : 'generated')
    const notionUrlForPage =
      (outline?._meta?.notion_url as string | undefined) ?? null

    // 1. Upsert web_pages row
    let pageId: string
    if (existing) {
      const { error } = await sb.from('web_pages')
        .update({
          cowork_handoff_meta: {
            branch:        projectAuditBranch ? 'audit' : 'from-scratch',
            outline_meta:  outline?._meta ?? {},
            critique_meta: critique?._meta ?? {},
            overall_band:  critique?.overall_band ?? null,
            directives:    critique?.directives ?? [],
          },
          audit_source:      auditSourceForPage,
          notion_url:        notionUrlForPage,
          cowork_handoff_at: handoffStartedAt,
          updated_at:        handoffStartedAt,
        }).eq('id', existing.id)
      if (error) { console.error(`✗ ${slug}: update failed: ${error.message}`); process.exit(1) }
      pageId = existing.id
    } else {
      const { data: ins, error } = await sb.from('web_pages')
        .insert({
          name:                humanizeSlug(slug),
          slug,
          phase:               '1',
          cowork_handoff_meta: {
            branch:        projectAuditBranch ? 'audit' : 'from-scratch',
            outline_meta:  outline?._meta ?? {},
            critique_meta: critique?._meta ?? {},
            overall_band:  critique?.overall_band ?? null,
            directives:    critique?.directives ?? [],
          },
          audit_source:        auditSourceForPage,
          notion_url:          notionUrlForPage,
          cowork_handoff_at:   handoffStartedAt,
          web_project_id:      projectId,
          sort_order:          nextSortOrder++,
          archived:            false,
          content_status:      'draft',
        }).select('id').single()
      if (error || !ins) { console.error(`✗ ${slug}: insert failed: ${error?.message}`); process.exit(1) }
      pageId = ins.id
    }

    // 2. Clean slate web_sections for this page
    const { error: delErr } = await sb.from('web_sections')
      .delete().eq('web_page_id', pageId)
    if (delErr) { console.error(`✗ ${slug}: delete failed: ${delErr.message}`); process.exit(1) }

    // 3. Insert fresh sections via the current translator
    const outlineSections = Array.isArray(outline?.sections) ? outline.sections as Array<Record<string, any>> : []
    const critiqueSections = Array.isArray(critique?.sections) ? critique.sections as Array<Record<string, any>> : []
    const splitGroupIds = new Map<string, string>()
    const rows: any[] = []
    let perfect = 0, partial = 0

    for (let i = 0; i < draftSections.length; i++) {
      const ds = draftSections[i]
      const intentId = ds.section_intent_id ?? `s${i + 1}`
      const os = outlineSections.find(o => o.section_intent_id === intentId) ?? outlineSections[i] ?? null
      const cs = critiqueSections.find(c => c.section_intent_id === intentId) ?? critiqueSections[i] ?? null
      const templateKey = ds.template_key ?? os?.template_key
      if (!templateKey) continue
      const entry = templates[templateKey]
      if (!entry) {
        console.error(`✗ ${slug}/${intentId}: template_key '${templateKey}' not in manifest`)
        continue
      }

      const bind = composeFieldValuesForBrixies(ds.slot_values ?? {}, entry)
      if (bind.bind_quality === 'perfect') perfect++; else partial++

      const splitFrom = (os?._meta?.split_from as string | undefined) ?? (ds._meta?.split_from as string | undefined) ?? null
      const splitPos  = (os?._meta?.split_position as number | undefined) ?? (ds._meta?.split_position as number | undefined) ?? null
      const notionPgId = (os?._meta?.notion_page_id as string | undefined) ?? null
      const notionUrl  = (os?._meta?.notion_url as string | undefined) ?? notionUrlForPage
      let splitGroupId: string | null = null
      if (splitFrom) {
        const k = `${notionPgId ?? slug}::${splitFrom}`
        if (!splitGroupIds.has(k)) splitGroupIds.set(k, randomUUID())
        splitGroupId = splitGroupIds.get(k)!
      }

      const atomIds = Array.isArray(ds.atoms_used) ? ds.atoms_used.filter((s: any) => typeof s === 'string') : []
      const factIds = Array.isArray(ds.facts_used) ? ds.facts_used.filter((s: any) => typeof s === 'string') : []
      const topicKs = Array.isArray(ds.crawl_topics_used) ? ds.crawl_topics_used.filter((s: any) => typeof s === 'string') : []
      const deferred = Array.isArray(ds.deferred_atoms) ? ds.deferred_atoms : Array.isArray(ds.deferred_items) ? ds.deferred_items : []
      const voiceAnchorIds: string[] = (() => {
        const va = os?.voice_anchor_atom_ids ?? os?.voice_anchor
        if (Array.isArray(va)) return va.filter((x: any) => typeof x === 'string')
        if (typeof va === 'string') return [va]
        return []
      })()

      rows.push({
        web_page_id:         pageId,
        content_template_id: entry.template_id,
        field_values:        bind.field_values,
        cowork_slot_values:  ds.slot_values ?? {},
        source_field_values: ds.slot_values ?? {},
        cowork_section_meta: {
          section_intent_id:      intentId,
          section_intent_text:    os?.section_job ?? '',
          voice_anchor_atom_ids:  voiceAnchorIds,
          intended_verbatim_band: os?.intended_verbatim_band ?? null,
          actual_verbatim_ratio:  typeof ds.actual_verbatim_ratio === 'number' ? ds.actual_verbatim_ratio : null,
          atom_ids_used:          atomIds,
          fact_ids_used:          factIds,
          crawl_topic_keys_used:  topicKs,
          deferred_items:         deferred,
          voice_notes:            ds.voice_notes ?? null,
          axes:                   cs?.axes ?? null,
          directives:             cs?.directives ?? [],
          notion_page_id:         notionPgId,
          notion_url:             notionUrl,
          split_from:             splitFrom,
          bind_quality:           bind.bind_quality,
          gaps:                   bind.gaps,
          manifest_version:       manifestVersion,
        },
        sort_order:          i,
        content_status:      'draft',
        notes:               (ds.voice_notes ?? null) as string | null,
        split_group_id:      splitGroupId,
        split_position:      splitPos,
      })
    }

    if (rows.length > 0) {
      const { error: insErr } = await sb.from('web_sections').insert(rows)
      if (insErr) { console.error(`✗ ${slug}: section insert failed: ${insErr.message}`); process.exit(1) }
    }

    totalSections += rows.length
    totalPerfect  += perfect
    totalPartial  += partial
    console.log(`  ${slug.padEnd(20)} ${String(rows.length).padStart(2)} sections  ${perfect} perfect  ${partial} partial`)
  }

  console.log()
  console.log(`Result:`)
  console.log(`  sections inserted ${totalSections}`)
  console.log(`  perfect           ${totalPerfect}`)
  console.log(`  partial           ${totalPartial}`)
  console.log(`  perfect_rate      ${totalSections > 0 ? ((totalPerfect / totalSections) * 100).toFixed(1) + '%' : 'n/a'}`)
  console.log(`  slugs skipped     ${totalSkipped} (empty drafts)`)
  process.exit(0)
}
main().catch(err => { console.error('crashed:', err); process.exit(2) })
