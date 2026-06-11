/**
 * Step 8 — Sunday invite.
 *
 * /api/srp/generate-sunday-invite returns 3 invites with distinct tones
 * (warm / energetic / topical). Each has tone + text + citation
 * (singular) + brandVoiceTags. Coach picks one, edits text, saves to
 * sessions.sunday_invite.
 */

import { useCallback, useState } from 'react'
import { ArrowLeft, ArrowRight, Loader2, Sparkles, RefreshCw, Check, Heart, Zap, Calendar } from 'lucide-react'
import { useSrpWorkflow } from '../../../contexts/SrpWorkflowContext'
import { SrpButton } from '../_shared/SrpButton'
import { BrandVoiceTagsBadges } from '../_shared/BrandVoiceTagsBadges'
import { CitationsList } from '../_shared/CitationsList'
import { callSrpApi } from '../../../lib/srpApi'
import { STEP_LABELS, STEP_DESCRIPTIONS } from '../../../lib/srpSessions'
import { buildAccountContext } from '../../../lib/accountContext'

interface InviteOption {
  tone:           string
  text:           string
  citation:       string
  brandVoiceTags: string[]
}
interface OptionsResponse { invites: InviteOption[] }

const TONE_ICONS: Record<string, typeof Heart> = {
  warm:       Heart,
  energetic:  Zap,
  topical:    Calendar,
}

export function SundayInviteStep() {
  const {
    account, sermonSubmission, brandVoice,
    transcript,
    sundayInvite, setSundayInvite,
    sundayInviteInput, setSundayInviteInput,
    visibleSteps,
    goToNextStep, goToPrevStep,
  } = useSrpWorkflow()

  const [options, setOptions] = useState<InviteOption[]>([])
  const [selectedIdx, setSelectedIdx] = useState<number | null>(sundayInviteInput?.selectedIdx ?? null)
  const [tags, setTags] = useState<string[]>([])
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const stepNum = visibleSteps.indexOf('sundayInvite') + 1
  const guidance = sundayInviteInput?.guidance ?? ''

  const handleGenerate = useCallback(async () => {
    setGenerating(true); setError(null)
    try {
      const r = await callSrpApi<OptionsResponse>('generate-sunday-invite', {
        transcript:     transcript || '',
        brandVoice,
        accountContext: buildAccountContext(account, sermonSubmission),
        userGuidance:   guidance || undefined,
      })
      setOptions(r.invites ?? [])
      setSelectedIdx(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'generation failed')
    } finally {
      setGenerating(false)
    }
  }, [transcript, brandVoice, account, sermonSubmission, guidance])

  const pickOption = (idx: number) => {
    setSelectedIdx(idx)
    const opt = options[idx]
    setSundayInviteInput({
      ...sundayInviteInput,
      selectedIdx: idx,
      selectedCitation: opt?.citation,
      selectedTags: opt?.brandVoiceTags,
    })
    setSundayInvite(opt?.text ?? null)
    setTags(opt?.brandVoiceTags ?? [])
  }

  const canContinue = (sundayInvite?.trim().length ?? 0) > 0

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-[var(--color-primary-purple)]">
          Step {stepNum} of {visibleSteps.length}
        </p>
        <h2 className="text-[22px] font-semibold text-[var(--color-deep-plum)] mt-0.5">{STEP_LABELS.sundayInvite}</h2>
        <p className="text-[13px] text-[var(--color-purple-gray)] mt-1">{STEP_DESCRIPTIONS.sundayInvite}</p>
      </header>

      <section className="rounded-xl border border-[var(--color-lavender)] bg-white p-4 space-y-3">
        <div className="space-y-2">
          <label className="block text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
            Optional guidance
          </label>
          <input
            type="text"
            value={guidance}
            onChange={e => setSundayInviteInput({ ...sundayInviteInput, guidance: e.target.value })}
            placeholder="e.g. mention the lobby, lean on the family vibe"
            className="w-full rounded-lg border border-[var(--color-lavender)] bg-white px-3 py-1.5 text-[12px] text-[var(--color-deep-plum)] placeholder:text-[var(--color-purple-gray)] focus:outline-none focus:border-[var(--color-primary-purple)] focus:ring-2 focus:ring-[var(--color-lavender)]"
          />
        </div>
        <SrpButton
          size="sm"
          onClick={() => void handleGenerate()}
          disabled={generating}
          leadingIcon={generating ? <Loader2 size={12} className="animate-spin" /> : (options.length ? <RefreshCw size={12} /> : <Sparkles size={12} />)}
        >
          {generating ? 'Generating…' : options.length ? 'Regenerate' : 'Generate 3 invites'}
        </SrpButton>
      </section>

      {error && (
        <div className="rounded-lg border border-wm-danger/30 bg-wm-danger-bg px-4 py-3 text-[12px] text-wm-danger">{error}</div>
      )}

      {options.length > 0 && (
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {options.map((opt, i) => {
            const picked = i === selectedIdx
            const ToneIcon = TONE_ICONS[opt.tone?.toLowerCase() ?? ''] ?? Heart
            return (
              <button
                key={i}
                type="button"
                onClick={() => pickOption(i)}
                className={[
                  'text-left rounded-xl border p-3 transition-colors h-full',
                  picked
                    ? 'border-[var(--color-primary-purple)] bg-[var(--color-lavender-tint)]'
                    : 'border-[var(--color-lavender)] bg-white hover:bg-[var(--color-lavender-tint)]/40',
                ].join(' ')}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-bold text-[var(--color-primary-purple)]">
                    <ToneIcon size={11} />
                    {opt.tone}
                  </span>
                  {picked && <Check size={12} className="text-[var(--color-primary-purple)]" />}
                </div>
                <p className="text-[13px] text-[var(--color-deep-plum)] whitespace-pre-wrap leading-snug">
                  {opt.text}
                </p>
                <div className="mt-3 pt-2 border-t border-[var(--color-lavender)] space-y-1.5">
                  <CitationsList items={opt.citation} />
                  <BrandVoiceTagsBadges tags={opt.brandVoiceTags} />
                </div>
              </button>
            )
          })}
        </section>
      )}

      {sundayInvite && selectedIdx != null && (
        <section className="rounded-xl border border-[var(--color-lavender)] bg-white p-4 space-y-3">
          <p className="text-[11px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
            Picked invite (editable)
          </p>
          <textarea
            value={sundayInvite}
            onChange={e => setSundayInvite(e.target.value)}
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
