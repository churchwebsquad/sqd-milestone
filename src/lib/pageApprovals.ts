/**
 * Page-level approval state for the copywriting pipeline.
 *
 * Storage: strategy_web_projects.roadmap_state.approved_pages
 *   (JSONB; no new tables, no schema migrations)
 *
 * Shape:
 *   approved_pages: {
 *     "home": {
 *       status:        "approved" | "unlocked",
 *       version:        2,
 *       approved_at:    "2026-06-05T...",
 *       approved_by:    "<auth_uid>",
 *       snapshot:       { page, sections, taken_at },   // full state at approval
 *       stale:          false,
 *       stale_reasons:  null,
 *       history:        [{ version, approved_at, approved_by, snapshot,
 *                          unlocked_at, unlocked_by, unlock_reason }, ...]
 *     },
 *     ...
 *   }
 *
 * The active lock is `approved_pages[slug].status === 'approved'`.
 * Every pipeline write path (voice-pass apply, auto-bind, future Stage 5
 * binder) MUST check this before mutating web_sections for that page.
 *
 * Drift prevention by construction: an approved page's field_provenance
 * is flipped to 'override' on approval, which voice-pass already honors.
 * The lock is belt-and-suspenders — even if a code path skips the
 * provenance check, the JSONB lock keeps the page protected.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase as defaultSupabase } from './supabase'

export type ApprovalStatus = 'approved' | 'unlocked'

export interface SnapshotSection {
  id:                  string
  sort_order:          number | null
  content_template_id: string | null
  field_values:        Record<string, unknown> | null
  field_provenance:    Record<string, unknown> | null
}

export interface ApprovalSnapshot {
  page: {
    id:       string
    slug:     string
    name:     string
    page_seo: unknown | null
  }
  sections: SnapshotSection[]
  taken_at: string
}

export interface PageApprovalHistoryEntry {
  version:        number
  approved_at:    string
  approved_by?:   string
  snapshot:       ApprovalSnapshot
  unlocked_at?:   string
  unlocked_by?:   string
  unlock_reason?: string
}

export interface PageApprovalRecord {
  status:         ApprovalStatus
  version:        number
  approved_at?:   string
  approved_by?:   string
  snapshot?:      ApprovalSnapshot

  // Unlock state — when status='unlocked', the prior approved snapshot
  // is preserved here for one-click restore.
  prior_snapshot?: ApprovalSnapshot
  unlocked_at?:    string
  unlocked_by?:    string
  unlock_reason?:  string

  // Stale signal — Stage 8 or upstream context changes mark approved
  // pages as drifted. Advisory only; doesn't mutate copy.
  stale?:         boolean
  stale_reasons?: string[]

  // Full audit trail of prior approvals
  history?:       PageApprovalHistoryEntry[]
}

export type ApprovedPagesMap = Record<string, PageApprovalRecord>

// ─── Read helpers (synchronous, work off roadmap_state in memory) ──

export function getApprovedPages(roadmapState: unknown): ApprovedPagesMap {
  const rs = (roadmapState ?? {}) as Record<string, unknown>
  return (rs.approved_pages as ApprovedPagesMap) ?? {}
}

export function getApproval(
  roadmapState: unknown,
  slug: string,
): PageApprovalRecord | null {
  return getApprovedPages(roadmapState)[slug] ?? null
}

export function isApproved(roadmapState: unknown, slug: string): boolean {
  return getApproval(roadmapState, slug)?.status === 'approved'
}

export function isUnlocked(roadmapState: unknown, slug: string): boolean {
  return getApproval(roadmapState, slug)?.status === 'unlocked'
}

export function isStale(roadmapState: unknown, slug: string): boolean {
  return getApproval(roadmapState, slug)?.stale === true
}

export function getApprovedSlugs(roadmapState: unknown): string[] {
  return Object.entries(getApprovedPages(roadmapState))
    .filter(([, v]) => v.status === 'approved')
    .map(([k]) => k)
}

// ─── Mutation helpers (DB-touching) ────────────────────────────────

interface MutationContext {
  supabase?:  SupabaseClient
  projectId:  string
  pageSlug:   string
}

/** Build a full snapshot of the page + sections at THIS moment. Reads
 *  from DB; doesn't write. Used both for approval and for diffing. */
export async function buildSnapshot(
  ctx: MutationContext,
): Promise<ApprovalSnapshot | null> {
  const sb = ctx.supabase ?? defaultSupabase
  const { data: page } = await sb
    .from('web_pages')
    .select('id, slug, name, page_seo')
    .eq('web_project_id', ctx.projectId)
    .eq('slug', ctx.pageSlug)
    .maybeSingle()
  if (!page) return null
  const { data: sections } = await sb
    .from('web_sections')
    .select('id, sort_order, content_template_id, field_values, field_provenance')
    .eq('web_page_id', (page as { id: string }).id)
    .order('sort_order', { ascending: true })
  return {
    page: page as ApprovalSnapshot['page'],
    sections: (sections ?? []) as SnapshotSection[],
    taken_at: new Date().toISOString(),
  }
}

