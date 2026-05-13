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
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Library, Plus, Search, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { StrategyWebProject } from '../../types/database'

interface ProjectRow extends StrategyWebProject {
  church_name: string | null
}

export default function WebProjectsPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<ProjectRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      // Two queries — projects, then a name lookup against
      // strategy_account_progress for the partners those projects
      // belong to. Joining client-side keeps the read simple and
      // sidesteps any RLS-edge-cases on a Postgres FK join.
      const { data: projects, error: projErr } = await supabase
        .from('strategy_web_projects')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)
      if (projErr) throw projErr

      const memberIds = [...new Set(((projects ?? []) as StrategyWebProject[]).map(p => p.member))]
      const churchByMember = new Map<number, string | null>()
      if (memberIds.length > 0) {
        const { data: churches } = await supabase
          .from('strategy_account_progress')
          .select('member, church_name')
          .in('member', memberIds)
        for (const c of (churches ?? []) as { member: number; church_name: string | null }[]) {
          churchByMember.set(c.member, c.church_name)
        }
      }

      setRows(((projects ?? []) as StrategyWebProject[]).map(p => ({
        ...p,
        church_name: churchByMember.get(p.member) ?? null,
      })))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const visible = useMemo(() => {
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

        {/* Search */}
        <div className="relative mb-4">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-purple-gray/60" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by church, project name, or member number…"
            className="w-full rounded-full border border-lavender bg-white pl-9 pr-10 py-2.5 text-sm text-deep-plum placeholder-purple-gray/60 outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-purple-gray hover:text-deep-plum"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Toolbar */}
        <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-purple-gray">
            {visible.length} {visible.length === 1 ? 'project' : 'projects'}
            {showArchived && archivedCount > 0 ? ' (archived)' : ''}
          </p>
          {archivedCount > 0 && (
            <label className="inline-flex items-center gap-1.5 text-xs text-purple-gray cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={e => setShowArchived(e.target.checked)}
                className="accent-deep-plum"
              />
              Show archived ({archivedCount})
            </label>
          )}
        </div>

        {loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-28 bg-lavender-tint/40 rounded-xl animate-pulse" />
            ))}
          </div>
        )}
        {error && !loading && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            Couldn't load projects: {error}
          </div>
        )}
        {!loading && !error && visible.length === 0 && (
          <div className="rounded-xl border border-dashed border-lavender bg-white/50 px-4 py-12 text-center">
            <p className="text-sm font-semibold text-deep-plum">
              {rows.length === 0 ? 'No web projects yet.' : 'No projects match your search.'}
            </p>
            {rows.length === 0 && (
              <>
                <p className="text-xs text-purple-gray mt-1">
                  Spin up a project to start an intake — every project anchors a Brixies-bound copy + design + dev pipeline for one church.
                </p>
                <button
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-deep-plum text-white text-xs font-semibold px-3.5 py-2 hover:bg-primary-purple transition-colors"
                >
                  <Plus size={11} />
                  Start the first project
                </button>
              </>
            )}
          </div>
        )}

        {!loading && !error && visible.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {visible.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => navigate(`/web/${p.id}`)}
                className={`text-left rounded-xl border p-4 transition-all flex items-center justify-between gap-4 ${
                  p.archived
                    ? 'border-purple-gray/30 bg-white/60 opacity-70 hover:opacity-100'
                    : 'border-lavender bg-white hover:border-primary-purple hover:shadow-sm'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold text-primary-purple uppercase tracking-widest mb-0.5">
                    {p.church_name ?? `Member #${p.member}`}
                  </p>
                  <h3 className="text-base font-semibold text-deep-plum truncate">{p.name}</h3>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Pill label={p.kind} tone="lavender" />
                    <Pill label={`Phase: ${p.current_phase}`} tone="amber" />
                    {p.archived && <Pill label="Archived" tone="muted" />}
                  </div>
                </div>
                <ArrowRight size={14} className="text-primary-purple shrink-0" />
              </button>
            ))}
          </div>
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

function Pill({ label, tone }: { label: string; tone: 'lavender' | 'amber' | 'muted' }) {
  const styles = {
    lavender: 'bg-primary-purple/10 text-primary-purple border-primary-purple/20',
    amber:    'bg-amber-100 text-amber-800 border-amber-200',
    muted:    'bg-lavender-tint text-purple-gray border-lavender',
  }[tone]
  return (
    <span className={`inline-flex items-center rounded-full text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 border ${styles}`}>
      {label}
    </span>
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
