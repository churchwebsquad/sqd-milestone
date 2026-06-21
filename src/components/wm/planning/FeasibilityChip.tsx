/**
 * Inline feasibility chip for the launch-date input. Recomputes on
 * every keystroke (debounced upstream).
 */
import { Check, AlertTriangle, X, HelpCircle } from 'lucide-react'
import type { FeasibilityResult } from '../../../lib/webFeasibility'

interface Props {
  result:  FeasibilityResult
  /** Called when the user clicks the suggestion's "Apply" affordance. */
  onApplySuggestion?: (earliestISO: string) => void
}

export function FeasibilityChip({ result, onApplySuggestion }: Props) {
  const v = result.verdict
  const tone =
    v === 'feasible'   ? { bg: 'bg-emerald-50',  text: 'text-emerald-700',  border: 'border-emerald-300', Icon: Check }
  : v === 'tight'      ? { bg: 'bg-amber-50',    text: 'text-amber-700',    border: 'border-amber-300',   Icon: AlertTriangle }
  : v === 'infeasible' ? { bg: 'bg-rose-50',     text: 'text-rose-700',     border: 'border-rose-300',    Icon: X }
                       : { bg: 'bg-wm-bg-elevated', text: 'text-wm-text-muted', border: 'border-wm-border', Icon: HelpCircle }
  const Icon = tone.Icon
  return (
    <div className={`rounded-md border ${tone.border} ${tone.bg} px-2.5 py-1.5 text-[11px] ${tone.text} flex items-start gap-2`}>
      <Icon size={12} className="shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-semibold">{result.oneLiner}</p>
        {result.suggestion && (
          <p className="text-[10.5px] opacity-90">
            Suggestion: {result.suggestion.detail}
            {result.suggestion.kind === 'push_date' && result.suggestion.earliestISO && onApplySuggestion && (
              <button
                type="button"
                onClick={() => onApplySuggestion(result.suggestion!.earliestISO!)}
                className="ml-1.5 underline font-semibold hover:no-underline"
              >
                Apply
              </button>
            )}
          </p>
        )}
      </div>
    </div>
  )
}
