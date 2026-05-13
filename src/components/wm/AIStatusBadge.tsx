/**
 * Web Manager — AIStatusBadge. Live AI activity indicator in the header.
 *
 * Five states the header surfaces:
 *   - idle:        "AI: Idle"           neutral
 *   - extracting:  "AI: Extracting…"    accent + pulse
 *   - drafting:    "AI: Drafting Page X — 3/8"   accent + pulse + counter
 *   - awaiting:    "AI: Awaiting your approval" warning
 *   - done:        "AI: All pages drafted"      success
 *
 * Click to expand into the Roadmap workspace's pipeline section.
 */

import { Sparkles, AlertCircle, CheckCircle, Loader2 } from 'lucide-react'

export type WMAIState = 'idle' | 'extracting' | 'drafting' | 'awaiting' | 'done'

export interface WMAIStatusBadgeProps {
  state: WMAIState
  /** Free-form text describing what AI is doing or needs */
  message?: string
  /** Optional progress, e.g. {current: 3, total: 8} */
  progress?: { current: number; total: number }
  onClick?: () => void
}

export function WMAIStatusBadge({ state, message, progress, onClick }: WMAIStatusBadgeProps) {
  const styles = STATE_STYLES[state]
  const Icon = styles.icon
  const showSpinner = state === 'extracting' || state === 'drafting'

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[12px] font-medium transition-colors',
        styles.bg, styles.fg, styles.border,
        onClick ? 'hover:brightness-[0.97] cursor-pointer' : 'cursor-default',
      ].join(' ')}
      aria-live="polite"
    >
      {showSpinner ? <Loader2 size={11} className="animate-spin" /> : <Icon size={11} />}
      <span className="font-semibold">AI</span>
      {message && <span className="opacity-80">· {message}</span>}
      {progress && (
        <span className="opacity-80 tabular-nums">· {progress.current}/{progress.total}</span>
      )}
    </button>
  )
}

const STATE_STYLES = {
  idle:       { bg: 'bg-wm-bg-hover', fg: 'text-wm-text-muted', border: 'border-wm-border',     icon: Sparkles },
  extracting: { bg: 'bg-wm-ai-bg',    fg: 'text-wm-accent-strong', border: 'border-wm-ai-border', icon: Sparkles },
  drafting:   { bg: 'bg-wm-ai-bg',    fg: 'text-wm-accent-strong', border: 'border-wm-ai-border', icon: Sparkles },
  awaiting:   { bg: 'bg-wm-warning-bg', fg: 'text-wm-warning', border: 'border-wm-warning/15', icon: AlertCircle },
  done:       { bg: 'bg-wm-success-bg', fg: 'text-wm-success', border: 'border-wm-success/15', icon: CheckCircle },
} as const
