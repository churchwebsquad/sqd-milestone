/**
 * Step 1: Account confirmation. The account was already picked at
 * dashboard creation time — this step just displays what was selected
 * and lets the strategist confirm before moving on.
 */

import { ArrowRight } from 'lucide-react'
import type { SmsSrpGeneration } from '../../types/database'

export function AccountStep({ session, onContinue }: {
  session: SmsSrpGeneration
  onContinue: () => void
}) {
  return (
    <section className="rounded-lg border border-wm-border bg-wm-bg-elevated p-5 space-y-4">
      <header>
        <h2 className="text-[16px] font-semibold text-wm-text">Account</h2>
        <p className="text-[12px] text-wm-text-muted mt-1">
          This session is for the partner below. To start an SRP for a different church, head back to the dashboard.
        </p>
      </header>
      <div className="grid grid-cols-2 gap-3">
        <KV label="Church" value={session.church_name ?? '—'} />
        <KV label="Member" value={session.member ?? '—'} mono />
        <KV label="Session ID" value={session.session_id} mono />
        <KV label="Created" value={session.created_at ? new Date(session.created_at).toLocaleString() : '—'} />
      </div>
      <div className="flex justify-end">
        <button
          onClick={onContinue}
          className="inline-flex items-center gap-1.5 rounded-full bg-wm-accent px-4 py-1.5 text-[12px] text-white"
        >
          Continue <ArrowRight size={12} />
        </button>
      </div>
    </section>
  )
}

function KV({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md bg-wm-bg border border-wm-border p-2.5">
      <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">{label}</p>
      <p className={['text-[13px] text-wm-text mt-0.5', mono ? 'font-mono' : ''].join(' ')}>{value}</p>
    </div>
  )
}
