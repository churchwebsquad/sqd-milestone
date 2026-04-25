import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Search, ChevronRight } from 'lucide-react'
import { useLibraryData } from '../../../components/library/LibraryDataContext'
import {
  LibraryNavBar, LibraryDrilldownHeader, DocTypeIcon, UnreadDot,
  DeptPill, VerifBadge, PriorityFlag,
} from '../../../components/library/LibraryShell'
import { StrategyEmptyCard, StrategyLoadingCard } from '../../../components/strategy/StrategyUI'
import type { DocHubEntry } from '../../../types/strategy'

/** Library search results page. Both search inputs (the hero on the home
 *  page and the breadcrumb-bar input) navigate here with `?q=...`.
 *  Matching is title-first, then a contains-search across types, groups,
 *  workflow steps, and verifier name. Live as you type. */
export default function LibrarySearchPage() {
  const { loading, docs, myReads } = useLibraryData()
  const [params, setParams] = useSearchParams()
  const initialQ = params.get('q') ?? ''
  const [query, setQuery] = useState(initialQ)

  // Keep `?q=` in the URL in sync with the input — debounced lightly so
  // we don't spam history.
  useEffect(() => {
    const handle = setTimeout(() => {
      const next = new URLSearchParams(params)
      if (query) next.set('q', query)
      else next.delete('q')
      setParams(next, { replace: true })
    }, 200)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const results = useMemo(() => match(docs, query), [docs, query])

  return (
    <>
      <LibraryNavBar
        crumbs={[
          { label: 'Library', to: '/strategy/library' },
          { label: 'Search' },
        ]}
        searchQuery={query}
        onSearchChange={setQuery}
      />
      <LibraryDrilldownHeader title={query ? `Results for "${query}"` : 'Search the library'} />

      {/* The big search input lives on the page itself in addition to the
          smaller one in the nav bar — gives focus on the search task. */}
      <div className="flex items-center gap-3 rounded-md border border-[var(--color-lib-border)] bg-[var(--color-lib-surface)] px-4 py-3 mb-5 focus-within:border-[var(--color-lib-accent)]">
        <Search size={18} className="text-[var(--color-lib-text-subtle)]" />
        <input
          type="text"
          autoFocus
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search by title, type, department, workflow step…"
          className="flex-1 bg-transparent text-base outline-none text-[var(--color-lib-text)] placeholder:text-[var(--color-lib-text-subtle)]"
        />
      </div>

      {loading && docs.length === 0 && <StrategyLoadingCard label="Loading library…" />}

      {!loading && !query && (
        <StrategyEmptyCard>
          Type to search across {docs.length} document{docs.length !== 1 ? 's' : ''}.
        </StrategyEmptyCard>
      )}

      {!loading && query && results.length === 0 && (
        <StrategyEmptyCard>
          No matches for "{query}".
        </StrategyEmptyCard>
      )}

      {results.length > 0 && (
        <>
          <p className="text-sm text-[var(--color-lib-text-muted)] mb-3">
            {results.length} match{results.length !== 1 ? 'es' : ''}
          </p>
          <div className="flex flex-col gap-1.5">
            {results.map(d => (
              <Link
                key={d.id}
                to={`/strategy/library/doc/${d.id}`}
                className="grid grid-cols-[auto_1fr_auto_auto] gap-3 items-center rounded-md border border-[var(--color-lib-border)] bg-[var(--color-lib-surface)] px-4 py-3 hover:border-[var(--color-lib-border-strong)]"
              >
                <div className="w-8 h-8 rounded-sm bg-[var(--color-lib-accent-soft)] text-[var(--color-lib-accent)] grid place-items-center shrink-0">
                  <DocTypeIcon type={d.types[0]} size={14} />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[var(--color-lib-text)] flex items-center gap-2">
                    <span className="truncate">{d.title}</span>
                    {!myReads.has(d.id) && <UnreadDot />}
                  </div>
                  <div className="flex gap-2 items-center text-[11px] text-[var(--color-lib-text-muted)] mt-0.5 flex-wrap">
                    <DeptPill dept={d.department} />
                    {d.types[0] && <span>{d.types[0]}</span>}
                    {d.priorityDoc && <PriorityFlag />}
                    {d.workflowSteps[0] && <span>· {d.workflowSteps[0]}</span>}
                    {d.groups[0] && <span>· {d.groups[0]}</span>}
                  </div>
                </div>
                <VerifBadge status={d.verificationStatus} />
                <ChevronRight size={14} className="text-[var(--color-lib-text-subtle)]" />
              </Link>
            ))}
          </div>
        </>
      )}
    </>
  )
}

function match(docs: DocHubEntry[], query: string): DocHubEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const tokens = q.split(/\s+/).filter(Boolean)
  return docs
    .map(d => ({ doc: d, score: scoreDoc(d, tokens) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(x => x.doc)
}

function scoreDoc(d: DocHubEntry, tokens: string[]): number {
  const title = d.title.toLowerCase()
  const haystack = [
    title,
    d.department ?? '',
    ...d.groups,
    ...d.types,
    ...d.workflowSteps,
    d.verifiedBy?.name ?? '',
  ].join(' ').toLowerCase()
  let score = 0
  for (const t of tokens) {
    if (title.includes(t)) score += 4
    else if (haystack.includes(t)) score += 1
    else return 0  // every token must match somewhere
  }
  return score
}
