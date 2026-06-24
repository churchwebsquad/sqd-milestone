/**
 * Page version history — snapshot helper + revert.
 *
 * One row per "save point" in strategy_web_page_versions, capturing
 * the page row + every section row at that moment. Use cases:
 *   - Manual save → snapshot first, then apply the edit
 *   - Agent run (atomize / page-bind / autoBind / copy-suggest) →
 *     snapshot before the agent mutates, with a descriptive label
 *   - Revert → restore page + sections from a snapshot AND write a
 *     fresh snapshot with reverted_from_version set, so the revert
 *     itself is part of the history (and reversible).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { WebPageVersion } from '../types/database'

export type SnapshotTrigger =
  | 'manual_save'
  | 'agent_run'
  | 'bind'
  | 'unbind'
  | 'revert'

interface SnapshotOptions {
  triggerKind:  SnapshotTrigger
  triggerLabel: string
  createdBy?:   string | null
  /** Set when this snapshot is being written as part of a revert flow. */
  revertedFromVersion?: string | null
}

/** Capture a snapshot of a page + all its sections at the current
 *  moment. Idempotent in the sense that every call writes one new
 *  row — the caller decides when to snapshot. Returns the new version
 *  id (or null when the page doesn't exist or the write fails). */
export async function snapshotPageVersion(
  sb: SupabaseClient,
  webPageId: string,
  opts: SnapshotOptions,
): Promise<string | null> {
  // Pull page + sections in parallel.
  const [{ data: page, error: pageErr }, { data: sections, error: sectionsErr }] = await Promise.all([
    sb.from('web_pages').select('*').eq('id', webPageId).maybeSingle(),
    sb.from('web_sections').select('*').eq('web_page_id', webPageId).order('sort_order'),
  ])
  if (pageErr || !page) {
    console.warn('[snapshotPageVersion] page not found or load failed', { webPageId, err: pageErr?.message })
    return null
  }
  if (sectionsErr) {
    console.warn('[snapshotPageVersion] sections load failed', { webPageId, err: sectionsErr.message })
    return null
  }
  const projectId = (page as { web_project_id?: string }).web_project_id
  if (!projectId) {
    console.warn('[snapshotPageVersion] page has no web_project_id', { webPageId })
    return null
  }
  const { data, error } = await sb
    .from('strategy_web_page_versions')
    .insert({
      web_page_id:           webPageId,
      web_project_id:        projectId,
      trigger_kind:          opts.triggerKind,
      trigger_label:         opts.triggerLabel,
      created_by:            opts.createdBy ?? null,
      reverted_from_version: opts.revertedFromVersion ?? null,
      page_snapshot:         page,
      sections_snapshot:     sections ?? [],
    })
    .select('id')
    .maybeSingle()
  if (error || !data) {
    console.warn('[snapshotPageVersion] insert failed', { webPageId, err: error?.message })
    return null
  }
  return (data as { id: string }).id
}

/** List a page's version history newest-first. UI calls this for the
 *  version drawer. */
export async function listPageVersions(
  sb: SupabaseClient,
  webPageId: string,
  limit = 100,
): Promise<WebPageVersion[]> {
  const { data } = await sb
    .from('strategy_web_page_versions')
    .select('*')
    .eq('web_page_id', webPageId)
    .order('created_at', { ascending: false })
    .limit(limit)
  return (data ?? []) as WebPageVersion[]
}

/** Revert a page to the state captured in a prior version. Restores
 *  the page row and replaces every section row with the snapshotted
 *  set. Writes a fresh snapshot recording the revert (so the revert
 *  itself is a save point — undo-able). Returns the new snapshot's id.
 *
 *  Section restore strategy: delete current sections, re-insert from
 *  snapshot with the original ids preserved. This keeps downstream
 *  references (web_review_comments.web_section_id, telemetry, etc.)
 *  resolvable when the snapshotted section is restored. New sections
 *  that the user added AFTER the snapshot are dropped — that's the
 *  semantic of "revert to this point." */
export async function revertPageToVersion(
  sb: SupabaseClient,
  versionId: string,
  createdBy?: string | null,
): Promise<{ ok: boolean; new_version_id?: string; error?: string }> {
  const { data: ver, error: verErr } = await sb
    .from('strategy_web_page_versions')
    .select('*')
    .eq('id', versionId)
    .maybeSingle()
  if (verErr || !ver) return { ok: false, error: verErr?.message ?? 'version not found' }
  const version = ver as WebPageVersion
  const page = version.page_snapshot as { id: string; [k: string]: unknown }
  const sectionsSnap = (version.sections_snapshot ?? []) as Array<{ id: string; [k: string]: unknown }>

  // Strip identity + lifecycle columns the database manages itself
  // so the update doesn't try to overwrite serial timestamps.
  const stripped = stripManagedColumns({ ...page })
  const { error: pageUpdateErr } = await sb
    .from('web_pages')
    .update(stripped)
    .eq('id', page.id)
  if (pageUpdateErr) return { ok: false, error: `page restore failed: ${pageUpdateErr.message}` }

  // Wipe the page's current sections + restore from the snapshot.
  const { error: delErr } = await sb.from('web_sections').delete().eq('web_page_id', page.id)
  if (delErr) return { ok: false, error: `section wipe failed: ${delErr.message}` }
  if (sectionsSnap.length > 0) {
    const rows = sectionsSnap.map(s => stripManagedColumns({ ...s }))
    const { error: insErr } = await sb.from('web_sections').insert(rows)
    if (insErr) return { ok: false, error: `section restore failed: ${insErr.message}` }
  }

  // Write a fresh snapshot recording the revert.
  const dateLabel = version.created_at?.slice(0, 10) ?? ''
  const newVersionId = await snapshotPageVersion(sb, page.id, {
    triggerKind:  'revert',
    triggerLabel: `Reverted to version of ${dateLabel || 'earlier today'}`,
    createdBy,
    revertedFromVersion: version.id,
  })
  return { ok: true, new_version_id: newVersionId ?? undefined }
}

/** Strip database-managed columns so a snapshot row can be written
 *  back to the live table without conflicting with auto-managed
 *  timestamps. `updated_at` is owned by the set_updated_at triggers;
 *  `created_at` is set on initial insert; we DO carry `id` because
 *  preserving section ids across reverts keeps downstream FKs valid. */
function stripManagedColumns<T extends Record<string, unknown>>(row: T): T {
  const { updated_at: _u, ...rest } = row as Record<string, unknown>
  return rest as T
}