/** Lock the page: snapshot + flip every field's provenance to
 *  'override' + write approved_pages[slug] record. Atomic via the
 *  roadmap_state update path (Supabase handles JSONB merge serially). */
export async function approveCopy(args: {
  supabase?: SupabaseClient
  projectId: string
  pageSlug:  string
  userId:    string | null
}): Promise<{ ok: true; version: number } | { ok: false; error: string }> {
  const sb = args.supabase ?? defaultSupabase
  // 1. Snapshot
  const snapshot = await buildSnapshot({ supabase: sb, projectId: args.projectId, pageSlug: args.pageSlug })
  if (!snapshot) return { ok: false, error: `Page ${args.pageSlug} not found` }

  // 2. Read current approvals + determine version
  const { data: project, error: readErr } = await sb
    .from('strategy_web_projects')
    .select('roadmap_state')
    .eq('id', args.projectId)
    .maybeSingle()
  if (readErr || !project) return { ok: false, error: readErr?.message ?? 'Project not found' }
  const rs = ((project as { roadmap_state: Record<string, unknown> | null }).roadmap_state ?? {})
  const current = getApproval(rs, args.pageSlug)
  const nextVersion = (current?.history?.[0]?.version ?? current?.version ?? 0) + 1

  // 3. Build the new approval record. If there's a current approval
  //    being superseded, push it to history[].
  const history = current?.history ? [...current.history] : []
  if (current && (current.status === 'approved' || current.status === 'unlocked')) {
    // Push prior state into history (snapshot under either snapshot
    // or prior_snapshot depending on its status).
    const priorSnapshot = current.snapshot ?? current.prior_snapshot
    if (priorSnapshot && current.version) {
      history.unshift({
        version:        current.version,
        approved_at:    current.approved_at  ?? new Date().toISOString(),
        approved_by:    current.approved_by,
        snapshot:       priorSnapshot,
        unlocked_at:    current.unlocked_at,
        unlocked_by:    current.unlocked_by,
        unlock_reason:  current.unlock_reason,
      })
    }
  }

  const nextRecord: PageApprovalRecord = {
    status:      'approved',
    version:     nextVersion,
    approved_at: new Date().toISOString(),
    approved_by: args.userId ?? undefined,
    snapshot,
    stale:       false,
    history:     history.slice(0, 10),  // keep last 10 versions
  }

  // 4. Flip every slot's provenance to 'override' on every section.
  //    Saves the prior provenance.source per key inside the snapshot
  //    so unlock can restore them.
  for (const sec of snapshot.sections) {
    const fv   = (sec.field_values ?? {}) as Record<string, unknown>
    const prov = (sec.field_provenance ?? {}) as Record<string, { source?: string }>
    const nextProv: Record<string, { source?: string }> = {}
    for (const key of Object.keys(fv)) {
      nextProv[key] = { ...(prov[key] ?? {}), source: 'override' }
    }
    const { error: secErr } = await sb
      .from('web_sections')
      .update({ field_provenance: nextProv } as never)
      .eq('id', sec.id)
    if (secErr) return { ok: false, error: `Failed to lock section ${sec.id}: ${secErr.message}` }
  }

  // 5. Write the approved_pages entry
  const approvedPages = { ...(getApprovedPages(rs)), [args.pageSlug]: nextRecord }
  const { error: writeErr } = await sb
    .from('strategy_web_projects')
    .update({ roadmap_state: { ...rs, approved_pages: approvedPages } } as never)
    .eq('id', args.projectId)
  if (writeErr) return { ok: false, error: writeErr.message }

  return { ok: true, version: nextVersion }
}

/** Unlock: copy approved record into history, mark status='unlocked',
 *  flip every slot's provenance back to its pre-approval value (from
 *  the snapshot). Pipeline can then write to this page again. */
