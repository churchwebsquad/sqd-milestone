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

  // Replace existing sections — freehand only. Template-bound sections
  // (content_template_id IS NOT NULL) get preserved across bind re-runs
  // because the strategist may have manually upgraded them.
  await sb.from('web_sections').delete().eq('web_page_id', pageId).is('content_template_id', null)

  const sections = Array.isArray(draft.sections) ? draft.sections : []
  const rows = sections.map((s: any, ix: number) => ({
    web_page_id: pageId,
    content_template_id: null,
    field_values: { body: renderSection(s) },
    notes: buildSectionNotes(s),
    sort_order: ix,
  }))

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

function buildSectionNotes(s: any): string {
  const archetype = String(s?.archetype ?? '')
  const atomsUsed = Array.isArray(s?.atoms_used) ? s.atoms_used.length : 0
  const voiceNotes = s?.voice_notes ? String(s.voice_notes) : ''
  const lines = [
    `Archetype: ${archetype}`,
    atomsUsed > 0 ? `Atoms used: ${atomsUsed}` : '',
    voiceNotes ? `Voice: ${voiceNotes}` : '',
  ].filter(Boolean)
  return lines.join(' · ')
}
