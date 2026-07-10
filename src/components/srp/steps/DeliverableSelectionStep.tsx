/**
 * Step 2 — Deliverable selection.
 *
 * Coach toggles each non-reel deliverable (Facebook / Carousel / Sunday
 * Invite / Photo Recap) and picks a reel count (0-8). The visibleSteps
 * computation in SrpWorkflowContext reshapes the sidebar live as these
 * toggle, so the coach sees what they're committing to in real time.
 *
 * At least one deliverable must be selected to continue.
 */

import { useEffect, useMemo, useRef } from 'react'
import { ArrowLeft, ArrowRight, MessageSquare, LayoutGrid, Mail, Camera, Film, Minus, Plus } from 'lucide-react'
import { useSrpWorkflow, withReelsCount } from '../../../contexts/SrpWorkflowContext'
import { SrpButton } from '../_shared/SrpButton'
import { STEP_LABELS, STEP_DESCRIPTIONS, DELIVERABLE_LABELS, DELIVERABLE_DESCRIPTIONS } from '../../../lib/srpSessions'
import { SRP_MAX_REELS, isSrpReelDeliverable, type SrpDeliverable } from '../../../types/database'
import { callSrpApi } from '../../../lib/srpApi'
import { supabase } from '../../../lib/supabase'

const NON_REEL_OPTIONS: { key: Exclude<SrpDeliverable, `reel${number}`>; icon: typeof MessageSquare }[] = [
  { key: 'facebook',     icon: MessageSquare },
  { key: 'carousel',     icon: LayoutGrid    },
  { key: 'sundayInvite', icon: Mail          },
  { key: 'photoRecap',   icon: Camera        },
]

interface StartTranscriptionResponse { job_id: string }

