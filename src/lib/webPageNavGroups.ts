/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Helpers for the page-nav-group surface in the Pages workspace.
 *
 * The "nav group" is a per-page text label that mirrors the dropdown
 * groupings from the strategist's site_strategy.nav output. Staff can
 * rename groups, reorder them, reassign pages between them, and add
 * new (possibly empty) groups after the initial backfill.
 *
 * Storage shapes:
 *   - web_pages.nav_group_label              text     — group display name; NULL = ungrouped
 *   - web_pages.nav_group_sort_order         integer  — sort key for the group itself;
 *                                                       same value on every page in the group
 *   - strategy_web_projects.nav_group_definitions jsonb — registry of known groups
 *                                                       (v112). Lets empty groups persist
 *                                                       across reloads.
 *
 * Pages within a group continue to use sort_order. Reordering groups
 * never touches sort_order; reordering pages within a group never
 * touches nav_group_sort_order. The two axes are orthogonal.
 */
import { supabase } from './supabase'
import type { WebPage } from '../types/database'

/** Single entry in strategy_web_projects.nav_group_definitions. */
export interface NavGroupDefinition {
  label:      string
  sort_order: number
}

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
 *  When `definitions` is provided, empty groups (definitions present in
 *  the registry but with no matching page rows) are merged in so the
 *  side panel can render them too.
 *
 *  NOT memoized — call inside useMemo if you need stability. */
