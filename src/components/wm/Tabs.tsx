/**
 * Web Manager — Tabs. Underline-style top-level navigation.
 *
 * Active tab gets the accent color + an underline bar; inactive tabs
 * are muted. Count badges are accent when active, neutral otherwise.
 * Optional `icon` rendered before the label.
 */

import type { ReactNode } from 'react'

export interface WMTabItem<T extends string = string> {
  key: T
  label: string
  icon?: ReactNode
  count?: number
  disabled?: boolean
}

export interface WMTabsProps<T extends string> {
  items: readonly WMTabItem<T>[]
  active: T
  onChange: (key: T) => void
  className?: string
}

export function WMTabs<T extends string>({
  items, active, onChange, className = '',
}: WMTabsProps<T>) {
  return (
    <div
      role="tablist"
      className={['flex items-end gap-1 border-b border-wm-border', className].join(' ')}
    >
      {items.map(item => {
        const isActive = item.key === active
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            disabled={item.disabled}
            onClick={() => onChange(item.key)}
            className={[
              'inline-flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium',
              'border-b-2 -mb-px transition-colors duration-150',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-wm-border-focus focus-visible:ring-offset-1 focus-visible:ring-offset-wm-bg',
              'disabled:opacity-40 disabled:cursor-not-allowed',
              isActive
                ? 'border-wm-accent text-wm-text'
                : 'border-transparent text-wm-text-muted hover:text-wm-text hover:border-wm-border-strong',
            ].join(' ')}
          >
            {item.icon}
            <span>{item.label}</span>
            {typeof item.count === 'number' && (
              <span
                className={[
                  'min-w-[18px] h-[18px] inline-flex items-center justify-center rounded-full text-[10px] font-bold px-1',
                  isActive
                    ? 'bg-wm-accent-tint text-wm-accent-strong'
                    : 'bg-wm-bg-hover text-wm-text-subtle',
                ].join(' ')}
              >
                {item.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
