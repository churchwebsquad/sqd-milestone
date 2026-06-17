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
  Globe, UserPlus,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { runAudit } from '../../lib/webAudit'
import type { AuditFinding, AuditSeverity } from '../../lib/webAudit'
import type {
  StrategyWebProject, WebReview, WebReviewComment, WebReviewEdit,
  CoworkHandoffPageMeta, CoworkHandoffSectionMeta,
} from '../../types/database'
import {
  loadProjectReviewState, startReview, closeReview, loadProjectReviewEdits,
  buildFeedbackBoards,
  type ProjectReviewState,
} from '../../lib/webReviews'
import { FeedbackBoardVerticalList } from './feedback/FeedbackBoardVerticalList'
import { FeedbackTabs } from './feedback/FeedbackTabs'
import { AssigneeFilter } from './feedback/AssigneeFilter'
import { WMButton } from './Button'
import { WMStatusPill } from './StatusPill'
import { SectionDetailsPanel } from './sectioneditor/SectionDetailsPanel'
import { SnippetFocusProvider } from './sectioneditor/SnippetFocusContext'
import { useSectionDetail } from './sectioneditor/SectionEditingContext'
import { SnippetsWorkspace } from './workspaces/SnippetsWorkspace'
import { VoiceWorkspace } from './workspaces/VoiceWorkspace'
import { HeuristicsWorkspace } from './workspaces/HeuristicsWorkspace'
import { SeoPanel } from './SeoPanel'
import { CopywriterNotesPanel } from './CopywriterNotesPanel'
import { RequestReviewModal } from './RequestReviewModal'
import { useAuth } from '../../contexts/AuthContext'

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
              pages={sectionDetail.pages}
              onChange={sectionDetail.onChange}
              onClose={sectionDetail.onClose}
              onChangeVariant={sectionDetail.onChangeVariant}
              onUnbind={sectionDetail.onUnbind}
              onRemove={sectionDetail.onRemove}
              project={sectionDetail.project}
              libraryTemplatesById={sectionDetail.libraryTemplatesById}
              onLibraryChange={sectionDetail.onLibraryChange}
              activeInternalReview={sectionDetail.activeInternalReview}
              sectionComments={sectionDetail.sectionComments}
              reviewsById={sectionDetail.reviewsById}
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

// ── Feedback tab — round-grouped vertical boards.
//
// Replaced the prior flat list with the round-board UI: each open or
// recently-closed review session renders as a collapsible board with
// its own status pill, comments rendered as the new FeedbackCard.
// Top-of-rail actions (Get partner link / Start internal / Request)
// + assignee filter + round-tab strip sit above.
// ─────────────────────────────────────────────────────────────────────

