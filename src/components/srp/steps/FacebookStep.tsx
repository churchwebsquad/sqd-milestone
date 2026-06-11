/**
 * Step 7 — Facebook post.
 *
 * /api/srp/generate-facebook-post returns 3 post options. Each carries
 * text + citations[] + brandVoiceTags[]. Coach picks one, edits text,
 * saves to sessions.facebook_post.
 */

import { useCallback, useState } from 'react'
import { ArrowLeft, ArrowRight, Loader2, Sparkles, RefreshCw, Check } from 'lucide-react'
import { useSrpWorkflow } from '../../../contexts/SrpWorkflowContext'
import { SrpButton } from '../_shared/SrpButton'
import { BrandVoiceTagsBadges } from '../_shared/BrandVoiceTagsBadges'
import { CitationsList } from '../_shared/CitationsList'
import { callSrpApi } from '../../../lib/srpApi'
import { STEP_LABELS, STEP_DESCRIPTIONS } from '../../../lib/srpSessions'
import { buildAccountContext } from '../../../lib/accountContext'

interface FacebookOption {
  text:           string
  citations:      string[]
  brandVoiceTags: string[]
}
interface OptionsResponse { posts: FacebookOption[] }

export function FacebookStep() {
  const {
    account, sermonSubmission, brandVoice,
    transcript,
    facebookPost, setFacebookPost,
    facebookInput, setFacebookInput,
    visibleSteps,
    goToNextStep, goToPrevStep,
  } = useSrpWorkflow()

  const [options, setOptions] = useState<FacebookOption[]>([])
  const [selectedIdx, setSelectedIdx] = useState<number | null>(facebookInput?.selectedIdx ?? null)
  const [tags, setTags] = useState<string[]>([])
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const stepNum = visibleSteps.indexOf('facebook') + 1
  const guidance = facebookInput?.guidance ?? ''

  const handleGenerate = useCallback(async () => {
    if (!transcript) { setError('Transcript missing.'); return }
    setGenerating(true); setError(null)
    try {
      const r = await callSrpApi<OptionsResponse>('generate-facebook-post', {
        transcript,
        brandVoice,
        accountContext: buildAccountContext(account, sermonSubmission),
        userGuidance:   guidance || undefined,
      })
      setOptions(r.posts ?? [])
      setSelectedIdx(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'generation failed')
    } finally {
      setGenerating(false)
    }
  }, [transcript, brandVoice, account, sermonSubmission, guidance])

  const pickOption = (idx: number) => {
    setSelectedIdx(idx)
    setFacebookInput({
      ...facebookInput,
      selectedIdx: idx,
      selectedCitation: options[idx]?.citations?.[0],
      selectedTags: options[idx]?.brandVoiceTags,
    })
    setFacebookPost(options[idx]?.text ?? null)
    setTags(options[idx]?.brandVoiceTags ?? [])
  }

  const canContinue = (facebookPost?.trim().length ?? 0) > 0

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-[var(--color-primary-purple)]">
          Step {stepNum} of {visibleSteps.length}
        </p>
        <h2 className="text-[22px] font-semibold text-[var(--color-deep-plum)] mt-0.5">{STEP_LABELS.facebook}</h2>
        <p className="text-[13px] text-[var(--color-purple-gray)] mt-1">{STEP_DESCRIPTIONS.facebook}</p>
      </header>

      <section className="rounded-xl border border-[var(--color-lavender)] bg-white p-4 space-y-3">
        <div className="space-y-2">
          <label className="block text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
            Optional guidance
          </label>
          <input
            type="text"
            value={guidance}
            onChange={e => setFacebookInput({ ...facebookInput, guidance: e.target.value })}
            placeholder="e.g. focus on the doubt-faith tension, 4 paragraphs"
            className="w-full rounded-lg border border-[var(--color-lavender)] bg-white px-3 py-1.5 text-[12px] text-[var(--color-deep-plum)] placeholder:text-[var(--color-purple-gray)] focus:outline-none focus:border-[var(--color-primary-purple)] focus:ring-2 focus:ring-[var(--color-lavender)]"
          />
        </div>
        <SrpButton
          size="sm"
          onClick={() => void handleGenerate()}
          disabled={generating || !transcript}
          leadingIcon={generating ? <Loader2 size={12} className="animate-spin" /> : (options.length ? <RefreshCw size={12} /> : <Sparkles size={12} />)}
        >
          {generating ? 'Generating…' : options.length ? 'Regenerate 3 options' : 'Generate 3 options'}
        </SrpButton>
      </section>

      {error && (
        <div className="rounded-lg border border-wm-danger/30 bg-wm-danger-bg px-4 py-3 text-[12px] text-wm-danger">{error}</div>
      )}

      {options.length > 0 && (
        <section className="space-y-3">
          <p className="text-[11px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">Options</p>
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
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
                        Option {i + 1}
                      </span>
                      {picked && (
                        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-bold text-[var(--color-primary-purple)]">
                          <Check size={11} /> picked
                        </span>
                      )}
                    </div>
                    <p className="text-[13px] text-[var(--color-deep-plum)] whitespace-pre-wrap leading-snug">
                      {opt.text}
                    </p>
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

      {facebookPost && selectedIdx != null && (
        <section className="rounded-xl border border-[var(--color-lavender)] bg-white p-4 space-y-3">
          <p className="text-[11px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
            Picked post (editable)
          </p>
          <textarea
            value={facebookPost}
            onChange={e => setFacebookPost(e.target.value)}
            rows={10}
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
