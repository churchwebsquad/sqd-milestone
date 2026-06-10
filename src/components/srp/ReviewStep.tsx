/**
 * Step 4: Review & generate. One panel per selected deliverable.
 * Each generator is INDEPENDENT — running one doesn't reset the
 * others; editing one is local to that panel. Edit-then-save persists
 * to the right column on sms_srp_generation, so navigating away
 * doesn't drop changes.
 */

import { useMemo } from 'react'
import { ArrowLeft, CheckCircle2, Sparkles, AlertTriangle } from 'lucide-react'
import { parseDeliverables } from '../../lib/srpSessions'
import type { SmsSrpGeneration, SrpDeliverableKey } from '../../types/database'
import { FacebookPostGenerator } from './generators/FacebookPostGenerator'
import { SundayInviteGenerator } from './generators/SundayInviteGenerator'
import { PhotoRecapGenerator } from './generators/PhotoRecapGenerator'
import { CarouselGenerator } from './generators/CarouselGenerator'
import { ReelCaptionsGenerator } from './generators/ReelCaptionsGenerator'
import { ExportActions } from './ExportActions'
import { SrpStepPanel } from './_shared/SrpStepPanel'
import { SrpButton } from './_shared/SrpButton'
import { SrpStatusCard } from './_shared/SrpStatusCard'

export function ReviewStep({ session, onBack, onApprove, onChange }: {
  session: SmsSrpGeneration
  onBack: () => void
  onApprove: () => void
  onChange: () => void
}) {
  const selected = useMemo(() => parseDeliverables(session.selected_deliverables), [session.selected_deliverables])

  return (
    <div className="space-y-5">
      <SrpStepPanel
        tone="accent"
        eyebrow="Step 4 of 4"
        icon={Sparkles}
        title="Review &amp; generate"
        description="Each deliverable is independent. Generate, edit, regenerate. When everything reads right, click Approve to mark this session complete."
      >
        {selected.length === 0 ? (
          <SrpStatusCard tone="warning" icon={AlertTriangle} title="No deliverables selected">
            Head back to step 2 and pick at least one.
          </SrpStatusCard>
        ) : (
          <p className="text-[12px] text-[var(--color-purple-gray)]">
            <span className="font-semibold text-[var(--color-deep-plum)]">{selected.length}</span> deliverable{selected.length === 1 ? '' : 's'} ready to generate below.
          </p>
        )}
      </SrpStepPanel>

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
      {selected.includes('reel_captions') && (
        <ReelCaptionsGenerator session={session} onChange={onChange} />
      )}

      <ExportActions session={session} onChange={onChange} />

      <div className="flex items-center justify-between gap-2 rounded-xl border border-[var(--color-lavender)] bg-white px-5 py-3">
        <SrpButton variant="ghost" onClick={onBack} leadingIcon={<ArrowLeft size={14} />}>
          Back
        </SrpButton>
        <SrpButton
          variant="primary"
          onClick={onApprove}
          leadingIcon={<CheckCircle2 size={14} />}
        >
          Approve &amp; finish
        </SrpButton>
      </div>
    </div>
  )
}

export type { SrpDeliverableKey }
