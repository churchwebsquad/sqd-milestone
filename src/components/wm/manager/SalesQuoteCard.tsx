/**
 * One-liner sales quote suggestion for the top of the Web Manager.
 *
 * Sales / Ashley asks: "How long should I tell a new prospect they'll
 * wait for a website?" Answer = median + 80th-percentile lead time
 * from launched projects. Confidence label tells the user how much
 * to trust the number.
 *
 * Hidden when sample size is 0; renders a low-confidence variant
 * when n < 5.
 */
import { useMemo } from 'react'
import { Copy } from 'lucide-react'
import { computeSalesQuote } from '../../../lib/teamPaceMetrics'
import type { ProjectRowVM } from '../../../hooks/useProjectsWithHealth'

interface Props {
  rows: ProjectRowVM[]
}

export function SalesQuoteCard({ rows }: Props) {
  const quote = useMemo(() => computeSalesQuote(rows), [rows])

  if (quote.sampleSize === 0) return null

  const copy = async () => {
    await navigator.clipboard.writeText(quote.oneLiner)
  }

  return (
    <div className="rounded-xl border border-wm-border bg-wm-bg-elevated px-4 py-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">
          Sales benchmark
        </p>
        <p className="text-[13px] font-semibold text-wm-text mt-0.5 truncate">
          {quote.oneLiner}
        </p>
      </div>
      <button
        type="button"
        onClick={copy}
        title="Copy quote"
        className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-[11px] font-semibold bg-wm-accent-tint text-wm-accent-strong border border-wm-accent/30 hover:bg-wm-accent/15 transition-colors shrink-0"
      >
        <Copy size={11} /> Copy
      </button>
    </div>
  )
}
