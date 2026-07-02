/**
 * Review state helpers — single read for everything Site Manager needs
 * to render review-related UI. Centralizes the (review, comment) joins
 * + the derived per-page status so the workspace components stay lean.
 *
 * The data model:
 *   - web_reviews          : project-scoped sessions, kind ∈ {internal, partner}
 *   - web_review_comments  : per-page (and optionally per-section/field)
 *                            comments + edit proposals
 *   - web_review_attachments: image uploads on comments
 *
 * Derivations:
 *   • Project-level pill   — "Partner review · N requests" or
 *                            "Internal review · M open"
 *   • Per-page pill        — counts of open suggestions/requests
 *                            attached to that page
 *   • Latest approval kind — most recent closed review's kind, used
 *                            to label "Approved · partner" vs "internal"
 */

import { supabase } from './supabase'
import type {
  WebReview, WebReviewComment, WebReviewCommentStatus, WebReviewCommentCategory,
  WebReviewEdit, WebReviewRequest, WebReviewStatus, BoardStatus,
} from '../types/database'

// ── Public types ───────────────────────────────────────────────────

export interface PageReviewCounts {
  /** Open comments / suggestions / requests attached to this page. */
  open_total:        number
  open_comments:     number
  open_suggested:    number
  open_requested:    number
  /** Resolved (applied/amended/dismissed) count for history badges. */
  resolved_total:    number
}

export interface ProjectReviewState {
  reviews: WebReview[]
  /** All open reviews on the project (subset of reviews above). */
  open_reviews: WebReview[]
  /** True when one or more `kind=partner` reviews are open. */
  has_open_partner: boolean
  /** Count of open `kind=internal` reviews. */
  open_internal_count: number
  /** Counts per page id. Pages with no comments are absent. */
  page_counts: Record<string, PageReviewCounts>
  /** Aggregate counts across all pages. */
  totals: PageReviewCounts
  /** Most recent closed review (for "Approved · partner/internal" display). */
  last_closed: WebReview | null
  /** All comments across all reviews on this project. Used by the
   *  Reviews inbox + the page/section badges. */
  comments: WebReviewComment[]
}

const EMPTY_COUNTS: PageReviewCounts = {
  open_total: 0,
  open_comments: 0,
  open_suggested: 0,
  open_requested: 0,
  resolved_total: 0,
}

// ── Status normalization (legacy → new vocabulary) ─────────────────
//
// v39 added the 5-state board status (no_status / open_for_review /
// editing_content / on_hold / completed) but kept legacy 'open'/'closed'
// valid in the DB CHECK constraint so reads don't break while writers
// transition. Every reader of `WebReview.status` should pass it through
// `normalizeBoardStatus` first to collapse legacy values into the new
// vocabulary. A follow-up v40 removes the legacy values entirely.

/** Collapse legacy 'open'/'closed' into the new board-status vocabulary. */
export function normalizeBoardStatus(status: WebReviewStatus): BoardStatus {
  if (status === 'open')   return 'open_for_review'
  if (status === 'closed') return 'completed'
  return status
}

/** True when a board is in any "done" state — covers both legacy
 *  'closed' and the new 'completed'. */
function isBoardClosed(status: WebReviewStatus): boolean {
  return status === 'completed' || status === 'closed'
}

/** Format a review's display label: "Internal R2" / "Partner R3". */
export function roundLabel(review: Pick<WebReview, 'kind' | 'round_number'>): string {
  const k = review.kind === 'partner' ? 'Partner' : 'Internal'
  return `${k} R${review.round_number}`
}

// ── Load ───────────────────────────────────────────────────────────

/** Load all reviews + their comments for the project in one round trip
 *  and derive the project-level + per-page counts the UI needs. */
