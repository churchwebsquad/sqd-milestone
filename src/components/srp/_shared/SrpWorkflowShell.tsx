/**
 * Two-column workflow layout for the SRP per-session page.
 * - Slim top bar: back link · kicker · title · status pill all on one line
 * - Collapsible sidebar (toggle button persists state in localStorage)
 * - Stacks to single-column on mobile
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Wifi, WifiOff, ExternalLink, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import type { SrpWorkflowStep } from '../../../types/database'
import { SrpSidebarStepper, type SrpSidebarStepperItem } from './SrpSidebarStepper'

const SIDEBAR_KEY = 'srp-sidebar-open'

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
  sidebarFooter?: React.ReactNode
  clickupTaskId?: string | null
  children:    React.ReactNode
}) {
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(SIDEBAR_KEY) !== 'false' } catch { return true }
  })

  function toggleSidebar() {
    const next = !sidebarOpen
    setSidebarOpen(next)
    try { localStorage.setItem(SIDEBAR_KEY, String(next)) } catch { /* ignore */ }
  }

  return (
    <div className="min-h-full bg-[var(--color-cream)] flex flex-col">

      {/* ── Top bar ── */}
      <div className="sticky top-0 z-20 bg-[var(--color-cream)] border-b border-[var(--color-lavender)] px-4 md:px-6 h-11 flex items-center gap-3">
        {/* Sidebar toggle */}
        <button
          onClick={toggleSidebar}
          title={sidebarOpen ? 'Hide workflow sidebar' : 'Show workflow sidebar'}
          className="shrink-0 text-[var(--color-purple-gray)] hover:text-[var(--color-deep-plum)] transition-colors"
        >
          {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </button>

        <div className="w-px h-4 bg-[var(--color-lavender)]" />

        {/* Back link */}
        <Link
          to={backHref}
          className="shrink-0 inline-flex items-center gap-1 text-[11px] text-[var(--color-purple-gray)] hover:text-[var(--color-deep-plum)] transition-colors"
        >
          <ArrowLeft size={11} /> {backLabel}
        </Link>

        <div className="w-px h-4 bg-[var(--color-lavender)]" />

        {/* Kicker + title */}
        <span className="text-[11px] font-semibold text-[var(--color-primary-purple)] shrink-0">{kicker}</span>
        <span className="text-[var(--color-lavender)] shrink-0">·</span>
        <span className="text-[13px] font-semibold text-[var(--color-deep-plum)] truncate">{title}</span>

        {/* Status pill pushed right */}
        <span
          className={[
            'ml-auto shrink-0 inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider rounded-full px-2.5 py-1 border',
            connected
              ? 'border-wm-success/30 bg-wm-success-bg text-wm-success'
              : 'border-[var(--color-lavender)] bg-white text-[var(--color-purple-gray)]',
          ].join(' ')}
          title={connected ? 'Realtime updates connected' : 'Realtime disconnected — refresh manually'}
        >
          {connected ? <Wifi size={10} /> : <WifiOff size={10} />}
          {connected ? 'live' : 'polling'}
        </span>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 min-h-0">

        {/* Sidebar */}
        {sidebarOpen && (
          <aside className="hidden lg:flex flex-col w-[260px] shrink-0 border-r border-[var(--color-lavender)] bg-[var(--color-cream)] sticky top-11 h-[calc(100vh-2.75rem)] overflow-y-auto p-4 space-y-3">
            <SrpSidebarStepper items={stepItems} currentStep={currentStep} onJump={onJump} startedSteps={startedSteps} />
            {clickupTaskId && (
              <a
                href={`https://app.clickup.com/t/${clickupTaskId}`}
                target="_blank"
                rel="noreferrer noopener"
                className="block w-full rounded-lg border border-[var(--color-lavender)] bg-white px-3 py-2.5 hover:bg-[var(--color-lavender-tint)]/60 transition-colors"
              >
                <p className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">ClickUp task</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-[12px] font-mono text-[var(--color-deep-plum)] truncate">
                  {clickupTaskId}
                  <ExternalLink size={10} className="text-[var(--color-purple-gray)]" />
                </p>
              </a>
            )}
            {sidebarFooter}
          </aside>
        )}

        {/* Main content */}
        <main className="flex-1 min-w-0 py-6 px-4 md:px-8 max-w-3xl">
          {children}
        </main>
      </div>
    </div>
  )
}
