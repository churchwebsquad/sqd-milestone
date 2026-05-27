/**
 * Toggle chip for tagging a feedback comment as Design or Content.
 *
 * The new card UI puts both options in a row labelled "Type:" so the
 * strategist can categorize at-a-glance. Selected state fills the
 * chip with a soft tone (turquoise = design, indigo-purple = content);
 * unselected is dashed-border with placeholder "+ Design" / "+ Content"
 * copy, matching the HTML mockup.
 *
 * Pure visual — controller (FeedbackCard) wires onClick to
 * setCommentCategory and refreshes.
 */
import type { WebReviewCommentCategory } from '../../../types/database'

export interface CategoryChipProps {
  type: WebReviewCommentCategory  // 'design' | 'content'
  selected: boolean
  onClick: () => void | Promise<void>
  disabled?: boolean
}

const CONTENT_FG = '#6B33CC'
const CONTENT_BG = '#F0E5FF'

export function CategoryChip({ type, selected, onClick, disabled }: CategoryChipProps) {
  const label = type === 'design' ? 'Design' : 'Content'

  if (selected) {
    const cls = type === 'design'
      ? 'bg-wm-tone-turquoise-bg text-wm-tone-turquoise'
      : 'text-[var(--content-fg)] bg-[var(--content-bg)]'
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={`${label} — click to remove`}
        className={[
          'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border border-transparent transition-colors disabled:opacity-50',
          cls,
        ].join(' ')}
        style={type === 'content' ? ({ '--content-fg': CONTENT_FG, '--content-bg': CONTENT_BG } as React.CSSProperties) : undefined}
      >
        {label}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={`Mark as ${label.toLowerCase()}`}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border border-dashed border-wm-border-strong text-wm-text-subtle hover:border-solid hover:text-wm-text hover:bg-wm-bg-hover transition-colors disabled:opacity-50"
    >
      + {label}
    </button>
  )
}
