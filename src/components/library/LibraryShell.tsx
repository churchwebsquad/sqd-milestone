/**
 * Shared Library shell pieces: persistent breadcrumb nav bar, hero search
 * panel, type-icon helpers, verification badges, doc-row layouts.
 *
 * The Library uses a different design system than the rest of the app
 * (warm off-white, borders-not-shadows, editorial typography). All Library
 * surfaces should pull primitives from here so the look stays consistent
 * even as we add views.
 */

import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Search, FileText, BookOpen, LayoutGrid, GraduationCap,
  ChevronRight, ChevronLeft, RefreshCw,
} from 'lucide-react'
import type { Department, VerificationStatus } from '../../types/strategy'
import { useLibraryData } from './LibraryDataContext'

export const LIB_BG = 'bg-[var(--color-lib-bg)]'
export const LIB_SURFACE = 'bg-[var(--color-lib-surface)]'
export const LIB_BORDER = 'border-[var(--color-lib-border)]'
export const LIB_TEXT = 'text-[var(--color-lib-text)]'
export const LIB_TEXT_MUTED = 'text-[var(--color-lib-text-muted)]'
export const LIB_TEXT_SUBTLE = 'text-[var(--color-lib-text-subtle)]'
export const LIB_ACCENT = 'text-[var(--color-lib-accent)]'

// ── Breadcrumb / nav bar ──────────────────────────────────────────────────

export interface LibraryCrumb {
  label: string
  to?: string
}

/** Persistent breadcrumb + search + refresh button that sits at the top
 *  of every Library page. Clicks on an inactive crumb navigate; the last
 *  crumb is rendered as plain text. The Refresh button (and window-focus
 *  re-fetch) keep Notion-edited content in sync without webhooks.
 *
 *  Search behavior: typing-then-Enter (or pressing the search icon)
 *  navigates to `/strategy/library/search?q=...`. The search-results page
 *  takes over from there with a full-width input + live filtering. When
 *  this nav bar is rendered *on* the search page, the parent passes
 *  `searchQuery + onSearchChange` to keep the box in lockstep. */
export function LibraryNavBar({ crumbs, searchQuery, onSearchChange }: {
  crumbs: LibraryCrumb[]
  searchQuery?: string
  onSearchChange?: (q: string) => void
}) {
  const { refresh, refreshing } = useLibraryData()
  const navigate = useNavigate()
  const [localQuery, setLocalQuery] = useState('')
  const value = searchQuery !== undefined ? searchQuery : localQuery
  const setValue = (v: string) => {
    if (onSearchChange) onSearchChange(v)
    else setLocalQuery(v)
  }
  const submit = () => {
    if (!value.trim()) return
    navigate(`/strategy/library/search?q=${encodeURIComponent(value.trim())}`)
  }
  return (
    <div className="flex items-center gap-3 px-4 py-3 mb-4 rounded-md border border-[var(--color-lib-border)] bg-[var(--color-lib-surface)] sticky top-0 z-10">
      <div className="flex items-center gap-1.5 flex-1 min-w-0 flex-wrap text-sm">
        {crumbs.map((c, i) => {
          const isLast = i === crumbs.length - 1
          return (
            <span key={i} className="inline-flex items-center gap-1.5">
              {i > 0 && (
                <span className="text-[var(--color-lib-text-subtle)] text-[11px]">›</span>
              )}
              {isLast || !c.to ? (
                <span className="px-2 py-1 font-semibold text-[var(--color-lib-text)] whitespace-nowrap">
                  {c.label}
                </span>
              ) : (
                <Link
                  to={c.to}
                  className="px-2 py-1 rounded text-[var(--color-lib-text-muted)] hover:bg-[var(--color-lib-bg)] hover:text-[var(--color-lib-text)] font-medium whitespace-nowrap"
                >
                  {c.label}
                </Link>
              )}
            </span>
          )
        })}
      </div>
      <button
        type="button"
        onClick={() => void refresh()}
        disabled={refreshing}
        title={refreshing ? 'Refreshing…' : 'Pull fresh Notion data'}
        className="p-1.5 rounded-sm text-[var(--color-lib-text-subtle)] hover:text-[var(--color-lib-text)] hover:bg-[var(--color-lib-bg)] disabled:opacity-50"
      >
        <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
      </button>
      <form
        onSubmit={e => { e.preventDefault(); submit() }}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-[var(--color-lib-border)] bg-[var(--color-lib-bg)] w-72 max-w-[40%] shrink-0 focus-within:border-[var(--color-lib-accent)]"
      >
        <button type="submit" className="text-[var(--color-lib-text-subtle)] hover:text-[var(--color-lib-text)]" aria-label="Search">
          <Search size={14} />
        </button>
        <input
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder="Search docs…"
          className="flex-1 bg-transparent text-sm outline-none text-[var(--color-lib-text)] placeholder:text-[var(--color-lib-text-subtle)]"
        />
      </form>
    </div>
  )
}

// ── Hero search panel (home + start-here) ─────────────────────────────────

