/**
 * Web Manager — planning math shared by the per-project Planning tab,
 * the Phase board, the Waterfall, and the Calendar views.
 *
 * Conventions:
 *   • Sprints are 2-week cadences pinned to Mondays. The sprint
 *     containing a given date covers Monday-of-week through Sunday
 *     of the following week.
 *   • Size tier auto-derives from sitemap page count, with manual
 *     override on the project row (dev_hours_estimate).
 *   • Partner-review windows are advisory target dates, not hard
 *     deadlines — the calendar/waterfall surface them with a "target"
 *     visual treatment so the strategist sees the cadence without
 *     red-flagging a soft date.
 */
import { addWeeks, fromIsoDate, toIsoDate, weekStart } from './dateRange'
import type { WebProjectPhase } from '../types/database'

// ── Size tier ──────────────────────────────────────────────────────

export type ProjectSizeTier = 'small' | 'medium' | 'large'

/** Auto-derive size tier from sitemap page count.
 *
 * Tiers per Ashley's call (2026-06-19):
 *   • small  · < 17 pages    · 30h base
 *   • medium · 18–21 pages   · 60h base
 *   • large  · 22+ pages     · 80h base
 *
 * Both `null` and `0` return 'medium' — they both mean "sitemap
 * doesn't exist yet, plan against a 20-page expectation." Once the
 * sitemap has any pages at all (>= 1), the count is trusted. */
export function deriveSizeTier(pageCount: number | null | undefined): ProjectSizeTier {
  if (pageCount == null || pageCount === 0) return 'medium'
  if (pageCount < 18) return 'small'
  if (pageCount <= 21) return 'medium'
  return 'large'
}

/** Base hour target per tier — what dev SHOULD take if all goes well. */
export function baseHoursForTier(tier: ProjectSizeTier): number {
  switch (tier) {
    case 'small':  return 30
    case 'medium': return 60
    case 'large':  return 80
  }
}

/** Realistic hour range per tier: (base, likely, complex).
 *  base = ideal scope; likely = our actual average; complex = upper
 *  bound when the partner has unusual integrations / approval delays. */
export function hourRangeForTier(tier: ProjectSizeTier): {
  base: number
  likely: number
  complex: number
} {
  switch (tier) {
    case 'small':  return { base: 30, likely: 45, complex: 60 }
    case 'medium': return { base: 60, likely: 70, complex: 85 }
    case 'large':  return { base: 80, likely: 95, complex: 120 }
  }
}

// ── Dev hours total (v89 — page count × levers) ────────────────────
//
// The single source of truth for "how many dev hours does this project
// need from now until launch." Driven by:
//   - manual dev_hours_estimate override (always wins)
//   - expected_page_count (manual input) or actual web_pages count
//   - dev_hours_per_page baseline (team default 3.0; can be lowered
//     per project for Novamira-friendly partners)
//   - uses_novamira flag (0.5× multiplier)
//   - dev_edits_route_to_designer flag (shifts ~15% review touch-ups
//     off dev's queue)
//
// Replaces deriveSizeTier-based estimation as the primary driver.
// deriveSizeTier remains as the fallback only when no page count is
// known yet (true greenfield).

const REVIEW_TO_DESIGNER_REDUCTION = 0.15
const NOVAMIRA_MULTIPLIER = 0.5

export interface DevHoursTotalInput {
  /** Manual override on the project row. When set, beats everything else. */
  manualOverride:              number | null
  /** Strategist-entered expected page count (preferred when set). */
  expectedPageCount:           number | null
  /** Actual count from web_pages (used when expectedPageCount is null). */
  actualPageCount:             number | null
  /** Per-project hrs/page baseline (team default 3.0). */
  hoursPerPage:                number
  /** Novamira AI accelerator on this project? */
  usesNovamira:                boolean
  /** Review-cycle edits go to designer instead of dev? */
  devEditsRouteToDesigner:     boolean
}

