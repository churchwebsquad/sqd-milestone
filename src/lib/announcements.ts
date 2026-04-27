/**
 * Initiative Progress "What's New" announcement API.
 *
 * Storage lives entirely in Supabase (see schema/v21_strategy_announcements.sql).
 * The Notion Progress entry is the source of truth for the *update*; the
 * announcement row is a denormalized "show this once as a popup" flag with
 * the title/body/dept copied at create time so the popup doesn't pay for
 * a Notion fetch on every page load.
 *
 * Targeting rule (matches the SQL filter in `listPendingAnnouncement`):
 *  - `initiative_department === 'all-in'` (or null) → shown to everyone
 *  - Otherwise → shown only to staff whose strategy dept matches
 *  Plus: not already dismissed by the current user.
 *
 * Author gating (VP + directors only) is enforced at the call site, not
 * in this module — the form decides whether to render the toggle and
 * whether to call `createAnnouncement`.
 */

import { supabase } from './supabase'
import type { Department, Initiative, ProgressEntry } from '../types/strategy'
import type { StrategyAnnouncement } from '../types/database'

/** Look up the next announcement to show the current user. Returns
 *  `null` when no pending announcements match — the popup stays unmounted
 *  in that case. Newest-first ordering means a user who hasn't been in
 *  the app for a while sees the most-recent announcement first; once
 *  they dismiss it the next visit surfaces the next one (if any). */
export async function listPendingAnnouncement(
  userId: string,
  userStrategyDept: Department | null,
): Promise<StrategyAnnouncement | null> {
  if (!userId) return null

  // Pull the candidate set: every active announcement matching the user's
  // dept. Filter dismissed ones in a second pass so we can use a single
  // round-trip (Postgres doesn't expose anti-joins via PostgREST without
  // an RPC, and the candidate set is small in practice).
  const { data, error } = await supabase
    .from('strategy_announcements')
    .select('*')
    .eq('is_active', true)
    .or(buildDeptOrFilter(userStrategyDept))
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    console.warn('[announcements] list failed:', error.message)
    return null
  }
  const candidates = (data ?? []) as StrategyAnnouncement[]
  if (candidates.length === 0) return null

  // Pull the user's dismissals for these candidates only.
  const ids = candidates.map(c => c.id)
  const { data: dismissals, error: dErr } = await supabase
    .from('strategy_announcement_dismissals')
    .select('announcement_id')
    .eq('user_id', userId)
    .in('announcement_id', ids)
  if (dErr) {
    console.warn('[announcements] dismissals fetch failed:', dErr.message)
    // Conservative: if we can't tell what's been dismissed, show nothing
    // rather than spamming the user with already-dismissed popups.
    return null
  }
  const dismissed = new Set((dismissals ?? []).map(d => d.announcement_id as string))

  return candidates.find(c => !dismissed.has(c.id)) ?? null
}

/** OR-filter for Supabase's PostgREST `.or()` builder. We want any of:
 *    initiative_department = 'all-in'
 *    initiative_department is null            (treat unset as broadcast)
 *    initiative_department = <user's dept>
 *  When the user's dept is null/'all-in', the third branch collapses
 *  into the first two so we just match the broadcast announcements. */
function buildDeptOrFilter(userDept: Department | null): string {
  const clauses = [
    `initiative_department.eq.all-in`,
    `initiative_department.is.null`,
  ]
  if (userDept && userDept !== 'all-in') {
    clauses.push(`initiative_department.eq.${userDept}`)
  }
  return clauses.join(',')
}

/** Mark the announcement dismissed for the current user. Optimistic
 *  callers should still update local state — the server write is
 *  best-effort. */
export async function dismissAnnouncement(
  announcementId: string,
  userId: string,
): Promise<void> {
  if (!userId) return
  const { error } = await supabase
    .from('strategy_announcement_dismissals')
    .upsert(
      { announcement_id: announcementId, user_id: userId },
      { onConflict: 'announcement_id,user_id' },
    )
  if (error) {
    console.warn('[announcements] dismiss failed:', error.message)
    throw new Error(error.message)
  }
}

interface CreateAnnouncementInput {
  progress: ProgressEntry
  initiative: Pick<Initiative, 'id' | 'name' | 'department'>
  /** Body the author wrote in the form. We capture this rather than
   *  re-deriving from the Notion progress entry — the entry could be
   *  fetched late, and the popup wants the exact text the author saw
   *  when they hit submit. */
  body: string
  /** Caller's employees.id, used for the `created_by_employee_id` column.
   *  Pass null if unresolved; the column is nullable. */
  createdByEmployeeId: string | null
}

/** Persist the announcement row. Caller should already have created the
 *  Progress entry via `createProgress(...)` and have the resulting
 *  `ProgressEntry` in hand — we use its id as the cross-reference. */
export async function createAnnouncement(
  input: CreateAnnouncementInput,
): Promise<StrategyAnnouncement> {
  const row: Partial<StrategyAnnouncement> = {
    progress_notion_id: input.progress.id,
    initiative_notion_id: input.initiative.id,
    initiative_name: input.initiative.name,
    initiative_department: input.initiative.department,
    headline: input.progress.title,
    body: input.body || null,
    created_by_employee_id: input.createdByEmployeeId,
    is_active: true,
  }
  const { data, error } = await supabase
    .from('strategy_announcements')
    .insert(row)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as StrategyAnnouncement
}

/** Soft-retire an announcement. No UI for this in v1 — directors run
 *  this via SQL. Exposed here so a future admin surface can call it. */
export async function retireAnnouncement(id: string): Promise<void> {
  const { error } = await supabase
    .from('strategy_announcements')
    .update({ is_active: false, retired_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}
