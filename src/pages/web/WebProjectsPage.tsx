/**
 * Website Launch Planner — /web.
 *
 * Single-surface admin panel for scheduling the development bottleneck
 * across back-to-back two-week sprints. Ported wholesale from the
 * prototypes/launch-planner/launch-planner-prototype.html mental model:
 *
 *   - StatCards          headline (active · queued hrs · help scheduled · behind)
 *   - NewProspectSimulator   "when could this church launch?" sandbox
 *   - QueueTable             drag-reorder priority + inline editors + pace
 *   - SprintTimeline         2-week capacity cards + per-week help/out/blackout
 *   - HelpCallout            recovery summary (recoverable vs not)
 *
 * The per-project Planning tab at /web/:id?tab=planning stays — it
 * becomes a thin slice showing this project's queue row + current
 * activity signals (see PlanningWorkspace).
 */

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronRight, Library, MessageCircle, Plus, Search, Settings, X, XCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { SettingsWorkspace } from '../../components/wm/workspaces/SettingsWorkspace'
import { StatCards } from '../../components/launch/StatCards'
import { QueueTable } from '../../components/launch/QueueTable'
import { SprintTimeline } from '../../components/launch/SprintTimeline'
import { HelpCallout } from '../../components/launch/HelpCallout'
import { NewProspectSimulator } from '../../components/launch/NewProspectSimulator'
import { useLaunchPlan } from '../../hooks/useLaunchPlan'

