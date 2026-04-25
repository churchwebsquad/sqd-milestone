import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Plus, Settings, ChevronRight, FileCheck, Clock, ArrowRight, Send,
} from 'lucide-react'
import { useLibraryData } from '../../../components/library/LibraryDataContext'
import {
  LibraryNavBar, LibraryHero, DocTypeIcon, UnreadDot, DeptPill,
} from '../../../components/library/LibraryShell'
import { strategyDepartmentsLed } from '../../../lib/library'
import { StrategyNotionSetupBanner, StrategyLoadingCard } from '../../../components/strategy/StrategyUI'
import type { Department, DocHubEntry } from '../../../types/strategy'
import { AddDocModal } from './AddDocModal'
import { StaffAddDocFlyout } from './StaffAddDocFlyout'

interface CategoryDef {
  slug: string
  icon: string
  title: string
  desc: string
  /** Filter from a doc → does it belong to this category? */
  match: (d: DocHubEntry) => boolean
  /** Where clicking the card lands. */
  to: string
}

const CATEGORIES: CategoryDef[] = [
  {
    slug: 'start-here',
    icon: '★',
    title: 'Start Here',
    desc: 'Priority docs for new hires and squad orientation.',
    match: d => d.priorityDoc && d.workflowSteps.some(s => s.startsWith('Internal: Team Onboarding')),
    to: 'start-here',
  },
  {
    slug: 'process',
    icon: '⚙️',
    title: 'Process & Workflows',
    desc: 'SOPs and procedures organized by partner-journey milestone.',
    match: d => d.groups.includes('Process & Workflows'),
    to: 'process',
  },
  {
    slug: 'culture',
    icon: '👥',
    title: 'Culture & Policies',
    desc: 'How we work — squad culture, policies, and norms.',
    match: d => d.groups.includes('Culture & Policies'),
    to: 'category/culture',
  },
  {
    slug: 'resources',
    icon: '🧰',
    title: 'Resources & Tools',
    desc: 'Templates, references, and tools for daily work.',
    match: d => d.groups.includes('Resources & Tools'),
    to: 'category/resources',
  },
  {
    slug: 'products',
    icon: '📦',
    title: 'Product Overviews',
    desc: 'Documentation of our service offerings, organized by department.',
    match: d => d.types.includes('Primary Product Offering') || d.types.includes('Product Milestone'),
    to: 'products',
  },
]

