/**
 * Vercel Serverless Function — /api/web/agents/page-bind
 *
 * Step 5 — mechanical bind. Takes one page_draft from
 * roadmap_state.page_drafts.{slug} and commits it to web_pages +
 * freehand web_sections rows so the partner-facing surface (and the
 * page editor) renders it.
 *
 * No AI involved. Deterministic. Reads the draft's section archetypes
 * + copy, renders each section into a markdown body, writes web_sections
 * with field_values.body populated (so source_markdown reads correctly).
 *
 * Template-level binding (upgrading freehand sections to specific
 * Brixies template variants) stays as a separate user-initiated step
 * in the page editor — same flow as importBrief uses today via
 * autoBindPageSections. The orchestrator runs page-bind to land copy
 * on real pages; the strategist optionally triggers template binding
 * later from the UI.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'

export const maxDuration = 60

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const anonKey        = process.env.VITE_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return res.status(500).json({ error: 'Missing env vars' })
  }

  const jwt = (req.headers['authorization'] as string | undefined)?.replace(/^Bearer /, '') ?? null
  if (!jwt) return res.status(401).json({ error: 'Missing Authorization bearer token' })
  const { data: userData, error: userErr } = await createClient(supabaseUrl, anonKey).auth.getUser(jwt)
  if (userErr || !userData?.user) return res.status(401).json({ error: 'Invalid session' })

  const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : null
  const pageSlug  = typeof req.body?.pageSlug  === 'string' ? req.body.pageSlug  : null
  if (!projectId || !pageSlug) {
    return res.status(400).json({ error: 'projectId and pageSlug required' })
  }

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  const { data: project } = await sb.from('strategy_web_projects')
    .select('id, roadmap_state').eq('id', projectId).maybeSingle()
  if (!project) return res.status(404).json({ error: 'Project not found' })

  const roadmapState = (project.roadmap_state ?? {}) as Record<string, any>
  const draft = roadmapState.page_drafts?.[pageSlug]
  const stage2 = roadmapState.stage_2
  const sitemapPage = stage2?.sitemap?.pages?.find?.((p: any) => p?.slug === pageSlug)
            ?? stage2?.pages?.find?.((p: any) => p?.slug === pageSlug)

  if (!draft) return res.status(400).json({ error: `No page_draft for slug "${pageSlug}"` })
  if (!sitemapPage) return res.status(400).json({ error: `Slug "${pageSlug}" not in approved sitemap` })

  const pageTitle = sitemapPage.title || sitemapPage.name || pageSlug
  const phase = sitemapPage.phase ?? '1'

  // Upsert web_pages row
  let pageId: string
  let created = false
  const { data: existing } = await sb.from('web_pages')
    .select('id').eq('web_project_id', projectId).eq('slug', pageSlug).eq('archived', false).maybeSingle()
  if (existing) {
    pageId = (existing as { id: string }).id
    await sb.from('web_pages').update({
      name: pageTitle,
      phase: String(phase),
      brief: draft,
      brief_imported_at: new Date().toISOString(),
    }).eq('id', pageId)
  } else {
    const { data: maxRow } = await sb.from('web_pages')
      .select('sort_order').eq('web_project_id', projectId)
      .order('sort_order', { ascending: false }).limit(1).maybeSingle()
    const sort_order = ((maxRow as { sort_order: number } | null)?.sort_order ?? -1) + 1
    const { data: newPage, error: createErr } = await sb.from('web_pages').insert({
      web_project_id: projectId,
      name: pageTitle,
      slug: pageSlug,
      phase: String(phase),
      sort_order,
      brief: draft,
      brief_imported_at: new Date().toISOString(),
    }).select('id').single()
    if (createErr || !newPage) return res.status(500).json({ error: `Page create failed: ${createErr?.message}` })
    pageId = (newPage as { id: string }).id
    created = true
  }

  // Replace ALL existing sections on this page. The bind step now
  // writes template-bound rows directly (using the picks the engine
  // surfaced at Gate 2 + the strategist's overrides), so we own the
  // sections from end to end. Strategists who used to manually
  // upgrade sections in the Pages tab should make those picks at
  // Gate 2's swap UI instead — the re-commit flow now reads from
  // there.
  await sb.from('web_sections').delete().eq('web_page_id', pageId)

  // Read the pre-bind picks (set by suggest_bind_for_page at Gate 2)
  // and the strategist's manual overrides — overrides win. For
  // sections with a template pick, set content_template_id; sections
  // with no pick fall back to freehand. field_values composition stays
  // simple (heading/description/body landed into matching slots when
  // possible, otherwise dumped as a body slot) — the field-shape
  // resolver in the Pages workspace handles render-time substitution.
  const bindForPage = (roadmapState.page_bind_suggestions ?? {})[pageSlug] as
    { sections?: Array<{ section_ix: number; chosen_template_id: string | null }>;
      user_overrides?: Record<string, string> } | undefined
  const enginePicks = new Map<number, string>()
  for (const s of (bindForPage?.sections ?? [])) {
    if (s.chosen_template_id) enginePicks.set(s.section_ix, s.chosen_template_id)
  }
  const userOverrides = new Map<number, string>()
  for (const [ix, tplId] of Object.entries(bindForPage?.user_overrides ?? {})) {
    if (typeof tplId === 'string' && tplId) userOverrides.set(Number(ix), tplId)
  }

  // Load each picked template's field schema so we can compose field_values
  // matching the template's expected slot shape.
  const allPickedIds = [
    ...new Set<string>([...enginePicks.values(), ...userOverrides.values()]),
  ]
  const templateById = new Map<string, { id: string; fields: any }>()
  if (allPickedIds.length > 0) {
    const { data: tpls } = await sb.from('web_content_templates')
      .select('id, fields').in('id', allPickedIds)
    for (const t of (tpls ?? [])) templateById.set(t.id, t)
  }

  const sections = Array.isArray(draft.sections) ? draft.sections : []
  const rows = sections.map((s: any, ix: number) => {
    const pickedId = userOverrides.get(ix) ?? enginePicks.get(ix) ?? null
    const template = pickedId ? templateById.get(pickedId) : undefined
    const fieldValues = template
      ? composeFieldValuesForTemplate(s, template)
      : { body: renderSection(s) }
    return {
      web_page_id: pageId,
      content_template_id: pickedId,
      field_values: fieldValues,
      notes: buildSectionNotes(s, pickedId, userOverrides.has(ix)),
      sort_order: ix,
    }
  })

  if (rows.length > 0) {
    const { error: insertErr } = await sb.from('web_sections').insert(rows)
    if (insertErr) return res.status(500).json({ error: `Sections insert failed: ${insertErr.message}` })
  }

  return res.status(200).json({
    ok: true,
    page_id: pageId,
    page_slug: pageSlug,
    created,
    sections_inserted: rows.length,
  })
}

// ── Markdown rendering — one body string per section ────────────────

function renderSection(s: any): string {
  const archetype = String(s?.archetype ?? 'rich_body')
  const copy = (s?.copy ?? {}) as Record<string, any>
  const parts: string[] = []

  if (copy.eyebrow) parts.push(`> **${String(copy.eyebrow).toUpperCase()}**`)
  if (copy.heading) parts.push(headingByArchetype(archetype, String(copy.heading)))
  if (copy.tagline) parts.push(`_${String(copy.tagline)}_`)
  if (copy.description) parts.push(String(copy.description))
  if (copy.body) parts.push(String(copy.body))

  if (Array.isArray(copy.cards) && copy.cards.length > 0) {
    parts.push('')
    for (const c of copy.cards) {
      if (c?.heading) parts.push(`### ${c.heading}`)
      if (c?.description) parts.push(String(c.description))
      if (c?.cta_label) parts.push(`[${c.cta_label}](#)`)
    }
  }

  if (Array.isArray(copy.items) && copy.items.length > 0) {
    parts.push('')
    for (const it of copy.items) {
      if (it?.heading) parts.push(`### ${it.heading}`)
      if (it?.body) parts.push(String(it.body))
    }
  }

  if (copy.cta?.label) {
    const url = copy.cta?.intent ? `#${String(copy.cta.intent)}` : '#'
    parts.push(`\n[${String(copy.cta.label)}](${url})`)
  }

  return parts.filter(Boolean).join('\n\n')
}

function headingByArchetype(archetype: string, heading: string): string {
  if (archetype === 'hero' || archetype === 'tagline_band') return `# ${heading}`
  if (archetype === 'intro_paragraph' || archetype === 'rich_body') return `## ${heading}`
  return `## ${heading}`
}

function buildSectionNotes(s: any, pickedTemplateId?: string | null, isUserOverride?: boolean): string {
  const archetype = String(s?.archetype ?? '')
  const atomsUsed = Array.isArray(s?.atoms_used) ? s.atoms_used.length : 0
  const voiceNotes = s?.voice_notes ? String(s.voice_notes) : ''
  const lines = [
    `Archetype: ${archetype}`,
    pickedTemplateId
      ? (isUserOverride ? `Template: ${pickedTemplateId} (user pick)` : `Template: ${pickedTemplateId} (engine pick)`)
      : 'Template: freehand',
    atomsUsed > 0 ? `Atoms used: ${atomsUsed}` : '',
    voiceNotes ? `Voice: ${voiceNotes}` : '',
  ].filter(Boolean)
  return lines.join(' · ')
}

/** Deterministic best-effort field_values composition for a draft
 *  section bound to a specific Brixies template. Walks the template's
 *  field schema, matches each slot key against the section's copy
 *  shape (heading → heading, description → description, cards →
 *  cards[]), and falls back to dumping the rendered markdown into a
 *  `body` slot when nothing matches. Doesn't try to be clever about
 *  cross-shape mapping (e.g. splitting a description into cards) —
 *  that's what reorg-section-for-template handles when the strategist
 *  asks for an AI redistribution. */