export default function WebProjectsPage() {
  const navigate = useNavigate()
  const [createOpen, setCreateOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Free-text filter applied to the build-queue rows only. Kept scoped
  // to the queue itself so header stats + sprint timeline still reflect
  // the whole plan; searching is about narrowing what you're looking at,
  // not redefining "active work".
  const [queueSearch, setQueueSearch] = useState('')

  const plan = useLaunchPlan()
  const launchedCount = plan.rows.filter(r => r.current_phase === 'launched' && !r.archived).length

  // Narrow the queue rows by church name (case-insensitive substring) or
  // member number (substring match on the stringified number so `19` finds
  // `1963`, `1908`, etc.). Empty query is a passthrough. Memoized on the
  // rows list so QueueTable's drag-reorder stays stable while typing.
  const filteredQueueRows = useMemo(() => {
    const q = queueSearch.trim().toLowerCase()
    if (!q) return plan.rows
    return plan.rows.filter(r =>
      (r.church_name ?? '').toLowerCase().includes(q) ||
      String(r.member ?? '').includes(q),
    )
  }, [plan.rows, queueSearch])

  return (
    <div className="min-h-full py-6 px-4 md:px-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-xs font-bold text-primary-purple uppercase tracking-widest mb-1">Web</p>
            <h1 className="text-2xl font-semibold text-deep-plum">Website Launch Planner</h1>
            <p className="text-sm text-purple-gray mt-1 max-w-xl">
              Schedules the development bottleneck across back-to-back 2-week sprints.
              One developer, hard <strong className="text-deep-plum">35 hrs/wk</strong>.
              Extra help hours from a second person (typically the designer) recover
              behind-target dates — when the work is offloadable and the designer is available.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <button
              type="button"
              onClick={() => setSettingsOpen(o => !o)}
              className={`inline-flex items-center gap-1.5 rounded-full border text-xs font-semibold px-3 py-1.5 transition-colors ${
                settingsOpen
                  ? 'border-primary-purple bg-primary-purple/10 text-primary-purple'
                  : 'border-lavender bg-white text-deep-plum hover:border-primary-purple hover:text-primary-purple'
              }`}
              title="Org-wide site manager settings — applies to every project, every church."
            >
              <Settings size={12} />
              Settings
              {settingsOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            </button>
            <Link
              to="/web/am-questions"
              className="inline-flex items-center gap-1.5 rounded-full border border-lavender bg-white text-xs font-semibold text-deep-plum px-3 py-1.5 hover:border-primary-purple hover:text-primary-purple transition-colors"
              title="Paste an AM message about launch timelines — get an evidence-backed draft response per church mentioned."
            >
              <MessageCircle size={12} />
              AM questions
            </Link>
            <Link
              to="/web/templates"
              className="inline-flex items-center gap-1.5 rounded-full border border-lavender bg-white text-xs font-semibold text-deep-plum px-3 py-1.5 hover:border-primary-purple hover:text-primary-purple transition-colors"
              title="Browse the Brixies catalog that drives every project's section editor"
            >
              <Library size={12} />
              Brixies catalog
            </Link>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-deep-plum text-white text-sm font-semibold px-4 py-2 hover:bg-primary-purple transition-colors"
            >
              <Plus size={13} />
              New Web Project
            </button>
          </div>
        </div>

        {settingsOpen && (
          <div className="mb-6 rounded-2xl border border-lavender bg-white/60 p-5">
            <div className="mb-3">
              <p className="text-xs font-bold text-primary-purple uppercase tracking-widest mb-0.5">Org-wide</p>
              <h2 className="text-base font-semibold text-deep-plum">Settings</h2>
              <p className="text-xs text-purple-gray mt-0.5">Changes here apply to every project, every church.</p>
            </div>
            <SettingsWorkspace />
          </div>
        )}

        {plan.error && !plan.loading && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 mb-3">
            Couldn't load launch plan: {plan.error}
          </div>
        )}

        <StatCards
          sites={plan.sites}
          schedule={plan.schedule}
          adjustments={plan.adjustments}
          recovery={plan.recovery}
          cfg={plan.cfg}
          launchedCount={launchedCount}
        />

        <div className="mb-4">
          <NewProspectSimulator
            sites={plan.sites}
            rows={plan.rows}
            adjustments={plan.adjustments}
            cfg={plan.cfg}
          />
        </div>

        <div className="mb-2 flex items-center justify-between gap-2 flex-wrap">
          <div className="relative w-full sm:max-w-sm">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-purple-gray/60 pointer-events-none" />
            <input
              type="text"
              value={queueSearch}
              onChange={e => setQueueSearch(e.target.value)}
              placeholder="Search queue by church name or member #"
              className="w-full pl-9 pr-9 py-2 text-sm rounded-full border border-lavender bg-white text-deep-plum placeholder:text-purple-gray/70 focus:outline-none focus:border-primary-purple focus:ring-1 focus:ring-primary-purple"
              aria-label="Search build queue"
            />
            {queueSearch && (
              <button
                type="button"
                onClick={() => setQueueSearch('')}
                title="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-purple-gray/70 hover:text-deep-plum"
                aria-label="Clear search"
              >
                <XCircle size={14} />
              </button>
            )}
          </div>
          {queueSearch && (
            <p className="text-[11px] text-purple-gray shrink-0">
              {filteredQueueRows.length} match{filteredQueueRows.length === 1 ? '' : 'es'} of {plan.rows.length}
            </p>
          )}
        </div>
        <QueueTable
          rows={filteredQueueRows}
          sites={plan.sites}
          schedule={plan.schedule}
          recovery={plan.recovery}
          cfg={plan.cfg}
          onReorder={plan.reorderPriority}
          onPatch={async (id, patch) => plan.setProjectField(id, patch)}
          onSelect={(id) => navigate(`/web/${id}?tab=planning`)}
        />

        <SprintTimeline
          rows={plan.rows}
          sites={plan.sites}
          schedule={plan.schedule}
          adjustments={plan.adjustments}
          cfg={plan.cfg}
          onAdjust={plan.upsertWeekAdjustment}
        />

        <HelpCallout rows={plan.rows} recovery={plan.recovery} />

      </div>

      {createOpen && (
        <CreateProjectModal
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => {
            setCreateOpen(false)
            navigate(`/web/${id}`)
          }}
        />
      )}
    </div>
  )
}

// ── Create modal ──────────────────────────────────────────────────────────

interface ChurchOption {
  member: number
  church_name: string | null
}

