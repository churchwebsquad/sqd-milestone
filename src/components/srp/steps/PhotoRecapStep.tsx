/**
 * Step 9 — Photo recap.
 *
 * Two-phase: coach picks a category first (system prompt branches on
 * it), then generates 3-5 captions. Each option has text +
 * brandVoiceTags. Coach picks one, edits text, saves to
 * sessions.photo_recap_caption.
 */

import { useCallback, useState } from 'react'
import { ArrowLeft, ArrowRight, Loader2, Sparkles, RefreshCw, Check } from 'lucide-react'
import { useSrpWorkflow } from '../../../contexts/SrpWorkflowContext'
import { SrpButton } from '../_shared/SrpButton'
import { BrandVoiceTagsBadges } from '../_shared/BrandVoiceTagsBadges'
import { callSrpApi } from '../../../lib/srpApi'
import { STEP_LABELS, STEP_DESCRIPTIONS } from '../../../lib/srpSessions'
import { buildAccountContext } from '../../../lib/accountContext'
import type { SrpPhotoRecapInput } from '../../../types/database'

interface CaptionOption {
  text:           string
  brandVoiceTags: string[]
}
interface OptionsResponse { captions: CaptionOption[] }

const CATEGORIES: Array<{ key: NonNullable<SrpPhotoRecapInput['category']>; label: string; hint: string }> = [
  { key: 'serviceHighlights',  label: 'Service highlights',  hint: 'Baptisms, worship moments, child dedications.' },
  { key: 'weekendTeaching',    label: 'Weekend teaching',    hint: 'Recap of the sermon\'s key points.' },
  { key: 'seriesStartEnd',     label: 'Series start / end',  hint: 'Kicking off or wrapping a sermon series.' },
  { key: 'generalCelebration', label: 'General Sunday vibe', hint: 'Catch-all when the day was a mood.' },
]

