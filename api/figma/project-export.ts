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
    .select('id, name, church_short_name, figma_share_token, archived')
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

  // Templates used by the project = distinct content_template_id across
  // all this project's non-archived web_sections, joined with the
  // catalog. Only return templates that have a figma_component_key
  // set — the plugin can't import without one.
  const { data: sectionRows, error: sectionsErr } = await sb
    .from('web_sections')
    .select('content_template_id, web_pages!inner(web_project_id, archived)')
    .eq('web_pages.web_project_id', projectId)
    .eq('web_pages.archived', false)
    .not('content_template_id', 'is', null)
  if (sectionsErr) return res.status(500).json({ error: 'sections_load_failed', details: sectionsErr.message })

  const templateIds = Array.from(new Set(
    (sectionRows ?? [])
      .map((r: { content_template_id: string | null }) => r.content_template_id)
      .filter((id): id is string => !!id),
  ))

  let templates: Array<{ id: string; layer_name: string; family: string; figma_component_key: string | null }> = []
  if (templateIds.length > 0) {
    const { data: tpls, error: tplErr } = await sb
      .from('web_content_templates')
      .select('id, layer_name, family, figma_component_key')
      .in('id', templateIds)
    if (tplErr) return res.status(500).json({ error: 'templates_load_failed', details: tplErr.message })
    templates = ((tpls ?? []) as typeof templates)
      .filter(t => !!t.figma_component_key)
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
    // Wave 1 doesn't need pages/sections yet. Wave 2 will add a
    // pages: [{ slug, name, sections: [{ template_id, field_values }] }]
    // payload so the assemble-pages command can populate text.
  })
}
