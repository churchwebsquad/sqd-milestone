/**
 * Department filter chip row — shown on Library drilldowns (Process &
 * Workflows, generic categories) so users can scope to a single squad's
 * docs or see everyone's. Defaults to the viewer's own department where
 * known; "All" always available.
 *
 * The visual reads "Showing: [chip] [chip] [chip]" so it's clear that
 * filtering is active — toggling off goes to All.
 */

import type { Department } from '../../types/strategy'

const DEPT_OPTIONS: Array<{ value: Department | 'all'; label: string }> = [
  { value: 'all',      label: 'All' },
  { value: 'all-in',   label: 'All In' },
  { value: 'branding', label: 'Brand' },
  { value: 'web',      label: 'Web' },
  { value: 'social',   label: 'Social' },
]

const DEPT_DOT_COLOR: Record<Department, string> = {
  'all-in':  'bg-[var(--color-dept-allin)]',
  branding:  'bg-[var(--color-dept-branding)]',
  web:       'bg-[var(--color-dept-web)]',
  social:    'bg-[var(--color-dept-social)]',
}

export function DeptFilterChips({ value, onChange }: {
  value: Department | 'all'
  onChange: (next: Department | 'all') => void
}) {
  return (
    <div className="flex items-center gap-2 mb-4 flex-wrap">
      <span className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-lib-text-subtle)]">
        Showing
      </span>
      {DEPT_OPTIONS.map(o => {
        const active = o.value === value
        const dotClass = o.value === 'all' ? null : DEPT_DOT_COLOR[o.value]
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={[
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
              active
                ? 'bg-[var(--color-lib-accent)] text-white'
                : 'bg-[var(--color-lib-surface)] border border-[var(--color-lib-border)] text-[var(--color-lib-text)] hover:border-[var(--color-lib-border-strong)]',
            ].join(' ')}
          >
            {dotClass && (
              <span className={`w-2 h-2 rounded-full ${active ? 'bg-white/80' : dotClass}`} />
            )}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
