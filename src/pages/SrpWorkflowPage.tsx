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

import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Loader2 } from 'lucide-react'
import {
  getSession, updateSession,
  SRP_STEPS, STEP_LABELS,
} from '../lib/srpSessions'
import type { SmsSrpGeneration, SrpStep } from '../types/database'
import { SrpStepIndicator } from '../components/srp/SrpStepIndicator'
import { AccountStep } from '../components/srp/AccountStep'
import { DeliverableStep } from '../components/srp/DeliverableStep'
import { SermonInputStep } from '../components/srp/SermonInputStep'
import { ReviewStep } from '../components/srp/ReviewStep'

export default function SrpWorkflowPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const [session, setSession] = useState<SmsSrpGeneration | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!sessionId) return
    setLoading(true)
    try {
      const s = await getSession(sessionId)
      setSession(s)
      if (!s) setError(`Session ${sessionId} not found.`)
      else setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load session')
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => { void reload() }, [reload])

  const goToStep = useCallback(async (step: SrpStep) => {
    if (!sessionId) return
    await updateSession(sessionId, { current_step: step })
    await reload()
  }, [sessionId, reload])

  if (loading) {
    return (
      <div className="min-h-full grid place-items-center text-wm-text-muted">
        <Loader2 className="animate-spin" />
      </div>
    )
  }
  if (error || !session) {
    return (
      <div className="min-h-full py-6 px-4 md:px-6 max-w-3xl mx-auto">
        <Link to="/social/srp" className="inline-flex items-center gap-1 text-[12px] text-wm-text-muted hover:text-wm-text mb-3">
          <ArrowLeft size={12} /> Dashboard
        </Link>
        <div className="rounded-md border border-wm-danger/30 bg-wm-danger-bg px-4 py-3 text-[13px] text-wm-danger">
          {error ?? 'Session not found.'}
        </div>
      </div>
    )
  }

  const step = normalizeStep(session.current_step)
  const stepIx = SRP_STEPS.indexOf(step)

  return (
    <div className="min-h-full bg-wm-bg py-6 px-4 md:px-6">
      <div className="max-w-5xl mx-auto">
        <Link to="/social/srp" className="inline-flex items-center gap-1 text-[12px] text-wm-text-muted hover:text-wm-text mb-3">
          <ArrowLeft size={12} /> Dashboard
        </Link>

        <header className="mb-5">
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">
            SRP · {session.member ?? '—'} · <span className="font-mono">{session.session_id}</span>
          </p>
          <h1 className="text-[22px] font-semibold text-wm-text mt-0.5">{session.church_name ?? 'SRP session'}</h1>
        </header>

        <SrpStepIndicator
          steps={SRP_STEPS}
          currentStep={step}
          onJump={async s => {
            // Allow jumping back to any earlier step, never forward beyond
            // the saved progress (each step has its own completion check).
            const targetIx = SRP_STEPS.indexOf(s)
            if (targetIx <= stepIx) await goToStep(s)
          }}
        />

        <div className="mt-5">
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
        </div>
      </div>
    </div>
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