export async function loadProjectReviewState(projectId: string): Promise<ProjectReviewState> {
  const { data: reviewRows } = await supabase
    .from('web_reviews')
    .select('*')
    .eq('web_project_id', projectId)
    .order('started_at', { ascending: false })

  const reviews = (reviewRows ?? []) as WebReview[]
  const open_reviews = reviews.filter(r => !isBoardClosed(r.status))
  const open_partner = open_reviews.filter(r => r.kind === 'partner')
  const open_internal = open_reviews.filter(r => r.kind === 'internal')
  const last_closed = reviews.find(r => isBoardClosed(r.status)) ?? null

  // Load comments across every review on this project.
  const reviewIds = reviews.map(r => r.id)
  let comments: WebReviewComment[] = []
  if (reviewIds.length > 0) {
    const { data: commentRows } = await supabase
      .from('web_review_comments')
      .select('*')
      .in('review_id', reviewIds)
    comments = (commentRows ?? []) as WebReviewComment[]
  }

  // Derive per-page counts. Only OPEN comments contribute to "open"
  // counts; closed comments contribute to resolved_total.
  const page_counts: Record<string, PageReviewCounts> = {}
  const ensure = (pageId: string): PageReviewCounts => {
    if (!page_counts[pageId]) page_counts[pageId] = { ...EMPTY_COUNTS }
    return page_counts[pageId]
  }
  for (const c of comments) {
    const bucket = ensure(c.web_page_id)
    if (c.status === 'open') {
      bucket.open_total++
      if (c.kind === 'comment')   bucket.open_comments++
      if (c.kind === 'suggested') bucket.open_suggested++
      if (c.kind === 'requested') bucket.open_requested++
    } else {
      bucket.resolved_total++
    }
  }

  const totals: PageReviewCounts = Object.values(page_counts).reduce<PageReviewCounts>((acc, b) => ({
    open_total:     acc.open_total     + b.open_total,
    open_comments:  acc.open_comments  + b.open_comments,
    open_suggested: acc.open_suggested + b.open_suggested,
    open_requested: acc.open_requested + b.open_requested,
    resolved_total: acc.resolved_total + b.resolved_total,
  }), { ...EMPTY_COUNTS })

  return {
    reviews,
    open_reviews,
    has_open_partner:    open_partner.length > 0,
    open_internal_count: open_internal.length,
    page_counts,
    totals,
    last_closed,
    comments,
  }
}

// ── Display labels ─────────────────────────────────────────────────

export interface ProjectStatusBadge {
  state: 'idle' | 'review-internal' | 'review-partner' | 'approved-internal' | 'approved-partner'
  label: string
  count?: number
}

/** Produce the top-of-Site-Manager review pill payload. */
export function projectReviewBadge(state: ProjectReviewState): ProjectStatusBadge {
  if (state.has_open_partner) {
    return {
      state: 'review-partner',
      label: 'Partner review',
      count: state.totals.open_requested,
    }
  }
  if (state.open_internal_count > 0) {
    return {
      state: 'review-internal',
      label: state.open_internal_count === 1
        ? 'Internal review'
        : `Internal review · ${state.open_internal_count} open`,
      count: state.totals.open_suggested,
    }
  }
  if (state.last_closed) {
    return {
      state: state.last_closed.kind === 'partner' ? 'approved-partner' : 'approved-internal',
      label: state.last_closed.kind === 'partner' ? 'Approved · partner' : 'Approved · internal',
    }
  }
  return { state: 'idle', label: 'No reviews yet' }
}

/** Page-level pill payload — for the Pages list left column. */
export interface PageStatusBadge {
  state: 'idle' | 'edits-requested' | 'edits-suggested' | 'commented'
  label: string
  count?: number
}

export function pageReviewBadge(counts: PageReviewCounts | undefined): PageStatusBadge | null {
  if (!counts || counts.open_total === 0) return null
  if (counts.open_requested > 0) {
    return { state: 'edits-requested', label: 'Edits requested', count: counts.open_requested }
  }
  if (counts.open_suggested > 0) {
    return { state: 'edits-suggested', label: 'Edits suggested', count: counts.open_suggested }
  }
  return { state: 'commented', label: 'Commented', count: counts.open_comments }
}

// ── Mutators ───────────────────────────────────────────────────────

export interface ReviewMutationResult<T> {
  ok: boolean
  data: T | null
  error: string | null
}

/** Start a new review session on the project. For partner reviews we
 *  generate the opaque token used by the public portal URL. */
