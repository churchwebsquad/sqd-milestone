/**
 * Website Manager — Screen 1: Projects grid.
 *
 * Lists every active website project across the squad, with a card
 * per project showing the partner, the project name, the engagement
 * type, and the current phase. Click a card → drill into Screen 2
 * (per-project hub at /web/:projectId).
 *
 * Phase 1 of the Web Manager build only displays projects + supports
 * "Add Web Project". Status pills per tool (Intake / Content / etc.)
 * land on Screen 2 in Phase 1; aggregating them onto these cards is
 * a Phase 2 polish.
 */

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronDown, ChevronRight, Library, MessageCircle, Plus, Search, Settings, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { SettingsWorkspace } from '../../components/wm/workspaces/SettingsWorkspace'
import { WMSegmentedToggle } from '../../components/wm/SegmentedToggle'
import { ListView } from '../../components/wm/manager/ListView'
import { WeekHourGrid } from '../../components/wm/manager/WeekHourGrid'
import { NeedsAttentionStrip } from '../../components/wm/manager/NeedsAttentionStrip'
import { NewProspectSimulator } from '../../components/wm/manager/NewProspectSimulator'
import { DevCapacityBanner } from '../../components/wm/manager/DevCapacityBanner'
import { useProjectsWithHealth } from '../../hooks/useProjectsWithHealth'
import type { ProjectRowVM } from '../../hooks/useProjectsWithHealth'

// Two surfaces: a per-project List for priority + launch date shuffling,
// and a Week-Hour Grid for visualizing the cap. Everything else
// (Board/Phases/Schedule/Waterfall/Calendar/Forecast) is folded into
// these two — phase boards added cognitive load without driving the
// "where do my dev hours go this week" question.
type ManagerView = 'list' | 'grid'

