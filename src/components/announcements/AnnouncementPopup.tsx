/**
 * "What's New" popup that surfaces a pending announcement.
 *
 * Visual lineage: matches the brand chrome used by the existing
 * PerDocOverrideModal in src/components/library/SquadProgress.tsx —
 * fixed full-screen overlay with a centered lavender card, brand
 * primary-purple eyebrow, deep-plum headline. Stays compact (max-md)
 * so the popup feels like a friendly nudge rather than a blocker.
 */

import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Sparkles, X } from 'lucide-react'
import type { StrategyAnnouncement } from '../../types/database'

export function AnnouncementPopup({ announcement, onDismiss }: {
  announcement: StrategyAnnouncement
  onDismiss: () => void
}) {
  // Escape closes the popup — keyboard parity with the close button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDismiss])

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-deep-plum/40 px-4 py-6"
      onClick={onDismiss}
    >
      <div
        className="bg-cream rounded-2xl max-w-md w-full shadow-2xl border border-lavender overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header band — purple gradient eyebrow, gives the popup a
            distinct "announcement" feel vs. the rest of the app's
            modals. */}
        <div
          className="px-6 py-4 text-white"
          style={{ background: 'linear-gradient(135deg, #341756 0%, #513DE5 100%)' }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] inline-flex items-center gap-1.5">
                <Sparkles size={12} />
                What's New
              </p>
              <p className="text-[11px] opacity-80 mt-0.5 truncate">
                {announcement.initiative_name}
              </p>
            </div>
            <button
              type="button"
              onClick={onDismiss}
              className="text-white/70 hover:text-white shrink-0"
              aria-label="Dismiss"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          <h2 className="text-lg font-semibold text-deep-plum tracking-tight leading-snug mb-2">
            {announcement.headline}
          </h2>
          {announcement.body && (
            <p className="text-sm text-deep-plum/80 leading-relaxed whitespace-pre-wrap">
              {announcement.body}
            </p>
          )}
        </div>

        {/* CTAs */}
        <div className="px-6 pb-5 flex items-center justify-between gap-2">
          <Link
            to={`/strategy/initiatives/${announcement.initiative_notion_id}`}
            onClick={onDismiss}
            className="inline-flex items-center gap-1 rounded-full border border-lavender bg-white text-xs font-semibold text-deep-plum px-3 py-1.5 hover:border-primary-purple hover:text-primary-purple transition-colors"
          >
            View initiative
            <ArrowRight size={11} />
          </Link>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-full bg-deep-plum text-white text-xs font-semibold px-4 py-1.5 hover:bg-primary-purple transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}