/** Append a field-edit log entry. Called from the review workspace
 *  whenever the staff member edits a section field while their
 *  internal review is open. Fire-and-forget — the log is best-effort;
 *  failure here shouldn't block the underlying edit. */
export async function logReviewEdit(opts: {
  reviewId: string
  sectionId: string
  pageId: string
  fieldPath: string
  fieldLabel: string | null
  beforeValue: unknown
  afterValue: unknown
}): Promise<void> {
  const { data: user } = await supabase.auth.getUser()
  const editorName = await resolveStaffName(user?.user?.email ?? null)
  const { error } = await supabase.from('web_review_edits').insert({
    review_id:         opts.reviewId,
    web_section_id:    opts.sectionId,
    web_page_id:       opts.pageId,
    field_path:        opts.fieldPath,
    field_label:       opts.fieldLabel,
    before_value:      opts.beforeValue,
    after_value:       opts.afterValue,
    edited_by_user_id: user?.user?.id ?? null,
    edited_by_name:    editorName,
  } as never)
  if (error) console.error('[reviews] logReviewEdit failed:', error.message)
}

/** Read every edit recorded against a project's reviews. The Feedback
 *  rail pulls this once per load and surfaces edits inline alongside
 *  comments in each session card. */
export async function loadProjectReviewEdits(projectId: string): Promise<WebReviewEdit[]> {
  // Two-step: find all review ids on this project, then pull their edits.
  const { data: reviews } = await supabase
    .from('web_reviews')
    .select('id')
    .eq('web_project_id', projectId)
  const reviewIds = ((reviews ?? []) as Array<{ id: string }>).map(r => r.id)
  if (reviewIds.length === 0) return []
  const { data: edits } = await supabase
    .from('web_review_edits')
    .select('*')
    .in('review_id', reviewIds)
    .order('edited_at', { ascending: false })
  return (edits ?? []) as WebReviewEdit[]
}

/** Resolve the current user's display name via the employees table.
 *  Falls back to the auth email when no employee row matches. */
export async function resolveStaffName(email: string | null | undefined): Promise<string | null> {
  if (!email) return null
  const { data: emp } = await supabase
    .from('employees')
    .select('full_name, name, first_name')
    .ilike('email', email)
    .limit(1)
    .maybeSingle()
  const e = emp as { full_name?: string | null; name?: string | null; first_name?: string | null } | null
  return e?.full_name?.trim() || e?.name?.trim() || e?.first_name?.trim() || email
}

export async function startReview(opts: {
  projectId: string
  kind: 'internal' | 'partner'
  notes?: string
  /** If this review was kicked off by accepting a staff-to-staff
   *  request, pass the request id so the two get linked + the
   *  request flips to 'started'. */
  fromRequestId?: string
}): Promise<ReviewMutationResult<WebReview>> {
  // Always generate a token. Internal reviews used to skip this, but
  // strategists need a shareable link to share with teammates the
  // same way partner reviews work. The column has a unique index;
  // collisions on a 32-char hex are astronomically improbable.
  const partner_token = crypto.randomUUID().replace(/-/g, '')
  const { data: user } = await supabase.auth.getUser()
  const starterName = await resolveStaffName(user?.user?.email ?? null)
  const { data, error } = await supabase
    .from('web_reviews')
    .insert({
      web_project_id:     opts.projectId,
      kind:               opts.kind,
      status:             'open_for_review' satisfies BoardStatus,
      started_by_user_id: user?.user?.id ?? null,
      started_by_name:    starterName,
      partner_token,
      notes:              opts.notes ?? null,
      review_request_id:  opts.fromRequestId ?? null,
    } as never)
    .select('*')
    .maybeSingle()
  if (error) {
    console.error('[reviews] startReview failed:', error.message)
    return { ok: false, data: null, error: error.message }
  }
  // If this review answers a request, mark it started + link back.
  if (opts.fromRequestId && data) {
    const review = data as WebReview
    await supabase.from('web_review_requests').update({
      status:            'started',
      started_review_id: review.id,
      started_at:        new Date().toISOString(),
    } as never).eq('id', opts.fromRequestId)
  }

  // Auto-bump page lifecycle on partner reviews. Internal reviews
  // don't bump on creation (the comment-insert trigger handles that
  // page-by-page); but a partner review is a whole-project event —
  // every page in draft/internal_review flips to partner_review the
  // moment the partner link is generated.
  if (opts.kind === 'partner') {
    await supabase
      .from('web_pages')
      .update({ content_status: 'partner_review', updated_at: new Date().toISOString() } as never)
      .eq('web_project_id', opts.projectId)
      .in('content_status', ['draft', 'internal_review'])
  }

  return { ok: true, data: data as WebReview | null, error: null }
}

