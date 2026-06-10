/**
 * Step 2: Deliverable selection. Strategist checks which deliverables
 * to generate for this session. Selection persists to
 * sms_srp_generation.selected_deliverables on every toggle.
 */

import { useCallback, useMemo } from 'react'
import { ArrowLeft, ArrowRight, CheckCircle2, Circle, ListChecks } from 'lucide-react'
import {
  updateSession,
  parseDeliverables, stringifyDeliverables,
  DELIVERABLE_LABELS, DELIVERABLE_DESCRIPTIONS,
} from '../../lib/srpSessions'
import type { SmsSrpGeneration, SrpDeliverableKey } from '../../types/database'
import { SrpStepPanel } from './_shared/SrpStepPanel'
import { SrpButton } from './_shared/SrpButton'

const PHASE_1_KEYS: SrpDeliverableKey[] = [
  'facebook_post',
  'sunday_invite',
  'photo_recap',
  'carousel_slides',
  'reel_captions',
]

export function DeliverableStep({ session, onBack, onContinue, onChange }: {
  session: SmsSrpGeneration
  onBack: () => void
  onContinue: () => void
  onChange: () => void
}) {
  const selected = useMemo(() => parseDeliverables(session.selected_deliverables), [session.selected_deliverables])

  const toggle = useCallback(async (key: SrpDeliverableKey) => {
    const next = selected.includes(key) ? selected.filter(k => k !== key) : [...selected, key]
    await updateSession(session.session_id, { selected_deliverables: stringifyDeliverables(next) })
    onChange()
  }, [selected, session.session_id, onChange])

  const canContinue = selected.length > 0

  return (
    <SrpStepPanel
      eyebrow="Step 2 of 4"
      icon={ListChecks}
      title="Pick deliverables"
      description={`Choose what to generate for this session. Each piece can be edited independently in review. ${selected.length} of ${PHASE_1_KEYS.length} selected.`}
      footer={
        <>
          <SrpButton variant="ghost" onClick={onBack} leadingIcon={<ArrowLeft size={14} />}>
            Back
          </SrpButton>
          <SrpButton
            variant="secondary"
            onClick={onContinue}
            disabled={!canContinue}
            trailingIcon={<ArrowRight size={14} />}
          >
            Continue
          </SrpButton>
        </>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        {PHASE_1_KEYS.map(k => {
          const checked = selected.includes(k)
          return (
            <button
              key={k}
              onClick={() => void toggle(k)}
              aria-pressed={checked}
              className={[
                'group w-full text-left flex items-start gap-3 rounded-lg border px-4 py-3 transition-all',
                checked
                  ? 'border-[var(--color-primary-purple)] bg-[var(--color-lavender-tint)] shadow-sm'
                  : 'border-[var(--color-lavender)] bg-white hover:border-[var(--color-primary-purple)] hover:bg-[var(--color-lavender-tint)]/40',
              ].join(' ')}
            >
              {checked
                ? <CheckCircle2 size={18} className="text-[var(--color-primary-purple)] shrink-0 mt-0.5" strokeWidth={2.5} />
                : <Circle size={18} className="text-[var(--color-lavender)] shrink-0 mt-0.5 group-hover:text-[var(--color-primary-purple)]/60 transition-colors" />}
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-[var(--color-deep-plum)]">{DELIVERABLE_LABELS[k]}</p>
                <p className="text-[11px] text-[var(--color-purple-gray)] mt-1 leading-snug">{DELIVERABLE_DESCRIPTIONS[k]}</p>
              </div>
            </button>
          )
        })}
      </div>
    </SrpStepPanel>
  )
}
