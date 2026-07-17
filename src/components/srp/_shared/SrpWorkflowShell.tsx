/**
 * Two-column workflow layout for the SRP per-session page. Matches
 * the sidebar-stepper pattern from srp-generator-main (left rail
 * listing every step, right column rendering the active step's
 * content) but rendered on the CMS brand canvas (Cream bg, Lavender
 * borders, Deep Plum text).
 *
 * Stacks to single-column on mobile — the stepper compresses into a
 * horizontal scroll strip above the content so it stays usable.
 */

import { Link } from 'react-router-dom'
import { ArrowLeft, Wifi, WifiOff, ExternalLink } from 'lucide-react'
import type { SrpWorkflowStep } from '../../../types/database'
import { SrpSidebarStepper, type SrpSidebarStepperItem } from './SrpSidebarStepper'

export function SrpWorkflowShell({
  backHref, backLabel,
  kicker, title, connected,
  stepItems, currentStep, onJump, startedSteps,
  sidebarFooter,
  clickupTaskId,
  children,
}: {
  backHref:      string
  backLabel:     string
  kicker:        string
  title:         string
  connected:     boolean
  stepItems:     SrpSidebarStepperItem[]
  currentStep:   SrpWorkflowStep
  onJump:        (s: SrpWorkflowStep) => void
  startedSteps?: Set<SrpWorkflowStep>
  /** Quick Links + Account Info Panel render here, below the stepper. */
  sidebarFooter?: React.ReactNode
  /** When set, renders a "View in ClickUp" pill below the stepper. */
  clickupTaskId?: string | null
  children:    React.ReactNode
}) {
  return (
    <div className="min-h-full bg-[var(--color-cream)] py-6 px-4 md:px-8">
      <div className="max-w-6xl mx-auto">
        <Link
          to={backHref}
          className="inline-flex items-center gap-1 text-[12px] text-[var(--color-purple-gray)] hover:text-[var(--color-deep-plum)] mb-4 transition-colors"
        >
          <ArrowLeft size={12} /> {backLabel}
        </Link>

        <header className="mb-6 flex items-end justify-between gap-3 flex-wrap">
          <div>
            <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-[var(--color-primary-purple)]">
              {kicker}
            </p>
            <h1 className="text-[24px] sm:text-[28px] font-semibold text-[var(--color-deep-plum)] mt-0.5">
              {title}
            </h1>
          </div>
          <span
            className={[
              'inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider rounded-full px-2.5 py-1 border',
              connected
                ? 'border-wm-success/30 bg-wm-success-bg text-wm-success'
                : 'border-[var(--color-lavender)] bg-white text-[var(--color-purple-gray)]',
            ].join(' ')}
            title={connected ? 'Realtime updates connected' : 'Realtime disconnected — refresh manually'}
          >
            {connected ? <Wifi size={10} /> : <WifiOff size={10} />}
            {connected ? 'live' : 'polling'}
          </span>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6 items-start">
          <aside className="lg:sticky lg:top-6 space-y-3">
            <SrpSidebarStepper items={stepItems} currentStep={currentStep} onJump={onJump} startedSteps={startedSteps} />
            {clickupTaskId && (
              <a
                href={`https://app.clickup.com/t/${clickupTaskId}`}
                target="_blank"
                rel="noreferrer noopener"
                className="block w-full rounded-lg border border-[var(--color-lavender)] bg-white px-3 py-2.5 hover:bg-[var(--color-lavender-tint)]/60 transition-colors"
              >
                <p className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
                  ClickUp task
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 text-[12px] font-mono text-[var(--color-deep-plum)] truncate">
                  {clickupTaskId}
                  <ExternalLink size={10} className="text-[var(--color-purple-gray)]" />
                </p>
              </a>
            )}
            {sidebarFooter}
          </aside>
          <main className="min-w-0">{children}</main>
        </div>
      </div>
    </div>
  )
}
