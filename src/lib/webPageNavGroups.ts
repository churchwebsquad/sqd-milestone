/**
 * Helpers for the page-nav-group surface in the Pages workspace.
 *
 * The "nav group" is a per-page text label that mirrors the dropdown
 * groupings from the strategist's site_strategy.nav output. Staff can
 * rename groups, reorder them, and reassign pages between them after
 * the initial backfill.
 *
 * Storage shape (per web_pages row):
 *   - nav_group_label      : text     — group display name; NULL = ungrouped
 *   - nav_group_sort_order : integer  — sort key for the group itself;
 *                                       same value on every page in the group
 *
 * Pages within a group continue to use sort_order. Reordering groups
 * never touches sort_order; reordering pages within a group never
 * touches nav_group_sort_order. The two axes are orthogonal.
 */
import { supabase } from './supabase'
import type { WebPage } from '../types/database'

/** A group is computed from the pages in it. Empty groups don't exist
 *  in this model — to add a group, you assign a label to at least one
 *  page (or create a placeholder page in the group). */
export interface NavGroup {
  /** NULL label = the ungrouped bucket (rendered as "Ungrouped"). */
  label:     string | null
  sortOrder: number
  pages:     WebPage[]
}

/** Bucket pages into nav groups, sorted by:
 *  - group sort order (ungrouped sinks to the bottom)
 *  - then page sort_order within each group
 *
 * NOT memoized — call inside useMemo if you need stability. */
export function groupPagesByNav(pages: WebPage[]): NavGroup[] {
  const buckets = new Map<string, NavGroup>()
  // Key is "label||sortOrder" so we don't merge two groups that
  // accidentally share a label across projects (defensive — within a
  // single project we don't expect this).
  for (const p of pages) {
    const label  = p.nav_group_label ?? null
    const sortOrder = label === null
      ? Number.MAX_SAFE_INTEGER
      : (typeof p.nav_group_sort_order === 'number' ? p.nav_group_sort_order : Number.MAX_SAFE_INTEGER - 1)
    const key = `${label ?? '__null__'}||${sortOrder}`
    let group = buckets.get(key)
    if (!group) {
      group = { label, sortOrder, pages: [] }
      buckets.set(key, group)
    }
    group.pages.push(p)
  }
  const groups = [...buckets.values()]
  // Stable order: nav_group_sort_order asc, then label asc as a tie-break.
  groups.sort((a, b) =>
    a.sortOrder !== b.sortOrder
      ? a.sortOrder - b.sortOrder
      : (a.label ?? '').localeCompare(b.label ?? ''),
  )
  // Within each group, sort by sort_order asc.
  for (const g of groups) g.pages.sort((a, b) => a.sort_order - b.sort_order)
  return groups
}

/** Rename every page belonging to `oldLabel` so they share `newLabel`.
 *  Idempotent — if no pages match, the update is a no-op. */
export async function renameNavGroup(
  webProjectId: string,
  oldLabel: string,
  newLabel: string,
): Promise<{ ok: true; affected: number } | { ok: false; error: string }> {
  const trimmed = newLabel.trim()
  if (!trimmed) return { ok: false, error: 'Group name cannot be empty.' }
  if (trimmed === oldLabel)  return { ok: true, affected: 0 }
  const { data, error } = await supabase
    .from('web_pages')
    .update({ nav_group_label: trimmed } as never)
    .eq('web_project_id', webProjectId)
    .eq('nav_group_label', oldLabel)
    .select('id')
  if (error) return { ok: false, error: error.message }
  return { ok: true, affected: data?.length ?? 0 }
}

/** Move a group up or down relative to its neighbors by swapping
 *  nav_group_sort_order with the adjacent group's. We don't touch
 *  sort_order — page ordering within each group is preserved.
 *
 *  No-op when the group is already at the top (direction=-1) or
 *  bottom (direction=+1). The ungrouped bucket is never moved. */
export async function moveNavGroup(
  webProjectId: string,
  label: string,
  direction: -1 | 1,
  allGroups: NavGroup[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Filter out the ungrouped bucket from neighbor-finding.
  const sortedReal = allGroups.filter(g => g.label !== null)
  const idx = sortedReal.findIndex(g => g.label === label)
  if (idx < 0)                                return { ok: false, error: `Group "${label}" not found.` }
  const targetIdx = idx + direction
  if (targetIdx < 0 || targetIdx >= sortedReal.length) return { ok: true } // boundary no-op
  const a = sortedReal[idx]
  const b = sortedReal[targetIdx]

  // Swap sort orders. Two updates — kept sequential because both
  // touch web_pages rows in the same project and we want both writes
  // to land regardless of partial failure (RLS / network).
  const { error: e1 } = await supabase
    .from('web_pages')
    .update({ nav_group_sort_order: b.sortOrder } as never)
    .eq('web_project_id', webProjectId)
    .eq('nav_group_label', a.label)
  if (e1) return { ok: false, error: e1.message }
  const { error: e2 } = await supabase
    .from('web_pages')
    .update({ nav_group_sort_order: a.sortOrder } as never)
    .eq('web_project_id', webProjectId)
    .eq('nav_group_label', b.label)
  if (e2) return { ok: false, error: e2.message }
  return { ok: true }
}

/** Reassign a single page to a new group. Sets BOTH the label and the
 *  sort order to match the destination group's existing sort order
 *  (so the page inherits the group's position). Passing newLabel=null
 *  ungroups the page. */
export async function assignPageToNavGroup(
  page: Pick<WebPage, 'id' | 'web_project_id'>,
  newLabel: string | null,
  /** Optional — when the new label is a brand-new group not yet in
   *  use, the caller passes the sort order to use (typically max+100).
   *  When omitted and the label already exists on another page, we
   *  copy its sort order. */
  newSortOrder?: number | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let sortOrder = newSortOrder ?? null
  if (newLabel !== null && sortOrder === null) {
    // Look up the group's existing sort order. If no other page uses
    // this label, place the group at the end of the list.
    const { data: existingMate } = await supabase
      .from('web_pages')
      .select('nav_group_sort_order')
      .eq('web_project_id', page.web_project_id)
      .eq('nav_group_label', newLabel)
      .not('nav_group_sort_order', 'is', null)
      .limit(1)
      .maybeSingle()
    if (existingMate) {
      sortOrder = (existingMate as { nav_group_sort_order: number | null }).nav_group_sort_order ?? null
    }
    if (sortOrder === null) {
      const { data: maxRow } = await supabase
        .from('web_pages')
        .select('nav_group_sort_order')
        .eq('web_project_id', page.web_project_id)
        .not('nav_group_sort_order', 'is', null)
        .order('nav_group_sort_order', { ascending: false })
        .limit(1)
        .maybeSingle()
      const currentMax = (maxRow as { nav_group_sort_order: number | null } | null)?.nav_group_sort_order ?? 0
      sortOrder = currentMax + 100
    }
  }

  const { error } = await supabase
    .from('web_pages')
    .update({
      nav_group_label:      newLabel,
      nav_group_sort_order: newLabel === null ? null : sortOrder,
    } as never)
    .eq('id', page.id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
