import { useEffect, useMemo, useState } from 'react'
import { Activity, Plus } from 'lucide-react'
import { listInitiatives, listProgress } from '../../lib/strategyNotion'
import { useStrategyFetch } from '../../hooks/useStrategyFetch'
import { useLinkedDocsByProgressIds } from '../../hooks/useLinkedDocsByProgressIds'
import type { Department, FeedItem, Initiative, ProgressEntry, ProgressFeedEntry } from '../../types/strategy'
import { ProgressEntryItem } from '../../components/strategy/ProgressEntryItem'
import { MilestoneEventItem } from '../../components/strategy/MilestoneEventItem'
import { PostProgressForm } from '../../components/strategy/editors/PostProgressForm'
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

export default function ProgressPage() {
  const { data, loading, setupError, error } = useStrategyFetch<FeedItem[]>(
    () => listProgress({ limit: 60 }),
  )
  const [items, setItems] = useState<FeedItem[]>([])
  useEffect(() => { setItems(data ?? []) }, [data])

  const [dept, setDept] = useState<Department | 'all'>('all')
  const [posting, setPosting] = useState(false)
  const [initiatives, setInitiatives] = useState<Initiative[] | null>(null)
  const [chosenInitiative, setChosenInitiative] = useState<string>('')

  // Load initiatives on demand for the New Update affordance.
  useEffect(() => {
    if (!posting || initiatives !== null) return
    listInitiatives().then(setInitiatives).catch(() => setInitiatives([]))
  }, [posting, initiatives])

  const filtered = useMemo(() => {
    if (dept === 'all') return items
    return items.filter(i => i.department === dept)
  }, [items, dept])

  // Bulk-fetch linked Library docs for the visible feed so each
  // ProgressEntryItem can render its "Read the docs" row.
  const progressIdsForLinkedDocs = useMemo(
    () => filtered.filter(f => f.kind === 'progress-entry').map(f => f.id),
    [filtered],
  )
  const linkedDocsByProgressId = useLinkedDocsByProgressIds(progressIdsForLinkedDocs)

  const onPosted = (entry: ProgressEntry) => {
    const feedItem: ProgressFeedEntry = { ...entry, kind: 'progress-entry' }
    setItems(prev => [feedItem, ...prev])
    setPosting(false)
    setChosenInitiative('')
  }

  const onUpdated = (entry: ProgressEntry) => {
    const feedItem: ProgressFeedEntry = { ...entry, kind: 'progress-entry' }
    setItems(prev => prev.map(i => i.id === entry.id ? feedItem : i))
  }

  const onArchived = (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id))
  }

  return (
    <StrategyShell>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <PageEyebrow>Strategy</PageEyebrow>
          <PageTitle icon={<Activity size={22} className="text-[var(--color-lib-accent)]" />}>
            Progress
          </PageTitle>
          <PageSubtitle>
            Cross-initiative updates and Action Item completions, newest first.
          </PageSubtitle>
        </div>
        <button
          type="button"
          onClick={() => setPosting(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-lib-accent)] text-white text-sm font-medium px-4 py-2 hover:bg-[var(--color-lib-accent-hover)]"
        >
          <Plus size={14} />
          New update
        </button>
      </div>
      <InitiativesTabs />

      {setupError && <StrategyNotionSetupBanner error={setupError} />}
      {error && !setupError && (
        <div className="rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          Couldn't load progress feed: {error}
        </div>
      )}

      {posting && (
        <div className="mb-5 space-y-3">
          <div>
            <label className="text-[10px] font-bold text-purple-gray uppercase tracking-widest">
              Initiative
            </label>
            <select
              value={chosenInitiative}
              onChange={e => setChosenInitiative(e.target.value)}
              autoFocus
              className="mt-1 w-full rounded border border-lavender bg-white px-3 py-2 text-sm text-deep-plum"
            >
              <option value="">— Pick an initiative —</option>
              {(initiatives ?? []).map(i => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </select>
          </div>
          {chosenInitiative && (() => {
            const picked = (initiatives ?? []).find(i => i.id === chosenInitiative)
            return (
              <PostProgressForm
                initiativeId={chosenInitiative}
                initiativeName={picked?.name}
                initiativeDepartment={picked?.department ?? null}
                onPosted={onPosted}
                onCancel={() => { setPosting(false); setChosenInitiative('') }}
              />
            )
          })()}
          {!chosenInitiative && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setPosting(false)}
                className="rounded-full border border-lavender bg-white text-xs text-deep-plum px-3 py-1.5 hover:bg-lavender-tint"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
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
        </div>
      )}

      {loading && items.length === 0 && <StrategyLoadingCard label="Loading progress feed…" />}

      {!loading && filtered.length === 0 && (
        <StrategyEmptyCard>
          {items.length === 0
            ? 'No progress posted yet. Click "New update" to add one.'
            : 'No updates match this department filter.'}
        </StrategyEmptyCard>
      )}

      {filtered.length > 0 && (
        <div className="rounded-md border border-[var(--color-lib-border)] bg-[var(--color-lib-surface)] px-5">
          {filtered.map(item =>
            item.kind === 'progress-entry'
              ? <ProgressEntryItem
                  key={item.id}
                  entry={item}
                  linkedDocs={linkedDocsByProgressId.get(item.id)}
                  onUpdated={onUpdated}
                  onArchived={onArchived}
                />
              : <MilestoneEventItem key={item.id} event={item} />
          )}
        </div>
      )}
    </StrategyShell>
  )
}
