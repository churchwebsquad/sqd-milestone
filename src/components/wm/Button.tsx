/**
 * Web Manager — Button primitive.
 *
 * Three variants:
 *   - primary:   accent fill, white text. Use sparingly — one per surface.
 *   - secondary: white surface + border. Default action.
 *   - ghost:     no surface, accent-tint hover. Inline / table actions.
 *
 * Sizes: sm (28px), md (32px), lg (40px). Default md.
 *
 * All buttons follow brand pill radius for primary actions; ghost +
 * secondary use the system radius. Override via `className`.
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'

export interface WMButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  iconLeft?: ReactNode
  iconRight?: ReactNode
}

const SIZE_CLASSES = {
  sm: 'h-7  px-2.5 text-[12px] gap-1.5',
  md: 'h-8  px-3   text-[13px] gap-1.5',
  lg: 'h-10 px-4   text-[14px] gap-2',
} as const

const VARIANT_CLASSES = {
  primary:
    'bg-wm-accent text-wm-text-on-accent hover:bg-wm-accent-hover border border-wm-accent',
  secondary:
    'bg-wm-bg-elevated text-wm-text border border-wm-border hover:bg-wm-bg-hover hover:border-wm-border-strong',
  ghost:
    'bg-transparent text-wm-text-muted hover:bg-wm-bg-hover hover:text-wm-text border border-transparent',
  danger:
    'bg-wm-danger text-white hover:opacity-90 border border-wm-danger',
} as const

export function WMButton({
  variant = 'secondary',
  size = 'md',
  loading,
  iconLeft,
  iconRight,
  disabled,
  className = '',
  children,
  ...rest
}: WMButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      className={[
        'inline-flex items-center justify-center rounded-md font-medium',
        'transition-colors duration-150',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-wm-border-focus focus-visible:ring-offset-1 focus-visible:ring-offset-wm-bg',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        SIZE_CLASSES[size],
        VARIANT_CLASSES[variant],
        className,
      ].join(' ')}
    >
      {loading && <Loader2 size={13} className="animate-spin" />}
      {!loading && iconLeft}
      {children}
      {!loading && iconRight}
    </button>
  )
}
