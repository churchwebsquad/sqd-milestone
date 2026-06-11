/**
 * Step 4 — Clip selection.
 *
 * Coach clicks "Generate clip suggestions" → /api/srp/generate-clips
 * returns up to 8 verbatim quotes across 5 categories (Profound Ideas,
 * Practical Application, Challenges, Encouragement, Life of Jesus).
 *
 * Coach picks N clips matching the reel count selected on Step 2.
 * Clips get clip_id assigned at pick time so downstream steps
 * (Reel Captions, Clip Processing) can reference them by id.
 *
 * Continue is gated on selecting EXACTLY the reel count.
 *
 * NOTE: The fine-grained ClipTrimEditor (cut regions out of clip
 * middles) is deferred to Batch 4 — for now coach picks whole clips
 * as the AI returns them.
 */

import { useCallback, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Loader2, Scissors, Sparkles, Check, X } from 'lucide-react'
import { useSrpWorkflow } from '../../../contexts/SrpWorkflowContext'
import { SrpButton } from '../_shared/SrpButton'
import { callSrpApi } from '../../../lib/srpApi'
import { STEP_LABELS, STEP_DESCRIPTIONS } from '../../../lib/srpSessions'
import { isSrpReelDeliverable, type SrpClipSelection } from '../../../types/database'
import { buildAccountContext } from '../../../lib/accountContext'

interface GenerateClipsResponse {
  clips: SrpClipSelection[]
  has_timecodes: boolean
  usage?: { input_tokens: number; output_tokens: number }
}

const CATEGORY_COLORS: Record<string, string> = {
  'Profound Ideas':        'bg-[#EDE9FC] text-[#341756]',
  'Practical Application': 'bg-[#D6F0E6] text-[#0F5132]',
  'Challenges':            'bg-[#FCE9E9] text-[#7A1F1F]',
  'Encouragement':         'bg-[#FFF1D6] text-[#7A5A0F]',
  'Life of Jesus':         'bg-[#E0E8FA] text-[#1F3A7A]',
}

