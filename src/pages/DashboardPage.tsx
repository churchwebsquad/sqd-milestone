import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronUp, ChevronDown, Search, X, Link, Check, AlertCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { StrategyMilestoneDefinition, StrategyMilestoneSubmission, MilestoneStatus } from '../types/database'
import { SQUAD_LABELS, PATHWAY_LABELS } from '../components/submit/types'

// ── Types ─────────────────────────────────────────────────────────────────────

type SortField =
  | 'member'
  | 'church_name'
  | 'squad'
  | 'pathway'
  | 'current_milestone_name'
  | 'submitted_at'
  | 'submitted_by'
  | 'milestone_status'

interface DashboardRow {
  member: number
  church_name: string | null
  squad: string
  pathway: string
  current_milestone_name: string
  current_step_number: number
  submitted_at: string
  submitted_by: string
  milestone_status: MilestoneStatus
}

// ── Status display config ─────────────────────────────────────────────────────

const MILESTONE_STATUS_LABELS: Record<MilestoneStatus, string> = {
  sent:               'Sent',
  waiting_on_partner: 'Waiting',
  partner_replied:    'Partner Replied',
  in_revision:        'In Revision',
  approved:           'Approved',
  escalated:          'Escalated',
}

const MILESTONE_STATUS_CLASSES: Record<MilestoneStatus, string> = {
  sent:               'bg-primary-purple/10 text-primary-purple',
  waiting_on_partner: 'bg-amber-100 text-amber-700',
  partner_replied:    'bg-blue-100 text-blue-700',
  in_revision:        'bg-amber-100 text-amber-800',
  approved:           'bg-green-100 text-green-700',
  escalated:          'bg-red-100 text-red-700',
}

// Sort order for milestone_status column
const MILESTONE_STATUS_ORDER: Record<MilestoneStatus, number> = {
  partner_replied:    0,
  escalated:          1,
  in_revision:        2,
  waiting_on_partner: 3,
  sent:               4,
  approved:           5,
}

