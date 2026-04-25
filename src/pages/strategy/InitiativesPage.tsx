import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Target, Search, Plus } from 'lucide-react'
import { listInitiatives } from '../../lib/strategyNotion'
import { useStrategyFetch } from '../../hooks/useStrategyFetch'
import type { Department, Initiative, InitiativeStatus } from '../../types/strategy'
import { InitiativeCard } from '../../components/strategy/InitiativeCard'
import { AddInitiativeForm } from '../../components/strategy/editors/AddInitiativeForm'
import { InitiativesTabs } from '../../components/strategy/InitiativesTabs'
import { PageEyebrow, PageTitle, PageSubtitle, StrategyShell } from '../../components/strategy/StrategyShell'
import {
  StrategyNotionSetupBanner,
  StrategyLoadingCard,
  StrategyEmptyCard,
} from '../../components/strategy/StrategyUI'

const DEPT_FILTERS: Array<{ value: Department | 'all'; label: string }> = [
  { value: 'all',      label: 'All' },
  { value: 'all-in',   label: 'All In' },
  { value: 'social',   label: 'Social' },
  { value: 'branding', label: 'Branding' },
  { value: 'web',      label: 'Web' },
]

const ACTIVE_STATUSES: InitiativeStatus[] = [
  'proposed', 'scoping', 'in-progress', 'testing', 'blocked', 'in-review',
]

export default function InitiativesPage() {
  const navigate = useNavigate()
  const { data, loading, setupError, error } = useStrategyFetch<Initiative[]>(
    () => listInitiatives(),
  )
  const [items, setItems] = useState<Initiative[]>([])
  useEffect(() => { setItems(data ?? []) }, [data])

  const [dept, setDept] = useState<Department | 'all'>('all')
  const [showArchived, setShowArchived] = useState(false)
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter(i => {
      if (dept !== 'all' && i.department !== dept) return false
      if (!showArchived && i.status && !ACTIVE_STATUSES.includes(i.status)) return false
      if (q && !i.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [items, dept, showArchived, query])

  return (
    <StrategyShell>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <PageEyebrow>Strategy</PageEyebrow>
          <PageTitle icon={<Target size={22} className="text-[var(--color-lib-accent)]" />}>
            Initiatives
          </PageTitle>
          <PageSubtitle>All major projects the Strategy Division is running after.</PageSubtitle>
        </div>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-lib-accent)] text-white text-sm font-medium px-4 py-2 hover:bg-[var(--color-lib-accent-hover)]"
        >
          <Plus size={14} />
          New initiative
        </button>
      </div>
      <InitiativesTabs />

      {adding && (
        <AddInitiativeForm
          onCreated={i => {
            setItems(prev => [i, ...prev])
            setAdding(false)
            navigate(`/strategy/initiatives/${i.id}`)
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {setupError && <StrategyNotionSetupBanner error={setupError} />}
      {error && !setupError && (
        <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          Couldn't load initiatives: {error}
        </div>
      )}

      {items.length > 0 && (
        <div className="flex flex-col md:flex-row md:items-center gap-3 mb-5">
          <div className="relative flex-1 max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-lib-text-subtle)]" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search initiatives…"
              className="w-full rounded-md border border-[var(--color-lib-border)] bg-[var(--color-lib-surface)] pl-9 pr-4 py-2 text-sm text-[var(--color-lib-text)] placeholder:text-[var(--color-lib-text-subtle)] outline-none focus:border-[var(--color-lib-accent)]"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {DEPT_FILTERS.map(d => (
              <button
                key={d.value}
                type="button"
                onClick={() => setDept(d.value)}
                className={[
                  'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                  dept === d.value
                    ? 'bg-[var(--color-lib-accent)] text-white'
                    : 'bg-[var(--color-lib-surface)] border border-[var(--color-lib-border)] text-[var(--color-lib-text)] hover:border-[var(--color-lib-border-strong)]',
                ].join(' ')}
              >
                {d.label}
              </button>
            ))}
            <label className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs text-[var(--color-lib-text)] bg-[var(--color-lib-surface)] border border-[var(--color-lib-border)] cursor-pointer">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={e => setShowArchived(e.target.checked)}
                className="accent-[var(--color-lib-accent)]"
              />
              Show archived
            </label>
          </div>
        </div>
      )}

      {loading && items.length === 0 && <StrategyLoadingCard label="Loading initiatives…" />}

      {!loading && filtered.length === 0 && (
        <StrategyEmptyCard>
          {items.length === 0
            ? 'No initiatives yet. Click "New initiative" to add one.'
            : 'No initiatives match your filters.'}
        </StrategyEmptyCard>
      )}

      {filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(i => <InitiativeCard key={i.id} initiative={i} />)}
        </div>
      )}
    </StrategyShell>
  )
}
