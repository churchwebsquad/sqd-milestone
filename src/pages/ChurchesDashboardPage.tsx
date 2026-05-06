import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronUp, ChevronDown, GitBranch, Search, Table as TableIcon, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { StrategyMilestoneDefinition, StrategyMilestoneSubmission, MilestoneStatus } from '../types/database'
import type { ChurchGridRow, ChurchSortField } from '../types/churches'
import { accountStatusSortValue, extractWebPathway, extractBrandPathway, extractPlan, firstAm } from '../types/churches'
import SocialMediaIcons from '../components/churches/SocialMediaIcons'

// ── Status display ───────────────────────────────────────────────────────────

const STATUS_CLASSES: Record<string, string> = {
  Trial:           'bg-primary-purple/10 text-primary-purple',
  Active:          'bg-green-100 text-green-700',
  'Non-Renewing':  'bg-amber-100 text-amber-700',
  Paused:          'bg-purple-gray/10 text-purple-gray',
  Cancelled:       'bg-red-100 text-red-700',
}

function StatusPill({ status }: { status: string | null }) {
  if (!status) return <span className="text-purple-gray/30">—</span>
  return (
    <span className={`inline-flex items-center rounded-full text-xs font-semibold px-2 py-0.5 ${STATUS_CLASSES[status] ?? 'bg-lavender/40 text-purple-gray'}`}>
      {status}
    </span>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function SortIcon({ field, sortField, sortDir }: { field: ChurchSortField; sortField: ChurchSortField; sortDir: 'asc' | 'desc' }) {
  if (field !== sortField) return <ChevronDown size={12} className="text-purple-gray/30 group-hover:text-purple-gray/60" />
  return sortDir === 'asc'
    ? <ChevronUp size={12} className="text-primary-purple" />
    : <ChevronDown size={12} className="text-primary-purple" />
}

// ── Mobile card ──────────────────────────────────────────────────────────────

function ChurchCard({ row, onClick }: { row: ChurchGridRow; onClick: () => void }) {
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
        <StatusPill status={row.account_status} />
      </div>
      <p className="text-xs text-purple-gray mb-2">
        #{row.member} · {row.css_rep ?? 'No AM'} · {row.plan ?? '—'} · {row.cohort ?? '—'}
      </p>
      <div className="flex items-center justify-between text-xs text-purple-gray">
        <div className="flex gap-3">
          {row.brand_pathway && <span>Brand: {row.brand_pathway}</span>}
          {row.web_pathway && <span>Web: {row.web_pathway}</span>}
        </div>
        <SocialMediaIcons instagram={row.instagram} facebook={row.facebook} youtube={row.youtube} />
      </div>
      {(row.brand_milestone || row.web_milestone) && (
        <div className="flex gap-3 mt-1.5 text-xs">
          {row.brand_milestone && <span className="text-deep-plum">Brand: {row.brand_milestone}</span>}
          {row.web_milestone && <span className="text-deep-plum">Web: {row.web_milestone}</span>}
        </div>
      )}
    </button>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ChurchesDashboardPage() {
  const navigate = useNavigate()

  const [rows, setRows] = useState<ChurchGridRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [planFilter, setPlanFilter] = useState('')
  const [cohortFilter, setCohortFilter] = useState('')
  const [amFilter, setAmFilter] = useState('')

  // Sort — default: account_status priority (trial first)
  const [sortField, setSortField] = useState<ChurchSortField>('account_status')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  // Include cancelled toggle — default off for faster loads
  const [includeCancelled, setIncludeCancelled] = useState(false)

  // ── Load data ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        // Step 1: Fetch accounts table first (lightweight — no JSONB) so we know
        // which members to include based on status
        const { data: acctData, error: acctErr } = await supabase
          .from('accounts')
          .select('account, status, facebook, instagram, acc_airtable_data')

        if (acctErr) throw acctErr

        const accounts = (acctData ?? []) as {
          account: number; status: string | null
          facebook: string | null; instagram: string | null
          acc_airtable_data: Record<string, unknown> | null
        }[]

        // Filter out cancelled unless user opted in
        const visibleMembers = accounts
          .filter(a => includeCancelled || a.status !== 'Cancelled')
          .map(a => a.account)

        if (visibleMembers.length === 0) {
          setRows([])
          setLoading(false)
          return
        }

        // Step 2: Parallel fetch the expensive queries, scoped to visible members
        const [progressRes, subRes, defsRes] = await Promise.all([
          supabase
            .from('strategy_account_progress')
            .select('member, church_name, css_rep, cohort, handoff_brand_form, handoff_web_form')
            .in('member', visibleMembers),
          supabase
            .from('strategy_milestone_submissions')
            .select('member, current_milestone_id, submitted_at, milestone_status')
            .in('member', visibleMembers)
            .eq('is_active', true)
            .order('submitted_at', { ascending: false }),
          supabase
            .from('strategy_milestone_definitions')
            .select('id, squad, step_name'),
        ])

        if (progressRes.error) throw progressRes.error

        const progress = (progressRes.data ?? []) as {
          member: number; church_name: string | null; css_rep: string | null
          cohort: string | null
          handoff_brand_form: Record<string, unknown> | null
          handoff_web_form: Record<string, unknown> | null
        }[]
        const submissions = (subRes.data ?? []) as Pick<
          StrategyMilestoneSubmission,
          'member' | 'current_milestone_id' | 'submitted_at' | 'milestone_status'
        >[]
        const defs = (defsRes.data ?? []) as Pick<StrategyMilestoneDefinition, 'id' | 'squad' | 'step_name'>[]

        // Build lookup maps
        const acctMap = new Map<number, typeof accounts[0]>()
        for (const a of accounts) acctMap.set(a.account, a)

        const defMap = new Map<string, { squad: string; step_name: string }>()
        for (const d of defs) defMap.set(d.id, d)

        // Deduplicate submissions to latest-per-member-per-squad
        const latestBrand = new Map<number, { step_name: string; status: MilestoneStatus }>()
        const latestWeb = new Map<number, { step_name: string; status: MilestoneStatus }>()

        for (const s of submissions) {
          const def = defMap.get(s.current_milestone_id)
          if (!def) continue
          const ms = (s.milestone_status ?? 'sent') as MilestoneStatus
          if (def.squad === 'brand' && !latestBrand.has(s.member)) {
            latestBrand.set(s.member, { step_name: def.step_name, status: ms })
          }
          if (def.squad === 'web' && !latestWeb.has(s.member)) {
            latestWeb.set(s.member, { step_name: def.step_name, status: ms })
          }
        }

        // Build rows from strategy_account_progress (the master church list)
        const built: ChurchGridRow[] = progress.map(p => {
          const acct = acctMap.get(p.member)
          const brand = latestBrand.get(p.member)
          const web = latestWeb.get(p.member)
          return {
            member: p.member,
            church_name: p.church_name,
            account_status: acct?.status ?? null,
            plan: extractPlan(acct?.acc_airtable_data ?? null),
            cohort: p.cohort,
            css_rep: p.css_rep,
            instagram: acct?.instagram ?? null,
            facebook: acct?.facebook ?? null,
            youtube: null,
            web_pathway: extractWebPathway(p.handoff_web_form),
            brand_pathway: extractBrandPathway(p.handoff_brand_form),
            web_milestone: web?.step_name ?? null,
            web_milestone_status: web?.status ?? null,
            brand_milestone: brand?.step_name ?? null,
            brand_milestone_status: brand?.status ?? null,
          }
        })

        setRows(built)
      } catch (err) {
        setError((err as { message?: string })?.message ?? 'Failed to load churches')
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [includeCancelled])

  // ── Derived filter options ─────────────────────────────────────────────────
  const statusOptions = useMemo(() => [...new Set(rows.map(r => r.account_status).filter(Boolean) as string[])].sort(), [rows])
  const planOptions = useMemo(() => [...new Set(rows.map(r => r.plan).filter(Boolean) as string[])].sort(), [rows])
  const cohortOptions = useMemo(() => [...new Set(rows.map(r => r.cohort).filter(Boolean) as string[])].sort(), [rows])
  const amOptions = useMemo(() => [...new Set(rows.map(r => firstAm(r.css_rep)).filter(Boolean) as string[])].sort(), [rows])

  // ── Filter + sort ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let result = rows

    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(r => r.church_name?.toLowerCase().includes(q) || String(r.member).includes(q))
    }
    if (statusFilter) result = result.filter(r => r.account_status === statusFilter)
    if (planFilter) result = result.filter(r => r.plan === planFilter)
    if (cohortFilter) result = result.filter(r => r.cohort === cohortFilter)
    if (amFilter) result = result.filter(r => firstAm(r.css_rep) === amFilter)

    result = [...result].sort((a, b) => {
      let av: string | number
      let bv: string | number

      if (sortField === 'member') {
        av = a.member; bv = b.member
      } else if (sortField === 'account_status') {
        av = accountStatusSortValue(a.account_status)
        bv = accountStatusSortValue(b.account_status)
      } else {
        av = (a[sortField] as string) ?? ''
        bv = (b[sortField] as string) ?? ''
      }

      const cmp = typeof av === 'number' ? av - (bv as number) : String(av).localeCompare(String(bv))
      return sortDir === 'asc' ? cmp : -cmp
    })

    return result
  }, [rows, search, statusFilter, planFilter, cohortFilter, amFilter, sortField, sortDir])

  // ── Summary counts ─────────────────────────────────────────────────────────
  const summary = useMemo(() => ({
    total: rows.length,
    trial: rows.filter(r => r.account_status === 'Trial').length,
    active: rows.filter(r => r.account_status === 'Active').length,
  }), [rows])

  // ── Sort toggle ────────────────────────────────────────────────────────────
  const handleSort = (field: ChurchSortField) => {
    if (field === sortField) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  const hasFilters = search || statusFilter || planFilter || cohortFilter || amFilter
  const clearFilters = () => { setSearch(''); setStatusFilter(''); setPlanFilter(''); setCohortFilter(''); setAmFilter('') }

  // ── Column config ──────────────────────────────────────────────────────────
  const columns: { field: ChurchSortField; label: string; className?: string }[] = [
    { field: 'church_name', label: 'Church Name' },
    { field: 'member', label: 'Member #', className: 'w-20' },
    { field: 'account_status', label: 'Status', className: 'w-28' },
    { field: 'plan', label: 'Plan', className: 'w-24' },
    { field: 'cohort', label: 'Cohort', className: 'w-24' },
    { field: 'css_rep', label: 'AM', className: 'w-28' },
  ]

  return (
    <div className="min-h-full py-6 px-4 md:px-6">
      <div className="max-w-7xl mx-auto">

        {/* Page header */}
        <div className="mb-4 flex items-end justify-between gap-3 flex-wrap">
          <div>
            <p className="text-xs font-bold text-primary-purple uppercase tracking-widest mb-1">Churches Dashboard</p>
            <h1 className="text-2xl font-semibold text-deep-plum">Churches</h1>
            <p className="text-sm text-purple-gray mt-0.5">
              All partner accounts across Brand, Web, and Social squads.
            </p>
          </div>

          {/* View toggle — Table is the live view; Pathway is reserved for
              the in-progress milestone-flow visualization (replaces the old
              standalone /pathway route). */}
          <div className="inline-flex items-center gap-1 rounded-lg bg-lavender-tint p-1">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md bg-white text-deep-plum text-sm font-medium px-3 py-1.5 shadow-sm"
            >
              <TableIcon size={13} />
              Table view
            </button>
            <button
              type="button"
              disabled
              title="Pathway view — coming soon"
              className="inline-flex items-center gap-1.5 rounded-md text-purple-gray/60 text-sm font-medium px-3 py-1.5 cursor-not-allowed"
            >
              <GitBranch size={13} />
              Pathway view
              <span className="ml-1 text-[9px] uppercase tracking-widest font-bold">Soon</span>
            </button>
          </div>
        </div>

        {/* Summary counts */}
        {!loading && !error && rows.length > 0 && (
          <div className="grid grid-cols-3 gap-3 mb-6">
            {[
              { label: 'Total churches', value: summary.total, color: 'text-primary-purple' },
              { label: 'Trial', value: summary.trial, color: 'text-deep-plum' },
              { label: 'Active', value: summary.active, color: 'text-green-700' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-white border border-lavender rounded-xl px-4 py-3 shadow-sm">
                <p className={`text-2xl font-bold ${color}`}>{value}</p>
                <p className="text-xs text-purple-gray mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Filters */}
        <div className="bg-white border border-lavender rounded-xl px-4 py-3 mb-4 shadow-sm">
          <div className="flex flex-wrap gap-3 items-end">
            {/* Search */}
            <div className="flex-1 min-w-[180px]">
              <label className="block text-[10px] font-semibold text-purple-gray uppercase tracking-wide mb-1">Search</label>
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

            {/* Status */}
            <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter} options={statusOptions} placeholder="All statuses" />
            {/* Plan */}
            <FilterSelect label="Plan" value={planFilter} onChange={setPlanFilter} options={planOptions} placeholder="All plans" />
            {/* Cohort */}
            <FilterSelect label="Cohort" value={cohortFilter} onChange={setCohortFilter} options={cohortOptions} placeholder="All cohorts" />
            {/* AM */}
            <FilterSelect label="Account Manager" value={amFilter} onChange={setAmFilter} options={amOptions} placeholder="All AMs" />

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
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-lavender/50">
            <label className="inline-flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeCancelled}
                onChange={e => setIncludeCancelled(e.target.checked)}
                className="rounded border-lavender text-primary-purple focus:ring-primary-purple/20"
              />
              <span className="text-xs text-purple-gray">Include cancelled accounts</span>
            </label>
            {hasFilters && (
              <p className="text-xs text-purple-gray">
                Showing {filtered.length} of {rows.length} churches
              </p>
            )}
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="bg-white border border-lavender rounded-xl h-12 animate-pulse" />
            ))}
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {/* Empty */}
        {!loading && !error && rows.length === 0 && (
          <div className="bg-white border border-lavender rounded-xl p-12 text-center">
            <p className="text-purple-gray text-sm">No churches found.</p>
          </div>
        )}

        {/* No filter results */}
        {!loading && !error && rows.length > 0 && filtered.length === 0 && (
          <div className="bg-white border border-lavender rounded-xl p-10 text-center">
            <p className="text-purple-gray text-sm">No churches match the current filters.</p>
            <button type="button" onClick={clearFilters} className="mt-3 text-sm text-primary-purple hover:underline">
              Clear filters
            </button>
          </div>
        )}

        {/* Desktop table */}
        {!loading && !error && filtered.length > 0 && (
          <>
            <div className="hidden md:block bg-white border border-lavender rounded-xl shadow-sm overflow-x-auto">
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
                    <th className="px-3 py-3 text-left">
                      <span className="text-[11px] font-bold text-purple-gray uppercase tracking-wide">Social</span>
                    </th>
                    <th className="px-3 py-3 text-left" onClick={() => handleSort('web_pathway')}>
                      <div className="flex items-center gap-1 text-[11px] font-bold text-purple-gray uppercase tracking-wide hover:text-deep-plum transition-colors cursor-pointer">
                        Web Path
                        <SortIcon field="web_pathway" sortField={sortField} sortDir={sortDir} />
                      </div>
                    </th>
                    <th className="px-3 py-3 text-left" onClick={() => handleSort('brand_pathway')}>
                      <div className="flex items-center gap-1 text-[11px] font-bold text-purple-gray uppercase tracking-wide hover:text-deep-plum transition-colors cursor-pointer">
                        Brand Path
                        <SortIcon field="brand_pathway" sortField={sortField} sortDir={sortDir} />
                      </div>
                    </th>
                    <th className="px-3 py-3 text-left" onClick={() => handleSort('web_milestone')}>
                      <div className="flex items-center gap-1 text-[11px] font-bold text-purple-gray uppercase tracking-wide hover:text-deep-plum transition-colors cursor-pointer">
                        Web Milestone
                        <SortIcon field="web_milestone" sortField={sortField} sortDir={sortDir} />
                      </div>
                    </th>
                    <th className="px-3 py-3 text-left" onClick={() => handleSort('brand_milestone')}>
                      <div className="flex items-center gap-1 text-[11px] font-bold text-purple-gray uppercase tracking-wide hover:text-deep-plum transition-colors cursor-pointer">
                        Brand Milestone
                        <SortIcon field="brand_milestone" sortField={sortField} sortDir={sortDir} />
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-lavender/50">
                  {filtered.map(row => (
                    <tr
                      key={row.member}
                      onClick={() => navigate(`/churches/${row.member}`)}
                      className="cursor-pointer hover:bg-lavender-tint/30 transition-colors"
                    >
                      <td className="px-3 py-3 font-medium text-deep-plum truncate max-w-[200px]">
                        {row.church_name ?? <span className="text-purple-gray italic">Unknown</span>}
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-purple-gray">{row.member}</td>
                      <td className="px-3 py-3"><StatusPill status={row.account_status} /></td>
                      <td className="px-3 py-3 text-xs text-purple-gray">{row.plan ?? '—'}</td>
                      <td className="px-3 py-3 text-xs text-purple-gray">{row.cohort ?? '—'}</td>
                      <td className="px-3 py-3 text-xs text-purple-gray truncate max-w-[112px]">{row.css_rep ?? '—'}</td>
                      <td className="px-3 py-3">
                        <SocialMediaIcons instagram={row.instagram} facebook={row.facebook} youtube={row.youtube} />
                      </td>
                      <td className="px-3 py-3 text-xs text-purple-gray">{row.web_pathway ?? '—'}</td>
                      <td className="px-3 py-3 text-xs text-purple-gray">{row.brand_pathway ?? '—'}</td>
                      <td className="px-3 py-3 text-xs text-deep-plum truncate max-w-[140px]">{row.web_milestone ?? '—'}</td>
                      <td className="px-3 py-3 text-xs text-deep-plum truncate max-w-[140px]">{row.brand_milestone ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="px-4 py-2.5 border-t border-lavender bg-lavender-tint/20">
                <p className="text-xs text-purple-gray">
                  {filtered.length} church{filtered.length !== 1 ? 'es' : ''}
                  {hasFilters ? ` (filtered from ${rows.length})` : ''}
                </p>
              </div>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-3">
              {filtered.map(row => (
                <ChurchCard key={row.member} row={row} onClick={() => navigate(`/churches/${row.member}`)} />
              ))}
              <p className="text-xs text-center text-purple-gray py-2">
                {filtered.length} church{filtered.length !== 1 ? 'es' : ''}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── FilterSelect ─────────────────────────────────────────────────────────────

function FilterSelect({
  label, value, onChange, options, placeholder,
}: {
  label: string; value: string; onChange: (v: string) => void; options: string[]; placeholder: string
}) {
  return (
    <div className="min-w-[120px]">
      <label className="block text-[10px] font-semibold text-purple-gray uppercase tracking-wide mb-1">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full rounded-lg border border-lavender px-2.5 py-1.5 text-sm text-deep-plum bg-white outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20"
      >
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}