export function PhotoRecapStep() {
  const {
    account, sermonSubmission, brandVoice,
    transcript,
    photoRecapCaption, setPhotoRecapCaption,
    photoRecapInput, setPhotoRecapInput,
    visibleSteps,
    goToNextStep, goToPrevStep,
  } = useSrpWorkflow()

  const [options, setOptions] = useState<CaptionOption[]>([])
  const [selectedIdx, setSelectedIdx] = useState<number | null>(photoRecapInput?.selectedIdx ?? null)
  const [tags, setTags] = useState<string[]>([])
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const stepNum = visibleSteps.indexOf('photoRecap') + 1
  const category = photoRecapInput?.category ?? 'generalCelebration'
  const guidance = photoRecapInput?.guidance ?? ''

  const handleGenerate = useCallback(async () => {
    setGenerating(true); setError(null)
    try {
      const r = await callSrpApi<OptionsResponse>('generate-photo-recap', {
        transcript:     transcript || '',
        brandVoice,
        accountContext: buildAccountContext(account, sermonSubmission),
        category,
        userGuidance:   guidance || undefined,
      })
      setOptions(r.captions ?? [])
      setSelectedIdx(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'generation failed')
    } finally {
      setGenerating(false)
    }
  }, [transcript, brandVoice, account, sermonSubmission, category, guidance])

  const pickOption = (idx: number) => {
    setSelectedIdx(idx)
    setPhotoRecapInput({
      ...photoRecapInput,
      selectedIdx: idx,
      selectedTags: options[idx]?.brandVoiceTags,
    })
    setPhotoRecapCaption(options[idx]?.text ?? null)
    setTags(options[idx]?.brandVoiceTags ?? [])
  }

  const canContinue = (photoRecapCaption?.trim().length ?? 0) > 0

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-[var(--color-primary-purple)]">
          Step {stepNum} of {visibleSteps.length}
        </p>
        <h2 className="text-[22px] font-semibold text-[var(--color-deep-plum)] mt-0.5">{STEP_LABELS.photoRecap}</h2>
        <p className="text-[13px] text-[var(--color-purple-gray)] mt-1">{STEP_DESCRIPTIONS.photoRecap}</p>
      </header>

      {/* Category picker */}
      <section className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {CATEGORIES.map(({ key, label, hint }) => {
          const picked = key === category
          return (
            <button
              key={key}
              type="button"
              onClick={() => setPhotoRecapInput({ ...photoRecapInput, category: key })}
              className={[
                'text-left rounded-xl border p-3 transition-colors',
                picked
                  ? 'border-[var(--color-primary-purple)] bg-[var(--color-lavender-tint)]'
                  : 'border-[var(--color-lavender)] bg-white hover:bg-[var(--color-lavender-tint)]/40',
              ].join(' ')}
            >
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <p className="text-[13px] font-semibold text-[var(--color-deep-plum)]">
                  {label}
                </p>
                {picked && <Check size={12} className="text-[var(--color-primary-purple)]" />}
              </div>
              <p className="text-[11px] text-[var(--color-purple-gray)]">{hint}</p>
            </button>
          )
        })}
      </section>

      <section className="rounded-xl border border-[var(--color-lavender)] bg-white p-4 space-y-3">
        <div className="space-y-2">
          <label className="block text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
            Optional guidance
          </label>
          <input
            type="text"
            value={guidance}
            onChange={e => setPhotoRecapInput({ ...photoRecapInput, guidance: e.target.value })}
            placeholder="e.g. mention the baptisms, ask for tagged photos"
            className="w-full rounded-lg border border-[var(--color-lavender)] bg-white px-3 py-1.5 text-[12px] text-[var(--color-deep-plum)] placeholder:text-[var(--color-purple-gray)] focus:outline-none focus:border-[var(--color-primary-purple)] focus:ring-2 focus:ring-[var(--color-lavender)]"
          />
        </div>
        <SrpButton
          size="sm"
          onClick={() => void handleGenerate()}
          disabled={generating}
          leadingIcon={generating ? <Loader2 size={12} className="animate-spin" /> : (options.length ? <RefreshCw size={12} /> : <Sparkles size={12} />)}
        >
          {generating ? 'Generating…' : options.length ? 'Regenerate' : 'Generate captions'}
        </SrpButton>
      </section>

      {error && (
        <div className="rounded-lg border border-wm-danger/30 bg-wm-danger-bg px-4 py-3 text-[12px] text-wm-danger">{error}</div>
      )}

      {options.length > 0 && (
        <section className="space-y-2">
          <p className="text-[11px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">Options</p>
          <ul className="space-y-2">
            {options.map((opt, i) => {
              const picked = i === selectedIdx
              return (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => pickOption(i)}
                    className={[
                      'w-full text-left rounded-xl border p-3 transition-colors',
                      picked
                        ? 'border-[var(--color-primary-purple)] bg-[var(--color-lavender-tint)]'
                        : 'border-[var(--color-lavender)] bg-white hover:bg-[var(--color-lavender-tint)]/40',
                    ].join(' ')}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
                        Option {i + 1}
                      </span>
                      {picked && <Check size={12} className="text-[var(--color-primary-purple)]" />}
                    </div>
                    <p className="text-[13px] text-[var(--color-deep-plum)] whitespace-pre-wrap leading-snug">{opt.text}</p>
                    <div className="mt-2 pt-2 border-t border-[var(--color-lavender)]">
                      <BrandVoiceTagsBadges tags={opt.brandVoiceTags} />
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {photoRecapCaption && selectedIdx != null && (
        <section className="rounded-xl border border-[var(--color-lavender)] bg-white p-4 space-y-3">
          <p className="text-[11px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
            Picked caption (editable)
          </p>
          <textarea
            value={photoRecapCaption}
            onChange={e => setPhotoRecapCaption(e.target.value)}
            rows={6}
            className="w-full rounded-lg border border-[var(--color-lavender)] bg-white p-3 text-[13px] text-[var(--color-deep-plum)] focus:outline-none focus:border-[var(--color-primary-purple)] focus:ring-2 focus:ring-[var(--color-lavender)] resize-y"
          />
          <BrandVoiceTagsBadges tags={tags} />
        </section>
      )}

      <div className="flex items-center justify-between gap-3 pt-2">
        <SrpButton variant="ghost" onClick={goToPrevStep} leadingIcon={<ArrowLeft size={14} />}>Back</SrpButton>
        <SrpButton disabled={!canContinue} onClick={goToNextStep} trailingIcon={<ArrowRight size={14} />}>Continue</SrpButton>
      </div>
    </div>
  )
}
