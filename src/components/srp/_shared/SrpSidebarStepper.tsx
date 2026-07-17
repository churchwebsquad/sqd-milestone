/**
 * SRP workflow stepper — vertical sidebar variant.
 *
 * Replaces the horizontal pill stepper with a sidebar layout modeled
 * on srp-generator-main's AppSidebar but rendered in the CMS brand
 * (Cream/Deep Plum/Primary Purple per CLAUDE.md, NOT the old app's
 * lavender HSL palette). Each step is a button with a 2-digit
 * numbered avatar + label; current step highlighted in Primary
 * Purple, completed steps marked with a check icon, future steps
 * dimmed and disabled.
 */

import { Check } from 'lucide-react'
import type { SrpWorkflowStep } from '../../../types/database'
import { STEP_LABELS } from '../../../lib/srpSessions'
import type { LucideIcon } from 'lucide-react'

export interface SrpSidebarStepperItem {
  step:        SrpWorkflowStep
  icon?:       LucideIcon
  description?: string
}

export function SrpSidebarStepper({
  items, currentStep, onJump,
}: {
  items:       SrpSidebarStepperItem[]
  currentStep: SrpWorkflowStep
  onJump:      (s: SrpWorkflowStep) => void
}) {
  const currentIx = items.findIndex(it => it.step === currentStep)

  return (
    <nav aria-label="SRP workflow steps" className="rounded-lg border border-wm-border bg-white p-3">
      <p className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)] px-2 pb-2">
        Workflow
      </p>
      <ol className="space-y-0.5">
        {items.map((it, i) => {
          const isActive = i === currentIx
          const isDone   = i < currentIx
          // All steps are always jumpable — this is a session workspace,
          // not a strict wizard. Coaches need to revisit any step after
          // client revisions without clicking Continue through every step.
          const canJump  = true
          const Icon     = it.icon
          return (
            <li key={it.step}>
              <button
                onClick={() => canJump && onJump(it.step)}
                disabled={!canJump}
                aria-current={isActive ? 'step' : undefined}
                className={[
                  'w-full text-left rounded-md flex items-start gap-3 px-2.5 py-2 transition-colors',
                  isActive
                    ? 'bg-[var(--color-lavender-tint)] text-[var(--color-deep-plum)]'
                    : isDone
                      ? 'bg-[var(--color-lavender-tint)]/50 text-[var(--color-deep-plum)] hover:bg-[var(--color-lavender-tint)] cursor-pointer'
                      : 'text-[var(--color-purple-gray)] hover:bg-[var(--color-lavender-tint)]/40 cursor-pointer opacity-60',
                ].join(' ')}
              >
                {/* Numbered / checked avatar. Active = filled Primary
                    Purple; done = lavender ring with check; future =
                    flat lavender outline only. */}
                <span
                  aria-hidden
                  className={[
                    'shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-mono font-bold',
                    isActive
                      ? 'bg-[var(--color-primary-purple)] text-white'
                      : isDone
                        ? 'bg-[var(--color-lavender)] text-[var(--color-deep-plum)]'
                        : 'border border-[var(--color-lavender)] text-[var(--color-purple-gray)]',
                  ].join(' ')}
                >
                  {isDone ? <Check size={12} strokeWidth={3} /> : String(i + 1).padStart(2, '0')}
                </span>

                <span className="flex flex-col min-w-0 pt-0.5">
                  <span className="flex items-center gap-1.5 text-[13px] font-semibold">
                    {Icon && <Icon size={13} className="shrink-0 opacity-70" />}
                    {STEP_LABELS[it.step] ?? it.step}
                  </span>
                  {it.description && (
                    <span className="text-[11px] text-[var(--color-purple-gray)] leading-tight mt-0.5">
                      {it.description}
                    </span>
                  )}
                </span>

                {/* Active-step caret. Pure visual; replaces the
                    horizontal stepper's ">" connector. */}
                {isActive && (
                  <span
                    aria-hidden
                    className="ml-auto self-center w-1 h-6 rounded-full bg-[var(--color-primary-purple)]"
                  />
                )}
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
