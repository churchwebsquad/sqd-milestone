/**
 * Team-level aggregations across all web projects. Backs the sales
 * quote calculator + (future) Phase 8 pace dashboard.
 *
 * Inputs: a snapshot of the project rows (post-fetch). Pure.
 */
import { fromIsoDate, daysBetween } from './dateRange'
import type { StrategyWebProject } from '../types/database'

export interface SalesQuoteResult {
  /** Median weeks from project_created → launched, across launched
   *  projects. Best representation of "typical lead time". */
  medianWeeks:        number | null
  /** 80th percentile — the "safe quote" number. Quote this to
   *  prospects when you want to err on the side of under-promising. */
  safeQuoteWeeks:     number | null
  sampleSize:         number
  confidence:         'high' | 'medium' | 'low'
  /** A one-liner the SalesQuoteCard renders verbatim. */
  oneLiner:           string
}

/** Compute the sales-quote suggestion from launched-project history.
 *  `projects` should be ALL projects (archived + active) so launched
 *  ones with archived=true still count. */
export function computeSalesQuote(
  projects: Array<Pick<StrategyWebProject,
    'current_phase' | 'created_at' | 'launch_date' | 'updated_at'
  >>,
): SalesQuoteResult {
  const launched = projects.filter(p => p.current_phase === 'launched')
  const weeks: number[] = []
  for (const p of launched) {
    const created = fromIsoDate(p.created_at)
    // Use updated_at as the actual launch date (current_phase advanced
    // there). launch_date is the *target*, not the actual.
    const launched = fromIsoDate(p.updated_at)
    if (!created || !launched) continue
    const days = daysBetween(created, launched)
    if (days <= 0) continue
    weeks.push(Math.round(days / 7))
  }
  weeks.sort((a, b) => a - b)
  const n = weeks.length

  if (n === 0) {
    return {
      medianWeeks: null,
      safeQuoteWeeks: null,
      sampleSize: 0,
      confidence: 'low',
      oneLiner: 'Not enough launched projects yet to baseline a sales quote.',
    }
  }

  const median = weeks[Math.floor(n / 2)]
  const p80    = weeks[Math.min(n - 1, Math.floor(n * 0.8))]
  const confidence: SalesQuoteResult['confidence'] =
    n >= 10 ? 'high'
    : n >= 5  ? 'medium'
    :           'low'

  const oneLiner =
    confidence === 'low'
      ? `Quote ~${p80} weeks (low confidence; only ${n} launched).`
      : `Quote new prospects ~${p80} weeks (median ${median}, 80th-percentile ${p80}, n=${n}).`

  return { medianWeeks: median, safeQuoteWeeks: p80, sampleSize: n, confidence, oneLiner }
}
