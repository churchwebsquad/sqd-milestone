/**
 * Deterministic validator for CoworkPageCritique (the artifact
 * produced by run-critique-page).
 *
 * Same {ok, failures, byCheck, summary} shape as the upstream
 * validators. The validator's job is STRUCTURAL — it ensures the
 * critique conforms to the contract. It does NOT evaluate whether the
 * critique's judgments are right; that's the human review (and the
 * experimental purpose of firing critique-page against a known-defect
 * draft).
 *
 * What this enforces:
 *   1. page_slug matches the slug the endpoint was called for.
 *   2. All 5 axis scores are integers in [0, 100].
 *   3. standout_lines + problem_lines are arrays of strings (lines).
 *   4. directives[] structurally valid: closed enums on fix_kind +
 *      severity + axis; note ≥10 chars; page_slug matches.
 *   5. Floor consistency: if dignity ≤ 40 (the documented blocker
 *      threshold), there MUST be at least one 'blocker' severity
 *      directive citing axis='dignity'. Otherwise the critique
 *      flagged an unsafe artifact without naming a fix.
 *   6. Per-axis directive consistency: any axis with score ≤ 40 needs
 *      at least one directive citing that axis (warning or stronger).
 *      "60 on persona_fit with no persona directive" is internally
 *      inconsistent.
 *   7. summary is non-empty (≥40 chars). The strategist's TL;DR;
 *      empty summary = the model isn't doing its job.
 *   8. standout_lines + problem_lines do not overlap (a line can't be
 *      both a model-praise and a model-flag at the same time).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { CoworkPageCritique } from '../../types/coworkBundle.js'

export interface CritiquePageValidationManifest {
  /** Confirms the critique targets the right page. */
  expected_page_slug: string
}

export interface CritiquePageValidationFailure {
  check:  string
  detail: string
}

export interface CritiquePageValidationResult {
  ok:        boolean
  failures:  CritiquePageValidationFailure[]
  byCheck:   Record<string, string[]>
  summary:   string
}

const AXES = ['dignity', 'voice_character', 'persona_fit', 'atom_coverage', 'claim_plausibility'] as const
const FIX_KINDS = new Set(['slot_edit', 'page_redraft', 'sitemap_redraft', 'synthesize_rework'])
const SEVERITIES = new Set(['blocker', 'warning', 'nit'])
const AXES_SET = new Set<string>(AXES)

const DIGNITY_BLOCKER_THRESHOLD = 40
const AXIS_DIRECTIVE_THRESHOLD  = 40

function isIntInRange(v: unknown, lo: number, hi: number): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi
}

