import { useMemo } from 'react'
import { Map as MapIcon } from 'lucide-react'
import { listInitiatives } from '../../lib/strategyNotion'
import { useStrategyFetch } from '../../hooks/useStrategyFetch'
import type { Department, Initiative } from '../../types/strategy'
import { RoadmapChip } from '../../components/strategy/RoadmapChip'
import { InitiativesTabs } from '../../components/strategy/InitiativesTabs'
import { PageEyebrow, PageTitle, PageSubtitle, StrategyShell } from '../../components/strategy/StrategyShell'
import {
  StrategyNotionSetupBanner,
  StrategyLoadingCard,
  StrategyEmptyCard,
  DepartmentBadge,
} from '../../components/strategy/StrategyUI'

const DEPT_ORDER: Department[] = ['all-in', 'social', 'branding', 'web']

export default function RoadmapPage() {
  const { data, loading, setupError, error } = useStrategyFetch<Initiative[]>(
    () => listInitiatives(),
  )

  const { quarters, grid } = useMemo(() => {
    const qSet = new Set<string>()
    const g = new Map<string, Initiative[]>() // key: `${dept}|${quarter}`
    for (const init of data ?? []) {
      const q = init.targetQuarter
      if (!q) continue
      qSet.add(q)
      const dept = init.department ?? 'all-in'
      const key = `${dept}|${q}`
      if (!g.has(key)) g.set(key, [])
      g.get(key)!.push(init)
    }
    const quarters = [...qSet].sort(compareQuarters)
    return { quarters, grid: g }
  }, [data])

  return (
    <StrategyShell>
      <div className="mb-4">
        <PageEyebrow>Strategy</PageEyebrow>
        <PageTitle icon={<MapIcon size={22} className="text-[var(--color-lib-accent)]" />}>
          Roadmap
        </PageTitle>
        <PageSubtitle>What's in flight, by department and quarter.</PageSubtitle>
      </div>
      <InitiativesTabs />

      {setupError && <StrategyNotionSetupBanner error={setupError} />}
      {error && !setupError && (
        <div className="rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          Couldn't load roadmap: {error}
        </div>
      )}
      {loading && !data && <StrategyLoadingCard label="Loading roadmap…" />}

      {data && quarters.length === 0 && (
        <StrategyEmptyCard>
          No initiatives have a Target Quarter set yet.
        </StrategyEmptyCard>
      )}

      {data && quarters.length > 0 && (
        <div className="rounded-md border border-[var(--color-lib-border)] bg-[var(--color-lib-surface)] p-4 overflow-x-auto">
          <div
            className="grid gap-2 min-w-[700px]"
            style={{
              gridTemplateColumns: `140px repeat(${quarters.length}, minmax(160px, 1fr))`,
            }}
          >
            <div />
            {quarters.map(q => (
              <div
                key={q}
                className="text-[11px] font-semibold text-[var(--color-lib-text-subtle)] uppercase tracking-widest pb-2 border-b border-[var(--color-lib-border)]"
              >
                {q}
              </div>
            ))}

            {DEPT_ORDER.map(dept => (
              <div key={dept} className="contents">
                <div className="flex items-center py-2 border-b border-[var(--color-lib-border)]">
                  <DepartmentBadge department={dept} />
                </div>
                {quarters.map(q => {
                  const items = grid.get(`${dept}|${q}`) ?? []
                  return (
                    <div
                      key={q}
                      className="py-2 border-b border-[var(--color-lib-border)] space-y-1.5"
                    >
                      {items.map(i => <RoadmapChip key={i.id} initiative={i} />)}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </StrategyShell>
  )
}

/** Sort quarters like "Q3 2026" chronologically. */
function compareQuarters(a: string, b: string): number {
  const pa = parseQuarter(a)
  const pb = parseQuarter(b)
  if (!pa && !pb) return a.localeCompare(b)
  if (!pa) return 1
  if (!pb) return -1
  if (pa.year !== pb.year) return pa.year - pb.year
  return pa.q - pb.q
}

function parseQuarter(s: string): { q: number; year: number } | null {
  const m = /Q(\d)\s*(\d{4})/i.exec(s)
  if (!m) return null
  return { q: Number(m[1]), year: Number(m[2]) }
}