export function groupPagesByNav(
  pages: WebPage[],
  definitions: NavGroupDefinition[] = [],
): NavGroup[] {
  const byLabel = new Map<string, NavGroup>()

  // Pages first — they're the source of truth for whether a group is
  // populated. nav_group_sort_order on the row wins over the
  // definitions[] entry's sort_order in case they ever drift.
  for (const p of pages) {
    const label  = p.nav_group_label ?? null
    const sortOrder = label === null
      ? Number.MAX_SAFE_INTEGER
      : (typeof p.nav_group_sort_order === 'number' ? p.nav_group_sort_order : Number.MAX_SAFE_INTEGER - 1)
    const key = label ?? '__null__'
    let group = byLabel.get(key)
    if (!group) {
      group = { label, sortOrder, pages: [] }
      byLabel.set(key, group)
    }
    group.pages.push(p)
  }

  // Merge in registry definitions for groups that aren't represented
  // by any page yet (empty groups). Skip ones already present from
  // the page pass.
  for (const def of definitions) {
    if (!def?.label) continue
    if (byLabel.has(def.label)) continue
    byLabel.set(def.label, {
      label:     def.label,
      sortOrder: typeof def.sort_order === 'number' ? def.sort_order : Number.MAX_SAFE_INTEGER - 1,
      pages:     [],
    })
  }

  const groups = [...byLabel.values()]
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

/** Append a new group definition to the project's registry. The group
 *  starts empty (no pages assigned). sort_order defaults to max-existing
 *  plus 100 so the new group lands at the bottom of the list.
 *
 *  Refuses to create a duplicate label — returns ok:false in that case. */
export async function addNavGroup(
  webProjectId: string,
  label: string,
  /** Optional explicit sort order. When omitted, computed as
   *  max(existing.sort_order) + 100. */
  sortOrderOverride?: number,
): Promise<{ ok: true; sort_order: number } | { ok: false; error: string }> {
  const trimmed = label.trim()
  if (!trimmed) return { ok: false, error: 'Group name cannot be empty.' }

  const { data: row, error: readErr } = await supabase
    .from('strategy_web_projects')
    .select('nav_group_definitions')
    .eq('id', webProjectId)
    .maybeSingle()
  if (readErr) return { ok: false, error: readErr.message }
  const current = ((row as { nav_group_definitions?: NavGroupDefinition[] } | null)?.nav_group_definitions ?? []) as NavGroupDefinition[]
  if (current.some(g => g.label === trimmed)) {
    return { ok: false, error: `A group named "${trimmed}" already exists.` }
  }

  const newSort = typeof sortOrderOverride === 'number'
    ? sortOrderOverride
    : (current.reduce((mx, g) => Math.max(mx, g.sort_order ?? 0), 0) + 100)

  const next = [...current, { label: trimmed, sort_order: newSort }]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

  const { error: writeErr } = await supabase
    .from('strategy_web_projects')
    .update({ nav_group_definitions: next } as never)
    .eq('id', webProjectId)
  if (writeErr) return { ok: false, error: writeErr.message }
  return { ok: true, sort_order: newSort }
}

/** Update the project's nav_group_definitions array in place — applies
 *  a labels-old→new map and/or sort_order changes. Used by rename and
 *  move helpers to keep the registry consistent with web_pages. */
async function updateNavGroupDefinitions(
  webProjectId: string,
  patch: (defs: NavGroupDefinition[]) => NavGroupDefinition[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: row, error: readErr } = await supabase
    .from('strategy_web_projects')
    .select('nav_group_definitions')
    .eq('id', webProjectId)
    .maybeSingle()
  if (readErr) return { ok: false, error: readErr.message }
  const current = ((row as { nav_group_definitions?: NavGroupDefinition[] } | null)?.nav_group_definitions ?? []) as NavGroupDefinition[]
  const next = patch(current).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  const { error: writeErr } = await supabase
    .from('strategy_web_projects')
    .update({ nav_group_definitions: next } as never)
    .eq('id', webProjectId)
  if (writeErr) return { ok: false, error: writeErr.message }
  return { ok: true }
}

/** Rename every page belonging to `oldLabel` so they share `newLabel`,
 *  AND update the project's definitions registry so the rename
 *  persists for empty groups too. Idempotent — if neither pages nor
 *  the definitions row reference oldLabel, the update is a no-op. */
export async function renameNavGroup(
  webProjectId: string,
  oldLabel: string,
  newLabel: string,
): Promise<{ ok: true; affected: number } | { ok: false; error: string }> {
  const trimmed = newLabel.trim()
  if (!trimmed) return { ok: false, error: 'Group name cannot be empty.' }
  if (trimmed === oldLabel)  return { ok: true, affected: 0 }

  // Page rows first — preserves the "source of truth" semantics. The
  // registry catches up next.
  const { data, error } = await supabase
    .from('web_pages')
    .update({ nav_group_label: trimmed } as never)
    .eq('web_project_id', webProjectId)
    .eq('nav_group_label', oldLabel)
    .select('id')
  if (error) return { ok: false, error: error.message }

  // Mirror the rename in nav_group_definitions. If a definition with
  // the new label already exists (collision via merge), drop the old
  // entry — the merged group inherits the existing sort_order.
  const sync = await updateNavGroupDefinitions(webProjectId, defs => {
    const hasOld = defs.some(g => g.label === oldLabel)
    const hasNew = defs.some(g => g.label === trimmed)
    if (!hasOld) return defs
    if (hasNew) {
      // Merge: just remove the old entry; the new label's existing
      // entry already governs sort_order.
      return defs.filter(g => g.label !== oldLabel)
    }
    return defs.map(g => g.label === oldLabel ? { ...g, label: trimmed } : g)
  })
  if (!sync.ok) return { ok: false, error: sync.error }

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
    .eq('nav_group_label', a.label ?? '')
  if (e1) return { ok: false, error: e1.message }
  const { error: e2 } = await supabase
    .from('web_pages')
    .update({ nav_group_sort_order: a.sortOrder } as never)
    .eq('web_project_id', webProjectId)
    .eq('nav_group_label', b.label ?? '')
  if (e2) return { ok: false, error: e2.message }

  // Mirror the swap in nav_group_definitions so the registry order
  // matches the pages' order — important for empty groups in the
  // middle of the list.
  const sync = await updateNavGroupDefinitions(webProjectId, defs => {
    return defs.map(g => {
      if (g.label === a.label) return { ...g, sort_order: b.sortOrder }
      if (g.label === b.label) return { ...g, sort_order: a.sortOrder }
      return g
    })
  })
  if (!sync.ok) return { ok: false, error: sync.error }

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
    // Look up the group's existing sort order. Three places to check
    // (in order of authority):
    //   1. An existing page that already has this label — that's the
    //      lived sort order on web_pages.
    //   2. The project's nav_group_definitions registry — covers the
    //      "empty group created via Add group, now adopting its first
    //      page" case.
    //   3. Fallback: max-existing + 100.
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
      const { data: projRow } = await supabase
        .from('strategy_web_projects')
        .select('nav_group_definitions')
        .eq('id', page.web_project_id)
        .maybeSingle()
      const defs = ((projRow as { nav_group_definitions?: NavGroupDefinition[] } | null)?.nav_group_definitions ?? []) as NavGroupDefinition[]
      const match = defs.find(g => g.label === newLabel)
      if (match) sortOrder = match.sort_order
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

  // Mirror the new label in the project's definitions registry if it
  // isn't there yet (covers "+ New group… via the page picker" so
  // future renders show the group consistently).
  if (newLabel !== null && sortOrder !== null) {
    await updateNavGroupDefinitions(page.web_project_id, defs => {
      if (defs.some(g => g.label === newLabel)) return defs
      return [...defs, { label: newLabel, sort_order: sortOrder! }]
    }).catch(() => { /* non-fatal — definitions registry is a cache, web_pages is source of truth */ })
  }

  return { ok: true }
}
