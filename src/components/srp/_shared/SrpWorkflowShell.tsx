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
import { ArrowLeft, Wifi, WifiOff } from 'lucide-react'
import type { SrpStep } from '../../../types/database'
import { SrpSidebarStepper, type SrpSidebarStepperItem } from './SrpSidebarStepper'

export function SrpWorkflowShell({
  backHref, backLabel,
  kicker, title, connected,
  stepItems, currentStep, onJump,
  children,
}: {
  backHref:    string
  backLabel:   string
  /** Primary-Purple eyebrow over the title. */
  kicker:      string
  title:       string
  /** Realtime connection indicator — green dot when live, muted when polling. */
  connected:   boolean
  stepItems:   SrpSidebarStepperItem[]
  currentStep: SrpStep
  onJump:      (s: SrpStep) => void
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
          <aside className="lg:sticky lg:top-6">
            <SrpSidebarStepper items={stepItems} currentStep={currentStep} onJump={onJump} />
          </aside>
          <main className="min-w-0">{children}</main>
        </div>
      </div>
    </div>
  )
}