// ── Review requests (staff-to-staff) ──────────────────────────────

export async function createReviewRequest(opts: {
  projectId: string
  assigneeEmail: string
  assigneeName: string | null
  notes: string
}): Promise<ReviewMutationResult<WebReviewRequest>> {
  const { data: user } = await supabase.auth.getUser()
  const requesterName = await resolveStaffName(user?.user?.email ?? null)
  const { data, error } = await supabase
    .from('web_review_requests')
    .insert({
      web_project_id:    opts.projectId,
      requester_user_id: user?.user?.id ?? null,
      requester_name:    requesterName,
      assignee_email:    opts.assigneeEmail.toLowerCase().trim(),
      assignee_name:     opts.assigneeName,
      notes:             opts.notes.trim() || null,
      status:            'pending',
    } as never)
    .select('*')
    .maybeSingle()
  if (error) {
    console.error('[reviews] createReviewRequest failed:', error.message)
    return { ok: false, data: null, error: error.message }
  }
  // Requesting a review is itself a signal the page is no longer
  // pure draft. Bump every draft page on the project to
  // internal_review so the status reflects "someone is going to look
  // at this soon".
  await supabase
    .from('web_pages')
    .update({ content_status: 'internal_review', updated_at: new Date().toISOString() } as never)
    .eq('web_project_id', opts.projectId)
    .eq('content_status', 'draft')
  return { ok: true, data: data as WebReviewRequest | null, error: null }
}

/** Cancel a pending request (only the requester normally does this).
 *  No-op if the request has already been started. */
export async function cancelReviewRequest(requestId: string): Promise<boolean> {
  const { error } = await supabase
    .from('web_review_requests')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() } as never)
    .eq('id', requestId)
    .eq('status', 'pending')  // don't touch already-started requests
  if (error) {
    console.error('[reviews] cancelReviewRequest failed:', error.message)
    return false
  }
  return true
}

export async function listReviewRequests(projectId: string): Promise<WebReviewRequest[]> {
  const { data } = await supabase
    .from('web_review_requests')
    .select('*')
    .eq('web_project_id', projectId)
    .order('created_at', { ascending: false })
  return (data ?? []) as WebReviewRequest[]
}

/** Close a review. Open comments stay attached to their pages and
 *  carry into the next review session. Pages stay at whatever
 *  content_status they're at — no implicit approval. */
export async function closeReview(reviewId: string): Promise<ReviewMutationResult<null>> {
  const { data: user } = await supabase.auth.getUser()
  const closerName = await resolveStaffName(user?.user?.email ?? null)
  const { error } = await supabase
    .from('web_reviews')
    .update({
      status:            'completed' satisfies BoardStatus,
      closed_at:         new Date().toISOString(),
      closed_by_user_id: user?.user?.id ?? null,
      closed_by_name:    closerName,
    } as never)
    .eq('id', reviewId)
  if (error) {
    console.error('[reviews] closeReview failed:', error.message)
    return { ok: false, data: null, error: error.message }
  }
  return { ok: true, data: null, error: null }
}

/** Finalize a review — close the session AND promote every page on
 *  the project that has no remaining open feedback from `in_review`
 *  to `approved`. Pages with unresolved comments stay at `in_review`
 *  so staff knows they still need attention. Appends a "Finalized by"
 *  marker to web_reviews.notes for the timeline. */
