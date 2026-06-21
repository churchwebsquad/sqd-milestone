/**
 * Cascade preview for priority changes.
 *
 * When the user changes priority_order, recompute the dev queue with
 * the candidate priority and surface the impact: which projects
 * shifted earlier vs later, by how many days. Lets the user see the
 * downstream effect before committing.
 *
 * Pure presentational — the parent passes precomputed "before" /
 * "after" projections per project; this component renders the diff.
 */
import { TrendingDown, TrendingUp, Minus } from 'lucide-react'

export interface CascadeRow {
  projectId:   string
  projectName: string
  beforeISO:   string | null
  afterISO:    string | null
  /** Positive = pushed later. Negative = pulled earlier. */
  deltaDays:   number
}

interface Props {
  rows: CascadeRow[]
  /** Optional title — defaults to "Impact preview". */
  title?: string
}

export function PriorityCascadePreview({ rows, title = 'Impact preview' }: Props) {
  if (rows.length === 0) {
    return (
      <p className="text-[11px] text-wm-text-subtle italic">
        No downstream projects affected by this change.
      </p>
    )
  }
  // Order: largest shifts first.
  const sorted = [...rows].sort((a, b) => Math.abs(b.deltaDays) - Math.abs(a.deltaDays))
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] uppercase tracking-widest font-bold text-wm-text-muted">{title}</p>
      <ul className="space-y-1 text-[11.5px]">
        {sorted.slice(0, 8).map(r => {
          const Icon = r.deltaDays > 0 ? TrendingUp : r.deltaDays < 0 ? TrendingDown : Minus
          const tone =
            r.deltaDays > 7  ? 'text-rose-700'
          : r.deltaDays > 0  ? 'text-amber-700'
          : r.deltaDays < 0  ? 'text-emerald-700'
                             : 'text-wm-text-muted'
          return (
            <li key={r.projectId} className="flex items-center gap-2">
              <Icon size={11} className={`shrink-0 ${tone}`} />
              <span className="text-wm-text truncate flex-1">{r.projectName}</span>
              <span className={`font-mono shrink-0 ${tone}`}>
                {r.deltaDays === 0
                  ? '—'
                  : `${r.deltaDays > 0 ? '+' : ''}${r.deltaDays}d`}
              </span>
              <span className="font-mono text-wm-text-subtle text-[10.5px] shrink-0 w-20 text-right">
                {r.afterISO ?? '—'}
              </span>
            </li>
          )
        })}
        {sorted.length > 8 && (
          <li className="text-[10.5px] text-wm-text-subtle italic pl-4">
            +{sorted.length - 8} more
          </li>
        )}
      </ul>
    </div>
  )
}
