/**
 * SRP Workflow page — per-session workspace for the 12-step pipeline.
 *
 * Architecture:
 *   1. session_id comes from the URL (useParams). Never from local
 *      state, context, or localStorage.
 *   2. SrpWorkflowProvider loads the row from srp_pipeline.sessions on
 *      mount, mirrors state into context, autosaves on change.
 *   3. visibleSteps drives the sidebar stepper — depends on which
 *      deliverables the coach selected, so the stepper changes
 *      shape live as they toggle.
 *   4. The active step component reads/writes via the context.
 *
 * Phase 3 Batch 1 stubs every step. Real step components ship in
 * Batches 2-4. See docs/SRP_PORT_PLAN.md.
 */

import { useEffect, useMemo, type ReactElement } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Building2, ListChecks, FileVideo, Scissors, Film,
  LayoutGrid, MessageSquare, Mail, Camera,
  Wand2, Sparkles, ClipboardList, Sliders,
  Loader2,
} from 'lucide-react'
import {
  SrpWorkflowProvider,
  useSrpWorkflow,
} from '../contexts/SrpWorkflowContext'
import { SrpWorkflowShell } from '../components/srp/_shared/SrpWorkflowShell'
import type { SrpSidebarStepperItem } from '../components/srp/_shared/SrpSidebarStepper'
import { SrpAccountInfoPanel } from '../components/srp/SrpAccountInfoPanel'
import { SrpQuickLinks } from '../components/srp/SrpQuickLinks'
import { STEP_DESCRIPTIONS } from '../lib/srpSessions'
import { loadSquadAccount } from '../lib/squadAccount'
import { AccountSelectionStep }     from '../components/srp/steps/AccountSelectionStep'
import { DeliverableSelectionStep } from '../components/srp/steps/DeliverableSelectionStep'
import { SermonInputStep }          from '../components/srp/steps/SermonInputStep'
import { TranscriptOverviewStep }   from '../components/srp/steps/TranscriptOverviewStep'
import { ClipSelectionStep }        from '../components/srp/steps/ClipSelectionStep'
import { PreRenderReviewStep }      from '../components/srp/steps/PreRenderReviewStep'
import { PreRenderEditStep }        from '../components/srp/steps/PreRenderEditStep'
import { ReelCaptionsStep }         from '../components/srp/steps/ReelCaptionsStep'
import { CarouselStep }             from '../components/srp/steps/CarouselStep'
import { FacebookStep }             from '../components/srp/steps/FacebookStep'
import { SundayInviteStep }         from '../components/srp/steps/SundayInviteStep'
import { PhotoRecapStep }           from '../components/srp/steps/PhotoRecapStep'
import { ClipProcessingStep }       from '../components/srp/steps/ClipProcessingStep'
import { ApprovedContentStep }      from '../components/srp/steps/ApprovedContentStep'
import { CreativeDirectionStep }   from '../components/srp/steps/CreativeDirectionStep'
import type { SrpWorkflowStep } from '../types/database'

const STEP_ICONS: Record<SrpWorkflowStep, SrpSidebarStepperItem['icon']> = {
  account:           Building2,
  deliverables:      ListChecks,
  sermon:            FileVideo,
  overview:          ClipboardList,
  clips:             Scissors,
  creativeDirection: Sliders,
  preRenderReview:   Film,
  preRenderEdit:     Sliders,
  reelCaptions:      Film,
  carousel:          LayoutGrid,
  facebook:          MessageSquare,
  sundayInvite:      Mail,
  photoRecap:        Camera,
  clipProcessing:    Wand2,
  approved:          Sparkles,
}

const STEP_COMPONENTS: Record<SrpWorkflowStep, () => ReactElement> = {
  account:           AccountSelectionStep,
  deliverables:      DeliverableSelectionStep,
  sermon:            SermonInputStep,
  overview:          TranscriptOverviewStep,
  clips:             ClipSelectionStep,
  creativeDirection: CreativeDirectionStep,
  preRenderReview:   PreRenderReviewStep,
  preRenderEdit:     PreRenderEditStep,
  reelCaptions:      ReelCaptionsStep,
  carousel:          CarouselStep,
  facebook:          FacebookStep,
  sundayInvite:      SundayInviteStep,
  photoRecap:        PhotoRecapStep,
  clipProcessing:    ClipProcessingStep,
  approved:          ApprovedContentStep,
}

export default function SrpWorkflowPage() {
  const { sessionId } = useParams<{ sessionId: string }>()

  if (!sessionId) {
    return (
      <div className="min-h-full grid place-items-center bg-[var(--color-cream)] text-[var(--color-purple-gray)]">
        <p className="text-[13px]">Missing session_id in URL.</p>
      </div>
    )
  }

  return (
    <SrpWorkflowProvider sessionId={sessionId}>
      <SrpWorkflowInner />
    </SrpWorkflowProvider>
  )
}

