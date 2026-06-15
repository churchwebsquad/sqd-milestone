#!/usr/bin/env tsx
/**
 * Regression test for validateStrategicGoals (Phase 2).
 *
 *   - Nav change level: 5 known-answer cases covering the rule
 *     (score 5 → full_rewrite, 7 → partial, 9 → tweaks, 10 → preserve,
 *     null score + null emission → ok).
 *   - Negative: emitting non-null when no score is approved.
 *   - Verbatim band: 4 cases (each band ok, plus a drift detection).
 *
 * Exits 0 only if every case lands on the expected outcome. Adds the
 * test to the regression suite so pipeline contract drift is caught
 * pre-commit instead of in the cowork pilot.
 *
 *   npm run check:strategic-goals-validator
 */

import {
  validateNavChangeLevel,
  validateVerbatimBand,
} from '../src/lib/cowork/validateStrategicGoals.ts'

interface NavCase {
  name:           string
  approvedScore:  number | null
  emitted:        'full_rewrite' | 'partial' | 'tweaks' | 'preserve' | null
  expectOk:       boolean
  expectKind:     string
}

const NAV_CASES: NavCase[] = [
  { name: 'score 5  → full_rewrite',  approvedScore: 5,  emitted: 'full_rewrite', expectOk: true,  expectKind: 'match' },
  { name: 'score 7  → partial',       approvedScore: 7,  emitted: 'partial',      expectOk: true,  expectKind: 'match' },
  { name: 'score 9  → tweaks',        approvedScore: 9,  emitted: 'tweaks',       expectOk: true,  expectKind: 'match' },
  { name: 'score 10 → preserve',      approvedScore: 10, emitted: 'preserve',     expectOk: true,  expectKind: 'match' },
  { name: 'no score → emit null OK',  approvedScore: null, emitted: null,         expectOk: true,  expectKind: 'no_score' },
  { name: 'no score → non-null fails',approvedScore: null, emitted: 'preserve',   expectOk: false, expectKind: 'unexpected_emission' },
  { name: 'score 6 → not partial',    approvedScore: 6,  emitted: 'partial',      expectOk: false, expectKind: 'wrong_value' },
  { name: 'score 11 invalid',         approvedScore: 11, emitted: null,           expectOk: false, expectKind: 'invalid_score' },
]

interface VbCase {
  name:                  string
  intended_band:         'high' | 'mid' | 'low' | null
  actual_verbatim_ratio: number | null
  expectOk:              boolean
  expectKind:            string
}

const VB_CASES: VbCase[] = [
  { name: 'high band, 0.85 ratio → match',  intended_band: 'high', actual_verbatim_ratio: 0.85, expectOk: true,  expectKind: 'match' },
  { name: 'high band, 0.55 ratio → drift',  intended_band: 'high', actual_verbatim_ratio: 0.55, expectOk: false, expectKind: 'drift' },
  { name: 'mid band, 0.5 ratio → match',    intended_band: 'mid',  actual_verbatim_ratio: 0.5,  expectOk: true,  expectKind: 'match' },
  { name: 'low band, 0.1 ratio → match',    intended_band: 'low',  actual_verbatim_ratio: 0.1,  expectOk: true,  expectKind: 'match' },
  { name: 'low band, 0.5 ratio → drift',    intended_band: 'low',  actual_verbatim_ratio: 0.5,  expectOk: false, expectKind: 'drift' },
  { name: 'missing band → missing_band',    intended_band: null,   actual_verbatim_ratio: 0.5,  expectOk: false, expectKind: 'missing_band' },
  { name: 'missing actual → missing_actual',intended_band: 'mid',  actual_verbatim_ratio: null, expectOk: false, expectKind: 'missing_actual' },
]

let failed = 0
let total  = 0

// Nav cases
for (const c of NAV_CASES) {
  total++
  const f = validateNavChangeLevel({ approvedScore: c.approvedScore, emitted: c.emitted })
  const ok = f.ok === c.expectOk && f.kind === c.expectKind
  if (!ok) {
    failed++
    console.error(`✗ NAV  "${c.name}": got ok=${f.ok} kind=${f.kind} — expected ok=${c.expectOk} kind=${c.expectKind}`)
  }
}

// Verbatim band cases — package them as section inputs.
const sectionInputs = VB_CASES.map((c, i) => ({
  page_slug:             `case-${i}`,
  section_index:         i,
  intended_band:         c.intended_band,
  actual_verbatim_ratio: c.actual_verbatim_ratio,
}))
const findings = validateVerbatimBand(sectionInputs)
for (let i = 0; i < VB_CASES.length; i++) {
  total++
  const c = VB_CASES[i], f = findings[i]
  const ok = f.ok === c.expectOk && f.kind === c.expectKind
  if (!ok) {
    failed++
    console.error(`✗ VB   "${c.name}": got ok=${f.ok} kind=${f.kind} — expected ok=${c.expectOk} kind=${c.expectKind}`)
  }
}

if (failed > 0) {
  console.error(`\nstrategic-goals-validator regression: ${total - failed}/${total} cases OK, ${failed} failed`)
  process.exit(1)
}
console.log(`✓ strategic-goals-validator regression: ${total}/${total} cases OK`)
