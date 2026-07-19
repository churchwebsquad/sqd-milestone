/**
 * Step 9 — Photo recap.
 *
 * Two prompt modes:
 *   highlights (default) — service experience, atmosphere, milestone moments
 *   teaching             — congregation photos + message reflection
 *
 * Options are pre-generated in the background (auto-generate fires on sermon confirm).
 * "Looking back" notes from the partner (ClickUp task field) are the primary signal.
 * Coach picks one, approves it, edits if needed, or refines with AI guidance.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Loader2, Sparkles, RefreshCw, Check, Camera, BookOpen, Pencil } from 'lucide-react'
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

function parseLookingBack(description: string): string {
  const parts = description.split(/Looking Back\s*:?\s*/i)
  if (parts.length < 2) return ''
  const after = parts[1]
  const stop = after.search(/\n\s*(?:Looking Ahead|Get the Photos|Creative Direction|General Info|Administrative)/i)
  const content = stop !== -1 ? after.slice(0, stop) : after
  return content.split('\n')
    .filter(l => !/love to hear/i.test(l))
    .join('\n')
    .trim()
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

  const [options, setOptions]             = useState<CaptionOption[]>(() => autoDrafts?.photoRecap ?? [])

  useEffect(() => {
    if (autoDrafts?.photoRecap?.length && !options.length) setOptions(autoDrafts.photoRecap)
  }, [autoDrafts?.photoRecap]) // eslint-disable-line react-hooks/exhaustive-deps
  const [selectedIdx, setSelectedIdx]     = useState<number | null>(photoRecapInput?.selectedIdx ?? null)
  const [tags, setTags]                   = useState<string[]>(photoRecapInput?.selectedTags ?? [])
  const [approved, setApproved]           = useState(false)
  const [editing, setEditing]             = useState(false)
  const [generating, setGenerating]       = useState(false)
  const [refining, setRefining]           = useState(false)
  const [refineGuidance, setRefineGuidance] = useState('')
  const [error, setError]                 = useState<string | null>(null)
  const [fetchStatus, setFetchStatus]     = useState<'idle' | 'loading' | 'found' | 'blank' | 'no-task'>('idle')
  const [rawLookingBack, setRawLookingBack] = useState<string>('')
  const fetchStarted = useRef(false)

  const stepNum    = visibleSteps.indexOf('photoRecap') + 1
  const promptType = photoRecapInput?.promptType ?? 'highlights'
  const lookingBack = photoRecapInput?.lookingBack ?? ''
  const guidance    = photoRecapInput?.guidance ?? ''

  // Auto-pull "LOOKING BACK" from the ClickUp task description on first load
  useEffect(() => {
    if (!clickupTaskId) return  // wait for session to load
    if (fetchStarted.current) return
    fetchStarted.current = true
    setFetchStatus('loading')
    ;(async () => {
      try {
        const r = await fetch(`/api/clickup/task-detail?taskId=${clickupTaskId}`)
        if (!r.ok) { setFetchStatus('blank'); return }
        const data = await r.json() as { description?: string }
        const extracted = parseLookingBack(data.description ?? '')
        setRawLookingBack(extracted)
        if (extracted) {
          setFetchStatus('found')
          if (!lookingBack) setPhotoRecapInput({ ...photoRecapInput, lookingBack: extracted })
        } else {
          setFetchStatus('blank')
        }
      } catch {
        setFetchStatus('blank')
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
      setApproved(false)
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'generation failed')
    } finally {
      setGenerating(false)
    }
  }, [transcript, brandVoice, account, sermonSubmission, promptType, lookingBack, guidance, keyInsights])

  const handleRefine = useCallback(async () => {
    if (!photoRecapCaption) return
    setRefining(true); setError(null)
    try {
      const r = await callSrpApi<OptionsResponse>('generate-photo-recap', {
        transcript:     transcript || '',
        brandVoice,
        accountContext: buildAccountContext(account, sermonSubmission),
        promptType,
        lookingBack:    lookingBack || undefined,
        userGuidance:   `Starting from this draft:\n\n${photoRecapCaption}\n\nDirection: ${refineGuidance || 'improve it'}`,
        keyInsights:    keyInsights.length ? keyInsights : undefined,
      })
      const first = r.captions?.[0]
      if (first) {
        setPhotoRecapCaption(first.text)
        setTags(first.brandVoiceTags ?? [])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'refinement failed')
    } finally {
      setRefining(false)
    }
  }, [photoRecapCaption, transcript, brandVoice, account, sermonSubmission, promptType, lookingBack, refineGuidance, keyInsights, setPhotoRecapCaption])

  const pickOption = (idx: number) => {
    setSelectedIdx(idx)
    setPhotoRecapInput({ ...photoRecapInput, selectedIdx: idx, selectedTags: options[idx]?.brandVoiceTags })
    setPhotoRecapCaption(options[idx]?.text ?? null)
    setTags(options[idx]?.brandVoiceTags ?? [])
    setApproved(false)
    setEditing(false)
  }

  const canContinue = approved && (photoRecapCaption?.trim().length ?? 0) > 0

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
      {!approved && (
        <section className="rounded-xl border border-[var(--color-lavender)] bg-white p-4 space-y-4">
          <div className="space-y-1.5">
            <label className="block text-[11px] uppercase tracking-widest font-bold text-[var(--color-deep-plum)]">
              Looking back — what happened this weekend?
            </label>

            {fetchStatus === 'loading' && (
              <p className="text-[11px] text-[var(--color-purple-gray)] flex items-center gap-1.5">
                <Loader2 size={11} className="animate-spin" /> Checking ClickUp for Looking Back notes...
              </p>
            )}
            {fetchStatus === 'found' && rawLookingBack && (
              <div className="rounded-lg border border-[var(--color-lavender)] bg-[var(--color-lavender-tint)] px-3 py-2 space-y-0.5">
                <p className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-primary-purple)]">From ClickUp — Looking Back</p>
                <p className="text-[12px] text-[var(--color-deep-plum)] whitespace-pre-wrap leading-relaxed">{rawLookingBack}</p>
              </div>
            )}
            {fetchStatus === 'blank' && (
              <p className="text-[11px] text-[var(--color-purple-gray)]">
                Looking Back was blank in this ClickUp task. Add highlights below.
              </p>
            )}

            <p className="text-[11px] text-[var(--color-purple-gray)]">
              Add or edit below. The more specific, the better the captions.
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
              Guidance for all options
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
      )}

      {error && (
        <div className="rounded-lg border border-wm-danger/30 bg-wm-danger-bg px-4 py-3 text-[12px] text-wm-danger">{error}</div>
      )}

      {/* Option cards — hidden once approved */}
      {!approved && options.length > 0 && (
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

      {/* Edit + approve panel */}
      {photoRecapCaption && selectedIdx != null && !approved && (
        <section className="rounded-xl border border-[var(--color-lavender)] bg-white p-4 space-y-3">
          <p className="text-[11px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
            Selected caption
          </p>
          <textarea
            value={photoRecapCaption}
            onChange={e => setPhotoRecapCaption(e.target.value)}
            rows={6}
            className="w-full rounded-lg border border-[var(--color-lavender)] bg-white p-3 text-[13px] text-[var(--color-deep-plum)] focus:outline-none focus:border-[var(--color-primary-purple)] focus:ring-2 focus:ring-[var(--color-lavender)] resize-y"
          />
          <BrandVoiceTagsBadges tags={tags} />

          <div className="rounded-lg border border-[var(--color-lavender)] bg-[var(--color-lavender-tint)] p-3 space-y-2">
            <p className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-primary-purple)]">Refine with AI</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={refineGuidance}
                onChange={e => setRefineGuidance(e.target.value)}
                placeholder="e.g. lead with the baptisms, shorter, punchier ending"
                className="flex-1 rounded-lg border border-[var(--color-lavender)] bg-white px-3 py-1.5 text-[12px] text-[var(--color-deep-plum)] placeholder:text-[var(--color-purple-gray)] focus:outline-none focus:border-[var(--color-primary-purple)] focus:ring-2 focus:ring-[var(--color-lavender)]"
              />
              <SrpButton
                size="sm"
                onClick={() => void handleRefine()}
                disabled={refining}
                leadingIcon={refining ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              >
                {refining ? 'Refining…' : 'Refine'}
              </SrpButton>
            </div>
          </div>

          <SrpButton onClick={() => setApproved(true)} leadingIcon={<Check size={14} />}>
            Approve caption
          </SrpButton>
        </section>
      )}

      {/* Approved / locked view */}
      {approved && photoRecapCaption && (
        <section className="rounded-xl border border-[var(--color-primary-purple)] bg-[var(--color-lavender-tint)] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-bold text-[var(--color-primary-purple)]">
              <Check size={11} /> Caption approved
            </span>
            {!editing && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1 text-[11px] text-[var(--color-purple-gray)] hover:text-[var(--color-primary-purple)] transition-colors"
              >
                <Pencil size={11} /> Edit
              </button>
            )}
          </div>

          {editing ? (
            <div className="space-y-3">
              <textarea
                value={photoRecapCaption}
                onChange={e => setPhotoRecapCaption(e.target.value)}
                rows={6}
                className="w-full rounded-lg border border-[var(--color-lavender)] bg-white p-3 text-[13px] text-[var(--color-deep-plum)] focus:outline-none focus:border-[var(--color-primary-purple)] focus:ring-2 focus:ring-[var(--color-lavender)] resize-y"
              />

              <div className="rounded-lg border border-[var(--color-lavender)] bg-white p-3 space-y-2">
                <p className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-primary-purple)]">Refine with AI</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={refineGuidance}
                    onChange={e => setRefineGuidance(e.target.value)}
                    placeholder="e.g. lead with the baptisms, shorter, punchier ending"
                    className="flex-1 rounded-lg border border-[var(--color-lavender)] bg-white px-3 py-1.5 text-[12px] text-[var(--color-deep-plum)] placeholder:text-[var(--color-purple-gray)] focus:outline-none focus:border-[var(--color-primary-purple)] focus:ring-2 focus:ring-[var(--color-lavender)]"
                  />
                  <SrpButton
                    size="sm"
                    onClick={() => void handleRefine()}
                    disabled={refining}
                    leadingIcon={refining ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  >
                    {refining ? 'Refining…' : 'Refine'}
                  </SrpButton>
                </div>
              </div>

              <SrpButton size="sm" onClick={() => setEditing(false)}>Done editing</SrpButton>
            </div>
          ) : (
            <p className="text-[13px] text-[var(--color-deep-plum)] whitespace-pre-wrap leading-relaxed">{photoRecapCaption}</p>
          )}
        </section>
      )}

      <div className="flex items-center justify-between gap-3 pt-2">
        <SrpButton variant="ghost" onClick={goToPrevStep} leadingIcon={<ArrowLeft size={14} />}>Back</SrpButton>
        <SrpButton disabled={!canContinue} onClick={goToNextStep} trailingIcon={<ArrowRight size={14} />}>Continue</SrpButton>
      </div>
    </div>
  )
}
