import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Star } from 'lucide-react'
import { useLibraryData } from '../../../components/library/LibraryDataContext'
import {
  LibraryNavBar, LibraryDrilldownHeader, DocTypeIcon, UnreadDot,
  DeptPill, PriorityFlag,
} from '../../../components/library/LibraryShell'
import { StrategyLoadingCard } from '../../../components/strategy/StrategyUI'
import type { DocHubEntry } from '../../../types/strategy'

/** Recent Updates — verified docs sorted by Last edited time desc. Each
 *  row gets a Mark Read button; the page shows a fill bar of the user's
 *  read progress through the list.
 *
 *  Required-reading filter: defaults to ON for all viewers — directors
 *  use the "Mark required" toggle on the doc detail page to curate which
 *  docs make the cut. Staff can opt to see "Everything" if they want a
 *  broader view, but the required-only default keeps the feed signal-rich. */
export default function LibraryRecentPage() {
  const { loading, docs, myReads, markRead, me, requiredReading } = useLibraryData()
  const [showAll, setShowAll] = useState(false)

  // Weekly cadence + dept gating: surface verified docs in the last 7
  // days, filtered to docs the viewer cares about. Staff and directors
  // see their own department + All-In docs (which are cross-dept). The VP
  // sees everything. The fixed window auto-resets weekly as new docs are
  // verified.
  const baseRecent = useMemo(() => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    return docs
      .filter(d => d.verificationStatus === 'verified')
      .filter(d => (d.lastEditedTime ?? '') >= sevenDaysAgo)
      .filter(d => {
        if (me.isVP) return true
        // Always include cross-dept (All-In) docs.
        if (d.department === 'all-in') return true
        // Otherwise, only include the viewer's own department.
        return me.department ? d.department === me.department : true
      })
      .sort((a, b) => (b.lastEditedTime ?? '').localeCompare(a.lastEditedTime ?? ''))
  }, [docs, me.isVP, me.department])

  const recent = useMemo(() => {
    if (showAll) return baseRecent
    return baseRecent.filter(d => requiredReading.has(d.id))
  }, [baseRecent, showAll, requiredReading])

  const hiddenCount = baseRecent.length - recent.length

  const readCount = recent.filter(d => myReads.has(d.id)).length
  const pct = recent.length ? Math.round((readCount / recent.length) * 100) : 0

  return (
    <>
      <LibraryNavBar
        crumbs={[
          { label: 'Library', to: '/strategy/library' },
          { label: 'Recent Updates' },
        ]}
      />
      <LibraryDrilldownHeader title="Recent Updates" />

      {loading && recent.length === 0 && <StrategyLoadingCard label="Loading recent updates…" />}

      <p className="text-sm text-[var(--color-lib-text-muted)] mb-3">
        Showing verified docs from the last 7 days. The list resets weekly as
        new updates flow in.
      </p>

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className={[
            'inline-flex items-center gap-1.5 rounded-full text-xs font-medium px-3 py-1 border',
            !showAll
              ? 'border-[#F59E0B] bg-[#FEF3C7] text-[var(--color-priority-medium)]'
              : 'border-[var(--color-lib-border)] bg-white text-[var(--color-lib-text-muted)] hover:border-[var(--color-lib-border-strong)]',
          ].join(' ')}
        >
          <Star size={11} className={!showAll ? 'fill-current' : ''} />
          Required only
        </button>
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className={[
            'inline-flex items-center gap-1.5 rounded-full text-xs font-medium px-3 py-1 border',
            showAll
              ? 'border-[var(--color-lib-accent)] bg-[var(--color-lib-accent-soft)] text-[var(--color-lib-accent)]'
              : 'border-[var(--color-lib-border)] bg-white text-[var(--color-lib-text-muted)] hover:border-[var(--color-lib-border-strong)]',
          ].join(' ')}
        >
          Everything ({baseRecent.length})
        </button>
        {!showAll && hiddenCount > 0 && (
          <span className="text-[11px] text-[var(--color-lib-text-subtle)]">
            {hiddenCount} non-required hidden
          </span>
        )}
      </div>

      {recent.length > 0 && (
        <div className="flex items-center gap-4 rounded-md border border-[var(--color-lib-border)] bg-[var(--color-lib-surface)] p-4 mb-5">
          <div className="flex-1 h-2 rounded-full bg-[var(--color-lib-border)] overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${pct}%`,
                background: 'linear-gradient(90deg, var(--color-lib-accent), #6D28D9)',
              }}
            />
          </div>
          <span className="text-sm font-semibold text-[var(--color-lib-accent)] whitespace-nowrap">
            {readCount} of {recent.length} read · {pct}%
          </span>
        </div>
      )}

      {/* All-caught-up state: no docs in the window at all OR every one
          read. Both should feel like a win, not an empty page. */}
      {!loading && (recent.length === 0 || readCount === recent.length) && (
        <div className="rounded-lg border border-[var(--color-verif-verified-fg)]/30 bg-[var(--color-verif-verified-bg)] px-6 py-8 text-center">
          <p className="text-2xl mb-2">✓</p>
          <p className="text-base font-semibold text-[var(--color-verif-verified-fg)] mb-1">
            You're all caught up
          </p>
          <p className="text-sm text-[var(--color-verif-verified-fg)]/85">
            {recent.length === 0 && !showAll && hiddenCount > 0
              ? `No required-reading updates in the last 7 days. Switch to Everything to see ${hiddenCount} non-required updates.`
              : recent.length === 0
                ? 'No verified docs published in the last 7 days. Check back next week.'
                : 'Every recent verified doc has been marked read.'}
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {recent.map(d => (
          <RecentRow
            key={d.id}
            doc={d}
            unread={!myReads.has(d.id)}
            isRequired={requiredReading.has(d.id)}
            onMarkRead={() => markRead(d.id).catch(() => {/* error already surfaced */})}
          />
        ))}
      </div>
    </>
  )
}