export function LibraryHero({ title, subtitle }: { title: string; subtitle: string }) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (q.trim()) navigate(`/strategy/library/search?q=${encodeURIComponent(q.trim())}`)
  }
  return (
    <div
      className="rounded-lg px-6 py-12 mb-6 text-center text-white"
      style={{ background: 'linear-gradient(135deg, #2D1159 0%, #4F2BAB 100%)' }}
    >
      <h1 className="text-2xl font-semibold tracking-tight mb-3">{title}</h1>
      <p className="text-base opacity-80 mb-5">{subtitle}</p>
      <form
        onSubmit={submit}
        className="flex items-center gap-3 max-w-2xl mx-auto rounded-md px-4 py-3 bg-white/95 shadow-lg"
      >
        <button type="submit" className="text-[#2D1159] shrink-0" aria-label="Search">
          <Search size={18} />
        </button>
        <input
          type="text"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search by title, keyword, or content…"
          className="flex-1 bg-transparent text-base outline-none text-[var(--color-lib-text)] placeholder:text-[var(--color-lib-text-subtle)]"
        />
      </form>
    </div>
  )
}

// ── Drilldown header (back link + title bar) ──────────────────────────────

export function LibraryDrilldownHeader({ title, subtitle, backTo, actions }: {
  title: ReactNode
  subtitle?: ReactNode
  backTo?: string
  actions?: ReactNode
}) {
  return (
    <div className="mb-5">
      {backTo && (
        <Link
          to={backTo}
          className="inline-flex items-center gap-1 text-sm text-[var(--color-lib-text-muted)] hover:text-[var(--color-lib-text)] mb-3 px-2 py-1 -ml-2 rounded hover:bg-[var(--color-lib-surface)]"
        >
          <ChevronLeft size={14} />
          Back
        </Link>
      )}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-lib-text)]">
            {title}
          </h1>
          {subtitle && (
            <p className="text-sm text-[var(--color-lib-text-muted)] mt-0.5">{subtitle}</p>
          )}
        </div>
        {actions && <div className="flex gap-2">{actions}</div>}
      </div>
    </div>
  )
}

// ── Department badge (pill) ───────────────────────────────────────────────

const DEPT_LABEL: Record<Department, string> = {
  'all-in':   'All In',
  social:     'Social',
  branding:   'Branding',
  web:        'Web',
}

export function DeptPill({ dept }: { dept: Department | null }) {
  if (!dept) return null
  return (
    <span className={`inline-flex items-center rounded-sm px-2 py-0.5 text-[11px] font-medium bg-dept-${dept}-soft text-dept-${dept}`}>
      {DEPT_LABEL[dept]}
    </span>
  )
}

// ── Verification badge ────────────────────────────────────────────────────

export function VerifBadge({ status }: { status: VerificationStatus | null }) {
  if (status === 'verified') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium bg-[var(--color-verif-verified-bg)] text-[var(--color-verif-verified-fg)]">
        <span>✓</span>
        Verified
      </span>
    )
  }
  if (status === 'in-progress') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium bg-[var(--color-verif-progress-bg)] text-[var(--color-verif-progress-fg)]">
        In progress
      </span>
    )
  }
  if (status === 'outdated') {
    // Distinct from `Needs review` — this is "was good, now broken" so
    // the visual reads urgent. Red rather than the amber Needs-review
    // badge, with the warning icon.
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium bg-[#FEE2E2] text-[var(--color-priority-high)]">
        <span>⚠</span>
        Outdated
      </span>
    )
  }
  // needs-verification or null
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium bg-[var(--color-verif-needs-bg)] text-[var(--color-verif-needs-fg)]">
      <span>⏱</span>
      Needs review
    </span>
  )
}

/** Pill rendered when `doc.priorityDoc === true`. The data field name in
 *  Notion is "Priority Doc" but the in-app meaning is "this is part of the
 *  onboarding / Start Here flow" — so the label says "Onboarding" and the
 *  visual cue is the same purple as the rest of the Library accent system.
 *
 *  Old name `PriorityFlag` re-exported for legacy import compatibility —
 *  callers can switch over the next pass. */
export function OnboardingPill() {
  return (
    <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-[var(--color-lib-accent-soft)] text-[var(--color-lib-accent)]">
      ★ Onboarding
    </span>
  )
}

export const PriorityFlag = OnboardingPill

export function UnreadDot() {
  return (
    <span
      className="inline-block w-2 h-2 rounded-full bg-[var(--color-lib-accent)] align-middle"
      title="Unread by you"
      aria-label="Unread"
    />
  )
}

// ── Document type icon ────────────────────────────────────────────────────

export function DocTypeIcon({ type, size = 16 }: { type: string | undefined; size?: number }) {
  if (!type) return <FileText size={size} />
  const lc = type.toLowerCase()
  if (lc.includes('sop'))      return <FileText size={size} />
  if (lc.includes('guide'))    return <BookOpen size={size} />
  if (lc.includes('template')) return <LayoutGrid size={size} />
  if (lc.includes('onboard'))  return <GraduationCap size={size} />
  return <FileText size={size} />
}

export { ChevronRight }