export function validateCritiquePage(
  critique: CoworkPageCritique,
  mf:       CritiquePageValidationManifest,
): CritiquePageValidationResult {
  const failures: CritiquePageValidationFailure[] = []
  const fail = (check: string, detail: string): void => { failures.push({ check, detail }) }

  // — Top-level slug —
  if (critique.page_slug !== mf.expected_page_slug) {
    fail('wrong_page_slug',
      `critique emits page_slug='${critique.page_slug}' but endpoint was called for '${mf.expected_page_slug}'`)
  }

  // — Axis scores in [0, 100] —
  for (const axis of AXES) {
    const v = (critique as any)[axis]
    if (!isIntInRange(v, 0, 100)) {
      fail('bad_axis_score',
        `axis '${axis}' = ${v} is not an integer in [0, 100]`)
    }
  }

  // — Lines are arrays of strings —
  if (!Array.isArray(critique.standout_lines)) {
    fail('bad_standout_lines', `standout_lines must be an array of strings`)
  } else {
    for (const [i, l] of critique.standout_lines.entries()) {
      if (typeof l !== 'string' || l.length === 0) {
        fail('bad_standout_lines', `standout_lines[${i}] is empty or not a string`)
      }
    }
  }
  if (!Array.isArray(critique.problem_lines)) {
    fail('bad_problem_lines', `problem_lines must be an array of strings`)
  } else {
    for (const [i, l] of critique.problem_lines.entries()) {
      if (typeof l !== 'string' || l.length === 0) {
        fail('bad_problem_lines', `problem_lines[${i}] is empty or not a string`)
      }
    }
  }

  // — standout / problem overlap —
  if (Array.isArray(critique.standout_lines) && Array.isArray(critique.problem_lines)) {
    const standoutSet = new Set(critique.standout_lines)
    for (const p of critique.problem_lines) {
      if (standoutSet.has(p)) {
        fail('line_in_both_arrays',
          `line "${p.slice(0, 80)}…" appears in BOTH standout_lines and problem_lines — pick one`)
      }
    }
  }

  // — Directives shape —
  const directives = Array.isArray(critique.directives) ? critique.directives : []
  for (const [ix, d] of directives.entries()) {
    const label = `directives[${ix}]`

    if (typeof d?.fix_kind !== 'string' || !FIX_KINDS.has(d.fix_kind)) {
      fail('bad_directive_fix_kind',
        `${label} fix_kind='${d?.fix_kind}' not in {${[...FIX_KINDS].join(' | ')}}`)
    }
    if (typeof d?.severity !== 'string' || !SEVERITIES.has(d.severity)) {
      fail('bad_directive_severity',
        `${label} severity='${d?.severity}' not in {${[...SEVERITIES].join(' | ')}}`)
    }
    if (typeof d?.axis !== 'string' || !AXES_SET.has(d.axis)) {
      fail('bad_directive_axis',
        `${label} axis='${d?.axis}' not in {${[...AXES_SET].join(' | ')}}`)
    }
    if (typeof d?.note !== 'string' || d.note.trim().length < 10) {
      fail('weak_directive_note',
        `${label} note is missing or trivially short — every directive must include a concrete instruction the re-runner can act on`)
    }
    if (d?.page_slug !== mf.expected_page_slug) {
      fail('directive_wrong_page_slug',
        `${label} page_slug='${d?.page_slug}' doesn't match endpoint page_slug='${mf.expected_page_slug}'`)
    }
  }

  // — Floor consistency: dignity ≤ 40 implies a blocker directive on dignity —
  // The SKILL doctrine says dignity ≤ 40 = blocker; the critique must
  // not silently flag low dignity without naming a fix the re-runner
  // can act on. Strategist UI surfaces blocker directives; if dignity
  // is low and no blocker exists, that's the model failing to do its
  // job (judging without prescribing).
  if (isIntInRange(critique.dignity, 0, DIGNITY_BLOCKER_THRESHOLD)) {
    const hasDignityBlocker = directives.some(d =>
      d?.severity === 'blocker' && d?.axis === 'dignity')
    if (!hasDignityBlocker) {
      fail('dignity_below_floor_no_blocker',
        `dignity=${critique.dignity} (≤${DIGNITY_BLOCKER_THRESHOLD}) but no directive with severity='blocker' axis='dignity' — low-dignity verdicts MUST cite a blocker fix`)
    }
  }

  // — Per-axis directive consistency: any axis ≤ 40 needs at least one
  //   directive citing it (any severity). "60 on persona_fit with no
  //   persona directive" is internally inconsistent.
  for (const axis of AXES) {
    const score = (critique as any)[axis]
    if (!isIntInRange(score, 0, AXIS_DIRECTIVE_THRESHOLD)) continue
    const hasAxisDirective = directives.some(d => d?.axis === axis)
    if (!hasAxisDirective) {
      fail('low_axis_no_directive',
        `axis '${axis}' = ${score} (≤${AXIS_DIRECTIVE_THRESHOLD}) but no directive cites this axis — the verdict is internally inconsistent`)
    }
  }

  // — Summary —
  const summary = String(critique.summary ?? '').trim()
  if (summary.length < 40) {
    fail('weak_summary',
      `summary is missing or trivially short (${summary.length} chars) — strategist UI shows this verbatim; it must be a real TL;DR`)
  }

  // Group + format
  const byCheck: Record<string, string[]> = {}
  for (const f of failures) (byCheck[f.check] ??= []).push(f.detail)
  const summaryLines: string[] = []
  for (const check of Object.keys(byCheck).sort()) {
    const details = byCheck[check]
    summaryLines.push(`FAIL ${check} (${details.length})`)
    for (const d of details.slice(0, 8)) summaryLines.push(`   - ${d}`)
    if (details.length > 8) summaryLines.push(`   … +${details.length - 8} more`)
  }
  summaryLines.push(failures.length === 0 ? 'ALL CHECKS PASS' : `${failures.length} FAILURES`)

  return {
    ok:      failures.length === 0,
    failures,
    byCheck,
    summary: summaryLines.join('\n'),
  }
}
