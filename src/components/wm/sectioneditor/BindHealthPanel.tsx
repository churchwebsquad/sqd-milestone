/**
 * Bind health panel for the section editor.
 *
 * Surfaces every empty text slot on the bound template with two
 * one-click actions per row:
 *
 *   • Pull from a nested item's same-canonical-keyed slot (e.g.
 *     top-level `description` filled from `tab[0].description` —
 *     the canonical case for Feature 66 where content lives in
 *     tabs but the section's top-level intro is blank).
 *   • Skip the auto-bind question entirely; the slot's own AI-
 *     suggest button is the next obvious move.
 *
 * Rendered ABOVE the field editors in SectionDetailsPanel so the
 * strategist sees gaps before scrolling per-field. Self-collapses
 * when 0 slots are empty.
 */
import { useMemo } from 'react'
import { ChevronRight, ArrowDownToLine } from 'lucide-react'
import { computeBindHealth, type EmptySlotRow } from '../../../lib/webBindHealth'
import type { WebContentTemplate } from '../../../types/database'

interface Props {
  template:     WebContentTemplate | null
  fieldValues:  Record<string, unknown>
  /** Called when the strategist accepts a nested-pull suggestion. The
   *  caller writes the value into field_values via its existing
   *  setValue path. For richtext slots we wrap plain text in <p>;
   *  caller handles whatever else its slot type needs. */
  onPullSuggestion: (slotKey: string, raw: unknown, sourceType: string) => void
}

export function BindHealthPanel({ template, fieldValues, onPullSuggestion }: Props) {
  const health = useMemo(
    () => computeBindHealth(template, fieldValues),
    [template, fieldValues],
  )

  if (!template || health.totalText === 0) return null
  if (health.emptyText === 0) {
    return (
      <div className="rounded-md border border-wm-success/30 bg-wm-success-bg px-3 py-2 text-[11px] text-wm-success font-semibold">
        Bind health · all {health.filledText} text slots filled
      </div>
    )
  }

  const rowsWithSuggestions = health.emptyRows.filter(r => r.suggestions.length > 0)
  const rowsBlankOnly       = health.emptyRows.filter(r => r.suggestions.length === 0)

  return (
    <div className="rounded-md border border-wm-warning/40 bg-wm-warning-bg p-3 space-y-2">
      <p className="text-[11px] font-bold text-wm-text">
        Bind health · {health.filledText}/{health.totalText} text slots filled
        · {health.emptyText} empty
      </p>

      {rowsWithSuggestions.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">
            Content found in nested items
          </p>
          <ul className="space-y-1.5">
            {rowsWithSuggestions.map(row => (
              <EmptyRow key={row.slotKey} row={row} onPull={onPullSuggestion} />
            ))}
          </ul>
        </div>
      )}

      {rowsBlankOnly.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">
            Still blank
          </p>
          <ul className="space-y-0.5">
            {rowsBlankOnly.map(row => (
              <li key={row.slotKey} className="text-[11px] text-wm-text-muted flex items-center gap-1.5">
                <ChevronRight size={10} />
                <span className="font-mono">{row.slotLabel}</span>
                {row.required && (
                  <span className="text-wm-danger text-[10px] font-semibold">required</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function EmptyRow({
  row, onPull,
}: {
  row:    EmptySlotRow
  onPull: (slotKey: string, raw: unknown, sourceType: string) => void
}) {
  return (
    <li className="rounded border border-wm-border bg-wm-bg-elevated p-2">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[11px] font-semibold text-wm-text">{row.slotLabel}</span>
        {row.required && (
          <span className="text-[10px] font-semibold text-wm-danger">required</span>
        )}
        <span className="text-[10px] text-wm-text-subtle ml-auto font-mono">
          {row.slotType}
        </span>
      </div>
      <ul className="space-y-1">
        {row.suggestions.map((s, i) => (
          <li key={i}>
            <button
              type="button"
              onClick={() => onPull(row.slotKey, s.value, s.sourceType)}
              className="w-full text-left rounded-md border border-wm-border bg-wm-bg hover:border-wm-accent hover:bg-wm-accent-tint transition-colors px-2 py-1.5"
            >
              <div className="flex items-center gap-2">
                <ArrowDownToLine size={10} className="text-wm-accent shrink-0" />
                <span className="text-[10px] font-mono text-wm-text-muted shrink-0">
                  {s.sourceLabel}
                </span>
              </div>
              <p className="text-[11px] text-wm-text leading-snug mt-0.5">
                {s.preview}
              </p>
            </button>
          </li>
        ))}
      </ul>
    </li>
  )
}
