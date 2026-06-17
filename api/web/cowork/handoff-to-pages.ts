/**
 * Vercel Serverless Function — /api/web/cowork/handoff-to-pages
 *
 * Ground-zero rebuild (commit lineage: plan file). Replaces the
 * earlier translator that hand-rolled uniform→Brixies mappings from
 * a flawed schema scan.
 *
 * NEW CONTRACT:
 *   1. The handoff ALWAYS pushes. No user-facing refusals.
 *   2. For each cowork section: translator emits a renderable
 *      field_values for the picked Brixies template + reports
 *      bind_quality ('perfect' | 'partial') + gaps[].
 *   3. cowork_slot_values is written bit-for-bit (durable source);
 *      field_values is derived (Brixies-shaped, re-derivable on
 *      template swap).
 *   4. Sections that aren't `perfect` push anyway; the Rich Content
 *      Companion side panel in PagesWorkspace gives the strategist
 *      a path forward (manual bind / variant swap / edit content).
 *      No "re-run cowork" failure mode.
 *   5. Gaps are logged to strategy_web_projects.handoff_refusal_log
 *      AND .claude/handoff-refusals.md (Claude-Code-only signal).
 *      Strategist is never notified; the assistant reads the log on
 *      the next session and fixes root causes so future handoffs
 *      produce `perfect` for the same shape.
 *   6. Telemetry: bind_quality distribution per project, perfect_rate.
 *      ≥0.90 = success; <0.90 = "implementation needs more work"
 *      Claude-Code-only flag (NOT shown to strategist).
 *
 * Translator details — composeFieldValuesForBrixies:
 *   - Reads strategy.cowork_templates v2.0.0 manifest per
 *     template_key. Manifest carries: uniform_to_brixies (with per-
 *     template button nesting + items multi-group split rules +
 *     palette refs), richtext_keys, required_slots, max_items.
 *   - Walks the 5 closed cowork slots (primary_heading, tagline,
 *     body, accent_body, items, buttons) + emits a Brixies-named
 *     field_values that matches the template's renderer contract
 *     verbatim (per the verified working examples in Phase 0 audit).
 *   - Wraps richtext-typed values in <p>…</p> if input isn't already
 *     HTML (renderer expects HTML strings for richtext slots).
 *   - For multi-group templates (accordion_faq): splits items
 *     alternating across two group fields.
 *   - For inverted templates (cta_callout): writes buttons into
 *     the schema's `image` field per verified working data.
 *   - Never writes a string to a known image field — designer
 *     placeholders remain.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { setRoadmapStateAtomic } from '../agents/_lib/roadmapStateMerge.js'

export const maxDuration = 60

// ── Types (mirror cowork artifact + manifest shapes) ──────────────

interface CoworkDraftSection {
  section_intent_id?: string
  template_key?:      string
  slot_values?:       Record<string, unknown>
  atoms_used?:        string[]
  facts_used?:        string[]
  crawl_topics_used?: string[]
  deferred_items?:    Array<Record<string, unknown>>
  deferred_atoms?:    Array<Record<string, unknown>>
  voice_notes?:       string | null
  actual_verbatim_ratio?: number | null
  _meta?: Record<string, any>
}

interface ManifestEntry {
  template_id:           string
  cowork_writable_slots: Record<string, { max_chars?: number; max_items?: number; required?: boolean }>
  uniform_to_brixies: {
    tagline:         string | null
    primary_heading: string | null
    body:            string | null
    accent_body:     string | null
    buttons: null | {
      field:     string
      subfields: { label: string; url: string | null }
      nesting:   'flat' | 'contact'
    }
    items: null | {
      field?:    string                        // single-group templates
      subfields: { item_heading: string | null; item_body: string | null; item_meta: string | null }
      split:     null | { groups: string[]; rule: 'alternate' | 'halve' }
    }
  }
  richtext_keys:    string[]
  required_slots:   string[]
  verified:         boolean
  palette_ref?:     string | null
  notes?:           string
}

interface BindResult {
  field_values: Record<string, unknown>
  bind_quality: 'perfect' | 'partial'
  gaps:         Array<{ kind: string; severity: 'info' | 'warning' | 'blocker'; detail: string; slot?: string }>
}

// ── Translator ────────────────────────────────────────────────────

/** Wrap plain text in <p>...</p> if it isn't already HTML. Renderer
 *  expects HTML strings for richtext slots; cowork emits plain text
 *  for some slots and HTML for others. Normalize at bind time. */
