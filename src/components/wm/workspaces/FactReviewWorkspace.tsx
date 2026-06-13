/**
 * Web Manager — Fact Review workspace.
 *
 * Sibling to AtomReviewWorkspace. Closes the parallel hygiene gap:
 * parse-facts-csv writes facts at status='draft'; without a review
 * surface, every cowork pipeline run silently trusts unreviewed
 * partner facts.
 *
 * Differs from AtomReviewWorkspace in what it renders + edits:
 *   - Facts have structured `data` (jsonb), not text body. The card
 *     renders + edits JSON; the strategist edits a textarea + the
 *     save path JSON.parses to validate.
 *   - No verbatim flag (facts aren't lifted prose).
 *   - No confidence column (church_facts schema doesn't carry one).
 *   - Topic vocabulary is structural (service_time / campus / staff /
 *     ministry / program / belief / contact_method / etc.) rather than
 *     voice-prioritized like atoms. Sort order: contact / location /
 *     time facts first (the highest-stakes for partner accuracy),
 *     then staff / leadership, then everything else alphabetical.
 *
 * Out of scope (deliberate):
 *   - Per-topic shape validation (e.g. service_time must have day +
 *     time fields). Tracked as iteration-2 work; the SKILL teaches
 *     per-topic shape today.
 *   - Cross-fact dedup / merge (no schema for it).
 *   - Audit trail (no approver columns on church_facts).
 */

import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Edit2, Loader2, Save, X } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { WMStatusPill } from '../StatusPill'
import type { StrategyWebProject } from '../../../types/database'

interface Fact {
  id:           string
  topic:        string
  data:         Record<string, unknown> | null
  source_kind:  string | null
  source_ref:   string | null
  status:       'draft' | 'approved' | 'archived'
  created_at:   string
  updated_at:   string
}

interface Props {
  project:  StrategyWebProject
  onChange?: () => void
}

type StatusFilter = 'all' | 'draft' | 'approved' | 'archived'

function pillToneFor(status: Fact['status']): 'neutral' | 'success' | 'warning' | 'danger' {
  if (status === 'approved') return 'success'
  if (status === 'archived') return 'danger'
  return 'warning'
}

/** Topic display order: partner-accuracy-critical first (contact info,
 *  service times, locations — these go on the live site and a wrong
 *  one is a real-world friction), then people (staff / leadership),
 *  then everything else alphabetical. */
function topicSortKey(topic: string): string {
  const CRITICAL  = ['contact_method', 'location_detail', 'campus', 'service_time']
  const PEOPLE    = ['staff', 'leadership']
  const PROGRAMS  = ['ministry', 'program', 'audience']
  if (CRITICAL.includes(topic))  return `0_${topic}`
  if (PEOPLE.includes(topic))    return `1_${topic}`
  if (PROGRAMS.includes(topic))  return `2_${topic}`
  return `3_${topic}`
}

