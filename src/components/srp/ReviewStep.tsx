/**
 * Step 4: Review & generate. One panel per selected deliverable.
 * Each generator is INDEPENDENT — running one doesn't reset the
 * others; editing one is local to that panel. Edit-then-save persists
 * to the right column on sms_srp_generation, so navigating away
 * doesn't drop changes.
 */

import { useMemo } from 'react'
import { ArrowLeft, CheckCircle2 } from 'lucide-react'
import { parseDeliverables } from '../../lib/srpSessions'
import type { SmsSrpGeneration, SrpDeliverableKey } from '../../types/database'
import { FacebookPostGenerator } from './generators/FacebookPostGenerator'
import { SundayInviteGenerator } from './generators/SundayInviteGenerator'
import { PhotoRecapGenerator } from './generators/PhotoRecapGenerator'
import { CarouselGenerator } from './generators/CarouselGenerator'

export function ReviewStep({ session, onBack, onApprove, onChange }: {
  session: SmsSrpGeneration
  onBack: () => void
  onApprove: () => void
  onChange: () => void
}) {
  const selected = useMemo(() => parseDeliverables(session.selected_deliverables), [session.selected_deliverables])

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-wm-border bg-wm-bg-elevated p-4">
        <h2 className="text-[16px] font-semibold text-wm-text">Review & generate</h2>
        <p className="text-[12px] text-wm-text-muted mt-1">
          Each deliverable is independent. Generate, edit, regenerate. When you're happy with everything, click Approve.
        </p>
      </div>

      {selected.length === 0 && (
        <div className="rounded-md border border-wm-warning/30 bg-wm-warning-bg p-3 text-[12px] text-wm-warning">
          No deliverables selected. Go back and pick some.
        </div>
      )}

      {selected.includes('facebook_post') && (
        <FacebookPostGenerator session={session} onChange={onChange} />
      )}
      {selected.includes('sunday_invite') && (
        <SundayInviteGenerator session={session} onChange={onChange} />
      )}
      {selected.includes('carousel_slides') && (
        <CarouselGenerator session={session} onChange={onChange} />
      )}
      {selected.includes('photo_recap') && (
        <PhotoRecapGenerator session={session} onChange={onChange} />
      )}

      <div className="flex items-center justify-between gap-2 pt-3">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 text-[12px] text-wm-text-muted hover:text-wm-text px-2 py-1.5">
          <ArrowLeft size={12} /> Back
        </button>
        <button
          onClick={onApprove}
          className="inline-flex items-center gap-1.5 rounded-full bg-wm-success px-4 py-1.5 text-[12px] text-white font-semibold"
        >
          <CheckCircle2 size={12} /> Approve & finish
        </button>
      </div>
    </section>
  )
}

export type { SrpDeliverableKey }
