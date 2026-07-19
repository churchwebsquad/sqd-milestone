/**
 * Step 7 — Facebook post.
 *
 * Options are pre-generated in the background (auto-generate fires on sermon confirm).
 * Coach picks one, approves it, edits if needed, or refines with AI guidance.
 * Regenerating all options is available until approval.
 */

import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Loader2, Sparkles, RefreshCw, Check, Pencil } from 'lucide-react'
import { useSrpWorkflow } from '../../../contexts/SrpWorkflowContext'
import { SrpButton } from '../_shared/SrpButton'
import { IntelGuidancePanel } from '../_shared/IntelGuidancePanel'
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
    transcript, keyInsights,
    facebookPost, setFacebookPost,
    facebookInput, setFacebookInput,
    autoDrafts,
    intelProfile,
    visibleSteps,
    goToNextStep, goToPrevStep,
  } = useSrpWorkflow()

  const [options, setOptions]         = useState<FacebookOption[]>(() => autoDrafts?.facebook ?? [])

  // Hydrate from autoDrafts if auto-generate completes after this step mounts
  useEffect(() => {
    if (autoDrafts?.facebook?.length && !options.length) {
      setOptions(autoDrafts.facebook)
    }
  }, [autoDrafts?.facebook]) // eslint-disable-line react-hooks/exhaustive-deps
  const [selectedIdx, setSelectedIdx] = useState<number | null>(facebookInput?.selectedIdx ?? null)
  const [tags, setTags]               = useState<string[]>(facebookInput?.selectedTags ?? [])
  const [approved, setApproved]       = useState(false)
  const [editing, setEditing]         = useState(false)
  const [generating, setGenerating]   = useState(false)
  const [refining, setRefining]       = useState(false)
  const [refineGuidance, setRefineGuidance] = useState('')
  const [error, setError]             = useState<string | null>(null)

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
        keyInsights:    keyInsights.length ? keyInsights : undefined,
      })
      setOptions(r.posts ?? [])
      setSelectedIdx(null)
      setApproved(false)
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'generation failed')
    } finally {
      setGenerating(false)
    }
  }, [transcript, brandVoice, account, sermonSubmission, guidance, keyInsights])

  const handleRefine = useCallback(async () => {
    if (!facebookPost) return
    setRefining(true); setError(null)
    try {
      const r = await callSrpApi<OptionsResponse>('generate-facebook-post', {
        transcript,
        brandVoice,
        accountContext: buildAccountContext(account, sermonSubmission),
        userGuidance:   `Starting from this draft:\n\n${facebookPost}\n\nDirection: ${refineGuidance || 'improve it'}`,
        keyInsights:    keyInsights.length ? keyInsights : undefined,
      })
      const first = r.posts?.[0]
      if (first) {
        setFacebookPost(first.text)
        setTags(first.brandVoiceTags ?? [])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'refinement failed')
    } finally {
      setRefining(false)
    }
  }, [facebookPost, transcript, brandVoice, account, sermonSubmission, refineGuidance, keyInsights, setFacebookPost])

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
    setApproved(false)
    setEditing(false)
  }

  const canContinue = approved && (facebookPost?.trim().length ?? 0) > 0

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-[var(--color-primary-purple)]">
          Step {stepNum} of {visibleSteps.length}
        </p>
        <h2 className="text-[22px] font-semibold text-[var(--color-deep-plum)] mt-0.5">{STEP_LABELS.facebook}</h2>
        <p className="text-[13px] text-[var(--color-purple-gray)] mt-1">{STEP_DESCRIPTIONS.facebook}</p>
      </header>

      <IntelGuidancePanel title="Facebook Text Post" data={intelProfile?.facebook_text_post as Record<string, unknown> | null | undefined} />

      {/* Regenerate all options — only available before approval */}
      {!approved && (
        <section className="rounded-xl border border-[var(--color-lavender)] bg-white p-4 space-y-3">
          <div className="space-y-2">
            <label className="block text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
              Guidance for all options
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
            {generating ? 'Generating…' : options.length ? 'Regenerate options' : 'Generate options'}
          </SrpButton>
        </section>
      )}

      {error && (
        <div className="rounded-lg border border-wm-danger/30 bg-wm-danger-bg px-4 py-3 text-[12px] text-wm-danger">{error}</div>
      )}

      {/* Option cards — hidden once approved */}
      {!approved && options.length > 0 && (
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

      {/* Edit + approve panel */}
      {facebookPost && selectedIdx != null && !approved && (
        <section className="rounded-xl border border-[var(--color-lavender)] bg-white p-4 space-y-3">
          <p className="text-[11px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
            Selected post
          </p>
          <textarea
            value={facebookPost}
            onChange={e => setFacebookPost(e.target.value)}
            rows={10}
            className="w-full rounded-lg border border-[var(--color-lavender)] bg-white p-3 text-[13px] text-[var(--color-deep-plum)] focus:outline-none focus:border-[var(--color-primary-purple)] focus:ring-2 focus:ring-[var(--color-lavender)] resize-y"
          />
          <BrandVoiceTagsBadges tags={tags} />

          {/* AI refine for this caption */}
          <div className="rounded-lg border border-[var(--color-lavender)] bg-[var(--color-lavender-tint)] p-3 space-y-2">
            <p className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-primary-purple)]">Refine with AI</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={refineGuidance}
                onChange={e => setRefineGuidance(e.target.value)}
                placeholder="e.g. make it shorter, lead with a question, lean into the verse"
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

          <SrpButton
            onClick={() => setApproved(true)}
            leadingIcon={<Check size={14} />}
          >
            Approve post
          </SrpButton>
        </section>
      )}

      {/* Approved / locked view */}
      {approved && facebookPost && (
        <section className="rounded-xl border border-[var(--color-primary-purple)] bg-[var(--color-lavender-tint)] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-bold text-[var(--color-primary-purple)]">
              <Check size={11} /> Post approved
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
                value={facebookPost}
                onChange={e => setFacebookPost(e.target.value)}
                rows={10}
                className="w-full rounded-lg border border-[var(--color-lavender)] bg-white p-3 text-[13px] text-[var(--color-deep-plum)] focus:outline-none focus:border-[var(--color-primary-purple)] focus:ring-2 focus:ring-[var(--color-lavender)] resize-y"
              />

              <div className="rounded-lg border border-[var(--color-lavender)] bg-white p-3 space-y-2">
                <p className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-primary-purple)]">Refine with AI</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={refineGuidance}
                    onChange={e => setRefineGuidance(e.target.value)}
                    placeholder="e.g. make it shorter, lead with a question"
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
            <p className="text-[13px] text-[var(--color-deep-plum)] whitespace-pre-wrap leading-relaxed">{facebookPost}</p>
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
