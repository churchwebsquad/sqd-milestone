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
 *  the page row and reconciles sections via a smart diff so FK cascade
 *  doesn't nuke reviewer notes on sections that survive the revert.
 *
 *  Section reconciliation (UPDATE > INSERT > DELETE, by id):
 *    • Sections present in BOTH snapshot and live → UPDATE in place.
 *      Row id is preserved → web_review_comments / web_review_edits /
 *      web_bind_telemetry that FK to the section's id stay intact.
 *    • Sections present in snapshot only → INSERT with the
 *      snapshotted id (and content). Restores sections that were
 *      removed AFTER the snapshot.
 *    • Sections present live only → DELETE. CASCADE wipes any
 *      reviewer notes attached to those sections, but those sections
 *      didn't exist at snapshot time so their notes didn't either —
 *      this is correct revert semantic.
 *
 *  The revert writes a fresh snapshot tagged with reverted_from_version
 *  so the revert itself is undo-able. Returns the new snapshot id. */
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

  // 1. Restore the page row.
  const strippedPage = stripManagedColumns({ ...page })
  const { error: pageUpdateErr } = await sb
    .from('web_pages')
    .update(strippedPage)
    .eq('id', page.id)
  if (pageUpdateErr) return { ok: false, error: `page restore failed: ${pageUpdateErr.message}` }

  // 2. Read current section ids for this page so we can diff.
  const { data: liveSections, error: liveErr } = await sb
    .from('web_sections')
    .select('id')
    .eq('web_page_id', page.id)
  if (liveErr) return { ok: false, error: `section diff failed: ${liveErr.message}` }
  const liveIds = new Set((liveSections ?? []).map(s => (s as { id: string }).id))
  const snapIds = new Set(sectionsSnap.map(s => s.id))

  const toUpdate = sectionsSnap.filter(s => liveIds.has(s.id))
  const toInsert = sectionsSnap.filter(s => !liveIds.has(s.id))
  const toDelete: string[] = []
  for (const id of liveIds) if (!snapIds.has(id)) toDelete.push(id)

  // 3a. UPDATE preserved sections in place (no FK cascade fires).
  for (const s of toUpdate) {
    const row = stripManagedColumns({ ...s })
    const { error } = await sb.from('web_sections').update(row).eq('id', s.id)
    if (error) return { ok: false, error: `section update failed (${s.id}): ${error.message}` }
  }
  // 3b. INSERT sections that were removed after the snapshot.
  if (toInsert.length > 0) {
    const rows = toInsert.map(s => stripManagedColumns({ ...s }))
    const { error } = await sb.from('web_sections').insert(rows)
    if (error) return { ok: false, error: `section restore-insert failed: ${error.message}` }
  }
  // 3c. DELETE sections that were added after the snapshot. CASCADE
  //     is acceptable here — those sections + their reviewer notes
  //     post-date the snapshot, so removing them is consistent with
  //     "revert to this point."
  if (toDelete.length > 0) {
    const { error } = await sb.from('web_sections').delete().in('id', toDelete)
    if (error) return { ok: false, error: `section delete failed: ${error.message}` }
  }

  // 4. Write a fresh snapshot recording the revert.
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
