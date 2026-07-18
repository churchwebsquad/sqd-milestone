/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Reel captions step — one panel per picked clip.
 *
 * Captions are stored as social_caption on each SrpClipSelection in the
 * clip_selections JSONB blob. Supports any number of reels dynamically.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  ArrowLeft, ArrowRight, Loader2, Sparkles, RefreshCw,
  ChevronDown, ChevronUp, BookOpen, Clock, CheckCircle2,
} from 'lucide-react'
import { useSrpWorkflow } from '../../../contexts/SrpWorkflowContext'
import { SrpButton } from '../_shared/SrpButton'
import { BrandVoiceTagsBadges } from '../_shared/BrandVoiceTagsBadges'
import { callSrpApi } from '../../../lib/srpApi'
import { STEP_LABELS, STEP_DESCRIPTIONS, srpPipeline } from '../../../lib/srpSessions'
import { buildAccountContext } from '../../../lib/accountContext'
import { SRP_MAX_REELS, isSrpReelDeliverable, type SrpClipSelection } from '../../../types/database'

interface CaptionResponse {
  caption: string
  brandVoiceTags: string[]
}

// ── Previous week loader ──────────────────────────────────────────────────────

async function loadPrevWeekCaptions(member: number, currentSessionId: string): Promise<(string | null)[]> {
  // Look at the most recent OTHER session for this church that has at least one caption.
  // Don't gate on status='completed' — coaches rarely mark sessions complete.
  const { data } = await (srpPipeline as any)
    .from('sessions')
    .select('clip_selections, session_id')
    .eq('member', member)
    .neq('session_id', currentSessionId)
    .not('clickup_task_id', 'is', null) // only task sessions (not holding sessions)
    .order('updated_at', { ascending: false })
    .limit(10) // grab a few to find one with captions
  if (!data || !Array.isArray(data)) return []
  for (const row of data) {
    const clips: SrpClipSelection[] = Array.isArray(row.clip_selections) ? row.clip_selections : []
    const captions = clips.map(c => c.social_caption ?? null)
    if (captions.some(c => c)) return captions
  }
  return []
}

// ── Brand voice reference panel ───────────────────────────────────────────────

function BrandVoicePanel({ brandVoice }: { brandVoice: string }) {
  const [open, setOpen] = useState(false)
  if (!brandVoice) return null
  return (
    <div className="rounded-xl border border-[var(--color-lavender)] bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-3 hover:bg-[var(--color-lavender-tint)] transition-colors"
      >
        <BookOpen size={13} className="text-[var(--color-primary-purple)] shrink-0" />
        <span className="text-[11px] font-semibold text-[var(--color-deep-plum)] flex-1 text-left">
          Brand voice reference
        </span>
        <span className="text-[10px] text-[var(--color-purple-gray)]">{open ? 'hide' : 'show'}</span>
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
      {open && (
        <div className="border-t border-[var(--color-lavender)] px-4 py-3">
          <pre className="text-[11px] text-[var(--color-deep-plum)] whitespace-pre-wrap font-sans leading-relaxed">
            {brandVoice}
          </pre>
        </div>
      )}
    </div>
  )
}

// ── Main step ─────────────────────────────────────────────────────────────────

export function ReelCaptionsStep() {
  const {
    account, sermonSubmission, brandVoice,
    sessionId,
    selectedDeliverables,
    clipSelections,
    updateClipSocialCaption,
    updateClipCaptionApproved,
    keyInsights,
    reelGuidance, setReelGuidance,
    visibleSteps,
    goToNextStep, goToPrevStep,
  } = useSrpWorkflow()

  const stepNum   = visibleSteps.indexOf('reelCaptions') + 1
  const reelCount = selectedDeliverables.filter(isSrpReelDeliverable).length
  const picks     = clipSelections.slice(0, reelCount || SRP_MAX_REELS)
  const allApproved = picks.length > 0 && picks.every(c => c.caption_approved === true)

  const [prevCaptions, setPrevCaptions] = useState<(string | null)[]>([])

  useEffect(() => {
    const member = account?.member
    if (!member || !sessionId) return
    loadPrevWeekCaptions(member, sessionId)
      .then(setPrevCaptions)
      .catch(() => {/* non-fatal */})
  }, [account?.member, sessionId])

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

      <BrandVoicePanel brandVoice={brandVoice} />

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
          caption={clip.social_caption ?? ''}
          approved={clip.caption_approved === true}
          onCaptionChange={v => {
            updateClipSocialCaption(clip.clip_id!, v || null)
            if (clip.caption_approved) updateClipCaptionApproved(clip.clip_id!, false)
          }}
          onApprove={() => updateClipCaptionApproved(clip.clip_id!, true)}
          onUnapprove={() => updateClipCaptionApproved(clip.clip_id!, false)}
          guidance={reelGuidance[i] ?? ''}
          onGuidanceChange={v => setReelGuidance({ ...reelGuidance, [i]: v })}
          prevCaption={prevCaptions[i] ?? null}
          brandVoice={brandVoice}
          keyInsights={keyInsights}
          accountContext={buildAccountContext(account, sermonSubmission)}
        />
      ))}

      <div className="flex items-center justify-between gap-3 pt-2">
        <SrpButton variant="ghost" onClick={goToPrevStep} leadingIcon={<ArrowLeft size={14} />}>
          Back
        </SrpButton>
        <SrpButton disabled={!allApproved} onClick={goToNextStep} trailingIcon={<ArrowRight size={14} />}>
          Continue
        </SrpButton>
      </div>
    </div>
  )
}

