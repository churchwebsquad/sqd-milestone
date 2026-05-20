/**
 * Bottom-right toast that surfaces when a newer build has been deployed.
 *
 * Mounted once in AppLayout so every authed page benefits. Until the
 * user reloads, they're still running the old bundle — the toast nudges
 * them without interrupting the current task. Dismiss to silence for
 * this version; a future deploy will surface the prompt again.
 */

import { useState } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { useAppVersionCheck } from '../hooks/useAppVersionCheck'

export default function UpdateAvailableToast() {
  const { updateAvailable } = useAppVersionCheck()
  const [dismissed, setDismissed] = useState(false)

  if (!updateAvailable || dismissed) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-40 max-w-sm rounded-2xl bg-deep-plum text-white shadow-xl border border-primary-purple/40 px-4 py-3 flex items-start gap-3 animate-[fadeIn_0.2s_ease-out]"
    >
      <RefreshCw size={16} className="text-lavender mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold leading-snug">A new version of the app is ready</p>
        <p className="text-xs text-white/75 mt-0.5">
          Save any in-progress work, then reload to pick up the latest features and fixes.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-1.5 rounded-full bg-white text-deep-plum text-xs font-bold px-3 py-1.5 hover:bg-lavender-tint transition-colors"
          >
            <RefreshCw size={11} />
            Reload now
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="text-xs text-white/70 hover:text-white px-1.5 py-1.5"
          >
            Later
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="text-white/60 hover:text-white shrink-0"
      >
        <X size={14} />
      </button>
    </div>
  )
}
