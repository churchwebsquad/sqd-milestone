/**
 * Shared action wrappers for the feedback UI surfaces.
 *
 * Both the rail and the Review tab want the same three buttons —
 * Get partner review link, Start internal review, Request a review —
 * with the same toast / error handling. Centralizing avoids drift
 * (the rail and tab were previously implementing partner-link copy
 * differently).
 */
import { useState, useCallback } from 'react'
import {
  startReview, cancelReviewRequest, closeReview, setBoardStatus,
} from '../../../lib/webReviews'
import type { BoardStatus, WebReview, WebReviewRequest } from '../../../types/database'

export interface UseFeedbackActionsOpts {
  projectId: string
  /** Called after any successful mutation so the caller can refresh. */
  onChanged: () => void | Promise<void>
}

export interface FeedbackActions {
  busy: boolean
  lastError: string | null
  /** Start a new internal review and refresh. Resolves to the new
   *  review row on success. */
  startInternalReview: (notes?: string) => Promise<WebReview | null>
  /** Generate a partner review link and copy to clipboard. Returns
   *  the URL on success (null on failure). */
  getPartnerReviewLink: () => Promise<string | null>
  /** Close a review (writes 'completed' via closeReview). */
  closeBoard: (reviewId: string) => Promise<boolean>
  /** Set a board's status manually (no closure side-effects beyond
   *  the closed_at stamping handled by the mutator). */
  setStatus: (reviewId: string, status: BoardStatus) => Promise<boolean>
  /** Cancel a staff-to-staff request. */
  cancelRequest: (requestId: string) => Promise<boolean>
  /** Build the public partner portal URL for an existing token. */
  partnerUrlFor: (token: string) => string
}

export function useFeedbackActions({
  projectId, onChanged,
}: UseFeedbackActionsOpts): FeedbackActions {
  const [busy, setBusy] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)

  const partnerUrlFor = useCallback((token: string) => {
    return `${window.location.origin}/portal/review/${token}`
  }, [])

  const startInternalReview = useCallback(async (notes?: string) => {
    setBusy(true); setLastError(null)
    const { ok, data, error } = await startReview({
      projectId, kind: 'internal', notes,
    })
    setBusy(false)
    if (!ok) { setLastError(error); return null }
    await onChanged()
    return data
  }, [projectId, onChanged])

  const getPartnerReviewLink = useCallback(async () => {
    setBusy(true); setLastError(null)
    const { ok, data, error } = await startReview({ projectId, kind: 'partner' })
    setBusy(false)
    if (!ok || !data?.partner_token) {
      setLastError(error ?? 'Failed to generate partner review')
      return null
    }
    const url = partnerUrlFor(data.partner_token)
    try { await navigator.clipboard.writeText(url) } catch { /* clipboard unavailable; caller can surface */ }
    await onChanged()
    return url
  }, [projectId, onChanged, partnerUrlFor])

  const closeBoard = useCallback(async (reviewId: string) => {
    setBusy(true); setLastError(null)
    const { ok, error } = await closeReview(reviewId)
    setBusy(false)
    if (!ok) { setLastError(error); return false }
    await onChanged()
    return true
  }, [onChanged])

  const setStatus = useCallback(async (reviewId: string, status: BoardStatus) => {
    setBusy(true); setLastError(null)
    const ok = await setBoardStatus(reviewId, status)
    setBusy(false)
    if (ok) await onChanged()
    return ok
  }, [onChanged])

  const cancelRequest = useCallback(async (requestId: string) => {
    setBusy(true)
    const ok = await cancelReviewRequest(requestId)
    setBusy(false)
    if (ok) await onChanged()
    return ok
  }, [onChanged])

  return {
    busy, lastError,
    startInternalReview, getPartnerReviewLink,
    closeBoard, setStatus, cancelRequest,
    partnerUrlFor,
  }
}

// Helper for surfaces that show pending review requests.
export function describeRequest(req: WebReviewRequest): string {
  const who = req.requester_name ?? 'A teammate'
  return req.notes
    ? `${who} requested a review: ${req.notes}`
    : `${who} requested a review.`
}
