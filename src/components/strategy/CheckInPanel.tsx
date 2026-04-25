import { useState } from 'react'
import { Calendar, CheckCheck } from 'lucide-react'
import { markCheckIn } from '../../lib/strategyNotion'
import type { Initiative } from '../../types/strategy'

/** Right-sidebar card on the Initiative Detail page. Click "Mark checked"
 *  to stamp Last Checked On + Last Checked By to today + the signed-in
 *  user. The optional note field was removed — substantive check-in
 *  context belongs in a Progress update (which is searchable, attributed,
 *  and surfaces in the cross-initiative feed). */
export function CheckInPanel({ initiative, onUpdated }: {
  initiative: Initiative
  onUpdated: (next: Initiative) => void
}) {
  const overdue = isOverdue(initiative.nextCheckInDue)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setPending(true)
    setError(null)
    try {
      const next = await markCheckIn(initiative.id, null)
      onUpdated(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="rounded-md border border-[var(--color-lib-border)] bg-[var(--color-lib-surface)] p-4">
      <div className="flex items-center gap-2 mb-3">
        <Calendar size={14} className="text-[var(--color-lib-accent)]" />
        <p className="text-[11px] font-semibold text-[var(--color-lib-text-subtle)] uppercase tracking-widest">
          Check-In
        </p>
      </div>

      <dl className="space-y-2.5 text-xs">
        <Row label="Cadence" value={initiative.checkInCadence ?? '—'} />
        <Row
          label="Last checked"
          value={
            initiative.lastCheckedOn
              ? `${formatDate(initiative.lastCheckedOn)}${initiative.lastCheckedBy ? ` · ${initiative.lastCheckedBy}` : ''}`
              : 'Never'
          }
        />
        <Row
          label="Next due"
          value={initiative.nextCheckInDue ? formatDate(initiative.nextCheckInDue) : '—'}
          accent={overdue ? 'text-status-blocked' : undefined}
        />
      </dl>

      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="mt-4 w-full inline-flex items-center justify-center gap-1.5 rounded-md bg-[var(--color-lib-accent)] text-white text-xs font-semibold py-2 hover:bg-[var(--color-lib-accent-hover)] disabled:opacity-60"
      >
        <CheckCheck size={12} />
        {pending ? 'Saving…' : 'Mark checked'}
      </button>
      {error && <p className="mt-2 text-[11px] text-red-600">{error}</p>}
    </div>
  )
}

function Row({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-[var(--color-lib-text-subtle)] uppercase tracking-wide text-[10px] font-semibold shrink-0 pt-0.5">
        {label}
      </dt>
      <dd className={`text-[var(--color-lib-text)] text-right ${accent ?? ''}`}>{value}</dd>
    </div>
  )
}

function isOverdue(iso: string | null): boolean {
  if (!iso) return false
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  return d.getTime() < Date.now()
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
