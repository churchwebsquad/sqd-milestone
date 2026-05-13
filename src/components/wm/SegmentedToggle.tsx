/**
 * Web Manager — SegmentedToggle. Two-or-three-option mode switcher.
 *
 * Used most notably for the Roadmap + Sitemap workspaces' Staff view
 * vs Partner preview toggle, but generic enough for any either/or
 * mode selection. The active segment has the accent fill; inactive
 * segments are transparent with muted text.
 */

import type { ReactNode } from 'react'

export interface WMSegmentedOption<T extends string = string> {
  key: T
  label: string
  icon?: ReactNode
}

export interface WMSegmentedToggleProps<T extends string> {
  options: readonly WMSegmentedOption<T>[]
  active: T
  onChange: (key: T) => void
  size?: 'sm' | 'md'
  className?: string
}

export function WMSegmentedToggle<T extends string>({
  options, active, onChange, size = 'md', className = '',
}: WMSegmentedToggleProps<T>) {
  const sizeClass = size === 'sm'
    ? 'h-7 px-2 text-[11px]'
    : 'h-8 px-3 text-[12px]'

  return (
    <div
      role="tablist"
      className={[
        'inline-flex items-center rounded-md bg-wm-bg-hover border border-wm-border p-0.5',
        className,
      ].join(' ')}
    >
      {options.map(opt => {
        const isActive = opt.key === active
        return (
          <button
            key={opt.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(opt.key)}
            className={[
              'inline-flex items-center gap-1.5 rounded-[5px] font-medium transition-all duration-150',
              sizeClass,
              isActive
                ? 'bg-wm-bg-elevated text-wm-text shadow-[0_1px_2px_rgba(12,11,13,0.06)]'
                : 'text-wm-text-muted hover:text-wm-text',
            ].join(' ')}
          >
            {opt.icon}
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
