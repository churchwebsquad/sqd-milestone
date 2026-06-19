/**
 * Web Manager — Review workspace.
 *
 * Renders the feedback board kanban as the default landing for the
 * Review tab. When the current user already has an open internal
 * review, the embedded InternalReviewWorkspace surfaces as a
 * drill-down with a breadcrumb back to the kanban.
 *
 * Top-bar action group exposes "Get partner review link", "Start an
 * internal review", and "Request a review" persistently (no longer
 * empty-state-only) so the strategist can mutate review state from
 * the same surface they're triaging in.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Loader2, Plus, Copy, Check, UserPlus, Inbox, X,
} from 'lucide-react'
import {
  loadProjectReviewState, loadProjectReviewEdits, listReviewRequests,
  buildFeedbackBoards, cancelReviewRequest, startReview,
  type ProjectReviewState,
} from '../../../lib/webReviews'
import { useAuth } from '../../../contexts/AuthContext'
import { WMButton } from '../Button'
import { RequestReviewModal } from '../RequestReviewModal'
import { InternalReviewWorkspace } from './InternalReviewWorkspace'
import { FeedbackBoardKanban } from '../feedback/FeedbackBoardKanban'
import { FeedbackTabs } from '../feedback/FeedbackTabs'
import { AssigneeFilter } from '../feedback/AssigneeFilter'
import { useFeedbackActions } from '../feedback/useFeedbackActions'
import { supabase } from '../../../lib/supabase'
import type {
  StrategyWebProject, WebReviewRequest, WebReviewEdit, WebReviewComment,
} from '../../../types/database'

interface Props {
  project: StrategyWebProject
}

export function ReviewWorkspace({ project }: Props) {
  const { user } = useAuth()
  const [, setSearch] = useSearchParams()
  const [state, setState] = useState<ProjectReviewState | null>(null)
  const [edits, setEdits] = useState<WebReviewEdit[]>([])
  const [requests, setRequests] = useState<WebReviewRequest[]>([])
  const [pageById, setPageById] = useState<Record<string, { id: string; name: string }>>({})
  const [sectionLabelById, setSectionLabelById] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [requestModalOpen, setRequestModalOpen] = useState(false)
  const [partnerLinkCopied, setPartnerLinkCopied] = useState(false)
  const [internalLinkCopied, setInternalLinkCopied] = useState(false)

  // Filter + tab state for the kanban.
  const [activeTab, setActiveTab] = useState<string>('all')
  const [selectedAssignees, setSelectedAssignees] = useState<Set<string>>(new Set())
  // When the kanban is the active surface, the embedded editor is
  // hidden. Users opt into the editor explicitly via the top-bar
  // button. Persists in a query param so deep-links into the editor
  // survive page reloads.
  const [forceEditor, setForceEditor] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [s, e, r] = await Promise.all([
      loadProjectReviewState(project.id),
      loadProjectReviewEdits(project.id),
      listReviewRequests(project.id),
    ])
    setState(s)
    setEdits(e)
    setRequests(r)

    // Resolve page + section labels for every comment + edit location.
    const pageIds = Array.from(new Set([
      ...e.map(x => x.web_page_id),
      ...s.comments.map(c => c.web_page_id),
    ]))
    const sectionIds = Array.from(new Set([
      ...e.map(x => x.web_section_id),
      ...s.comments.map(c => c.web_section_id).filter((x): x is string => !!x),
    ]))
    if (pageIds.length > 0) {
      const { data: pages } = await supabase
        .from('web_pages')
        .select('id, name')
        .in('id', pageIds)
      const pmap: Record<string, { id: string; name: string }> = {}
      for (const p of (pages ?? []) as Array<{ id: string; name: string }>) pmap[p.id] = p
      setPageById(pmap)
    }
    if (sectionIds.length > 0) {
      const { data: sections } = await supabase
        .from('web_sections')
        .select('id, content_template_id, sort_order')
        .in('id', sectionIds)
      const tplIds = Array.from(new Set(
        ((sections ?? []) as Array<{ content_template_id: string | null }>)
          .map(s => s.content_template_id).filter((x): x is string => !!x),
      ))
      const tplMap: Record<string, string> = {}
      if (tplIds.length > 0) {
        const { data: tpls } = await supabase
          .from('web_content_templates')
          .select('id, layer_name')
          .in('id', tplIds)
        for (const t of (tpls ?? []) as Array<{ id: string; layer_name: string | null }>) {
          tplMap[t.id] = t.layer_name ?? 'Section'
        }
      }
      const smap: Record<string, string> = {}
      for (const sec of (sections ?? []) as Array<{ id: string; content_template_id: string | null; sort_order: number | null }>) {
        smap[sec.id] = sec.content_template_id
          ? (tplMap[sec.content_template_id] ?? 'Section')
          : `Section · ${(sec.sort_order ?? 0) + 1}`
      }
      setSectionLabelById(smap)
    }

    setLoading(false)
  }, [project.id])

  useEffect(() => { void load() }, [load])

  const actions = useFeedbackActions({ projectId: project.id, onChanged: load })

  // Shared internal-review round semantics: an open internal review
  // is a round any staff can contribute to (not pinned to the
  // starter). The drill-down editor binds to the most recent open
  // internal review on the project. To start a fresh round, the
  // current one must be closed first.
  const activeInternal = state?.open_reviews
    .filter(r => r.kind === 'internal')
    .sort((a, b) => b.round_number - a.round_number)[0] ?? null

  const myEmail = user?.email?.toLowerCase().trim() ?? ''
  const pendingForMe = requests.filter(
    r => r.status === 'pending' && r.assignee_email?.toLowerCase() === myEmail,
  )
  const pendingFromMe = requests.filter(
    r => r.status === 'pending' && r.requester_user_id === user?.id,
  )

  const handleStartInternal = async (fromRequestId?: string) => {
    // Use startReview directly so we can pass fromRequestId — the
    // shared hook's wrapper doesn't accept request linkage today.
    //
    // Internal reviews now generate a shareable token (mirroring
    // partner reviews) so the strategist can hand the link to a
    // teammate. Copy on success + flip the button to 'Link copied'
    // for 2.5s. Skip the auto-drill-into-editor — copying a link
    // signals sharing, not editing; the user can step into the
    // editor on their own from this same tab.
    const res = await startReview({
      projectId: project.id, kind: 'internal', fromRequestId,
    })
    if (res.ok) {
      await load()
      const token = res.data?.partner_token
      if (token) {
        const url = `${window.location.origin}/portal/review/${token}`
        try {
          await navigator.clipboard.writeText(url)
          setInternalLinkCopied(true)
          setTimeout(() => setInternalLinkCopied(false), 2500)
        } catch {
          window.prompt('Internal review link — paste it to a teammate:', url)
        }
      }
    }
  }

  const handleGetPartnerLink = async () => {
    const url = await actions.getPartnerReviewLink()
    if (url) {
      setPartnerLinkCopied(true)
      setTimeout(() => setPartnerLinkCopied(false), 2500)
    }
  }

  const handleCancelRequest = async (requestId: string) => {
    if (!confirm('Cancel this review request?')) return
    await cancelReviewRequest(requestId)
    await load()
  }

  // Build feedback boards from state + edits.
  const feedbackBoards = useMemo(() => {
    if (!state) return null
    return buildFeedbackBoards(state, edits)
  }, [state, edits])

  const visibleBoards = feedbackBoards
    ? (activeTab === 'all'
        ? feedbackBoards.boards
        : (feedbackBoards.byTab[activeTab] ?? []))
    : []

  const commentFilter = selectedAssignees.size === 0
    ? undefined
    : (c: WebReviewComment) => {
        const id = c.assignee_user_id ?? c.assignee_email ?? c.assignee_name ?? ''
        return selectedAssignees.has(id)
      }

  const pageNameFor    = (id: string) => pageById[id]?.name ?? null
  const sectionLabelFor = (id: string | null) => (id ? (sectionLabelById[id] ?? null) : null)

  /** Click handler on a card's page/section pill — drill into the
   *  embedded review editor at that section when an internal round is
   *  open (so the user can resolve in context), or fall back to the
   *  Pages workspace when no round is active. */
  const jumpToSection = (pageId: string, sectionId: string) => {
    setSearch(prev => {
      const next = new URLSearchParams(prev)
      // Stay on the Review tab so we drop into InternalReviewWorkspace's
      // canvas rather than yanking the user to a different surface.
      next.set('tab', 'review')
      next.set('page', pageId)
      next.set('section', sectionId)
      return next
    })
    if (activeInternal) {
      setForceEditor(true)
    } else {
      // No open round to drop into — fall back to the Pages tab so
      // the strategist can at least see the section.
      setSearch(prev => {
        const next = new URLSearchParams(prev)
        next.set('tab', 'pages')
        next.set('page', pageId)
        next.set('section', sectionId)
        return next
      })
    }
  }

  if (loading) {
    return (
      <div className="p-8 grid place-items-center text-wm-text-muted">
        <Loader2 className="animate-spin" />
      </div>
    )
  }

  // Drill-down editor — only when the user has an active internal
  // review AND has chosen to enter it (or just started one).
  if (forceEditor && activeInternal) {
    return (
      <InternalReviewWorkspace
        project={project}
        review={activeInternal}
        onExitToInbox={() => setForceEditor(false)}
        onReviewChange={load}
      />
    )
  }

  return (
    <div className="px-6 md:px-8 py-6 flex flex-col gap-5 min-w-0">
      {/* Top bar — title + actions */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[22px] font-bold text-wm-text leading-tight">Feedback</h1>
          {feedbackBoards && (
            <p className="text-[12px] text-wm-text-muted">
              {feedbackBoards.boards.reduce((n, b) => n + b.counts.open, 0)} open ·{' '}
              {feedbackBoards.boards.reduce((n, b) => n + b.counts.resolved, 0)} resolved
              {' · '}
              {feedbackBoards.boards.length} round{feedbackBoards.boards.length === 1 ? '' : 's'}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {activeInternal && (
            <WMButton
              variant="secondary"
              size="sm"
              onClick={() => setForceEditor(true)}
            >
              Add internal review feedback
            </WMButton>
          )}
          <WMButton
            variant="secondary"
            size="sm"
            iconLeft={
              actions.busy ? <Loader2 size={11} className="animate-spin" /> :
              partnerLinkCopied ? <Check size={11} /> :
              <Copy size={11} />
            }
            onClick={() => void handleGetPartnerLink()}
            disabled={actions.busy}
          >
            {partnerLinkCopied ? 'Link copied' : 'Get partner review link'}
          </WMButton>
          {!activeInternal && (
            <WMButton
              variant="secondary"
              size="sm"
              iconLeft={
                actions.busy ? <Loader2 size={11} className="animate-spin" /> :
                internalLinkCopied ? <Check size={11} /> :
                <Plus size={11} />
              }
              onClick={() => void handleStartInternal()}
              disabled={actions.busy}
              title="Open a fresh internal review round and copy a shareable link to your clipboard."
            >
              {internalLinkCopied
                ? 'Internal link copied'
                : `Start internal review ${nextInternalRoundLabel(state)}`}
            </WMButton>
          )}
          <WMButton
            variant="primary"
            size="sm"
            iconLeft={<UserPlus size={11} />}
            onClick={() => setRequestModalOpen(true)}
            disabled={actions.busy}
          >
            Request a review
          </WMButton>
        </div>
      </header>

      {actions.lastError && (
        <div role="alert" className="rounded-md border border-wm-danger/40 bg-wm-danger-bg px-3 py-2 text-[12px] text-wm-danger flex items-start gap-2">
          <X size={14} className="mt-0.5 shrink-0" />
          <p className="flex-1 leading-snug">{actions.lastError}</p>
        </div>
      )}

      {/* Pending requests assigned to the current user — banner above
          the kanban so they can't be missed. */}
      {pendingForMe.length > 0 && (
        <div className="rounded-xl border border-wm-accent/30 bg-wm-accent-tint/40 px-4 py-3 flex flex-col gap-2">
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong">
            Reviews requested of you · {pendingForMe.length}
          </p>
          {pendingForMe.map(req => (
            <div key={req.id} className="flex items-center gap-2 flex-wrap">
              <Inbox size={11} className="text-wm-accent-strong" />
              <p className="text-[12px] text-wm-text">
                <span className="font-semibold">{req.requester_name ?? 'A teammate'}</span>
                {req.notes ? `: "${req.notes}"` : ' asked you to review.'}
              </p>
              <WMButton
                variant="primary"
                size="sm"
                iconLeft={<Plus size={11} />}
                onClick={() => void handleStartInternal(req.id)}
                disabled={actions.busy}
                className="ml-auto"
              >
                Start this review
              </WMButton>
            </div>
          ))}
        </div>
      )}

      {/* Filter row + tabs */}
      {feedbackBoards && feedbackBoards.boards.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          {feedbackBoards.assignees.length > 0 && (
            <AssigneeFilter
              available={feedbackBoards.assignees}
              selectedIds={selectedAssignees}
              onChange={setSelectedAssignees}
            />
          )}
          <FeedbackTabs
            boards={feedbackBoards}
            active={activeTab}
            onChange={setActiveTab}
          />
        </div>
      )}

      {/* Kanban */}
      {feedbackBoards && (
        <FeedbackBoardKanban
          boards={visibleBoards}
          pageNameFor={pageNameFor}
          sectionLabelFor={sectionLabelFor}
          onJumpToLocation={(c) => {
            if (c.web_section_id) jumpToSection(c.web_page_id, c.web_section_id)
          }}
          onChanged={load}
          filter={commentFilter}
        />
      )}

      {/* Outgoing pending requests — small footer list. */}
      {pendingFromMe.length > 0 && (
        <div className="rounded-md border border-wm-border bg-wm-bg-elevated px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1.5">
            Reviews you've requested · {pendingFromMe.length}
          </p>
          <ul className="space-y-1.5">
            {pendingFromMe.map(req => (
              <li key={req.id} className="text-[12px] flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <p>
                    Waiting on{' '}
                    <span className="font-semibold">{req.assignee_name ?? req.assignee_email}</span>
                  </p>
                  {req.notes && (
                    <p className="text-[11px] text-wm-text-muted italic line-clamp-1">"{req.notes}"</p>
                  )}
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

/** Label for the "Start internal review" CTA — predicts the next
 *  round number so staff knows what they're spinning up ("Round 1" vs
 *  "Round 2"). Pure derivation from the loaded review list. */
function nextInternalRoundLabel(state: ProjectReviewState | null): string {
  if (!state) return ''
  const maxInternal = state.reviews
    .filter(r => r.kind === 'internal')
    .reduce((m, r) => Math.max(m, r.round_number), 0)
  return `· Round ${maxInternal + 1}`
}
