import { useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { useLibraryData } from '../../../components/library/LibraryDataContext'
import {
  LibraryNavBar, LibraryDrilldownHeader, DocTypeIcon, UnreadDot,
  DeptPill, VerifBadge, PriorityFlag,
} from '../../../components/library/LibraryShell'
import { DeptFilterChips } from '../../../components/library/DeptFilterChips'
import { StrategyLoadingCard, StrategyEmptyCard } from '../../../components/strategy/StrategyUI'
import type { Department, DocHubEntry } from '../../../types/strategy'

const SLUG_TO_FILTER: Record<string, { label: string; match: (d: DocHubEntry) => boolean }> = {
  culture: {
    label: 'Culture & Policies',
    match: d => d.groups.includes('Culture & Policies'),
  },
  resources: {
    label: 'Resources & Tools',
    match: d => d.groups.includes('Resources & Tools'),
  },
  products: {
    label: 'Product Overviews',
    match: d => d.types.includes('Primary Product Offering') || d.types.includes('Product Milestone'),
  },
  strategy: {
    label: 'Strategy & Planning',
    match: d => d.groups.includes('Strategy & Planning'),
  },
}

/** Generic category drilldown — Culture & Policies, Resources & Tools,
 *  Product Overviews, Strategy & Planning. Process & Workflows uses its
 *  own drilldown (LibraryProcessPage). */
export default function LibraryCategoryPage() {
  const { slug } = useParams<{ slug: string }>()
  const { loading, docs, myReads, me } = useLibraryData()
  const [deptFilter, setDeptFilter] = useState<Department | 'all'>(me.department ?? 'all')

  const cat = slug ? SLUG_TO_FILTER[slug] : undefined
  const filtered = useMemo(() => {
    if (!cat) return []
    return docs.filter(d => {
      if (!cat.match(d)) return false
      if (deptFilter !== 'all' && d.department !== deptFilter) return false
      return true
    })
  }, [docs, cat, deptFilter])

  // For Culture & Policies and Resources & Tools, surface trusted (verified)
  // docs first and push docs that still need review to a separate section
  // below — readers shouldn't be relying on un-verified policy guidance.
  const needsReviewSplit = slug === 'culture' || slug === 'resources'
  const verifiedDocs = useMemo(
    () => needsReviewSplit
      ? filtered.filter(d => d.verificationStatus === 'verified')
      : filtered,
    [filtered, needsReviewSplit],
  )
  const reviewDocs = useMemo(
    () => needsReviewSplit
      ? filtered.filter(d => d.verificationStatus !== 'verified')
      : [],
    [filtered, needsReviewSplit],
  )

  if (!cat) {
    return (
      <>
        <LibraryNavBar crumbs={[{ label: 'Library', to: '/strategy/library' }, { label: 'Unknown category' }]} />
        <StrategyEmptyCard>Unknown category. Head back to the Library.</StrategyEmptyCard>
      </>
    )
  }

  return (
    <>
      <LibraryNavBar
        crumbs={[
          { label: 'Library', to: '/strategy/library' },
          { label: cat.label },
        ]}
      />
      <LibraryDrilldownHeader title={cat.label} />

      <DeptFilterChips value={deptFilter} onChange={setDeptFilter} />

      <p className="text-sm text-[var(--color-lib-text-muted)] mb-4">
        {filtered.length} document{filtered.length !== 1 ? 's' : ''}.
      </p>

      {loading && filtered.length === 0 && <StrategyLoadingCard label="Loading…" />}

      {!loading && filtered.length === 0 && (
        <StrategyEmptyCard>
          No docs in {cat.label} yet. Add one in Notion or via the "Add doc" button on the Library home.
        </StrategyEmptyCard>
      )}

      <div className="flex flex-col gap-1.5">
        {verifiedDocs.map(d => <DocRow key={d.id} doc={d} unread={!myReads.has(d.id)} />)}
      </div>

      {reviewDocs.length > 0 && (
        <>
          <div className="my-6 flex items-center gap-3">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-lib-text-subtle)]">
              Awaiting verification
            </span>
            <span className="flex-1 h-px bg-[var(--color-lib-border)]" />
            <span className="text-[11px] text-[var(--color-lib-text-subtle)]">
              {reviewDocs.length}
            </span>
          </div>
          <p className="text-xs text-[var(--color-lib-text-muted)] mb-3 italic">
            These docs haven't been signed off yet — treat as drafts until a director verifies them.
          </p>
          <div className="flex flex-col gap-1.5">
            {reviewDocs.map(d => <DocRow key={d.id} doc={d} unread={!myReads.has(d.id)} />)}
          </div>
        </>
      )}
    </>
  )
}

function DocRow({ doc: d, unread }: { doc: DocHubEntry; unread: boolean }) {
  return (
    <Link
      to={`/strategy/library/doc/${d.id}`}
      className="grid grid-cols-[auto_1fr_auto_auto] gap-3 items-center rounded-md border border-[var(--color-lib-border)] bg-[var(--color-lib-surface)] px-4 py-3 hover:border-[var(--color-lib-border-strong)]"
    >
      <div className="w-8 h-8 rounded-sm bg-[var(--color-lib-accent-soft)] text-[var(--color-lib-accent)] grid place-items-center shrink-0">
        <DocTypeIcon type={d.types[0]} size={14} />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-[var(--color-lib-text)] flex items-center gap-2">
          <span className="truncate">{d.title}</span>
          {unread && <UnreadDot />}
        </div>
        <div className="flex gap-2 items-center text-[11px] text-[var(--color-lib-text-muted)] mt-0.5 flex-wrap">
          <DeptPill dept={d.department} />
          {d.types[0] && <span>{d.types[0]}</span>}
          {d.priorityDoc && <PriorityFlag />}
          {d.verifiedOn && <span>Verified · {formatShort(d.verifiedOn)}</span>}
        </div>
      </div>
      <VerifBadge status={d.verificationStatus} />
      <ChevronRight size={14} className="text-[var(--color-lib-text-subtle)]" />
    </Link>
  )
}

function formatShort(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
