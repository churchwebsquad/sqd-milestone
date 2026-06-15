/**
 * Strategic-Goals validators (Phase 2).
 *
 * Two pure validation rules the pipeline outputs MUST honor:
 *
 *   1. nav_change_level — emitted on `site_strategy` by plan-site-strategy.
 *      Must equal the derived value from `current_navigation_satisfaction`.
 *
 *   2. verbatim band — every drafted section carries an
 *      `actual_verbatim_ratio` that MUST fall inside its
 *      `intended_verbatim_band`. The allocation entry's band is the
 *      contract; outline echoes it per section; draft stamps actual.
 *
 * Validators return structured findings; downstream tests + the
 * web UI surface them. Pure functions, no IO, no dates — safe to
 * call from anywhere.
 */

import { deriveNavChangeLevel, type NavChangeLevel } from './strategicGoals'

export interface NavChangeLevelInput {
  /** What plan-site-strategy emitted on site_strategy.nav_change_level. */
  emitted: NavChangeLevel | null
  /** The strategist-approved 1-10 nav satisfaction score, or null
   *  when the field wasn't approved (in which case the only valid
   *  emission is null). */
  approvedScore: number | null
}

export interface NavChangeLevelFinding {
  ok:        boolean
  kind:      'match' | 'no_score' | 'unexpected_emission' | 'wrong_value' | 'invalid_score'
  detail:    string
  expected:  NavChangeLevel | null
  emitted:   NavChangeLevel | null
}

export function validateNavChangeLevel(input: NavChangeLevelInput): NavChangeLevelFinding {
  const { emitted, approvedScore } = input
  if (approvedScore == null) {
    if (emitted == null) {
      return { ok: true, kind: 'no_score', detail: 'No approved nav satisfaction — emitting null is correct.', expected: null, emitted }
    }
    return { ok: false, kind: 'unexpected_emission', detail: 'No approved nav satisfaction — emission MUST be null.', expected: null, emitted }
  }
  if (approvedScore < 1 || approvedScore > 10 || !Number.isFinite(approvedScore)) {
    return { ok: false, kind: 'invalid_score', detail: `Nav satisfaction score ${approvedScore} is out of band (1-10).`, expected: null, emitted }
  }
  const expected = deriveNavChangeLevel(approvedScore)
  if (emitted === expected) {
    return { ok: true, kind: 'match', detail: `nav_change_level=${emitted} matches score ${approvedScore}.`, expected, emitted }
  }
  return { ok: false, kind: 'wrong_value', detail: `nav_change_level=${emitted} but score ${approvedScore} requires ${expected}.`, expected, emitted }
}

export type VerbatimBand = 'high' | 'mid' | 'low'

/** Per-band acceptance window. The lower bound on `high` and upper
 *  bound on `low` are the hard rules; mid is the middle. */
export const VERBATIM_BAND_RANGES: Record<VerbatimBand, { min: number; max: number }> = {
  high: { min: 0.70, max: 1.00 },
  mid:  { min: 0.30, max: 0.70 },
  low:  { min: 0.00, max: 0.20 },
}

export interface VerbatimSectionInput {
  page_slug:            string
  section_index:        number
  intended_band:        VerbatimBand | null    // null if outline missing the field
  actual_verbatim_ratio: number | null         // null if draft missing the stamp
}

export interface VerbatimSectionFinding {
  ok:                    boolean
  kind:                  'match' | 'drift' | 'missing_band' | 'missing_actual'
  page_slug:             string
  section_index:         number
  intended_band:         VerbatimBand | null
  actual_verbatim_ratio: number | null
  expected_range?:       { min: number; max: number }
  detail:                string
}

export function validateVerbatimBand(sections: VerbatimSectionInput[]): VerbatimSectionFinding[] {
  const findings: VerbatimSectionFinding[] = []
  for (const s of sections) {
    if (s.intended_band == null) {
      findings.push({
        ok: false, kind: 'missing_band',
        page_slug: s.page_slug, section_index: s.section_index,
        intended_band: null, actual_verbatim_ratio: s.actual_verbatim_ratio,
        detail: `Section ${s.section_index} on '${s.page_slug}' is missing intended_verbatim_band — outline didn't stamp the copy_approach band.`,
      })
      continue
    }
    if (s.actual_verbatim_ratio == null) {
      findings.push({
        ok: false, kind: 'missing_actual',
        page_slug: s.page_slug, section_index: s.section_index,
        intended_band: s.intended_band, actual_verbatim_ratio: null,
        detail: `Section ${s.section_index} on '${s.page_slug}' is missing actual_verbatim_ratio — draft didn't stamp it.`,
      })
      continue
    }
    const range = VERBATIM_BAND_RANGES[s.intended_band]
    const within = s.actual_verbatim_ratio >= range.min && s.actual_verbatim_ratio <= range.max
    findings.push({
      ok: within,
      kind: within ? 'match' : 'drift',
      page_slug: s.page_slug, section_index: s.section_index,
      intended_band: s.intended_band, actual_verbatim_ratio: s.actual_verbatim_ratio,
      expected_range: range,
      detail: within
        ? `actual_verbatim_ratio=${s.actual_verbatim_ratio.toFixed(2)} within ${s.intended_band} band [${range.min}, ${range.max}].`
        : `actual_verbatim_ratio=${s.actual_verbatim_ratio.toFixed(2)} outside ${s.intended_band} band [${range.min}, ${range.max}] — drift on '${s.page_slug}' section ${s.section_index}.`,
    })
  }
  return findings
}