export interface DevHoursTotalDerivation {
  source:              'manual_override' | 'page_count' | 'tier_default'
  pageCountUsed:       number          // 0 when source = manual_override
  hoursPerPageUsed:    number          // 0 when source = manual_override
  rawBeforeLevers:     number          // pageCountUsed × hoursPerPageUsed
  novamiraMultiplier:  number          // 0.5 or 1.0
  reviewReduction:     number          // 0 or 0.15
}

export interface DevHoursTotal {
  total:      number                   // rounded to whole hour
  derivation: DevHoursTotalDerivation
  note:       string                   // 1-sentence why
}

/** Compute the dev-hour budget for a project. See module docstring. */
export function computeDevHoursTotal(input: DevHoursTotalInput): DevHoursTotal {
  // 1. Manual override wins.
  if (input.manualOverride != null && input.manualOverride > 0) {
    return {
      total: Math.round(input.manualOverride),
      derivation: {
        source: 'manual_override',
        pageCountUsed: 0,
        hoursPerPageUsed: 0,
        rawBeforeLevers: input.manualOverride,
        novamiraMultiplier: 1,
        reviewReduction: 0,
      },
      note: `Manually overridden to ${Math.round(input.manualOverride)}h.`,
    }
  }

  // 2. Page count × hours-per-page × levers.
  const pageCount = input.expectedPageCount ?? input.actualPageCount ?? null
  if (pageCount != null && pageCount > 0) {
    const novamiraMult = input.usesNovamira ? NOVAMIRA_MULTIPLIER : 1
    const reviewMult = input.devEditsRouteToDesigner ? (1 - REVIEW_TO_DESIGNER_REDUCTION) : 1
    const raw = pageCount * input.hoursPerPage
    const total = raw * novamiraMult * reviewMult
    const noteParts: string[] = [`${pageCount}p × ${input.hoursPerPage}h/p = ${Math.round(raw)}h`]
    if (input.usesNovamira) noteParts.push('Novamira ×0.5')
    if (input.devEditsRouteToDesigner) noteParts.push('dev→designer −15%')
    return {
      total: Math.round(total),
      derivation: {
        source: 'page_count',
        pageCountUsed: pageCount,
        hoursPerPageUsed: input.hoursPerPage,
        rawBeforeLevers: raw,
        novamiraMultiplier: novamiraMult,
        reviewReduction: input.devEditsRouteToDesigner ? REVIEW_TO_DESIGNER_REDUCTION : 0,
      },
      note: noteParts.join(' · '),
    }
  }

  // 3. Fallback: no pages known yet, use tier default for a 20-page site.
  const tier = deriveSizeTier(null)
  const fallback = baseHoursForTier(tier)
  return {
    total: fallback,
    derivation: {
      source: 'tier_default',
      pageCountUsed: 0,
      hoursPerPageUsed: 0,
      rawBeforeLevers: fallback,
      novamiraMultiplier: 1,
      reviewReduction: 0,
    },
    note: `No page count yet — assuming ${tier} tier (${fallback}h).`,
  }
}

// ── Sprints ────────────────────────────────────────────────────────

export interface Sprint {
  /** ISO date (YYYY-MM-DD) of the sprint's start Sunday. */
  startISO: string
  /** ISO date (YYYY-MM-DD) of the sprint's end Saturday (start + 13). */
  endISO:   string
  /** Sprint label: "Apr 14–27" (start month/day → end month/day). */
  label:    string
}

/** Return the sprint (2-week window) containing the given date.
 *  Sprints are Sunday-aligned to match the rest of the WM scheduler
 *  (the source CSV was authored Sunday-Saturday; `weekStart` honors
 *  that). All math here stays in local time — no UTC mutators — to
 *  match `dateRange.ts`. */
export function sprintForDate(d: Date): Sprint {
  const start = weekStart(d)         // local-midnight Sunday on/before d
  const end = new Date(start)
  end.setDate(end.getDate() + 13)    // local-time Saturday
  return {
    startISO: toIsoDate(start),
    endISO:   toIsoDate(end),
    label:    formatSprintLabel(start, end),
  }
}

