/**
 * Custom confirmation modal — drop-in replacement for window.confirm().
 *
 * Used because some users (Chrome) have suppressed native confirm dialogs
 * via the "Prevent this page from creating additional dialogs" checkbox,
 * which silently breaks any flow that depends on confirm(). A real modal
 * can't be suppressed at the browser level.
 */

import { AlertCircle } from 'lucide-react'
import { WMButton } from './Button'

interface ConfirmDialogProps {
  open: boolean
  title: string
  body?: string | React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  loading?: boolean
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-wm-text/40 backdrop-blur-sm p-4"
      onClick={() => { if (!loading) onCancel() }}
    >
      <div
        className="w-full max-w-md rounded-lg bg-wm-bg-elevated border border-wm-border shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5">
          <div className="flex items-start gap-3 mb-3">
            {destructive && (
              <AlertCircle size={18} className="text-wm-danger shrink-0 mt-0.5" />
            )}
            <h2 className="text-[15px] font-semibold text-wm-text">{title}</h2>
          </div>
          {body && (
            <div className="text-[12px] text-wm-text-muted leading-relaxed">
              {body}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 pb-5">
          <WMButton variant="ghost" size="sm" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </WMButton>
          <WMButton
            variant={destructive ? 'danger' : 'primary'}
            size="sm"
            onClick={onConfirm}
            loading={loading}
            disabled={loading}
          >
            {confirmLabel}
          </WMButton>
        </div>
      </div>
    </div>
  )
}
