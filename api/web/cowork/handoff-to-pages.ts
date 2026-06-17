/**
 * Vercel Serverless Function — /api/web/cowork/handoff-to-pages
 *
 * Purpose-built bridge from the cowork pipeline's final outputs
 * (roadmap_state.page_outlines / page_drafts / page_critiques) into
 * the strategist's Pages workspace (web_pages + web_sections), with
 * EVERY piece of cowork provenance preserved. Replaces the legacy
 * page-bind path for cowork-produced pages.
 *
 * Why purpose-built (not extending page-bind):
 *   - page-bind was designed for a one-page-at-a-time copywriter
 *     bundle. It reads .archetype + .copy + .voice_notes from the
 *     draft and throws away atoms_used, facts_used, crawl_topics_used,
 *     deferred_items, voice_anchor, intended_/actual_verbatim, _meta,
 *     section_intent_id, audit_source, notion_page_id/url, and the
 *     5-axis critique scores. The audit branch produces all of that
 *     in one pass — losing it at bind time defeats the pipeline.
 *   - This endpoint speaks cowork's native shape end-to-end. The
 *     canonical-templates manifest's uniform_to_brixies map IS the
 *     shared dictionary; the endpoint reads it deterministically.
 *     No translation guesswork.
 *
 * Both branches (audit + from-scratch) produce the same artifact
 * triplet shapes; this endpoint handles both. The audit-branch
 * SPLIT marker (_meta.split_from + _meta.split_position) is the
 * one branch-specific contract.
 *
 *   POST { project_id, force? }
 *   → 200 { ok, telemetry, audit }    on success
 *   → 422 { error, losses }            on round-trip failure
 *   → 409 { error, partner_locked_slugs } when re-running over
 *     partner_review / partner_approved pages without force=true
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { setRoadmapStateAtomic } from '../agents/_lib/roadmapStateMerge.js'

export const maxDuration = 60

// ── Types (local; mirror the cowork artifact shapes) ──────────────────

interface CoworkOutline {
  page_slug:        string
  page_type?:       string
  page_promise?:    string
  sections: Array<{
    section_intent_id?: string
    template_key:       string
    flow_role?:         string
    section_job?:       string
    intended_verbatim_band?: 'high' | 'mid' | 'low' | null
    atom_assignments?:  Array<{ slot: string; source: string }>
    voice_anchor?:      string | string[] | null
    voice_anchor_atom_ids?: string[]
    _meta?: Record<string, any>
  }>
  _meta?: Record<string, any>
}

interface CoworkDraft {
  page_slug:  string
  sections: Array<{
    section_intent_id?: string
    template_key:       string
    slot_values:        Record<string, unknown>
    atoms_used?:        string[]
    facts_used?:        string[]
    crawl_topics_used?: string[]
    deferred_atoms?:    Array<Record<string, unknown>>
    deferred_items?:    Array<Record<string, unknown>>
    voice_notes?:       string | null
    actual_verbatim_ratio?: number | null
    _meta?: Record<string, any>
  }>
  _meta?: Record<string, any>
}

interface CoworkCritique {
  page_slug:     string
  overall_band?: 'green' | 'yellow' | 'red' | 'gap' | null
  axes?:         Record<string, { score: number; pass: boolean; rationale?: string }>
  directives?:   Array<{
    kind:     string
    severity: 'info' | 'warning' | 'blocker'
    detail:   string
    section?: string
    slot?:    string
  }>
  sections?: Array<{
    section_intent_id?: string
    axes?:              Record<string, { score: number; pass: boolean; rationale?: string }>
    directives?:        Array<{ kind: string; severity: string; detail: string; slot?: string }>
  }>
  _meta?: Record<string, any>
}

interface CanonicalTemplateEntry {
  template_id: string
  cowork_writable_slots: Record<string, { max_chars?: number; max_items?: number; required?: boolean }>
  uniform_to_brixies?: {
    tagline?:         string | null
    primary_heading?: string | null
    body?:            string | null
    accent_body?:     string | null
    buttons?:         { field: string | null; subfields: { label?: string | null; url?: string | null } } | null
    items?:           { field: string | null; subfields: { item_heading?: string | null; item_body?: string | null; item_meta?: string | null } } | null
  }
}

// ── Handler ───────────────────────────────────────────────────────────

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const anonKey        = process.env.VITE_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return res.status(500).json({ error: 'Missing Supabase env vars' })
  }

  const jwt = (req.headers['authorization'] as string | undefined)?.replace(/^Bearer /, '') ?? null
  if (!jwt) return res.status(401).json({ error: 'Missing Authorization bearer token' })
  const { data: userData, error: userErr } = await createClient(supabaseUrl, anonKey).auth.getUser(jwt)
  if (userErr || !userData?.user) return res.status(401).json({ error: 'Invalid session' })

  const projectId = typeof req.body?.project_id === 'string' ? req.body.project_id : null
  const force     = req.body?.force === true
  if (!projectId) return res.status(400).json({ error: 'project_id required' })

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  // ── Load everything we need in parallel ─────────────────────────
  const [projRes, manifestRes, existingPagesRes] = await Promise.all([
    sb.from('strategy_web_projects')
      .select('id, name, roadmap_state, notion_database_id, notion_database_url')
      .eq('id', projectId)
      .maybeSingle(),
    sb.schema('strategy').from('cowork_templates')
      .select('version, manifest')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb.from('web_pages')
      .select('id, slug, sort_order, phase, content_status, cowork_handoff_at')
      .eq('web_project_id', projectId)
      .eq('archived', false),
  ])

  if (projRes.error || !projRes.data)     return res.status(404).json({ error: `project ${projectId} not found: ${projRes.error?.message}` })
  if (manifestRes.error || !manifestRes.data) return res.status(500).json({ error: `canonical templates manifest missing: ${manifestRes.error?.message}` })
  if (existingPagesRes.error)             return res.status(500).json({ error: `web_pages load failed: ${existingPagesRes.error.message}` })

  const project   = projRes.data as any
  const manifest  = (manifestRes.data as any).manifest as { page_section_templates: Record<string, CanonicalTemplateEntry> }
  const templates = manifest?.page_section_templates ?? {}
  const roadmap   = (project.roadmap_state ?? {}) as Record<string, any>

  const outlines  = (roadmap.page_outlines  ?? {}) as Record<string, CoworkOutline>
  const drafts    = (roadmap.page_drafts    ?? {}) as Record<string, CoworkDraft>
  const critiques = (roadmap.page_critiques ?? {}) as Record<string, CoworkCritique>

  // Slug set — union of any artifact's slugs. A slug with only a
  // critique (audit-branch placeholder for a missing Notion page) still
  // gets a page row with the critique attached so the strategist sees the gap.
  const allSlugs = new Set<string>([
    ...Object.keys(outlines),
    ...Object.keys(drafts),
    ...Object.keys(critiques),
  ])

  if (allSlugs.size === 0) {
    return res.status(400).json({ error: 'no_cowork_artifacts',
      detail: 'roadmap_state has no page_outlines / page_drafts / page_critiques. Run the cowork pipeline first.' })
  }

  // ── Partner-lock check (refuse to overwrite shipped pages w/o force) ─
  const existingPages = (existingPagesRes.data ?? []) as Array<{
    id: string; slug: string; sort_order: number; phase: string; content_status: string; cowork_handoff_at: string | null
  }>
  const partnerLockedSlugs = existingPages
    .filter(p => (p.content_status === 'partner_review' || p.content_status === 'partner_approved') && allSlugs.has(p.slug))
    .map(p => p.slug)
  if (partnerLockedSlugs.length > 0 && !force) {
    return res.status(409).json({
      error: 'partner_locked',
      detail: `Refusing to overwrite ${partnerLockedSlugs.length} page${partnerLockedSlugs.length === 1 ? '' : 's'} in partner review/approval. Pass force=true to proceed.`,
      partner_locked_slugs: partnerLockedSlugs,
    })
  }

  const existingBySlug = new Map(existingPages.map(p => [p.slug, p]))
  const nextSortOrder = existingPages.length
    ? Math.max(...existingPages.map(p => p.sort_order ?? 0)) + 1
    : 0

  // Page-level audit_source comes from the outline _meta first (audit
  // branch sets it there), fall back to critique _meta, fall back to
  // detecting branch from notion_database_id presence.
  const projectAuditBranch = !!project.notion_database_id
  const handoffStartedAt = new Date().toISOString()

  // ── Per-slug processing ─────────────────────────────────────────
  const audit = {
    ran_at:                  handoffStartedAt,
    branch:                  projectAuditBranch ? 'audit' : 'from-scratch',
    pages:                   {} as Record<string, any>,
    total_atoms_preserved:   0,
    total_facts_preserved:   0,
    total_topics_preserved:  0,
    total_deferred:          0,
    total_split_groups:      0,
    any_round_trip_loss:     false,
    losses:                  [] as string[],
  }

  // We sort slugs so the strategist sees a stable ordering in the
  // workspace — Notion's sort order is preserved when audit branch.
  const orderedSlugs = Array.from(allSlugs).sort((a, b) => {
    const oa = outlines[a]?.sections?.[0]?._meta?.notion_nav_order ?? null
    const ob = outlines[b]?.sections?.[0]?._meta?.notion_nav_order ?? null
    if (typeof oa === 'number' && typeof ob === 'number') return oa - ob
    return a.localeCompare(b)
  })

  let nextOrder = nextSortOrder
  for (const slug of orderedSlugs) {
    const outline  = outlines[slug]
    const draft    = drafts[slug]
    const critique = critiques[slug]
    const existing = existingBySlug.get(slug) ?? null

    const auditSourceForPage =
      (outline?._meta?.audit_source as string | undefined) ??
      (critique?._meta?.audit_source as string | undefined) ??
      (projectAuditBranch ? 'notion' : 'generated')

    const notionUrlForPage =
      (outline?._meta?.notion_url as string | undefined) ??
      (critique?._meta?.notion_url as string | undefined) ??
      (outline?.sections?.[0]?._meta?.notion_url as string | undefined) ??
      null

    // Update vs insert. Name + sort_order + phase get set ONLY on
    // insert — the handoff is idempotent for handoff-specific columns
    // (cowork_handoff_meta, audit_source, notion_url, cowork_handoff_at)
    // but doesn't touch strategist-mutable fields on rerun.
    let pageId: string
    if (existing) {
      const { error: updErr } = await sb.from('web_pages')
        .update({
          cowork_handoff_meta: buildPageHandoffMeta(outline, critique, audit.branch as 'audit'|'from-scratch'),
          audit_source:        auditSourceForPage,
          notion_url:          notionUrlForPage,
          cowork_handoff_at:   handoffStartedAt,
          updated_at:          handoffStartedAt,
        })
        .eq('id', existing.id)
      if (updErr) return res.status(500).json({ error: `web_pages update failed for ${slug}: ${updErr.message}` })
      pageId = existing.id
    } else {
      const { data: ins, error: insErr } = await sb.from('web_pages')
        .insert({
          name:                humanizeSlug(slug),
          slug,
          phase:               '1',
          cowork_handoff_meta: buildPageHandoffMeta(outline, critique, audit.branch as 'audit'|'from-scratch'),
          audit_source:        auditSourceForPage,
          notion_url:          notionUrlForPage,
          cowork_handoff_at:   handoffStartedAt,
          web_project_id:      projectId,
          sort_order:          nextOrder++,
          archived:             false,
          content_status:      'draft',
        })
        .select('id')
        .single()
      if (insErr || !ins) return res.status(500).json({ error: `web_pages insert failed for ${slug}: ${insErr?.message}` })
      pageId = ins.id
    }

    // Clean slate web_sections for this page (page-bind precedent).
    // The cowork artifacts are the source of truth; any hand edits get
    // dropped, which is why the partner-lock check above protects shipped pages.
    const { error: delErr } = await sb.from('web_sections')
      .delete()
      .eq('web_page_id', pageId)
    if (delErr) return res.status(500).json({ error: `web_sections delete failed for ${slug}: ${delErr.message}` })

    // Section processing — pair draft + outline + critique by section_intent_id
    const draftSections    = draft?.sections    ?? []
    const outlineSections  = outline?.sections  ?? []
    const critiqueSections = critique?.sections ?? []

    // SPLIT group detection: build a map of (split_from → uuid). Section
    // metadata may live on outline OR draft _meta; we check both.
    const splitGroupIds = new Map<string, string>()

    const sectionRows: any[] = []
    const drafted_atoms = new Set<string>()
    const drafted_facts = new Set<string>()
    const drafted_topics = new Set<string>()
    let drafted_deferred = 0
    let split_groups_on_page = 0

    for (let i = 0; i < draftSections.length; i++) {
      const ds       = draftSections[i]
      const intentId = ds.section_intent_id ?? `s${i + 1}`
      const os = outlineSections.find(o => o.section_intent_id === intentId) ?? outlineSections[i] ?? null
      const cs = critiqueSections.find(c => c.section_intent_id === intentId) ?? critiqueSections[i] ?? null

      const templateKey   = ds.template_key ?? os?.template_key ?? 'content_image_text_b'
      const tmplManifest  = templates[templateKey]
      if (!tmplManifest) {
        audit.losses.push(`${slug}/${intentId}: template_key="${templateKey}" not in canonical manifest`)
        audit.any_round_trip_loss = true
        continue
      }

      // SPLIT — mint or reuse a split_group_id keyed by (notion_page_id, split_from).
      const splitFrom   = (os?._meta?.split_from as string | undefined) ?? (ds._meta?.split_from as string | undefined) ?? null
      const splitPos    = (os?._meta?.split_position as number | undefined) ?? (ds._meta?.split_position as number | undefined) ?? null
      const notionPgId  = (os?._meta?.notion_page_id as string | undefined) ?? (ds._meta?.notion_page_id as string | undefined) ?? null
      const notionUrl   = (os?._meta?.notion_url as string | undefined) ?? (ds._meta?.notion_url as string | undefined) ?? notionUrlForPage

      let splitGroupId: string | null = null
      if (splitFrom) {
        const key = `${notionPgId ?? slug}::${splitFrom}`
        if (!splitGroupIds.has(key)) {
          splitGroupIds.set(key, crypto.randomUUID())
          split_groups_on_page++
        }
        splitGroupId = splitGroupIds.get(key)!
      }

      // Tally provenance for round-trip assertion.
      const atomIds  = Array.isArray(ds.atoms_used)        ? ds.atoms_used.filter(s => typeof s === 'string')        : []
      const factIds  = Array.isArray(ds.facts_used)        ? ds.facts_used.filter(s => typeof s === 'string')        : []
      const topicKs  = Array.isArray(ds.crawl_topics_used) ? ds.crawl_topics_used.filter(s => typeof s === 'string') : []
      atomIds.forEach(id => drafted_atoms.add(id))
      factIds.forEach(id => drafted_facts.add(id))
      topicKs.forEach(k  => drafted_topics.add(k))
      const deferred = Array.isArray(ds.deferred_atoms) ? ds.deferred_atoms : Array.isArray(ds.deferred_items) ? ds.deferred_items : []
      drafted_deferred += deferred.length

      // Compose Brixies field_values from cowork slot_values via the manifest's
      // uniform_to_brixies dictionary. This is the load-bearing translation —
      // both sides reference the same shared dictionary.
      const fieldValues = composeFieldValuesFromUniform(ds.slot_values ?? {}, tmplManifest)

      // Voice anchor — may be string, array of atom_ids, or array of strings.
      const voiceAnchorIds: string[] = (() => {
        const va = os?.voice_anchor_atom_ids ?? os?.voice_anchor
        if (Array.isArray(va)) return va.filter(x => typeof x === 'string')
        if (typeof va === 'string') return [va]
        return []
      })()

      // Section meta — the load-bearing audit-tab payload.
      const sectionMeta = {
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
      }

      sectionRows.push({
        web_page_id:         pageId,
        content_template_id: tmplManifest.template_id,
        field_values:        fieldValues,
        cowork_slot_values:  ds.slot_values ?? {},
        cowork_section_meta: sectionMeta,
        sort_order:          i,
        content_status:      'draft',
        notes:               (ds.voice_notes ?? null) as string | null,
        split_group_id:      splitGroupId,
        split_position:      splitPos,
      })
    }

    if (sectionRows.length > 0) {
      const { error: insSecErr } = await sb.from('web_sections').insert(sectionRows)
      if (insSecErr) return res.status(500).json({ error: `web_sections insert failed for ${slug}: ${insSecErr.message}` })
    }

    // Per-page round-trip telemetry.
    audit.total_atoms_preserved  += drafted_atoms.size
    audit.total_facts_preserved  += drafted_facts.size
    audit.total_topics_preserved += drafted_topics.size
    audit.total_deferred         += drafted_deferred
    audit.total_split_groups     += split_groups_on_page

    audit.pages[slug] = {
      page_id:               pageId,
      sections_in_draft:     draftSections.length,
      sections_written:      sectionRows.length,
      atoms_preserved:       drafted_atoms.size,
      facts_preserved:       drafted_facts.size,
      crawl_topics_preserved: drafted_topics.size,
      deferred_total:        drafted_deferred,
      split_groups:          split_groups_on_page,
      audit_source:          auditSourceForPage,
      overall_band:          critique?.overall_band ?? null,
    }

    // Per-section round-trip check: at least the section count must match
    // unless the draft was empty (audit-branch notion-gap critiques have
    // no draft sections — expected).
    if (draftSections.length > 0 && sectionRows.length !== draftSections.length) {
      audit.losses.push(`${slug}: ${sectionRows.length}/${draftSections.length} sections written`)
      audit.any_round_trip_loss = true
    }
  }

  // ── Final write: handoff audit summary into roadmap_state ─────────
  try {
    await setRoadmapStateAtomic(sb, projectId, ['cowork_handoff_audit'], audit)
  } catch (e) {
    // Non-fatal — the writes already landed. Surface the issue but don't roll back.
    audit.losses.push(`telemetry write failed: ${e instanceof Error ? e.message : 'unknown'}`)
  }

  if (audit.any_round_trip_loss) {
    return res.status(422).json({
      error:     'round_trip_loss',
      detail:    'Handoff completed but information was lost vs the source artifacts. See losses[].',
      losses:    audit.losses,
      audit,
    })
  }

  return res.status(200).json({
    ok:        true,
    project_id: projectId,
    pages:     Object.keys(audit.pages).length,
    audit,
  })
}

// ── Helpers ───────────────────────────────────────────────────────────

/** Compose Brixies-named field_values from cowork's uniform-named
 *  slot_values, via the canonical manifest's uniform_to_brixies map.
 *  Both sides reference the SAME dictionary — no guesswork. */