export async function unlockCopy(args: {
  supabase?: SupabaseClient
  projectId: string
  pageSlug:  string
  userId:    string | null
  reason:    string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = args.supabase ?? defaultSupabase
  const { data: project, error: readErr } = await sb
    .from('strategy_web_projects')
    .select('roadmap_state')
    .eq('id', args.projectId)
    .maybeSingle()
  if (readErr || !project) return { ok: false, error: readErr?.message ?? 'Project not found' }
  const rs = ((project as { roadmap_state: Record<string, unknown> | null }).roadmap_state ?? {})
  const current = getApproval(rs, args.pageSlug)
  if (!current || current.status !== 'approved') {
    return { ok: false, error: `Page ${args.pageSlug} is not approved` }
  }

  // Restore each section's prior provenance from the snapshot.
  if (current.snapshot) {
    for (const sec of current.snapshot.sections) {
      const { error: secErr } = await sb
        .from('web_sections')
        .update({ field_provenance: sec.field_provenance ?? {} } as never)
        .eq('id', sec.id)
      if (secErr) return { ok: false, error: `Failed to restore provenance on ${sec.id}: ${secErr.message}` }
    }
  }

  // Flip the record to unlocked, keep snapshot under prior_snapshot for restore.
  const nextRecord: PageApprovalRecord = {
    ...current,
    status:         'unlocked',
    prior_snapshot: current.snapshot,
    snapshot:       undefined,
    unlocked_at:    new Date().toISOString(),
    unlocked_by:    args.userId ?? undefined,
    unlock_reason:  args.reason,
  }

  const approvedPages = { ...(getApprovedPages(rs)), [args.pageSlug]: nextRecord }
  const { error: writeErr } = await sb
    .from('strategy_web_projects')
    .update({ roadmap_state: { ...rs, approved_pages: approvedPages } } as never)
    .eq('id', args.projectId)
  if (writeErr) return { ok: false, error: writeErr.message }

  return { ok: true }
}

/** Restore the approved snapshot to web_sections. Used after an unlock
 *  + regen if the strategist regrets the change. Re-locks the page. */
export async function restoreApproval(args: {
  supabase?: SupabaseClient
  projectId: string
  pageSlug:  string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = args.supabase ?? defaultSupabase
  const { data: project } = await sb
    .from('strategy_web_projects')
    .select('roadmap_state')
    .eq('id', args.projectId)
    .maybeSingle()
  if (!project) return { ok: false, error: 'Project not found' }
  const rs = ((project as { roadmap_state: Record<string, unknown> | null }).roadmap_state ?? {})
  const current = getApproval(rs, args.pageSlug)
  const snapshot = current?.snapshot ?? current?.prior_snapshot
  if (!snapshot) return { ok: false, error: `No snapshot available for ${args.pageSlug}` }

  // Restore each section's field_values + provenance.
  for (const sec of snapshot.sections) {
    const { error: secErr } = await sb
      .from('web_sections')
      .update({
        field_values:     sec.field_values     ?? {},
        field_provenance: sec.field_provenance ?? {},
      } as never)
      .eq('id', sec.id)
    if (secErr) return { ok: false, error: `Failed to restore section ${sec.id}: ${secErr.message}` }
  }

  // Re-lock the page (status='approved').
  const nextRecord: PageApprovalRecord = {
    ...current!,
    status:         'approved',
    snapshot,
    prior_snapshot: undefined,
    unlocked_at:    undefined,
    unlocked_by:    undefined,
    unlock_reason:  undefined,
    stale:          false,
  }
  const approvedPages = { ...(getApprovedPages(rs)), [args.pageSlug]: nextRecord }
  const { error: writeErr } = await sb
    .from('strategy_web_projects')
    .update({ roadmap_state: { ...rs, approved_pages: approvedPages } } as never)
    .eq('id', args.projectId)
  if (writeErr) return { ok: false, error: writeErr.message }

  return { ok: true }
}

/** Patch the stale flag + reasons. Called by Stage 8 or other upstream
 *  context-change detectors. Doesn't mutate web_sections — advisory only. */
export async function markPageStale(args: {
  supabase?: SupabaseClient
  projectId: string
  pageSlug:  string
  reasons:   string[]
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = args.supabase ?? defaultSupabase
  const { data: project } = await sb
    .from('strategy_web_projects')
    .select('roadmap_state')
    .eq('id', args.projectId)
    .maybeSingle()
  if (!project) return { ok: false, error: 'Project not found' }
  const rs = ((project as { roadmap_state: Record<string, unknown> | null }).roadmap_state ?? {})
  const current = getApproval(rs, args.pageSlug)
  if (!current) return { ok: true }  // not approved, nothing to mark
  const nextRecord: PageApprovalRecord = {
    ...current,
    stale: args.reasons.length > 0,
    stale_reasons: args.reasons.length > 0 ? args.reasons : undefined,
  }
  const approvedPages = { ...(getApprovedPages(rs)), [args.pageSlug]: nextRecord }
  const { error: writeErr } = await sb
    .from('strategy_web_projects')
    .update({ roadmap_state: { ...rs, approved_pages: approvedPages } } as never)
    .eq('id', args.projectId)
  if (writeErr) return { ok: false, error: writeErr.message }
  return { ok: true }
}