export default function LibraryHomePage() {
  const { loading, setupError, error, me, docs, myReads, defaults, activeVerifier } = useLibraryData()
  const [adding, setAdding] = useState(false)
  const [suggesting, setSuggesting] = useState(false)

  // Director-tools data
  const allUnverified = useMemo(
    () => docs.filter(d => d.verificationStatus === 'needs-verification'),
    [docs],
  )
  const myQueue = useMemo(() => {
    if (me.isVP) return allUnverified
    if (!me.department) return []
    // Only include docs where the resolved active verifier is me.
    return allUnverified.filter(d => {
      if (!d.department) return false
      const v = activeVerifier(d.department)
      return v?.employeeId === me.employeeId
    })
  }, [allUnverified, me.department, me.employeeId, me.isVP, activeVerifier])

  const recentVerified = useMemo(() => {
    const list = docs
      .filter(d => d.verificationStatus === 'verified')
      .sort((a, b) => (b.lastEditedTime ?? '').localeCompare(a.lastEditedTime ?? ''))
    return list.slice(0, 4)
  }, [docs])
  const unreadRecentCount = useMemo(
    () => recentVerified.filter(d => !myReads.has(d.id)).length,
    [recentVerified, myReads],
  )

  if (loading && docs.length === 0) {
    return (
      <>
        <LibraryNavBar crumbs={[{ label: 'Library' }]} />
        <StrategyLoadingCard label="Loading the library…" />
      </>
    )
  }

  return (
    <>
      <LibraryNavBar crumbs={[{ label: 'Library' }]} />
      <LibraryHero
        title="What can we help you find?"
        subtitle="Search documents, SOPs, guides, and onboarding paths."
      />

      {setupError && <div className="mb-4"><StrategyNotionSetupBanner error={setupError} /></div>}
      {error && !setupError && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 mb-4">
          Couldn't load library: {error}
        </div>
      )}

      {/* Director tools (directors + VP) or "For you" (staff) */}
      {me.isDirector ? (
        <DirectorToolsBlock
          isVP={me.isVP}
          dept={me.department}
          queueCount={myQueue.length}
          queueDocs={myQueue.slice(0, 4)}
          recentDocs={recentVerified}
          unreadCount={unreadRecentCount}
          onAddDoc={() => setAdding(true)}
          onSuggestDoc={me.isVP ? () => setSuggesting(true) : undefined}
        />
      ) : (
        <StaffToolsBlock
          recentDocs={recentVerified}
          unreadCount={unreadRecentCount}
          unreadDocs={recentVerified.filter(d => !myReads.has(d.id)).slice(0, 4)}
          onAddDoc={() => setAdding(true)}
          onSuggestDoc={() => setSuggesting(true)}
        />
      )}

      {/* Category cards */}
      <div className="flex items-center justify-between mb-4 mt-2">
        <h2 className="text-base font-semibold tracking-tight text-[var(--color-lib-text)]">
          Documents
        </h2>
        <span className="text-xs text-[var(--color-lib-text-subtle)]">
          {docs.length} total
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {CATEGORIES.map(cat => {
          const count = docs.filter(cat.match).length
          return (
            <Link
              key={cat.slug}
              to={cat.to}
              className="grid grid-cols-[64px_1fr_auto_auto] gap-4 items-center rounded-lg border border-[var(--color-lib-border)] bg-[var(--color-lib-surface)] px-5 py-4 hover:border-[#C4B5EE] hover:translate-x-0.5 transition-all"
            >
              <div className="w-14 h-14 rounded-md bg-[var(--color-lib-accent-soft)] text-[var(--color-lib-accent)] grid place-items-center text-2xl">
                {cat.icon}
              </div>
              <div className="min-w-0">
                <div className="text-base font-semibold tracking-tight text-[var(--color-lib-text)]">
                  {cat.title}
                </div>
                <div className="text-sm text-[var(--color-lib-text-muted)]">
                  {cat.desc}
                </div>
              </div>
              <div className="text-sm text-[var(--color-lib-text-subtle)] font-medium whitespace-nowrap">
                {count} article{count !== 1 ? 's' : ''}
              </div>
              <ChevronRight size={18} className="text-[var(--color-lib-text-subtle)]" />
            </Link>
          )
        })}
      </div>

      {adding && (
        <StaffAddDocFlyout
          defaultDept={me.department}
          activeVerifier={activeVerifier}
          defaults={defaults}
          onClose={() => setAdding(false)}
        />
      )}
      {suggesting && (
        <AddDocModal
          mode="suggest"
          defaultDept={me.department}
          activeVerifier={activeVerifier}
          defaults={defaults}
          onCancel={() => setSuggesting(false)}
        />
      )}
    </>
  )
}

// ── Director tools (with preview lists) ──────────────────────────────────

function DirectorToolsBlock({
  isVP, dept, queueCount, queueDocs, recentDocs, unreadCount, onAddDoc, onSuggestDoc,
}: {
  isVP: boolean
  dept: Department | null
  queueCount: number
  queueDocs: DocHubEntry[]
  recentDocs: DocHubEntry[]
  unreadCount: number
  onAddDoc: () => void
  /** VP-only — opens the suggest-a-doc modal that drafts a placeholder
   *  with a yellow VP-note callout for the assigned director to fill in. */
  onSuggestDoc?: () => void
}) {
  return (
    <div className="rounded-lg border border-[var(--color-lib-border)] bg-[var(--color-lib-surface)] p-5 mb-6">
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-lib-accent)]">
          Director tools
        </p>
        <div className="flex items-center gap-3">
          <Link
            to="manager"
            className="inline-flex items-center gap-1 text-sm text-[var(--color-lib-accent)] font-medium hover:underline"
          >
            <Settings size={14} />
            Doc Manager
          </Link>
          {isVP && (
            <Link
              to="admin"
              className="inline-flex items-center gap-1 text-sm text-[var(--color-lib-text-muted)] hover:text-[var(--color-lib-accent)]"
            >
              Verification settings
            </Link>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <DirToolTile
          to="queue"
          icon={FileCheck}
          title="Needs verification"
          sub={isVP || !dept ? 'Across all departments' : `${labelDept(dept)} docs awaiting your review`}
          count={queueCount}
          alert={queueCount > 0}
          docs={queueDocs}
          emptyLabel="All caught up ✓"
        />
        <DirToolTile
          to="recent"
          icon={Clock}
          title="Recent updates"
          sub="Unread by you · last 4 verified"
          count={unreadCount}
          alert={false}
          docs={recentDocs}
          emptyLabel="You're all caught up ✓"
        />
      </div>
      <div className="mb-3">
        <SquadProgressPreview />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={onAddDoc}
          className="inline-flex items-center gap-2 rounded-md bg-[var(--color-lib-accent)] text-white text-sm font-medium px-4 py-2.5 hover:bg-[var(--color-lib-accent-hover)]"
        >
          <Plus size={14} />
          Add doc
        </button>
        {onSuggestDoc && (
          <button
            type="button"
            onClick={onSuggestDoc}
            className="inline-flex items-center gap-2 rounded-md border border-[#D8CCF4] bg-[var(--color-lib-accent-soft)] text-[var(--color-lib-accent)] text-sm font-medium px-4 py-2.5 hover:bg-[#E0D8F5]"
          >
            <Send size={14} />
            Suggest a doc
          </button>
        )}
      </div>
    </div>
  )
}

