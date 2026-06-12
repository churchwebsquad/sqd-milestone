#!/usr/bin/env tsx
/**
 * Regression test for validatePageOutline against fixtures produced by
 * `npm run smoke:outline`. Four cases:
 *
 *   POSITIVE — outline.positive.json passes cleanly (ALL CHECKS PASS).
 *   NEGATIVE × 3 — each mechanical mutation trips its specific check:
 *     bad-atom           → unknown_atom_ref
 *     bad-archetype      → unknown_archetype
 *     bad-required-slot  → required_slot_uncovered
 *
 * The negative fixtures are generated MECHANICALLY by the smoke run
 * (same deterministic transform every run) — generated-from-real beats
 * authored-from-imagination for the same reason the positive fixture
 * does: the model's actual idioms get checked, not an idealized
 * version of them.
 *
 * Skip behavior: if no fixture directory exists, prints a "run
 * smoke:outline first" hint and exits 0. The check becomes
 * load-bearing only once a fixture has been generated.
 *
 * Run with:
 *   npm run check:page-outline-validator
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  validatePageOutline,
  type PageOutlineValidationManifest,
} from '../src/lib/cowork/validatePageOutline.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_ROOT = join(__dirname, '..', 'cowork-skills', 'outline-page', 'examples')

interface CaseResult {
  name:                 string
  fixture:              string
  expected:             'pass' | 'fail'
  actual:               'pass' | 'fail'
  summary:              string
  required_checks?:     string[]
  required_checks_seen?: string[]
}

function loadJson<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

// ─── Discover fixtures ────────────────────────────────────────────────────
// Each per-slug directory holds outline.positive.json, three mutations,
// and validation-manifest.json. Walk each directory and run all four
// cases per fixture; lets the smoke run multiple slugs over time.

if (!existsSync(FIXTURES_ROOT)) {
  console.log(`⚠ No fixtures yet at cowork-skills/outline-page/examples/.`)
  console.log(`  Run:  npm run smoke:outline  to generate the first fixture.`)
  process.exit(0)
}

const slugs = readdirSync(FIXTURES_ROOT).filter(name => {
  const p = join(FIXTURES_ROOT, name)
  try { return statSync(p).isDirectory() } catch { return false }
})

if (slugs.length === 0) {
  console.log(`⚠ No per-slug fixture directories under cowork-skills/outline-page/examples/.`)
  console.log(`  Run:  npm run smoke:outline  to generate the first fixture.`)
  process.exit(0)
}

// ─── Run cases ────────────────────────────────────────────────────────────

const results: CaseResult[] = []

for (const slug of slugs) {
  const slugDir = join(FIXTURES_ROOT, slug)
  const manifestPath = join(slugDir, 'validation-manifest.json')
  if (!existsSync(manifestPath)) {
    console.warn(`  ⚠ ${slug}: missing validation-manifest.json — skipping (regenerate with smoke:outline).`)
    continue
  }
  const manifest = loadJson<PageOutlineValidationManifest>(manifestPath)

  const positive = join(slugDir, 'outline.positive.json')
  if (existsSync(positive)) {
    const outline = loadJson<any>(positive)
    const r = validatePageOutline(outline, manifest)
    results.push({
      name: `${slug} positive — fixture passes`, fixture: positive,
      expected: 'pass', actual: r.ok ? 'pass' : 'fail', summary: r.summary,
    })
  } else {
    console.warn(`  ⚠ ${slug}: missing outline.positive.json — skipping positive case.`)
  }

  // Each negative case has a specific check it MUST trip.
  const negativeCases: Array<{ file: string; mustTrip: string }> = [
    { file: 'outline.negative-bad-atom.json',          mustTrip: 'unknown_atom_ref' },
    { file: 'outline.negative-bad-archetype.json',     mustTrip: 'unknown_archetype' },
    { file: 'outline.negative-bad-required-slot.json', mustTrip: 'required_slot_uncovered' },
  ]
  for (const nc of negativeCases) {
    const path = join(slugDir, nc.file)
    if (!existsSync(path)) {
      console.warn(`  ⚠ ${slug}: missing ${nc.file} — skipping. Regenerate via smoke:outline.`)
      continue
    }
    const outline = loadJson<any>(path)
    const r = validatePageOutline(outline, manifest)
    results.push({
      name: `${slug} negative — ${nc.file.replace(/^outline\.|\.json$/g, '')} → ${nc.mustTrip}`,
      fixture:              path,
      expected:             'fail',
      actual:               r.ok ? 'pass' : 'fail',
      summary:              r.summary,
      required_checks:      [nc.mustTrip],
      required_checks_seen: Object.keys(r.byCheck ?? {}),
    })
  }
}

// ─── Report ───────────────────────────────────────────────────────────────

let exitCode = 0
for (const c of results) {
  const matched = c.expected === c.actual
  const checksOk =
    !c.required_checks ||
    c.required_checks.every(rc => (c.required_checks_seen ?? []).includes(rc))
  const ok = matched && checksOk
  if (!ok) exitCode = 1

  console.log()
  console.log(`▸ ${c.name}`)
  console.log(`  expected: ${c.expected}    actual: ${c.actual}    ${ok ? 'OK' : 'FAIL'}`)
  if (c.required_checks) {
    console.log(`  required failure checks: ${c.required_checks.join(', ')}`)
    console.log(`  observed failure checks: ${(c.required_checks_seen ?? []).join(', ') || '(none)'}`)
  }
  if (!ok || process.env.VERBOSE) {
    console.log('  — validator summary —')
    for (const line of c.summary.split('\n')) console.log(`  ${line}`)
  }
}

console.log()
const passed = results.filter(r => {
  const m = r.expected === r.actual
  const c = !r.required_checks || r.required_checks.every(rc => (r.required_checks_seen ?? []).includes(rc))
  return m && c
}).length

if (exitCode === 0) {
  console.log(`✓ page-outline-validator regression: ${passed}/${results.length} cases OK`)
} else {
  console.error(`✗ page-outline-validator regression: ${passed}/${results.length} cases OK`)
}
process.exit(exitCode)
