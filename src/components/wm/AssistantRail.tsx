/**
 * Web Manager — Assistant Rail.
 *
 * Right-side panel that complements the active workspace. Hosts the
 * "everywhere" reference + per-project authoring that doesn't earn
 * a top-level tab:
 *
 *   Section    — section detail editor (only when a section is selected on Pages)
 *   Snippets   — global merge fields + project snippets
 *   Voice      — read-only brand voice rollup
 *   Heuristics — writing rules + denominational filter + personas
 *   Feedback   — rollup of every open review comment, page-grouped,
 *                click to jump to the section
 *   Audit      — heuristic violations on the active page
 *
 * The rail is context-aware: when the active workspace is `pages`, the
 * Audit tab scans the currently-open page (?page=<id>) and clicking
 * a comment in the Feedback tab navigates to the section it targets.
 */

import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Tag, BookOpen, Mic, MessageSquare, AlertTriangle, RotateCw, Search,
  Loader2, SquarePen, Inbox, Plus, Copy, X, Check, ChevronRight, ChevronDown,
  Globe,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { runAudit } from '../../lib/webAudit'
import type { AuditFinding, AuditSeverity } from '../../lib/webAudit'
import type {
  StrategyWebProject, WebReview, WebReviewComment, WebReviewEdit,
} from '../../types/database'
import {
  loadProjectReviewState, startReview, closeReview, loadProjectReviewEdits,
  type ProjectReviewState,
} from '../../lib/webReviews'
import { WMButton } from './Button'
import { WMStatusPill } from './StatusPill'
import { SectionDetailsPanel } from './sectioneditor/SectionDetailsPanel'
import { SnippetFocusProvider } from './sectioneditor/SnippetFocusContext'
import { useSectionDetail } from './sectioneditor/SectionEditingContext'
import { SnippetsWorkspace } from './workspaces/SnippetsWorkspace'
import { VoiceWorkspace } from './workspaces/VoiceWorkspace'
import { HeuristicsWorkspace } from './workspaces/HeuristicsWorkspace'
import { SeoPanel } from './SeoPanel'

type RailTab = 'section' | 'snippets' | 'voice' | 'heuristics' | 'feedback' | 'audit' | 'seo'

interface Props {
  projectId: string
  activeTab: string
  /** Full project row — required for the Snippets / Voice / Heuristics
   *  rail tabs which render those workspaces inline. */
  project?: StrategyWebProject
  /** Refresh callback fired when a rail-hosted workspace mutates the
   *  project (e.g. SnippetsWorkspace adds/removes a custom snippet). */
  onProjectChange?: () => Promise<void>
}

