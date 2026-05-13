/**
 * Shared Phase-A placeholder for workspaces being built day-by-day.
 * Each workspace gets its own real component when its build day lands;
 * until then this lightweight placeholder fills the slot so the shell
 * is fully clickable end-to-end.
 */

import type { ReactNode } from 'react'

export interface WorkspacePlaceholderProps {
  title: string
  subtitle?: string
  icon?: ReactNode
  /** What this workspace will eventually hold */
  whatThisWillBe: string[]
  /** Build day when this lands (visual marker for phase tracking) */
  shipsOn: string
}

export function WorkspacePlaceholder({
  title, subtitle, icon, whatThisWillBe, shipsOn,
}: WorkspacePlaceholderProps) {
  return (
    <div className="p-6 md:p-10">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1.5 text-wm-accent-strong">
              {icon}
              <p className="text-[11px] font-bold uppercase tracking-widest">{title}</p>
            </div>
            {subtitle && <h1 className="text-2xl font-semibold text-wm-text">{subtitle}</h1>}
          </div>
          <span className="rounded-full bg-wm-bg-hover text-wm-text-muted text-[10px] font-bold uppercase tracking-wide px-2 py-1">
            Builds on {shipsOn}
          </span>
        </div>

        <div className="rounded-lg border border-dashed border-wm-border bg-wm-bg-elevated p-6">
          <p className="text-[11px] uppercase tracking-widest font-bold text-wm-text-subtle mb-3">
            What this workspace will hold
          </p>
          <ul className="space-y-2">
            {whatThisWillBe.map((item, i) => (
              <li key={i} className="text-sm text-wm-text-muted flex items-start gap-2">
                <span className="text-wm-accent mt-1">·</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
