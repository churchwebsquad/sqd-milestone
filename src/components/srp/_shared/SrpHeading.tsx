/**
 * Brand-voice headings for SRP surfaces. Per CLAUDE.md:
 * "Headlines: Georgia or serif with italic emphasis on emotional
 * words (brand signature)."
 *
 * The hero variant uses Georgia + italic on the user-supplied
 * emphasis fragment. Strategist-facing utility headings (step
 * panels, modals) stay in sans for density.
 */

import type { ReactNode } from 'react'

export function SrpHeroHeading({
  prefix, emphasis, suffix, kicker, subtitle,
}: {
  /** Sans-serif lead text. e.g. "Welcome to the" */
  prefix?:   string
  /** Italic serif fragment carrying the brand signature. */
  emphasis:  string
  /** Sans-serif tail. e.g. "Generator." */
  suffix?:   string
  /** Optional Primary-Purple uppercase eyebrow above the heading. */
  kicker?:   string
  subtitle?: ReactNode
}) {
  return (
    <header className="space-y-1.5">
      {kicker && (
        <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-[var(--color-primary-purple)]">
          {kicker}
        </p>
      )}
      <h1 className="text-[28px] sm:text-[32px] leading-tight text-[var(--color-deep-plum)] font-semibold">
        {prefix && <span>{prefix} </span>}
        <span style={{ fontFamily: 'Georgia, serif' }} className="italic font-normal">
          {emphasis}
        </span>
        {suffix && <span> {suffix}</span>}
      </h1>
      {subtitle && (
        <p className="text-[14px] text-[var(--color-purple-gray)] max-w-2xl leading-snug">{subtitle}</p>
      )}
    </header>
  )
}