// ── Per-clip panel ────────────────────────────────────────────────────────────

function ReelPanel({
  index, clip, caption, approved, onCaptionChange, onApprove, onUnapprove,
  guidance, onGuidanceChange,
  prevCaption, brandVoice, keyInsights, accountContext,
}: {
  index: number
  clip: SrpClipSelection
  caption: string
  approved: boolean
  onCaptionChange: (v: string) => void
  onApprove: () => void
  onUnapprove: () => void
  guidance: string
  onGuidanceChange: (v: string) => void
  prevCaption: string | null
  brandVoice: string
  keyInsights: string[]
  accountContext: ReturnType<typeof buildAccountContext>
}) {
  const [generating, setGenerating] = useState(false)
  const [tags, setTags]             = useState<string[]>([])
  const [genError, setGenError]     = useState<string | null>(null)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const captionAngle = (clip as any).caption_angle as string | undefined

  const handleGenerate = useCallback(async () => {
    if (!clip.quote) return
    setGenerating(true); setGenError(null)
    try {
      const r = await callSrpApi<CaptionResponse>('generate-reel-caption', {
        quote:        clip.quote,
        brandVoice,
        accountContext,
        userGuidance: guidance || undefined,
        captionAngle: captionAngle || undefined,
        keyInsights:  keyInsights.length ? keyInsights : undefined,
      })
      onCaptionChange(r.caption)
      setTags(r.brandVoiceTags ?? [])
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'caption generation failed')
    } finally {
      setGenerating(false)
    }
  }, [clip.quote, brandVoice, accountContext, guidance, captionAngle, keyInsights, onCaptionChange])

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

      {captionAngle && (
        <div className="flex items-start gap-2 rounded-lg bg-[var(--color-lavender-tint)] border border-[var(--color-lavender)] px-3 py-2">
          <Sparkles size={11} className="text-[var(--color-primary-purple)] mt-0.5 shrink-0" />
          <p className="text-[11px] text-[var(--color-deep-plum)]">
            <span className="font-semibold text-[var(--color-primary-purple)]">Suggested angle: </span>
            {captionAngle}
          </p>
        </div>
      )}

      {prevCaption && (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--color-lavender)] px-3 py-2.5">
          <Clock size={11} className="text-[var(--color-purple-gray)] mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wider font-bold text-[var(--color-purple-gray)] mb-1">
              Last week's caption
            </p>
            <p className="text-[11px] text-[var(--color-deep-plum)] whitespace-pre-wrap leading-relaxed">
              {prevCaption}
            </p>
            <button
              type="button"
              onClick={() => onCaptionChange(prevCaption)}
              className="mt-1.5 text-[10px] text-[var(--color-primary-purple)] hover:underline font-semibold"
            >
              Use as starting point →
            </button>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <label className="block text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
          Optional guidance
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
          leadingIcon={generating
            ? <Loader2 size={12} className="animate-spin" />
            : caption ? <RefreshCw size={12} /> : <Sparkles size={12} />
          }
        >
          {generating ? 'Generating…' : caption ? 'Regenerate' : 'Generate caption'}
        </SrpButton>
        {genError && <span className="text-[11px] text-wm-danger">{genError}</span>}
      </div>

      {caption && (
        <div className="space-y-2">
          <label className="block text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
            Caption
          </label>
          <textarea
            value={caption}
            onChange={e => onCaptionChange(e.target.value)}
            rows={5}
            disabled={approved}
            className="w-full rounded-lg border border-[var(--color-lavender)] bg-white p-3 text-[13px] text-[var(--color-deep-plum)] focus:outline-none focus:border-[var(--color-primary-purple)] focus:ring-2 focus:ring-[var(--color-lavender)] resize-y disabled:opacity-60 disabled:cursor-not-allowed"
          />
          <BrandVoiceTagsBadges tags={tags} />

          {approved ? (
            <div className="flex items-center justify-between gap-3 pt-1">
              <div className="flex items-center gap-1.5 text-emerald-600">
                <CheckCircle2 size={15} />
                <span className="text-[12px] font-semibold">Caption approved</span>
              </div>
              <button
                type="button"
                onClick={onUnapprove}
                className="text-[11px] text-[var(--color-purple-gray)] hover:text-[var(--color-deep-plum)] underline underline-offset-2 transition-colors"
              >
                Retry / change
              </button>
            </div>
          ) : (
            <div className="pt-1">
              <SrpButton size="sm" onClick={onApprove} leadingIcon={<CheckCircle2 size={12} />}>
                Approve caption
              </SrpButton>
            </div>
          )}
        </div>
      )}

    </section>
  )
}
