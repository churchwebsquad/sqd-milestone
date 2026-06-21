/**
 * Manual status editor — radio + reason field for waiting/blocked/paused.
 *
 * Beats the computed sub_status when set. Auto-stamps changed_at and
 * changed_by from the current Supabase session.
 *
 * When set to anything other than 'in_progress', the project is
 * treated as paused for capacity purposes (its allocations don't
 * count toward the projection — capacity frees up for other work).
 * That side-effect happens in the projection math; this component
 * only owns the write.
 */
import { useState } from 'react'
import { Loader2, Check, X } from 'lucide-react'
import type { ManualSubStatus } from '../../../types/database'

interface Props {
  current:       ManualSubStatus | null
  reason:        string | null
  changedAt:     string | null
  changedBy:     string | null
  /** Called with (status, reason) on save. Status === null clears
   *  the override and falls back to computed sub_status. */
  onSave: (status: ManualSubStatus | null, reason: string | null) => Promise<void>
  onCancel?: () => void
}

const OPTIONS: Array<{ value: ManualSubStatus | null; label: string; help: string }> = [
  { value: null,              label: 'Auto (use computed)',  help: 'Let the system derive sub_status from activity + projection.' },
  { value: 'in_progress',     label: 'In progress',           help: 'Pin to in-progress regardless of computed signal.' },
  { value: 'waiting_partner', label: 'Waiting on partner',    help: 'Pauses the projection; partner is the blocker.' },
  { value: 'blocked',         label: 'Blocked',               help: 'Pauses the projection; internal blocker (clarification, dependency).' },
  { value: 'paused',          label: 'Paused',                help: 'Pauses the projection; intentionally held.' },
]

export function ManualStatusEditor({ current, reason, changedAt, changedBy, onSave, onCancel }: Props) {
  const [pick, setPick] = useState<ManualSubStatus | null>(current)
  const [reasonDraft, setReasonDraft] = useState(reason ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const requiresReason = pick !== null && pick !== 'in_progress'

  const save = async () => {
    setError(null)
    if (requiresReason && reasonDraft.trim().length < 3) {
      setError('Reason is required when pausing.')
      return
    }
    setSaving(true)
    try {
      await onSave(pick, pick === null ? null : reasonDraft.trim() || null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border border-wm-border bg-wm-bg p-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-widest font-bold text-wm-text">Status</p>
        {changedAt && current && (
          <p className="text-[10px] font-mono text-wm-text-subtle">
            Set {fmtRelative(changedAt)}{changedBy ? ` by ${changedBy}` : ''}
          </p>
        )}
      </div>

      <fieldset className="space-y-1.5">
        {OPTIONS.map(opt => {
          const checked = pick === opt.value
          return (
            <label
              key={String(opt.value)}
              className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 cursor-pointer transition-colors ${checked ? 'border-wm-accent bg-wm-accent/5' : 'border-wm-border hover:border-wm-accent/40'}`}
            >
              <input
                type="radio"
                name="manual-status"
                checked={checked}
                onChange={() => setPick(opt.value)}
                className="mt-1 shrink-0"
              />
              <span className="flex-1 min-w-0">
                <span className="block text-[12px] font-semibold text-wm-text">{opt.label}</span>
                <span className="block text-[10.5px] text-wm-text-muted">{opt.help}</span>
              </span>
            </label>
          )
        })}
      </fieldset>

      {requiresReason && (
        <div className="space-y-1">
          <label className="block text-[11px] uppercase tracking-widest font-bold text-wm-text-muted">
            Reason
          </label>
          <textarea
            value={reasonDraft}
            onChange={e => setReasonDraft(e.target.value)}
            placeholder="What's the blocker? Surfaces in the digest + risk panel."
            rows={2}
            className="w-full rounded-md border border-wm-border bg-wm-bg-elevated px-2.5 py-1.5 text-[12px] text-wm-text outline-none focus:border-wm-accent focus:ring-2 focus:ring-wm-accent/20 resize-y"
          />
        </div>
      )}

      {error && (
        <p className="text-[11px] text-wm-danger">{error}</p>
      )}

      <div className="flex items-center gap-2 justify-end">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="inline-flex items-center gap-1 rounded-full border border-wm-border bg-wm-bg-elevated px-3 py-1 text-[11.5px] font-semibold text-wm-text-muted hover:text-wm-text hover:border-wm-accent transition-colors disabled:opacity-50"
          >
            <X size={11} /> Cancel
          </button>
        )}
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-1 rounded-full bg-wm-accent text-white px-3 py-1 text-[11.5px] font-semibold hover:bg-wm-accent-strong transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
          Save
        </button>
      </div>
    </div>
  )
}

function fmtRelative(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const days = Math.round((Date.now() - d.getTime()) / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days}d ago`
  if (days < 60) return `${Math.round(days / 7)}w ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