export function DeliverableSelectionStep() {
  const {
    selectedDeliverables, setSelectedDeliverables,
    visibleSteps,
    goToNextStep, goToPrevStep,
    sessionId, videoUrl, transcriptJobId, setTranscriptJobId, transcript,
  } = useSrpWorkflow()

  // Kick off transcription while the coach is confirming deliverables so it's
  // already in-flight (or done) by the time they reach the transcript step.
  const didFireRef = useRef(false)
  useEffect(() => {
    if (didFireRef.current) return
    if (transcriptJobId || transcript.trim()) return // already running or done
    if (!videoUrl.trim() || !sessionId) return

    didFireRef.current = true
    ;(async () => {
      try {
        const { data: { session: authSession } } = await supabase.auth.getSession()
        const r = await callSrpApi<StartTranscriptionResponse>('start-transcription', {
          session_id: sessionId,
          source_url: videoUrl.trim(),
          source_type: 'unknown',
        }, { authToken: authSession?.access_token })
        setTranscriptJobId(r.job_id)
      } catch (e) {
        // Non-fatal — SermonInputStep will let coach retry manually
        console.warn('[DeliverableSelectionStep] early transcription failed:', e)
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stepNum = visibleSteps.indexOf('deliverables') + 1

  const reelCount = useMemo(
    () => selectedDeliverables.filter(isSrpReelDeliverable).length,
    [selectedDeliverables],
  )
  const hasAny = selectedDeliverables.length > 0

  const toggle = (key: Exclude<SrpDeliverable, `reel${number}`>) => {
    const next = selectedDeliverables.includes(key)
      ? selectedDeliverables.filter(d => d !== key)
      : [...selectedDeliverables, key]
    setSelectedDeliverables(next)
  }

  const setReels = (n: number) => {
    setSelectedDeliverables(withReelsCount(selectedDeliverables, n))
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-[var(--color-primary-purple)]">
          Step {stepNum} of {visibleSteps.length}
        </p>
        <h2 className="text-[22px] font-semibold text-[var(--color-deep-plum)] mt-0.5">
          {STEP_LABELS.deliverables}
        </h2>
        <p className="text-[13px] text-[var(--color-purple-gray)] mt-1">
          {STEP_DESCRIPTIONS.deliverables}
        </p>
      </header>

      {/* Reel count selector */}
      <section className="rounded-xl border border-[var(--color-lavender)] bg-white p-4 space-y-3">
        <div className="flex items-start gap-3">
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-[var(--color-lavender-tint)] text-[var(--color-primary-purple)] shrink-0">
            <Film size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-[var(--color-deep-plum)]">
              Sermon Reels
            </p>
            <p className="text-[12px] text-[var(--color-purple-gray)] mt-0.5">
              Short-form vertical clips with captions. Each one renders to MP4 via clipcutter. Coach picks 1-{SRP_MAX_REELS}.
            </p>
          </div>
          <div className="shrink-0 inline-flex items-center gap-1 rounded-full border border-[var(--color-lavender)] bg-white">
            <button
              type="button"
              onClick={() => setReels(reelCount - 1)}
              disabled={reelCount === 0}
              aria-label="Decrease reel count"
              className="w-8 h-8 inline-flex items-center justify-center text-[var(--color-purple-gray)] hover:text-[var(--color-deep-plum)] hover:bg-[var(--color-lavender-tint)] rounded-l-full disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <Minus size={13} />
            </button>
            <span className="w-8 text-center text-[14px] font-mono font-bold text-[var(--color-deep-plum)] tabular-nums">
              {reelCount}
            </span>
            <button
              type="button"
              onClick={() => setReels(reelCount + 1)}
              disabled={reelCount >= SRP_MAX_REELS}
              aria-label="Increase reel count"
              className="w-8 h-8 inline-flex items-center justify-center text-[var(--color-purple-gray)] hover:text-[var(--color-deep-plum)] hover:bg-[var(--color-lavender-tint)] rounded-r-full disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <Plus size={13} />
            </button>
          </div>
        </div>
        {reelCount > 0 && (
          <p className="text-[11px] text-[var(--color-primary-purple)] bg-[var(--color-lavender-tint)] rounded-md px-3 py-2">
            Workflow adds <strong>Clip Selection</strong> → <strong>Music &amp; edits</strong> → <strong>Reel Captions</strong> → <strong>Clip Processing</strong> steps to the sidebar.
          </p>
        )}
      </section>

      {/* Non-reel toggles */}
      <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {NON_REEL_OPTIONS.map(({ key, icon: Icon }) => {
          const selected = selectedDeliverables.includes(key)
          return (
            <button
              key={key}
              type="button"
              onClick={() => toggle(key)}
              className={[
                'text-left rounded-xl border p-4 transition-colors',
                selected
                  ? 'border-[var(--color-primary-purple)] bg-[var(--color-lavender-tint)]'
                  : 'border-[var(--color-lavender)] bg-white hover:bg-[var(--color-lavender-tint)]/40',
              ].join(' ')}
            >
              <div className="flex items-start gap-3">
                <span className={[
                  'inline-flex items-center justify-center w-9 h-9 rounded-full shrink-0',
                  selected
                    ? 'bg-[var(--color-primary-purple)] text-white'
                    : 'bg-[var(--color-lavender-tint)] text-[var(--color-primary-purple)]',
                ].join(' ')}>
                  <Icon size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold text-[var(--color-deep-plum)]">
                    {DELIVERABLE_LABELS[key]}
                  </p>
                  <p className="text-[12px] text-[var(--color-purple-gray)] mt-0.5">
                    {DELIVERABLE_DESCRIPTIONS[key]}
                  </p>
                </div>
                <span className={[
                  'shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full border-2 mt-0.5',
                  selected
                    ? 'border-[var(--color-primary-purple)] bg-[var(--color-primary-purple)]'
                    : 'border-[var(--color-lavender)] bg-white',
                ].join(' ')}>
                  {selected && (
                    <svg width={9} height={9} viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M1.5 5L4 7.5L8.5 2.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
              </div>
            </button>
          )
        })}
      </section>

      {/* Nav */}
      <div className="flex items-center justify-between gap-3 pt-2">
        <SrpButton
          variant="ghost"
          onClick={goToPrevStep}
          leadingIcon={<ArrowLeft size={14} />}
        >
          Back
        </SrpButton>
        <SrpButton
          disabled={!hasAny}
          onClick={goToNextStep}
          trailingIcon={<ArrowRight size={14} />}
        >
          Continue
        </SrpButton>
      </div>
    </div>
  )
}
