/**
 * MissingBlockerTaskDialog — modal shown when /api/srp/submit-to-clickup
 * returns 422 with error_code 'no_blocker_dependency'. The n8n workflow
 * couldn't resolve the "SRP Video" child task via the blocker-dependency
 * lookup, so the coach must paste the target task ID manually. The
 * dialog re-fires submit-to-clickup with srp_task_id_override set.
 */

import { useState } from 'react'
import { X, AlertCircle, Loader2 } from 'lucide-react'
import { SrpButton } from './_shared/SrpButton'

export function MissingBlockerTaskDialog({
  open,
  details,
  onCancel,
  onResubmit,
}: {
  open:    boolean
  /** Human-readable details from the 422 response (n8n's message). */
  details: string | null
  onCancel:   () => void
  onResubmit: (overrideTaskId: string) => Promise<void>
}) {
  const [override, setOverride] = useState<string>('')
  const [busy, setBusy] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  const submit = async () => {
    const id = override.trim()
    if (!id) { setError('Task ID required.'); return }
    setBusy(true); setError(null)
    try {
      await onResubmit(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'submit failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-[var(--color-deep-plum)]/40 backdrop-blur-sm flex items-start justify-center pt-24 px-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-lg rounded-xl bg-white border border-[var(--color-lavender)] shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <header className="px-5 py-3.5 flex items-center justify-between border-b border-[var(--color-lavender)] bg-[var(--color-lavender-tint)]">
          <h2 className="text-[14px] font-semibold text-[var(--color-deep-plum)] inline-flex items-center gap-1.5">
            <AlertCircle size={14} className="text-wm-danger" />
            ClickUp child task not found
          </h2>
          <button
            onClick={onCancel}
            className="text-[var(--color-purple-gray)] hover:text-[var(--color-deep-plum)]"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </header>

        <div className="p-5 space-y-3">
          <p className="text-[13px] text-[var(--color-deep-plum)]">
            n8n couldn&rsquo;t resolve the &ldquo;SRP Video&rdquo; child task via the
            blocker-dependency lookup on the parent task. Paste the
            target task ID below and we&rsquo;ll resubmit.
          </p>
          {details && (
            <p className="text-[11px] italic text-[var(--color-purple-gray)] border-l-2 border-[var(--color-lavender)] pl-2">
              {details}
            </p>
          )}
          <label className="block text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
            SRP Video task ID
          </label>
          <input
            type="text"
            value={override}
            onChange={e => setOverride(e.target.value)}
            placeholder="86c0xyz"
            autoFocus
            className="w-full rounded-lg border border-[var(--color-lavender)] bg-white px-3 py-2 text-[13px] font-mono text-[var(--color-deep-plum)] placeholder:text-[var(--color-purple-gray)] focus:outline-none focus:border-[var(--color-primary-purple)] focus:ring-2 focus:ring-[var(--color-lavender)]"
          />
          {error && <p className="text-[11px] text-wm-danger">{error}</p>}
        </div>

        <footer className="px-5 py-3 border-t border-[var(--color-lavender)] bg-[var(--color-cream)] flex items-center justify-end gap-2">
          <SrpButton variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            Cancel
          </SrpButton>
          <SrpButton
            size="sm"
            onClick={() => void submit()}
            disabled={busy || !override.trim()}
            leadingIcon={busy ? <Loader2 size={12} className="animate-spin" /> : undefined}
          >
            {busy ? 'Submitting…' : 'Resubmit'}
          </SrpButton>
        </footer>
      </div>
    </div>
  )
}
