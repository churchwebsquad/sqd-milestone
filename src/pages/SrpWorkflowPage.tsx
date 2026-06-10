/**
 * SRP Workflow page — the per-session workspace.
 *
 * State-isolation rules (the previous app violated all three):
 *   1. session_id comes from the URL ONLY (useParams). Never from
 *      local state, context, or localStorage.
 *   2. The session is loaded fresh from DB on every mount. Navigation
 *      away and back re-fetches; no cached client-side copy.
 *   3. Every step's onSave persists immediately to DB. No "save when
 *      you finish" — the workflow can be left and resumed at any moment.
 *
 * Step routing:
 *   account → deliverables → sermon → review
 * Step state lives in sms_srp_generation.current_step.
 */

import { useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Loader2, Building2, ListChecks, FileVideo, Sparkles } from 'lucide-react'
import { updateSession, SRP_STEPS } from '../lib/srpSessions'
import { useSrpSession } from '../lib/srpRealtime'
import type { SrpStep } from '../types/database'
import { SrpWorkflowShell } from '../components/srp/_shared/SrpWorkflowShell'
import type { SrpSidebarStepperItem } from '../components/srp/_shared/SrpSidebarStepper'
import { AccountStep } from '../components/srp/AccountStep'
import { DeliverableStep } from '../components/srp/DeliverableStep'
import { SermonInputStep } from '../components/srp/SermonInputStep'
import { ReviewStep } from '../components/srp/ReviewStep'

const STEP_META: Record<SrpStep, { icon: SrpSidebarStepperItem['icon']; description: string }> = {
  account:      { icon: Building2,  description: 'Partner this run is for'        },
  deliverables: { icon: ListChecks, description: 'What this run will produce'     },
  sermon:       { icon: FileVideo,  description: 'Drop in sermon URL + transcript'},
  review:       { icon: Sparkles,   description: 'Generate, polish, and approve'  },
  approved:     { icon: Sparkles,   description: 'Live in ClickUp / Vista'        },
  // Legacy step name from old rows — normalize coerces it to 'review',
  // so it never appears in the sidebar. Entry kept to satisfy the
  // Record<SrpStep, ...> contract.
  reelCaptions: { icon: Sparkles,   description: '(legacy — see review)'          },
}

const STEP_ITEMS: SrpSidebarStepperItem[] = SRP_STEPS.map(step => ({
  step,
  icon:        STEP_META[step].icon,
  description: STEP_META[step].description,
}))

export default function SrpWorkflowPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  // Realtime subscription pushes row updates instead of polling.
  // Falls back to manual `refresh()` calls (still wired below) when
  // the channel can't connect.
  const { session, loading, error, connected, refresh } = useSrpSession(sessionId ?? null)

  const reload = useCallback(async () => { await refresh() }, [refresh])

  const goToStep = useCallback(async (step: SrpStep) => {
    if (!sessionId) return
    await updateSession(sessionId, { current_step: step })
    await reload()
  }, [sessionId, reload])

  if (loading) {
    return (
      <div className="min-h-full grid place-items-center bg-[var(--color-cream)] text-[var(--color-purple-gray)]">
        <Loader2 className="animate-spin" />
      </div>
    )
  }
  if (error || !session) {
    return (
      <div className="min-h-full py-10 px-4 bg-[var(--color-cream)]">
        <div className="max-w-2xl mx-auto rounded-xl border border-wm-danger/30 bg-wm-danger-bg px-5 py-4 text-[13px] text-wm-danger">
          {error ?? 'Session not found.'}
        </div>
      </div>
    )
  }

  const step = normalizeStep(session.current_step)

  return (
    <SrpWorkflowShell
      backHref="/social/srp"
      backLabel="Back to SRP dashboard"
      kicker={`SRP · ${session.member ?? '—'}`}
      title={session.church_name ?? 'SRP session'}
      connected={connected}
      stepItems={STEP_ITEMS}
      currentStep={step}
      onJump={goToStep}
    >
      {step === 'account' && (
        <AccountStep
          session={session}
          onContinue={() => void goToStep('deliverables')}
        />
      )}
      {step === 'deliverables' && (
        <DeliverableStep
          session={session}
          onBack={() => void goToStep('account')}
          onContinue={() => void goToStep('sermon')}
          onChange={() => void reload()}
        />
      )}
      {step === 'sermon' && (
        <SermonInputStep
          session={session}
          onBack={() => void goToStep('deliverables')}
          onContinue={() => void goToStep('review')}
          onChange={() => void reload()}
        />
      )}
      {step === 'review' && (
        <ReviewStep
          session={session}
          onBack={() => void goToStep('sermon')}
          onApprove={async () => {
            await updateSession(session.session_id, { status: 'completed', current_step: 'approved' })
            navigate('/social/srp')
          }}
          onChange={() => void reload()}
        />
      )}
    </SrpWorkflowShell>
  )
}

/** Coerce legacy step names from old rows into the new 4-step model. */
function normalizeStep(raw: string | null | undefined): SrpStep {
  switch (raw) {
    case 'account':
    case 'deliverables':
    case 'sermon':
    case 'review':
    case 'approved':
      return raw
    case 'reelCaptions':
      return 'review'  // legacy rows land on review
    default:
      return 'account'
  }
}
