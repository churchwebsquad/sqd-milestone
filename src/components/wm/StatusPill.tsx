/**
 * Web Manager — StatusPill. Semantic status indicator.
 *
 * Tones map to status meaning:
 *   - draft / proposed / pending   → neutral (muted text on white)
 *   - in_review / waiting          → info (blue)
 *   - approved / ready / received  → success (green)
 *   - warning / changes_requested  → warning (amber)
 *   - error / failed / archived    → danger (red) / neutral
 *   - ai                           → AI surface (accent tint)
 */

import type { ReactNode } from 'react'

export type WMStatusTone =
  // System semantics — validation, save state, etc.
  | 'neutral'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger'
  | 'ai'
  // Feedback-tone palette — saturated colors for the feedback board UI
  // (and any other surface that wants vibrant status pills). Distinct
  // from the muted semantic tokens above.
  | 'orange'
  | 'blue'
  | 'pink'
  | 'green'
  | 'turquoise'
  | 'yellow'

export interface WMStatusPillProps {
  tone?: WMStatusTone
  size?: 'sm' | 'md'
  icon?: ReactNode
  children: ReactNode
}

const TONE_CLASSES: Record<WMStatusTone, string> = {
  neutral:   'bg-wm-bg-hover text-wm-text-muted border-wm-border',
  info:      'bg-wm-info-bg text-wm-info border-wm-info/15',
  success:   'bg-wm-success-bg text-wm-success border-wm-success/15',
  warning:   'bg-wm-warning-bg text-wm-warning border-wm-warning/15',
  danger:    'bg-wm-danger-bg text-wm-danger border-wm-danger/15',
  ai:        'bg-wm-ai-bg text-wm-accent-strong border-wm-ai-border',
  orange:    'bg-wm-tone-orange-bg text-wm-tone-orange border-wm-tone-orange/20',
  blue:      'bg-wm-tone-blue-bg text-wm-tone-blue border-wm-tone-blue/20',
  pink:      'bg-wm-tone-pink-bg text-wm-tone-pink border-wm-tone-pink/20',
  green:     'bg-wm-tone-green-bg text-wm-tone-green border-wm-tone-green/20',
  turquoise: 'bg-wm-tone-turquoise-bg text-wm-tone-turquoise border-wm-tone-turquoise/20',
  yellow:    'bg-wm-tone-yellow-bg text-wm-tone-yellow border-wm-tone-yellow/20',
}

const SIZE_CLASSES = {
  sm: 'h-5 px-1.5 text-[10px] gap-1',
  md: 'h-6 px-2   text-[11px] gap-1.5',
}

export function WMStatusPill({
  tone = 'neutral',
  size = 'md',
  icon,
  children,
}: WMStatusPillProps) {
  return (
    <span
      className={[
        'inline-flex items-center rounded-full border font-semibold uppercase tracking-wide whitespace-nowrap',
        TONE_CLASSES[tone],
        SIZE_CLASSES[size],
      ].join(' ')}
    >
      {icon}
      {children}
    </span>
  )
}