function composeFieldValuesForTemplate(s: any, template: { fields: any }): Record<string, unknown> {
  const copy = (s?.copy ?? {}) as Record<string, any>
  const fields = Array.isArray(template?.fields) ? template.fields : []
  const out: Record<string, unknown> = {}

  // Build a lookup from each template field key to its kind. We use
  // this to route a copy value into the matching slot shape (string
  // value into a 'slot' field, array into a 'group' field).
  const fieldByKey = new Map<string, { key: string; kind: string; item_schema?: any[] }>()
  for (const f of fields) {
    if (f?.key) fieldByKey.set(String(f.key), {
      key: String(f.key),
      kind: String(f?.kind ?? 'slot'),
      item_schema: Array.isArray(f?.item_schema) ? f.item_schema : undefined,
    })
  }

  // Direct slot mapping — same-named keys land directly.
  const directKeys: Array<keyof typeof copy> = ['eyebrow', 'heading', 'tagline', 'description', 'body']
  for (const k of directKeys) {
    if (typeof copy[k] === 'string' && copy[k] && fieldByKey.has(String(k))) {
      out[String(k)] = copy[k]
    }
  }

  // CTA — Brixies CTA slots are typically a single text+url pair. We
  // store as { label, url } when the template has a 'cta' field; the
  // render pipeline knows to expand into the <a><button>.
  if (copy.cta?.label && fieldByKey.has('cta')) {
    out.cta = { label: String(copy.cta.label), url: copy.cta.intent ? `#${String(copy.cta.intent)}` : '#' }
  }

  // Group slots — cards / items. If the template has a 'cards' field
  // with kind='group', map copy.cards into it (with whatever item
  // schema the template declares). Same for items/steps/accordion.
  for (const groupKey of ['cards', 'items']) {
    const groupField = fieldByKey.get(groupKey)
    const sourceArr = Array.isArray(copy[groupKey]) ? copy[groupKey] : null
    if (!groupField || groupField.kind !== 'group' || !sourceArr) continue
    out[groupKey] = sourceArr.map((entry: any) => {
      const entryObj = (entry && typeof entry === 'object') ? entry : {}
      const item: Record<string, unknown> = {}
      // Pass through any keys the item_schema declares.
      const itemKeys = (groupField.item_schema ?? []).map((f: any) => String(f?.key ?? '')).filter(Boolean)
      for (const ik of itemKeys) {
        if (entryObj[ik] != null) item[ik] = entryObj[ik]
      }
      // Fallback heuristic — common cases:
      //   - heading + description came through
      //   - description fields sometimes named 'body' in the template
      if (entryObj.heading && itemKeys.includes('heading') && !item.heading) item.heading = entryObj.heading
      if (entryObj.description && itemKeys.includes('description') && !item.description) item.description = entryObj.description
      if (entryObj.body && itemKeys.includes('body') && !item.body) item.body = entryObj.body
      if (entryObj.cta_label && itemKeys.includes('cta')) item.cta = { label: entryObj.cta_label, url: '#' }
      return item
    })
  }

  // Always fall back to writing a body slot when the template has one
  // but we didn't fill it — the freehand markdown is a safety net so
  // nothing visible disappears post-bind.
  if (fieldByKey.has('body') && !out.body) {
    out.body = renderSection(s)
  }

  return out
}
