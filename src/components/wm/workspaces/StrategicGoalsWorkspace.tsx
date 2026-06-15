/**
 * Web Manager — Strategic Goals review workspace.
 *
 * Mirrors the Core Messages review surface but covers WHY + the
 * constraints around HOW: goals, vision, voice anchors, copy approach,
 * display preferences, inspirational sites. Strategist reviews +
 * approves each field before the cowork pipeline consumes it.
 *
 * Data flow:
 *   Source tables (discovery / content collection / AM handoff JSONB)
 *     → aggregator endpoint /api/web/cowork/aggregate-strategic-goals
 *     → roadmap_state.strategic_goals (the AI-facing snapshot)
 *     → this workspace (strategist reviews / edits / approves)
 *
 * Edits + status flips persist via Supabase update directly on
 * roadmap_state through the same atomic RPC the pipeline endpoints
 * use. A "Refresh from sources" button re-runs the aggregator
 * (preserves strategist edits unless force=true).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Edit2, Loader2, RefreshCw, Save, X } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { WMStatusPill } from '../StatusPill'
import {
  STRATEGIC_GOAL_CATEGORIES,
  STRATEGIC_GOAL_FIELDS,
  deriveNavChangeLevel,
  deriveVerbatimBand,
  type StrategicGoalCategory,
  type StrategicGoalField,
  type StrategicGoalFieldDef,
  type StrategicGoalStatus,
  type StrategicGoalsSnapshot,
} from '../../../lib/cowork/strategicGoals'
import type { StrategyWebProject } from '../../../types/database'

interface Props {
  project:   StrategyWebProject
  onChange?: () => void
}

type StatusFilter = 'all' | 'draft' | 'approved' | 'archived'

function pillToneFor(status: StrategicGoalStatus): 'neutral' | 'success' | 'warning' | 'danger' {
  if (status === 'approved') return 'success'
  if (status === 'archived') return 'danger'
  return 'warning'
}

export function StrategicGoalsWorkspace({ project, onChange }: Props) {
  const [snapshot, setSnapshot]               = useState<StrategicGoalsSnapshot | null>(null)
  const [loading, setLoading]                 = useState(true)
  const [error, setError]                     = useState<string | null>(null)
  const [refreshing, setRefreshing]           = useState(false)
  const [refreshError, setRefreshError]       = useState<string | null>(null)
  const [statusFilter, setStatusFilter]       = useState<StatusFilter>('draft')
  const [collapsed, setCollapsed]             = useState<Set<StrategicGoalCategory>>(new Set())
  const [editingKey, setEditingKey]           = useState<string | null>(null)
  const [savingKeys, setSavingKeys]           = useState<Set<string>>(new Set())

  // ─── Load snapshot ──────────────────────────────────────────────

  const load = async () => {
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('strategy_web_projects')
      .select('roadmap_state')
      .eq('id', project.id)
      .maybeSingle()
    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }
    const roadmap = ((data as any)?.roadmap_state ?? {}) as Record<string, any>
    const sg = roadmap.strategic_goals as StrategicGoalsSnapshot | undefined
    setSnapshot(sg ?? null)
    setLoading(false)
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [project.id])

  // ─── Refresh from sources ────────────────────────────────────────

  const refresh = async (force: boolean) => {
    setRefreshing(true)
    setRefreshError(null)
    try {
      const r = await fetch('/api/web/cowork/aggregate-strategic-goals', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ project_id: project.id, force }),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) {
        setRefreshError(body?.detail ?? body?.error ?? `aggregator failed (${r.status})`)
        return
      }
      setSnapshot(body.snapshot as StrategicGoalsSnapshot)
      onChange?.()
    } catch (e) {
      setRefreshError(e instanceof Error ? e.message : 'network error')
    } finally {
      setRefreshing(false)
    }
  }

  // ─── Mutate a single field ───────────────────────────────────────

  /** Persist a field change via roadmap_state_set RPC (atomic write at
   *  the leaf path). Optimistic local update — RPC failure shows in
   *  the error banner without unwinding the UI. */
  const mutateField = async (
    category: StrategicGoalCategory,
    key: string,
    patch: Partial<StrategicGoalField>,
  ): Promise<boolean> => {
    const fullKey = `${category}.${key}`
    setSavingKeys(prev => { const n = new Set(prev); n.add(fullKey); return n })

    const current = snapshot?.[category]?.[key]
    if (!current) {
      setError(`field ${fullKey} not in snapshot — refresh from sources first`)
      setSavingKeys(prev => { const n = new Set(prev); n.delete(fullKey); return n })
      return false
    }
    const updated: StrategicGoalField = { ...current, ...patch }
    // Recompute derived block when the source value changes.
    if (patch.value !== undefined) {
      if (key === 'current_navigation_satisfaction' && typeof updated.value === 'number') {
        const nav = deriveNavChangeLevel(updated.value)
        updated.derived = { ...(updated.derived ?? {}), nav_change_level: nav ?? undefined }
      }
      if (key === 'copy_approach' && typeof updated.value === 'string') {
        updated.derived = { ...(updated.derived ?? {}), intended_verbatim_band: deriveVerbatimBand(updated.value) }
      }
    }

    const { error: err } = await (supabase as any).rpc('roadmap_state_set', {
      p_project_id: project.id,
      p_path:       ['strategic_goals', category, key],
      p_value:      updated,
    })
    setSavingKeys(prev => { const n = new Set(prev); n.delete(fullKey); return n })
    if (err) {
      setError(`Update failed for ${fullKey}: ${err.message}`)
      return false
    }
    // Optimistic local update
    setSnapshot(prev => {
      if (!prev) return prev
      const next = { ...prev, [category]: { ...prev[category], [key]: updated } } as StrategicGoalsSnapshot
      return next
    })
    onChange?.()
    return true
  }

  const approve = (cat: StrategicGoalCategory, key: string) => mutateField(cat, key, { status: 'approved' })
  const reject  = (cat: StrategicGoalCategory, key: string) => mutateField(cat, key, { status: 'archived' })
  const restore = (cat: StrategicGoalCategory, key: string) => mutateField(cat, key, { status: 'draft' })

  /** Bulk-approve every draft field in a category. Sequential to keep
   *  optimistic UI honest about per-row failures. */
  const bulkApproveCategory = async (category: StrategicGoalCategory) => {
    if (!snapshot) return
    const block = snapshot[category]
    const drafts = Object.entries(block).filter(([, f]) => f.status === 'draft' && f.value != null)
    if (drafts.length === 0) return
    if (!confirm(`Approve ${drafts.length} draft field${drafts.length === 1 ? '' : 's'} in this category?`)) return
    for (const [key] of drafts) await approve(category, key)
  }

  /** Bulk-approve every draft field across ALL categories. Same
   *  sequential pattern as bulkApproveCategory. */
  const bulkApproveAll = async () => {
    if (!snapshot) return
    const all: Array<[StrategicGoalCategory, string]> = []
    for (const def of STRATEGIC_GOAL_FIELDS) {
      const f = snapshot[def.category]?.[def.key]
      if (f && f.status === 'draft' && f.value != null) all.push([def.category, def.key])
    }
    if (all.length === 0) return
    if (!confirm(`Approve all ${all.length} draft strategic goal${all.length === 1 ? '' : 's'}?`)) return
    for (const [cat, key] of all) await approve(cat, key)
  }

  // ─── Per-category counts ─────────────────────────────────────────

  const counts = useMemo(() => {
    const c = { total: 0, draft: 0, approved: 0, archived: 0, populated: 0 }
    if (!snapshot) return c
    for (const def of STRATEGIC_GOAL_FIELDS) {
      const field = snapshot[def.category]?.[def.key]
      if (!field) continue
      c.total++
      if (field.value != null && (typeof field.value !== 'string' || field.value.trim() !== '')) c.populated++
      c[field.status]++
    }
    return c
  }, [snapshot])

  // ─── Render ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="p-8 grid place-items-center text-wm-text-muted">
        <Loader2 className="animate-spin" />
      </div>
    )
  }

  const showRefreshPrompt = !snapshot

  return (
    <div className="p-4 max-w-[960px] mx-auto">
      <Header
        counts={counts}
        statusFilter={statusFilter}
        onFilter={setStatusFilter}
        onRefresh={() => void refresh(false)}
        refreshing={refreshing}
        lastSyncedAt={snapshot?._meta?.generated_at ?? null}
        onApproveAll={() => void bulkApproveAll()}
      />

      {error && (
        <div className="mb-3 rounded-md border border-wm-danger bg-wm-danger-bg px-3 py-2 text-[12px] text-wm-danger">
          {error}
        </div>
      )}
      {refreshError && (
        <div className="mb-3 rounded-md border border-wm-danger bg-wm-danger-bg px-3 py-2 text-[12px] text-wm-danger">
          Refresh failed: {refreshError}
        </div>
      )}

      {showRefreshPrompt && (
        <div className="rounded-xl border border-dashed border-wm-border bg-wm-bg p-6 text-center">
          <p className="text-[13px] text-wm-text-muted mb-3">
            No strategic goals snapshot yet. Pull from Discovery, Content Collection, and AM Handoff to populate.
          </p>
          <button
            type="button"
            onClick={() => void refresh(false)}
            disabled={refreshing}
            className="text-[13px] font-medium px-4 py-2 rounded-lg bg-wm-accent text-wm-text-on-accent hover:bg-wm-accent-hover disabled:opacity-50"
          >
            <span className="flex items-center gap-1.5">
              {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              Refresh from sources
            </span>
          </button>
        </div>
      )}

      {snapshot && (
        <div className="flex flex-col gap-4">
          {STRATEGIC_GOAL_CATEGORIES.map(catDef => {
            const fieldsInCategory = STRATEGIC_GOAL_FIELDS.filter(f => f.category === catDef.key)
            // Filter fields by status (default: show drafts only). Always
            // surface fields that have no value yet (so the strategist sees
            // gaps), unless the filter is explicitly approved/archived.
            const filteredFields = fieldsInCategory.filter(def => {
              const field = snapshot[catDef.key]?.[def.key]
              if (!field) return statusFilter === 'all' || statusFilter === 'draft'
              if (statusFilter === 'all') return true
              return field.status === statusFilter
            })
            if (filteredFields.length === 0) return null

            const draftCount = fieldsInCategory.filter(def => {
              const f = snapshot[catDef.key]?.[def.key]
              return f?.status === 'draft' && f?.value != null
            }).length
            const isCollapsed = collapsed.has(catDef.key)

            return (
              <section key={catDef.key} className="rounded-xl border border-wm-border bg-wm-bg-elevated">
                <button
                  type="button"
                  onClick={() => setCollapsed(prev => {
                    const n = new Set(prev)
                    if (n.has(catDef.key)) n.delete(catDef.key); else n.add(catDef.key)
                    return n
                  })}
                  className="w-full flex items-center justify-between gap-3 px-5 py-3 hover:bg-wm-bg-hover rounded-t-xl"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {isCollapsed ? <ChevronRight size={14} className="text-wm-text-subtle shrink-0" /> : <ChevronDown size={14} className="text-wm-text-subtle shrink-0" />}
                    <div className="min-w-0 text-left">
                      <p className="text-[13.5px] font-semibold text-wm-text">{catDef.label}</p>
                      <p className="text-[11px] text-wm-text-subtle mt-0.5">{catDef.description}</p>
                    </div>
                  </div>
                  {draftCount > 0 && statusFilter === 'draft' && (
                    <span
                      role="button"
                      onClick={(e) => { e.stopPropagation(); void bulkApproveCategory(catDef.key) }}
                      className="text-[11px] font-medium px-2.5 py-1 rounded-md bg-wm-accent text-wm-text-on-accent hover:bg-wm-accent-hover shrink-0"
                    >
                      Approve all {draftCount}
                    </span>
                  )}
                </button>
                {!isCollapsed && (
                  <div className="border-t border-wm-border divide-y divide-wm-border">
                    {filteredFields.map(def => (
                      <FieldCard
                        key={def.key}
                        def={def}
                        field={snapshot[catDef.key]?.[def.key] ?? null}
                        editing={editingKey === `${catDef.key}.${def.key}`}
                        saving={savingKeys.has(`${catDef.key}.${def.key}`)}
                        onEditStart={() => setEditingKey(`${catDef.key}.${def.key}`)}
                        onEditCancel={() => setEditingKey(null)}
                        onEditSave={async (newValue) => {
                          const ok = await mutateField(catDef.key, def.key, {
                            value:             newValue,
                            strategist_edited: true,
                          })
                          if (ok) setEditingKey(null)
                        }}
                        onApprove={() => approve(catDef.key, def.key)}
                        onReject={() => reject(catDef.key, def.key)}
                        onRestore={() => restore(catDef.key, def.key)}
                      />
                    ))}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────
// Header — counts, filter, refresh
// ────────────────────────────────────────────────────────────────────

function Header({ counts, statusFilter, onFilter, onRefresh, refreshing, lastSyncedAt, onApproveAll }: {
  counts:       { total: number; draft: number; approved: number; archived: number; populated: number }
  statusFilter: StatusFilter
  onFilter:     (f: StatusFilter) => void
  onRefresh:    () => void
  refreshing:   boolean
  lastSyncedAt: string | null
  onApproveAll: () => void
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-2 flex-wrap">
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Strategic goals</p>
        <h2 className="text-[15px] font-semibold text-wm-text">Strategist review queue</h2>
        <p className="text-[11px] text-wm-text-muted mt-0.5">
          {counts.populated}/{counts.total} populated · {counts.draft} draft · {counts.approved} approved · {counts.archived} archived
          {lastSyncedAt && (
            <span> · synced {new Date(lastSyncedAt).toLocaleString()}</span>
          )}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
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
        <button
          type="button"
          onClick={onApproveAll}
          disabled={counts.draft === 0}
          className="text-[11px] font-medium px-2.5 py-1.5 rounded-md bg-wm-accent text-wm-text-on-accent hover:bg-wm-accent-hover disabled:opacity-50"
        >
          <span className="flex items-center gap-1">
            <Check size={11} />
            Approve all {counts.draft > 0 ? `(${counts.draft})` : ''}
          </span>
        </button>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="text-[11px] font-medium px-2.5 py-1.5 rounded-md border border-wm-border text-wm-text-muted hover:bg-wm-bg-hover hover:text-wm-text disabled:opacity-50"
        >
          <span className="flex items-center gap-1">
            {refreshing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            Refresh from sources
          </span>
        </button>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────
// FieldCard
// ────────────────────────────────────────────────────────────────────

function FieldCard({ def, field, editing, saving, onEditStart, onEditCancel, onEditSave, onApprove, onReject, onRestore }: {
  def:          StrategicGoalFieldDef
  field:        StrategicGoalField | null
  editing:      boolean
  saving:       boolean
  onEditStart:  () => void
  onEditCancel: () => void
  onEditSave:   (newValue: string | number | null) => Promise<void>
  onApprove:    () => void
  onReject:     () => void
  onRestore:    () => void
}) {
  // Sync local edit state when the field changes underneath (refetch
  // after refresh / RPC mutation). Only when NOT actively editing.
  const initialDraft = field?.value == null ? '' : String(field.value)
  const [draft, setDraft] = useState<string>(initialDraft)
  useEffect(() => {
    if (!editing) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraft(initialDraft)
    }
  }, [initialDraft, editing])

  const hasValue = field && field.value != null && (typeof field.value !== 'string' || field.value.trim() !== '')
  const status: StrategicGoalStatus = field?.status ?? 'draft'

  return (
    <div className="px-5 py-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap mb-1">
            <span className="text-[13px] font-semibold text-wm-text">{def.label}</span>
            <span className="text-[10.5px] text-wm-text-subtle font-mono">{def.key}</span>
            {def.importance === 'high' && (
              <span className="text-[10px] uppercase tracking-wider font-medium text-wm-accent-strong">required</span>
            )}
          </div>
          <p className="text-[11px] text-wm-text-subtle mb-2 leading-snug">{def.description}</p>
          {editing ? (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-full rounded-md border border-wm-border bg-wm-bg-elevated px-2.5 py-1.5 text-[12.5px] text-wm-text leading-snug focus:outline-none focus:border-wm-border-focus min-h-[80px]"
              rows={Math.min(10, Math.max(2, Math.ceil(draft.length / 80) + 1))}
            />
          ) : hasValue ? (
            <p className="text-[12.5px] text-wm-text leading-snug whitespace-pre-wrap break-words">
              {typeof field!.value === 'number' ? String(field!.value) : (field!.value as string)}
            </p>
          ) : (
            <p className="text-[12px] text-wm-text-subtle italic">Not captured at the source yet.</p>
          )}
          {/* Provenance + derived rendering */}
          {field && (
            <p className="mt-2 text-[10.5px] text-wm-text-subtle flex items-center gap-1.5 flex-wrap">
              <span>{def.source.replace('_', ' ')}</span>
              {field.source_ref && <span>· {field.source_ref}</span>}
              {field.strategist_edited && <span>· strategist-edited</span>}
              {field.derived?.nav_change_level && (
                <span>· nav rule: <span className="font-mono">{field.derived.nav_change_level}</span></span>
              )}
              {field.derived?.intended_verbatim_band && (
                <span>· verbatim band: <span className="font-mono">{field.derived.intended_verbatim_band}</span></span>
              )}
            </p>
          )}
        </div>
        <div className="shrink-0">
          {hasValue || field ? <WMStatusPill tone={pillToneFor(status)} size="sm">{status}</WMStatusPill> : null}
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
              onClick={() => {
                // Coerce nav_satisfaction back to a number if the field is numeric.
                const out: string | number | null =
                  def.key === 'current_navigation_satisfaction'
                    ? (draft.trim() === '' ? null : Number(draft.trim()))
                    : (draft.trim() === '' ? null : draft)
                void onEditSave(out)
              }}
              disabled={saving}
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
            {status === 'draft' && hasValue && (
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
            {status === 'approved' && (
              <button
                type="button"
                onClick={onReject}
                disabled={saving}
                className="text-[11px] font-medium px-2.5 py-1 rounded-md border border-wm-border text-wm-text-muted hover:bg-wm-danger-bg hover:text-wm-danger hover:border-wm-danger disabled:opacity-50"
              >
                Archive
              </button>
            )}
            {status === 'archived' && (
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

