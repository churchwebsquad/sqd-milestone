/**
 * My Action Items — sibling tab on the Initiatives surface.
 *
 * Lists every Action Item assigned to the signed-in user across every
 * initiative they participate in, regardless of who owns the parent
 * initiative. Each row is a focused work surface:
 *
 *   - Status indicator (clickable → toggles complete ⇄ not-started)
 *   - Name (links to the Action Item detail page)
 *   - Target date (color-cued for urgency: overdue red, day-of blue,
 *     within 4 days yellow)
 *   - Parent initiative chip (links to the initiative detail)
 *   - Inline "Post update" → opens PostProgressForm pre-tagged with
 *     this Action Item, no nav round-trip
 *
 * Owner-resolution path mirrors the My Dashboard's "your initiatives"
 * filter: we resolve the caller's email → Notion user id via the
 * `my-dashboard-bundle` op, then filter milestones by `owner.id`.
 */

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle, ArrowRight, CheckCircle2, CheckSquare, ChevronRight,
  Circle, ExternalLink, Maximize2, Search, Send,
} from 'lucide-react'
import {
  getMyDashboardStrategy, isSetupError, listInitiatives, listMilestones,
  updateMilestone,
} from '../../lib/strategyNotion'
import type {
  Initiative, Milestone, MilestoneStatus, StrategyNotionSetupError,
} from '../../types/strategy'
import { InitiativesTabs } from '../../components/strategy/InitiativesTabs'
import {
  PageEyebrow, PageSubtitle, PageTitle, StrategyShell,
} from '../../components/strategy/StrategyShell'
import {
  StrategyEmptyCard, StrategyLoadingCard, StrategyNotionSetupBanner,
} from '../../components/strategy/StrategyUI'
import { PostProgressForm } from '../../components/strategy/editors/PostProgressForm'

type StatusFilter = 'open' | 'all' | 'complete'