function SrpWorkflowInner() {
  const {
    isResuming, error, sessionId,
    account, setAccount,
    visibleSteps, currentStep, setCurrentStep,
    savedStep,
    clickupTaskId,
  } = useSrpWorkflow()

  // All steps from the start through the furthest point reached (max of
  // savedStep from DB and the current live step) are marked as started.
  // This keeps them highlighted when navigating backwards within a session.
  const startedSteps = useMemo(() => {
    const savedIx   = visibleSteps.indexOf(savedStep)
    const currentIx = visibleSteps.indexOf(currentStep)
    const highIx    = Math.max(savedIx, currentIx)
    return new Set(visibleSteps.slice(0, highIx + 1))
  }, [visibleSteps, savedStep, currentStep])

  // Once the context loads the session row, fetch the full SquadAccount
  // so the Quick Links + Account Info Panel populate.
  useEffect(() => {
    const member = account?.member
    if (!member) return
    // Skip if we already have a "full" account (any link populated).
    const isFull =
      !!account.instagram_link || !!account.facebook_link || !!account.church_website
      || !!account.brand_guide_url || !!account.speak_to_audience_as_from_discovery
    if (isFull) return
    void (async () => {
      try {
        const full = await loadSquadAccount(member)
        if (full) setAccount(full)
      } catch (e) {
        console.error('loadSquadAccount failed:', e)
      }
    })()
  }, [account, setAccount])

  if (isResuming) {
    return (
      <div className="min-h-full grid place-items-center bg-[var(--color-cream)] text-[var(--color-purple-gray)]">
        <Loader2 className="animate-spin" />
      </div>
    )
  }
  if (error) {
    return (
      <div className="min-h-full py-10 px-4 bg-[var(--color-cream)]">
        <div className="max-w-2xl mx-auto rounded-xl border border-wm-danger/30 bg-wm-danger-bg px-5 py-4 text-[13px] text-wm-danger">
          {error}
        </div>
      </div>
    )
  }

  const stepItems: SrpSidebarStepperItem[] = visibleSteps.map(step => ({
    step,
    icon:        STEP_ICONS[step],
    description: STEP_DESCRIPTIONS[step],
  }))

  const ActiveStep = STEP_COMPONENTS[currentStep]

  // On the account step the coach is still picking which sermon to work on.
  // Show a clean picker layout — no workflow stepper yet.
  if (currentStep === 'account') {
    return (
      <div className="min-h-full bg-[var(--color-cream)] py-6 px-4 md:px-8">
        <div className="max-w-3xl mx-auto">
          <Link
            to="/social/srp"
            className="inline-flex items-center gap-1 text-[12px] text-[var(--color-purple-gray)] hover:text-[var(--color-deep-plum)] mb-4 transition-colors"
          >
            <ArrowLeft size={12} /> Back to SRP dashboard
          </Link>
          <header className="mb-6">
            <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-[var(--color-primary-purple)]">
              SRP · {account?.member ?? '—'}
            </p>
            <h1 className="text-[24px] sm:text-[28px] font-semibold text-[var(--color-deep-plum)] mt-0.5">
              {account?.church_name ?? 'SRP session'}
            </h1>
          </header>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-6 items-start">
            <main className="min-w-0">
              <AccountSelectionStep />
            </main>
            <aside className="space-y-3">
              <SrpQuickLinks account={account} />
              <SrpAccountInfoPanel account={account} />
              <p className="text-[9px] font-mono text-[var(--color-purple-gray)]/40 truncate" title={sessionId}>
                {sessionId}
              </p>
            </aside>
          </div>
        </div>
      </div>
    )
  }

  return (
    <SrpWorkflowShell
      backHref="/social/srp"
      backLabel="Back to SRP dashboard"
      kicker={`SRP · ${account?.member ?? '—'}`}
      title={account?.church_name ?? 'SRP session'}
      connected={false}
      stepItems={stepItems}
      currentStep={currentStep}
      onJump={setCurrentStep}
      startedSteps={startedSteps}
      clickupTaskId={clickupTaskId}
      sidebarFooter={
        <>
          <SrpQuickLinks account={account} />
          <SrpAccountInfoPanel account={account} />
          <p className="text-[9px] font-mono text-[var(--color-purple-gray)]/40 truncate" title={sessionId}>
            {sessionId}
          </p>
        </>
      }
    >
      <ActiveStep />
    </SrpWorkflowShell>
  )
}
