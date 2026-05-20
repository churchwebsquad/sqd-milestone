/**
 * Web Manager — Review workspace.
 *
 * Two-section layout:
 *
 *   1. Active sessions — cards listing every open review on the
 *      project. Each card shows kind (internal/partner), who started
 *      it, when, and open-comment counts. Closed reviews collapse
 *      into a "closed" footer.
 *
 *   2. Comments inbox — flat, filterable list of every comment
 *      across all reviews. Filters: review session, status, kind
 *      (comment/suggested/requested), page. Each row shows author,
 *      target (page → section → field), body / suggested value
 *      preview, and a jump-to-page link.
 *
 * Resolution actions (Apply / Amend / Dismiss) ship in Phase E.
 * Phase B is read-only: surface the work, get the strategist
 * oriented, deep-link into Pages for in-context handling.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Eye, Loader2, MessageSquare, ChevronRight, Filter, Inbox,
  ArrowRight, Check, X, Clock, Plus, Link as LinkIcon, Copy,
} from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { WMButton } from '../Button'
import { WMStatusPill } from '../StatusPill'
import { CommentActions } from '../sectioneditor/CommentActions'
import {
  loadProjectReviewState, startReview, closeReview,
  type ProjectReviewState,
} from '../../../lib/webReviews'
import type {
  StrategyWebProject, WebPage, WebSection, WebContentTemplate,
  WebReview, WebReviewComment, WebReviewCommentKind, WebReviewCommentStatus,
} from '../../../types/database'

interface Props {
  project: StrategyWebProject
}

type StatusFilter = 'all' | 'open' | 'resolved'
type KindFilter   = 'all' | 'comment' | 'suggested' | 'requested'

export function ReviewWorkspace({ project }: Props) {
  const [, setParams] = useSearchParams()
  const [state, setState] = useState<ProjectReviewState | null>(null)
  const [pages, setPages] = useState<Record<string, WebPage>>({})
  const [sections, setSections] = useState<Record<string, WebSection>>({})
  const [templates, setTemplates] = useState<Record<string, Pick<WebContentTemplate, 'id' | 'layer_name'>>>({})
  const [loading, setLoading] = useState(true)

  // Filters
  const [reviewFilter, setReviewFilter] = useState<string | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open')
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [pageFilter, setPageFilter] = useState<string | 'all'>('all')

  // Surfaces mutation failures (RLS denial, network, etc.) so the
  // user sees feedback instead of a silent no-op.
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [mutating, setMutating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const projectState = await loadProjectReviewState(project.id)

    // Load page + section lookups for display. Sections only need to
    // be loaded for the ones referenced in comments.
    const pageIds = Array.from(new Set(projectState.comments.map(c => c.web_page_id).filter(Boolean)))
    const sectionIds = Array.from(new Set(projectState.comments.map(c => c.web_section_id).filter((s): s is string => !!s)))

    const [{ data: pageRows }, { data: sectionRows }] = await Promise.all([
      supabase.from('web_pages').select('id, name, slug, web_project_id').eq('web_project_id', project.id),
      sectionIds.length > 0
        ? supabase.from('web_sections').select('*').in('id', sectionIds)
        : Promise.resolve({ data: [] as WebSection[] }),
    ])

    const pageMap: Record<string, WebPage> = {}
    for (const p of (pageRows ?? []) as WebPage[]) pageMap[p.id] = p
    const sectionMap: Record<string, WebSection> = {}
    for (const s of (sectionRows ?? []) as WebSection[]) sectionMap[s.id] = s

    // Templates for section labels
    const templateIds = Array.from(new Set(
      (sectionRows ?? []).map((s: WebSection) => s.content_template_id).filter((t): t is string => !!t),
    ))
    const tplMap: Record<string, Pick<WebContentTemplate, 'id' | 'layer_name'>> = {}
    if (templateIds.length > 0) {
      const { data: tplRows } = await supabase
        .from('web_content_templates')
        .select('id, layer_name')
        .in('id', templateIds)
      for (const t of (tplRows ?? [])) tplMap[t.id] = t
    }

    setState(projectState)
    setPages(pageMap)
    setSections(sectionMap)
    setTemplates(tplMap)
    setLoading(false)

    void pageIds  // currently informational only
  }, [project.id])

  useEffect(() => { void load() }, [load])

  // ── Derived ──────────────────────────────────────────────────────

  const reviewById = useMemo(() => {
    const m = new Map<string, WebReview>()
    if (state) for (const r of state.reviews) m.set(r.id, r)
    return m
  }, [state])

  const filteredComments = useMemo(() => {
    if (!state) return []
    let list = [...state.comments]
    if (reviewFilter !== 'all') list = list.filter(c => c.review_id === reviewFilter)
    if (pageFilter !== 'all')   list = list.filter(c => c.web_page_id === pageFilter)
    if (kindFilter !== 'all')   list = list.filter(c => c.kind === kindFilter)
    if (statusFilter === 'open')     list = list.filter(c => c.status === 'open')
    if (statusFilter === 'resolved') list = list.filter(c => c.status !== 'open')
    list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    return list
  }, [state, reviewFilter, pageFilter, kindFilter, statusFilter])

  const jumpToPage = (pageId: string, sectionId?: string | null) => {
    const next = new URLSearchParams(window.location.search)
    next.set('tab', 'pages')
    next.set('page', pageId)
    if (sectionId) next.set('section', sectionId)
    else next.delete('section')
    setParams(next, { replace: false })
  }

  // ── Render ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="p-8 grid place-items-center text-wm-text-muted">
        <Loader2 className="animate-spin" />
      </div>
    )
  }

  // ── Mutations ────────────────────────────────────────────────────

  const handleStart = async (kind: 'internal' | 'partner') => {
    setMutating(true)
    setMutationError(null)
    const res = await startReview({ projectId: project.id, kind })
    setMutating(false)
    if (res.ok) {
      await load()
      // Internal reviews happen *on* the page canvas — drop the user
      // straight onto Pages so they don't have to navigate back manually
      // and hunt for the comment surface. Partner reviews stay here so
      // the strategist can grab the portal link.
      if (kind === 'internal') {
        const next = new URLSearchParams(window.location.search)
        next.set('tab', 'pages')
        setParams(next, { replace: false })
      }
    } else {
      setMutationError(
        `Couldn't start ${kind} review: ${res.error ?? 'unknown error'}. ` +
        `Check that you're signed in and refresh the page if the issue persists.`
      )
    }
  }
  const handleClose = async (reviewId: string) => {
    if (!confirm('Close this review session? Open comments stay attached to their pages and carry into the next session.')) return
    setMutating(true)
    setMutationError(null)
    const res = await closeReview(reviewId)
    setMutating(false)
    if (res.ok) {
      await load()
    } else {
      setMutationError(`Couldn't close review: ${res.error ?? 'unknown error'}.`)
    }
  }

  if (!state) return null

  const openReviews   = state.open_reviews
  const closedReviews = state.reviews.filter(r => r.status === 'closed')
  const showEmpty     = state.reviews.length === 0 && state.comments.length === 0

  return (
    <div className="p-6 md:p-8">
      <div className="max-w-5xl mx-auto">
        <Header />

        {/* Start buttons */}
        <div className="mb-6 flex items-center gap-2 flex-wrap">
          <WMButton
            variant="primary"
            size="md"
            iconLeft={mutating ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            onClick={() => void handleStart('internal')}
            disabled={mutating}
          >
            Start internal review
          </WMButton>
          <WMButton
            variant="secondary"
            size="md"
            iconLeft={mutating ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            onClick={() => void handleStart('partner')}
            disabled={mutating || state.has_open_partner}
            title={state.has_open_partner
              ? 'A partner review is already open. Close it before starting another.'
              : 'Generate a shareable partner-facing review link'}
          >
            Start partner review
          </WMButton>
          {state.has_open_partner && (
            <span className="text-[11px] text-wm-text-subtle italic">
              Partner review already open
            </span>
          )}
        </div>

        {mutationError && (
          <div
            role="alert"
            className="mb-6 rounded-md border border-wm-danger/40 bg-wm-danger-bg px-3 py-2 text-[12px] text-wm-danger flex items-start gap-2"
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

        {showEmpty && (
          <div className="mb-6 rounded-md border border-dashed border-wm-border bg-wm-bg-elevated p-8 text-center">
            <Eye size={20} className="text-wm-text-subtle mx-auto mb-2" />
            <p className="text-[13px] font-semibold text-wm-text">No reviews yet</p>
            <p className="text-[12px] text-wm-text-muted mt-1 max-w-md mx-auto leading-snug">
              Click <span className="font-semibold">Start internal review</span> above to open
              the first session. Comments + suggested edits attach to the open session as
              you work in Pages.
            </p>
          </div>
        )}

        {/* Active sessions */}
        {openReviews.length > 0 && (
          <section className="mb-6">
            <h2 className="text-[12px] font-semibold uppercase tracking-widest text-wm-text-subtle mb-2">
              Active sessions · {openReviews.length}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {openReviews.map(r => (
                <ReviewSessionCard
                  key={r.id}
                  review={r}
                  state={state}
                  onClick={() => setReviewFilter(r.id)}
                  onClose={() => void handleClose(r.id)}
                  highlighted={reviewFilter === r.id}
                />
              ))}
            </div>
          </section>
        )}

        {/* Filters */}
        <section className="mb-3 rounded-md border border-wm-border bg-wm-bg-elevated px-3 py-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Filter size={11} className="text-wm-text-subtle" />
            <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Filters</span>
            <FilterSelect
              label="Session"
              value={reviewFilter}
              onChange={setReviewFilter}
              options={[
                { value: 'all', label: 'All sessions' },
                ...state.reviews.map(r => ({
                  value: r.id,
                  label: `${r.kind === 'partner' ? 'Partner' : 'Internal'} · ${fmtDate(r.started_at)}`,
                })),
              ]}
            />
            <FilterSelect
              label="Page"
              value={pageFilter}
              onChange={setPageFilter}
              options={[
                { value: 'all', label: 'All pages' },
                ...Object.values(pages)
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map(p => ({ value: p.id, label: p.name })),
              ]}
            />
            <FilterSelect
              label="Kind"
              value={kindFilter}
              onChange={(v) => setKindFilter(v as KindFilter)}
              options={[
                { value: 'all',       label: 'All kinds' },
                { value: 'comment',   label: 'Comment' },
                { value: 'suggested', label: 'Suggested' },
                { value: 'requested', label: 'Requested' },
              ]}
            />
            <FilterSelect
              label="Status"
              value={statusFilter}
              onChange={(v) => setStatusFilter(v as StatusFilter)}
              options={[
                { value: 'open',     label: 'Open' },
                { value: 'resolved', label: 'Resolved' },
                { value: 'all',      label: 'All' },
              ]}
            />
            <span className="ml-auto text-[11px] text-wm-text-subtle">
              {filteredComments.length} item{filteredComments.length === 1 ? '' : 's'}
            </span>
          </div>
        </section>

        {/* Comments inbox */}
        {filteredComments.length === 0 ? (
          <div className="rounded-md border border-dashed border-wm-border bg-wm-bg-elevated p-6 text-center">
            <Inbox size={18} className="text-wm-text-subtle mx-auto mb-2" />
            <p className="text-[12px] font-semibold text-wm-text">No comments match these filters</p>
            <p className="text-[11px] text-wm-text-muted mt-1">Try widening the filters above.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {filteredComments.map(c => (
              <CommentRow
                key={c.id}
                comment={c}
                review={reviewById.get(c.review_id) ?? null}
                page={pages[c.web_page_id]}
                section={c.web_section_id ? sections[c.web_section_id] : undefined}
                template={(() => {
                  const sec = c.web_section_id ? sections[c.web_section_id] : undefined
                  const tplId = sec?.content_template_id
                  return tplId ? templates[tplId] : undefined
                })()}
                onJumpToPage={() => jumpToPage(c.web_page_id, c.web_section_id)}
                onResolved={load}
              />
            ))}
          </ul>
        )}

        {/* Closed sessions — collapsible footer */}
        {closedReviews.length > 0 && (
          <section className="mt-8">
            <h2 className="text-[12px] font-semibold uppercase tracking-widest text-wm-text-subtle mb-2">
              Closed sessions · {closedReviews.length}
            </h2>
            <div className="space-y-1.5">
              {closedReviews.slice(0, 10).map(r => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setReviewFilter(r.id)}
                  className="w-full text-left rounded-md border border-wm-border bg-wm-bg-elevated px-3 py-2 hover:border-wm-accent transition-colors flex items-center gap-3"
                >
                  <KindBadge kind={r.kind} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-semibold text-wm-text truncate">
                      {r.kind === 'partner'
                        ? `Partner review${r.partner_name ? ` · ${r.partner_name}` : ''}`
                        : (r.started_by_name ? `Internal · ${r.started_by_name}` : 'Internal review')}
                    </p>
                    <p className="text-[10px] text-wm-text-subtle">
                      Closed {fmtDateTime(r.closed_at ?? r.updated_at)}
                      {r.closed_by_name && ` by ${r.closed_by_name}`}
                    </p>
                  </div>
                  <ChevronRight size={13} className="text-wm-text-subtle" />
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

// ── Bits ───────────────────────────────────────────────────────────

function Header() {
  return (
    <header className="mb-6">
      <div className="flex items-center gap-2 mb-1 text-wm-accent-strong">
        <Eye size={13} />
        <p className="text-[11px] font-bold uppercase tracking-widest">Review</p>
      </div>
      <h1 className="text-2xl font-semibold text-wm-text">Review queue</h1>
      <p className="text-sm text-wm-text-muted mt-1 max-w-2xl">
        Active review sessions + every comment, suggestion, and request across
        the project. Click any row to jump to the page it targets.
      </p>
    </header>
  )
}

function ReviewSessionCard({
  review, state, onClick, onClose, highlighted,
}: {
  review: WebReview
  state: ProjectReviewState
  onClick: () => void
  onClose: () => void
  highlighted: boolean
}) {
  const myComments = state.comments.filter(c => c.review_id === review.id)
  const openCount  = myComments.filter(c => c.status === 'open').length
  const openReq    = myComments.filter(c => c.status === 'open' && c.kind === 'requested').length
  const openSug    = myComments.filter(c => c.status === 'open' && c.kind === 'suggested').length
  const openCom    = myComments.filter(c => c.status === 'open' && c.kind === 'comment').length

  const portalUrl = review.kind === 'partner' && review.partner_token
    ? `${window.location.origin}/portal/review/${review.partner_token}`
    : null

  const copyPortalLink = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!portalUrl) return
    void navigator.clipboard.writeText(portalUrl)
  }

  return (
    <div
      className={[
        'rounded-md border bg-wm-bg-elevated p-3 transition-colors group',
        highlighted ? 'border-wm-accent ring-2 ring-wm-accent/15' : 'border-wm-border hover:border-wm-accent',
      ].join(' ')}
    >
      <button type="button" onClick={onClick} className="w-full text-left">
        <div className="flex items-start gap-2">
          <KindBadge kind={review.kind} />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-wm-text">
              {review.kind === 'partner'
                ? (review.partner_name ? `Partner · ${review.partner_name}` : 'Partner review')
                : (review.started_by_name ? `Internal · ${review.started_by_name}` : 'Internal review')}
            </p>
            <p className="text-[11px] text-wm-text-subtle">
              Started {fmtDateTime(review.started_at)}
              {review.kind === 'partner' && review.started_by_name && ` by ${review.started_by_name}`}
            </p>
          </div>
          <WMStatusPill tone={openCount > 0 ? 'warning' : 'success'} size="sm">
            {openCount} open
          </WMStatusPill>
        </div>
        {openCount > 0 && (
          <div className="mt-2 flex items-center gap-2 text-[10px] text-wm-text-muted flex-wrap">
            {openReq > 0 && <span>· {openReq} requested</span>}
            {openSug > 0 && <span>· {openSug} suggested</span>}
            {openCom > 0 && <span>· {openCom} comment{openCom === 1 ? '' : 's'}</span>}
          </div>
        )}
      </button>
      {/* Action footer */}
      <div className="mt-2 pt-2 border-t border-wm-border/60 flex items-center gap-1.5 flex-wrap">
        {portalUrl && (
          <button
            type="button"
            onClick={copyPortalLink}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-wm-accent-strong hover:underline"
            title="Copy the partner-facing review link"
          >
            <Copy size={10} /> Copy partner link
          </button>
        )}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClose() }}
          className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-wm-text-muted hover:text-wm-danger transition-colors"
          title="Close this review session"
        >
          <X size={10} /> Close
        </button>
      </div>
    </div>
  )
}

function CommentRow({
  comment, review, page, section, template, onJumpToPage, onResolved,
}: {
  comment: WebReviewComment
  review: WebReview | null
  page: WebPage | undefined
  section: WebSection | undefined
  template: Pick<WebContentTemplate, 'id' | 'layer_name'> | undefined
  onJumpToPage: () => void
  onResolved: () => Promise<void>
}) {
  const author = comment.author_external_name
    ?? (comment.author_kind === 'partner' ? 'Partner' : 'Staff')
  const sectionLabel = template?.layer_name
    ?? (section ? `Section · ${section.sort_order + 1}` : null)
  const sectionFieldValues = section
    ? (section.field_values ?? {}) as Record<string, unknown>
    : undefined
  return (
    <li className={[
      'rounded-md border bg-wm-bg-elevated px-3 py-2.5',
      comment.status === 'open' ? 'border-wm-border' : 'border-wm-border opacity-70',
    ].join(' ')}>
      <div className="flex items-start gap-3">
        <KindBadge kind={comment.kind} />
        <div className="min-w-0 flex-1">
          {/* Target line */}
          <div className="flex items-center gap-1.5 text-[10px] text-wm-text-subtle mb-0.5 flex-wrap">
            <button
              type="button"
              onClick={onJumpToPage}
              className="font-semibold text-wm-text hover:text-wm-accent-strong transition-colors inline-flex items-center gap-0.5"
            >
              {page?.name ?? '(unknown page)'} <ArrowRight size={9} />
            </button>
            {sectionLabel && (
              <>
                <span className="opacity-60">›</span>
                <span className="font-mono">{sectionLabel}</span>
              </>
            )}
            {comment.field_key && (
              <>
                <span className="opacity-60">›</span>
                <span className="font-mono">{comment.field_key}</span>
              </>
            )}
            <span className="ml-auto text-wm-text-subtle">
              {fmtDateTime(comment.created_at)}
            </span>
          </div>
          {/* Body */}
          {comment.body && (
            <p className="text-[12px] text-wm-text leading-snug whitespace-pre-wrap mb-1">
              {comment.body}
            </p>
          )}
          {/* Suggested value preview */}
          {comment.kind !== 'comment' && comment.suggested_value != null && (
            <div className="mt-1 rounded border border-wm-border bg-wm-bg px-2 py-1.5 text-[11px] text-wm-text">
              <p className="text-[9px] uppercase tracking-widest font-bold text-wm-text-subtle mb-0.5">Proposed</p>
              <p className="font-mono text-[11px] line-clamp-3">{stringify(comment.suggested_value)}</p>
            </div>
          )}
          {/* Footer */}
          <div className="mt-1.5 flex items-center gap-2 text-[10px] text-wm-text-subtle flex-wrap">
            <span>{author}</span>
            {review && (
              <>
                <span className="opacity-60">·</span>
                <span>{review.kind === 'partner' ? 'Partner review' : 'Internal review'}</span>
              </>
            )}
            <span className="opacity-60">·</span>
            <StatusBadge status={comment.status} />
            {comment.status !== 'open' && comment.resolved_at && (
              <span className="text-wm-text-subtle italic">
                · {fmtDateTime(comment.resolved_at)}
              </span>
            )}
            <span className="ml-auto">
              <CommentActions
                comment={comment}
                sectionFieldValues={sectionFieldValues}
                onResolved={onResolved}
              />
            </span>
          </div>
        </div>
      </div>
    </li>
  )
}

function KindBadge({ kind }: { kind: WebReviewCommentKind | WebReview['kind'] }) {
  const map = {
    comment:   { label: 'Comment',   tone: 'neutral' as const },
    suggested: { label: 'Suggested', tone: 'info'    as const },
    requested: { label: 'Requested', tone: 'warning' as const },
    internal:  { label: 'Internal',  tone: 'info'    as const },
    partner:   { label: 'Partner',   tone: 'warning' as const },
  }
  const cfg = map[kind] ?? map.comment
  return <WMStatusPill tone={cfg.tone} size="sm">{cfg.label}</WMStatusPill>
}

function StatusBadge({ status }: { status: WebReviewCommentStatus }) {
  const cfg = {
    open:      { label: 'Open',      icon: <Clock  size={9} />, color: 'text-wm-warn' },
    applied:   { label: 'Applied',   icon: <Check  size={9} />, color: 'text-wm-success' },
    amended:   { label: 'Amended',   icon: <Check  size={9} />, color: 'text-wm-success' },
    dismissed: { label: 'Dismissed', icon: <X      size={9} />, color: 'text-wm-text-subtle' },
  }[status]
  return (
    <span className={`inline-flex items-center gap-0.5 font-semibold ${cfg.color}`}>
      {cfg.icon}{cfg.label}
    </span>
  )
}

interface FilterOption { value: string; label: string }

function FilterSelect({
  label, value, onChange, options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: FilterOption[]
}) {
  return (
    <label className="inline-flex items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 text-[11px] px-1.5 rounded border border-wm-border bg-wm-bg text-wm-text focus:outline-none focus:border-wm-accent max-w-[180px]"
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  )
}

// ── Helpers ────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch { return iso }
}

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  } catch { return iso }
}

function stringify(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'object' && v !== null && 'label' in v && typeof (v as { label: unknown }).label === 'string') {
    return (v as { label: string }).label
  }
  try { return JSON.stringify(v) } catch { return String(v) }
}

// Silence unused MessageSquare import (kept for future Phase E action menu).
void MessageSquare
