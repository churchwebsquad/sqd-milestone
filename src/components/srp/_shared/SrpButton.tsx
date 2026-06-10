/**
 * SRP pill-shaped buttons — per CLAUDE.md brand ("Always pill-shaped,
 * border-radius 999px, never squared. Primary = Deep Plum fill.").
 *
 * Three variants:
 *   - primary:   Deep Plum fill, white text. Main action.
 *   - secondary: Primary Purple fill, white text. Step navigation
 *                ("Continue" → next step).
 *   - ghost:     Transparent with Deep Plum text. Back / Cancel.
 *
 * All variants animate to a hover state and respect `disabled` /
 * `busy` props. The button is a styled forward-ref of an `<button>`
 * so it can sit inside form rows and toolbars without wrapping.
 */

import { Loader2 } from 'lucide-react'
import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost'

const VARIANT_CLASS: Record<Variant, string> = {
  primary:
    'bg-[var(--color-deep-plum)] text-white hover:bg-[var(--color-primary-purple)]',
  secondary:
    'bg-[var(--color-primary-purple)] text-white hover:bg-[var(--color-purple-mid)]',
  ghost:
    'bg-transparent text-[var(--color-deep-plum)] hover:bg-[var(--color-lavender-tint)] border border-transparent hover:border-[var(--color-lavender)]',
}

export interface SrpButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:    Variant
  /** Render a leading icon (lucide). Hides when `busy` is true (spinner replaces it). */
  leadingIcon?: ReactNode
  /** Render a trailing icon (lucide). Useful for "Continue →" affordance. */
  trailingIcon?: ReactNode
  /** When true, replaces leadingIcon with a spinner and dims the button. */
  busy?:       boolean
  /** Smaller pill for inline toolbars. */
  size?:       'sm' | 'md'
}

export const SrpButton = forwardRef<HTMLButtonElement, SrpButtonProps>(function SrpButton(
  { variant = 'primary', leadingIcon, trailingIcon, busy, size = 'md', disabled, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || busy}
      className={[
        'inline-flex items-center gap-1.5 rounded-full font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
        size === 'sm' ? 'px-3 py-1 text-[12px]' : 'px-4 py-2 text-[13px]',
        VARIANT_CLASS[variant],
        className ?? '',
      ].join(' ')}
      {...rest}
    >
      {busy ? <Loader2 size={size === 'sm' ? 12 : 14} className="animate-spin" /> : leadingIcon}
      {children}
      {!busy && trailingIcon}
    </button>
  )
})
