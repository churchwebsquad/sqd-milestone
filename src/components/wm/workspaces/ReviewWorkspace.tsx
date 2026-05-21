/**
 * Web Manager — Review workspace.
 *
 * Three states:
 *   1. Active internal review (started by ME) → InternalReviewWorkspace.
 *   2. No active review but pending requests assigned TO ME → list
 *      them with "Start review for this request" CTAs.
 *   3. Otherwise → empty state with Start / Request CTAs.
 *
 * Coworkers' open reviews surface in the Feedback panel — they don't
 * take over this tab.
 */

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus, Eye, X, UserPlus, Inbox } from 'lucide-react'
import {
  loadProjectReviewState, startReview, listReviewRequests,
  cancelReviewRequest, type ProjectReviewState,
} from '../../../lib/webReviews'
import { useAuth } from '../../../contexts/AuthContext'
import { WMButton } from '../Button'
import { RequestReviewModal } from '../RequestReviewModal'
import { InternalReviewWorkspace } from './InternalReviewWorkspace'
import type { StrategyWebProject, WebReviewRequest } from '../../../types/database'

interface Props {
  project: StrategyWebProject
}

export function ReviewWorkspace({ project }: Props) {
  const { user } = useAuth()
  const [state, setState] = useState<ProjectReviewState | null>(null)
  const [requests, setRequests] = useState<WebReviewRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [mutating, setMutating] = useState(false)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [requestModalOpen, setRequestModalOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [s, r] = await Promise.all([
      loadProjectReviewState(project.id),
      listReviewRequests(project.id),
    ])
    setState(s)
    setRequests(r)
    setLoading(false)
  }, [project.id])

  useEffect(() => { void load() }, [load])

  // Active internal review is PER-USER.
  const activeInternal = state?.open_reviews.find(
    r => r.kind === 'internal' && r.started_by_user_id === user?.id,
  ) ?? null

  // Pending requests assigned to the current user — matched by email.
  const myEmail = user?.email?.toLowerCase().trim() ?? ''
  const pendingForMe = requests.filter(
    r => r.status === 'pending' && r.assignee_email?.toLowerCase() === myEmail,
  )
  // Pending requests THE CURRENT USER sent (so they can cancel).
  const pendingFromMe = requests.filter(
    r => r.status === 'pending' && r.requester_user_id === user?.id,
  )

  const handleStart = async (fromRequestId?: string) => {
    setMutating(true)
    setMutationError(null)
    const res = await startReview({ projectId: project.id, kind: 'internal', fromRequestId })
    setMutating(false)
    if (res.ok) {
      await load()
    } else {
      setMutationError(
        `Couldn't start internal review: ${res.error ?? 'unknown error'}. ` +
        `Check that you're signed in and refresh the page if the issue persists.`,
      )
    }
  }

  const handleCancelRequest = async (requestId: string) => {
    if (!confirm('Cancel this review request?')) return
    await cancelReviewRequest(requestId)
    await load()
  }

  if (loading) {
    return (
      <div className="p-8 grid place-items-center text-wm-text-muted">
        <Loader2 className="animate-spin" />
      </div>
    )
  }

  // Active internal review → editing workspace.
  if (activeInternal) {
    return (
      <InternalReviewWorkspace
        project={project}
        review={activeInternal}
        onExitToInbox={() => {}}
        onReviewChange={load}
      />
    )
  }

  return (
    <div className="px-6 md:px-10 py-16">
      <div className="max-w-md mx-auto">
        {/* Pending requests assigned to me — surfaced ABOVE the empty
            state since they're the highest-signal action. */}
        {pendingForMe.length > 0 && (
          <div className="mb-8 space-y-2">
            <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong mb-2">
              Reviews requested of you · {pendingForMe.length}
            </p>
            {pendingForMe.map(req => (
              <div
                key={req.id}
                className="rounded-xl border border-wm-accent/30 bg-wm-accent-tint/40 px-4 py-3"
              >
                <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                  <Inbox size={11} className="text-wm-accent-strong" />
                  <p className="text-[12px] font-semibold text-wm-text">
                    {req.requester_name ?? 'A staff member'} asked you to review
                  </p>
                  <span className="ml-auto text-[10px] text-wm-text-subtle">
                    {fmtDateTime(req.created_at)}
                  </span>
                </div>
                {req.notes && (
                  <p className="text-[12px] text-wm-text-muted leading-snug whitespace-pre-wrap mb-2">
                    "{req.notes}"
                  </p>
                )}
                <WMButton
                  variant="primary"
                  size="sm"
                  iconLeft={mutating ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                  onClick={() => void handleStart(req.id)}
                  disabled={mutating}
                >
                  Start this review
                </WMButton>
              </div>
            ))}
          </div>
        )}

        {/* Empty-state CTA */}
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-full grid place-items-center bg-wm-accent-tint text-wm-accent-strong">
            <Eye size={20} />
          </div>
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong mb-1">
            Review
          </p>
          <h1 className="text-xl font-semibold text-wm-text mb-2">
            Ready to review this website?
          </h1>
          <p className="text-[13px] text-wm-text-muted leading-snug mb-5">
            Internal reviews are personal to each staff member &mdash; start one
            to walk through the site, leave your own comments, suggest edits, and
            capture every change request before sending the partner review link.
            Reviews started by other staff and partner reviews all roll up in the
            Feedback panel on the right.
          </p>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <WMButton
              variant="primary"
              size="md"
              iconLeft={mutating ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              onClick={() => void handleStart()}
              disabled={mutating}
            >
              Start an internal review
            </WMButton>
            <WMButton
              variant="secondary"
              size="md"
              iconLeft={<UserPlus size={13} />}
              onClick={() => setRequestModalOpen(true)}
            >
              Request a review
            </WMButton>
          </div>
        </div>

        {/* Outgoing requests — let the user see + cancel anything
            they've already asked for. */}
        {pendingFromMe.length > 0 && (
          <div className="mt-8 pt-6 border-t border-wm-border/60">
            <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-2">
              Reviews you've requested · {pendingFromMe.length}
            </p>
            <ul className="space-y-1.5">
              {pendingFromMe.map(req => (
                <li key={req.id} className="rounded-md border border-wm-border bg-wm-bg-elevated px-3 py-2 text-[12px] text-wm-text flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p>
                      Waiting on <span className="font-semibold">{req.assignee_name ?? req.assignee_email}</span>
                    </p>
                    {req.notes && (
                      <p className="text-[11px] text-wm-text-muted italic line-clamp-2 mt-0.5">"{req.notes}"</p>
                    )}
                    <p className="text-[10px] text-wm-text-subtle mt-0.5">{fmtDateTime(req.created_at)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCancelRequest(req.id)}
                    className="text-[11px] font-semibold text-wm-text-muted hover:text-wm-danger shrink-0"
                  >
                    Cancel
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {mutationError && (
          <div
            role="alert"
            className="mt-4 rounded-md border border-wm-danger/40 bg-wm-danger-bg px-3 py-2 text-[12px] text-wm-danger flex items-start gap-2 text-left"
          >
            <X size={14} className="mt-0.5 shrink-0" />
            <p className="flex-1 leading-snug">{mutationError}</p>
            <button
              type="button"
              onClick={() => setMutationError(null)}
              className="text-[11px] font-semibold opacity-70 hover:opacity-100"
              aria-label="Dismiss error"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {requestModalOpen && (
        <RequestReviewModal
          projectId={project.id}
          currentEmail={user?.email ?? null}
          onClose={() => setRequestModalOpen(false)}
          onCreated={load}
        />
      )}
    </div>
  )
}

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })
  } catch { return iso }
}