export default function MyActionItemsPage() {
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [initiatives, setInitiatives] = useState<Initiative[]>([])
  const [notionUserId, setNotionUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [setupError, setSetupError] = useState<StrategyNotionSetupError | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setSetupError(null)
    Promise.allSettled([
      getMyDashboardStrategy(),
      listMilestones(),
      listInitiatives(),
    ]).then(results => {
      if (cancelled) return
      const [bundleR, milestonesR, initsR] = results
      // Bundle is the only thing that gives us the Notion user id; if it
      // 4xxs as setup-required, surface that — without the id we can't
      // filter to "my" items reliably.
      if (bundleR.status === 'rejected' && isSetupError(bundleR.reason)) {
        setSetupError(bundleR.reason as StrategyNotionSetupError)
        setLoading(false)
        return
      }
      if (bundleR.status === 'fulfilled') {
        setNotionUserId(bundleR.value.stats.notionUserId ?? null)
      }
      if (milestonesR.status === 'fulfilled') setMilestones(milestonesR.value)
      else if (milestonesR.status === 'rejected') {
        setError(milestonesR.reason instanceof Error ? milestonesR.reason.message : String(milestonesR.reason))
      }
      if (initsR.status === 'fulfilled') setInitiatives(initsR.value)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const initById = useMemo(() => {
    const m = new Map<string, Initiative>()
    for (const i of initiatives) m.set(i.id, i)
    return m
  }, [initiatives])

  const myItems = useMemo(() => {
    if (!notionUserId) return [] as Milestone[]
    const q = query.trim().toLowerCase()
    return milestones
      .filter(m => m.owner?.id === notionUserId)
      .filter(m => {
        if (statusFilter === 'open') return m.status !== 'complete' && m.status !== 'skipped'
        if (statusFilter === 'complete') return m.status === 'complete'
        return true
      })
      .filter(m => !q || m.name.toLowerCase().includes(q))
      .sort((a, b) => {
        // Active items first by target date asc (no-date last); within
        // each bucket, name as tiebreaker for stability.
        const ad = a.targetDate ?? '9999-12-31'
        const bd = b.targetDate ?? '9999-12-31'
        if (ad !== bd) return ad.localeCompare(bd)
        return a.name.localeCompare(b.name)
      })
  }, [milestones, notionUserId, statusFilter, query])

  // Counts — show on the filter pills so the user can size the work
  // without flipping between filters.
  const counts = useMemo(() => {
    if (!notionUserId) return { open: 0, all: 0, complete: 0 }
    const mine = milestones.filter(m => m.owner?.id === notionUserId)
    return {
      open: mine.filter(m => m.status !== 'complete' && m.status !== 'skipped').length,
      all: mine.length,
      complete: mine.filter(m => m.status === 'complete').length,
    }
  }, [milestones, notionUserId])

  const onItemUpdated = (next: Milestone) =>
    setMilestones(prev => prev.map(m => m.id === next.id ? next : m))

  return (
    <StrategyShell>
      <div className="mb-4">
        <PageEyebrow>Strategy</PageEyebrow>
        <PageTitle icon={<CheckSquare size={22} className="text-[var(--color-lib-accent)]" />}>
          My Action Items
        </PageTitle>
        <PageSubtitle>
          Everything assigned to you across every initiative. Open one, post an update, or jump to its parent initiative.
        </PageSubtitle>
      </div>
      <InitiativesTabs />

      {setupError && <StrategyNotionSetupBanner error={setupError} />}
      {error && !setupError && (
        <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800 mb-4">
          Couldn't load action items: {error}
        </div>
      )}

      {loading && <StrategyLoadingCard label="Loading action items…" />}

      {!loading && !setupError && !error && (
        <>
          {/* Filter row — search + status pills */}
          <div className="flex flex-col md:flex-row md:items-center gap-3 mb-4">
            <div className="relative flex-1 max-w-md">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-lib-text-subtle)]" />
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search action items…"
                className="w-full rounded-md border border-[var(--color-lib-border)] bg-[var(--color-lib-surface)] pl-9 pr-4 py-2 text-sm text-[var(--color-lib-text)] placeholder:text-[var(--color-lib-text-subtle)] outline-none focus:border-[var(--color-lib-accent)]"
              />
            </div>
            <div className="flex items-center gap-1.5 rounded-md bg-[var(--color-lib-bg)] border border-[var(--color-lib-border)] p-1">
              <FilterPill label="Open" count={counts.open} active={statusFilter === 'open'} onClick={() => setStatusFilter('open')} />
              <FilterPill label="All" count={counts.all} active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} />
              <FilterPill label="Complete" count={counts.complete} active={statusFilter === 'complete'} onClick={() => setStatusFilter('complete')} />
            </div>
          </div>

          {!notionUserId && (
            <div className="rounded-md border border-[#FDE68A] bg-[#FEF3C7] p-3 text-sm text-[var(--color-priority-medium)] mb-4">
              We couldn't match your email to a Notion user, so this list is empty. Ask an admin to verify your Notion workspace membership.
            </div>
          )}

          {notionUserId && myItems.length === 0 && (
            <StrategyEmptyCard>
              {statusFilter === 'open'
                ? "You're caught up — no open action items assigned to you."
                : statusFilter === 'complete'
                  ? "No completed action items yet."
                  : "No action items assigned to you."}
            </StrategyEmptyCard>
          )}

          {myItems.length > 0 && (
            <div className="rounded-md border border-[var(--color-lib-border)] bg-white overflow-hidden">
              {myItems.map((m, idx) => (
                <ActionItemRow
                  key={m.id}
                  item={m}
                  initiative={m.initiativeIds[0] ? initById.get(m.initiativeIds[0]) ?? null : null}
                  isLast={idx === myItems.length - 1}
                  onUpdated={onItemUpdated}
                />
              ))}
            </div>
          )}
        </>
      )}
    </StrategyShell>
  )
}

// ── Filter pill ──────────────────────────────────────────────────────────

function FilterPill({ label, count, active, onClick }: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap',
        active
          ? 'bg-white text-[var(--color-lib-accent)] shadow-sm border border-[var(--color-lib-border)]'
          : 'text-[var(--color-lib-text-muted)] hover:text-[var(--color-lib-text)]',
      ].join(' ')}
    >
      {label}
      <span className={[
        'rounded-full px-1.5 py-px text-[10px] font-semibold',
        active ? 'bg-[var(--color-lib-accent-soft)] text-[var(--color-lib-accent)]' : 'bg-[var(--color-lib-border)] text-[var(--color-lib-text-muted)]',
      ].join(' ')}>{count}</span>
    </button>
  )
}

// ── Row ──────────────────────────────────────────────────────────────────

