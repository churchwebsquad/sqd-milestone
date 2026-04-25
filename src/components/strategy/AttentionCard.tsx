import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import { ArrowRight } from 'lucide-react'

/** Hero stat card shown in a row at the top of the Command Center. Three of
 *  these sit side-by-side: Recent Progress / Milestones This Week / Needs
 *  Check-In. The `preview` slot holds a short list of the top 3 items that
 *  the count is summarizing. */
export function AttentionCard({
  icon: Icon,
  label,
  count,
  linkTo,
  linkLabel,
  preview,
  emptyCopy,
}: {
  icon: LucideIcon
  label: string
  count: number
  linkTo: string
  linkLabel: string
  preview: ReactNode
  emptyCopy: string
}) {
  return (
    <div className="rounded-2xl border border-lavender bg-white p-5 shadow-sm flex flex-col">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-lavender-tint flex items-center justify-center">
            <Icon size={14} className="text-primary-purple" />
          </div>
          <p className="text-[11px] font-bold text-deep-plum uppercase tracking-widest">
            {label}
          </p>
        </div>
        <span className="text-2xl font-semibold text-deep-plum leading-none">
          {count}
        </span>
      </div>

      <div className="flex-1 min-h-[72px]">
        {count === 0 ? (
          <p className="text-xs text-purple-gray/80 italic">{emptyCopy}</p>
        ) : (
          preview
        )}
      </div>

      <Link
        to={linkTo}
        className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-primary-purple hover:text-deep-plum transition-colors"
      >
        {linkLabel}
        <ArrowRight size={11} />
      </Link>
    </div>
  )
}
