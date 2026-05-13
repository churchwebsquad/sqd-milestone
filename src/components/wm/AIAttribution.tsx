/**
 * Web Manager — AIAttribution badge.
 *
 * Marks AI-generated content. Shows as "✨ Drafted by AI · 2h ago".
 * Disappears (or gets dimmed) once the strategist makes a real edit.
 * Low contrast — informational, not promotional.
 */

import { Sparkles } from 'lucide-react'

export interface WMAIAttributionProps {
  /** ISO timestamp of when the AI drafted this content */
  draftedAt: string
  /** Optional label override — defaults to "Drafted by AI" */
  label?: string
  /** When the strategist has edited since AI draft, render in muted state */
  muted?: boolean
  size?: 'sm' | 'md'
}

export function WMAIAttribution({
  draftedAt, label = 'Drafted by AI', muted = false, size = 'sm',
}: WMAIAttributionProps) {
  const relative = relativeTime(draftedAt)
  const sizeClass = size === 'sm'
    ? 'h-5 px-1.5 text-[10px] gap-1'
    : 'h-6 px-2 text-[11px] gap-1.5'

  return (
    <span
      className={[
        'inline-flex items-center rounded-full border whitespace-nowrap font-medium',
        sizeClass,
        muted
          ? 'bg-wm-bg-hover text-wm-text-subtle border-wm-border'
          : 'bg-wm-ai-bg text-wm-accent-strong border-wm-ai-border',
      ].join(' ')}
      title={`AI-drafted on ${new Date(draftedAt).toLocaleString()}`}
    >
      <Sparkles size={size === 'sm' ? 9 : 11} />
      {label} <span className="opacity-70">· {relative}</span>
    </span>
  )
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const sec = Math.round((now - then) / 1000)
  if (sec < 60)        return `${sec}s ago`
  const min = Math.round(sec / 60)
  if (min < 60)        return `${min}m ago`
  const hr  = Math.round(min / 60)
  if (hr  < 24)        return `${hr}h ago`
  const d   = Math.round(hr / 24)
  if (d   < 7)         return `${d}d ago`
  const w   = Math.round(d / 7)
  if (w   < 5)         return `${w}w ago`
  return new Date(iso).toLocaleDateString()
}
