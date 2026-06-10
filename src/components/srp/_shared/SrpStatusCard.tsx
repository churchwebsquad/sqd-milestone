/**
 * Colored alert / status card. Modeled on srp-generator-main's
 * pattern of "colored alert box per status" (blue/green/amber/red)
 * but in the CMS brand palette: backgrounds tinted with the existing
 * wm-* semantic tokens so success/warning/danger pull from the same
 * source of truth as the rest of the app.
 *
 * `info` (lavender) and `accent` (Primary Purple) variants are
 * specific to SRP — used for "transcription in progress" and
 * "generation complete" states the standard semantic tokens don't
 * cover well.
 */

import type { LucideIcon } from 'lucide-react'

type Tone = 'info' | 'success' | 'warning' | 'danger' | 'accent'

const TONE: Record<Tone, { border: string; bg: string; text: string; iconColor: string }> = {
  info: {
    border:    'border-wm-info/30',
    bg:        'bg-wm-info-bg',
    text:      'text-wm-info',
    iconColor: 'text-wm-info',
  },
  success: {
    border:    'border-wm-success/30',
    bg:        'bg-wm-success-bg',
    text:      'text-wm-success',
    iconColor: 'text-wm-success',
  },
  warning: {
    border:    'border-wm-warning/40',
    bg:        'bg-wm-warning-bg',
    text:      'text-wm-warning',
    iconColor: 'text-wm-warning',
  },
  danger: {
    border:    'border-wm-danger/30',
    bg:        'bg-wm-danger-bg',
    text:      'text-wm-danger',
    iconColor: 'text-wm-danger',
  },
  accent: {
    border:    'border-[var(--color-lavender)]',
    bg:        'bg-[var(--color-lavender-tint)]',
    text:      'text-[var(--color-deep-plum)]',
    iconColor: 'text-[var(--color-primary-purple)]',
  },
}

export function SrpStatusCard({
  tone, icon: Icon, title, children, actions,
}: {
  tone:     Tone
  icon?:    LucideIcon
  title?:   string
  children?: React.ReactNode
  /** Right-aligned action row (typically a Retry / Cancel button). */
  actions?: React.ReactNode
}) {
  const t = TONE[tone]
  return (
    <div className={['rounded-lg border px-4 py-3', t.border, t.bg].join(' ')}>
      <div className="flex items-start gap-3">
        {Icon && (
          <span className={['shrink-0 mt-0.5', t.iconColor].join(' ')}>
            <Icon size={16} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          {title && <p className={['text-[13px] font-semibold leading-snug', t.text].join(' ')}>{title}</p>}
          {children && <div className={['text-[12px] leading-snug', title ? 'mt-1' : '', t.text].join(' ')}>{children}</div>}
        </div>
        {actions && <div className="shrink-0 flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  )
}
