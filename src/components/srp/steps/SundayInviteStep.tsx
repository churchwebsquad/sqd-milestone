/**
 * Step 8 — Sunday invite.
 *
 * "Looking ahead" is auto-pulled from the ClickUp task description
 * (text between "LOOKING AHEAD" and the next section header) and
 * passed to the API as the primary signal for Post 4.
 */

import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Loader2, Sparkles, RefreshCw, Check, Heart, Zap, Calendar, Telescope } from 'lucide-react'
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
  community:       Heart,
  momentum:        Zap,
  'sermon tease':  Calendar,
  "what's coming": Telescope,
}

function getToneIcon(tone: string) {
  const key = tone.toLowerCase()
  for (const [k, Icon] of Object.entries(TONE_ICONS)) {
    if (key.includes(k)) return Icon
  }
  return Heart
}

function parseSection(description: string, header: string): string {
  const lines = description.split('\n')
  let capturing = false
  const result: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (new RegExp(`^${header}\\s*$`, 'i').test(trimmed)) { capturing = true; continue }
    if (capturing) {
      if (/^[A-Z][A-Z\s]{3,}$/.test(trimmed) && trimmed === trimmed.toUpperCase()) break
      if (/^external\s+link\s+for\s+sermon\s+notes/i.test(trimmed)) break
      result.push(line)
    }
  }
  return result.join('\n').trim()
}

export function SundayInviteStep() {
  const {
    account, sermonSubmission, brandVoice,
    transcript, keyInsights,
    clickupTaskId,
    sundayInvite, setSundayInvite,
    sundayInviteInput, setSundayInviteInput,
    visibleSteps,
    goToNextStep, goToPrevStep,
  } = useSrpWorkflow()

  const [options, setOptions]         = useState<InviteOption[]>([])
  const [selectedIdx, setSelectedIdx] = useState<number | null>(sundayInviteInput?.selectedIdx ?? null)
  const [tags, setTags]               = useState<string[]>([])
  const [generating, setGenerating]   = useState(false)
  const [error, setError]             = useState<string | null>(null)

  const stepNum      = visibleSteps.indexOf('sundayInvite') + 1
  const guidance     = sundayInviteInput?.guidance ?? ''
  const lookingAhead = sundayInviteInput?.lookingAhead ?? ''

  // Auto-pull "LOOKING AHEAD" from the ClickUp task description on first load
  useEffect(() => {
    if (!clickupTaskId) return
    if (lookingAhead) return
    ;(async () => {
      try {
        const r = await fetch(`/api/clickup/task-detail?taskId=${clickupTaskId}`)
        if (!r.ok) return
        const data = await r.json() as { description?: string }
        const extracted = parseSection(data.description ?? '', 'LOOKING AHEAD')
        if (extracted) setSundayInviteInput({ ...sundayInviteInput, lookingAhead: extracted })
      } catch {
        // non-fatal — coach can type manually
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clickupTaskId])

  const handleGenerate = useCallback(async () => {
    setGenerating(true); setError(null)
    try {
      const r = await callSrpApi<OptionsResponse>('generate-sunday-invite', {
        transcript:     transcript || '',
        brandVoice,
        accountContext: buildAccountContext(account, sermonSubmission),
        lookingAhead:   lookingAhead || undefined,
        userGuidance:   guidance || undefined,
        keyInsights:    keyInsights.length ? keyInsights : undefined,
      })
      setOptions(r.invites ?? [])
      setSelectedIdx(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'generation failed')
    } finally {
      setGenerating(false)
    }
  }, [transcript, brandVoice, account, sermonSubmission, lookingAhead, guidance, keyInsights])

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

      <section className="rounded-xl border border-[var(--color-lavender)] bg-white p-4 space-y-4">
        <div className="space-y-1.5">
          <label className="block text-[11px] uppercase tracking-widest font-bold text-[var(--color-deep-plum)]">
            Looking ahead
          </label>
          <p className="text-[11px] text-[var(--color-purple-gray)]">
            Auto-pulled from the ClickUp task. Upcoming events, series launches, baptisms, special guests — anything that makes this Sunday specifically worth showing up for.
          </p>
          <textarea
            value={lookingAhead}
            onChange={e => setSundayInviteInput({ ...sundayInviteInput, lookingAhead: e.target.value })}
            rows={3}
            placeholder="e.g. Starting a new series on prayer next week. Guest speaker on the 15th. Baptisms planned for the end of the month..."
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
            onChange={e => setSundayInviteInput({ ...sundayInviteInput, guidance: e.target.value })}
            placeholder="e.g. mention the lobby coffee, lean on the family vibe"
            className="w-full rounded-lg border border-[var(--color-lavender)] bg-white px-3 py-1.5 text-[12px] text-[var(--color-deep-plum)] placeholder:text-[var(--color-purple-gray)] focus:outline-none focus:border-[var(--color-primary-purple)] focus:ring-2 focus:ring-[var(--color-lavender)]"
          />
        </div>

        <SrpButton
          size="sm"
          onClick={() => void handleGenerate()}
          disabled={generating}
          leadingIcon={generating
            ? <Loader2 size={12} className="animate-spin" />
            : options.length ? <RefreshCw size={12} /> : <Sparkles size={12} />
          }
        >
          {generating ? 'Generating…' : options.length ? 'Regenerate invites' : 'Generate invites'}
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
              const ToneIcon = getToneIcon(opt.tone)
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
                </li>
              )
            })}
          </ul>
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
            rows={7}
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
