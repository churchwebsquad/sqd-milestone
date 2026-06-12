#!/usr/bin/env tsx
/**
 * Known-answer regression test for critique-page.
 *
 * Reads:
 *   cowork-skills/critique-page/examples/<slug>/critique.positive.json
 *   cowork-skills/critique-page/examples/<slug>/expected-findings.json
 *
 * Asserts two arms:
 *   must_flag    — for each entry, the critique MUST surface the
 *                  verbatim substring (in problem_lines OR a directive
 *                  note) AND emit a directive citing the expected
 *                  axis at the expected severity-or-higher.
 *   must_not_flag — for each entry, the verbatim substring MUST NOT
 *                  appear in problem_lines, AND must NOT be cited in
 *                  a directive of severity ≥ warning. (Standout
 *                  appearances are fine — those are praise.)
 *
 * Both arms matter equally. A critic that red-flags partner-sacred
 * language burns trust faster than one that misses a claim; this
 * fixture is the false-positive guard as well as the catch guard.
 *
 * Skip behavior: if a slug's expected-findings.json is absent, the
 * slug is skipped quietly. CI doesn't block on missing fixtures;
 * landing one activates the gate.
 *
 * Banked 2026-06-12: this regression script is the deterministic-
 * experiment methodology made permanent for the quality gate. Every
 * future critique-page SKILL edit is judged against these known
 * answers. If a SKILL change moves a must_flag from caught to missed
 * — or moves a must_not_flag from clean to flagged — CI catches.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_ROOT = join(__dirname, '..', 'cowork-skills', 'critique-page', 'examples')

const SEVERITY_RANK: Record<string, number> = { nit: 1, warning: 2, blocker: 3 }

interface ExpectedFlag {
  id:              string
  summary:         string
  verbatim_substring?: string
  expected_axis:   string
  expected_severity_at_least: string
  expected_fix_kind?: string[]
  rationale:       string
}

interface ExpectedNonFlag {
  id:              string
  summary:         string
  verbatim_substring?: string
  rationale:       string
  fail_if_appears_in: string[]
}

interface ExpectedFindings {
  must_flag:     ExpectedFlag[]
  must_not_flag: ExpectedNonFlag[]
}

interface CaseResult {
  slug:    string
  arm:     'must_flag' | 'must_not_flag'
  id:      string
  passed:  boolean
  detail:  string
}

function loadJson<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function lineContains(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase())
}

if (!existsSync(FIXTURES_ROOT)) {
  console.log(`⚠ No fixtures at cowork-skills/critique-page/examples/`)
  console.log(`  Run:  npm run smoke:critique  to generate the first fixture.`)
  process.exit(0)
}

const slugs = readdirSync(FIXTURES_ROOT).filter(name => {
  const p = join(FIXTURES_ROOT, name)
  try { return statSync(p).isDirectory() } catch { return false }
})

const results: CaseResult[] = []

for (const slug of slugs) {
  const slugDir = join(FIXTURES_ROOT, slug)
  const critiquePath = join(slugDir, 'critique.positive.json')
  const expectedPath = join(slugDir, 'expected-findings.json')

  if (!existsSync(critiquePath)) {
    console.warn(`  ⚠ ${slug}: missing critique.positive.json — skipping`)
    continue
  }
  if (!existsSync(expectedPath)) {
    console.warn(`  ⚠ ${slug}: missing expected-findings.json — skipping (this slug doesn't have a known-answer fixture yet)`)
    continue
  }

  const critique = loadJson<any>(critiquePath)
  const expected = loadJson<ExpectedFindings>(expectedPath)

  const problemLines = Array.isArray(critique.problem_lines) ? critique.problem_lines as string[] : []
  const directives   = Array.isArray(critique.directives)    ? critique.directives    as any[]    : []
  const allDirectiveText = directives.map(d => String(d?.note ?? '')).join('\n')

  // — must_flag arm —
  for (const exp of expected.must_flag ?? []) {
    let passed = true
    const reasons: string[] = []

    // (a) verbatim substring present in problem_lines OR a directive note
    if (exp.verbatim_substring) {
      const inProblem    = problemLines.some(l => lineContains(l, exp.verbatim_substring!))
      const inDirective  = lineContains(allDirectiveText, exp.verbatim_substring)
      if (!inProblem && !inDirective) {
        passed = false
        reasons.push(`verbatim substring "${exp.verbatim_substring.slice(0, 60)}…" not surfaced in problem_lines OR any directive note`)
      }
    }

    // (b) directive citing the expected axis at expected severity-or-higher
    const minRank = SEVERITY_RANK[exp.expected_severity_at_least] ?? 1
    const matchingDirective = directives.find(d => {
      const axisMatch = d?.axis === exp.expected_axis
      const sevMatch  = SEVERITY_RANK[d?.severity ?? 'nit'] >= minRank
      const fixMatch  = exp.expected_fix_kind ? exp.expected_fix_kind.includes(d?.fix_kind) : true
      return axisMatch && sevMatch && fixMatch
    })
    if (!matchingDirective) {
      passed = false
      reasons.push(`no directive matches: axis=${exp.expected_axis}, severity≥${exp.expected_severity_at_least}${exp.expected_fix_kind ? `, fix_kind∈[${exp.expected_fix_kind.join(',')}]` : ''}`)
    }

    results.push({
      slug, arm: 'must_flag', id: exp.id, passed,
      detail: passed ? exp.summary : reasons.join('; '),
    })
  }

  // — must_not_flag arm —
  for (const exp of expected.must_not_flag ?? []) {
    let passed = true
    const reasons: string[] = []
    if (exp.verbatim_substring) {
      // Appears in problem_lines? FAIL.
      if (exp.fail_if_appears_in.includes('problem_lines')) {
        const hits = problemLines.filter(l => lineContains(l, exp.verbatim_substring!))
        if (hits.length > 0) {
          passed = false
          reasons.push(`partner-sacred line "${exp.verbatim_substring.slice(0, 60)}…" appeared in problem_lines (${hits.length} hit(s))`)
        }
      }
      // Appears in a high-severity directive note? FAIL.
      if (exp.fail_if_appears_in.includes('directive_notes_at_severity_warning_or_higher')) {
        const hits = directives.filter(d => {
          const sev = SEVERITY_RANK[d?.severity ?? 'nit'] ?? 1
          return sev >= 2 && lineContains(String(d?.note ?? ''), exp.verbatim_substring!)
        })
        if (hits.length > 0) {
          passed = false
          reasons.push(`partner-sacred line cited in ${hits.length} directive note(s) at severity ≥ warning`)
        }
      }
    }

    results.push({
      slug, arm: 'must_not_flag', id: exp.id, passed,
      detail: passed ? exp.summary : reasons.join('; '),
    })
  }
}

// ─── Report ───────────────────────────────────────────────────────────────

let exitCode = 0
const byArm: Record<string, { pass: number; fail: number }> = {
  must_flag:    { pass: 0, fail: 0 },
  must_not_flag: { pass: 0, fail: 0 },
}

for (const r of results) {
  if (!r.passed) exitCode = 1
  byArm[r.arm][r.passed ? 'pass' : 'fail']++
  console.log()
  console.log(`▸ ${r.slug} :: ${r.arm} :: ${r.id}`)
  console.log(`  ${r.passed ? '✓ PASS' : '✗ FAIL'}`)
  console.log(`  ${r.detail}`)
}

console.log()
if (results.length === 0) {
  console.log(`(no slug fixtures with expected-findings.json — nothing to test against)`)
  process.exit(0)
}

console.log(`Summary:`)
console.log(`  must_flag      ${byArm.must_flag.pass}/${byArm.must_flag.pass + byArm.must_flag.fail} caught`)
console.log(`  must_not_flag  ${byArm.must_not_flag.pass}/${byArm.must_not_flag.pass + byArm.must_not_flag.fail} unflagged`)

if (exitCode === 0) {
  console.log(`\n✓ critique-page regression: ${results.length}/${results.length} known-answer cases OK`)
} else {
  console.error(`\n✗ critique-page regression: ${results.filter(r => r.passed).length}/${results.length} known-answer cases OK`)
}
process.exit(exitCode)
