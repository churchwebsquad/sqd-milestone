/**
 * Web Manager — IconButton. Square button for icon-only actions.
 * Common uses: row actions, toolbar buttons, close buttons, navigation.
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react'

export interface WMIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'ghost' | 'secondary'
  size?: 'sm' | 'md' | 'lg'
  /** Required for screen readers — icon buttons have no text */
  label: string
  children: ReactNode
}

const SIZE_CLASSES = {
  sm: 'h-7  w-7',
  md: 'h-8  w-8',
  lg: 'h-10 w-10',
} as const

const VARIANT_CLASSES = {
  ghost:
    'bg-transparent text-wm-text-muted hover:bg-wm-bg-hover hover:text-wm-text',
  secondary:
    'bg-wm-bg-elevated text-wm-text border border-wm-border hover:bg-wm-bg-hover hover:border-wm-border-strong',
} as const

export function WMIconButton({
  variant = 'ghost',
  size = 'md',
  label,
  className = '',
  children,
  ...rest
}: WMIconButtonProps) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      className={[
        'inline-flex items-center justify-center rounded-md',
        'transition-colors duration-150',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-wm-border-focus focus-visible:ring-offset-1 focus-visible:ring-offset-wm-bg',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        SIZE_CLASSES[size],
        VARIANT_CLASSES[variant],
        className,
      ].join(' ')}
    >
      {children}
    </button>
  )
}
