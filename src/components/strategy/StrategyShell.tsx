import type { ReactNode } from 'react'

/** Page wrapper for the Strategy module — applies the warm-bg + editorial
 *  text color from the Library design tokens so the whole module reads
 *  consistently. Override the existing AppLayout's `bg-cream` by filling
 *  the main area with `bg-[var(--color-lib-bg)]`.
 *
 *  Each Strategy page (Initiatives, Initiative Detail, Roadmap, Progress)
 *  wraps its content in `<StrategyShell>`. The Library mounts its own
 *  `LibraryLayout` route element which does the same thing — the two
 *  share tokens but the routing is independent. */
export function StrategyShell({ children, maxWidth = 'max-w-6xl' }: {
  children: ReactNode
  /** Tailwind max-width class — typically `max-w-6xl` for grids,
   *  `max-w-3xl` for narrow feeds. */
  maxWidth?: string
}) {
  return (
    <div className="min-h-full bg-[var(--color-lib-bg)] text-[var(--color-lib-text)]">
      <div className={`px-4 md:px-6 py-8 ${maxWidth} mx-auto`}>
        {children}
      </div>
    </div>
  )
}

// ── Editorial typography helpers ─────────────────────────────────────────

export function PageEyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--color-lib-accent)] mb-2">
      {children}
    </p>
  )
}

export function PageTitle({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <h1 className="text-[28px] font-semibold tracking-[-0.02em] text-[var(--color-lib-text)] flex items-center gap-2 leading-tight">
      {icon}
      {children}
    </h1>
  )
}

export function PageSubtitle({ children }: { children: ReactNode }) {
  return (
    <p className="text-base text-[var(--color-lib-text-muted)] mt-1">{children}</p>
  )
}

/** Standard editorial card: 1px border, no shadow, white-on-warm. */
export const CARD_CLASS =
  'rounded-lg border border-[var(--color-lib-border)] bg-[var(--color-lib-surface)]'
