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

import { useEffect, useMemo, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Tag, BookOpen, Mic, MessageSquare, AlertTriangle, RotateCw, Search,
  Loader2, SquarePen, Inbox,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { runAudit } from '../../lib/webAudit'
import type { AuditFinding, AuditSeverity } from '../../lib/webAudit'
import type {
  StrategyWebProject, WebPage, WebReviewComment,
} from '../../types/database'
import { loadProjectReviewState } from '../../lib/webReviews'
import { WMButton } from './Button'
import { WMStatusPill } from './StatusPill'
import { SectionDetailsPanel } from './sectioneditor/SectionDetailsPanel'
import { SnippetFocusProvider } from './sectioneditor/SnippetFocusContext'
import { useSectionDetail } from './sectioneditor/SectionEditingContext'
import { SnippetsWorkspace } from './workspaces/SnippetsWorkspace'
import { VoiceWorkspace } from './workspaces/VoiceWorkspace'
import { HeuristicsWorkspace } from './workspaces/HeuristicsWorkspace'

type RailTab = 'section' | 'snippets' | 'voice' | 'heuristics' | 'feedback' | 'audit'

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
  const activePageId = activeTab === 'pages' ? params.get('page') : null

  const sectionDetail = useSectionDetail()
  const sectionTabAvailable = activeTab === 'pages' && sectionDetail != null

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
    next.set('tab', 'pages')
    next.set('page', pageId)
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
              placeholder={tab === 'feedback' ? 'Filter feedback…' : 'Filter violations…'}
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
  const [openComments, setOpenComments] = useState<WebReviewComment[]>([])
  const [resolvedComments, setResolvedComments] = useState<WebReviewComment[]>([])
  const [pages, setPages] = useState<WebPage[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const state = await loadProjectReviewState(projectId)
    setOpenComments(state.comments.filter(c => c.status === 'open'))
    // Most-recently-resolved first; cap at 50 to keep the rail fast.
    setResolvedComments(
      state.comments
        .filter(c => c.status !== 'open')
        .sort((a, b) => (b.resolved_at ?? b.updated_at ?? '').localeCompare(a.resolved_at ?? a.updated_at ?? ''))
        .slice(0, 50),
    )
    const { data: pageRows } = await supabase
      .from('web_pages')
      .select('id, name, slug, sort_order, web_project_id')
      .eq('web_project_id', projectId)
      .eq('archived', false)
      .order('sort_order')
    setPages((pageRows ?? []) as WebPage[])
    setLoading(false)
  }, [projectId])

  useEffect(() => { void load() }, [load])

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

  const filteredOpen     = useMemo(() => openComments.filter(filterFn), [openComments, filterFn])
  const filteredResolved = useMemo(() => resolvedComments.filter(filterFn), [resolvedComments, filterFn])

  const groupByPage = useCallback((items: WebReviewComment[]) => {
    const groups: Array<{ page: WebPage; items: WebReviewComment[] }> = []
    for (const p of pages) {
      const own = items.filter(c => c.web_page_id === p.id)
      if (own.length > 0) groups.push({ page: p, items: own })
    }
    return groups
  }, [pages])

  const groupedOpen     = useMemo(() => groupByPage(filteredOpen),     [filteredOpen, groupByPage])
  const groupedResolved = useMemo(() => groupByPage(filteredResolved), [filteredResolved, groupByPage])

  if (loading) {
    return (
      <div className="p-3 space-y-1.5">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-14 rounded bg-wm-bg-hover animate-pulse" />
        ))}
      </div>
    )
  }

  if (filteredOpen.length === 0 && filteredResolved.length === 0) {
    return (
      <div className="p-3">
        <EmptyState
          icon={<Inbox size={20} />}
          title={q ? 'No matches' : 'No feedback yet'}
          body={q
            ? 'No comments match this filter. Try different keywords.'
            : 'Start an internal review (or send a partner review link) and feedback will roll up here.'}
        />
      </div>
    )
  }

  return (
    <div className="p-3 space-y-3">
      {groupedOpen.map(({ page, items }) => (
        <div key={page.id}>
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1.5 px-1">
            {page.name} · {items.length}
          </p>
          <ul className="space-y-1">
            {items.map(c => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => c.web_section_id && onJumpToSection(page.id, c.web_section_id)}
                  disabled={!c.web_section_id}
                  className="w-full text-left rounded-md bg-wm-bg-elevated border border-wm-border px-2.5 py-1.5 hover:border-wm-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed group"
                >
                  <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                    <KindTag kind={c.kind} />
                    {c.field_key && <span className="font-mono text-[10px] text-wm-text-subtle">{c.field_key}</span>}
                    <span className="ml-auto text-[10px] font-semibold text-wm-text">
                      {c.author_external_name ?? (c.author_kind === 'partner' ? 'Partner' : 'Staff')}
                    </span>
                  </div>
                  <p className="text-[11px] text-wm-text leading-snug line-clamp-2">
                    {c.body || (typeof c.suggested_value === 'string' ? stripHtml(c.suggested_value) : '(no body)')}
                  </p>
                  <p className="text-[10px] text-wm-text-subtle mt-0.5">{fmtShortDateTime(c.created_at)}</p>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {/* Resolved — grayed-out tail. Hidden when none surface. */}
      {groupedResolved.length > 0 && (
        <div className="pt-2 mt-2 border-t border-wm-border/60 space-y-3 opacity-70">
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle px-1">
            Resolved · {filteredResolved.length}
          </p>
          {groupedResolved.map(({ page, items }) => (
            <div key={`resolved-${page.id}`}>
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1.5 px-1">
                {page.name} · {items.length}
              </p>
              <ul className="space-y-1">
                {items.map(c => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => c.web_section_id && onJumpToSection(page.id, c.web_section_id)}
                      disabled={!c.web_section_id}
                      className="w-full text-left rounded-md bg-wm-bg-hover/40 border border-wm-border/60 px-2.5 py-1.5 hover:border-wm-accent transition-colors disabled:cursor-default group line-through decoration-wm-text-subtle/40 hover:no-underline"
                    >
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <KindTag kind={c.kind} />
                        <span className="text-[9px] uppercase tracking-widest font-bold rounded-full px-1.5 py-0.5 bg-wm-success-bg text-wm-success border border-wm-success/20 no-underline">
                          {c.status}
                        </span>
                        {c.field_key && <span className="font-mono text-[10px] text-wm-text-subtle no-underline">{c.field_key}</span>}
                        <span className="ml-auto text-[10px] text-wm-text-subtle no-underline">
                          {c.author_external_name ?? (c.author_kind === 'partner' ? 'Partner' : 'Staff')}
                        </span>
                      </div>
                      <p className="text-[11px] text-wm-text leading-snug line-clamp-2 no-underline">
                        {c.body || (typeof c.suggested_value === 'string' ? stripHtml(c.suggested_value) : '(no body)')}
                      </p>
                      <p className="text-[10px] text-wm-text-subtle mt-0.5 no-underline">
                        {fmtShortDateTime(c.created_at)}
                        {c.resolved_at && ` · resolved ${fmtShortDateTime(c.resolved_at)}`}
                      </p>
                      {c.resolution_note && (
                        <p className="text-[10px] text-wm-text-subtle italic mt-0.5 no-underline">
                          {c.resolution_note}
                        </p>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function KindTag({ kind }: { kind: WebReviewComment['kind'] }) {
  const cfg = {
    comment:   { label: 'Comment',   tone: 'bg-lavender-tint text-primary-purple border border-primary-purple/20' },
    suggested: { label: 'Suggested', tone: 'bg-blue-50 text-blue-700 border border-blue-200' },
    requested: { label: 'Requested', tone: 'bg-amber-50 text-amber-700 border border-amber-200' },
  }[kind]
  return (
    <span className={`inline-flex items-center text-[9px] uppercase tracking-widest font-bold rounded-full px-1.5 py-0.5 ${cfg.tone}`}>
      {cfg.label}
    </span>
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