const ALL_MILESTONE_STATUSES: MilestoneStatus[] = [
  'sent',
  'waiting_on_partner',
  'partner_replied',
  'in_revision',
  'approved',
  'escalated',
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// ── MilestoneStatusPill ───────────────────────────────────────────────────────

function MilestoneStatusPill({ status }: { status: MilestoneStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full text-xs font-semibold px-2 py-0.5 ${MILESTONE_STATUS_CLASSES[status]}`}
    >
      {MILESTONE_STATUS_LABELS[status]}
    </span>
  )
}

// ── PortalCopyButton ──────────────────────────────────────────────────────────

function PortalCopyButton({ memberId }: { memberId: number }) {
  const [copied, setCopied] = useState(false)
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    const url = `${window.location.origin}/portal/${memberId}`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button
      type="button"
      onClick={handleClick}
      title="Copy partner portal link"
      className="inline-flex items-center justify-center h-6 w-6 rounded-full hover:bg-lavender-tint text-purple-gray hover:text-primary-purple transition-colors"
    >
      {copied ? <Check size={12} className="text-green-600" /> : <Link size={12} />}
    </button>
  )
}

// ── SortIcon ──────────────────────────────────────────────────────────────────

function SortIcon({
  field,
  sortField,
  sortDir,
}: {
  field: SortField
  sortField: SortField
  sortDir: 'asc' | 'desc'
}) {
  if (field !== sortField)
    return <ChevronDown size={12} className="text-purple-gray/30 group-hover:text-purple-gray/60" />
  return sortDir === 'asc' ? (
    <ChevronUp size={12} className="text-primary-purple" />
  ) : (
    <ChevronDown size={12} className="text-primary-purple" />
  )
}

// ── Mobile card ───────────────────────────────────────────────────────────────

function PartnerCard({ row, onClick }: { row: DashboardRow; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left bg-white border border-lavender rounded-xl px-4 py-3 hover:border-primary-purple hover:shadow-sm transition-all"
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <p className="font-semibold text-deep-plum text-sm truncate">
          {row.church_name ?? `Member #${row.member}`}
        </p>
        <div className="flex items-center gap-1.5 shrink-0">
          <PortalCopyButton memberId={row.member} />
          <MilestoneStatusPill status={row.milestone_status} />
        </div>
      </div>
      <p className="text-xs text-purple-gray mb-2">
        #{row.member} ·{' '}
        <span className="font-medium">
          {SQUAD_LABELS[row.squad] ?? row.squad} · {PATHWAY_LABELS[row.pathway] ?? row.pathway}
        </span>
      </p>
      <p className="text-xs text-deep-plum truncate">
        Step {row.current_step_number} — {row.current_milestone_name}
      </p>
      <p className="text-xs text-purple-gray mt-1">
        {formatDate(row.submitted_at)} · {row.submitted_by}
      </p>
    </button>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const navigate = useNavigate()

  const [rows, setRows] = useState<DashboardRow[]>([])
  const [needsAttentionCount, setNeedsAttentionCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [search, setSearch] = useState('')
  const [squadFilter, setSquadFilter] = useState('')
  const [pathwayFilter, setPathwayFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // Sort — default: partner_replied first, then most recent
  const [sortField, setSortField] = useState<SortField>('submitted_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  // ── Load data ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      try {
        const { data: subData, error: subErr } = await supabase
          .from('strategy_milestone_submissions')
          .select('*')
          .order('submitted_at', { ascending: false })

        if (subErr) throw subErr

        const submissions = (subData ?? []) as Pick<
          StrategyMilestoneSubmission,
          'id' | 'member' | 'current_milestone_id' | 'submitted_at' | 'submitted_by_name' | 'submitted_by_email' | 'status' | 'milestone_status'
        >[]

        if (submissions.length === 0) {
          setLoading(false)
          return
        }

        // Deduplicate — keep only the latest submission per member
        const latestByMember = new Map<number, typeof submissions[0]>()
        for (const s of submissions) {
          if (!latestByMember.has(s.member)) latestByMember.set(s.member, s)
        }
        const latest = [...latestByMember.values()]

        const memberNums = latest.map(s => s.member)
        const milestoneIds = [...new Set(latest.map(s => s.current_milestone_id).filter(Boolean))]

        // ── Parallel: account info + milestone definitions ────────────────
        const [progressRes, defsRes] = await Promise.all([
          supabase
            .from('strategy_account_progress')
            .select('member, church_name')
            .in('member', memberNums),
          supabase
            .from('strategy_milestone_definitions')
            .select('id, squad, pathway, step_number, step_name')
            .in('id', milestoneIds),
        ])

        const partnerMap = new Map<number, { church_name: string | null }>()
        for (const p of (progressRes.data ?? []) as { member: number; church_name: string | null }[]) {
          partnerMap.set(p.member, p)
        }

        const milestoneMap = new Map<
          string,
          Pick<StrategyMilestoneDefinition, 'id' | 'squad' | 'pathway' | 'step_number' | 'step_name'>
        >()
        for (const m of (defsRes.data ?? []) as Pick<
          StrategyMilestoneDefinition,
          'id' | 'squad' | 'pathway' | 'step_number' | 'step_name'
        >[]) {
          milestoneMap.set(m.id, m)
        }

        // ── Build rows ────────────────────────────────────────────────────
        const built: DashboardRow[] = latest.map(s => {
          const partner = partnerMap.get(s.member)
          const ms = milestoneMap.get(s.current_milestone_id)
          return {
            member: s.member,
            church_name: partner?.church_name ?? null,
            squad: ms?.squad ?? '',
            pathway: ms?.pathway ?? '',
            current_milestone_name: ms?.step_name ?? '—',
            current_step_number: ms?.step_number ?? 0,
            submitted_at: s.submitted_at,
            submitted_by: s.submitted_by_name ?? s.submitted_by_email ?? '—',
            milestone_status: (s.milestone_status ?? 'sent') as MilestoneStatus,
          }
        })

        setRows(built)

        // ── Needs Attention: partner_replied with untriaged replies ───────
        const partnerRepliedIds = latest
          .filter(s => s.milestone_status === 'partner_replied')
          .map(s => s.id)

        if (partnerRepliedIds.length > 0) {
          const { data: untriagedRows } = await supabase
            .from('strategy_milestone_replies')
            .select('submission_id')
            .in('submission_id', partnerRepliedIds)
            .is('triage_category', null)
            .eq('is_partner_reply', true)

          const untriagedSubIds = new Set(
            (untriagedRows ?? []).map((r: { submission_id: string }) => r.submission_id),
          )
          setNeedsAttentionCount(
            partnerRepliedIds.filter(id => untriagedSubIds.has(id)).length,
          )
        }
      } catch (err) {
        setError((err as { message?: string })?.message ?? 'Failed to load dashboard')
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [])

  // ── Derived filter options ──────────────────────────────────────────────────
  const squadOptions = useMemo(
    () => [...new Set(rows.map(r => r.squad).filter(Boolean))].sort(),
    [rows],
  )
  const pathwayOptions = useMemo(
    () => [...new Set(rows.map(r => r.pathway).filter(Boolean))].sort(),
    [rows],
  )

  // ── Filter + sort ───────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let result = rows

    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(
        r => r.church_name?.toLowerCase().includes(q) || String(r.member).includes(q),
      )
    }
    if (squadFilter) result = result.filter(r => r.squad === squadFilter)
    if (pathwayFilter) result = result.filter(r => r.pathway === pathwayFilter)
    if (statusFilter) result = result.filter(r => r.milestone_status === statusFilter)
    if (dateFrom) result = result.filter(r => r.submitted_at >= dateFrom)
    if (dateTo) result = result.filter(r => r.submitted_at <= dateTo + 'T23:59:59')

    result = [...result].sort((a, b) => {
      // When using the default submitted_at sort, partner_replied always floats to top
      if (sortField === 'submitted_at') {
        const aReply = a.milestone_status === 'partner_replied'
        const bReply = b.milestone_status === 'partner_replied'
        if (aReply && !bReply) return -1
        if (bReply && !aReply) return 1
      }

      let av: string | number
      let bv: string | number

      if (sortField === 'member') {
        av = a.member; bv = b.member
      } else if (sortField === 'milestone_status') {
        av = MILESTONE_STATUS_ORDER[a.milestone_status] ?? 99
        bv = MILESTONE_STATUS_ORDER[b.milestone_status] ?? 99
      } else {
        av = (a as Record<string, unknown>)[sortField] as string ?? ''
        bv = (b as Record<string, unknown>)[sortField] as string ?? ''
      }

      const cmp =
        typeof av === 'number'
          ? av - (bv as number)
          : String(av).localeCompare(String(bv))
      return sortDir === 'asc' ? cmp : -cmp
    })

    return result
  }, [rows, search, squadFilter, pathwayFilter, statusFilter, dateFrom, dateTo, sortField, sortDir])

  // ── Summary counts ──────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    const total = rows.length
    const atReview = rows.filter(r =>
      r.current_milestone_name.toLowerCase().includes('review'),
    ).length
    const launched = rows.filter(r => {
      const n = r.current_milestone_name.toLowerCase()
      return n.includes('launch') || n.includes('handoff')
    }).length
    return { total, atReview, launched }
  }, [rows])

  // ── Sort toggle ─────────────────────────────────────────────────────────────
  const handleSort = (field: SortField) => {
    if (field === sortField) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir(field === 'milestone_status' ? 'asc' : 'asc')
    }
  }

  const hasFilters = search || squadFilter || pathwayFilter || statusFilter || dateFrom || dateTo
  const clearFilters = () => {
    setSearch('')
    setSquadFilter('')
    setPathwayFilter('')
    setStatusFilter('')
    setDateFrom('')
    setDateTo('')
  }

  // ── Column headers ──────────────────────────────────────────────────────────
  const columns: { field: SortField; label: string; className?: string }[] = [
    { field: 'member', label: 'Member #', className: 'w-20' },
    { field: 'church_name', label: 'Church Name' },
    { field: 'squad', label: 'Squad', className: 'w-20' },
    { field: 'pathway', label: 'Pathway', className: 'w-32' },
    { field: 'current_milestone_name', label: 'Current Milestone' },
    { field: 'submitted_at', label: 'Last Submission', className: 'w-36' },
    { field: 'submitted_by', label: 'Submitted By', className: 'w-32' },
    { field: 'milestone_status', label: 'Status', className: 'w-32' },
  ]

  return (
    <div className="min-h-full py-6 px-4 md:px-6">
      <div className="max-w-7xl mx-auto">

        {/* Page header ────────────────────────────────────────────────────── */}
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-deep-plum">Partner Dashboard</h1>
          <p className="text-sm text-purple-gray mt-0.5">
            Latest milestone status across all active partners.
          </p>
        </div>

        {/* Needs Attention banner ──────────────────────────────────────────── */}
        {!loading && !error && needsAttentionCount > 0 && (
          <div className="mb-4 flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
            <AlertCircle size={16} className="text-blue-600 shrink-0" />
            <p className="text-sm text-blue-800">
              <span className="font-semibold">{needsAttentionCount} partner{needsAttentionCount !== 1 ? 's' : ''}</span>
              {' '}replied with untriaged feedback.{' '}
              <button
                type="button"
                onClick={() => setStatusFilter('partner_replied')}
                className="underline hover:no-underline font-medium"
              >
                Filter to view
              </button>
            </p>
          </div>
        )}

        {/* Summary counts ─────────────────────────────────────────────────── */}
        {!loading && !error && rows.length > 0 && (
          <div className="grid grid-cols-3 gap-3 mb-6">
            {[
              { label: 'Partners in progress', value: summary.total, color: 'text-primary-purple' },
              { label: 'At review stages', value: summary.atReview, color: 'text-deep-plum' },
              { label: 'Launched / Handed off', value: summary.launched, color: 'text-green-700' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-white border border-lavender rounded-xl px-4 py-3 shadow-sm">
                <p className={`text-2xl font-bold ${color}`}>{value}</p>
                <p className="text-xs text-purple-gray mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Filters ────────────────────────────────────────────────────────── */}
        <div className="bg-white border border-lavender rounded-xl px-4 py-3 mb-4 shadow-sm">
          <div className="flex flex-wrap gap-3 items-end">
            {/* Search */}
            <div className="flex-1 min-w-[180px]">
              <label className="block text-[10px] font-semibold text-purple-gray uppercase tracking-wide mb-1">
                Search
              </label>
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-purple-gray/50" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Church name or member #"
                  className="w-full rounded-lg border border-lavender pl-7 pr-3 py-1.5 text-sm text-deep-plum placeholder-purple-gray/40 outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20"
                />
              </div>
            </div>

            {/* Squad */}
            <div className="min-w-[120px]">
              <label className="block text-[10px] font-semibold text-purple-gray uppercase tracking-wide mb-1">
                Squad
              </label>
              <select
                value={squadFilter}
                onChange={e => setSquadFilter(e.target.value)}
                className="w-full rounded-lg border border-lavender px-2.5 py-1.5 text-sm text-deep-plum bg-white outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20"
              >
                <option value="">All squads</option>
                {squadOptions.map(s => (
                  <option key={s} value={s}>{SQUAD_LABELS[s] ?? s}</option>
                ))}
              </select>
            </div>

            {/* Pathway */}
            <div className="min-w-[150px]">
              <label className="block text-[10px] font-semibold text-purple-gray uppercase tracking-wide mb-1">
                Pathway
              </label>
              <select
                value={pathwayFilter}
                onChange={e => setPathwayFilter(e.target.value)}
                className="w-full rounded-lg border border-lavender px-2.5 py-1.5 text-sm text-deep-plum bg-white outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20"
              >
                <option value="">All pathways</option>
                {pathwayOptions.map(p => (
                  <option key={p} value={p}>{PATHWAY_LABELS[p] ?? p}</option>
                ))}
              </select>
            </div>

            {/* Status */}
            <div className="min-w-[150px]">
              <label className="block text-[10px] font-semibold text-purple-gray uppercase tracking-wide mb-1">
                Status
              </label>
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="w-full rounded-lg border border-lavender px-2.5 py-1.5 text-sm text-deep-plum bg-white outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20"
              >
                <option value="">All statuses</option>
                {ALL_MILESTONE_STATUSES.map(s => (
                  <option key={s} value={s}>{MILESTONE_STATUS_LABELS[s]}</option>
                ))}
              </select>
            </div>

            {/* Date range */}
            <div>
              <label className="block text-[10px] font-semibold text-purple-gray uppercase tracking-wide mb-1">
                From
              </label>
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="rounded-lg border border-lavender px-2.5 py-1.5 text-sm text-deep-plum outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-purple-gray uppercase tracking-wide mb-1">
                To
              </label>
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="rounded-lg border border-lavender px-2.5 py-1.5 text-sm text-deep-plum outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20"
              />
            </div>

            {/* Clear */}
            {hasFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center gap-1.5 rounded-full border border-lavender text-sm text-purple-gray px-3 py-1.5 hover:bg-lavender-tint transition-colors self-end"
              >
                <X size={13} />
                Clear
              </button>
            )}
          </div>

          {hasFilters && (
            <p className="text-xs text-purple-gray mt-2">
              Showing {filtered.length} of {rows.length} partners
            </p>
          )}
        </div>

        {/* Loading ─────────────────────────────────────────────────────────── */}
        {loading && (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="bg-white border border-lavender rounded-xl h-12 animate-pulse" />
            ))}
          </div>
        )}

        {/* Error ───────────────────────────────────────────────────────────── */}
        {!loading && error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Empty state ─────────────────────────────────────────────────────── */}
        {!loading && !error && rows.length === 0 && (
          <div className="bg-white border border-lavender rounded-xl p-12 text-center">
            <p className="text-purple-gray text-sm">No milestone submissions found.</p>
          </div>
        )}

        {/* No results after filter ─────────────────────────────────────────── */}
        {!loading && !error && rows.length > 0 && filtered.length === 0 && (
          <div className="bg-white border border-lavender rounded-xl p-10 text-center">
            <p className="text-purple-gray text-sm">No partners match the current filters.</p>
            <button
              type="button"
              onClick={clearFilters}
              className="mt-3 text-sm text-primary-purple hover:underline"
            >
              Clear filters
            </button>
          </div>
        )}

        {/* Desktop table ───────────────────────────────────────────────────── */}
        {!loading && !error && filtered.length > 0 && (
          <>
            <div className="hidden md:block bg-white border border-lavender rounded-xl shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-lavender bg-lavender-tint/40">
                    {columns.map(col => (
                      <th
                        key={col.field}
                        className={`group px-3 py-3 text-left cursor-pointer select-none ${col.className ?? ''}`}
                        onClick={() => handleSort(col.field)}
                      >
                        <div className="flex items-center gap-1 text-[11px] font-bold text-purple-gray uppercase tracking-wide hover:text-deep-plum transition-colors">
                          {col.label}
                          <SortIcon field={col.field} sortField={sortField} sortDir={sortDir} />
                        </div>
                      </th>
                    ))}
                    <th className="w-8 px-2 py-3" title="Copy partner portal link" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-lavender/50">
                  {filtered.map(row => (
                    <tr
                      key={row.member}
                      onClick={() => navigate(`/account/${row.member}`)}
                      className={`cursor-pointer transition-colors ${
                        row.milestone_status === 'partner_replied'
                          ? 'bg-blue-50/40 hover:bg-blue-50/70'
                          : 'hover:bg-lavender-tint/30'
                      }`}
                    >
                      <td className="px-3 py-3 font-mono text-xs text-purple-gray">
                        {row.member}
                      </td>
                      <td className="px-3 py-3 font-medium text-deep-plum truncate max-w-[200px]">
                        {row.church_name ?? <span className="text-purple-gray italic">Unknown</span>}
                      </td>
                      <td className="px-3 py-3">
                        <span className="text-xs font-semibold text-primary-purple uppercase tracking-wide">
                          {SQUAD_LABELS[row.squad] ?? row.squad}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-xs text-purple-gray">
                        {PATHWAY_LABELS[row.pathway] ?? row.pathway}
                      </td>
                      <td className="px-3 py-3 text-xs text-deep-plum">
                        <span className="text-purple-gray mr-1">Step {row.current_step_number}</span>
                        {row.current_milestone_name}
                      </td>
                      <td className="px-3 py-3 text-xs text-purple-gray whitespace-nowrap">
                        {formatDate(row.submitted_at)}
                      </td>
                      <td className="px-3 py-3 text-xs text-purple-gray truncate max-w-[128px]">
                        {row.submitted_by}
                      </td>
                      <td className="px-3 py-3">
                        <MilestoneStatusPill status={row.milestone_status} />
                      </td>
                      <td className="px-2 py-3">
                        <PortalCopyButton memberId={row.member} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="px-4 py-2.5 border-t border-lavender bg-lavender-tint/20">
                <p className="text-xs text-purple-gray">
                  {filtered.length} partner{filtered.length !== 1 ? 's' : ''}
                  {hasFilters ? ` (filtered from ${rows.length})` : ''}
                  {' · '}Partner Replied rows highlighted in blue
                </p>
              </div>
            </div>

            {/* Mobile cards ─────────────────────────────────────────────────── */}
            <div className="md:hidden space-y-3">
              {filtered.map(row => (
                <PartnerCard
                  key={row.member}
                  row={row}
                  onClick={() => navigate(`/account/${row.member}`)}
                />
              ))}
              <p className="text-xs text-center text-purple-gray py-2">
                {filtered.length} partner{filtered.length !== 1 ? 's' : ''}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