function FeedbackTab({
  projectId, query, onJumpToSection,
}: {
  projectId: string
  query: string
  onJumpToSection: (pageId: string, sectionId: string) => void
}) {
  const { user } = useAuth()
  const [state, setState] = useState<ProjectReviewState | null>(null)
  const [edits, setEdits] = useState<WebReviewEdit[]>([])
  // Maps for resolving page/section labels referenced by every
  // comment and edit. Resolved once per load against the same query
  // pattern the old FeedbackTab used.
  const [pageById, setPageById] = useState<Record<string, { id: string; name: string }>>({})
  const [sectionLabelById, setSectionLabelById] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [mutating, setMutating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [partnerLinkCopied, setPartnerLinkCopied] = useState(false)
  const [requestModalOpen, setRequestModalOpen] = useState(false)

  // Feedback UI state — round tab selection + assignee filter.
  const [activeTab, setActiveTab] = useState<string>('all')
  const [selectedAssignees, setSelectedAssignees] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    const [s, e] = await Promise.all([
      loadProjectReviewState(projectId),
      loadProjectReviewEdits(projectId),
    ])
    setState(s)
    setEdits(e)

    // Resolve page + section labels for whatever the edits AND
    // comments reference. The new feedback card shows the location
    // pill per-comment, so the lookup needs to cover both.
    const pageIds    = Array.from(new Set([
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

  /** Get-or-start a partner review and copy its link. Mirrors the
   *  same button on the Review tab so both surfaces feel like one
   *  action regardless of where the user clicks. */
  const handleGetPartnerLink = async () => {
    setMutating(true)
    setError(null)
    let token: string | null = null
    const existing = state?.open_reviews.find(r => r.kind === 'partner') ?? null
    if (existing?.partner_token) {
      token = existing.partner_token
    } else {
      const res = await startReview({ projectId, kind: 'partner' })
      if (!res.ok) {
        setError(res.error ?? 'Failed to start partner review.')
        setMutating(false)
        return
      }
      token = res.data?.partner_token ?? null
      await load()
    }
    setMutating(false)
    if (!token) {
      setError("Partner review started but no link was issued — refresh and try again.")
      return
    }
    const url = `${window.location.origin}/portal/review/${token}`
    try {
      await navigator.clipboard.writeText(url)
      setPartnerLinkCopied(true)
      setTimeout(() => setPartnerLinkCopied(false), 2500)
    } catch {
      setError(`Couldn't copy to clipboard — link is ${url}`)
    }
  }

  /** Start an internal review for the current user. Per the per-user
   *  semantics, each staff has at most one open internal review on a
   *  project; we no-op if they've already got one running. */
  const handleStartInternal = async () => {
    setMutating(true)
    setError(null)
    const res = await startReview({ projectId, kind: 'internal' })
    setMutating(false)
    if (res.ok) await load()
    else setError(res.error ?? 'Failed to start internal review.')
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

  const openReviews = state.open_reviews
  // Shared internal-review rounds — any open internal review hides
  // the "Start internal review" rail button. A new round can only
  // start once the current round is closed.
  const myOpenInternal = openReviews.find(r => r.kind === 'internal') ?? null
  void user  // retained for future per-author guards

  // Build round-keyed boards. Memoization keyed on identity of the
  // arrays is enough since `load()` always produces fresh refs.
  const feedbackBoards = buildFeedbackBoards(state, edits)
  const visibleBoards = activeTab === 'all'
    ? feedbackBoards.boards
    : (feedbackBoards.byTab[activeTab] ?? [])

  // Compose the comment-level filter from both the query box (existing
  // rail search) and the new assignee filter. Both produce predicates
  // that are AND'ed.
  const commentFilter = (c: WebReviewComment): boolean => {
    if (!filterFn(c)) return false
    if (selectedAssignees.size > 0) {
      const id = c.assignee_user_id ?? c.assignee_email ?? c.assignee_name ?? ''
      if (!selectedAssignees.has(id)) return false
    }
    return true
  }

  const pageNameFor    = (id: string) => pageById[id]?.name ?? null
  const sectionLabelFor = (id: string | null) => (id ? (sectionLabelById[id] ?? null) : null)

  return (
    <div className="p-3 space-y-3">
      {/* Top actions — partner link (dark) + internal review + request
          (light). Mirrors the Review tab's empty-state CTAs so the
          same actions are always one click away regardless of where
          the user is in the workspace. */}
      <div className="space-y-1.5">
        <WMButton
          variant="primary"
          size="sm"
          iconLeft={
            mutating ? <Loader2 size={11} className="animate-spin" /> :
            partnerLinkCopied ? <Check size={11} /> :
            <Copy size={11} />
          }
          onClick={() => void handleGetPartnerLink()}
          disabled={mutating}
          className="w-full justify-center"
          title="Generate the partner-facing review URL (starts a partner review if needed) and copy it to your clipboard."
        >
          {partnerLinkCopied ? 'Link copied' : 'Get partner review link'}
        </WMButton>
        {!myOpenInternal && (
          <WMButton
            variant="secondary"
            size="sm"
            iconLeft={mutating ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
            onClick={() => void handleStartInternal()}
            disabled={mutating}
            className="w-full justify-center"
          >
            Start an internal review
          </WMButton>
        )}
        <WMButton
          variant="secondary"
          size="sm"
          iconLeft={<UserPlus size={11} />}
          onClick={() => setRequestModalOpen(true)}
          disabled={mutating}
          className="w-full justify-center"
        >
          Request a review
        </WMButton>
      </div>

      {error && (
        <div role="alert" className="rounded-md border border-wm-danger/40 bg-wm-danger-bg px-2 py-1.5 text-[11px] text-wm-danger flex items-start gap-1.5">
          <X size={11} className="mt-0.5 shrink-0" />
          <p className="flex-1 leading-snug">{error}</p>
        </div>
      )}

      {/* Filter + round tabs */}
      {feedbackBoards.boards.length > 0 && (
        <div className="flex flex-col gap-2">
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

      {/* Boards */}
      {feedbackBoards.boards.length === 0 ? (
        <EmptyState
          icon={<Inbox size={20} />}
          title="No reviews yet"
          body="Start a partner review above, or open an internal review."
        />
      ) : (
        <FeedbackBoardVerticalList
          boards={visibleBoards}
          pageNameFor={pageNameFor}
          sectionLabelFor={sectionLabelFor}
          onJumpToLocation={(c) => {
            if (c.web_section_id) onJumpToSection(c.web_page_id, c.web_section_id)
          }}
          onChanged={load}
          filter={commentFilter}
        />
      )}

      {requestModalOpen && (
        <RequestReviewModal
          projectId={projectId}
          currentEmail={user?.email ?? null}
          onClose={() => setRequestModalOpen(false)}
          onCreated={load}
        />
      )}
    </div>
  )
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
  // Copywriter notes for the active page — pulled from
  // web_pages.brief.copywriter_meta, which the importer writes on
  // every commit. Shown above the rule-violation findings so the
  // strategist sees scan flags + kickbacks + gaps without leaving
  // the rail.
  const [pageBrief, setPageBrief] = useState<unknown>(null)
  // Cowork handoff metadata for the active page — populated by
  // /api/web/cowork/handoff-to-pages. When present, this tab surfaces
  // the cowork audit (per-section provenance, verbatim band, deferred
  // items, axes, directives, notion link) ABOVE the heuristic scan.
  // The two coexist: cowork audit is the high-signal pipeline output;
  // the heuristic scan is the read-anything-checker safety net.
  const [coworkPageMeta, setCoworkPageMeta] = useState<CoworkHandoffPageMeta | null>(null)
  const [coworkSections, setCoworkSections]   = useState<Array<CoworkHandoffSectionMeta & { web_section_id: string; sort_order: number; template_id: string | null; split_group_id: string | null; split_position: number | null }>>([])
  const [coworkPageAuditSource, setCoworkPageAuditSource] = useState<string | null>(null)
  const [coworkPageNotionUrl, setCoworkPageNotionUrl] = useState<string | null>(null)
  const [coworkHandoffAt, setCoworkHandoffAt] = useState<string | null>(null)

  const scan = useCallback(async () => {
    if (!activePageId) return
    setScanning(true)
    const list = await runAudit(activePageId)
    setFindings(list)
    setScanned(true)
    setScanning(false)
    onCount(list.length)
  }, [activePageId, onCount])

  // Clear findings + refetch brief when page changes
  useEffect(() => {
    setFindings([])
    setScanned(false)
    onCount(0)
    if (!activePageId) {
      setPageBrief(null)
      return
    }
    let cancelled = false
    void (async () => {
      const [pageRes, sectionsRes] = await Promise.all([
        supabase
          .from('web_pages')
          .select('brief, cowork_handoff_meta, audit_source, notion_url, cowork_handoff_at')
          .eq('id', activePageId)
          .maybeSingle(),
        supabase
          .from('web_sections')
          .select('id, sort_order, content_template_id, split_group_id, split_position, cowork_section_meta')
          .eq('web_page_id', activePageId)
          .order('sort_order', { ascending: true }),
      ])
      if (cancelled) return
      const pageRow = pageRes.data as {
        brief?: unknown
        cowork_handoff_meta?: CoworkHandoffPageMeta | null
        audit_source?: string | null
        notion_url?: string | null
        cowork_handoff_at?: string | null
      } | null
      setPageBrief(pageRow?.brief ?? null)
      setCoworkPageMeta(pageRow?.cowork_handoff_meta ?? null)
      setCoworkPageAuditSource(pageRow?.audit_source ?? null)
      setCoworkPageNotionUrl(pageRow?.notion_url ?? null)
      setCoworkHandoffAt(pageRow?.cowork_handoff_at ?? null)

      const rows = (sectionsRes.data ?? []) as Array<{
        id: string
        sort_order: number
        content_template_id: string | null
        split_group_id: string | null
        split_position: number | null
        cowork_section_meta: CoworkHandoffSectionMeta | null
      }>
      setCoworkSections(
        rows
          .filter(r => r.cowork_section_meta != null)
          .map(r => ({
            ...(r.cowork_section_meta as CoworkHandoffSectionMeta),
            web_section_id:  r.id,
            sort_order:      r.sort_order,
            template_id:     r.content_template_id,
            split_group_id:  r.split_group_id,
            split_position:  r.split_position,
          })),
      )
    })()
    return () => { cancelled = true }
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
      {coworkPageMeta && (
        <CoworkAuditPanel
          pageMeta={coworkPageMeta}
          auditSource={coworkPageAuditSource}
          notionUrl={coworkPageNotionUrl}
          handoffAt={coworkHandoffAt}
          sections={coworkSections}
          filter={q}
        />
      )}
      <CopywriterNotesPanel brief={pageBrief} />
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

// ── Cowork audit panel ────────────────────────────────────────────────
// Lives in the AuditTab when the active page has cowork_handoff_meta
// (i.e. the page came from the cowork pipeline). Renders the
// per-section provenance the handoff endpoint preserved: section
// intent, verbatim band/actual, atom/fact/crawl pills, voice anchor,
// deferred items, axes, directives, notion link, split-group marker.
//
// Filter (the searchbox in the rail header) matches against section
// intent text + directive details + any pill label.

function CoworkAuditPanel({
  pageMeta, auditSource, notionUrl, handoffAt, sections, filter,
}: {
  pageMeta:    CoworkHandoffPageMeta
  auditSource: string | null
  notionUrl:   string | null
  handoffAt:   string | null
  sections:    Array<CoworkHandoffSectionMeta & { web_section_id: string; sort_order: number; template_id: string | null; split_group_id: string | null; split_position: number | null }>
  filter:      string
}) {
  const bandTone: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
    green:  'success',
    yellow: 'warning',
    red:    'danger',
    gap:    'neutral',
  }
  const auditLabel: Record<string, string> = {
    'notion':                 '📓 from Notion',
    'notion-gap':             '⚠ gap (no Notion match)',
    'generated':              '✨ generated by cowork',
    'generated-supplemental': '✨ generated (supplemental)',
  }

  const pageDirectives = (pageMeta.directives ?? []) as Array<{ kind: string; severity: string; detail: string; section?: string; slot?: string }>
  const handoffNote   = (pageMeta.outline_meta?.handoff_note as string | undefined) ?? null

  // Apply the filter to sections + their directives + intent text.
  const sectionsVisible = !filter ? sections : sections.filter(s => {
    const hay = [
      s.section_intent_text,
      ...(s.directives ?? []).map(d => `${d.kind} ${d.detail}`),
      s.notion_url,
      s.split_from,
      s.template_id,
    ].filter(Boolean).join(' ').toLowerCase()
    return hay.includes(filter.toLowerCase())
  })

  return (
    <div className="rounded-lg border border-wm-accent/40 bg-wm-accent-tint/30 overflow-hidden">
      {/* Page header */}
      <header className="px-3 py-2.5 border-b border-wm-accent/30">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <WMStatusPill tone={bandTone[pageMeta.overall_band ?? ''] ?? 'neutral'} size="sm">
            {pageMeta.overall_band ?? 'audited'}
          </WMStatusPill>
          {auditSource && (
            <span className="text-[10px] uppercase tracking-wide font-bold text-wm-accent-strong">
              {auditLabel[auditSource] ?? auditSource}
            </span>
          )}
          {handoffAt && (
            <span className="text-[10px] text-wm-text-subtle ml-auto">
              {new Date(handoffAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
        {notionUrl && (
          <a
            href={notionUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-wm-accent hover:underline inline-flex items-center gap-1"
          >
            Open source in Notion →
          </a>
        )}
        {handoffNote && (
          <details className="mt-2 text-[11px] text-wm-text-muted">
            <summary className="cursor-pointer font-semibold text-wm-text">Page handoff note</summary>
            <pre className="mt-1.5 whitespace-pre-wrap font-sans text-[11px] leading-snug">{handoffNote}</pre>
          </details>
        )}
        {pageDirectives.length > 0 && (
          <div className="mt-2 space-y-1">
            <p className="text-[10px] uppercase tracking-wide font-bold text-wm-text-subtle">Page directives</p>
            {pageDirectives.map((d, i) => <DirectiveRow key={i} directive={d} />)}
          </div>
        )}
      </header>

      {/* Per-section detail */}
      <div className="divide-y divide-wm-accent/20">
        {sectionsVisible.length === 0 && filter && (
          <p className="px-3 py-2 text-[11px] text-wm-text-muted italic">No sections match "{filter}".</p>
        )}
        {sectionsVisible.map(sec => <CoworkSectionRow key={sec.web_section_id} sec={sec} />)}
      </div>
    </div>
  )
}

function CoworkSectionRow({
  sec,
}: { sec: CoworkHandoffSectionMeta & { web_section_id: string; sort_order: number; template_id: string | null; split_group_id: string | null; split_position: number | null } }) {
  const [expanded, setExpanded] = useState(false)
  const bandLabels = { high: '≥0.7', mid: '0.3–0.7', low: '≤0.2' } as const
  const bandTarget = sec.intended_verbatim_band ? bandLabels[sec.intended_verbatim_band] : null
  const actual = sec.actual_verbatim_ratio
  const inBand = sec.intended_verbatim_band && typeof actual === 'number'
    ? (sec.intended_verbatim_band === 'high' ? actual >= 0.7
      : sec.intended_verbatim_band === 'mid'  ? actual >= 0.3 && actual <= 0.7
      : sec.intended_verbatim_band === 'low'  ? actual <= 0.2
      : true)
    : null

  return (
    <div className="px-3 py-2.5">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-start gap-2 text-left"
      >
        {expanded ? <ChevronDown size={12} className="text-wm-text-subtle shrink-0 mt-0.5" /> : <ChevronRight size={12} className="text-wm-text-subtle shrink-0 mt-0.5" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
            {sec.template_id && (
              <span className="text-[9px] uppercase tracking-wider font-bold text-wm-text-subtle bg-wm-bg-elevated px-1.5 py-0.5 rounded">
                {sec.template_id}
              </span>
            )}
            {sec.split_group_id && sec.split_position && (
              <span className="text-[9px] uppercase tracking-wider font-bold text-wm-warning bg-wm-warning-bg px-1.5 py-0.5 rounded">
                split {sec.split_position}{sec.split_from ? ` of ${sec.split_from}` : ''}
              </span>
            )}
          </div>
          {sec.section_intent_text && (
            <p className="text-[11px] text-wm-text leading-snug">{sec.section_intent_text}</p>
          )}
          <div className="mt-1 flex items-center gap-2 text-[10px] text-wm-text-muted flex-wrap">
            {sec.atom_ids_used.length > 0 && <span title="atoms cited">🔵 {sec.atom_ids_used.length} atom{sec.atom_ids_used.length === 1 ? '' : 's'}</span>}
            {sec.fact_ids_used.length > 0 && <span title="facts cited">🟢 {sec.fact_ids_used.length} fact{sec.fact_ids_used.length === 1 ? '' : 's'}</span>}
            {sec.crawl_topic_keys_used.length > 0 && <span title="crawl topics cited">🟠 {sec.crawl_topic_keys_used.length} crawl</span>}
            {sec.deferred_items.length > 0 && <span title="items deferred at bind" className="text-wm-warning">📦 {sec.deferred_items.length} deferred</span>}
            {bandTarget && typeof actual === 'number' && (
              <span className={inBand ? 'text-wm-success' : 'text-wm-danger'} title={`band: ${sec.intended_verbatim_band} (target ${bandTarget}) · actual: ${actual.toFixed(2)}`}>
                verbatim {actual.toFixed(2)} {inBand ? '✓' : '✗'}
              </span>
            )}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="mt-2 ml-4 space-y-2 text-[10.5px] text-wm-text-muted">
          {sec.voice_notes && (
            <div>
              <p className="text-[9px] uppercase tracking-wider font-bold text-wm-text-subtle mb-0.5">Voice notes</p>
              <p className="leading-snug">{sec.voice_notes}</p>
            </div>
          )}
          {sec.axes && Object.keys(sec.axes).length > 0 && (
            <div>
              <p className="text-[9px] uppercase tracking-wider font-bold text-wm-text-subtle mb-0.5">5-axis scores</p>
              <ul className="space-y-0.5">
                {Object.entries(sec.axes).map(([axis, v]) => (
                  <li key={axis} className="flex items-center justify-between gap-2">
                    <span>{axis}</span>
                    <span className={v.pass ? 'text-wm-success' : 'text-wm-danger'}>
                      {v.score}{v.pass ? '' : '✗'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {sec.directives.length > 0 && (
            <div>
              <p className="text-[9px] uppercase tracking-wider font-bold text-wm-text-subtle mb-0.5">Directives</p>
              {sec.directives.map((d, i) => <DirectiveRow key={i} directive={d} />)}
            </div>
          )}
          {sec.deferred_items.length > 0 && (
            <div>
              <p className="text-[9px] uppercase tracking-wider font-bold text-wm-warning mb-0.5">Deferred items ({sec.deferred_items.length})</p>
              <p className="text-[10px] text-wm-text-subtle italic mb-1">Items the audit truncated to fit the template. Promote any to a new section or accept the truncation.</p>
              <ul className="space-y-1">
                {sec.deferred_items.map((d, i) => (
                  <li key={i} className="rounded bg-wm-bg-elevated border border-wm-border p-1.5">
                    <p className="font-semibold text-wm-text text-[10.5px]">{String((d as Record<string, unknown>).title ?? (d as Record<string, unknown>).kind ?? 'item')}</p>
                    {(d as Record<string, unknown>).reason ? <p className="text-[10px]">{String((d as Record<string, unknown>).reason)}</p> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {sec.notion_url && (
            <a href={sec.notion_url} target="_blank" rel="noopener noreferrer" className="text-[10.5px] text-wm-accent hover:underline inline-flex items-center gap-1">
              View this section's source in Notion →
            </a>
          )}
          {(sec.atom_ids_used.length > 0 || sec.fact_ids_used.length > 0 || sec.crawl_topic_keys_used.length > 0) && (
            <details>
              <summary className="cursor-pointer text-[10.5px] font-semibold text-wm-text">Source references</summary>
              <div className="mt-1 ml-2 space-y-1 font-mono text-[10px]">
                {sec.atom_ids_used.length > 0 && <p>🔵 atoms: {sec.atom_ids_used.map(a => a.slice(0, 8)).join(', ')}</p>}
                {sec.fact_ids_used.length > 0 && <p>🟢 facts: {sec.fact_ids_used.map(a => a.slice(0, 8)).join(', ')}</p>}
                {sec.crawl_topic_keys_used.length > 0 && <p>🟠 crawl: {sec.crawl_topic_keys_used.join(', ')}</p>}
                {sec.voice_anchor_atom_ids.length > 0 && <p>🎙 voice anchor: {sec.voice_anchor_atom_ids.map(a => a.slice(0, 8)).join(', ')}</p>}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

function DirectiveRow({ directive }: { directive: { kind: string; severity: string; detail: string; section?: string; slot?: string } }) {
  const tone: 'danger' | 'warning' | 'info' =
    directive.severity === 'blocker' ? 'danger' :
    directive.severity === 'warning' ? 'warning' : 'info'
  return (
    <div className="rounded bg-wm-bg-elevated border border-wm-border p-1.5">
      <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
        <WMStatusPill tone={tone} size="sm">{directive.severity}</WMStatusPill>
        <span className="text-[10px] font-mono text-wm-text-subtle">{directive.kind}</span>
        {directive.slot && <span className="text-[10px] text-wm-text-subtle">· slot: {directive.slot}</span>}
      </div>
      <p className="text-[10.5px] text-wm-text leading-snug">{directive.detail}</p>
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
