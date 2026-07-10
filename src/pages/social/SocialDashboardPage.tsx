/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Search, Brain, Sparkles, ArrowUpDown, Plus, X, Loader2, Save, Mic, Clock, AlertCircle, CheckCircle2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import type { StrategySocialProProfile } from '../../types/database'

interface Church {
  member: number
  church_name: string | null
  css_rep: string | null
  socialPro?: boolean
}

interface IntelMeta {
  member: number
  intel_updated_at: string
}

interface SrpMeta {
  member: number
  taskId: string
  taskName: string
  status: string
  createdAt: string
  updatedAt: string
  dueDate?: string
  url?: string
}

interface AutoJob {
  member: number
  video_status: 'pending' | 'found' | 'waiting_for_upload' | 'error'
  transcript_status: 'pending' | 'in_progress' | 'ready' | 'error' | 'skipped'
  video_error: string | null
}

type SortMode = 'srp' | 'member' | 'alpha'

const SORT_LABELS: Record<SortMode, string> = {
  srp:    'SRP Activity',
  member: 'Member #',
  alpha:  'A–Z',
}

// Returns the Friday 00:00:00 that started the current Fri–Thu work week
function getWeekStart(now: Date): Date {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  // getDay(): 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat
  const daysSinceFri = d.getDay() === 5 ? 0 : d.getDay() === 6 ? 1 : d.getDay() + 2
  d.setDate(d.getDate() - daysSinceFri)
  return d
}

function isThisWeek(dateStr: string, weekStart: Date): boolean {
  const t = new Date(dateStr).getTime()
  const end = weekStart.getTime() + 7 * 24 * 60 * 60 * 1000
  return t >= weekStart.getTime() && t < end
}

// Parse sermon date from task name e.g. "4077 - July 5 Sermon Recap Posts"
function parseDateFromTaskName(name: string): Date | null {
  const match = name.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})\b/i)
  if (!match) return null
  const year = new Date().getFullYear()
  const d = new Date(`${match[1]} ${match[2]}, ${year}`)
  return isNaN(d.getTime()) ? null : d
}

// ── Add Profile Modal ─────────────────────────────────────────────────────────

