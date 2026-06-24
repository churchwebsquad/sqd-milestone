/**
 * webQueueActivity — derives a short "where exactly is this church"
 * sub-label for the build-queue Partner cell.
 *
 * The phase column already shows the broad layer (intake / content /
 * design / dev / review / launched). This helper produces the next
 * layer of specificity: are they sitting at "not started" vs.
 * "crawled" vs. "content collection submitted" vs. "cowork Step 7"
 * vs. "Page allocation in progress" etc. — so the PM can scan the
 * queue and immediately tell who's where in the pipeline.
 *
 * Pure: takes the already-loaded project row + a few derived signals
 * and returns a string. No queries inside.
 */
import type { StrategyWebProject } from '../types/database'

export interface QueueActivitySignals {
  /** True when the project has any topics in web_project_topics
   *  (i.e. the crawl categorizer has at least started). */
  hasCrawl:           boolean
  /** Latest strategy_content_collection_sessions row for this project,
   *  if any. Used to read submission state + supplemental form. */
  contentCollection?: {
    status:                    'open' | 'submitted' | 'closed' | string
    submitted_at:              string | null
    supplemental_submitted_at: string | null
  } | null
}

/** Roadmap-state shape we sniff. Loosely typed because each church's
 *  roadmap_state grows organically and may have extra keys we don't
 *  care about here. */
interface RoadmapSniff {
  stage_1?:              { _meta?: { generated_at?: string } }
  ministry_model?:       { _meta?: { generated_at?: string } }
  acf_plan?:             { _meta?: { generated_at?: string } }
  site_strategy?:        { _meta?: { generated_at?: string } }
  page_allocation_plan?: { _meta?: { generated_at?: string } }
  page_outlines?:        Record<string, unknown>
  page_drafts?:          Record<string, unknown>
  page_critiques?:       Record<string, unknown>
  critique_rollup?:      { _meta?: { generated_at?: string } }
}

/** Produce the sub-label. Returns null when nothing useful to add
 *  (e.g. launched projects — the phase column already says everything). */
export function summarizeQueueActivity(
  project: Pick<StrategyWebProject, 'current_phase' | 'roadmap_state' | 'crawl_excluded'>,
  signals: QueueActivitySignals,
): string | null {
  const phase = (project.current_phase ?? 'intake').toLowerCase()
  if (phase === 'launched') return null

  if (phase === 'intake') {
    if (project.crawl_excluded) return 'Crawl excluded'
    if (!signals.hasCrawl)       return 'Not started — awaiting crawl'
    const cc = signals.contentCollection
    if (!cc)                     return 'Crawled, content collection not requested'
    if (cc.submitted_at)         return 'Content collection submitted · ready for strategy'
    if (cc.status === 'closed')  return 'Content collection closed without submit'
    return 'Content collection sent · awaiting partner'
  }

  if (phase === 'content') {
    const r = (project.roadmap_state ?? {}) as RoadmapSniff
    // Walk the cowork pipeline in order and return the deepest stage
    // that's been touched. Each stage is "done" when its _meta carries
    // a generated_at, OR (for entries-mode) when at least one entry has
    // its own _meta. Mirrors computeCoworkDoneSet in StepTimeline.
    const stages: Array<{ key: string; label: string; done: boolean }> = [
      { key: 'stage_1',              label: 'Atomize',         done: !!r.stage_1?._meta?.generated_at },
      { key: 'ministry_model',       label: 'Ministry model',  done: !!r.ministry_model?._meta?.generated_at },
      { key: 'acf_plan',             label: 'ACF plan',        done: !!r.acf_plan?._meta?.generated_at },
      { key: 'site_strategy',        label: 'Site strategy',   done: !!r.site_strategy?._meta?.generated_at },
      { key: 'page_allocation_plan', label: 'Page allocation', done: !!r.page_allocation_plan?._meta?.generated_at },
      { key: 'page_outlines',        label: 'Page outlines',   done: hasAnyEntry(r.page_outlines) },
      { key: 'page_drafts',          label: 'Page drafts',     done: hasAnyEntry(r.page_drafts) },
      { key: 'page_critiques',       label: 'Page critiques',  done: hasAnyEntry(r.page_critiques) },
      { key: 'critique_rollup',      label: 'Critique rollup', done: !!r.critique_rollup?._meta?.generated_at },
    ]
    let lastDone: string | null = null
    let nextUp:   string | null = null
    for (const s of stages) {
      if (s.done) lastDone = s.label
      else if (!nextUp) nextUp = s.label
    }
    if (lastDone && nextUp)        return `${lastDone} ✓ · next: ${nextUp}`
    if (lastDone && !nextUp)       return `${lastDone} ✓ · cowork pipeline complete`
    if (!lastDone && nextUp)       return `Strategy & content — starting ${nextUp}`
    return 'Strategy & content — starting'
  }

  if (phase === 'design') {
    return 'Content pushed → page layouts in progress'
  }
  if (phase === 'dev') {
    return 'Build phase — dev in progress'
  }
  if (phase === 'review') {
    return 'Out with partner for final review'
  }
  return null
}

function hasAnyEntry(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false
  for (const v of Object.values(node as Record<string, unknown>)) {
    if (v && typeof v === 'object' && (v as { _meta?: unknown })._meta) return true
  }
  return false
}