function StaffToolsBlock({
  recentDocs, unreadCount, unreadDocs, onAddDoc, onSuggestDoc,
}: {
  recentDocs: DocHubEntry[]
  unreadCount: number
  unreadDocs: DocHubEntry[]
  onAddDoc: () => void
  /** Optional — when present, shows a "Suggest a doc" CTA staff can use
   *  to ask a director to write something they spot a gap on. */
  onSuggestDoc?: () => void
}) {
  return (
    <div className="rounded-lg border border-[var(--color-lib-border)] bg-[var(--color-lib-surface)] p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-lib-accent)]">
          For you
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <DirToolTile
          to="recent"
          icon={Clock}
          title="Recent updates"
          sub={`${unreadCount} unread by you`}
          count={unreadCount}
          alert={false}
          docs={recentDocs}
          emptyLabel="You're all caught up ✓"
        />
        <DirToolTile
          to="recent"
          icon={ArrowRight}
          title="Needs your read"
          sub="Updated docs you haven't marked read"
          count={unreadDocs.length}
          alert={false}
          docs={unreadDocs}
          emptyLabel="Nothing new to read"
        />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={onAddDoc}
          className="inline-flex items-center gap-2 rounded-md bg-[var(--color-lib-accent)] text-white text-sm font-medium px-4 py-2.5 hover:bg-[var(--color-lib-accent-hover)]"
        >
          <Plus size={14} />
          Add doc
        </button>
        {onSuggestDoc && (
          <button
            type="button"
            onClick={onSuggestDoc}
            className="inline-flex items-center gap-2 rounded-md border border-[#D8CCF4] bg-[var(--color-lib-accent-soft)] text-[var(--color-lib-accent)] text-sm font-medium px-4 py-2.5 hover:bg-[#E0D8F5]"
          >
            <Send size={14} />
            Suggest a doc
          </button>
        )}
      </div>
    </div>
  )
}

function DirToolTile({
  to, icon: Icon, title, sub, count, alert, docs, emptyLabel = 'All clear ✓',
}: {
  to: string
  icon: typeof FileCheck
  title: string
  sub: string
  count: number
  alert: boolean
  docs: DocHubEntry[]
  emptyLabel?: string
}) {
  return (
    <Link
      to={to}
      className="block rounded-md p-4 border border-[#E0D8F5] hover:border-[#C4B5EE] hover:-translate-y-0.5 transition-all text-left"
      style={{ background: 'linear-gradient(135deg, #FAFAF7 0%, #F0EBFC 100%)' }}
    >
      <div className="flex items-start justify-between mb-3 gap-3">
        <div>
          <div className="text-sm font-semibold text-[var(--color-lib-text)] flex items-center gap-1.5">
            <Icon size={14} className="text-[var(--color-lib-accent)]" />
            {title}
          </div>
          <div className="text-[11px] text-[var(--color-lib-text-muted)]">{sub}</div>
        </div>
        <div className={`text-2xl font-semibold leading-none tracking-tight ${alert ? 'text-[var(--color-priority-high)]' : 'text-[var(--color-lib-text)]'}`}>
          {count}
        </div>
      </div>
      <div className="rounded-sm bg-white/70 p-2 flex flex-col gap-0.5 min-h-[100px]">
        {docs.length === 0 ? (
          <div className="p-3 text-center text-[11px] text-[var(--color-lib-text-subtle)]">
            {emptyLabel}
          </div>
        ) : (
          docs.map(d => (
            <div
              key={d.id}
              className="grid grid-cols-[16px_1fr_auto] gap-2 items-center px-2 py-1.5 rounded text-xs hover:bg-white"
            >
              <span className="text-[var(--color-lib-accent)]">
                <DocTypeIcon type={d.types[0]} size={14} />
              </span>
              <span className="font-medium text-[var(--color-lib-text)] truncate">
                {d.title}
                {!d.verificationStatus || d.verificationStatus === 'needs-verification' ? '' : ''}
              </span>
              <span className="flex items-center gap-1 shrink-0">
                <DeptPill dept={d.department} />
              </span>
            </div>
          ))
        )}
      </div>
      {docs.length > 0 && (
        <div className="text-[11px] text-[var(--color-lib-accent)] mt-2 font-medium text-right">
          View all →
        </div>
      )}
    </Link>
  )
}

