/**
 * Web Manager — Sitemap helpers.
 *
 * Commits a Stage 2 sitemap proposal (stored in `roadmap_state.stage_2`)
 * to real `web_pages` records that downstream surfaces (Pages workspace,
 * Voice heuristics, copy review) can consume. Marks the proposal as
 * committed in `roadmap_state.stage_2._meta.committed_at` so the UI can
 * tell approved-and-built apart from proposal-only.
 */

import { supabase } from './supabase'

export interface SitemapCommitResult {
  ok: true
  created: number
  skipped: number   // pages whose slug already existed on this project
}

export interface SitemapCommitError {
  error: string
}

interface ProposedPage {
  name: string
  slug: string
  nav_label?: string
  phase?: '1' | '2' | 'nav-only' | 'global' | string
  parent_slug?: string | null
  page_type?: string
  strategic_purpose?: string
  rationale?: string
}

/**
 * Reads `roadmap_state.stage_2.pages` and inserts a `web_pages` row for
 * every proposed page whose slug doesn't already exist on this project.
 * Idempotent — safe to re-run.
 */
export async function commitSitemapToPages(
  webProjectId: string,
): Promise<{ result?: SitemapCommitResult; error?: SitemapCommitError }> {
  // Read current project state
  const { data: project, error: projErr } = await supabase
    .from('strategy_web_projects')
    .select('id, roadmap_state')
    .eq('id', webProjectId)
    .maybeSingle()

  if (projErr || !project) return { error: { error: projErr?.message ?? 'Project not found' } }

  const roadmapState = (project as { roadmap_state?: unknown }).roadmap_state as
    | { stage_2?: { pages?: ProposedPage[]; _meta?: Record<string, unknown> }; [k: string]: unknown }
    | null
  const stage2 = roadmapState?.stage_2
  const pages = stage2?.pages
  if (!Array.isArray(pages) || pages.length === 0) {
    return { error: { error: 'No proposed pages found in roadmap_state.stage_2.' } }
  }

  // Load existing slugs so we skip duplicates
  const { data: existing } = await supabase
    .from('web_pages')
    .select('slug')
    .eq('web_project_id', webProjectId)
    .eq('archived', false)
  const takenSlugs = new Set((existing ?? []).map(r => (r as { slug: string }).slug))

  // Map proposal phase to web_pages.phase. Anything outside the enum maps to '1'.
  const phaseFor = (p: ProposedPage): string => {
    const allowed = new Set(['global', '1', '2', 'nav-only'])
    return allowed.has(p.phase ?? '') ? (p.phase as string) : '1'
  }

  const toInsert = pages
    .filter(p => p.slug && !takenSlugs.has(p.slug))
    .map((p, i) => ({
      web_project_id: webProjectId,
      name: p.name,
      slug: p.slug,
      phase: phaseFor(p),
      sort_order: i,
    }))

  if (toInsert.length > 0) {
    const { error: insertErr } = await supabase.from('web_pages').insert(toInsert)
    if (insertErr) return { error: { error: insertErr.message } }
  }

  // Mark committed
  const newStage2 = {
    ...stage2,
    _meta: {
      ...(stage2._meta ?? {}),
      committed_at: new Date().toISOString(),
    },
  }
  const { error: updateErr } = await supabase
    .from('strategy_web_projects')
    .update({
      roadmap_state: { ...(roadmapState ?? {}), stage_2: newStage2 },
    })
    .eq('id', webProjectId)

  if (updateErr) return { error: { error: updateErr.message } }

  return {
    result: {
      ok: true,
      created: toInsert.length,
      skipped: pages.length - toInsert.length,
    },
  }
}
