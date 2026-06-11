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

import { useCallback, useState } from 'react'
import { ArrowLeft, ArrowRight, Loader2, Sparkles, RefreshCw, Check, Quote } from 'lucide-react'
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
    transcript,
    carouselSlides, setCarouselSlides,
    carouselCaption, setCarouselCaption,
    carouselInput, setCarouselInput,
    visibleSteps,
    goToNextStep, goToPrevStep,
  } = useSrpWorkflow()

  const [options, setOptions] = useState<CarouselOption[]>([])
  const [selectedIdx, setSelectedIdx] = useState<number | null>(
    carouselInput?.selectedIdx ?? null,
  )
  const [editedSlides, setEditedSlides] = useState<string[]>(
    carouselSlides ? carouselSlides.map(s => s.text) : [],
  )
  const [tags, setTags] = useState<string[]>([])
  const [captionTags, setCaptionTags] = useState<string[]>([])

  const [generatingSlides, setGeneratingSlides] = useState(false)
  const [generatingCaption, setGeneratingCaption] = useState(false)
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
      })
      setOptions(r.options ?? [])
      setSelectedIdx(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'generation failed')
    } finally {
      setGeneratingSlides(false)
    }
  }, [transcript, brandVoice, account, sermonSubmission, slidesGuidance])

  const pickOption = useCallback((idx: number) => {
    setSelectedIdx(idx)
    setCarouselInput({ ...carouselInput, selectedIdx: idx })
    const opt = options[idx]
    if (!opt) return
    setEditedSlides([...opt.slides])
    setTags(opt.brandVoiceTags)
    // Persist slides immediately so coach can navigate away.
    const persisted: SrpCarouselSlide[] = opt.slides.map((text, i) => ({
      slide_number: i + 1,
      text,
    }))
    setCarouselSlides(persisted)
  }, [options, carouselInput, setCarouselInput, setCarouselSlides])

  const updateSlide = (i: number, v: string) => {
    const next = [...editedSlides]
    next[i] = v
    setEditedSlides(next)
    setCarouselSlides(next.map((text, j) => ({ slide_number: j + 1, text })))
  }

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

  const canContinue = (carouselSlides?.length ?? 0) > 0 && (carouselCaption?.trim().length ?? 0) > 0
  const selectedOpt = selectedIdx != null ? options[selectedIdx] : null

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
          {STEP_DESCRIPTIONS.carousel} · Generate 3 options, pick one, edit slides, then caption.
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
          {generatingSlides ? 'Generating…' : options.length ? 'Regenerate 3 options' : 'Generate 3 options'}
        </SrpButton>
      </section>

      {error && (
        <div className="rounded-lg border border-wm-danger/30 bg-wm-danger-bg px-4 py-3 text-[12px] text-wm-danger">{error}</div>
      )}

      {/* Options grid */}
      {options.length > 0 && (
        <section className="space-y-3">
          <p className="text-[11px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
            Options
          </p>
          <ul className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {options.map((opt, i) => {
              const picked = i === selectedIdx
              return (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => pickOption(i)}
                    className={[
                      'w-full text-left rounded-xl border p-3 transition-colors h-full',
                      picked
                        ? 'border-[var(--color-primary-purple)] bg-[var(--color-lavender-tint)]'
                        : 'border-[var(--color-lavender)] bg-white hover:bg-[var(--color-lavender-tint)]/40',
                    ].join(' ')}
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
                        Option {i + 1} · {opt.slides.length} slides
                      </span>
                      {picked && (
                        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-bold text-[var(--color-primary-purple)]">
                          <Check size={11} /> picked
                        </span>
                      )}
                    </div>
                    <ol className="space-y-1.5 text-[11px] text-[var(--color-deep-plum)]">
                      {opt.slides.map((s, j) => (
                        <li key={j} className="flex gap-1.5">
                          <span className="shrink-0 font-mono text-[10px] text-[var(--color-purple-gray)] mt-0.5">{j + 1}.</span>
                          <span className="min-w-0 line-clamp-3">{s}</span>
                        </li>
                      ))}
                    </ol>
                    <div className="mt-3 pt-2 border-t border-[var(--color-lavender)] space-y-1.5">
                      <CitationsList items={opt.citations} />
                      <BrandVoiceTagsBadges tags={opt.brandVoiceTags} />
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* Edit picked option */}
      {selectedOpt && (
        <section className="rounded-xl border border-[var(--color-lavender)] bg-white p-4 space-y-3">
          <p className="text-[11px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
            Slides (editable)
          </p>
          {editedSlides.map((text, i) => (
            <div key={i} className="space-y-1.5">
              <label className="block text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
                Slide {i + 1}
              </label>
              <textarea
                value={text}
                onChange={e => updateSlide(i, e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-[var(--color-lavender)] bg-white p-2.5 text-[12px] text-[var(--color-deep-plum)] focus:outline-none focus:border-[var(--color-primary-purple)] focus:ring-2 focus:ring-[var(--color-lavender)] resize-y"
              />
            </div>
          ))}
          <BrandVoiceTagsBadges tags={tags} />
        </section>
      )}

      {/* Caption */}
      {selectedOpt && (
        <section className="rounded-xl border border-[var(--color-lavender)] bg-white p-4 space-y-3">
          <p className="text-[11px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)] flex items-center gap-1.5">
            <Quote size={11} /> Carousel caption
          </p>
          <div className="space-y-2">
            <label className="block text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
              Optional guidance for the caption
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