function ActionItemRow({ item, initiative, isLast, onUpdated }: {
  item: Milestone
  initiative: Initiative | null
  isLast: boolean
  onUpdated: (next: Milestone) => void
}) {
  const [posting, setPosting] = useState(false)
  const [toggling, setToggling] = useState(false)

  const done = item.status === 'complete'
  const skipped = item.status === 'skipped'

  const toggleComplete = async () => {
    setToggling(true)
    try {
      const next: MilestoneStatus = item.status === 'complete' ? 'not-started' : 'complete'
      const updated = await updateMilestone(item.id, { status: next })
      onUpdated(updated)
    } finally {
      setToggling(false)
    }
  }

  const onPosted = () => {
    setPosting(false)
  }

  const urgency = computeUrgency(item.targetDate, item.status)

  return (
    <div className={['border-b border-[var(--color-lib-border)]', isLast ? 'border-b-0' : ''].join(' ')}>
      <div className="group flex items-center gap-3 px-4 py-3 hover:bg-[var(--color-lib-bg)]/40 transition-colors">
        {/* Status checkbox — same toggle behavior as MilestoneItem on the
            initiative detail. Clicking flips complete ⇄ not-started. */}
        <button
          type="button"
          onClick={toggleComplete}
          disabled={toggling}
          title={done ? 'Mark not started' : 'Mark complete'}
          className="shrink-0 disabled:opacity-50"
        >
          {done
            ? <CheckCircle2 size={16} className="text-[var(--color-status-launched)]" />
            : <Circle size={16} className="text-[var(--color-lib-text-subtle)] hover:text-[var(--color-lib-accent)] transition-colors" />}
        </button>

        <div className="flex-1 min-w-0">
          <Link
            to={`/strategy/action-items/${item.id}`}
            className={[
              'text-sm font-medium leading-snug hover:text-[var(--color-lib-accent)] transition-colors',
              done ? 'text-[var(--color-lib-text-muted)] line-through' : 'text-[var(--color-lib-text)]',
              skipped ? 'italic text-[var(--color-lib-text-subtle)]' : '',
            ].join(' ')}
          >
            {item.name}
          </Link>
          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-[var(--color-lib-text-muted)]">
            <StatusBadge status={item.status} />
            {initiative ? (
              <Link
                to={`/strategy/initiatives/${initiative.id}`}
                className="inline-flex items-center gap-1 text-[var(--color-lib-text-muted)] hover:text-[var(--color-lib-accent)]"
                title="Open parent initiative"
              >
                <span className="truncate max-w-[260px]">{initiative.name}</span>
                <ChevronRight size={10} />
              </Link>
            ) : item.initiativeIds.length === 0 ? (
              <span className="italic text-[var(--color-lib-text-subtle)]">No parent initiative</span>
            ) : null}
            {item.initiativeIds.length > 1 && (
              <span className="text-[10px] text-[var(--color-lib-text-subtle)]">
                +{item.initiativeIds.length - 1} more initiative{item.initiativeIds.length - 1 === 1 ? '' : 's'}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {item.targetDate && (
            <span
              className={[
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
                urgency.tone,
              ].join(' ')}
              title={urgency.tooltip}
            >
              {urgency.icon}
              {urgency.label}
            </span>
          )}
          <button
            type="button"
            onClick={() => setPosting(p => !p)}
            className={[
              'inline-flex items-center gap-1 rounded-md text-[11px] font-medium px-2.5 py-1 border',
              posting
                ? 'bg-[var(--color-lib-accent)] text-white border-[var(--color-lib-accent)]'
                : 'border-[var(--color-lib-border)] bg-white text-[var(--color-lib-text)] hover:border-[var(--color-lib-accent)] hover:text-[var(--color-lib-accent)]',
            ].join(' ')}
          >
            {posting ? <>Cancel</> : <><Send size={11} /> Post update</>}
          </button>
          {initiative && (
            <Link
              to={`/strategy/initiatives/${initiative.id}`}
              className="inline-flex items-center gap-1 text-[11px] text-[var(--color-lib-text-muted)] hover:text-[var(--color-lib-accent)] px-2 py-1"
              title="Open parent initiative"
            >
              Initiative
              <ArrowRight size={11} />
            </Link>
          )}
          <Link
            to={`/strategy/action-items/${item.id}`}
            className="text-[var(--color-lib-text-subtle)] hover:text-[var(--color-lib-accent)] transition-colors"
            title="Open action item"
          >
            <Maximize2 size={12} />
          </Link>
          <a
            href={item.notionUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--color-lib-text-subtle)] hover:text-[var(--color-lib-accent)] transition-colors"
            title="Open in Notion"
          >
            <ExternalLink size={12} />
          </a>
        </div>
      </div>

      {posting && initiative && (
        <div className="px-4 pb-4">
          <PostProgressForm
            initiativeId={initiative.id}
            presetActionItemId={item.id}
            onPosted={onPosted}
            onCancel={() => setPosting(false)}
          />
        </div>
      )}
      {posting && !initiative && (
        <div className="px-4 pb-3">
          <p className="text-[11px] italic text-[var(--color-lib-text-subtle)]">
            This action item isn't linked to an initiative yet — open the action item to attach one before posting an update.
          </p>
        </div>
      )}
    </div>
  )
}

// ── Status + urgency helpers ─────────────────────────────────────────────

function StatusBadge({ status }: { status: MilestoneStatus }) {
  // Soft background derived from the matching status hex; we don't have
  // dedicated *-soft tokens so each badge picks an explicit cream/amber
  // /red/green that pairs with the strong text color.
  const map: Record<MilestoneStatus, { label: string; tone: string }> = {
    'proposed':    { label: 'Proposed',    tone: 'bg-[#F5F5F4] text-[var(--color-status-proposed)]' },
    'not-started': { label: 'Not started', tone: 'bg-[var(--color-lib-bg)] text-[var(--color-lib-text-muted)]' },
    'in-progress': { label: 'In progress', tone: 'bg-[#FEF3C7] text-[var(--color-status-inprogress)]' },
    'blocked':     { label: 'Blocked',     tone: 'bg-[#FEE2E2] text-[var(--color-status-blocked)]' },
    'complete':    { label: 'Complete',    tone: 'bg-[var(--color-verif-verified-bg)] text-[var(--color-verif-verified-fg)]' },
    'skipped':     { label: 'Skipped',     tone: 'bg-[var(--color-lib-bg)] text-[var(--color-lib-text-subtle)] italic' },
  }
  const info = map[status]
  return (
    <span className={['inline-flex items-center rounded-sm px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider', info.tone].join(' ')}>
      {info.label}
    </span>
  )
}

interface UrgencyInfo {
  label: string
  tone: string
  icon: React.ReactNode
  tooltip: string
}

/** Compute a target-date pill style based on how far out the date is.
 *  Mirrors the dashboard's "Attention Needed" rules so a user sees the
 *  same color cue here and there. Completed items get a neutral tone
 *  even when overdue. */
function computeUrgency(targetDate: string | null, status: MilestoneStatus): UrgencyInfo {
  if (!targetDate || status === 'complete' || status === 'skipped') {
    return {
      label: targetDate ? formatShort(targetDate) : 'No date',
      tone: 'bg-[var(--color-lib-bg)] text-[var(--color-lib-text-muted)] border border-[var(--color-lib-border)]',
      icon: null,
      tooltip: targetDate ?? '',
    }
  }
  const diff = daysFromToday(targetDate)
  if (diff < 0) {
    return {
      label: `Overdue · ${formatShort(targetDate)}`,
      tone: 'bg-[#FEE2E2] text-[var(--color-priority-high)] border border-[var(--color-priority-high)]/40',
      icon: <AlertTriangle size={10} />,
      tooltip: `Target was ${targetDate} — ${Math.abs(diff)} day${Math.abs(diff) === 1 ? '' : 's'} overdue`,
    }
  }
  if (diff === 0) {
    return {
      label: `Due today`,
      tone: 'bg-[#DBEAFE] text-[#1D4ED8] border border-[#1D4ED8]/40',
      icon: <AlertTriangle size={10} />,
      tooltip: `Due today (${targetDate})`,
    }
  }
  if (diff <= 4) {
    return {
      label: `Due ${formatShort(targetDate)}`,
      tone: 'bg-[#FEF3C7] text-[var(--color-priority-medium)] border border-[var(--color-priority-medium)]/40',
      icon: <AlertTriangle size={10} />,
      tooltip: `Due in ${diff} day${diff === 1 ? '' : 's'} (${targetDate})`,
    }
  }
  return {
    label: `Due ${formatShort(targetDate)}`,
    tone: 'bg-[var(--color-lib-bg)] text-[var(--color-lib-text-muted)] border border-[var(--color-lib-border)]',
    icon: null,
    tooltip: `Due in ${diff} days (${targetDate})`,
  }
}

/** Return the day-difference between an ISO calendar date and *today*,
 *  computed in calendar terms rather than UTC. The `new Date('YYYY-MM-DD')`
 *  trap (UTC midnight rendering as the previous day west of UTC) bites
 *  here too — we split parts and rebuild via local Date. */
function daysFromToday(iso: string): number {
  const parts = iso.slice(0, 10).split('-').map(Number)
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return 9999
  const target = new Date(parts[0], parts[1] - 1, parts[2])
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  target.setHours(0, 0, 0, 0)
  const ms = target.getTime() - today.getTime()
  return Math.round(ms / (24 * 60 * 60 * 1000))
}

function formatShort(iso: string): string {
  const parts = iso.slice(0, 10).split('-').map(Number)
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return iso
  const d = new Date(parts[0], parts[1] - 1, parts[2])
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

