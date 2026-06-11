/**
 * Step 5 — Reel captions.
 *
 * One panel per picked clip. Each panel has:
 *   - The verbatim quote from Step 4 (context)
 *   - An optional userGuidance input (regenerate with steering)
 *   - "Generate caption" button → /api/srp/generate-reel-caption
 *   - Returned caption + brandVoiceTags rendered as badges
 *   - Editable textarea — final caption persists to sessions.reel{N}_caption
 *
 * Continue is gated on every picked clip having a saved caption.
 */

import { useCallback, useState } from 'react'
import { ArrowLeft, ArrowRight, Loader2, Sparkles, RefreshCw } from 'lucide-react'
import { useSrpWorkflow } from '../../../contexts/SrpWorkflowContext'
import { SrpButton } from '../_shared/SrpButton'
import { BrandVoiceTagsBadges } from '../_shared/BrandVoiceTagsBadges'
import { callSrpApi } from '../../../lib/srpApi'
import { STEP_LABELS, STEP_DESCRIPTIONS } from '../../../lib/srpSessions'
import { buildAccountContext } from '../../../lib/accountContext'
import { SRP_MAX_REELS, type SrpClipSelection } from '../../../types/database'

interface CaptionResponse {
  caption: string
  brandVoiceTags: string[]
}

export function ReelCaptionsStep() {
  const {
    account, sermonSubmission, brandVoice,
    clipSelections,
    reel1Caption, reel2Caption, setReelCaption,
    reelGuidance, setReelGuidance,
    visibleSteps,
    goToNextStep, goToPrevStep,
  } = useSrpWorkflow()

  const stepNum = visibleSteps.indexOf('reelCaptions') + 1

  // Captions are persisted to reel{1,2}_caption only (schema limit).
  const captions: (string | null)[] = [reel1Caption, reel2Caption]
  // Cap at the schema limit even if Step 4 picked more.
  const picks = clipSelections.slice(0, SRP_MAX_REELS)
  const allCaptioned = picks.length > 0 && picks.every((_, i) => (captions[i] ?? '').trim().length > 0)

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-[var(--color-primary-purple)]">
          Step {stepNum} of {visibleSteps.length}
        </p>
        <h2 className="text-[22px] font-semibold text-[var(--color-deep-plum)] mt-0.5">
          {STEP_LABELS.reelCaptions}
        </h2>
        <p className="text-[13px] text-[var(--color-purple-gray)] mt-1">
          {STEP_DESCRIPTIONS.reelCaptions} · Generate one caption per picked clip.
        </p>
      </header>

      {picks.length === 0 && (
        <div className="rounded-xl border border-dashed border-[var(--color-lavender)] bg-white p-8 text-center">
          <p className="text-[13px] text-[var(--color-purple-gray)]">
            No clips picked. Go back to <strong>Clip Selection</strong> first.
          </p>
        </div>
      )}

      {picks.map((clip, i) => (
        <ReelPanel
          key={clip.clip_id ?? `${i}-${clip.quote?.slice(0, 24)}`}
          index={i}
          clip={clip}
          caption={captions[i] ?? ''}
          onCaptionChange={(v) => setReelCaption((i + 1) as 1 | 2, v || null)}
          guidance={reelGuidance[i] ?? ''}
          onGuidanceChange={(v) => setReelGuidance({ ...reelGuidance, [i]: v })}
          brandVoice={brandVoice}
          accountContext={buildAccountContext(account, sermonSubmission)}
        />
      ))}

      <div className="flex items-center justify-between gap-3 pt-2">
        <SrpButton variant="ghost" onClick={goToPrevStep} leadingIcon={<ArrowLeft size={14} />}>
          Back
        </SrpButton>
        <SrpButton disabled={!allCaptioned} onClick={goToNextStep} trailingIcon={<ArrowRight size={14} />}>
          Continue
        </SrpButton>
      </div>
    </div>
  )
}

function ReelPanel({
  index, clip, caption, onCaptionChange,
  guidance, onGuidanceChange,
  brandVoice, accountContext,
}: {
  index: number
  clip: SrpClipSelection
  caption: string
  onCaptionChange: (v: string) => void
  guidance: string
  onGuidanceChange: (v: string) => void
  brandVoice: string
  accountContext: ReturnType<typeof buildAccountContext>
}) {
  const [generating, setGenerating] = useState(false)
  const [tags, setTags] = useState<string[]>([])
  const [genError, setGenError] = useState<string | null>(null)

  const handleGenerate = useCallback(async () => {
    if (!clip.quote) return
    setGenerating(true); setGenError(null)
    try {
      const r = await callSrpApi<CaptionResponse>('generate-reel-caption', {
        quote:          clip.quote,
        brandVoice,
        accountContext,
        userGuidance:   guidance || undefined,
      })
      onCaptionChange(r.caption)
      setTags(r.brandVoiceTags ?? [])
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'caption generation failed')
    } finally {
      setGenerating(false)
    }
  }, [clip.quote, brandVoice, accountContext, guidance, onCaptionChange])

  return (
    <section className="rounded-xl border border-[var(--color-lavender)] bg-white p-5 space-y-4">
      <header className="flex items-start gap-3">
        <span className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full bg-[var(--color-primary-purple)] text-white text-[12px] font-bold">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
            Reel {index + 1} · {clip.category ?? 'Uncategorized'}
            {clip.startTime && clip.endTime && (
              <span className="ml-2 font-mono normal-case text-[9px]">
                {clip.startTime} → {clip.endTime}
              </span>
            )}
          </p>
          <p className="text-[13px] text-[var(--color-deep-plum)] mt-1 leading-snug italic">
            &ldquo;{clip.quote}&rdquo;
          </p>
        </div>
      </header>

      <div className="space-y-2">
        <label className="block text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
          Optional guidance for this reel
        </label>
        <input
          type="text"
          value={guidance}
          onChange={e => onGuidanceChange(e.target.value)}
          placeholder="e.g. lean into the question, keep it under 80 chars"
          className="w-full rounded-lg border border-[var(--color-lavender)] bg-white px-3 py-1.5 text-[12px] text-[var(--color-deep-plum)] placeholder:text-[var(--color-purple-gray)] focus:outline-none focus:border-[var(--color-primary-purple)] focus:ring-2 focus:ring-[var(--color-lavender)]"
        />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <SrpButton
          size="sm"
          onClick={() => void handleGenerate()}
          disabled={generating || !clip.quote}
          leadingIcon={generating ? <Loader2 size={12} className="animate-spin" /> : (caption ? <RefreshCw size={12} /> : <Sparkles size={12} />)}
        >
          {generating ? 'Generating…' : caption ? 'Regenerate' : 'Generate caption'}
        </SrpButton>
        {genError && <span className="text-[11px] text-wm-danger">{genError}</span>}
      </div>

      {caption && (
        <div className="space-y-2">
          <label className="block text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
            Caption (editable)
          </label>
          <textarea
            value={caption}
            onChange={e => onCaptionChange(e.target.value)}
            rows={4}
            className="w-full rounded-lg border border-[var(--color-lavender)] bg-white p-3 text-[13px] text-[var(--color-deep-plum)] focus:outline-none focus:border-[var(--color-primary-purple)] focus:ring-2 focus:ring-[var(--color-lavender)] resize-y"
          />
          <BrandVoiceTagsBadges tags={tags} />
        </div>
      )}
    </section>
  )
}
