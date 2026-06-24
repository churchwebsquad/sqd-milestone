/**
 * Web Manager — Core Messages review workspace.
 *
 * Strategist-language naming: the partner-facing concept is "core
 * message" — a discrete statement about the church (voice rule, value
 * statement, ethos line, persona signal, etc.) that the pipeline can
 * route into pages. Internally these are still rows on `content_atoms`
 * and the local TypeScript interface is still `Atom` — implementation
 * detail. The strategist sees "core messages" in every label.
 *
 * The strategist's gate between normalize-intake (which produces core
 * messages in status='draft') and the cowork pipeline (which routes
 * status='approved' OR 'draft' core messages into allocation/outline/
 * draft).
 *
 * Surfaced 2026-06-13 by the DS inventory-readiness warning that 71/71
 * core messages on a real account still sat status='draft' — meaning
 * every cowork run was implicitly trusting unreviewed partner content.
 * This workspace closes that root-cause gap: the strategist reads each
 * core message + decides keep/edit/reject before any draft money is
 * spent.
 *
 * MVP scope (deliberately narrow):
 *   - Group core messages by topic (voice_rule, value_statement,
 *     prose_snippet, …)
 *   - Per message: body + source provenance + status + verbatim + confidence
 *   - Three actions per message: Approve (draft→approved), Reject
 *     (→archived), Edit (inline body editor + verbatim toggle)
 *   - Bulk-approve all drafts in a topic group
 *   - Filter by status (default: show drafts only — the review queue)
 */

import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Edit2, Loader2, Plus, Save, X } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { WMStatusPill } from '../StatusPill'
import type { StrategyWebProject } from '../../../types/database'

interface Atom {
  id:           string
  topic:        string
  body:         string
  source_kind:  string | null
  source_ref:   string | null
  verbatim:     boolean
  confidence:   number | null
  status:       'draft' | 'approved' | 'archived'
  created_at:   string
  updated_at:   string
}

interface Props {
  project:  StrategyWebProject
  onChange?: () => void
}

type StatusFilter = 'all' | 'draft' | 'approved' | 'archived'

/** Tone for the per-status pill. */
function pillToneFor(status: Atom['status']): 'neutral' | 'success' | 'warning' | 'danger' {
  if (status === 'approved') return 'success'
  if (status === 'archived') return 'danger'
  return 'warning'   // 'draft' — needs strategist attention
}

/** Topic display order: voice/character messages first (highest review
 *  value), then content, then everything else alphabetically. The
 *  strategist cares most about voice messages — those drive every
 *  page's tone. */
function topicSortKey(topic: string): string {
  const VOICE_FIRST = ['voice_rule', 'voice_sample', 'tone_descriptor']
  const ETHOS = ['ethos', 'mission_statement', 'vision_statement', 'x_factor']
  if (VOICE_FIRST.includes(topic)) return `0_${topic}`
  if (ETHOS.includes(topic))       return `1_${topic}`
  return `2_${topic}`
}

