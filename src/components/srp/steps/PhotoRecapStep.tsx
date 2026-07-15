/**
 * Step 9 — Photo recap.
 *
 * Two prompt modes:
 *   highlights (default) — service experience, atmosphere, milestone moments
 *   teaching             — congregation photos + message reflection
 *
 * "Looking back" notes from the partner (ClickUp task field) are the
 * primary signal and should be filled in before generating.
 */

import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Loader2, Sparkles, RefreshCw, Check, Camera, BookOpen } from 'lucide-react'
import { useSrpWorkflow } from '../../../contexts/SrpWorkflowContext'
import { SrpButton } from '../_shared/SrpButton'
import { BrandVoiceTagsBadges } from '../_shared/BrandVoiceTagsBadges'
import { callSrpApi } from '../../../lib/srpApi'
import { STEP_LABELS, STEP_DESCRIPTIONS } from '../../../lib/srpSessions'
import { buildAccountContext } from '../../../lib/accountContext'

interface CaptionOption {
  text:           string
  brandVoiceTags: string[]
}
interface OptionsResponse { captions: CaptionOption[] }

/**
 * Extracts text between "LOOKING BACK" and the next section header
 * (all-caps line) in a ClickUp task description.
 */
function parseLookingBack(description: string): string {
  const lines = description.split('\n')
  let capturing = false
  const result: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (/^LOOKING BACK\s*$/i.test(trimmed)) { capturing = true; continue }
    if (capturing) {
      // Stop at next all-caps section header (e.g. "LOOKING AHEAD")
      if (/^[A-Z][A-Z\s]{3,}$/.test(trimmed) && trimmed === trimmed.toUpperCase()) break
      result.push(line)
    }
  }
  return result.join('\n').trim()
}

const PROMPT_TYPES = [
  {
    key:   'highlights' as const,
    label: 'Service highlights',
    hint:  'Atmosphere, milestone moments, baptisms, worship — the experience of being there.',
    icon:  Camera,
  },
  {
    key:   'teaching' as const,
    label: 'Weekend teaching',
    hint:  'Congregation photos paired with a reflection on the message and its application.',
    icon:  BookOpen,
  },
]