export async function finalizeReview(opts: {
  reviewId:  string
  projectId: string
}): Promise<ReviewMutationResult<{ pagesApproved: number; pagesPending: number }>> {
  const { data: user } = await supabase.auth.getUser()
  const closerName = await resolveStaffName(user?.user?.email ?? null)
  const finalizedAt = new Date().toISOString()

  // 1. Read every page on the project + the open comment counts so we
  //    know which pages are clear of feedback.
  const [{ data: pageRows, error: pErr }, { data: openRows, error: cErr }] = await Promise.all([
    supabase
      .from('web_pages')
      .select('id, content_status')
      .eq('web_project_id', opts.projectId)
      .eq('archived', false),
    supabase
      .from('web_review_comments')
      .select('web_page_id, review_id, status')
      .eq('status', 'open'),
  ])
  if (pErr || cErr) {
    const msg = pErr?.message ?? cErr?.message ?? 'unknown error'
    console.error('[reviews] finalizeReview load failed:', msg)
    return { ok: false, data: null, error: msg }
  }

  // Pages with any open comment (this review or any other) stay
  // pending — we only approve genuinely-clean ones.
  const pagesWithOpen = new Set<string>()
  for (const r of (openRows ?? []) as Array<{ web_page_id: string }>) {
    pagesWithOpen.add(r.web_page_id)
  }
  const cleanPageIds = ((pageRows ?? []) as Array<{ id: string; content_status: string }>)
    .filter(p =>
      (p.content_status === 'internal_review' || p.content_status === 'partner_review')
      && !pagesWithOpen.has(p.id),
    )
    .map(p => p.id)
  const pendingPageIds = ((pageRows ?? []) as Array<{ id: string; content_status: string }>)
    .filter(p => pagesWithOpen.has(p.id))
    .map(p => p.id)

  // 2. Approve clean pages. We use partner_approved as the terminal
  //    "good to ship" status — even when staff finalizes, the
  //    convention is that approval is partner-driven.
  if (cleanPageIds.length > 0) {
    const { error: upErr } = await supabase
      .from('web_pages')
      .update({ content_status: 'partner_approved', updated_at: finalizedAt })
      .in('id', cleanPageIds)
    if (upErr) {
      console.error('[reviews] finalizeReview page-update failed:', upErr.message)
      return { ok: false, data: null, error: upErr.message }
    }
  }

  // 3. Close the review + stamp a "Finalized" marker into notes so
  //    the audit trail records that this close was a real wrap-up.
  const note = `Finalized by ${closerName ?? 'staff'} at ${finalizedAt} — ${cleanPageIds.length} page(s) approved, ${pendingPageIds.length} still pending`
  const { data: reviewRow, error: rErr } = await supabase
    .from('web_reviews')
    .select('notes')
    .eq('id', opts.reviewId)
    .maybeSingle()
  if (rErr) {
    console.error('[reviews] finalizeReview review-read failed:', rErr.message)
    return { ok: false, data: null, error: rErr.message }
  }
  const existing = ((reviewRow as { notes?: string | null } | null)?.notes ?? '').trim()
  const merged = existing ? `${existing}\n${note}` : note
  const { error: closeErr } = await supabase
    .from('web_reviews')
    .update({
      status:            'completed' satisfies BoardStatus,
      closed_at:         finalizedAt,
      closed_by_user_id: user?.user?.id ?? null,
      closed_by_name:    closerName,
      notes:             merged,
    } as never)
    .eq('id', opts.reviewId)
  if (closeErr) {
    console.error('[reviews] finalizeReview close failed:', closeErr.message)
    return { ok: false, data: null, error: closeErr.message }
  }

  // If this review was kicked off by a staff-to-staff request, flip
  // the request to 'completed' so the requester sees it's done.
  const reviewRowFull = reviewRow as { notes?: string | null } | null
  void reviewRowFull  // keep TS happy
  const { data: linked } = await supabase
    .from('web_reviews')
    .select('review_request_id')
    .eq('id', opts.reviewId)
    .maybeSingle()
  const requestId = (linked as { review_request_id?: string | null } | null)?.review_request_id ?? null
  if (requestId) {
    await supabase
      .from('web_review_requests')
      .update({ status: 'completed', completed_at: finalizedAt } as never)
      .eq('id', requestId)
  }

  return {
    ok: true,
    data: { pagesApproved: cleanPageIds.length, pagesPending: pendingPageIds.length },
    error: null,
  }
}