function AddProfileModal({
  member,
  onClose,
  onSaved,
}: {
  member: number
  onClose: () => void
  onSaved: (profile: StrategySocialProProfile) => void
}) {
  const { user } = useAuth()
  const [churchName, setChurchName] = useState('')
  const [cssRep, setCssRep]         = useState('')
  const [plan, setPlan]             = useState('Social Pro')
  const [website, setWebsite]       = useState('')
  const [notes, setNotes]           = useState('')
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState<string | null>(null)

  const handleSave = useCallback(async () => {
    if (!churchName.trim()) { setError('Church name is required.'); return }
    setSaving(true); setError(null)
    const payload: Partial<StrategySocialProProfile> = {
      member,
      church_name: churchName.trim() || null,
      css_rep:     cssRep.trim()     || null,
      plan:        plan.trim()       || 'Social Pro',
      website:     website.trim()    || null,
      notes:       notes.trim()      || null,
      created_by:  user?.email       ?? null,
    }
    const { data, error: err } = await (supabase as any)
      .from('strategy_social_pro_profiles')
      .upsert(payload, { onConflict: 'member' })
      .select()
      .single()
    if (err) { setError(err.message); setSaving(false); return }
    onSaved(data as StrategySocialProProfile)
  }, [member, churchName, cssRep, plan, website, notes, user?.email, onSaved])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
          <div>
            <p className="text-xs font-bold text-[#513DE5] uppercase tracking-widest mb-0.5">Member #{member}</p>
            <h2 className="text-lg font-bold text-[#341756]">Add church profile</h2>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <Field label="Church name *">
            <input
              type="text"
              value={churchName}
              onChange={e => setChurchName(e.target.value)}
              placeholder="e.g. Cornerstone Church"
              className="input-base"
              autoFocus
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Account manager">
              <input
                type="text"
                value={cssRep}
                onChange={e => setCssRep(e.target.value)}
                placeholder="e.g. Jamie"
                className="input-base"
              />
            </Field>
            <Field label="Plan">
              <input
                type="text"
                value={plan}
                onChange={e => setPlan(e.target.value)}
                placeholder="Social Pro"
                className="input-base"
              />
            </Field>
          </div>

          <Field label="Website">
            <input
              type="text"
              value={website}
              onChange={e => setWebsite(e.target.value)}
              placeholder="https://…"
              className="input-base"
            />
          </Field>

          <Field label="Notes">
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Anything the team should know…"
              className="input-base resize-none"
            />
          </Field>

          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 pb-5">
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2 rounded-full transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !churchName.trim()}
            className="inline-flex items-center gap-2 bg-[#341756] text-white text-sm font-semibold px-5 py-2 rounded-full hover:bg-[#513DE5] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</label>
      {children}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SocialDashboardPage() {
  const [churches, setChurches]   = useState<Church[]>([])
  const [intelMap, setIntelMap]   = useState<Map<number, IntelMeta>>(new Map())
  const [srpMap, setSrpMap]       = useState<Map<number, SrpMeta>>(new Map())
  const [smmMap, setSmmMap]       = useState<Map<number, string>>(new Map())
  const [autoJobMap, setAutoJobMap] = useState<Map<number, AutoJob>>(new Map())
  const [activeOnlySet, setActiveOnlySet] = useState<Set<number>>(new Set())
  const [thisWeekTasks, setThisWeekTasks] = useState<SrpMeta[]>([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [sort, setSort]           = useState<SortMode>('srp')
  const [addingMember, setAddingMember] = useState<number | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)

      const [churchRes, intelRes, proRes, accountStatusRes] = await Promise.all([
        supabase
          .from('strategy_account_progress')
          .select('member, church_name, css_rep')
          .order('member', { ascending: true }),
        (supabase as any)
          .from('strategy_church_intel')
          .select('member, intel_updated_at')
          .eq('status', 'live'),
        (supabase as any)
          .from('strategy_social_pro_profiles')
          .select('member, church_name, css_rep'),
        (supabase as any)
          .from('accounts')
          .select('account, status')
          .in('status', ['Active', 'Trial']),
      ])

      const accountStatuses = (accountStatusRes.data ?? []) as { account: number; status: string }[]
      // Active/Trial members shown in the hub; Active-only members shown in overdue alert
      const activeMembers     = new Set<number>(accountStatuses.map(a => a.account))
      const activeOnlyMembers = new Set<number>(accountStatuses.filter(a => a.status === 'Active').map(a => a.account))

      const dbMembers = new Set(((churchRes.data ?? []) as Church[]).map(c => c.member))
      const proChurches: Church[] = ((proRes.data ?? []) as StrategySocialProProfile[])
        .filter(p => !dbMembers.has(p.member))
        .map(p => ({ member: p.member, church_name: p.church_name, css_rep: p.css_rep, socialPro: true }))

      const allChurches = [
        ...((churchRes.data ?? []) as Church[]).filter(c => activeMembers.size === 0 || activeMembers.has(c.member)),
        ...proChurches,
      ]
      setChurches(allChurches)
      setLoading(false)

      const im = new Map<number, IntelMeta>()
      for (const row of (intelRes.data ?? []) as IntelMeta[]) im.set(row.member, row)
      setIntelMap(im)

      // Enrichment — read from pre-fetched cache table first, fall back to live APIs
      const [cacheRes, smmLiveRes, autoJobRes] = await Promise.allSettled([
        (supabase as any)
          .from('strategy_srp_hub_cache')
          .select('cache_key, data, refreshed_at')
          .in('cache_key', ['srp_tasks', 'smm_assignments', 'srp_tasks_this_week']),
        fetch('/api/notion/smm-assignments').then(r => r.ok ? r.json() : null),
        (supabase as any)
          .schema('strategy')
          .from('srp_auto_jobs')
          .select('member, video_status, transcript_status, video_error')
          .gte('week_start', getWeekStart(new Date()).toISOString().split('T')[0]),
      ])

      let srpData: { tasks: SrpMeta[]; allTasks: SrpMeta[] } = { tasks: [], allTasks: [] }
      let srpWeekData: { tasks: SrpMeta[]; total: number } = { tasks: [], total: 0 }
      let smmData: { assignments: { member: number; smm: string }[] } = { assignments: [] }

      if (cacheRes.status === 'fulfilled' && cacheRes.value.data) {
        for (const row of cacheRes.value.data as { cache_key: string; data: any }[]) {
          if (row.cache_key === 'srp_tasks')            srpData = row.data
          if (row.cache_key === 'smm_assignments')     smmData = row.data
          if (row.cache_key === 'srp_tasks_this_week') srpWeekData = row.data
        }
      }

      // If cache is empty, fall back to live ClickUp fetch
      if (srpData.tasks.length === 0) {
        try {
          const live = await fetch('/api/clickup/srp-tasks').then(r => r.ok ? r.json() : null)
          if (live) srpData = live
        } catch { /* non-fatal */ }
      }

      // If SMM cache is empty and live Notion responded, use that
      if (smmData.assignments.length === 0 && smmLiveRes.status === 'fulfilled' && smmLiveRes.value) {
        smmData = smmLiveRes.value
      }

      const sm = new Map<number, SrpMeta>()
      for (const row of srpData.tasks) sm.set(row.member, row)
      setSrpMap(sm)
      // Filter by due date (primary) or task name date (fallback).
      // Squad API doesn't return updatedAt timestamps reliably.
      const ws = getWeekStart(new Date())
      setThisWeekTasks((srpWeekData.tasks ?? []).filter(t => {
        if (t.dueDate) return isThisWeek(t.dueDate, ws)
        const d = parseDateFromTaskName(t.taskName ?? '')
        return d ? isThisWeek(d.toISOString(), ws) : false
      }))

      // Surface ClickUp-only churches not yet in either DB table — deduplicated
      const allMemberSet = new Set(allChurches.map(c => c.member))
      const seenOrphans  = new Set<number>()
      const orphans: Church[] = []
      for (const row of srpData.tasks) {
        if (!allMemberSet.has(row.member) && !seenOrphans.has(row.member)) {
          seenOrphans.add(row.member)
          orphans.push({ member: row.member, church_name: null, css_rep: null, socialPro: true })
        }
      }
      if (orphans.length > 0) setChurches(prev => {
        // Final dedup guard: merge only members not already in prev state
        const prevSet = new Set(prev.map(c => c.member))
        return [...prev, ...orphans.filter(o => !prevSet.has(o.member))]
      })

      const smm = new Map<number, string>()
      for (const row of smmData.assignments) smm.set(row.member, row.smm)
      setSmmMap(smm)

      const aj = new Map<number, AutoJob>()
      if (autoJobRes.status === 'fulfilled' && autoJobRes.value.data) {
        for (const row of autoJobRes.value.data as AutoJob[]) aj.set(row.member, row)
      }
      setAutoJobMap(aj)
      setActiveOnlySet(activeOnlyMembers)
    }
    void load()
  }, [])

  // Build a set + due-date map from the ClickUp-direct this-week cache
  const thisWeekMemberSet = useMemo(
    () => new Set(thisWeekTasks.map(t => t.member)),
    [thisWeekTasks]
  )
  const thisWeekDueDateMap = useMemo(() => {
    const m = new Map<number, number>()
    for (const t of thisWeekTasks) {
      const ms = t.dueDate ? new Date(t.dueDate).getTime() : Infinity
      if (!m.has(t.member) || ms < m.get(t.member)!) m.set(t.member, ms)
    }
    return m
  }, [thisWeekTasks])

  // task ID map from ClickUp-direct data (Squad API doesn't return id field)
  const thisWeekTaskIdMap = useMemo(() => {
    const m = new Map<number, string>()
    for (const t of thisWeekTasks) {
      if (t.taskId && !m.has(t.member)) m.set(t.member, t.taskId)
    }
    return m
  }, [thisWeekTasks])

  const sorted = useMemo(() => {
    const base = search.trim()
      ? churches.filter(c =>
          (c.church_name ?? '').toLowerCase().includes(search.toLowerCase()) ||
          String(c.member).includes(search)
        )
      : [...churches]

    if (sort === 'member') return base.sort((a, b) => a.member - b.member)
    if (sort === 'alpha') return base.sort((a, b) =>
      (a.church_name ?? `#${a.member}`).localeCompare(b.church_name ?? `#${b.member}`)
    )
    return base.sort((a, b) => {
      const aSrp = srpMap.get(a.member)
      const bSrp = srpMap.get(b.member)
      const aThisWeek = thisWeekMemberSet.has(a.member)
      const bThisWeek = thisWeekMemberSet.has(b.member)
      if (aThisWeek && !bThisWeek) return -1
      if (!aThisWeek && bThisWeek) return  1
      // Both this week → order by when the task was submitted (oldest first = came in first)
      if (aThisWeek && bThisWeek) {
        const aCreated = aSrp ? new Date(aSrp.createdAt).getTime() : Infinity
        const bCreated = bSrp ? new Date(bSrp.createdAt).getTime() : Infinity
        return aCreated - bCreated
      }
      // Neither this week → most recently active first
      const aTime = aSrp ? new Date(aSrp.updatedAt).getTime() : 0
      const bTime = bSrp ? new Date(bSrp.updatedAt).getTime() : 0
      if (aTime !== bTime) return bTime - aTime
      return a.member - b.member
    })
  }, [churches, search, sort, srpMap, thisWeekMemberSet, thisWeekDueDateMap])

  const handleProfileSaved = useCallback((profile: StrategySocialProProfile) => {
    setChurches(prev => prev.map(c =>
      c.member === profile.member
        ? { ...c, church_name: profile.church_name, css_rep: profile.css_rep }
        : c
    ))
    setAddingMember(null)
  }, [])

  const [overdueOpen, setOverdueOpen] = useState(false)

  const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now()
  const overdueChurches = useMemo(() => {
    return churches.filter(c => {
      if (c.socialPro) return false // only All-In churches
      if (!activeOnlySet.has(c.member)) return false // exclude Trial + non-active
      if (thisWeekMemberSet.has(c.member)) return false // active this week
      const srp = srpMap.get(c.member)
      if (!srp) return true // never submitted
      const lastMs = new Date(srp.updatedAt || srp.createdAt).getTime()
      if (isNaN(lastMs)) return false // no timestamp — can't determine, don't flag
      return (nowMs - lastMs) >= TWO_WEEKS_MS
    })
  }, [churches, srpMap, thisWeekMemberSet, activeOnlySet])

  const STATUS_LABELS: Record<string, string> = {
    'open':                  'Open',
    'dependent':             'Dependent',
    'more info need':        'More Info Need',
    'received':              'Received',
    'waiting feedback':      'Waiting Feedback',
    'needs an update':       'Needs an Update',
    'on hold':               'On Hold',
    'deliverables needed':   'Deliverables Needed',
    'final files delivered': 'Final Files Delivered',
    'closed':                'Closed',
  }

  // Normalize status to lowercase for matching
  const normalizeStatus = (s: string) => s.toLowerCase().trim()

  const statusCounts = Object.fromEntries(
    Object.keys(STATUS_LABELS).map(s => [s, 0])
  ) as Record<string, number>
  for (const t of thisWeekTasks) {
    const key = normalizeStatus(t.status ?? '')
    if (key in statusCounts) statusCounts[key]++
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">

      <div className="mb-6">
        <p className="text-xs font-semibold text-[#513DE5] uppercase tracking-widest mb-1">Social</p>
        <h1 className="text-3xl font-bold text-[#341756]">Social Hub</h1>
        <p className="text-sm text-gray-500 mt-1">All partner churches — click one to open their Social Hub.</p>
      </div>

      {/* Stats bar */}
      <div className="bg-white border border-[#CFC9F8] rounded-2xl p-5 mb-6">
        <div className="flex items-baseline gap-2 mb-4">
          <span className="text-2xl font-bold text-[#341756]">{thisWeekTasks.length}</span>
          <span className="text-sm text-gray-500">SRPs this week</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {Object.entries(STATUS_LABELS).map(([key, label]) => (
            <div key={key} className="bg-[#F9F5F1] rounded-xl px-3 py-2.5">
              <p className="text-xl font-bold text-[#341756]">{statusCounts[key] ?? 0}</p>
              <p className="text-[11px] text-gray-500 mt-0.5 leading-tight">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Overdue alert */}
      {overdueChurches.length > 0 && (
        <div className="mb-6">
          <button
            type="button"
            onClick={() => setOverdueOpen(o => !o)}
            className="w-full flex items-center justify-between bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 hover:bg-amber-100 transition-colors text-left"
          >
            <div className="flex items-center gap-3">
              <AlertCircle size={18} className="text-amber-500 shrink-0" />
              <div>
                <p className="text-sm font-bold text-amber-800">
                  {overdueChurches.length} All-In {overdueChurches.length === 1 ? 'church has' : 'churches have'} not submitted an SRP in 2+ weeks
                </p>
                <p className="text-xs text-amber-600 mt-0.5">Click to {overdueOpen ? 'hide' : 'view'} the list</p>
              </div>
            </div>
            <span className="text-amber-500 text-lg">{overdueOpen ? '▲' : '▼'}</span>
          </button>

          {overdueOpen && (
            <div className="mt-2 bg-white border border-amber-200 rounded-2xl overflow-hidden">
              <div className="divide-y divide-gray-100">
                {overdueChurches.map(c => {
                  const srp = srpMap.get(c.member)
                  const lastDate = srp
                    ? new Date(srp.updatedAt || srp.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                    : null
                  return (
                    <Link
                      key={c.member}
                      to={`/social/${c.member}`}
                      className="flex items-center justify-between px-5 py-3 hover:bg-amber-50 transition-colors"
                    >
                      <div>
                        <p className="text-sm font-semibold text-[#341756]">{c.church_name ?? `Member #${c.member}`}</p>
                        <p className="text-xs text-gray-400">
                          #{c.member}{c.css_rep ? ` · AM: ${c.css_rep}` : ''}
                        </p>
                      </div>
                      <p className="text-xs text-amber-600 font-medium shrink-0 ml-4">
                        {lastDate ? `Last SRP: ${lastDate}` : 'No SRP on record'}
                      </p>
                    </Link>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Search + sort */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by church name or member #…"
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#513DE5] bg-white"
          />
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white p-1 shrink-0">
          <ArrowUpDown size={12} className="text-gray-400 ml-1.5 mr-0.5" />
          {(Object.keys(SORT_LABELS) as SortMode[]).map(mode => (
            <button
              key={mode}
              type="button"
              onClick={() => setSort(mode)}
              className={[
                'text-xs px-3 py-1.5 rounded-lg font-medium transition-colors',
                sort === mode
                  ? 'bg-[#513DE5] text-white'
                  : 'text-gray-500 hover:text-[#341756] hover:bg-gray-50',
              ].join(' ')}
            >
              {SORT_LABELS[mode]}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20">
          <div className="w-8 h-8 border-4 border-[#513DE5] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-400">Loading churches…</p>
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-400 mb-4">{sorted.length} church{sorted.length !== 1 ? 'es' : ''}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {sorted.map(c => {
              const intel        = intelMap.get(c.member)
              const srp          = srpMap.get(c.member)
              const srpDateMs    = srp ? new Date(srp.updatedAt || srp.createdAt).getTime() : NaN
              const srpDate      = srp && !isNaN(srpDateMs) ? new Date(srpDateMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null
              const thisWeek     = thisWeekMemberSet.has(c.member)
              const noName       = !c.church_name

              return (
                <div key={c.member} className="relative">
                  <Link
                    to={`/social/${c.member}`}
                    className={[
                      'group bg-white border rounded-2xl p-5 hover:border-[#513DE5] hover:shadow-sm transition-all flex flex-col gap-3 h-full',
                      thisWeek ? 'border-[#513DE5]/40 ring-1 ring-[#513DE5]/10' : 'border-[#CFC9F8]',
                    ].join(' ')}
                  >
                    <div>
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <p className="text-xs font-bold text-[#513DE5]">#{c.member}</p>
                        {c.socialPro && (
                          <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded-full">
                            Social Pro
                          </span>
                        )}
                        {thisWeek && (
                          <span className="text-[10px] font-bold uppercase tracking-wider bg-[#EDE9FC] text-[#513DE5] px-1.5 py-0.5 rounded-full">
                            This week
                          </span>
                        )}
                      </div>
                      <p className={[
                        'font-bold leading-tight transition-colors',
                        noName ? 'text-gray-400 italic' : 'text-[#341756] group-hover:text-[#513DE5]',
                      ].join(' ')}>
                        {c.church_name ?? `Member #${c.member}`}
                      </p>
                    </div>

                    <div className="flex flex-col gap-0.5">
                      {c.css_rep && (
                        <p className="text-xs text-gray-600"><span className="text-gray-400 mr-1">AM</span>{c.css_rep}</p>
                      )}
                      <p className="text-xs text-gray-600">
                        <span className="text-gray-400 mr-1">SMM</span>
                        {smmMap.get(c.member) ?? <span className="text-gray-300">—</span>}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-1.5 mt-auto">
                      {intel ? (
                        <span className="inline-flex items-center gap-1 text-xs bg-[#EDE9FC] text-[#513DE5] px-2 py-0.5 rounded-full font-medium">
                          <Brain size={10} /> Intel
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full">
                          <Brain size={10} /> No intel
                        </span>
                      )}
                      {srp ? (
                        <a
                          href={srp.url || `https://app.clickup.com/t/${thisWeekTaskIdMap.get(c.member) || srp.taskId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-xs bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full font-medium hover:bg-amber-100 transition-colors"
                        >
                          <Sparkles size={10} /> {thisWeekTaskIdMap.get(c.member) || srp.taskId ? `#${thisWeekTaskIdMap.get(c.member) || srp.taskId}` : 'SRP'}{srpDate ? ` · ${srpDate}` : ''}
                        </a>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-300 px-2 py-0.5 rounded-full">
                          <Sparkles size={10} /> No SRP yet
                        </span>
                      )}
                      {(() => {
                        const job = autoJobMap.get(c.member)
                        if (!job) return null
                        if (job.transcript_status === 'ready') return (
                          <span className="inline-flex items-center gap-1 text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full font-medium">
                            <CheckCircle2 size={10} /> Transcript ready
                          </span>
                        )
                        if (job.transcript_status === 'in_progress' || job.video_status === 'found') return (
                          <span className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-medium">
                            <Loader2 size={10} className="animate-spin" /> Transcribing…
                          </span>
                        )
                        if (job.video_status === 'waiting_for_upload') return (
                          <span className="inline-flex items-center gap-1 text-xs bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full font-medium">
                            <Clock size={10} /> Waiting for video
                          </span>
                        )
                        if (job.video_status === 'error' || job.transcript_status === 'error') return (
                          <span className="inline-flex items-center gap-1 text-xs bg-red-50 text-red-600 px-2 py-0.5 rounded-full font-medium" title={job.video_error ?? undefined}>
                            <AlertCircle size={10} /> Video error
                          </span>
                        )
                        return (
                          <span className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full">
                            <Mic size={10} /> SRP queued
                          </span>
                        )
                      })()}
                    </div>
                  </Link>

                  {/* Add profile button — shown on Social Pro cards with no name */}
                  {c.socialPro && noName && (
                    <button
                      type="button"
                      onClick={e => { e.preventDefault(); setAddingMember(c.member) }}
                      className="absolute top-3 right-3 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-[#513DE5] text-white px-2 py-1 rounded-full hover:bg-[#341756] transition-colors shadow-sm"
                    >
                      <Plus size={10} /> Add profile
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {addingMember !== null && (
        <AddProfileModal
          member={addingMember}
          onClose={() => setAddingMember(null)}
          onSaved={handleProfileSaved}
        />
      )}

      <style>{`.input-base { width: 100%; border: 1px solid #e5e7eb; border-radius: 0.5rem; padding: 0.5rem 0.75rem; font-size: 0.875rem; color: #341756; background: white; outline: none; } .input-base:focus { border-color: #513DE5; box-shadow: 0 0 0 2px rgba(81,61,229,0.15); }`}</style>
    </div>
  )
}
