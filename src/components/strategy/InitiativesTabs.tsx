/**
 * Tab strip rendered at the top of every page in the Initiatives surface
 * (Initiatives list / Roadmap / Progress). Replaces the three separate
 * sidebar links — Initiatives is the single nav entry, Roadmap and
 * Progress are sub-views accessed via these tabs.
 */

import { NavLink } from 'react-router-dom'
import { Calendar, CheckSquare, ListChecks, Sparkles } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface Tab {
  to: string
  label: string
  icon: LucideIcon
}

const TABS: Tab[] = [
  { to: '/strategy/initiatives',  label: 'Initiatives',  icon: ListChecks },
  { to: '/strategy/action-items', label: 'Action Items', icon: CheckSquare },
  { to: '/strategy/roadmap',      label: 'Roadmap',      icon: Calendar },
  { to: '/strategy/progress',     label: 'Progress',     icon: Sparkles },
]

export function InitiativesTabs() {
  return (
    <div className="mb-5 border-b border-[var(--color-lib-border)] flex gap-1 overflow-x-auto">
      {TABS.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end
          className={({ isActive }) => [
            'inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors',
            isActive
              ? 'border-[var(--color-lib-accent)] text-[var(--color-lib-accent)]'
              : 'border-transparent text-[var(--color-lib-text-muted)] hover:text-[var(--color-lib-text)]',
          ].join(' ')}
        >
          <Icon size={14} />
          {label}
        </NavLink>
      ))}
    </div>
  )
}
