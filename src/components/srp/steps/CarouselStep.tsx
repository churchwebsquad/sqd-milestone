/**
 * Step 6 — Carousel.
 *
 * Two-phase generation:
 *   1. /api/srp/generate-carousel returns 3 carousel concepts. Each
 *      has slides[] (4-5 items, layout-dependent), citations[],
 *      brandVoiceTags[].
 *   2. Coach picks one option. Then "Generate caption" calls
 *      /api/srp/generate-carousel with type:"caption" + the picked
 *      slides — returns a short Instagram caption.
 *
 * Picked slides + caption persist to sessions.carousel_slides /
 * carousel_caption.
 */

import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Loader2, Sparkles, RefreshCw, Check, Quote, CheckCircle2, Trash2, Plus } from 'lucide-react'
import { useSrpWorkflow } from '../../../contexts/SrpWorkflowContext'
import { SrpButton } from '../_shared/SrpButton'
import { BrandVoiceTagsBadges } from '../_shared/BrandVoiceTagsBadges'
import { CitationsList } from '../_shared/CitationsList'
import { callSrpApi } from '../../../lib/srpApi'
import { STEP_LABELS, STEP_DESCRIPTIONS } from '../../../lib/srpSessions'
import { buildAccountContext } from '../../../lib/accountContext'
import type { SrpCarouselSlide } from '../../../types/database'

interface CarouselOption {
  slides:         string[]
  citations:      string[]
  brandVoiceTags: string[]
}
interface OptionsResponse { options: CarouselOption[] }
interface CaptionResponse { caption: string; brandVoiceTags: string[] }

