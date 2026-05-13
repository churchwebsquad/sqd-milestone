/**
 * Web Manager — Card. The standard surface container.
 *
 * Three padding modes: tight (12px), default (16px), loose (24px).
 * Use `interactive` when the card itself is clickable (hover surface).
 */

import type { HTMLAttributes, ReactNode } from 'react'

export interface WMCardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: 'tight' | 'default' | 'loose' | 'none'
  interactive?: boolean
  children: ReactNode
}

const PADDING_CLASSES = {
  tight:   'p-3',
  default: 'p-4',
  loose:   'p-6',
  none:    '',
} as const

export function WMCard({
  padding = 'default',
  interactive = false,
  className = '',
  children,
  ...rest
}: WMCardProps) {
  return (
    <div
      {...rest}
      className={[
        'rounded-lg bg-wm-bg-elevated border border-wm-border',
        PADDING_CLASSES[padding],
        interactive
          ? 'cursor-pointer transition-colors hover:bg-wm-bg-hover hover:border-wm-border-strong'
          : '',
        className,
      ].join(' ')}
    >
      {children}
    </div>
  )
}
