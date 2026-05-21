/**
 * Web Manager — Review workspace.
 *
 * Two states:
 *   1. No internal review open → centered empty state with a single
 *      "Start an internal review" CTA.
 *   2. Internal review open → renders InternalReviewWorkspace (the
 *      portal-style staff editing surface).
 *
 * The earlier inbox / queue view moved into the AssistantRail's
 * Feedback tab — there's only one mode now, "review mode", which
 * eliminates the inbox/workspace toggle confusion.
 */

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus, Eye, X } from 'lucide-react'
import {
  loadProjectReviewState, startReview, type ProjectReviewState,
} from '../../../lib/webReviews'
import { useAuth } from '../../../contexts/AuthContext'
import { WMButton } from '../Button'
import { InternalReviewWorkspace } from './InternalReviewWorkspace'
import type { StrategyWebProject } from '../../../types/database'

interface Props {
  project: StrategyWebProject
}

export function ReviewWorkspace({ project }: Props) {
  const { user } = useAuth()
  const [state, setState] = useState<ProjectReviewState | null>(null)
  const [loading, setLoading] = useState(true)
  const [mutating, setMutating] = useState(false)
  const [mutationError, setMutationError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setState(await loadProjectReviewState(project.id))
    setLoading(false)
  }, [project.id])

  useEffect(() => { void load() }, [load])

  // Internal reviews are PER-USER. The Review tab only flips into
  // workspace mode for the current staff member's own open internal
  // review — coworkers' open reviews surface in the Feedback panel
  // but don't take over this tab.
  const activeInternal = state?.open_reviews.find(
    r => r.kind === 'internal' && r.started_by_user_id === user?.id,
  ) ?? null

  const handleStart = async () => {
    setMutating(true)
    setMutationError(null)
    const res = await startReview({ projectId: project.id, kind: 'internal' })
    setMutating(false)
    if (res.ok) {
      await load()
    } else {
      setMutationError(
        `Couldn't start internal review: ${res.error ?? 'unknown error'}. ` +
        `Check that you're signed in and refresh the page if the issue persists.`
      )
    }
  }

  if (loading) {
    return (
      <div className="p-8 grid place-items-center text-wm-text-muted">
        <Loader2 className="animate-spin" />
      </div>
    )
  }

  // Active internal review → portal-style editing workspace handles
  // everything from here. onExitToInbox is now a no-op (the inbox
  // moved to the rail).
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

  // Empty state — single CTA to kick off an internal review.
  return (
    <div className="px-6 md:px-10 py-16">
      <div className="max-w-md mx-auto text-center">
        <div className="mx-auto mb-4 h-12 w-12 rounded-full grid place-items-center bg-wm-accent-tint text-wm-accent-strong">
          <Eye size={20} />
        </div>
        <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong mb-1">
          Review
        </p>
        <h1 className="text-xl font-semibold text-wm-text mb-2">
          You don't have an internal review open
        </h1>
        <p className="text-[13px] text-wm-text-muted leading-snug mb-5">
          Internal reviews are personal to each staff member &mdash; start one
          to walk through the site, leave your own comments, suggest edits, and
          capture every change request before sending the partner review link.
          Reviews started by other staff and partner reviews all roll up in the
          Feedback panel on the right.
        </p>
        <WMButton
          variant="primary"
          size="md"
          iconLeft={mutating ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
          onClick={() => void handleStart()}
          disabled={mutating}
        >
          Start an internal review
        </WMButton>
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
    </div>
  )
}
