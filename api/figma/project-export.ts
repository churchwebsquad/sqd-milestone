/**
 * Vercel Serverless Function — /api/figma/project-export
 *
 * Read-only payload the Squad Figma plugin fetches to drive its
 * style-guide + pages assembly commands. Wave 1 returns:
 *
 *   - project: { id, name, church_short_name }
 *   - templates: deduped list of every web_content_template referenced
 *     by any non-archived web_section on this project that has a
 *     figma_component_key set. Each entry carries id, layer_name,
 *     family, and figma_component_key — the plugin imports each via
 *     figma.importComponentByKeyAsync / importComponentSetByKeyAsync.
 *
 * Auth: per-project bearer token (strategy_web_projects.figma_share_token)
 *   sent as Authorization: Bearer <token>. Staff generates the token
 *   from Dev Handoff and pastes it into the plugin's settings. No
 *   Supabase JWT involved — the token IS the auth.
 *
 *   Validation: project_id + token must match a non-archived row.
 *   Mismatched / NULL tokens return 401.
 *
 * No write paths in this endpoint. Plugin writes flow back through
 * separate endpoints (Wave 3+).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'

export const maxDuration = 30

// CORS: Figma plugins run in https://www.figma.com — they fetch our
// API from that origin. Wide-open CORS is safe here because the
// endpoint requires the per-project bearer token to return anything.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

export default async function handler(req: any, res: any) {
  // Preflight
  if (req.method === 'OPTIONS') {
    for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v)
    return res.status(204).end()
  }
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v)

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({ error: 'supabase_env_missing' })
  }

  const projectId = typeof req.body?.project_id === 'string' ? req.body.project_id : null
  const token = (req.headers['authorization'] as string | undefined)?.replace(/^Bearer\s+/i, '')?.trim() ?? null
  if (!projectId) return res.status(400).json({ error: 'project_id required' })
  if (!token)     return res.status(401).json({ error: 'missing_bearer_token' })

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  // Validate token against the project row. Service-role bypasses RLS;
  // the token equality is our gate.
  const { data: project, error: projErr } = await sb
    .from('strategy_web_projects')
    .select('id, name, church_short_name, figma_share_token, archived, figma_layout_swaps')
    .eq('id', projectId)
    .maybeSingle()
  if (projErr) return res.status(500).json({ error: 'project_load_failed', details: projErr.message })
  if (!project) return res.status(404).json({ error: 'project_not_found' })
  if ((project as { archived: boolean }).archived) {
    return res.status(404).json({ error: 'project_archived' })
  }
  const expected = (project as { figma_share_token: string | null }).figma_share_token
  if (!expected || expected !== token) {
    return res.status(401).json({ error: 'invalid_token' })
  }

  // Templates used by the project = distinct EFFECTIVE template ids
  // across the project's non-archived web_sections. The "effective"
  // template is the resolver chain:
  //   section.figma_template_override_id   (per-section override)
  //     ?? project.figma_layout_swaps[wireframe_template_id]?.to_template_id  (site-wide swap)
  //     ?? wireframe_template_id            (original lo-fi choice)
  // Mirrors the client-side resolver in src/lib/webFigmaLayoutSwap.ts.
  // Without this, the Figma plugin would always assemble a style guide
  // for the WIREFRAME templates, ignoring the designer's swaps.
  const { data: sectionRows, error: sectionsErr } = await sb
    .from('web_sections')
    .select('content_template_id, figma_template_override_id, web_pages!inner(web_project_id, archived)')
    .eq('web_pages.web_project_id', projectId)
    .eq('web_pages.archived', false)
    .not('content_template_id', 'is', null)
  if (sectionsErr) return res.status(500).json({ error: 'sections_load_failed', details: sectionsErr.message })

  type FigmaSwapEntry = { to_template_id: string | null }
  const swapMap = ((project as { figma_layout_swaps: Record<string, FigmaSwapEntry> | null }).figma_layout_swaps ?? {}) as Record<string, FigmaSwapEntry>

  const resolveEffective = (wireframeId: string | null, overrideId: string | null): string | null => {
    if (overrideId) return overrideId
    if (wireframeId && swapMap[wireframeId]?.to_template_id) return swapMap[wireframeId].to_template_id
    return wireframeId
  }

  const effectiveIds = new Set<string>()
  const wireframeIds = new Set<string>()
  for (const row of (sectionRows ?? []) as Array<{ content_template_id: string | null; figma_template_override_id: string | null }>) {
    if (row.content_template_id) wireframeIds.add(row.content_template_id)
    const eff = resolveEffective(row.content_template_id, row.figma_template_override_id)
    if (eff) effectiveIds.add(eff)
  }

  // Load the catalog rows for every id we mention (effective + wireframe)
  // so we can return both the assembled style-guide list AND a
  // wireframe→effective mapping the plugin can surface as "originally
  // wireframed as X" hints.
  const allIds = Array.from(new Set([...effectiveIds, ...wireframeIds]))
  let catalog: Array<{ id: string; layer_name: string; family: string; figma_component_key: string | null }> = []
  if (allIds.length > 0) {
    const { data: tpls, error: tplErr } = await sb
      .from('web_content_templates')
      .select('id, layer_name, family, figma_component_key')
      .in('id', allIds)
    if (tplErr) return res.status(500).json({ error: 'templates_load_failed', details: tplErr.message })
    catalog = (tpls ?? []) as typeof catalog
  }
  const catalogById = new Map(catalog.map(t => [t.id, t]))

  // The plugin assembles components from the EFFECTIVE list. Filter to
  // templates that have a figma_component_key set — the plugin can't
  // import without one.
  const templates = Array.from(effectiveIds)
    .map(id => catalogById.get(id))
    .filter((t): t is typeof catalog[number] => !!t && !!t.figma_component_key)

  // Hand the plugin a swap map keyed by wireframe id so it can show
  // "this slot was wireframed as X but the designer swapped to Y".
  // Cross-family swaps are explicit; same-family swaps are still
  // included (designer may have chosen a different style within family).
  // NOTE: this only surfaces project-level (site-wide) swaps. Per-section
  // overrides (web_sections.figma_template_override_id) ALREADY influence
  // the `templates` effective list, but their context isn't summarized
  // here — Wave 2's per-page section payload will surface per-section
  // override info alongside the section it belongs to.
  const swapsForPlugin: Record<string, { from: { template_id: string; layer_name: string | null; family: string | null }; to: { template_id: string; layer_name: string | null; family: string | null } }> = {}
  for (const fromId of wireframeIds) {
    const toId = resolveEffective(fromId, null) // project-level only; section-level overrides are surfaced per-section in Wave 2
    if (!toId || toId === fromId) continue
    const fromT = catalogById.get(fromId)
    const toT = catalogById.get(toId)
    if (!fromT || !toT) continue
    swapsForPlugin[fromId] = {
      from: { template_id: fromT.id, layer_name: fromT.layer_name, family: fromT.family },
      to:   { template_id: toT.id,   layer_name: toT.layer_name,   family: toT.family },
    }
  }

  return res.status(200).json({
    ok: true,
    project: {
      id:                project.id,
      name:              (project as { name: string }).name,
      church_short_name: (project as { church_short_name?: string | null }).church_short_name ?? null,
    },
    templates: templates.map(t => ({
      template_id:         t.id,
      layer_name:          t.layer_name,
      family:              t.family,
      figma_component_key: t.figma_component_key as string,
    })),
    // Site-wide layout swaps the designer recorded. Keyed by wireframe
    // template id → { from, to } catalog refs. Plugin can surface this
    // as a "Layout swaps applied" summary on the style guide.
    layout_swaps: swapsForPlugin,
    // Wave 2 will add a
    // pages: [{ slug, name, sections: [{ template_id, field_values }] }]
    // payload that includes each section's effective template id +
    // override info for per-section assembly.
  })
}
