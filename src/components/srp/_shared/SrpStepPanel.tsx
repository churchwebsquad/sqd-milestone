/**
 * Consistent card wrapper for every SRP step + generator. The old
 * step components each defined their own `rounded-lg border bg-...`
 * shell with slightly different padding / header treatments — this
 * primitive standardizes the surface so the eye doesn't have to
 * re-learn the layout on every step.
 *
 * Per CLAUDE.md brand: white card on Cream canvas, Lavender 1px
 * border, Deep Plum text, optional Primary Purple eyebrow.
 */

import type { LucideIcon } from 'lucide-react'

export function SrpStepPanel({
  title, description, icon: Icon, eyebrow, footer, children, tone = 'default',
}: {
  title:        string
  description?: string
  icon?:        LucideIcon
  /** Optional Primary-Purple uppercase label above the title. */
  eyebrow?:     string
  /** Action row at the bottom of the panel — typically Back / Continue buttons. */
  footer?:      React.ReactNode
  children:     React.ReactNode
  /** `accent` tints the header in Lavender Tint to mark steps that
   *  carry the primary action of the page. `default` keeps the
   *  surface neutral white. */
  tone?:        'default' | 'accent'
}) {
  return (
    <section className="rounded-xl border border-[var(--color-lavender)] bg-white overflow-hidden">
      <header
        className={[
          'px-5 py-4 border-b border-[var(--color-lavender)]',
          tone === 'accent' ? 'bg-[var(--color-lavender-tint)]' : 'bg-white',
        ].join(' ')}
      >
        {eyebrow && (
          <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-[var(--color-primary-purple)] mb-1">
            {eyebrow}
          </p>
        )}
        <div className="flex items-start gap-3">
          {Icon && (
            <span className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--color-lavender-tint)] text-[var(--color-primary-purple)]">
              <Icon size={16} />
            </span>
          )}
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold text-[var(--color-deep-plum)]">{title}</h2>
            {description && (
              <p className="text-[12px] text-[var(--color-purple-gray)] mt-1 leading-snug">{description}</p>
            )}
          </div>
        </div>
      </header>
      <div className="p-5 space-y-4 text-[var(--color-deep-plum)]">{children}</div>
      {footer && (
        <footer className="px-5 py-3 border-t border-[var(--color-lavender)] bg-[var(--color-cream)] flex items-center justify-between gap-2">
          {footer}
        </footer>
      )}
    </section>
  )
}
