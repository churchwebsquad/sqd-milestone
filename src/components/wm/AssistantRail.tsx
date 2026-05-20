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
 *   Ideas      — AI suggestions + manual notes
 *   Audit      — heuristic violations on the active page
 *
 * The rail is context-aware: when the active workspace is `pages`, the
 * Audit tab scans the currently-open page (?page=<id>) and the Ideas
 * tab scopes to that page.
 */

import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Tag, BookOpen, Mic, Lightbulb, AlertTriangle, RotateCw, Search,
  Loader2, Plus, X, ArrowRight, Trash2, SquarePen,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { runAudit } from '../../lib/webAudit'
import type { AuditFinding, AuditSeverity } from '../../lib/webAudit'
import type { StrategyWebProject, WebAIIdea } from '../../types/database'
import { WMButton } from './Button'
import { WMIconButton } from './IconButton'
import { WMStatusPill } from './StatusPill'
import { SectionDetailsPanel } from './sectioneditor/SectionDetailsPanel'
import { SnippetFocusProvider } from './sectioneditor/SnippetFocusContext'
import { useSectionDetail } from './sectioneditor/SectionEditingContext'
import { SnippetsWorkspace } from './workspaces/SnippetsWorkspace'
import { VoiceWorkspace } from './workspaces/VoiceWorkspace'
import { HeuristicsWorkspace } from './workspaces/HeuristicsWorkspace'

type RailTab = 'section' | 'snippets' | 'voice' | 'heuristics' | 'ideas' | 'audit'

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
  const [counts, setCounts] = useState({ snippets: 0, ideas: 0, audit: 0 })
  const [params] = useSearchParams()
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

  // Counts on mount + project change
  const loadCounts = useCallback(async () => {
    const [snip, ideas] = await Promise.all([
      supabase
        .from('web_project_snippets')
        .select('id', { count: 'exact', head: true })
        .eq('web_project_id', projectId)
        .eq('archived', false),
      supabase
        .from('web_ai_ideas')
        .select('id', { count: 'exact', head: true })
        .eq('web_project_id', projectId)
        .eq('status', 'pending'),
    ])
    setCounts(c => ({ ...c, snippets: snip.count ?? 0, ideas: ideas.count ?? 0 }))
  }, [projectId])

  useEffect(() => { void loadCounts() }, [loadCounts])

  // Workspaces hosted in the rail (Snippets / Voice / Heuristics)
  // render their own filter UI internally, so the rail's search box
  // only applies to the simple list tabs.
  const showSearchBox = tab === 'ideas' || tab === 'audit'

  return (
    <div className="h-full flex flex-col text-sm">
      <div className="flex items-center border-b border-wm-border bg-wm-bg">
        {sectionTabAvailable && (
          <RailTabButton tab="section" active={tab} setTab={setTab} icon={<SquarePen size={13} />} label="Section" />
        )}
        <RailTabButton tab="snippets"   active={tab} setTab={setTab} icon={<Tag size={13} />}            count={counts.snippets} label="Snippets" />
        <RailTabButton tab="voice"      active={tab} setTab={setTab} icon={<Mic size={13} />}            label="Voice" />
        <RailTabButton tab="heuristics" active={tab} setTab={setTab} icon={<BookOpen size={13} />}       label="Heuristics" />
        <RailTabButton tab="ideas"      active={tab} setTab={setTab} icon={<Lightbulb size={13} />}      count={counts.ideas} label="Ideas" />
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
              placeholder={tab === 'ideas' ? 'Filter ideas…' : 'Filter violations…'}
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
        {tab === 'ideas' && <IdeasTab projectId={projectId} activePageId={activePageId} query={query} onChange={loadCounts} />}
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

// ── Ideas tab ────────────────────────────────────────────────────────

function IdeasTab({
  projectId, activePageId, query, onChange,
}: {
  projectId: string
  activePageId: string | null
  query: string
  onChange: () => Promise<void>
}) {
  const [ideas, setIdeas] = useState<WebAIIdea[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('web_ai_ideas')
      .select('*')
      .eq('web_project_id', projectId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
    setIdeas((data ?? []) as WebAIIdea[])
    setLoading(false)
  }, [projectId])

  useEffect(() => { void load() }, [load])

  const addNote = async () => {
    if (!draft.trim()) return
    await supabase.from('web_ai_ideas').insert({
      web_project_id: projectId,
      scope: activePageId ? `page:${activePageId}` : 'global',
      category: 'other',
      title: draft.trim(),
      proposal: { kind: 'manual_note', body: draft.trim() },
      status: 'pending',
    })
    setDraft('')
    setAdding(false)
    await load()
    await onChange()
  }

  const resolve = async (id: string, status: 'accepted' | 'dismissed' | 'snoozed') => {
    await supabase
      .from('web_ai_ideas')
      .update({ status, resolved_at: new Date().toISOString() })
      .eq('id', id)
    await load()
    await onChange()
  }

  const q = query.trim().toLowerCase()
  const visible = q ? ideas.filter(i => i.title.toLowerCase().includes(q)) : ideas

  return (
    <div className="p-3 space-y-2">
      {adding ? (
        <div className="rounded-md bg-wm-bg border border-wm-accent p-2 space-y-2">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            autoFocus
            rows={3}
            placeholder="Note an idea or a TODO — AI will see this when Stage 1 runs."
            className="w-full rounded bg-wm-bg-elevated border border-wm-border px-2 py-1.5 text-[12px] text-wm-text outline-none focus:border-wm-border-focus"
          />
          <div className="flex items-center justify-end gap-1">
            <WMButton variant="ghost" size="sm" onClick={() => { setAdding(false); setDraft('') }}>
              Cancel
            </WMButton>
            <WMButton variant="primary" size="sm" onClick={addNote}>
              Add note
            </WMButton>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="w-full inline-flex items-center justify-center gap-1.5 h-8 rounded-md border border-dashed border-wm-border text-[12px] font-medium text-wm-text-muted hover:border-wm-border-focus hover:text-wm-text transition-colors"
        >
          <Plus size={11} /> Add a note
        </button>
      )}

      {loading ? (
        <div className="space-y-1.5">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-12 rounded bg-wm-bg-hover animate-pulse" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<Lightbulb size={20} />}
          title="No ideas yet"
          body="Add a note manually, or wait for AI suggestions when Stage 1 runs."
        />
      ) : (
        visible.map(idea => (
          <IdeaCard
            key={idea.id}
            idea={idea}
            onAccept={() => void resolve(idea.id, 'accepted')}
            onDismiss={() => void resolve(idea.id, 'dismissed')}
          />
        ))
      )}
    </div>
  )
}

function IdeaCard({
  idea, onAccept, onDismiss,
}: {
  idea: WebAIIdea
  onAccept: () => void
  onDismiss: () => void
}) {
  return (
    <div className="rounded-md bg-wm-bg-elevated border border-wm-border p-2.5 group">
      <div className="flex items-start gap-2">
        <Lightbulb size={11} className="text-wm-accent mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium text-wm-text leading-snug">{idea.title}</p>
          {idea.reason && <p className="text-[10px] text-wm-text-subtle mt-1">{idea.reason}</p>}
          <div className="mt-1.5 flex items-center justify-between gap-1.5">
            <span className="text-[10px] text-wm-text-subtle">{idea.scope}</span>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <WMIconButton label="Dismiss" size="sm" onClick={onDismiss}>
                <X size={11} />
              </WMIconButton>
              <WMIconButton label="Accept" size="sm" onClick={onAccept}>
                <ArrowRight size={11} />
              </WMIconButton>
            </div>
          </div>
        </div>
      </div>
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