export function ClipSelectionStep() {
  const {
    selectedDeliverables,
    account, sermonSubmission, brandVoice,
    transcript, hasTimecodes,
    clipSuggestions, setClipSuggestions,
    clipSelections, setClipSelections,
    visibleSteps,
    goToNextStep, goToPrevStep,
  } = useSrpWorkflow()

  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)

  const stepNum = visibleSteps.indexOf('clips') + 1
  const reelCount = useMemo(
    () => selectedDeliverables.filter(isSrpReelDeliverable).length,
    [selectedDeliverables],
  )

  const handleGenerate = useCallback(async () => {
    if (!transcript || transcript.trim().length < 200) {
      setGenError('Transcript too short. Go back to Step 3.')
      return
    }
    setGenerating(true); setGenError(null)
    try {
      const r = await callSrpApi<GenerateClipsResponse>('generate-clips', {
        transcript,
        brandVoice,
        accountContext: buildAccountContext(account, sermonSubmission),
        hasTimecodes,
      })
      setClipSuggestions(r.clips ?? [])
    } catch (e) {
      const err = e as Error & { errorCode?: string }
      setGenError(err.errorCode ? `${err.errorCode}: ${err.message}` : err.message)
    } finally {
      setGenerating(false)
    }
  }, [transcript, brandVoice, account, sermonSubmission, hasTimecodes, setClipSuggestions])

  // Pick / unpick a clip. Picks are stored with a stable clip_id so
  // downstream steps (reel captions, clipcutter) can reference them.
  const togglePick = useCallback((clip: SrpClipSelection) => {
    const idx = clipSelections.findIndex(c =>
      c.quote === clip.quote && (c.category ?? '') === (clip.category ?? ''),
    )
    if (idx >= 0) {
      const next = clipSelections.filter((_, i) => i !== idx)
      setClipSelections(next)
      return
    }
    if (clipSelections.length >= reelCount) {
      // Already at the cap — replace the last pick.
      const next = [...clipSelections.slice(0, reelCount - 1), assignClipId(clip, reelCount)]
      setClipSelections(next)
      return
    }
    setClipSelections([...clipSelections, assignClipId(clip, clipSelections.length + 1)])
  }, [clipSelections, reelCount, setClipSelections])

  const isPicked = useCallback((clip: SrpClipSelection): boolean => {
    return clipSelections.some(c =>
      c.quote === clip.quote && (c.category ?? '') === (clip.category ?? ''),
    )
  }, [clipSelections])

  const continueReady = clipSelections.length === reelCount && reelCount > 0

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-[var(--color-primary-purple)]">
          Step {stepNum} of {visibleSteps.length}
        </p>
        <h2 className="text-[22px] font-semibold text-[var(--color-deep-plum)] mt-0.5">
          {STEP_LABELS.clips}
        </h2>
        <p className="text-[13px] text-[var(--color-purple-gray)] mt-1">
          {STEP_DESCRIPTIONS.clips} · Pick {reelCount} clip{reelCount === 1 ? '' : 's'} to match your reel count.
        </p>
      </header>

      {/* Generate button */}
      <section className="rounded-xl border border-[var(--color-lavender)] bg-white p-4 flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-[var(--color-deep-plum)]">
            {clipSuggestions.length > 0 ? `${clipSuggestions.length} suggestions ready` : 'No suggestions yet'}
          </p>
          <p className="text-[11px] text-[var(--color-purple-gray)] mt-0.5">
            {hasTimecodes
              ? '30-70 second clips with MM:SS ranges from the transcript.'
              : '100-140 word clips (≈50-70 sec) by word count.'}
          </p>
        </div>
        <SrpButton
          size="sm"
          onClick={() => void handleGenerate()}
          disabled={generating || !transcript}
          leadingIcon={generating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
        >
          {generating ? 'Generating…' : clipSuggestions.length > 0 ? 'Regenerate' : 'Generate suggestions'}
        </SrpButton>
      </section>

      {genError && (
        <div className="rounded-lg border border-wm-danger/30 bg-wm-danger-bg px-4 py-3 text-[12px] text-wm-danger">{genError}</div>
      )}

      {/* Picked summary */}
      {clipSelections.length > 0 && (
        <section className="rounded-xl border border-[var(--color-primary-purple)]/30 bg-[var(--color-lavender-tint)] p-4">
          <p className="text-[11px] uppercase tracking-widest font-bold text-[var(--color-primary-purple)] mb-2">
            Picked {clipSelections.length} of {reelCount}
          </p>
          <ol className="space-y-1.5 text-[12px] text-[var(--color-deep-plum)]">
            {clipSelections.map((c, i) => (
              <li key={c.clip_id ?? `${i}-${c.quote?.slice(0, 30)}`} className="flex items-start gap-2">
                <span className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full bg-[var(--color-primary-purple)] text-white text-[10px] font-bold">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
                    {c.category ?? 'Uncategorized'}
                  </span>
                  <span className="block text-[12px] mt-0.5 line-clamp-2">{c.quote}</span>
                </span>
                <button
                  type="button"
                  onClick={() => togglePick(c)}
                  aria-label="Unpick"
                  className="shrink-0 text-[var(--color-purple-gray)] hover:text-wm-danger transition-colors"
                >
                  <X size={13} />
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Suggestions list */}
      {clipSuggestions.length > 0 && (
        <section className="space-y-3">
          <p className="text-[11px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
            All suggestions
          </p>
          <ul className="space-y-2.5">
            {clipSuggestions.map((c, i) => {
              const picked = isPicked(c)
              const catColor = CATEGORY_COLORS[c.category ?? ''] ?? 'bg-[var(--color-lavender-tint)] text-[var(--color-deep-plum)]'
              return (
                <li key={`${i}-${c.quote?.slice(0, 40)}`}>
                  <button
                    type="button"
                    onClick={() => togglePick(c)}
                    className={[
                      'w-full text-left rounded-xl border px-4 py-3 transition-colors',
                      picked
                        ? 'border-[var(--color-primary-purple)] bg-[var(--color-lavender-tint)]'
                        : 'border-[var(--color-lavender)] bg-white hover:bg-[var(--color-lavender-tint)]/40',
                    ].join(' ')}
                  >
                    <div className="flex items-start gap-3">
                      <span className={[
                        'shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full',
                        picked
                          ? 'bg-[var(--color-primary-purple)] text-white'
                          : 'bg-[var(--color-lavender-tint)] text-[var(--color-primary-purple)]',
                      ].join(' ')}>
                        {picked ? <Check size={11} strokeWidth={3} /> : <Scissors size={11} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1.5">
                          {c.category && (
                            <span className={['text-[10px] uppercase tracking-wider font-bold rounded-full px-2 py-0.5', catColor].join(' ')}>
                              {c.category}
                            </span>
                          )}
                          {c.startTime && c.endTime && (
                            <span className="text-[10px] font-mono text-[var(--color-purple-gray)]">
                              {c.startTime} → {c.endTime}
                            </span>
                          )}
                          {typeof c.estimatedSeconds === 'number' && (
                            <span className="text-[10px] font-mono text-[var(--color-purple-gray)]">
                              ≈ {c.estimatedSeconds}s
                            </span>
                          )}
                          {typeof c.wordCount === 'number' && (
                            <span className="text-[10px] font-mono text-[var(--color-purple-gray)]">
                              {c.wordCount} words
                            </span>
                          )}
                        </div>
                        <p className="text-[13px] text-[var(--color-deep-plum)] leading-snug">
                          “{c.quote}”
                        </p>
                      </div>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

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
          disabled={!continueReady}
          onClick={goToNextStep}
          trailingIcon={<ArrowRight size={14} />}
        >
          Continue {continueReady ? '' : `(${clipSelections.length}/${reelCount} picked)`}
        </SrpButton>
      </div>
    </div>
  )
}

/** Stable id so downstream steps can refer to a pick by id, not by
 *  array index (which would shift as the coach unpicks earlier clips). */
function assignClipId(clip: SrpClipSelection, slotNumber: number): SrpClipSelection {
  return {
    ...clip,
    clip_id: clip.clip_id ?? `clip_${slotNumber}_${Date.now().toString(36)}`,
  }
}
