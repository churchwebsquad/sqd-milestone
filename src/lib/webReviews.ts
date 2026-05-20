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
  WebReview, WebReviewComment, WebReviewCommentStatus,
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
  const open_reviews = reviews.filter(r => r.status === 'open')
  const open_partner = open_reviews.filter(r => r.kind === 'partner')
  const open_internal = open_reviews.filter(r => r.kind === 'internal')
  const last_closed = reviews.find(r => r.status === 'closed') ?? null

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

/** Start a new review session on the project. For partner reviews we
 *  generate the opaque token used by the public portal URL. */
export async function startReview(opts: {
  projectId: string
  kind: 'internal' | 'partner'
  notes?: string
}): Promise<WebReview | null> {
  const partner_token = opts.kind === 'partner' ? crypto.randomUUID().replace(/-/g, '') : null
  const { data: user } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('web_reviews')
    .insert({
      web_project_id:     opts.projectId,
      kind:               opts.kind,
      status:             'open',
      started_by_user_id: user?.user?.id ?? null,
      partner_token,
      notes:              opts.notes ?? null,
    } as never)
    .select('*')
    .maybeSingle()
  if (error) {
    console.error('[reviews] startReview failed:', error.message)
    return null
  }
  return data as WebReview | null
}

/** Close a review. Open comments stay attached to their pages and
 *  carry into the next review session. */
export async function closeReview(reviewId: string): Promise<boolean> {
  const { data: user } = await supabase.auth.getUser()
  const { error } = await supabase
    .from('web_reviews')
    .update({
      status:            'closed',
      closed_at:         new Date().toISOString(),
      closed_by_user_id: user?.user?.id ?? null,
    } as never)
    .eq('id', reviewId)
  if (error) {
    console.error('[reviews] closeReview failed:', error.message)
    return false
  }
  return true
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

  // 1. If this resolution involves a real field write, patch the
  //    section's field_values first. (Doing it before marking the
  //    comment resolved means an error here leaves the comment open
  //    rather than recording a phantom resolution.)
  if ((opts.outcome === 'applied' || opts.outcome === 'amended') && opts.sectionToPatch) {
    const { sectionId, fieldKey, currentFieldValues } = opts.sectionToPatch
    const next = { ...currentFieldValues, [fieldKey]: opts.finalValue }
    const { error: patchErr } = await supabase
      .from('web_sections')
      .update({ field_values: next } as never)
      .eq('id', sectionId)
    if (patchErr) {
      console.error('[reviews] resolveComment patch failed:', patchErr.message)
      return false
    }
  }

  const { error } = await supabase
    .from('web_review_comments')
    .update({
      status:              opts.outcome,
      resolved_by_user_id: user?.user?.id ?? null,
      resolved_at:         new Date().toISOString(),
      resolution_note:     opts.resolutionNote ?? null,
    } as never)
    .eq('id', opts.commentId)
  if (error) {
    console.error('[reviews] resolveComment failed:', error.message)
    return false
  }
  return true
}