function labelDept(d: Department): string {
  return { 'all-in': 'All In', social: 'Social', branding: 'Branding', web: 'Web' }[d]
}

/** Compact rollup of the squad's read-progress stats, with a CTA to the
 *  full Manage Squad surface in the Doc Manager. The full per-person
 *  table moved to the Doc Manager — this widget is the at-a-glance
 *  preview that lives on the Library home. */
function SquadProgressPreview() {
  const { me, defaults, docs, teamReads, requiredReading, onboardingAssignments } = useLibraryData()
  const ledDepts = useMemo(
    () => strategyDepartmentsLed(me.employeeId, defaults, me.isVP),
    [me.employeeId, me.isVP, defaults],
  )
  const requiredDocs = useMemo(
    () => docs.filter(d => requiredReading.has(d.id)),
    [docs, requiredReading],
  )

  if (ledDepts.length === 0) return null

  /** Aggregate stats across every squad the viewer leads. */
  const stats = (() => {
    let totalMembers = 0
    let totalRequiredRead = 0
    let totalRequiredCount = 0
    for (const _dept of ledDepts) {
      // For the preview: count team-read entries that fall in this dept.
      // We don't have per-dept staff counts inline, so count distinct
      // user_ids in teamReads as a proxy for active staff.
      for (const userId of teamReads.keys()) {
        const reads = teamReads.get(userId) ?? new Set<string>()
        // Use this user's reads to credit toward required reading count
        // for any required doc in their dept (we approximate by counting
        // reads of any required doc — directors look at the broader
        // surface in the Doc Manager for accurate per-person breakdown).
        totalRequiredRead += requiredDocs.filter(d => reads.has(d.id)).length
      }
      totalMembers += [...teamReads.keys()].length
      totalRequiredCount += requiredDocs.length * Math.max(1, totalMembers)
    }
    const requiredPct = totalRequiredCount > 0
      ? Math.round((totalRequiredRead / totalRequiredCount) * 100)
      : null
    return {
      members: totalMembers,
      requiredPct,
      requiredCount: requiredDocs.length,
      onboardingCount: onboardingAssignments.length,
    }
  })()

  return (
    <Link
      to="/strategy/library/manager?tab=squad"
      className="block rounded-md border border-[var(--color-lib-border)] bg-[var(--color-lib-surface)] p-4 hover:border-[var(--color-lib-border-strong)]"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <p className="text-sm font-semibold text-[var(--color-lib-text)]">
            Manage Squad
          </p>
          <p className="text-[11px] text-[var(--color-lib-text-subtle)]">
            Quick read-progress snapshot. Open the full per-person view in the Doc Manager.
          </p>
        </div>
        <span className="text-[11px] font-semibold text-[var(--color-lib-accent)] whitespace-nowrap">
          Open →
        </span>
      </div>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="rounded-sm bg-[var(--color-lib-bg)] py-2">
          <p className="text-lg font-bold text-[var(--color-lib-text)] tabular-nums">
            {stats.requiredPct === null ? '—' : `${stats.requiredPct}%`}
          </p>
          <p className="text-[10px] uppercase tracking-widest text-[var(--color-lib-text-subtle)]">
            Required read
          </p>
        </div>
        <div className="rounded-sm bg-[var(--color-lib-bg)] py-2">
          <p className="text-lg font-bold text-[var(--color-lib-text)] tabular-nums">
            {stats.requiredCount}
          </p>
          <p className="text-[10px] uppercase tracking-widest text-[var(--color-lib-text-subtle)]">
            Required docs
          </p>
        </div>
        <div className="rounded-sm bg-[var(--color-lib-bg)] py-2">
          <p className="text-lg font-bold text-[var(--color-lib-text)] tabular-nums">
            {stats.onboardingCount}
          </p>
          <p className="text-[10px] uppercase tracking-widest text-[var(--color-lib-text-subtle)]">
            Onboarding assignments
          </p>
        </div>
      </div>
    </Link>
  )
}

// Re-export so AddDocModal can be shared (lives in same dir)
export { UnreadDot }