export default function WebProjectsPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const view: ManagerView = ((): ManagerView => {
    const v = params.get('view')
    return v === 'grid' ? 'grid' : 'list'
  })()
  const showArchived = params.get('archived') === '1'
  const query       = params.get('q') ?? ''

  const [createOpen, setCreateOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const { rows, loading, error, refetch } = useProjectsWithHealth({ includeArchived: showArchived })

  // Filter / search before passing to the view. Phase + health filters
  // were dropped — the List view already shows phase + health pills
  // and the WeekHourGrid renders every active project. Search covers
  // ad-hoc lookups.
  const visible = useMemo<ProjectRowVM[]>(() => {
    const q = query.trim().toLowerCase()
    return rows.filter(r => {
      if (!showArchived && r.archived) return false
      if (showArchived && !r.archived) return false
      if (!q) return true
      const hay = [r.church_name, r.name, String(r.member)].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [rows, query, showArchived])

  const archivedCount = rows.filter(r => r.archived).length

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (value === null || value === '') next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }

  return (
    <div className="min-h-full py-6 px-4 md:px-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-xs font-bold text-primary-purple uppercase tracking-widest mb-1">Web</p>
            <h1 className="text-2xl font-semibold text-deep-plum">Website Manager</h1>
            <p className="text-sm text-purple-gray mt-1 max-w-xl">
              Every active website project across the squad. Each project rolls up Intake, Content,
              Design, Dev, and Reviews against a shared brief, brand, and section library.
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

        {/* Org-wide Site Manager settings — applies to every project,
            every church. Collapsed by default; toggle from the header. */}
        {settingsOpen && (
          <div className="mb-6 rounded-2xl border border-lavender bg-white/60 p-5">
            <div className="mb-3">
              <p className="text-xs font-bold text-primary-purple uppercase tracking-widest mb-0.5">Org-wide</p>
              <h2 className="text-base font-semibold text-deep-plum">Settings</h2>
              <p className="text-xs text-purple-gray mt-0.5">
                Changes here apply to every project, every church.
              </p>
            </div>
            <SettingsWorkspace />
          </div>
        )}

        {/* Dev capacity outlook — answers "is dev overbooked?" at a glance.
            The WeekHourGrid below shows the per-project breakdown; this
            banner is the headline summary. */}
        <DevCapacityBanner rows={rows} />

        {/* Needs-attention digest — what should I look at right now?
            Composes consolidator + feasibility + stall + capacity. */}
        <div className="mt-3 mb-4">
          <NeedsAttentionStrip
            rows={rows}
            onOpenProject={(id) => navigate(`/web/${id}?tab=planning`)}
            onOpenSprint={(startISO) => navigate(`/web?view=waterfall&sprint=${startISO}`)}
          />
        </div>

        {/* New-prospect simulator — answers "when can this church
            launch?" without creating a project. Sandboxed; nothing
            is written. Collapsed by default. */}
        <div className="mb-4">
          <NewProspectSimulator rows={rows} />
        </div>

        {/* Toolbar: view toggle + search + archived.
            Two surfaces only — List (per-project priority + launch) and
            Week-Hour Grid (per-week capacity). The old 7-view toggle
            (Board/Phases/Schedule/Waterfall/Calendar/Forecast) added
            cognitive load without driving the dev-hour question. */}
        <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
          <WMSegmentedToggle<ManagerView>
            active={view}
            onChange={(v) => setParam('view', v === 'list' ? null : v)}
            options={[
              { key: 'list', label: 'List' },
              { key: 'grid', label: 'Week-Hour Grid' },
            ]}
          />

          <div className="relative flex-1 min-w-[280px] max-w-md">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-purple-gray/60" />
            <input
              type="text"
              value={query}
              onChange={e => setParam('q', e.target.value || null)}
              placeholder="Search by church, project, or member…"
              className="w-full rounded-full border border-lavender bg-white pl-9 pr-10 py-2 text-sm text-deep-plum placeholder-purple-gray/60 outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20"
            />
            {query && (
              <button
                type="button"
                onClick={() => setParam('q', null)}
                aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-purple-gray hover:text-deep-plum"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {archivedCount > 0 && (
            <label className="inline-flex items-center gap-1.5 text-xs text-purple-gray cursor-pointer select-none shrink-0">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={e => setParam('archived', e.target.checked ? '1' : null)}
                className="accent-deep-plum"
              />
              Archived ({archivedCount})
            </label>
          )}
        </div>

        <p className="text-xs text-purple-gray mb-3">
          {visible.length} {visible.length === 1 ? 'project' : 'projects'}
        </p>

        {error && !loading && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 mb-3">
            Couldn't load projects: {error}
          </div>
        )}

        {view === 'list' && (
          <ListView
            rows={visible}
            loading={loading}
            onSelect={(id) => navigate(`/web/${id}?tab=planning`)}
            query={query}
            onPriorityChange={async (movedId, targetOrder) => {
              // Drag-and-drop is always live in /web List. Drop the
              // moved project at targetOrder, shift others. No "bulk
              // reorder" toggle — priority is editable any time.
              const ordered = [...visible].sort(
                (a, b) => (a.priority_order ?? 999) - (b.priority_order ?? 999),
              )
              const sansMoved = ordered.filter(r => r.id !== movedId)
              const movedIdx = Math.max(0, Math.min(sansMoved.length, targetOrder - 1))
              sansMoved.splice(movedIdx, 0, ordered.find(r => r.id === movedId)!)
              const updates = sansMoved.map((r, i) =>
                supabase.from('strategy_web_projects')
                  .update({ priority_order: i + 1, updated_at: new Date().toISOString() })
                  .eq('id', r.id),
              )
              await Promise.all(updates)
              await refetch()
            }}
            onLaunchDateChange={async (projectId, iso) => {
              await supabase.from('strategy_web_projects')
                .update({ launch_date: iso, updated_at: new Date().toISOString() })
                .eq('id', projectId)
              await refetch()
            }}
          />
        )}

        {view === 'grid' && (
          <WeekHourGrid rows={visible} capacityPerWeek={35} />
        )}

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
