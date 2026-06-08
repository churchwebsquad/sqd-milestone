/**
 * Step 2: Deliverable selection. Strategist checks which deliverables
 * to generate for this session. Selection persists to
 * sms_srp_generation.selected_deliverables on every toggle.
 */

import { useCallback, useMemo } from 'react'
import { ArrowLeft, ArrowRight, CheckSquare, Square } from 'lucide-react'
import {
  updateSession,
  parseDeliverables, stringifyDeliverables,
  DELIVERABLE_LABELS, DELIVERABLE_DESCRIPTIONS,
} from '../../lib/srpSessions'
import type { SmsSrpGeneration, SrpDeliverableKey } from '../../types/database'

const PHASE_1_KEYS: SrpDeliverableKey[] = [
  'facebook_post',
  'sunday_invite',
  'photo_recap',
  'carousel_slides',
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
    <section className="rounded-lg border border-wm-border bg-wm-bg-elevated p-5 space-y-4">
      <header>
        <h2 className="text-[16px] font-semibold text-wm-text">Pick deliverables</h2>
        <p className="text-[12px] text-wm-text-muted mt-1">
          Choose which pieces to generate for this session. You can edit each one independently in the review step.
        </p>
      </header>

      <div className="space-y-2">
        {PHASE_1_KEYS.map(k => {
          const checked = selected.includes(k)
          return (
            <button
              key={k}
              onClick={() => void toggle(k)}
              className={[
                'w-full text-left flex items-start gap-3 rounded-md border px-3 py-2.5 transition-colors',
                checked ? 'border-wm-accent bg-wm-accent/5' : 'border-wm-border bg-wm-bg hover:bg-wm-accent/5',
              ].join(' ')}
            >
              {checked
                ? <CheckSquare size={16} className="text-wm-accent-strong shrink-0 mt-0.5" />
                : <Square size={16} className="text-wm-text-subtle shrink-0 mt-0.5" />}
              <div className="flex-1">
                <p className="text-[13px] font-semibold text-wm-text">{DELIVERABLE_LABELS[k]}</p>
                <p className="text-[11px] text-wm-text-muted mt-0.5 leading-snug">{DELIVERABLE_DESCRIPTIONS[k]}</p>
              </div>
            </button>
          )
        })}
      </div>

      <div className="flex items-center justify-between gap-2">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 text-[12px] text-wm-text-muted hover:text-wm-text px-2 py-1.5">
          <ArrowLeft size={12} /> Back
        </button>
        <button
          onClick={onContinue}
          disabled={!canContinue}
          className="inline-flex items-center gap-1.5 rounded-full bg-wm-accent px-4 py-1.5 text-[12px] text-white disabled:opacity-50"
        >
          Continue <ArrowRight size={12} />
        </button>
      </div>
    </section>
  )
}