export function FactReviewWorkspace({ project, onChange }: Props) {
  const [facts, setFacts]                     = useState<Fact[]>([])
  const [loading, setLoading]                 = useState(true)
  const [error, setError]                     = useState<string | null>(null)
  const [statusFilter, setStatusFilter]       = useState<StatusFilter>('draft')
  const [collapsedTopics, setCollapsedTopics] = useState<Set<string>>(new Set())
  const [editingId, setEditingId]             = useState<string | null>(null)
  const [savingIds, setSavingIds]             = useState<Set<string>>(new Set())

  const load = async () => {
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('church_facts')
      .select('id, topic, data, source_kind, source_ref, status, created_at, updated_at')
      .eq('web_project_id', project.id)
      .order('topic', { ascending: true })
      .order('created_at', { ascending: true })
    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }
    setFacts((data ?? []) as Fact[])
    setLoading(false)
  }

  // Initial load + reload on project change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [project.id])

  const counts = useMemo(() => {
    const c = { total: 0, draft: 0, approved: 0, archived: 0 }
    for (const f of facts) {
      c.total++
      c[f.status]++
    }
    return c
  }, [facts])

  const grouped = useMemo(() => {
    const filtered = statusFilter === 'all'
      ? facts
      : facts.filter(f => f.status === statusFilter)
    const groups = new Map<string, Fact[]>()
    for (const f of filtered) {
      const arr = groups.get(f.topic) ?? []
      arr.push(f)
      groups.set(f.topic, arr)
    }
    return Array.from(groups.entries()).sort(([a], [b]) =>
      topicSortKey(a).localeCompare(topicSortKey(b)))
  }, [facts, statusFilter])

  // Persist a mutation; cast to bypass stale Supabase generated-types
  // (project-wide pattern; see AtomReviewWorkspace for context).
  const mutateFact = async (id: string, patch: Partial<Fact>) => {
    setSavingIds(prev => { const n = new Set(prev); n.add(id); return n })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any)
      .from('church_facts')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('web_project_id', project.id)
    setSavingIds(prev => { const n = new Set(prev); n.delete(id); return n })
    if (err) {
      setError(`Update failed: ${err.message}`)
      return false
    }
    setFacts(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f))
    onChange?.()
    return true
  }

  const approve = (id: string) => mutateFact(id, { status: 'approved' })
  const reject  = (id: string) => mutateFact(id, { status: 'archived' })
  const restore = (id: string) => mutateFact(id, { status: 'draft' })

  const bulkApproveTopic = async (topic: string) => {
    const draftsInTopic = facts.filter(f => f.topic === topic && f.status === 'draft')
    if (draftsInTopic.length === 0) return
    if (!confirm(`Approve ${draftsInTopic.length} draft fact${draftsInTopic.length === 1 ? '' : 's'} in "${topic}"?`)) return
    for (const f of draftsInTopic) await approve(f.id)
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
      <Header counts={counts} statusFilter={statusFilter} onFilter={setStatusFilter} />

      {error && (
        <div className="mb-3 rounded-md border border-wm-danger bg-wm-danger-bg px-3 py-2 text-[12px] text-wm-danger">
          {error}
        </div>
      )}

      {grouped.length === 0 && (
        <div className="rounded-md border border-dashed border-wm-border bg-wm-bg p-5 text-center">
          <p className="text-[12px] text-wm-text-muted">
            {statusFilter === 'draft' ? 'No drafts to review — all facts are approved or archived.' : `No facts with status=${statusFilter}.`}
          </p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {grouped.map(([topic, topicFacts]) => {
          const collapsed = collapsedTopics.has(topic)
          const draftsInGroup = topicFacts.filter(f => f.status === 'draft').length
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
                    {topicFacts.length} {topicFacts.length === 1 ? 'fact' : 'facts'}
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
                  {topicFacts.map(f => (
                    <FactCard
                      key={f.id}
                      fact={f}
                      editing={editingId === f.id}
                      saving={savingIds.has(f.id)}
                      onEditStart={() => setEditingId(f.id)}
                      onEditCancel={() => setEditingId(null)}
                      onEditSave={async (data) => {
                        const ok = await mutateFact(f.id, { data })
                        if (ok) setEditingId(null)
                      }}
                      onApprove={() => approve(f.id)}
                      onReject={() => reject(f.id)}
                      onRestore={() => restore(f.id)}
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

function Header({ counts, statusFilter, onFilter }: {
  counts:       { total: number; draft: number; approved: number; archived: number }
  statusFilter: StatusFilter
  onFilter:     (f: StatusFilter) => void
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-2 flex-wrap">
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Facts</p>
        <h2 className="text-[15px] font-semibold text-wm-text">Strategist review queue</h2>
        <p className="text-[11px] text-wm-text-muted mt-0.5">
          {counts.total} total · {counts.draft} draft · {counts.approved} approved · {counts.archived} archived
        </p>
      </div>
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
  )
}

function FactCard({ fact, editing, saving, onEditStart, onEditCancel, onEditSave, onApprove, onReject, onRestore }: {
  fact:         Fact
  editing:      boolean
  saving:       boolean
  onEditStart:  () => void
  onEditCancel: () => void
  onEditSave:   (data: Record<string, unknown>) => Promise<void>
  onApprove:    () => void
  onReject:     () => void
  onRestore:    () => void
}) {
  const initialJson = JSON.stringify(fact.data ?? {}, null, 2)
  const [draftJson, setDraftJson]   = useState(initialJson)
  const [parseError, setParseError] = useState<string | null>(null)

  // Re-sync draft when fact changes underneath (parent refetch after
  // mutation). Only when not actively editing. Same pattern as
  // AtomReviewWorkspace.
  useEffect(() => {
    if (!editing) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraftJson(JSON.stringify(fact.data ?? {}, null, 2))
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setParseError(null)
    }
  }, [fact.data, editing])

  const handleSave = async () => {
    try {
      const parsed = JSON.parse(draftJson)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        setParseError('Fact data must be a JSON object (not array or primitive).')
        return
      }
      setParseError(null)
      await onEditSave(parsed as Record<string, unknown>)
    } catch (e) {
      setParseError(`Invalid JSON: ${e instanceof Error ? e.message : 'parse error'}`)
    }
  }

  return (
    <div className="px-3 py-3 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {editing ? (
            <>
              <textarea
                value={draftJson}
                onChange={(e) => setDraftJson(e.target.value)}
                className="w-full rounded-md border border-wm-border bg-wm-bg-elevated px-2.5 py-1.5 text-[11px] font-mono text-wm-text leading-snug focus:outline-none focus:border-wm-border-focus min-h-[100px]"
                rows={Math.min(14, Math.max(4, draftJson.split('\n').length))}
                spellCheck={false}
              />
              {parseError && (
                <p className="mt-1 text-[10px] text-wm-danger">{parseError}</p>
              )}
            </>
          ) : (
            <pre className="text-[11px] font-mono text-wm-text leading-snug whitespace-pre-wrap break-words bg-wm-bg rounded-md border border-wm-border px-2.5 py-1.5 max-h-48 overflow-auto">
              {JSON.stringify(fact.data ?? {}, null, 2)}
            </pre>
          )}
          <p className="mt-1.5 text-[10px] text-wm-text-subtle flex items-center gap-1.5 flex-wrap">
            <span>{fact.source_kind ?? 'unknown source'}</span>
            {fact.source_ref && <span>· {fact.source_ref}</span>}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <WMStatusPill tone={pillToneFor(fact.status)} size="sm">{fact.status}</WMStatusPill>
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
              onClick={handleSave}
              disabled={saving || !!parseError || draftJson.trim().length === 0}
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
            {fact.status === 'draft' && (
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
            {fact.status === 'approved' && (
              <button
                type="button"
                onClick={onReject}
                disabled={saving}
                className="text-[11px] font-medium px-2.5 py-1 rounded-md border border-wm-border text-wm-text-muted hover:bg-wm-danger-bg hover:text-wm-danger hover:border-wm-danger disabled:opacity-50"
              >
                Archive
              </button>
            )}
            {fact.status === 'archived' && (
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