export function CarouselStep() {
  const {
    account, sermonSubmission, brandVoice,
    transcript, keyInsights,
    carouselSlides, setCarouselSlides,
    carouselCaption, setCarouselCaption,
    carouselInput, setCarouselInput,
    autoDrafts,
    visibleSteps,
    goToNextStep, goToPrevStep,
  } = useSrpWorkflow()

  const [options, setOptions] = useState<CarouselOption[]>(() => autoDrafts?.carousel ?? [])
  const [selectedIdx, setSelectedIdx] = useState<number | null>(
    carouselInput?.selectedIdx ?? null,
  )
  const [editedSlides, setEditedSlides] = useState<string[]>(
    carouselSlides ? carouselSlides.map(s => s.text) : [],
  )
  const [tags, setTags] = useState<string[]>([])
  const [captionTags, setCaptionTags] = useState<string[]>([])

  const [slidesApproved, setSlidesApproved] = useState(!!(carouselInput?.slidesApproved))
  const [captionApproved, setCaptionApproved] = useState(!!(carouselInput?.captionApproved))
  const [editingCaption, setEditingCaption] = useState(!carouselInput?.captionApproved)
  const [generatingSlides, setGeneratingSlides] = useState(false)
  const [generatingCaption, setGeneratingCaption] = useState(false)
  const [refineInstruction, setRefineInstruction] = useState('')
  const [refining, setRefining] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const stepNum = visibleSteps.indexOf('carousel') + 1
  const slidesGuidance  = carouselInput?.slidesGuidance ?? ''
  const captionGuidance = carouselInput?.captionGuidance ?? ''

  const handleGenerateSlides = useCallback(async () => {
    if (!transcript) { setError('Transcript missing.'); return }
    setGeneratingSlides(true); setError(null)
    try {
      const r = await callSrpApi<OptionsResponse>('generate-carousel', {
        transcript,
        brandVoice,
        accountContext: buildAccountContext(account, sermonSubmission),
        userGuidance:   slidesGuidance || undefined,
        keyInsights:    keyInsights.length ? keyInsights : undefined,
      })
      setOptions(r.options ?? [])
      setSelectedIdx(null)
      setSlidesApproved(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'generation failed')
    } finally {
      setGeneratingSlides(false)
    }
  }, [transcript, brandVoice, account, sermonSubmission, slidesGuidance])

  const pickOption = useCallback((idx: number) => {
    setSelectedIdx(idx)
    setSlidesApproved(false)
    setCarouselInput({ ...carouselInput, selectedIdx: idx, slidesApproved: false })
    const opt = options[idx]
    if (!opt) return
    setEditedSlides([...opt.slides])
    setTags(opt.brandVoiceTags)
    const persisted: SrpCarouselSlide[] = opt.slides.map((text, i) => ({
      slide_number: i + 1,
      text,
    }))
    setCarouselSlides(persisted)
  }, [options, carouselInput, setCarouselInput, setCarouselSlides])

  const approveSlides = () => {
    setSlidesApproved(true)
    setCarouselInput({ ...carouselInput, slidesApproved: true })
    // Auto-generate caption if one doesn't exist yet
    if (!carouselCaption) void handleGenerateCaption()
  }

  const approveCaption = () => {
    setCaptionApproved(true)
    setEditingCaption(false)
    setCarouselInput({ ...carouselInput, captionApproved: true })
  }

  const updateSlide = (i: number, v: string) => {
    const next = [...editedSlides]
    next[i] = v
    setEditedSlides(next)
    setCarouselSlides(next.map((text, j) => ({ slide_number: j + 1, text })))
  }

  // Auto-generate slides on first visit if no options exist yet
  useEffect(() => {
    if (options.length === 0 && transcript) void handleGenerateSlides()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleGenerateCaption = useCallback(async () => {
    if (editedSlides.length === 0) return
    setGeneratingCaption(true); setError(null)
    try {
      const r = await callSrpApi<CaptionResponse>('generate-carousel', {
        type: 'caption',
        slides: editedSlides,
        brandVoice,
        accountContext: buildAccountContext(account, sermonSubmission),
        userGuidance: captionGuidance || undefined,
      })
      setCarouselCaption(r.caption)
      setCaptionTags(r.brandVoiceTags ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'caption generation failed')
    } finally {
      setGeneratingCaption(false)
    }
  }, [editedSlides, brandVoice, account, sermonSubmission, captionGuidance, setCarouselCaption])

  const handleRefine = useCallback(async () => {
    if (!refineInstruction.trim() || editedSlides.length === 0) return
    setRefining(true); setError(null)
    try {
      const r = await callSrpApi<{ slides: string[]; citations: string[]; brandVoiceTags: string[] }>('generate-carousel', {
        type: 'refine',
        slides: editedSlides,
        transcript,
        brandVoice,
        accountContext: buildAccountContext(account, sermonSubmission),
        userGuidance: refineInstruction,
      })
      setEditedSlides(r.slides)
      setTags(r.brandVoiceTags ?? [])
      setRefineInstruction('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'refine failed')
    } finally {
      setRefining(false)
    }
  }, [refineInstruction, editedSlides, transcript, brandVoice, account, sermonSubmission])

  const canContinue = slidesApproved && captionApproved && (carouselCaption?.trim().length ?? 0) > 0
  return (
    <div className="space-y-6">
      <header>
        <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-[var(--color-primary-purple)]">
          Step {stepNum} of {visibleSteps.length}
        </p>
        <h2 className="text-[22px] font-semibold text-[var(--color-deep-plum)] mt-0.5">
          {STEP_LABELS.carousel}
        </h2>
        <p className="text-[13px] text-[var(--color-purple-gray)] mt-1">
          {STEP_DESCRIPTIONS.carousel} · Generate 5 options (including a single-slide graphic), pick one, edit slides, then caption.
        </p>
      </header>

      {/* Generate slides */}
      <section className="rounded-xl border border-[var(--color-lavender)] bg-white p-4 space-y-3">
        <div className="space-y-2">
          <label className="block text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
            Optional guidance for the slides
          </label>
          <input
            type="text"
            value={slidesGuidance}
            onChange={e => setCarouselInput({ ...carouselInput, slidesGuidance: e.target.value })}
            placeholder="e.g. lead with the parable, end on the practical takeaway"
            className="w-full rounded-lg border border-[var(--color-lavender)] bg-white px-3 py-1.5 text-[12px] text-[var(--color-deep-plum)] placeholder:text-[var(--color-purple-gray)] focus:outline-none focus:border-[var(--color-primary-purple)] focus:ring-2 focus:ring-[var(--color-lavender)]"
          />
        </div>
        <SrpButton
          size="sm"
          onClick={() => void handleGenerateSlides()}
          disabled={generatingSlides || !transcript}
          leadingIcon={generatingSlides ? <Loader2 size={12} className="animate-spin" /> : (options.length ? <RefreshCw size={12} /> : <Sparkles size={12} />)}
        >
          {generatingSlides ? 'Generating…' : options.length ? 'Regenerate 5 options' : 'Generate 5 options'}
        </SrpButton>
      </section>

      {error && (
        <div className="rounded-lg border border-wm-danger/30 bg-wm-danger-bg px-4 py-3 text-[12px] text-wm-danger">{error}</div>
      )}

      {/* Options — stacked cards with horizontal slide preview row */}
      {options.length > 0 && (
        <section className="space-y-3">
          <p className="text-[11px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
            Options
          </p>
          <ul className="space-y-3">
            {options.map((opt, i) => {
              const picked = i === selectedIdx
              return (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => pickOption(i)}
                    className={[
                      'w-full text-left rounded-xl border p-4 transition-colors',
                      picked
                        ? 'border-[var(--color-primary-purple)] bg-[var(--color-lavender-tint)]'
                        : 'border-[var(--color-lavender)] bg-white hover:bg-[var(--color-lavender-tint)]/40',
                    ].join(' ')}
                  >
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <span className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
                        Option {i + 1} · {opt.slides.length} slides
                      </span>
                      {picked && (
                        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-bold text-[var(--color-primary-purple)]">
                          <Check size={11} /> Picked
                        </span>
                      )}
                    </div>

                    {/* Horizontal slide preview boxes */}
                    <div className="flex gap-2 overflow-x-auto pb-2">
                      {opt.slides.map((s, j) => (
                        <div
                          key={j}
                          className="shrink-0 w-[130px] aspect-square rounded-lg border border-[var(--color-lavender)] bg-[var(--color-lavender-tint)] p-2.5 flex items-center justify-center text-center"
                        >
                          <p className="text-[10px] leading-snug text-[var(--color-deep-plum)]">{s}</p>
                        </div>
                      ))}
                    </div>

                    {(opt.citations?.length > 0 || opt.brandVoiceTags?.length > 0) && (
                      <div className="mt-3 pt-2 border-t border-[var(--color-lavender)] space-y-1.5">
                        <CitationsList items={opt.citations} />
                        <BrandVoiceTagsBadges tags={opt.brandVoiceTags} />
                      </div>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* Slides section */}
      {(editedSlides.length > 0) && (
        <section className="rounded-xl border border-[var(--color-lavender)] bg-white p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[11px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
              {slidesApproved ? 'Slides' : 'Slides (editable)'}
            </p>
            <div className="flex items-center gap-3">
              {slidesApproved ? (
                <button
                  type="button"
                  onClick={() => { setSlidesApproved(false); setCarouselInput({ ...carouselInput, slidesApproved: false }) }}
                  className="text-[11px] text-[var(--color-purple-gray)] hover:text-[var(--color-deep-plum)] underline underline-offset-2 transition-colors"
                >
                  Edit slides
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => { setSelectedIdx(null); setEditedSlides([]) }}
                  className="text-[11px] text-[var(--color-purple-gray)] hover:text-[var(--color-deep-plum)] underline underline-offset-2 transition-colors"
                >
                  ← Back to options
                </button>
              )}
            </div>
          </div>

          {slidesApproved ? (
            /* Read-only slide list */
            <>
              <ol className="space-y-2">
                {editedSlides.map((text, i) => (
                  <li key={i} className="flex gap-2.5 text-[12px] text-[var(--color-deep-plum)]">
                    <span className="shrink-0 font-mono text-[10px] text-[var(--color-purple-gray)] mt-0.5 w-4 text-right">{i + 1}.</span>
                    <span>{text}</span>
                  </li>
                ))}
              </ol>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-primary-purple)]">
                <CheckCircle2 size={13} /> Slides approved
              </span>
            </>
          ) : (
            /* Editable slide list */
            <>
              {editedSlides.map((text, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="block text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
                      Slide {i + 1}
                    </label>
                    {editedSlides.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setEditedSlides(prev => prev.filter((_, idx) => idx !== i))}
                        className="text-[var(--color-purple-gray)] hover:text-wm-danger transition-colors"
                        aria-label="Remove slide"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                  <textarea
                    value={text}
                    onChange={e => updateSlide(i, e.target.value)}
                    rows={3}
                    className="w-full rounded-lg border border-[var(--color-lavender)] bg-white p-2.5 text-[12px] text-[var(--color-deep-plum)] focus:outline-none focus:border-[var(--color-primary-purple)] focus:ring-2 focus:ring-[var(--color-lavender)] resize-y"
                  />
                </div>
              ))}

              <button
                type="button"
                onClick={() => setEditedSlides(prev => [...prev, ''])}
                className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-primary-purple)] hover:text-[var(--color-deep-plum)] transition-colors"
              >
                <Plus size={13} /> Add slide
              </button>

              {/* AI refine */}
              <div className="rounded-lg border border-[var(--color-lavender)] bg-[var(--color-lavender-tint)] p-3 space-y-2">
                <p className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
                  Refine with AI
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={refineInstruction}
                    onChange={e => setRefineInstruction(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !refining) void handleRefine() }}
                    placeholder="e.g. make it 4 slides, split slide 2, rewrite the hook"
                    className="flex-1 rounded-lg border border-[var(--color-lavender)] bg-white px-3 py-1.5 text-[12px] text-[var(--color-deep-plum)] placeholder:text-[var(--color-purple-gray)] focus:outline-none focus:border-[var(--color-primary-purple)] focus:ring-2 focus:ring-[var(--color-lavender)]"
                  />
                  <SrpButton
                    size="sm"
                    onClick={() => void handleRefine()}
                    disabled={refining || !refineInstruction.trim()}
                    leadingIcon={refining ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  >
                    {refining ? 'Refining…' : 'Refine'}
                  </SrpButton>
                </div>
              </div>

              <BrandVoiceTagsBadges tags={tags} />
              <div className="pt-2">
                <SrpButton size="sm" onClick={approveSlides} trailingIcon={<ArrowRight size={12} />}>
                  Approve slides
                </SrpButton>
              </div>
            </>
          )}
        </section>
      )}

      {/* Caption — appears once slides are approved */}
      {slidesApproved && (
        <section className="rounded-xl border border-[var(--color-lavender)] bg-white p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[11px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)] flex items-center gap-1.5">
              <Quote size={11} /> Caption
            </p>
            {captionApproved && (
              <button
                type="button"
                onClick={() => { setCaptionApproved(false); setEditingCaption(true); setCarouselInput({ ...carouselInput, captionApproved: false }) }}
                className="text-[11px] text-[var(--color-purple-gray)] hover:text-[var(--color-deep-plum)] underline underline-offset-2 transition-colors"
              >
                Edit caption
              </button>
            )}
          </div>

          {captionApproved && !editingCaption ? (
            /* Read-only approved caption */
            <>
              <p className="text-[13px] text-[var(--color-deep-plum)] whitespace-pre-wrap">{carouselCaption}</p>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-primary-purple)]">
                <CheckCircle2 size={13} /> Caption approved
              </span>
            </>
          ) : (
            /* Editable caption */
            <>
              <div className="space-y-2">
                <label className="block text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
                  Optional guidance
                </label>
                <input
                  type="text"
                  value={captionGuidance}
                  onChange={e => setCarouselInput({ ...carouselInput, captionGuidance: e.target.value })}
                  placeholder="e.g. open with a question, end with a tag-a-friend prompt"
                  className="w-full rounded-lg border border-[var(--color-lavender)] bg-white px-3 py-1.5 text-[12px] text-[var(--color-deep-plum)] placeholder:text-[var(--color-purple-gray)] focus:outline-none focus:border-[var(--color-primary-purple)] focus:ring-2 focus:ring-[var(--color-lavender)]"
                />
              </div>
              <SrpButton
                size="sm"
                onClick={() => void handleGenerateCaption()}
                disabled={generatingCaption || editedSlides.length === 0}
                leadingIcon={generatingCaption ? <Loader2 size={12} className="animate-spin" /> : (carouselCaption ? <RefreshCw size={12} /> : <Sparkles size={12} />)}
              >
                {generatingCaption ? 'Generating…' : carouselCaption ? 'Regenerate caption' : 'Generate caption'}
              </SrpButton>
              {carouselCaption && (
                <>
                  <textarea
                    value={carouselCaption}
                    onChange={e => setCarouselCaption(e.target.value)}
                    rows={4}
                    className="w-full rounded-lg border border-[var(--color-lavender)] bg-white p-3 text-[13px] text-[var(--color-deep-plum)] focus:outline-none focus:border-[var(--color-primary-purple)] focus:ring-2 focus:ring-[var(--color-lavender)] resize-y"
                  />
                  <BrandVoiceTagsBadges tags={captionTags} />
                  <div className="pt-1">
                    <SrpButton size="sm" onClick={approveCaption} trailingIcon={<ArrowRight size={12} />}>
                      Approve caption
                    </SrpButton>
                  </div>
                </>
              )}
            </>
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