function CreateProjectModal({
  onClose, onCreated,
}: {
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const [churches, setChurches] = useState<ChurchOption[]>([])
  const [member, setMember] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'redesign' | 'audit' | 'new_build'>('redesign')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    let cancelled = false
    supabase
      .from('strategy_account_progress')
      .select('member, church_name')
      .order('church_name')
      .then(({ data }) => {
        if (cancelled) return
        setChurches((data ?? []) as ChurchOption[])
      })
    return () => { cancelled = true }
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return churches.slice(0, 50)
    return churches
      .filter(c => (c.church_name ?? '').toLowerCase().includes(q) || String(c.member).includes(q))
      .slice(0, 50)
  }, [churches, search])

  const submit = async () => {
    if (!member) { setError('Pick a church'); return }
    if (!name.trim()) { setError('Name the project'); return }
    setSubmitting(true)
    setError(null)
    try {
      const { data, error: insErr } = await supabase
        .from('strategy_web_projects')
        .insert({
          member,
          name: name.trim(),
          kind,
          current_phase: 'intake',
        })
        .select('id')
        .single()
      if (insErr) throw insErr
      const id = (data as { id: string } | null)?.id
      if (!id) throw new Error('Insert returned no id')
      onCreated(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create')
    } finally {
      setSubmitting(false)
    }
  }

  const churchPicked = churches.find(c => c.member === member)

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-deep-plum/40 px-4 py-6"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-lavender overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-lavender bg-lavender-tint/30 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-primary-purple mb-0.5">
              Web
            </p>
            <h2 className="text-base font-semibold text-deep-plum">New Web Project</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-purple-gray hover:text-deep-plum"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Church picker */}
          <div>
            <label className="text-xs font-semibold text-deep-plum mb-1 block">Church</label>
            {churchPicked ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-lavender bg-lavender-tint/40 px-3 py-2">
                <span className="text-sm text-deep-plum">
                  <strong>{churchPicked.church_name ?? `Member #${churchPicked.member}`}</strong>
                  <span className="text-purple-gray text-xs ml-2">#{churchPicked.member}</span>
                </span>
                <button
                  type="button"
                  onClick={() => { setMember(null); setSearch('') }}
                  className="text-xs text-primary-purple hover:underline"
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-purple-gray/60" />
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search by church name or member number…"
                    autoFocus
                    className="w-full rounded-lg border border-lavender pl-8 pr-3 py-2 text-sm text-deep-plum outline-none focus:border-primary-purple"
                  />
                </div>
                <div className="mt-2 max-h-44 overflow-auto rounded-lg border border-lavender">
                  {filtered.length === 0 ? (
                    <p className="text-xs text-purple-gray italic px-3 py-2">
                      No matches.
                    </p>
                  ) : filtered.map(c => (
                    <button
                      key={c.member}
                      type="button"
                      onClick={() => setMember(c.member)}
                      className="w-full text-left px-3 py-1.5 text-sm text-deep-plum hover:bg-lavender-tint border-b border-lavender/40 last:border-b-0"
                    >
                      {c.church_name ?? `(unnamed)`}{' '}
                      <span className="text-[11px] text-purple-gray ml-1">#{c.member}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Name */}
          <div>
            <label className="text-xs font-semibold text-deep-plum mb-1 block">Project name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. 2026 Redesign"
              className="w-full rounded-lg border border-lavender px-3 py-2 text-sm text-deep-plum outline-none focus:border-primary-purple"
            />
          </div>

          {/* Kind */}
          <div>
            <label className="text-xs font-semibold text-deep-plum mb-1 block">Engagement type</label>
            <div className="flex flex-wrap gap-1.5">
              {(['redesign', 'audit', 'new_build'] as const).map(k => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={[
                    'rounded-full text-xs font-semibold px-3 py-1 border transition-colors',
                    kind === k
                      ? 'bg-deep-plum text-white border-deep-plum'
                      : 'bg-white text-deep-plum border-lavender hover:border-primary-purple',
                  ].join(' ')}
                >
                  {kindLabel(k)}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <div className="px-5 pb-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-full border border-lavender bg-white text-xs font-semibold text-deep-plum px-4 py-2 hover:border-primary-purple disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !member || !name.trim()}
            className="rounded-full bg-deep-plum text-white text-xs font-bold px-4 py-2 hover:bg-primary-purple disabled:opacity-60"
          >
            {submitting ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </div>
    </div>
  )
}

function kindLabel(k: 'redesign' | 'audit' | 'new_build'): string {
  return k === 'redesign' ? 'Redesign'
    : k === 'audit' ? 'Audit'
    : 'New build'
}
