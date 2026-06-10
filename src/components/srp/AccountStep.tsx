/**
 * Step 1: Account confirmation. The account was already picked at
 * dashboard creation time — this step just displays what was selected
 * and lets the strategist confirm before moving on.
 */

import { ArrowRight, Building2, Hash, Calendar, Fingerprint } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { SmsSrpGeneration } from '../../types/database'
import { SrpStepPanel } from './_shared/SrpStepPanel'
import { SrpButton } from './_shared/SrpButton'

export function AccountStep({ session, onContinue }: {
  session: SmsSrpGeneration
  onContinue: () => void
}) {
  return (
    <SrpStepPanel
      eyebrow="Step 1 of 4"
      icon={Building2}
      title="Account"
      description="This session is for the partner below. To start an SRP for a different church, head back to the dashboard."
      footer={
        <>
          <span /> {/* spacer — no Back on step 1 */}
          <SrpButton
            variant="secondary"
            onClick={onContinue}
            trailingIcon={<ArrowRight size={14} />}
          >
            Confirm and continue
          </SrpButton>
        </>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <KV icon={Building2} label="Church"     value={session.church_name ?? '—'} />
        <KV icon={Hash}       label="Member"     value={session.member ?? '—'} mono />
        <KV icon={Fingerprint} label="Session ID" value={session.session_id} mono />
        <KV icon={Calendar}   label="Created"    value={session.created_at ? new Date(session.created_at).toLocaleString() : '—'} />
      </div>
    </SrpStepPanel>
  )
}

function KV({ icon: Icon, label, value, mono }: { icon: LucideIcon; label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-[var(--color-lavender)] bg-[var(--color-cream)] p-3 flex items-start gap-2.5">
      <span className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md bg-white text-[var(--color-primary-purple)] border border-[var(--color-lavender)]">
        <Icon size={13} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-[var(--color-purple-gray)]">{label}</p>
        <p className={['text-[13px] text-[var(--color-deep-plum)] mt-0.5 break-words', mono ? 'font-mono' : ''].join(' ')}>{value}</p>
      </div>
    </div>
  )
}