/** Resolve a comment / suggestion / request. `applied` writes
 *  suggested_value into the section's field_values; `amended` does the
 *  same but with a different final value (caller passes `finalValue`);
 *  `dismissed` records the resolution without changing the field.
 *
 *  For kind='requested', resolution_note is required on dismiss (the
 *  enforcement lives in the caller — db doesn't reject). */
export async function resolveComment(opts: {
  commentId: string
  outcome: Exclude<WebReviewCommentStatus, 'open'>
  resolutionNote?: string
  /** Used by `applied` (= suggested_value) and `amended` (= a different value). */
  finalValue?: unknown
  /** The section row to patch when outcome ∈ (applied, amended). */
  sectionToPatch?: {
    sectionId: string
    fieldKey: string
    currentFieldValues: Record<string, unknown>
  }
}): Promise<boolean> {
  const { data: user } = await supabase.auth.getUser()
  // Snapshot resolver name so the inbox doesn't need a user_id join.
  const resolverName = await resolveStaffName(user?.user?.email ?? null)

  // 1. If this resolution involves a real field write, patch the
  //    section's field_values first. (Doing it before marking the
  //    comment resolved means an error here leaves the comment open
  //    rather than recording a phantom resolution.)
  //
  //    fieldKey may be a dotted path (`cards.0.heading`) when the
  //    partner suggested an edit inside a group/item — set the nested
  //    leaf instead of clobbering the whole group.
  if ((opts.outcome === 'applied' || opts.outcome === 'amended') && opts.sectionToPatch) {
    const { sectionId, fieldKey, currentFieldValues } = opts.sectionToPatch
    const next = setNestedPath(currentFieldValues, fieldKey, opts.finalValue)
    const { error: patchErr } = await supabase
      .from('web_sections')
      .update({ field_values: next } as never)
      .eq('id', sectionId)
    if (patchErr) {
      console.error('[reviews] resolveComment patch failed:', patchErr.message)
      return false
    }
  }

  // Compose the resolution note with the resolver's name baked in
  // when no explicit note was provided — gives the inbox a clean
  // "Resolved by … " line without a separate column.
  const composedNote =
    opts.resolutionNote?.trim()
      ? (resolverName ? `${opts.resolutionNote.trim()} — ${resolverName}` : opts.resolutionNote.trim())
      : (resolverName ? `Resolved by ${resolverName}` : null)

  const { error } = await supabase
    .from('web_review_comments')
    .update({
      status:              opts.outcome,
      resolved_by_user_id: user?.user?.id ?? null,
      resolved_by_name:    resolverName,
      resolved_at:         new Date().toISOString(),
      resolution_note:     composedNote,
    } as never)
    .eq('id', opts.commentId)
  if (error) {
    console.error('[reviews] resolveComment failed:', error.message)
    return false
  }
  return true
}

/** Write `value` into the dotted `path` inside `root`, returning a new
 *  object. Array indices in the path (digits) write into the array at
 *  that index; non-numeric segments write into objects. Non-mutating. */
function setNestedPath(
  root: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const parts = path.split('.')
  const recur = (node: unknown, depth: number): unknown => {
    const key    = parts[depth]
    const isLast = depth === parts.length - 1
    if (isLast) {
      if (/^\d+$/.test(key)) {
        const arr = Array.isArray(node) ? node.slice() : []
        arr[Number(key)] = value
        return arr
      }
      const obj = (node && typeof node === 'object' && !Array.isArray(node))
        ? { ...(node as Record<string, unknown>) }
        : {}
      ;(obj as Record<string, unknown>)[key] = value
      return obj
    }
    if (/^\d+$/.test(key)) {
      const arr = Array.isArray(node) ? node.slice() : []
      arr[Number(key)] = recur(arr[Number(key)], depth + 1)
      return arr
    }
    const obj = (node && typeof node === 'object' && !Array.isArray(node))
      ? { ...(node as Record<string, unknown>) }
      : {}
    ;(obj as Record<string, unknown>)[key] = recur((obj as Record<string, unknown>)[key], depth + 1)
    return obj
  }
  return recur(root, 0) as Record<string, unknown>
}