function ensureHtml(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  // Already-HTML detection: starts with a block tag.
  if (/^<(p|ul|ol|li|h\d|div|blockquote|figure|table|section|article)[\s>]/i.test(trimmed)) {
    return trimmed
  }
  // Multi-paragraph: split on double newline.
  const paras = trimmed.split(/\n{2,}/g).map(p => p.trim()).filter(Boolean)
  if (paras.length > 1) {
    return paras.map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('')
  }
  return `<p>${escapeHtml(trimmed).replace(/\n/g, '<br>')}</p>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function isHtmlAlready(value: unknown): boolean {
  if (typeof value !== 'string') return false
  return /^<(p|ul|ol|li|h\d|div|blockquote|figure|table|section|article)[\s>]/i.test(value.trim())
}

/** The translator. Reads cowork uniform slot_values + a v2.0.0
 *  manifest entry; produces a Brixies-shaped field_values + a
 *  bind_quality verdict + gap list. NEVER throws — partial bindings
 *  return with gaps; the caller decides what to do with the section.
 *  Returns `field_values` that matches the renderer's expected shape
 *  per the verified Phase 0 working examples. */
function composeFieldValuesForBrixies(
  slotValues: Record<string, unknown>,
  entry: ManifestEntry,
): BindResult {
  const fv: Record<string, unknown> = {}
  const gaps: BindResult['gaps'] = []
  const map = entry.uniform_to_brixies
  const richtextKeys = new Set(entry.richtext_keys ?? [])

  // ── Scalars: tagline / primary_heading / body / accent_body ────
  for (const uniformKey of ['tagline', 'primary_heading', 'body', 'accent_body'] as const) {
    const brixiesKey = map[uniformKey]
    const coworkValue = slotValues[uniformKey]
    const hasCowork = coworkValue != null && coworkValue !== ''

    if (brixiesKey == null) {
      // Template has no slot for this uniform key. If cowork emitted
      // content here, that's content the picked template can't show
      // — a gap (but not blocking; strategist sees in the Rich
      // Companion + can swap templates).
      if (hasCowork) {
        gaps.push({
          kind: 'uniform_slot_not_supported_by_template',
          severity: 'warning',
          detail: `cowork emitted '${uniformKey}' but template '${entry.template_id}' has no slot for it; content stays in cowork_slot_values + visible in the Rich Companion`,
          slot: uniformKey,
        })
      }
      continue
    }

    if (!hasCowork) {
      // Cowork didn't fill it. If the slot is required by the template,
      // that's a gap. Don't write to field_values — let the renderer
      // use the Brixies designer placeholder.
      if (entry.required_slots.includes(brixiesKey)) {
        gaps.push({
          kind: 'required_slot_missing',
          severity: 'blocker',
          detail: `template '${entry.template_id}' requires '${brixiesKey}' but cowork did not emit '${uniformKey}'`,
          slot: brixiesKey,
        })
      }
      continue
    }

    // Write the value. Wrap as HTML if this brixies key is richtext.
    if (richtextKeys.has(brixiesKey)) {
      fv[brixiesKey] = isHtmlAlready(coworkValue) ? coworkValue : ensureHtml(coworkValue)
    } else {
      fv[brixiesKey] = String(coworkValue)
    }
  }

  // ── Buttons ────────────────────────────────────────────────────
  if (Array.isArray(slotValues.buttons) && slotValues.buttons.length > 0) {
    const coworkButtons = slotValues.buttons as Array<Record<string, unknown>>
    if (map.buttons == null) {
      gaps.push({
        kind: 'uniform_slot_not_supported_by_template',
        severity: 'warning',
        detail: `cowork emitted ${coworkButtons.length} button(s) but template '${entry.template_id}' has no button slot`,
        slot: 'buttons',
      })
    } else {
      const { field, subfields, nesting } = map.buttons
      const subL = subfields.label
      const subU = subfields.url
      // Compose the per-template button shape.
      const composed = coworkButtons.map(b => {
        // Cowork's standard shape: {label, url}. Tolerate the rare
        // {contact: "string"} shorthand by normalizing first.
        const label =
          typeof b.label === 'string' ? b.label :
          typeof b.text === 'string' ? b.text :
          typeof b.contact === 'string' ? b.contact :
          (b.contact && typeof b.contact === 'object' && typeof (b.contact as any).label === 'string'
            ? (b.contact as any).label : '')
        const url =
          typeof b.url === 'string' ? b.url :
          typeof b.href === 'string' ? b.href :
          (b.contact && typeof b.contact === 'object' && typeof (b.contact as any).url === 'string'
            ? (b.contact as any).url : '')
        if (!label) {
          gaps.push({
            kind: 'button_missing_label',
            severity: 'warning',
            detail: `button emitted with no label (url='${url}')`,
            slot: 'buttons',
          })
        }
        if (!url) {
          gaps.push({
            kind: 'button_missing_url',
            severity: 'warning',
            detail: `button emitted with no url (label='${label}')`,
            slot: 'buttons',
          })
        }
        if (nesting === 'contact') {
          // {contact: {label, url}} shape
          const inner: Record<string, unknown> = {}
          inner[subL] = label
          if (subU) inner[subU] = url
          return { contact: inner }
        }
        // 'flat' shape — {label, url}
        const row: Record<string, unknown> = {}
        row[subL] = label
        if (subU) row[subU] = url
        return row
      })
      fv[field] = composed
    }
  }

  // ── Items ──────────────────────────────────────────────────────
  if (Array.isArray(slotValues.items) && slotValues.items.length > 0) {
    const coworkItems = slotValues.items as Array<Record<string, unknown>>
    if (map.items == null) {
      gaps.push({
        kind: 'uniform_slot_not_supported_by_template',
        severity: 'warning',
        detail: `cowork emitted ${coworkItems.length} item(s) but template '${entry.template_id}' has no items slot`,
        slot: 'items',
      })
    } else {
      const { field: singleField, subfields, split } = map.items
      const subH = subfields.item_heading
      const subB = subfields.item_body
      const subM = subfields.item_meta

      const composeItem = (it: Record<string, unknown>): Record<string, unknown> => {
        const row: Record<string, unknown> = {}
        if (subH != null) {
          const v = it.item_heading ?? it.heading ?? it.title ?? ''
          row[subH] = String(v)
        }
        if (subB != null) {
          const v = it.item_body ?? it.body ?? it.description ?? ''
          row[subB] = richtextKeys.has(subB)
            ? (isHtmlAlready(v) ? v : ensureHtml(v))
            : String(v)
        }
        if (subM != null) {
          const v = it.item_meta ?? it.meta ?? ''
          row[subM] = String(v)
        }
        return row
      }

      if (split) {
        // Multi-group templates: distribute across two groups by rule.
        const groupA: Array<Record<string, unknown>> = []
        const groupB: Array<Record<string, unknown>> = []
        if (split.rule === 'alternate') {
          coworkItems.forEach((it, idx) => {
            const composed = composeItem(it)
            if (idx % 2 === 0) groupA.push(composed)
            else groupB.push(composed)
          })
        } else if (split.rule === 'halve') {
          const half = Math.ceil(coworkItems.length / 2)
          coworkItems.slice(0, half).forEach(it => groupA.push(composeItem(it)))
          coworkItems.slice(half).forEach(it => groupB.push(composeItem(it)))
        }
        fv[split.groups[0]] = groupA
        fv[split.groups[1]] = groupB
      } else if (singleField) {
        fv[singleField] = coworkItems.map(composeItem)
      } else {
        gaps.push({
          kind: 'items_field_unmapped',
          severity: 'blocker',
          detail: `template '${entry.template_id}' map declares items support but no field name + no split rule`,
          slot: 'items',
        })
      }

      // Item count vs template cap
      const itemsSpec = entry.cowork_writable_slots?.items
      const maxItems = itemsSpec?.max_items
      if (typeof maxItems === 'number' && coworkItems.length > maxItems) {
        gaps.push({
          kind: 'items_overflow',
          severity: 'warning',
          detail: `${coworkItems.length} items emitted; template '${entry.template_id}' caps at ${maxItems} (extras still rendered)`,
          slot: 'items',
        })
      }
    }
  }

  // ── Required-slot final sweep (catch any we didn't write above) ─
  for (const reqKey of entry.required_slots) {
    if (fv[reqKey] == null || fv[reqKey] === '') {
      if (!gaps.some(g => g.kind === 'required_slot_missing' && g.slot === reqKey)) {
        gaps.push({
          kind: 'required_slot_missing',
          severity: 'blocker',
          detail: `template '${entry.template_id}' requires '${reqKey}' but no cowork slot mapped to it`,
          slot: reqKey,
        })
      }
    }
  }

  const bind_quality: 'perfect' | 'partial' =
    gaps.length === 0 ? 'perfect' : 'partial'

  return { field_values: fv, bind_quality, gaps }
}

// ── Handler ───────────────────────────────────────────────────────

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

  // ── Load everything ─────────────────────────────────────────────
  const [projRes, manifestRes, existingPagesRes] = await Promise.all([
    sb.from('strategy_web_projects')
      .select('id, name, member, roadmap_state, notion_database_id, notion_database_url')
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
  const manifest  = (manifestRes.data as any).manifest as { page_section_templates: Record<string, ManifestEntry> }
  const templates = manifest?.page_section_templates ?? {}
  const manifestVersion = (manifestRes.data as any).version as string
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
    return res.status(400).json({ error: 'no_cowork_artifacts',
      detail: 'roadmap_state has no page_outlines / page_drafts / page_critiques. Run the cowork pipeline first.' })
  }

  // Partner-lock check (still preserved — protects shipped pages).
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
  let nextSortOrder = existingPages.length
    ? Math.max(...existingPages.map(p => p.sort_order ?? 0)) + 1
    : 0

  const projectAuditBranch = !!project.notion_database_id
  const handoffStartedAt = new Date().toISOString()

  // ── Per-slug processing ─────────────────────────────────────────
  const audit = {
    ran_at:                 handoffStartedAt,
    manifest_version:       manifestVersion,
    branch:                 projectAuditBranch ? 'audit' as const : 'from-scratch' as const,
    pages:                  {} as Record<string, any>,
    total_sections:         0,
    perfect_sections:       0,
    partial_sections:       0,
    perfect_rate:           0,
    total_atoms_preserved:  0,
    total_facts_preserved:  0,
    total_topics_preserved: 0,
    total_deferred:         0,
    gaps_by_kind:           {} as Record<string, number>,
    claude_code_signal:     null as null | { needs_work: boolean; reason: string },
  }
  const refusalEntries: Array<Record<string, unknown>> = []

  for (const slug of Array.from(allSlugs).sort((a, b) => a.localeCompare(b))) {
    const draft    = drafts[slug]   ?? null
    const outline  = outlines[slug] ?? null
    const critique = critiques[slug] ?? null
    const existing = existingBySlug.get(slug) ?? null

    // Page-level audit_source
    const auditSourceForPage =
      (outline?._meta?.audit_source as string | undefined) ??
      (critique?._meta?.audit_source as string | undefined) ??
      (projectAuditBranch ? 'notion' : 'generated')

    const notionUrlForPage =
      (outline?._meta?.notion_url as string | undefined) ??
      (critique?._meta?.notion_url as string | undefined) ??
      (outline?.sections?.[0]?._meta?.notion_url as string | undefined) ?? null

    // Upsert web_pages row
    let pageId: string
    if (existing) {
      const { error: updErr } = await sb.from('web_pages')
        .update({
          cowork_handoff_meta: {
            branch:        audit.branch,
            outline_meta:  outline?._meta ?? {},
            critique_meta: critique?._meta ?? {},
            overall_band:  critique?.overall_band ?? null,
            directives:    critique?.directives ?? [],
          },
          audit_source:      auditSourceForPage,
          notion_url:        notionUrlForPage,
          cowork_handoff_at: handoffStartedAt,
          updated_at:        handoffStartedAt,
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
          cowork_handoff_meta: {
            branch:        audit.branch,
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
        })
        .select('id')
        .single()
      if (insErr || !ins) return res.status(500).json({ error: `web_pages insert failed for ${slug}: ${insErr?.message}` })
      pageId = ins.id
    }

    // Clean slate web_sections for this page
    const { error: delErr } = await sb.from('web_sections')
      .delete()
      .eq('web_page_id', pageId)
    if (delErr) return res.status(500).json({ error: `web_sections delete failed for ${slug}: ${delErr.message}` })

    // Per-section processing
    const draftSections = Array.isArray(draft?.sections) ? draft.sections as CoworkDraftSection[] : []
    const outlineSections = Array.isArray(outline?.sections) ? outline.sections as Array<Record<string, any>> : []
    const critiqueSections = Array.isArray(critique?.sections) ? critique.sections as Array<Record<string, any>> : []

    const splitGroupIds = new Map<string, string>()
    const sectionRows: any[] = []
    const draftedAtoms  = new Set<string>()
    const draftedFacts  = new Set<string>()
    const draftedTopics = new Set<string>()
    let draftedDeferred = 0
    let perfectInThisPage = 0
    let partialInThisPage = 0
    let splitGroupsOnPage = 0

    for (let i = 0; i < draftSections.length; i++) {
      const ds = draftSections[i]
      const intentId = ds.section_intent_id ?? `s${i + 1}`
      const os = outlineSections.find(o => o.section_intent_id === intentId) ?? outlineSections[i] ?? null
      const cs = critiqueSections.find(c => c.section_intent_id === intentId) ?? critiqueSections[i] ?? null

      const templateKey = ds.template_key ?? os?.template_key
      if (!templateKey) {
        // Section has no template — flag and skip web_section creation
        // for this row (cowork emitted a malformed section).
        refusalEntries.push({
          ran_at: handoffStartedAt,
          page_slug: slug,
          section_intent_id: intentId,
          template_key: null,
          gaps: ['section_emitted_with_no_template_key'],
          root_cause_hypothesis: 'cowork audit SKILL emitted a section without template_key; tighten SKILL emission contract',
          preserved_content: ds.slot_values ?? {},
        })
        continue
      }
      const entry = templates[templateKey]
      if (!entry) {
        refusalEntries.push({
          ran_at: handoffStartedAt,
          page_slug: slug,
          section_intent_id: intentId,
          template_key: templateKey,
          gaps: [`template_key '${templateKey}' not in canonical manifest`],
          root_cause_hypothesis: 'cowork audit SKILL picked a template_key not in canonical-templates v2.0.0; SKILL prompt + manifest are out of sync',
          preserved_content: ds.slot_values ?? {},
        })
        continue
      }

      // Translator call — never throws
      const bind = composeFieldValuesForBrixies(ds.slot_values ?? {}, entry)

      // SPLIT marker (audit-branch overflow)
      const splitFrom = (os?._meta?.split_from as string | undefined) ?? (ds._meta?.split_from as string | undefined) ?? null
      const splitPos  = (os?._meta?.split_position as number | undefined) ?? (ds._meta?.split_position as number | undefined) ?? null
      const notionPgId = (os?._meta?.notion_page_id as string | undefined) ?? (ds._meta?.notion_page_id as string | undefined) ?? null
      const notionUrl  = (os?._meta?.notion_url as string | undefined) ?? (ds._meta?.notion_url as string | undefined) ?? notionUrlForPage
      let splitGroupId: string | null = null
      if (splitFrom) {
        const key = `${notionPgId ?? slug}::${splitFrom}`
        if (!splitGroupIds.has(key)) {
          splitGroupIds.set(key, crypto.randomUUID())
          splitGroupsOnPage++
        }
        splitGroupId = splitGroupIds.get(key)!
      }

      // Provenance counts
      const atomIds = Array.isArray(ds.atoms_used) ? ds.atoms_used.filter(s => typeof s === 'string') : []
      const factIds = Array.isArray(ds.facts_used) ? ds.facts_used.filter(s => typeof s === 'string') : []
      const topicKs = Array.isArray(ds.crawl_topics_used) ? ds.crawl_topics_used.filter(s => typeof s === 'string') : []
      atomIds.forEach(id => draftedAtoms.add(id))
      factIds.forEach(id => draftedFacts.add(id))
      topicKs.forEach(k  => draftedTopics.add(k))
      const deferred = Array.isArray(ds.deferred_atoms) ? ds.deferred_atoms : Array.isArray(ds.deferred_items) ? ds.deferred_items : []
      draftedDeferred += deferred.length

      // Voice anchor
      const voiceAnchorIds: string[] = (() => {
        const va = os?.voice_anchor_atom_ids ?? os?.voice_anchor
        if (Array.isArray(va)) return va.filter(x => typeof x === 'string')
        if (typeof va === 'string') return [va]
        return []
      })()

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
        bind_quality:           bind.bind_quality,
        gaps:                   bind.gaps,
        manifest_version:       manifestVersion,
      }

      sectionRows.push({
        web_page_id:         pageId,
        content_template_id: entry.template_id,
        field_values:        bind.field_values,
        cowork_slot_values:  ds.slot_values ?? {},        // BIT-FOR-BIT durable
        source_field_values: ds.slot_values ?? {},        // for the existing variant-swap engine
        cowork_section_meta: sectionMeta,
        sort_order:          i,
        content_status:      'draft',
        notes:               (ds.voice_notes ?? null) as string | null,
        split_group_id:      splitGroupId,
        split_position:      splitPos,
      })

      if (bind.bind_quality === 'perfect') perfectInThisPage++
      else                                  partialInThisPage++

      // Roll up gap kinds for telemetry + write refusal entries for partial.
      if (bind.bind_quality === 'partial') {
        for (const g of bind.gaps) {
          audit.gaps_by_kind[g.kind] = (audit.gaps_by_kind[g.kind] ?? 0) + 1
        }
        refusalEntries.push({
          ran_at:                 handoffStartedAt,
          page_slug:              slug,
          section_intent_id:      intentId,
          template_key:           templateKey,
          template_id:            entry.template_id,
          gaps:                   bind.gaps,
          root_cause_hypothesis:  inferRootCause(bind.gaps, entry),
          preserved_content:      ds.slot_values ?? {},
        })
      }
    }

    if (sectionRows.length > 0) {
      const { error: insSecErr } = await sb.from('web_sections').insert(sectionRows)
      if (insSecErr) return res.status(500).json({ error: `web_sections insert failed for ${slug}: ${insSecErr.message}` })
    }

    audit.total_atoms_preserved  += draftedAtoms.size
    audit.total_facts_preserved  += draftedFacts.size
    audit.total_topics_preserved += draftedTopics.size
    audit.total_deferred         += draftedDeferred
    audit.total_sections         += sectionRows.length
    audit.perfect_sections       += perfectInThisPage
    audit.partial_sections       += partialInThisPage

    audit.pages[slug] = {
      page_id:                pageId,
      sections_in_draft:      draftSections.length,
      sections_written:       sectionRows.length,
      perfect_sections:       perfectInThisPage,
      partial_sections:       partialInThisPage,
      atoms_preserved:        draftedAtoms.size,
      facts_preserved:        draftedFacts.size,
      crawl_topics_preserved: draftedTopics.size,
      deferred_total:         draftedDeferred,
      split_groups:           splitGroupsOnPage,
      audit_source:           auditSourceForPage,
      overall_band:           critique?.overall_band ?? null,
    }
  }

  audit.perfect_rate = audit.total_sections > 0
    ? Math.round((audit.perfect_sections / audit.total_sections) * 10000) / 10000
    : 0

  // ≥0.90 = success. <0.90 = Claude Code work needed.
  if (audit.total_sections > 0 && audit.perfect_rate < 0.9) {
    audit.claude_code_signal = {
      needs_work: true,
      reason: `perfect_rate=${audit.perfect_rate} below 0.90 target. Inspect handoff_refusal_log + .claude/handoff-refusals.md for root causes.`,
    }
  }

  // Persist telemetry + append refusal entries
  try {
    await setRoadmapStateAtomic(sb, projectId, ['cowork_handoff_audit'], audit)
  } catch (e) {
    // Non-fatal: writes already landed.
  }

  if (refusalEntries.length > 0) {
    // Append to handoff_refusal_log, but CAP the total at 500 entries
    // so the jsonb column doesn't grow unbounded across many handoff
    // re-runs. Older entries get dropped (FIFO) — Claude Code only
    // needs recent ones to spot patterns. Read-modify-write keeps
    // the cap enforcement in one place.
    const REFUSAL_LOG_CAP = 500
    const { data: cur } = await sb.from('strategy_web_projects')
      .select('handoff_refusal_log')
      .eq('id', projectId)
      .maybeSingle()
    const existing = ((cur as any)?.handoff_refusal_log ?? []) as unknown[]
    const merged = [...existing, ...refusalEntries]
    const trimmed = merged.length > REFUSAL_LOG_CAP
      ? merged.slice(merged.length - REFUSAL_LOG_CAP)
      : merged
    await sb.from('strategy_web_projects')
      .update({ handoff_refusal_log: trimmed })
      .eq('id', projectId)
  }

  return res.status(200).json({
    ok:        true,
    project_id: projectId,
    pages:     Object.keys(audit.pages).length,
    audit,
  })
}

// ── Root-cause heuristic ──────────────────────────────────────────

function inferRootCause(
  gaps: BindResult['gaps'],
  entry: ManifestEntry,
): string {
  if (gaps.some(g => g.kind === 'required_slot_missing')) {
    return `Template '${entry.template_id}' (${entry.uniform_to_brixies ? 'verified=' + entry.verified : ''}) requires slots cowork didn't fill. Likely cowork SKILL emission gap — tighten the prompt to always emit those slots OR pick a template with looser requirements.`
  }
  if (gaps.some(g => g.kind === 'uniform_slot_not_supported_by_template')) {
    return `Template '${entry.template_id}' lacks slots for content cowork emitted. Audit SKILL picked the wrong template family for this section; constrain SKILL picks to templates whose uniform_to_brixies covers all the section's emitted slots.`
  }
  if (gaps.some(g => g.kind === 'button_missing_url' || g.kind === 'button_missing_label')) {
    return 'Cowork emitted button with missing label or url (often a [NEEDS INPUT] placeholder). Tighten SKILL: require both subfields on every button.'
  }
  if (gaps.some(g => g.kind === 'items_overflow')) {
    return `Item count exceeds template '${entry.template_id}' cap. SKILL should SPLIT the section across multiple template instances OR SUBSTITUTE a higher-cap template.`
  }
  return 'See gaps[] for detail. Investigate per-template binding logic.'
}

// ── Helpers ───────────────────────────────────────────────────────

function humanizeSlug(slug: string): string {
  if (slug === '/' || slug === 'home' || slug === '') return 'Home'
  return slug
    .split(/[-_/]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}