/** Generate `count` consecutive sprints starting from the sprint that
 *  contains `from`. Used by the waterfall + calendar views to lay out
 *  the next N sprints in chronological order. */
export function sprintsFrom(from: Date, count: number): Sprint[] {
  const first = sprintForDate(from)
  const out: Sprint[] = [first]
  // Re-parse via fromIsoDate to keep cursor in local time (avoids the
  // UTC midnight + local mutator drift that produced off-by-one labels
  // in non-UTC timezones).
  let cursor = fromIsoDate(first.startISO)!
  for (let i = 1; i < count; i++) {
    cursor = addWeeks(cursor, 2)
    const end = new Date(cursor)
    end.setDate(end.getDate() + 13)
    out.push({
      startISO: toIsoDate(cursor),
      endISO:   toIsoDate(end),
      label:    formatSprintLabel(cursor, end),
    })
  }
  return out
}

function formatSprintLabel(start: Date, end: Date): string {
  const fmt = (d: Date) => `${d.toLocaleString('en-US', { month: 'short', day: 'numeric' })}`
  if (start.getMonth() === end.getMonth()) {
    return `${start.toLocaleString('en-US', { month: 'short' })} ${start.getDate()}–${end.getDate()}`
  }
  return `${fmt(start)} – ${fmt(end)}`
}

// ── Partner review targets ─────────────────────────────────────────

/** Compute the partner-review target windows relative to a phase
 *  start date. Partner reviews are soft targets — they signal the
 *  expected cadence so the strategist sees the dependency, but
 *  missing them doesn't block work. The calendar/waterfall render
 *  these with a "target" visual treatment (dashed border, lighter
 *  tint) rather than a hard deadline.
 *
 *  Default cadences (calibrated against squad workflow):
 *   • content  → R1 review target = phase_start + 7d
 *                R2 review target = phase_start + 14d
 *   • design   → R1 review target = phase_start + 5d
 *                R2 review target = phase_start + 12d
 *   • dev      → R1 review target = phase_start + 21d (mid-build)
 *                R2 review target = phase_start + 35d (pre-launch QA)
 *
 *  Other phases (intake / review / launched) don't generate review
 *  targets — intake is partner-input collection, final review IS the
 *  review, and launched is post-go-live. */
export function reviewTargetsForPhase(
  phase: WebProjectPhase,
  phaseStartISO: string | null,
): Array<{ round: 'R1' | 'R2'; targetISO: string }> {
  if (!phaseStartISO) return []
  const start = new Date(`${phaseStartISO}T00:00:00Z`)
  if (isNaN(start.getTime())) return []
  const cadence: Record<WebProjectPhase, [number, number] | null> = {
    intake:   null,
    content:  [7, 14],
    design:   [5, 12],
    dev:      [21, 35],
    review:   null,
    launched: null,
  }
  const days = cadence[phase]
  if (!days) return []
  const out: Array<{ round: 'R1' | 'R2'; targetISO: string }> = []
  for (let i = 0; i < days.length; i++) {
    const target = new Date(start)
    target.setUTCDate(target.getUTCDate() + days[i])
    out.push({ round: i === 0 ? 'R1' : 'R2', targetISO: toIsoDate(target) })
  }
  return out
}

// ── Capacity overflow detection ────────────────────────────────────

/** Given a per-week allocation map (week-start ISO → hours summed
 *  across all projects) and a weekly cap, return the weeks that
 *  exceed the cap with their overflow amount. Used by /web's
 *  capacity-alert banner + the Waterfall view. */
export function capacityOverflow(
  weeklyTotals: Map<string, number>,
  weeklyCap: number,
): Array<{ weekStartISO: string; total: number; over: number }> {
  const out: Array<{ weekStartISO: string; total: number; over: number }> = []
  for (const [weekStartISO, total] of weeklyTotals.entries()) {
    if (total > weeklyCap) {
      out.push({ weekStartISO, total, over: total - weeklyCap })
    }
  }
  return out.sort((a, b) => a.weekStartISO.localeCompare(b.weekStartISO))
}
