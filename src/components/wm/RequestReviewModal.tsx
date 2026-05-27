/**
 * Modal: ask another staff member to do an internal review of this
 * site, with optional notes about what to focus on. Writes to
 * web_review_requests; the assignee sees it on their Review tab.
 */
import { useEffect, useState } from 'react'
import { Loader2, X, Send } from 'lucide-react'
import { listStaffEmployees } from '../../lib/library'
import { createReviewRequest } from '../../lib/webReviews'
import type { EmployeeRef } from '../../types/strategy'

interface Props {
  projectId: string
  /** Email of the current user, so we filter them out of the picker. */
  currentEmail: string | null
  onClose: () => void
  onCreated: () => Promise<void>
}

export function RequestReviewModal({
  projectId, currentEmail, onClose, onCreated,
}: Props) {
  const [staff, setStaff] = useState<EmployeeRef[]>([])
  const [loading, setLoading] = useState(true)
  const [assigneeEmail, setAssigneeEmail] = useState<string>('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const rows = await listStaffEmployees()
        // Filter out the requester themselves and anyone without an email
        // (they can't be matched on login).
        const me = currentEmail?.toLowerCase().trim() ?? null
        setStaff(rows.filter(r => r.email && r.email.toLowerCase() !== me))
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load staff list.')
      } finally {
        setLoading(false)
      }
    })()
  }, [currentEmail])

  const submit = async () => {
    if (!assigneeEmail) return
    setSubmitting(true)
    setError(null)
    const target = staff.find(s => s.email === assigneeEmail)
    const res = await createReviewRequest({
      projectId,
      assigneeEmail,
      assigneeName: target?.fullName ?? null,
      notes,
    })
    setSubmitting(false)
    if (res.ok) {
      await onCreated()
      onClose()
    } else {
      setError(res.error ?? 'Failed to send request.')
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-wm-text/40 backdrop-blur-sm p-4 wm-theme"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="max-w-md w-full rounded-xl bg-wm-bg-elevated border border-wm-border shadow-xl flex flex-col">
        <header className="px-5 py-4 border-b border-wm-border flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong">Internal review</p>
            <h2 className="text-[16px] font-semibold text-wm-text">Request a review</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 h-7 w-7 grid place-items-center rounded-md text-wm-text-muted hover:bg-wm-bg-hover hover:text-wm-text transition-colors"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </header>

        <div className="px-5 py-4 space-y-4">
          <label className="block">
            <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle block mb-1.5">
              Who should review?
            </span>
            {loading ? (
              <div className="h-9 rounded-md border border-wm-border bg-wm-bg-hover animate-pulse" />
            ) : (
              <select
                value={assigneeEmail}
                onChange={(e) => setAssigneeEmail(e.target.value)}
                className="w-full rounded-md border border-wm-border-strong bg-wm-bg-elevated px-3 py-2 text-[13px] text-wm-text outline-none focus:border-wm-border-focus focus:ring-2 focus:ring-wm-accent-tint"
              >
                <option value="">— Pick a staff member —</option>
                {staff.map(s => (
                  <option key={s.id} value={s.email ?? ''}>
                    {s.fullName ?? s.email}
                    {s.department ? ` · ${s.department}` : ''}
                  </option>
                ))}
              </select>
            )}
          </label>

          <label className="block">
            <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle block mb-1.5">
              Notes (optional)
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Anything you'd like them to focus on — pages, sections, tone, anything."
              className="w-full rounded-md border border-wm-border-strong bg-wm-bg-elevated px-3 py-2 text-[13px] text-wm-text placeholder-wm-text-subtle outline-none focus:border-wm-border-focus focus:ring-2 focus:ring-wm-accent-tint"
            />
          </label>

          {error && (
            <div role="alert" className="rounded-md border border-wm-danger/40 bg-wm-danger-bg px-2.5 py-1.5 text-[11px] text-wm-danger">
              {error}
            </div>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-wm-border flex items-center justify-end gap-2 bg-wm-bg/60">
          <button
            type="button"
            onClick={onClose}
            className="text-[12px] font-semibold text-wm-text-muted hover:text-wm-text px-3 py-2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!assigneeEmail || submitting}
            className="inline-flex items-center gap-1.5 rounded-md bg-wm-text text-white text-[12px] font-semibold px-4 py-2 hover:bg-black transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            Send request
          </button>
        </footer>
      </div>
    </div>
  )
}