export function PhotoRecapStep() {
  const {
    account, sermonSubmission, brandVoice,
    transcript, keyInsights,
    clickupTaskId,
    photoRecapCaption, setPhotoRecapCaption,
    photoRecapInput, setPhotoRecapInput,
    autoDrafts,
    visibleSteps,
    goToNextStep, goToPrevStep,
  } = useSrpWorkflow()

  const [options, setOptions]       = useState<CaptionOption[]>(() => autoDrafts?.photoRecap ?? [])
  const [selectedIdx, setSelectedIdx] = useState<number | null>(photoRecapInput?.selectedIdx ?? null)
  const [tags, setTags]             = useState<string[]>([])
  const [generating, setGenerating] = useState(false)
  const [error, setError]           = useState<string | null>(null)

  const stepNum     = visibleSteps.indexOf('photoRecap') + 1
  const promptType  = photoRecapInput?.promptType ?? 'highlights'
  const lookingBack = photoRecapInput?.lookingBack ?? ''
  const guidance    = photoRecapInput?.guidance ?? ''

  // Auto-pull "LOOKING BACK" from the ClickUp task description on first load
  useEffect(() => {
    if (!clickupTaskId) return
    if (lookingBack) return  // already populated — don't overwrite
    ;(async () => {
      try {
        const r = await fetch(`/api/clickup/task-detail?taskId=${clickupTaskId}`)
        if (!r.ok) return
        const data = await r.json() as { description?: string }
        const desc = data.description ?? ''
        const extracted = parseLookingBack(desc)
        if (extracted) {
          setPhotoRecapInput({ ...photoRecapInput, lookingBack: extracted })
        }
      } catch {
        // non-fatal — coach can type manually
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clickupTaskId])

  const handleGenerate = useCallback(async () => {
    setGenerating(true); setError(null)
    try {
      const r = await callSrpApi<OptionsResponse>('generate-photo-recap', {
        transcript:     transcript || '',
        brandVoice,
        accountContext: buildAccountContext(account, sermonSubmission),
        promptType,
        lookingBack:    lookingBack || undefined,
        userGuidance:   guidance || undefined,
        keyInsights:    keyInsights.length ? keyInsights : undefined,
      })
      setOptions(r.captions ?? [])
      setSelectedIdx(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'generation failed')
    } finally {
      setGenerating(false)
    }
  }, [transcript, brandVoice, account, sermonSubmission, promptType, lookingBack, guidance, keyInsights])

  const pickOption = (idx: number) => {
    setSelectedIdx(idx)
    setPhotoRecapInput({ ...photoRecapInput, selectedIdx: idx, selectedTags: options[idx]?.brandVoiceTags })
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

      {/* Prompt type toggle */}
      <section className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {PROMPT_TYPES.map(({ key, label, hint, icon: Icon }) => {
          const picked = key === promptType
          return (
            <button
              key={key}
              type="button"
              onClick={() => setPhotoRecapInput({ ...photoRecapInput, promptType: key })}
              className={[
                'text-left rounded-xl border p-3 transition-colors',
                picked
                  ? 'border-[var(--color-primary-purple)] bg-[var(--color-lavender-tint)]'
                  : 'border-[var(--color-lavender)] bg-white hover:bg-[var(--color-lavender-tint)]/40',
              ].join(' ')}
            >
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <div className="flex items-center gap-2">
                  <Icon size={13} className={picked ? 'text-[var(--color-primary-purple)]' : 'text-[var(--color-purple-gray)]'} />
                  <p className="text-[13px] font-semibold text-[var(--color-deep-plum)]">{label}</p>
                </div>
                {picked && <Check size={12} className="text-[var(--color-primary-purple)]" />}
              </div>
              <p className="text-[11px] text-[var(--color-purple-gray)] pl-5">{hint}</p>
            </button>
          )
        })}
      </section>

      {/* Looking back — primary signal */}
      <section className="rounded-xl border border-[var(--color-lavender)] bg-white p-4 space-y-4">
        <div className="space-y-1.5">
          <label className="block text-[11px] uppercase tracking-widest font-bold text-[var(--color-deep-plum)]">
            Looking back — what happened this weekend?
          </label>
          <p className="text-[11px] text-[var(--color-purple-gray)]">
            Paste the partner's notes from the ClickUp task. Baptisms, salvations, big moments, how the room felt — the more specific, the better the captions.
          </p>
          <textarea
            value={lookingBack}
            onChange={e => setPhotoRecapInput({ ...photoRecapInput, lookingBack: e.target.value })}
            rows={5}
            placeholder="e.g. We had 3 baptisms this weekend. The worship set was electric — the room stayed in the bridge of 'Goodness of God' for like 5 minutes. First-time guests were up 40% from last week..."
            className="w-full rounded-lg border border-[var(--color-lavender)] bg-white px-3 py-2 text-[12px] text-[var(--color-deep-plum)] placeholder:text-[var(--color-purple-gray)] focus:outline-none focus:border-[var(--color-primary-purple)] focus:ring-2 focus:ring-[var(--color-lavender)] resize-y"
          />
        </div>

        <div className="space-y-1.5">
          <label className="block text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
            Additional guidance
          </label>
          <input
            type="text"
            value={guidance}
            onChange={e => setPhotoRecapInput({ ...photoRecapInput, guidance: e.target.value })}
            placeholder="e.g. lean into the baptism story, ask for tagged photos"
            className="w-full rounded-lg border border-[var(--color-lavender)] bg-white px-3 py-1.5 text-[12px] text-[var(--color-deep-plum)] placeholder:text-[var(--color-purple-gray)] focus:outline-none focus:border-[var(--color-primary-purple)] focus:ring-2 focus:ring-[var(--color-lavender)]"
          />
        </div>

        <SrpButton
          size="sm"
          onClick={() => void handleGenerate()}
          disabled={generating}
          leadingIcon={generating ? <Loader2 size={12} className="animate-spin" /> : (options.length ? <RefreshCw size={12} /> : <Sparkles size={12} />)}
        >
          {generating ? 'Generating…' : options.length ? 'Regenerate options' : 'Generate captions'}
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