// ── Feedback board mutators ────────────────────────────────────────
//
// Surface the per-card / per-board edits the new feedback UI needs.
// Each is a thin Supabase update — failures log and return false so the
// caller can decide whether to surface a toast.

/** Delete a comment the caller authored. Wraps the
 *  `delete_own_review_comment` SECURITY DEFINER RPC so both authenticated
 *  staff (verified via auth.uid()) and anon partners (verified via a
 *  partner name pulled from portal localStorage) share one code path.
 *
 *  Refuses to delete already-resolved comments — the RPC enforces this
 *  server-side so audit history stays intact.
 *
 *  Returns true when the row was removed, false on failure. Errors are
 *  logged; callers decide whether to surface a toast. */
export async function deleteOwnReviewComment(opts: {
  commentId:   string
  /** Only passed from the partner portal — the name the partner
   *  entered on first visit (stored in localStorage). Ignored when the
   *  RPC runs under an authenticated staff session. */
  partnerName?: string | null
}): Promise<boolean> {
  const { error } = await supabase.rpc('delete_own_review_comment', {
    p_comment_id:   opts.commentId,
    p_partner_name: opts.partnerName ?? null,
  })
  if (error) {
    console.error('[reviews] deleteOwnReviewComment failed:', error.message)
    return false
  }
  return true
}

/** Change a comment's design/content tag. Pass null to clear. */
export async function setCommentCategory(
  commentId: string,
  category: WebReviewCommentCategory | null,
): Promise<boolean> {
  const { error } = await supabase
    .from('web_review_comments')
    .update({ category } as never)
    .eq('id', commentId)
  if (error) console.error('[reviews] setCommentCategory failed:', error.message)
  return !error
}

/** Assign / re-assign / unassign a comment to a staff member. The
 *  snapshot pattern (id + name + email) lets the card render the
 *  assignee chip without joining auth.users. */
export async function setCommentAssignee(
  commentId: string,
  assignee: { userId: string | null; name: string | null; email: string | null } | null,
): Promise<boolean> {
  const { error } = await supabase
    .from('web_review_comments')
    .update({
      assignee_user_id: assignee?.userId ?? null,
      assignee_name:    assignee?.name   ?? null,
      assignee_email:   assignee?.email  ?? null,
    } as never)
    .eq('id', commentId)
  if (error) console.error('[reviews] setCommentAssignee failed:', error.message)
  return !error
}

/** Set / clear the optional due date shown in the card footer. */
export async function setCommentDueDate(
  commentId: string,
  dueAt: string | null,
): Promise<boolean> {
  const { error } = await supabase
    .from('web_review_comments')
    .update({ due_at: dueAt } as never)
    .eq('id', commentId)
  if (error) console.error('[reviews] setCommentDueDate failed:', error.message)
  return !error
}

/** Change a review's board-level status. Surfaced from the column-
 *  header menu in the new feedback UI. Choosing 'completed' here is
 *  equivalent to a close-without-finalize — no page-status promotion. */
export async function setBoardStatus(reviewId: string, status: BoardStatus): Promise<boolean> {
  const { data: user } = await supabase.auth.getUser()
  // Closing the board also stamps closed_at / closed_by for the
  // audit trail. Re-opening clears them so we don't end up with a row
  // showing both "completed" and a stale closed_at.
  const isClosing = status === 'completed'
  const patch: Record<string, unknown> = { status }
  if (isClosing) {
    const closerName = await resolveStaffName(user?.user?.email ?? null)
    patch.closed_at         = new Date().toISOString()
    patch.closed_by_user_id = user?.user?.id ?? null
    patch.closed_by_name    = closerName
  } else {
    patch.closed_at         = null
    patch.closed_by_user_id = null
    patch.closed_by_name    = null
  }
  const { error } = await supabase
    .from('web_reviews')
    .update(patch as never)
    .eq('id', reviewId)
  if (error) console.error('[reviews] setBoardStatus failed:', error.message)
  return !error
}

