/**
 * Server-side page snapshot helper for Vercel serverless functions.
 *
 * Mirrors src/lib/webPageVersions.ts but uses a plain SupabaseClient
 * shape so the Vercel build doesn't pull in the browser bundle. Used
 * by agent endpoints (page-bind, atomize, autoBind, etc.) to capture
 * the page+sections state BEFORE the agent mutates — so the strategist
 * can revert from the version drawer if the agent run went sideways.
 *
 * Fire-and-forget by design: snapshot failure logs a warning but does
 * not block the agent's actual work. Worst case = no revert point
 * for one mutation, which is recoverable; better than failing the
 * whole agent because the version table had a hiccup.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface SnapshotInput {
  sb:            any  // SupabaseClient — typed loose so api/_lib doesn't need @supabase/supabase-js types
  webPageId:     string
  triggerKind:   'manual_save' | 'agent_run' | 'bind' | 'unbind' | 'revert'
  triggerLabel:  string
  createdBy?:    string | null
}

export async function snapshotPageVersion(input: SnapshotInput): Promise<string | null> {
  const { sb, webPageId, triggerKind, triggerLabel, createdBy } = input
  try {
    const [pageRes, sectionsRes] = await Promise.all([
      sb.from('web_pages').select('*').eq('id', webPageId).maybeSingle(),
      sb.from('web_sections').select('*').eq('web_page_id', webPageId).order('sort_order'),
    ])
    const page = pageRes?.data as { web_project_id?: string; id?: string } | null
    if (!page?.id || !page.web_project_id) {
      console.warn('[snapshotPageVersion] page not found or missing project_id', { webPageId })
      return null
    }
    const { data, error } = await sb
      .from('strategy_web_page_versions')
      .insert({
        web_page_id:    webPageId,
        web_project_id: page.web_project_id,
        trigger_kind:   triggerKind,
        trigger_label:  triggerLabel,
        created_by:     createdBy ?? null,
        page_snapshot:  page,
        sections_snapshot: sectionsRes?.data ?? [],
      })
      .select('id')
      .maybeSingle()
    if (error || !data) {
      console.warn('[snapshotPageVersion] insert failed', { webPageId, err: error?.message })
      return null
    }
    return (data as { id: string }).id
  } catch (err) {
    console.warn('[snapshotPageVersion] threw', { webPageId, err: (err as Error)?.message })
    return null
  }
}