function composeFieldValuesFromUniform(
  cowork:   Record<string, unknown>,
  template: CanonicalTemplateEntry,
): Record<string, unknown> {
  const map = template.uniform_to_brixies
  if (!map) return cowork as Record<string, unknown>  // no map → pass through (legacy)

  const out: Record<string, unknown> = {}

  // Scalar slots — direct rename.
  for (const uniform of ['tagline', 'primary_heading', 'body', 'accent_body'] as const) {
    const brixies = map[uniform]
    if (typeof brixies === 'string' && cowork[uniform] != null) {
      out[brixies] = cowork[uniform]
    }
  }

  // Buttons — uniform array of {label, url}; Brixies is a group with
  // a single subfield (label only, per the live schema). url goes into
  // a secondary field if Brixies declares one.
  if (map.buttons && Array.isArray(cowork.buttons)) {
    const fieldKey = map.buttons.field
    const subL = map.buttons.subfields?.label
    const subU = map.buttons.subfields?.url
    if (fieldKey) {
      out[fieldKey] = (cowork.buttons as Array<Record<string, unknown>>).map(b => {
        const row: Record<string, unknown> = {}
        if (subL) row[subL] = b.label ?? b.text ?? ''
        if (subU) row[subU] = b.url   ?? b.href ?? ''
        return row
      })
    }
  }

  // Items — uniform array of {item_heading, item_body, item_meta}; Brixies
  // varies wildly per template (column_list, accordion_right, row_grid, etc.).
  if (map.items && Array.isArray(cowork.items)) {
    const fieldKey = map.items.field
    const subH = map.items.subfields?.item_heading
    const subB = map.items.subfields?.item_body
    const subM = map.items.subfields?.item_meta
    if (fieldKey) {
      out[fieldKey] = (cowork.items as Array<Record<string, unknown>>).map(it => {
        const row: Record<string, unknown> = {}
        if (subH) row[subH] = it.item_heading ?? it.heading ?? it.title ?? ''
        if (subB) row[subB] = it.item_body    ?? it.body    ?? it.description ?? ''
        if (subM) row[subM] = it.item_meta    ?? it.meta    ?? ''
        return row
      })
    }
  }

  return out
}

/** Page-level handoff meta blob — mirrors what the audit/scan tab reads. */
function buildPageHandoffMeta(
  outline:  CoworkOutline  | undefined,
  critique: CoworkCritique | undefined,
  branch:   'audit' | 'from-scratch',
): Record<string, unknown> {
  return {
    branch,
    outline_meta:   outline?._meta  ?? {},
    critique_meta:  critique?._meta ?? {},
    overall_band:   critique?.overall_band ?? null,
    directives:     critique?.directives ?? [],
    round_trip:     null,  // filled in later if we extend telemetry inline
  }
}

/** "plan-a-visit" → "Plan a Visit". Used to populate web_pages.name when a
 *  slug doesn't already have a row. The strategist can rename in the
 *  workspace; handoff re-runs don't overwrite the name. */
function humanizeSlug(slug: string): string {
  if (slug === '/' || slug === 'home' || slug === '') return 'Home'
  return slug
    .split(/[-_/]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}