// ── Feedback board derivation ──────────────────────────────────────
//
// Pure-derivation helper: take a loaded ProjectReviewState + edits and
// return the board-shaped projection the new feedback UI consumes.
// One function used by both the side rail and the Review tab so neither
// surface drifts. No I/O.

export interface FeedbackBoardCounts {
  open: number
  resolved: number
  total: number
}

export interface FeedbackBoard {
  reviewId: string
  kind: 'internal' | 'partner'
  roundNumber: number
  /** Human label for the column header ("Internal R2"). */
  label: string
  /** Normalized BoardStatus — legacy 'open'/'closed' have already been collapsed. */
  status: BoardStatus
  startedAt: string
  startedByName: string | null
  partnerName: string | null
  partnerToken: string | null
  comments: WebReviewComment[]
  edits: WebReviewEdit[]
  counts: FeedbackBoardCounts
}

export interface FeedbackAssignee {
  /** auth.users.id when known. Falls back to email-based identity. */
  id: string
  name: string
  email: string | null
}

export interface ProjectFeedbackBoards {
  /** Boards sorted (kind, roundNumber) descending — newest first. */
  boards: FeedbackBoard[]
  /** Tab → boards. 'all' carries every board; round tabs carry one each. */
  byTab: Record<string, FeedbackBoard[]>
  /** Unique assignees across every board's comments, for the filter dropdown. */
  assignees: FeedbackAssignee[]
}

/** Build the feedback-board projection. Pure; safe to memoize on the
 *  caller side keyed by state.reviews/comments + edits identity. */
export function buildFeedbackBoards(
  state: ProjectReviewState,
  edits: WebReviewEdit[],
): ProjectFeedbackBoards {
  const editsByReview = new Map<string, WebReviewEdit[]>()
  for (const e of edits) {
    const arr = editsByReview.get(e.review_id) ?? []
    arr.push(e)
    editsByReview.set(e.review_id, arr)
  }

  const commentsByReview = new Map<string, WebReviewComment[]>()
  for (const c of state.comments) {
    const arr = commentsByReview.get(c.review_id) ?? []
    arr.push(c)
    commentsByReview.set(c.review_id, arr)
  }

  const boards: FeedbackBoard[] = state.reviews.map(r => {
    const comments = commentsByReview.get(r.id) ?? []
    const open     = comments.filter(c => c.status === 'open').length
    const resolved = comments.length - open
    return {
      reviewId:      r.id,
      kind:          r.kind,
      roundNumber:   r.round_number,
      label:         roundLabel(r),
      status:        normalizeBoardStatus(r.status),
      startedAt:     r.started_at,
      startedByName: r.started_by_name,
      partnerName:   r.partner_name,
      partnerToken:  r.partner_token,
      comments,
      edits:         editsByReview.get(r.id) ?? [],
      counts: { open, resolved, total: comments.length },
    }
  })
  // Sort by (kind, roundNumber) descending — newest first within each
  // kind. Partner reviews are typically rarer; staff usually wants
  // their own internal rounds at the top, so internal comes first when
  // round numbers tie.
  boards.sort((a, b) => {
    if (a.roundNumber !== b.roundNumber) return b.roundNumber - a.roundNumber
    if (a.kind !== b.kind) return a.kind === 'internal' ? -1 : 1
    return b.startedAt.localeCompare(a.startedAt)
  })

  const byTab: Record<string, FeedbackBoard[]> = { all: [...boards] }
  for (const b of boards) {
    const key = `${b.kind}-${b.roundNumber}`  // e.g. 'internal-2'
    byTab[key] = [b]
  }

  // Collect unique assignees across every comment for the filter.
  const seen = new Map<string, FeedbackAssignee>()
  for (const board of boards) {
    for (const c of board.comments) {
      if (!c.assignee_name && !c.assignee_email) continue
      const id = c.assignee_user_id ?? c.assignee_email ?? c.assignee_name!
      if (!seen.has(id)) {
        seen.set(id, {
          id,
          name:  c.assignee_name  ?? c.assignee_email ?? 'Unassigned',
          email: c.assignee_email ?? null,
        })
      }
    }
  }

  return {
    boards,
    byTab,
    assignees: Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name)),
  }
}