export function AssistantRail({ projectId, activeTab, project, onProjectChange }: Props) {
  const [tab, setTab] = useState<RailTab>('snippets')
  const [query, setQuery] = useState('')
  const [counts, setCounts] = useState({ snippets: 0, feedback: 0, audit: 0 })
  const [params, setParams] = useSearchParams()
  // Both the Pages workspace and the Review workspace use ?page= and
  // ?section= for selection. Honor either so the rail's Section /
  // Audit / Feedback tabs Just Work in review mode too.
  const tabUsesSectionContext = activeTab === 'pages' || activeTab === 'review'
  const activePageId = tabUsesSectionContext ? params.get('page') : null

  const sectionDetail = useSectionDetail()
  const sectionTabAvailable = tabUsesSectionContext && sectionDetail != null

  // Auto-switch to the Section tab whenever a section is selected, and
  // back to the previous tab when deselected.
  const [tabBeforeSection, setTabBeforeSection] = useState<RailTab>('snippets')
  useEffect(() => {
    if (sectionTabAvailable) {
      if (tab !== 'section') {
        setTabBeforeSection(tab)
        setTab('section')
      }
    } else if (tab === 'section') {
      setTab(tabBeforeSection)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionTabAvailable])

  // External trigger: when ?rail=<tab> is set in the URL, switch to
  // that tab and clear the param. Used by the in-canvas "Open Feedback
  // panel" button so the rail responds without yanking the user to
  // a different top-level tab.
  const railRequest = params.get('rail') as RailTab | null
  useEffect(() => {
    if (!railRequest) return
    const valid: RailTab[] = ['section', 'snippets', 'voice', 'heuristics', 'feedback', 'audit', 'seo']
    if (valid.includes(railRequest)) setTab(railRequest)
    const next = new URLSearchParams(window.location.search)
    next.delete('rail')
    setParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [railRequest])

  // Counts on mount + project change. Snippets via direct count;
  // feedback via the same review-state lib the Review tab uses.
  const loadCounts = useCallback(async () => {
    const [snip, state] = await Promise.all([
      supabase
        .from('web_project_snippets')
        .select('id', { count: 'exact', head: true })
        .eq('web_project_id', projectId)
        .eq('archived', false),
      loadProjectReviewState(projectId),
    ])
    setCounts(c => ({
      ...c,
      snippets: snip.count ?? 0,
      feedback: state.totals.open_total,
    }))
  }, [projectId])

  useEffect(() => { void loadCounts() }, [loadCounts])

  const jumpToSection = useCallback((pageId: string, sectionId: string) => {
    const next = new URLSearchParams(window.location.search)
    // Stay on whatever workspace the user is in (review or pages).
    // Both surfaces honor ?page= + ?section= deep-links, so this just
    // updates the in-canvas selection without yanking the user out of
    // review mode.
    if (next.get('tab') !== 'review' && next.get('tab') !== 'pages') {
      next.set('tab', 'pages')
    }
    next.set('page', pageId)
    next.set('section', sectionId)
    setParams(next, { replace: false })
    queueMicrotask(() => {
      document.getElementById(`section-${sectionId}`)?.scrollIntoView({
        behavior: 'smooth', block: 'start',
      })
    })
  }, [setParams])

  // Workspaces hosted in the rail (Snippets / Voice / Heuristics)
  // render their own filter UI internally, so the rail's search box
  // only applies to the simple list tabs.
  const showSearchBox = tab === 'feedback' || tab === 'audit'

  return (
    <div className="h-full flex flex-col text-sm">
      <div className="flex items-center border-b border-wm-border bg-wm-bg">
        {sectionTabAvailable && (
          <RailTabButton tab="section" active={tab} setTab={setTab} icon={<SquarePen size={13} />} label="Section" />
        )}
        <RailTabButton tab="snippets"   active={tab} setTab={setTab} icon={<Tag size={13} />}            count={counts.snippets} label="Snippets" />
        <RailTabButton tab="voice"      active={tab} setTab={setTab} icon={<Mic size={13} />}            label="Voice" />
        <RailTabButton tab="heuristics" active={tab} setTab={setTab} icon={<BookOpen size={13} />}       label="Heuristics" />
        <RailTabButton tab="feedback"   active={tab} setTab={setTab} icon={<MessageSquare size={13} />}  count={counts.feedback} label="Feedback" />
        {tabUsesSectionContext && activePageId && (
          <RailTabButton tab="seo"      active={tab} setTab={setTab} icon={<Globe size={13} />}          label="SEO" />
        )}
        <RailTabButton tab="audit"      active={tab} setTab={setTab} icon={<AlertTriangle size={13} />}  count={counts.audit} label="Audit" />
      </div>

      {showSearchBox && (
        <div className="px-3 py-2 border-b border-wm-border space-y-2">
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-wm-text-subtle" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={tab === 'feedback' ? 'Search feedback…' : 'Filter violations…'}
              className="w-full h-8 pl-7 pr-2 rounded-md bg-wm-bg-elevated border border-wm-border text-[12px] text-wm-text placeholder-wm-text-subtle outline-none focus:border-wm-border-focus focus:ring-2 focus:ring-wm-border-focus/20"
            />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto bg-wm-bg-elevated min-h-0">
        {tab === 'section' && sectionDetail && (
          <SnippetFocusProvider>
            <SectionDetailsPanel
              section={sectionDetail.section}
              template={sectionDetail.template}
              snippets={sectionDetail.snippets}
              cardTemplates={sectionDetail.cardTemplates}
              onChange={sectionDetail.onChange}
              onClose={sectionDetail.onClose}
              onChangeVariant={sectionDetail.onChangeVariant}
              onUnbind={sectionDetail.onUnbind}
              onRemove={sectionDetail.onRemove}
              activeInternalReview={sectionDetail.activeInternalReview}
              sectionComments={sectionDetail.sectionComments}
              onCommentsChange={sectionDetail.onCommentsChange}
            />
          </SnippetFocusProvider>
        )}
        {tab === 'snippets' && (project
          ? <SnippetsWorkspace project={project} onChange={onProjectChange ?? (async () => { await loadCounts() })} />
          : <RailUnavailable label="Snippets" />
        )}
        {tab === 'voice' && (project
          ? <VoiceWorkspace project={project} />
          : <RailUnavailable label="Voice" />
        )}
        {tab === 'heuristics' && (project
          ? <HeuristicsWorkspace project={project} />
          : <RailUnavailable label="Heuristics" />
        )}
        {tab === 'feedback' && <FeedbackTab projectId={projectId} query={query} onJumpToSection={jumpToSection} />}
        {tab === 'seo' && (activePageId
          ? <SeoPanel pageId={activePageId} />
          : <RailUnavailable label="SEO" />
        )}
        {tab === 'audit' && <AuditTab projectId={projectId} activePageId={activePageId} query={query} onCount={n => setCounts(c => ({ ...c, audit: n }))} />}
      </div>
    </div>
  )
}

function RailUnavailable({ label }: { label: string }) {
  return (
    <div className="p-4 text-[12px] text-wm-text-subtle italic">
      {label} unavailable — project hasn't loaded yet.
    </div>
  )
}

function RailTabButton({
  tab, active, setTab, icon, count, label,
}: {
  tab: RailTab
  active: RailTab
  setTab: (t: RailTab) => void
  icon: React.ReactNode
  count?: number
  label: string
}) {
  const isActive = tab === active
  return (
    <button
      type="button"
      onClick={() => setTab(tab)}
      aria-label={label}
      title={label}
      className={[
        'flex-1 h-10 inline-flex items-center justify-center gap-1 text-[11px] font-semibold transition-colors border-b-2',
        isActive
          ? 'border-wm-accent text-wm-text bg-wm-bg-elevated'
          : 'border-transparent text-wm-text-muted hover:text-wm-text hover:bg-wm-bg-hover',
      ].join(' ')}
    >
      {icon}
      {typeof count === 'number' && count > 0 && (
        <span className={[
          'min-w-[16px] h-[16px] inline-flex items-center justify-center rounded-full text-[9px] font-bold px-1',
          isActive
            ? 'bg-wm-accent-tint text-wm-accent-strong'
            : 'bg-wm-bg-hover text-wm-text-subtle',
        ].join(' ')}>{count}</span>
      )}
    </button>
  )
}

// ── Feedback tab — sitemap-grouped rollup of every open review comment.
// Replaced the prior "Ideas" panel which didn't earn its rail real
// estate. Clicking a row navigates to the section's page and scrolls.
// ─────────────────────────────────────────────────────────────────────

function FeedbackTab({
  projectId, query, onJumpToSection,
}: {
  projectId: string
  query: string
  onJumpToSection: (pageId: string, sectionId: string) => void
}) {
  const [state, setState] = useState<ProjectReviewState | null>(null)
  const [edits, setEdits] = useState<WebReviewEdit[]>([])
  // Maps for resolving an edit row's page name + section label so the
  // rail shows "Plan Your Visit › Hero Section 49" alongside each
  // field change.
  const [pageById, setPageById] = useState<Record<string, { id: string; name: string }>>({})
  const [sectionLabelById, setSectionLabelById] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [s, e] = await Promise.all([
      loadProjectReviewState(projectId),
      loadProjectReviewEdits(projectId),
    ])
    setState(s)
    setEdits(e)

    // Resolve page + section labels for whatever the edits reference.
    const pageIds    = Array.from(new Set(e.map(x => x.web_page_id)))
    const sectionIds = Array.from(new Set(e.map(x => x.web_section_id)))
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
      // Resolve to template layer_name when bound; else "Freehand".
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
      for (const s of (sections ?? []) as Array<{ id: string; content_template_id: string | null; sort_order: number | null }>) {
        smap[s.id] = s.content_template_id
          ? (tplMap[s.content_template_id] ?? 'Section')
          : `Section · ${(s.sort_order ?? 0) + 1}`
      }
      setSectionLabelById(smap)
    }

    setLoading(false)
  }, [projectId])

  useEffect(() => { void load() }, [load])

  const handleStartPartner = async () => {
    setStarting(true)
    setError(null)
    const res = await startReview({ projectId, kind: 'partner' })
    setStarting(false)
    if (res.ok) await load()
    else setError(res.error ?? 'Failed to start partner review.')
  }

  const handleClose = async (reviewId: string) => {
    if (!confirm('Close this review? Open comments stay attached to their pages and carry into the next session.')) return
    const res = await closeReview(reviewId)
    if (res.ok) await load()
  }

  const copyPortalLink = (token: string, reviewId: string) => {
    const url = `${window.location.origin}/portal/review/${token}`
    void navigator.clipboard.writeText(url)
    setCopied(reviewId)
    setTimeout(() => setCopied(c => c === reviewId ? null : c), 1500)
  }

  const q = query.trim().toLowerCase()
  const filterFn = useCallback((c: WebReviewComment) => {
    if (!q) return true
    const hay = [
      c.body, c.field_key,
      typeof c.suggested_value === 'string' ? c.suggested_value : '',
      c.author_external_name ?? '',
    ].filter(Boolean).join(' ').toLowerCase()
    return hay.includes(q)
  }, [q])

  if (loading || !state) {
    return (
      <div className="p-3 space-y-1.5">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-14 rounded bg-wm-bg-hover animate-pulse" />
        ))}
      </div>
    )
  }

  const openReviews   = state.open_reviews
  const closedReviews = state.reviews.filter(r => r.status === 'closed').slice(0, 10)
  const openPartner   = openReviews.find(r => r.kind === 'partner') ?? null

  return (
    <div className="p-3 space-y-3">
      {/* Top action — start a partner review (or copy link if one's already open) */}
      {openPartner ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900 flex items-center gap-2">
          <span className="font-semibold">Partner review open</span>
          <button
            type="button"
            onClick={() => openPartner.partner_token && copyPortalLink(openPartner.partner_token, openPartner.id)}
            className="ml-auto inline-flex items-center gap-1 text-amber-800 font-semibold hover:text-amber-900"
          >
            {copied === openPartner.id ? <Check size={11} /> : <Copy size={11} />}
            {copied === openPartner.id ? 'Copied' : 'Copy partner link'}
          </button>
        </div>
      ) : (
        <WMButton
          variant="secondary"
          size="sm"
          iconLeft={starting ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
          onClick={() => void handleStartPartner()}
          disabled={starting}
          className="w-full justify-center"
        >
          Start Partner Review
        </WMButton>
      )}

      {error && (
        <div role="alert" className="rounded-md border border-wm-danger/40 bg-wm-danger-bg px-2 py-1.5 text-[11px] text-wm-danger flex items-start gap-1.5">
          <X size={11} className="mt-0.5 shrink-0" />
          <p className="flex-1 leading-snug">{error}</p>
        </div>
      )}

      {/* Open reviews section */}
      {openReviews.length === 0 && closedReviews.length === 0 ? (
        <EmptyState
          icon={<Inbox size={20} />}
          title="No reviews yet"
          body="Start a partner review above, or open an internal review from the Review tab."
        />
      ) : (
        <>
          {openReviews.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1.5 px-1">
                Reviews · {openReviews.length}
              </p>
              <div className="space-y-2">
                {openReviews.map(r => (
                  <ReviewSession
                    key={r.id}
                    review={r}
                    comments={state.comments.filter(c => c.review_id === r.id).filter(filterFn)}
                    edits={edits.filter(e => e.review_id === r.id)}
                    pageById={pageById}
                    sectionLabelById={sectionLabelById}
                    onJumpToSection={onJumpToSection}
                    onClose={() => void handleClose(r.id)}
                    onCopyLink={() => r.partner_token && copyPortalLink(r.partner_token, r.id)}
                    copied={copied === r.id}
                  />
                ))}
              </div>
            </div>
          )}

          {closedReviews.length > 0 && (
            <div className="pt-2 mt-1 border-t border-wm-border/60">
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1.5 px-1">
                Recently closed · {closedReviews.length}
              </p>
              <div className="space-y-2 opacity-90">
                {closedReviews.map(r => (
                  <ReviewSession
                    key={r.id}
                    review={r}
                    comments={state.comments.filter(c => c.review_id === r.id).filter(filterFn)}
                    edits={edits.filter(e => e.review_id === r.id)}
                    pageById={pageById}
                    sectionLabelById={sectionLabelById}
                    onJumpToSection={onJumpToSection}
                    onClose={() => {}}  // already closed
                    onCopyLink={() => r.partner_token && copyPortalLink(r.partner_token, r.id)}
                    copied={copied === r.id}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** One open review session — header + collapsible groups by kind.
 *  Partner sessions break into 'requested' + 'comment'; internal
 *  sessions break into 'suggested' + 'comment'. */
function ReviewSession({
  review, comments, edits, pageById, sectionLabelById,
  onJumpToSection, onClose, onCopyLink, copied,
}: {
  review: WebReview
  comments: WebReviewComment[]
  edits: WebReviewEdit[]
  pageById: Record<string, { id: string; name: string }>
  sectionLabelById: Record<string, string>
  onJumpToSection: (pageId: string, sectionId: string) => void
  onClose: () => void
  onCopyLink: () => void
  copied: boolean
}) {
  const isPartner = review.kind === 'partner'
  const isClosed  = review.status === 'closed'
  const name      = isPartner ? (review.partner_name ?? 'Partner') : (review.started_by_name ?? 'Staff')

  // Partition by the kinds each side actually produces.
  const requested = comments.filter(c => c.kind === 'requested')
  const suggested = comments.filter(c => c.kind === 'suggested')
  const comment   = comments.filter(c => c.kind === 'comment')

  return (
    <div className="rounded-md border border-wm-border bg-wm-bg-elevated overflow-hidden">
      {/* Session header */}
      <div className={[
        'px-2.5 py-2 border-b border-wm-border/60',
        isClosed  ? 'bg-wm-bg-hover/40'
        : isPartner ? 'bg-amber-50/50'
        : 'bg-blue-50/40',
      ].join(' ')}>
        <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
          <span className={[
            'inline-flex items-center text-[9px] uppercase tracking-widest font-bold rounded-full px-1.5 py-0.5',
            isPartner ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-blue-100 text-blue-700 border border-blue-200',
          ].join(' ')}>
            {isPartner ? 'Partner' : 'Internal'}
          </span>
          <span className="text-[11px] font-semibold text-wm-text truncate">{name}</span>
          {isClosed && (
            <span className="inline-flex items-center text-[9px] uppercase tracking-widest font-bold rounded-full px-1.5 py-0.5 bg-wm-success-bg text-wm-success border border-wm-success/20">
              Closed
            </span>
          )}
          <span className="ml-auto text-[10px] font-semibold text-wm-text-subtle">
            {comments.length} item{comments.length === 1 ? '' : 's'}
          </span>
        </div>
        <p className="text-[10px] text-wm-text-subtle">
          Started {fmtShortDateTime(review.started_at)}
          {isClosed && review.closed_at && (
            <> · Closed {fmtShortDateTime(review.closed_at)}{review.closed_by_name && ` by ${review.closed_by_name}`}</>
          )}
        </p>
        {!isClosed && (
          <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
            {isPartner && review.partner_token && (
              <button
                type="button"
                onClick={onCopyLink}
                className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-800 hover:text-amber-900"
              >
                {copied ? <Check size={10} /> : <Copy size={10} />}
                {copied ? 'Copied' : 'Copy partner link'}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold text-wm-text-subtle hover:text-wm-danger"
            >
              <X size={10} /> Close
            </button>
          </div>
        )}
      </div>

      {/* Comment groups + (internal only) edit log */}
      <div className="px-1 py-1 space-y-1">
        {isPartner ? (
          <>
            <CommentGroup label="Partner requests" items={requested} onJumpToSection={onJumpToSection} defaultOpen />
            <CommentGroup label="Partner comments" items={comment}   onJumpToSection={onJumpToSection} />
          </>
        ) : (
          <>
            <CommentGroup label="Staff suggestions" items={suggested} onJumpToSection={onJumpToSection} defaultOpen />
            <CommentGroup label="Staff comments"   items={comment}    onJumpToSection={onJumpToSection} />
            <EditGroup
              label="Changes made"
              items={edits}
              pageById={pageById}
              sectionLabelById={sectionLabelById}
              onJumpToSection={onJumpToSection}
            />
          </>
        )}
        {comments.length === 0 && edits.length === 0 && (
          <p className="px-2 py-1.5 text-[11px] text-wm-text-subtle italic">No items yet.</p>
        )}
      </div>
    </div>
  )
}

/** Collapsible audit log of field changes made during a review.
 *  Internal-only — partner reviews don't write to field_values
 *  directly, so they have no edits to show. */
function EditGroup({
  label, items, pageById, sectionLabelById, onJumpToSection, defaultOpen = false,
}: {
  label: string
  items: WebReviewEdit[]
  pageById: Record<string, { id: string; name: string }>
  sectionLabelById: Record<string, string>
  onJumpToSection: (pageId: string, sectionId: string) => void
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  if (items.length === 0) return null
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-1 px-2 py-1 text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle hover:text-wm-text"
      >
        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        <span>{label}</span>
        <span className="ml-auto text-wm-text-subtle">{items.length}</span>
      </button>
      {open && (
        <ul className="px-1 pb-1 space-y-1">
          {items.map(e => {
            const pageName     = pageById[e.web_page_id]?.name ?? 'Unknown page'
            const sectionLabel = sectionLabelById[e.web_section_id] ?? 'Section'
            return (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => onJumpToSection(e.web_page_id, e.web_section_id)}
                  className="w-full text-left rounded-md bg-emerald-50/30 border border-emerald-200/50 px-2 py-1.5 hover:border-emerald-400 transition-colors"
                >
                  {/* Breadcrumb: which page → which section → which field */}
                  <div className="flex items-center gap-1 text-[9px] text-wm-text-subtle mb-0.5 flex-wrap">
                    <span className="font-semibold text-wm-text">{pageName}</span>
                    <span className="opacity-60">›</span>
                    <span className="font-mono truncate">{sectionLabel}</span>
                    <span className="opacity-60">›</span>
                    <span className="font-mono text-emerald-700">{e.field_label ?? e.field_path}</span>
                    <span className="ml-auto text-wm-text-subtle">
                      {fmtShortDateTime(e.edited_at)}
                    </span>
                  </div>
                  <p className="text-[10px] text-wm-text-subtle line-through line-clamp-1">
                    {stringifyEditValue(e.before_value)}
                  </p>
                  <p className="text-[11px] text-wm-text leading-snug line-clamp-2">
                    {stringifyEditValue(e.after_value)}
                  </p>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function stringifyEditValue(v: unknown): string {
  if (v == null) return '(empty)'
  if (typeof v === 'string') return stripHtml(v) || '(empty)'
  if (typeof v === 'object') {
    const obj = v as { label?: unknown }
    if (typeof obj.label === 'string') return obj.label
    try { return JSON.stringify(v).slice(0, 80) } catch { return String(v) }
  }
  return String(v)
}

function CommentGroup({
  label, items, onJumpToSection, defaultOpen = false,
}: {
  label: string
  items: WebReviewComment[]
  onJumpToSection: (pageId: string, sectionId: string) => void
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  if (items.length === 0) return null
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-1 px-2 py-1 text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle hover:text-wm-text"
      >
        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        <span>{label}</span>
        <span className="ml-auto text-wm-text-subtle">{items.length}</span>
      </button>
      {open && (
        <ul className="px-1 pb-1 space-y-1">
          {items.map(c => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => c.web_section_id && onJumpToSection(c.web_page_id, c.web_section_id)}
                disabled={!c.web_section_id}
                className={[
                  'w-full text-left rounded-md bg-wm-bg border border-wm-border/60 px-2 py-1.5 hover:border-wm-accent transition-colors',
                  !c.web_section_id && 'opacity-60 cursor-default',
                  c.status !== 'open' && 'opacity-60 line-through decoration-wm-text-subtle/40',
                ].filter(Boolean).join(' ')}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  {c.field_key && <span className="font-mono text-[9px] text-wm-text-subtle">{c.field_key}</span>}
                  <span className="ml-auto text-[9px] text-wm-text-subtle no-underline">
                    {fmtShortDateTime(c.created_at)}
                  </span>
                </div>
                <p className="text-[11px] text-wm-text leading-snug line-clamp-2 no-underline">
                  {c.body || (typeof c.suggested_value === 'string' ? stripHtml(c.suggested_value) : '(no body)')}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function fmtShortDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })
  } catch { return iso }
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

// ── Audit tab ─────────────────────────────────────────────────────────

function AuditTab({
  projectId: _projectId, activePageId, query, onCount,
}: {
  projectId: string
  activePageId: string | null
  query: string
  onCount: (n: number) => void
}) {
  const [findings, setFindings] = useState<AuditFinding[]>([])
  const [scanning, setScanning] = useState(false)
  const [scanned, setScanned] = useState(false)

  const scan = useCallback(async () => {
    if (!activePageId) return
    setScanning(true)
    const list = await runAudit(activePageId)
    setFindings(list)
    setScanned(true)
    setScanning(false)
    onCount(list.length)
  }, [activePageId, onCount])

  // Clear findings when page changes
  useEffect(() => {
    setFindings([])
    setScanned(false)
    onCount(0)
  }, [activePageId, onCount])

  const q = query.trim().toLowerCase()
  const visible = q
    ? findings.filter(f => f.rule_label.toLowerCase().includes(q) || f.message.toLowerCase().includes(q))
    : findings

  if (!activePageId) {
    return (
      <div className="p-3">
        <EmptyState
          icon={<AlertTriangle size={20} />}
          title="Open a page to scan"
          body="Audit findings are scoped to the current page. Open the Pages workspace and pick a page, then come back to scan."
        />
      </div>
    )
  }

  return (
    <div className="p-3 space-y-2">
      <WMButton
        variant="secondary"
        size="sm"
        loading={scanning}
        iconLeft={<RotateCw size={11} />}
        onClick={scan}
        className="w-full"
      >
        {scanned ? 'Re-scan page' : 'Scan page'}
      </WMButton>

      {scanning ? (
        <div className="grid place-items-center p-6 text-wm-text-subtle">
          <Loader2 size={18} className="animate-spin" />
        </div>
      ) : !scanned ? (
        <EmptyState
          icon={<AlertTriangle size={20} />}
          title="Ready to scan"
          body="Click Scan to check this page against global writing rules. Violations show up here with jump-to-source links."
        />
      ) : visible.length === 0 ? (
        <div className="rounded-md bg-wm-success-bg border border-wm-success/20 p-3 text-center">
          <p className="text-[12px] font-semibold text-wm-success">No violations</p>
          <p className="text-[11px] text-wm-text-muted mt-1">Page passes the global writing rules.</p>
        </div>
      ) : (
        <>
          <p className="text-[11px] text-wm-text-subtle px-1">
            {visible.length} finding{visible.length === 1 ? '' : 's'}
          </p>
          {visible.map(f => <FindingRow key={f.id} finding={f} />)}
        </>
      )}
    </div>
  )
}

function FindingRow({ finding }: { finding: AuditFinding }) {
  const severityTone: Record<AuditSeverity, 'danger' | 'warning' | 'info'> = {
    high:   'danger',
    medium: 'warning',
    low:    'info',
  }
  return (
    <div className="rounded-md bg-wm-bg-elevated border border-wm-border p-2.5 group">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            <WMStatusPill tone={severityTone[finding.severity]} size="sm">
              {finding.severity}
            </WMStatusPill>
            <p className="text-[11px] font-semibold text-wm-text">{finding.rule_label}</p>
          </div>
          <p className="text-[11px] text-wm-text-muted leading-snug">{finding.message}</p>
          {finding.suggestion && (
            <p className="text-[10px] text-wm-accent-strong italic mt-1">→ {finding.suggestion}</p>
          )}
          <p className="text-[10px] text-wm-text-subtle mt-1.5 truncate">
            in <span className="font-mono">{finding.location.section_label}</span>
            {' · '}{finding.location.field_key}
            {finding.location.item_index != null && ` (item ${finding.location.item_index + 1})`}
          </p>
          <p className="text-[11px] text-wm-text mt-1 italic line-clamp-2">"{finding.location.matched_text}"</p>
        </div>
      </div>
    </div>
  )
}

// ── Shared ────────────────────────────────────────────────────────────

function EmptyState({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-md bg-wm-bg border border-dashed border-wm-border p-5 text-center">
      <div className="text-wm-text-subtle mx-auto mb-2 w-7 h-7 inline-flex items-center justify-center">{icon}</div>
      <p className="text-[12px] font-semibold text-wm-text">{title}</p>
      <p className="text-[11px] text-wm-text-muted mt-1 leading-snug">{body}</p>
    </div>
  )
}
