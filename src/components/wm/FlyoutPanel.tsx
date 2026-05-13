/**
 * Web Manager — FlyoutPanel. Right-side slide-in panel.
 *
 * Used for the catalog side panel (template picker) and any other
 * "open a focused side surface from a main workspace" pattern. Closes
 * on Esc and on backdrop click.
 *
 * Width presets: sm (380px), md (480px), lg (640px), xl (820px).
 * Default md.
 */

import { useEffect } from 'react'
import { X } from 'lucide-react'
import { WMIconButton } from './IconButton'

export interface WMFlyoutPanelProps {
  open: boolean
  onClose: () => void
  title?: string
  subtitle?: string
  width?: 'sm' | 'md' | 'lg' | 'xl'
  children: React.ReactNode
  footer?: React.ReactNode
  /** Optional header-right slot for action chips, status, etc. */
  headerRight?: React.ReactNode
}

const WIDTH_CLASSES = {
  sm: 'max-w-[380px]',
  md: 'max-w-[480px]',
  lg: 'max-w-[640px]',
  xl: 'max-w-[820px]',
} as const

export function WMFlyoutPanel({
  open, onClose, title, subtitle, width = 'md',
  children, footer, headerRight,
}: WMFlyoutPanelProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-wm-text/30 backdrop-blur-[1px] animate-wm-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={[
          'relative w-full h-full bg-wm-bg-elevated border-l border-wm-border shadow-2xl overflow-hidden flex flex-col',
          'animate-wm-slide-in-right',
          WIDTH_CLASSES[width],
        ].join(' ')}
      >
        {(title || subtitle || headerRight) && (
          <header className="flex items-center justify-between gap-3 px-5 py-3 border-b border-wm-border bg-wm-bg-elevated">
            <div className="min-w-0">
              {subtitle && (
                <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong">{subtitle}</p>
              )}
              {title && (
                <h2 className="text-base font-semibold text-wm-text truncate">{title}</h2>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {headerRight}
              <WMIconButton label="Close panel" onClick={onClose}>
                <X size={16} />
              </WMIconButton>
            </div>
          </header>
        )}

        <div className="flex-1 overflow-y-auto">{children}</div>

        {footer && (
          <footer className="px-5 py-3 border-t border-wm-border bg-wm-bg-elevated">
            {footer}
          </footer>
        )}
      </aside>
    </div>
  )
}