function RecentRow({ doc, unread, isRequired, onMarkRead }: {
  doc: DocHubEntry
  unread: boolean
  isRequired: boolean
  onMarkRead: () => void
}) {
  const [marking, setMarking] = useState(false)
  const handleMark = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setMarking(true)
    try { await onMarkRead() } finally { setMarking(false) }
  }
  return (
    <Link
      to={`/strategy/library/doc/${doc.id}`}
      className="grid grid-cols-[auto_1fr_auto_auto] gap-3 items-center rounded-r-md border border-[var(--color-lib-border)] border-l-[3px] border-l-[#3B82F6] bg-[var(--color-lib-surface)] px-4 py-3 hover:border-[var(--color-lib-border-strong)]"
    >
      <div className="w-8 h-8 rounded-sm bg-[#DBEAFE] text-[#1D4ED8] grid place-items-center shrink-0">
        <DocTypeIcon type={doc.types[0]} size={14} />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-[var(--color-lib-text)] flex items-center gap-2">
          <span className="truncate">{doc.title}</span>
          {unread && <UnreadDot />}
        </div>
        <div className="flex gap-2 items-center text-[11px] text-[var(--color-lib-text-muted)] mt-0.5 flex-wrap">
          <DeptPill dept={doc.department} />
          {doc.types[0] && <span>{doc.types[0]}</span>}
          {doc.priorityDoc && <PriorityFlag />}
          {isRequired && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#FEF3C7] border border-[#F59E0B]/40 px-1.5 py-px text-[10px] font-semibold text-[var(--color-priority-medium)]">
              <Star size={9} className="fill-current" />
              Required
            </span>
          )}
          {doc.verifiedBy?.name && <span>Verified by {doc.verifiedBy.name}</span>}
        </div>
      </div>
      <span className="text-[11px] text-[var(--color-lib-text-subtle)] tabular-nums whitespace-nowrap">
        {doc.lastEditedTime ? formatShort(doc.lastEditedTime) : ''}
      </span>
      {unread ? (
        <button
          type="button"
          onClick={handleMark}
          disabled={marking}
          className="rounded-sm border border-[#D8CCF4] bg-[var(--color-lib-accent-soft)] text-[var(--color-lib-accent)] text-[11px] font-medium px-2.5 py-1 hover:bg-[#E0D8F5] disabled:opacity-50"
        >
          {marking ? 'Marking…' : 'Mark read'}
        </button>
      ) : (
        <span className="rounded-sm border border-[var(--color-lib-border)] bg-[var(--color-lib-bg)] text-[var(--color-lib-text-subtle)] text-[11px] px-2.5 py-1">
          ✓ Read
        </span>
      )}
    </Link>
  )
}

function formatShort(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