export function AtomReviewWorkspace({ project, onChange }: Props) {
  const [atoms, setAtoms]                 = useState<Atom[]>([])
  const [loading, setLoading]             = useState(true)
  const [error, setError]                 = useState<string | null>(null)
  const [statusFilter, setStatusFilter]   = useState<StatusFilter>('draft')
  const [collapsedTopics, setCollapsedTopics] = useState<Set<string>>(new Set())
  const [editingId, setEditingId]         = useState<string | null>(null)
  const [savingIds, setSavingIds]         = useState<Set<string>>(new Set())

  // Empty-state CTA needs: are there intake docs sitting unprocessed?
  // Read the count once on load. Drives the "Run intake normalization"
  // banner that surfaces when atoms = 0.
  const [intakeDocCount, setIntakeDocCount] = useState<number>(0)
  const [normalizing, setNormalizing] = useState(false)
  // stage_0 meta — read from project prop + refreshed by re-fetch so
  // the "Running" state survives a tab close. Same pattern as the
  // CopyEngine workspace's started_at detection.
  const [stage0Meta, setStage0Meta] = useState<{
    started_at?:   string | null
    generated_at?: string | null
  } | null>(null)

  // Load atoms + stage_0 meta + intake doc count.
  const load = async () => {
    setLoading(true)
    setError(null)
    const [atomsRes, projRes, intakeRes] = await Promise.all([
      supabase
        .from('content_atoms')
        .select('id, topic, body, source_kind, source_ref, verbatim, confidence, status, created_at, updated_at')
        .eq('web_project_id', project.id)
        .order('topic', { ascending: true })
        .order('created_at', { ascending: true }),
      supabase
        .from('strategy_web_projects')
        .select('roadmap_state')
        .eq('id', project.id)
        .maybeSingle(),
      supabase
        .from('web_intake_documents')
        .select('id', { count: 'exact', head: true })
        .eq('web_project_id', project.id)
        .eq('archived', false),
    ])
    if (atomsRes.error) {
      setError(atomsRes.error.message)
      setLoading(false)
      return
    }
    setAtoms((atomsRes.data ?? []) as Atom[])
    const rs = (projRes.data?.roadmap_state ?? {}) as Record<string, unknown>
    const s0 = rs.stage_0 as Record<string, unknown> | undefined
    setStage0Meta((s0?._meta as { started_at?: string | null; generated_at?: string | null }) ?? null)
    setIntakeDocCount(intakeRes.count ?? 0)
    setLoading(false)
  }

  // Initial load + reload on project change. The setState happens
  // inside `load()` after the async fetch resolves — the standard
  // data-fetch pattern every other workspace in this directory uses.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [project.id])

  // Server-side "Stage 0 is in flight" detection — same shape as the
  // CopyEngine workspace. started_at > generated_at (or generated_at
  // is null) means the normalize-intake agent is still running. Poll
  // every 8s while running so we see completion.
  const stage0Running = !!(stage0Meta?.started_at
    && (!stage0Meta?.generated_at
        || new Date(stage0Meta.started_at).getTime() > new Date(stage0Meta.generated_at).getTime()))
  useEffect(() => {
    if (!stage0Running && !normalizing) return
    const t = setInterval(() => { void load() }, 8000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage0Running, normalizing])

  const runNormalize = async () => {
    setNormalizing(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const jwt = session?.access_token
      if (!jwt) throw new Error('Not authenticated')
      const res = await fetch('/api/web/agents/orchestrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ projectId: project.id, action: 'run_normalize' }),
      })
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        throw new Error(`Normalize-intake failed (HTTP ${res.status}): ${txt.slice(0, 200)}`)
      }
      await load()
      onChange?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to run intake normalization')
    } finally {
      setNormalizing(false)
    }
  }

  // Counts by status (always computed over ALL atoms, not the filtered view —
  // the strategist's summary needs the raw inventory).
  const counts = useMemo(() => {
    const c = { total: 0, draft: 0, approved: 0, archived: 0 }
    for (const a of atoms) {
      c.total++
      c[a.status]++
    }
    return c
  }, [atoms])

  // Atoms grouped by topic, filtered by status.
  const grouped = useMemo(() => {
    const filtered = statusFilter === 'all'
      ? atoms
      : atoms.filter(a => a.status === statusFilter)
    const groups = new Map<string, Atom[]>()
    for (const a of filtered) {
      const arr = groups.get(a.topic) ?? []
      arr.push(a)
      groups.set(a.topic, arr)
    }
    return Array.from(groups.entries()).sort(([a], [b]) =>
      topicSortKey(a).localeCompare(topicSortKey(b)))
  }, [atoms, statusFilter])

  // Persist a single-atom mutation. The supabase client carries the
  // strategist's auth context; RLS policies on content_atoms gate the
  // write (already scoped to web_project_id).
  const mutateAtom = async (id: string, patch: Partial<Atom>) => {
    setSavingIds(prev => { const n = new Set(prev); n.add(id); return n })
    // Cast to bypass the project-wide stale Supabase generated-types
    // issue (table types resolve to `never` on .update — same pattern
    // TemplateEditorPage + WebIntakePage + others sidestep). Runtime
    // shape is correct; ratchet baseline holds.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any)
      .from('content_atoms')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('web_project_id', project.id)   // defense-in-depth scope guard
    setSavingIds(prev => { const n = new Set(prev); n.delete(id); return n })
    if (err) {
      setError(`Update failed: ${err.message}`)
      return false
    }
    // Optimistic local update — refetch would flicker the list.
    setAtoms(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a))
    onChange?.()
    return true
  }

  const approve = (id: string) => mutateAtom(id, { status: 'approved' })
  const reject  = (id: string) => mutateAtom(id, { status: 'archived' })
  const restore = (id: string) => mutateAtom(id, { status: 'draft' })

  // Strategist-authored recommended_page entry. These represent build /
  // workflow directives the partner needs (e.g. "We need a Staff CPT
  // so the team can edit bios via the CMS") — NOT page copy. Routed to
  // page_allocation_plan.build_directives by plan-cross-page-allocation
  // and surfaced on the project's dev-handoff downstream. Status
  // defaults to 'approved' since the strategist created the entry
  // intentionally; source_kind='strategist_manual' so audit trails can
  // distinguish hand-added entries from normalize-intake's extraction.
  const addRecommendedPage = async (body: string): Promise<boolean> => {
    const trimmed = body.trim()
    if (!trimmed) return false
    setError(null)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error: err } = await (supabase as any)
      .from('content_atoms')
      .insert({
        web_project_id: project.id,
        topic:          'recommended_page',
        body:           trimmed,
        source_kind:    'strategist_manual',
        source_ref:     null,
        verbatim:       false,
        confidence:     1.0,
        status:         'approved',
      })
      .select('id, topic, body, source_kind, source_ref, verbatim, confidence, status, created_at, updated_at')
      .single()
    if (err) {
      setError(`Could not save: ${err.message}`)
      return false
    }
    setAtoms(prev => [...prev, data as Atom])
    onChange?.()
    // Make sure the recommended_page section is visible when the user
    // is filtering by 'draft' — drafts won't show the new entry.
    if (statusFilter !== 'all' && statusFilter !== 'approved') setStatusFilter('all')
    // Open the topic group if it's collapsed.
    setCollapsedTopics(prev => {
      const n = new Set(prev)
      n.delete('recommended_page')
      return n
    })
    return true
  }

  // Bulk-approve all drafts in a topic group.
  const bulkApproveTopic = async (topic: string) => {
    const draftsInTopic = atoms.filter(a => a.topic === topic && a.status === 'draft')
    if (draftsInTopic.length === 0) return
    if (!confirm(`Approve ${draftsInTopic.length} draft core message${draftsInTopic.length === 1 ? '' : 's'} in "${topic}"?`)) return
    // Sequential to keep the optimistic UI honest about failures.
    for (const a of draftsInTopic) await approve(a.id)
  }

  if (loading) {
    return (
      <div className="p-8 grid place-items-center text-wm-text-muted">
        <Loader2 className="animate-spin" />
      </div>
    )
  }

  return (
    <div className="p-4">
      <Header
        counts={counts}
        statusFilter={statusFilter}
        onFilter={setStatusFilter}
        onAddRecommendedPage={addRecommendedPage}
      />

      {error && (
        <div className="mb-3 rounded-md border border-wm-danger bg-wm-danger-bg px-3 py-2 text-[12px] text-wm-danger">
          {error}
        </div>
      )}

      {grouped.length === 0 && atoms.length === 0 && (() => {
        // Three distinct empty-state cases. The prior generic "all
        // approved or archived" line was misleading when nothing had
        // ever been extracted.
        const isRunning = stage0Running || normalizing
        const hasIntake = intakeDocCount > 0

        if (isRunning) {
          return (
            <div className="rounded-md border border-wm-accent/40 bg-wm-accent/5 p-5 text-center">
              <Loader2 size={18} className="animate-spin text-wm-accent mx-auto mb-2" />
              <p className="text-[13px] font-semibold text-wm-text">Extracting core messages from intake…</p>
              <p className="text-[11.5px] text-wm-text-muted mt-1">
                {hasIntake ? `${intakeDocCount} intake doc${intakeDocCount === 1 ? '' : 's'} feeding normalize-intake.` : 'normalize-intake is running.'} This usually takes 2–4 minutes; the page auto-updates when it finishes — safe to leave the tab.
              </p>
            </div>
          )
        }
        if (!hasIntake) {
          return (
            <div className="rounded-md border border-dashed border-wm-border bg-wm-bg p-5 text-center">
              <p className="text-[13px] font-semibold text-wm-text">No core messages yet</p>
              <p className="text-[11.5px] text-wm-text-muted mt-1">
                Upload the project's intake docs (strategy brief, content collection, discovery) on the Intake & Crawl tab. Once they're in, run intake normalization here to extract core messages.
              </p>
            </div>
          )
        }
        return (
          <div className="rounded-md border border-wm-accent/40 bg-wm-accent/5 p-5">
            <p className="text-[13px] font-semibold text-wm-text">
              {intakeDocCount} intake doc{intakeDocCount === 1 ? '' : 's'} uploaded — ready to extract core messages.
            </p>
            <p className="text-[11.5px] text-wm-text-muted mt-1 mb-3">
              Run intake normalization to atomize the uploads into reviewable core messages (mission, vision, values, voice rules, ethos lines, personas, etc.). The strategist review queue will populate here once it completes.
            </p>
            <button
              type="button"
              onClick={() => void runNormalize()}
              disabled={normalizing}
              className="inline-flex items-center gap-1.5 rounded-full bg-wm-accent px-4 py-1.5 text-[12px] font-semibold text-white hover:bg-wm-accent-hover disabled:opacity-50"
            >
              {normalizing ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              {normalizing ? 'Normalizing intake…' : 'Run intake normalization'}
            </button>
          </div>
        )
      })()}

      {grouped.length === 0 && atoms.length > 0 && (
        <div className="rounded-md border border-dashed border-wm-border bg-wm-bg p-5 text-center">
          <p className="text-[12px] text-wm-text-muted">
            {statusFilter === 'draft' ? 'No drafts to review — all core messages are approved or archived.' : `No core messages with status=${statusFilter}.`}
          </p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {grouped.map(([topic, topicAtoms]) => {
          const collapsed = collapsedTopics.has(topic)
          const draftsInGroup = topicAtoms.filter(a => a.status === 'draft').length
          return (
            <section key={topic} className="rounded-md border border-wm-border bg-wm-bg-elevated">
              <button
                type="button"
                onClick={() => setCollapsedTopics(prev => {
                  const n = new Set(prev)
                  if (n.has(topic)) n.delete(topic); else n.add(topic)
                  return n
                })}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-wm-bg-hover rounded-t-md"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {collapsed ? <ChevronRight size={14} className="text-wm-text-subtle shrink-0" /> : <ChevronDown size={14} className="text-wm-text-subtle shrink-0" />}
                  <span className="text-[13px] font-semibold text-wm-text">{topic}</span>
                  <span className="text-[11px] text-wm-text-muted">
                    {topicAtoms.length} {topicAtoms.length === 1 ? 'core message' : 'core messages'}
                    {statusFilter === 'all' && draftsInGroup > 0 && ` · ${draftsInGroup} draft`}
                  </span>
                </div>
                {draftsInGroup > 0 && statusFilter === 'draft' && (
                  <span
                    role="button"
                    onClick={(e) => { e.stopPropagation(); void bulkApproveTopic(topic) }}
                    className="text-[11px] font-medium px-2 py-1 rounded-md bg-wm-accent text-wm-text-on-accent hover:bg-wm-accent-hover"
                  >
                    Approve all {draftsInGroup}
                  </span>
                )}
              </button>
              {!collapsed && (
                <div className="border-t border-wm-border divide-y divide-wm-border">
                  {topicAtoms.map(a => (
                    <AtomCard
                      key={a.id}
                      atom={a}
                      editing={editingId === a.id}
                      saving={savingIds.has(a.id)}
                      onEditStart={() => setEditingId(a.id)}
                      onEditCancel={() => setEditingId(null)}
                      onEditSave={async (body, verbatim) => {
                        const ok = await mutateAtom(a.id, { body, verbatim })
                        if (ok) setEditingId(null)
                      }}
                      onApprove={() => approve(a.id)}
                      onReject={() => reject(a.id)}
                      onRestore={() => restore(a.id)}
                    />
                  ))}
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}

function Header({ counts, statusFilter, onFilter, onAddRecommendedPage }: {
  counts:       { total: number; draft: number; approved: number; archived: number }
  statusFilter: StatusFilter
  onFilter:     (f: StatusFilter) => void
  onAddRecommendedPage: (body: string) => Promise<boolean>
}) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    setSaving(true)
    const ok = await onAddRecommendedPage(draft)
    setSaving(false)
    if (ok) {
      setDraft('')
      setAdding(false)
    }
  }

  return (
    <div className="mb-4">
      <div className="flex items-end justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Core messages</p>
          <h2 className="text-[15px] font-semibold text-wm-text">Strategist review queue</h2>
          <p className="text-[11px] text-wm-text-muted mt-0.5">
            {counts.total} total · {counts.draft} draft · {counts.approved} approved · {counts.archived} archived
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setAdding(v => !v)}
            className="inline-flex items-center gap-1 rounded-md border border-wm-border bg-wm-bg-elevated text-wm-text-muted hover:text-wm-text hover:bg-wm-bg-hover px-2.5 py-1.5 text-[11px] font-medium"
            title="Add a build / workflow directive that's NOT page copy (a recommended page, CPT, redirect map, seasonal theme, etc.). Routes to build_directives at allocation time."
          >
            <Plus size={12} />
            Add recommended page
          </button>
          <div className="flex items-center gap-1 rounded-md border border-wm-border bg-wm-bg-elevated p-0.5 text-[11px]">
            {(['draft', 'approved', 'archived', 'all'] as StatusFilter[]).map(f => (
              <button
                key={f}
                type="button"
                onClick={() => onFilter(f)}
                className={
                  'px-2.5 py-1 rounded-[5px] font-medium ' +
                  (statusFilter === f
                    ? 'bg-wm-bg-selected text-wm-text'
                    : 'text-wm-text-muted hover:text-wm-text hover:bg-wm-bg-hover')
                }
              >
                {f === 'all' ? 'All' : f[0].toUpperCase() + f.slice(1)}
                {f !== 'all' && ` (${counts[f]})`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {adding && (
        <div className="mt-3 rounded-md border border-wm-accent/30 bg-wm-accent-tint/30 p-3">
          <p className="text-[11px] font-semibold text-wm-text mb-1">New recommended_page directive</p>
          <p className="text-[11px] text-wm-text-muted mb-2 leading-snug">
            One-line build / workflow directive the partner needs — a page the sitemap should
            consider, a CPT/CMS requirement, a redirect map, seasonal theming, etc.
            <strong> NOT page copy.</strong> Saves at status=approved with source_kind=strategist_manual;
            the allocation step routes it to <code className="font-mono">build_directives[]</code> for dev handoff.
          </p>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder='e.g. "We need a Staff CPT so the team can edit bios via the CMS without touching templates."'
            className="w-full rounded-md border border-wm-border bg-wm-bg-elevated px-2.5 py-1.5 text-[12px] text-wm-text leading-snug focus:outline-none focus:border-wm-border-focus min-h-[56px]"
            rows={3}
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => { setDraft(''); setAdding(false) }}
              disabled={saving}
              className="text-[11px] font-medium px-2.5 py-1 rounded-md text-wm-text-muted hover:bg-wm-bg-hover hover:text-wm-text disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={saving || !draft.trim()}
              className="text-[11px] font-semibold px-3 py-1 rounded-md bg-wm-accent text-wm-text-on-accent hover:bg-wm-accent-hover disabled:opacity-50 inline-flex items-center gap-1"
            >
              {saving ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
              Add directive
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function AtomCard({ atom, editing, saving, onEditStart, onEditCancel, onEditSave, onApprove, onReject, onRestore }: {
  atom:         Atom
  editing:      boolean
  saving:       boolean
  onEditStart:  () => void
  onEditCancel: () => void
  onEditSave:   (body: string, verbatim: boolean) => Promise<void>
  onApprove:    () => void
  onReject:     () => void
  onRestore:    () => void
}) {
  const [draftBody,     setDraftBody]     = useState(atom.body)
  const [draftVerbatim, setDraftVerbatim] = useState(atom.verbatim)

  // Re-sync local edit state when atom changes underneath (e.g. parent
  // refetched after a mutation). Only relevant when NOT actively
  // editing — mirroring external state into a controlled input that
  // the user might be mid-typing is exactly the legitimate setState-
  // in-effect use case the rule's docs name.
  useEffect(() => {
    if (!editing) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraftBody(atom.body)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraftVerbatim(atom.verbatim)
    }
  }, [atom.body, atom.verbatim, editing])

  return (
    <div className="px-3 py-3 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {editing ? (
            <textarea
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              className="w-full rounded-md border border-wm-border bg-wm-bg-elevated px-2.5 py-1.5 text-[12px] text-wm-text leading-snug focus:outline-none focus:border-wm-border-focus min-h-[64px]"
              rows={Math.min(8, Math.max(2, Math.ceil(draftBody.length / 80)))}
            />
          ) : (
            <p className="text-[12px] text-wm-text leading-snug whitespace-pre-wrap break-words">
              {atom.body}
            </p>
          )}
          <p className="mt-1.5 text-[10px] text-wm-text-subtle flex items-center gap-1.5 flex-wrap">
            <span>{atom.source_kind ?? 'unknown source'}</span>
            {atom.source_ref && <span>· {atom.source_ref}</span>}
            {typeof atom.confidence === 'number' && <span>· confidence {atom.confidence.toFixed(2)}</span>}
            <span>· {atom.body.length} chars</span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <WMStatusPill tone={pillToneFor(atom.status)} size="sm">{atom.status}</WMStatusPill>
          {editing ? (
            <label className="flex items-center gap-1 text-[10px] text-wm-text-muted">
              <input
                type="checkbox"
                checked={draftVerbatim}
                onChange={(e) => setDraftVerbatim(e.target.checked)}
                className="cursor-pointer"
              />
              verbatim
            </label>
          ) : atom.verbatim && (
            <span className="text-[10px] font-medium text-wm-accent-strong">verbatim</span>
          )}
        </div>
      </div>
      <div className="flex items-center justify-end gap-1.5">
        {editing ? (
          <>
            <button
              type="button"
              onClick={onEditCancel}
              disabled={saving}
              className="text-[11px] font-medium px-2.5 py-1 rounded-md border border-wm-border text-wm-text-muted hover:bg-wm-bg-hover disabled:opacity-50"
            >
              <span className="flex items-center gap-1"><X size={11} /> Cancel</span>
            </button>
            <button
              type="button"
              onClick={() => onEditSave(draftBody, draftVerbatim)}
              disabled={saving || draftBody.trim().length === 0}
              className="text-[11px] font-medium px-2.5 py-1 rounded-md bg-wm-accent text-wm-text-on-accent hover:bg-wm-accent-hover disabled:opacity-50"
            >
              <span className="flex items-center gap-1">
                {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                Save
              </span>
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onEditStart}
              disabled={saving}
              className="text-[11px] font-medium px-2.5 py-1 rounded-md text-wm-text-muted hover:bg-wm-bg-hover hover:text-wm-text disabled:opacity-50"
            >
              <span className="flex items-center gap-1"><Edit2 size={11} /> Edit</span>
            </button>
            {atom.status === 'draft' && (
              <>
                <button
                  type="button"
                  onClick={onReject}
                  disabled={saving}
                  className="text-[11px] font-medium px-2.5 py-1 rounded-md border border-wm-border text-wm-text-muted hover:bg-wm-danger-bg hover:text-wm-danger hover:border-wm-danger disabled:opacity-50"
                >
                  Reject
                </button>
                <button
                  type="button"
                  onClick={onApprove}
                  disabled={saving}
                  className="text-[11px] font-medium px-2.5 py-1 rounded-md bg-wm-accent text-wm-text-on-accent hover:bg-wm-accent-hover disabled:opacity-50"
                >
                  <span className="flex items-center gap-1">
                    {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                    Approve
                  </span>
                </button>
              </>
            )}
            {atom.status === 'approved' && (
              <button
                type="button"
                onClick={onReject}
                disabled={saving}
                className="text-[11px] font-medium px-2.5 py-1 rounded-md border border-wm-border text-wm-text-muted hover:bg-wm-danger-bg hover:text-wm-danger hover:border-wm-danger disabled:opacity-50"
              >
                Archive
              </button>
            )}
            {atom.status === 'archived' && (
              <button
                type="button"
                onClick={onRestore}
                disabled={saving}
                className="text-[11px] font-medium px-2.5 py-1 rounded-md border border-wm-border text-wm-text-muted hover:bg-wm-bg-hover disabled:opacity-50"
              >
                Restore to draft
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
