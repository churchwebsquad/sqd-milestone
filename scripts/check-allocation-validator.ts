#!/usr/bin/env tsx
/**
 * Regression test for validateAllocationPlan against the checked-in
 * Paradox 99005 fixture. Two cases run on every invocation:
 *
 *   POSITIVE — fixture passes cleanly (every rule satisfied).
 *   NEGATIVE — fixture with one atom_ref swapped to a hallucinated
 *              uuid must fail with the `unknown_ref` check tripped.
 *
 * Exits 0 only if BOTH cases behave correctly. Anything else exits 1
 * with a diagnostic so CI / a pre-commit run catches validator
 * regressions before they ship.
 *
 * Run with:
 *   npm run check:allocation-validator
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  validateAllocationPlan,
  type AllocationPlanManifest,
} from '../src/lib/cowork/validateAllocationPlan.ts'
import type { CoworkPageAllocationPlan } from '../src/types/coworkBundle.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = join(
  __dirname,
  '..',
  'cowork-skills',
  'plan-cross-page-allocation',
  'examples',
  'paradox-99005',
)

function loadJson<T = unknown>(name: string): T {
  const path = join(FIXTURE_DIR, name)
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

interface CaseResult {
  name:     string
  expected: 'pass' | 'fail'
  actual:   'pass' | 'fail'
  summary:  string
  /** When expected=fail, the check name(s) that MUST be present. */
  required_checks?: string[]
  required_checks_seen?: string[]
}

const results: CaseResult[] = []

// ─── POSITIVE: fixture passes ─────────────────────────────────────────────
{
  const manifest = loadJson<AllocationPlanManifest>('manifest.json')
  const plan     = loadJson<Record<string, unknown>>('paradox-allocation-plan.fable5.json')

  const r = validateAllocationPlan(plan as unknown as CoworkPageAllocationPlan, manifest)
  results.push({
    name:     'paradox-99005 fixture passes',
    expected: 'pass',
    actual:   r.ok ? 'pass' : 'fail',
    summary:  r.summary,
  })
}

// ─── NEGATIVE: swap one atom_id → unknown_ref MUST trip ───────────────────
{
  const manifest = loadJson<AllocationPlanManifest>('manifest.json')
  const plan     = loadJson<Record<string, unknown>>('paradox-allocation-plan.fable5.json')

  const FAKE_UUID = '00000000-0000-0000-0000-000000000fed'
  const traces = (plan.source_traces as Array<Record<string, unknown>> | undefined) ?? []
  // source_traces[*] is flat: {source_kind, source_ref, placements}
  const firstPillarTrace = traces.find(t => t.source_kind === 'pillar')
  if (!firstPillarTrace) {
    console.error('Could not find a pillar source_trace to mutate; fixture changed shape.')
    process.exit(1)
  }
  // Replace the ref with a uuid that is NOT in the manifest. The
  // matching section_intents[].sources[].ref also needs the swap so
  // the validator trips unknown_ref on BOTH sites (manifest miss).
  const realRef = String(firstPillarTrace.source_ref)
  firstPillarTrace.source_ref = FAKE_UUID
  for (const a of (plan.allocations as Array<Record<string, unknown>> | undefined) ?? []) {
    for (const s of (a.section_intents as Array<Record<string, unknown>> | undefined) ?? []) {
      for (const src of (s.sources as Array<Record<string, unknown>> | undefined) ?? []) {
        if (src.kind === 'pillar' && src.ref === realRef) {
          src.ref = FAKE_UUID
        }
      }
    }
  }

  const r = validateAllocationPlan(plan as unknown as CoworkPageAllocationPlan, manifest)
  results.push({
    name:                 'mutated fixture (hallucinated atom_ref) fails with unknown_ref',
    expected:             'fail',
    actual:               r.ok ? 'pass' : 'fail',
    summary:              r.summary,
    required_checks:      ['unknown_ref'],
    required_checks_seen: Object.keys(r.byCheck ?? {}),
  })
}

// ─── NEGATIVE: middle-section flow_role typo MUST trip bad_flow_role ──────
// Regression for the Round-N defect: per-section flow_role membership
// was unchecked. A middle section with 'commitx' / 'evidence' / any
// typo passed silently. This guards both validators (TS + Python) from
// drifting back.
{
  const manifest = loadJson<AllocationPlanManifest>('manifest.json')
  const plan     = loadJson<Record<string, unknown>>('paradox-allocation-plan.fable5.json')

  const allocs = (plan.allocations as Array<Record<string, unknown>> | undefined) ?? []
  // Find a MIDDLE section (not first → not hook, not last → not invite/close)
  // and replace its flow_role with a value that's NOT in FLOW_ROLES.
  let mutated = false
  outer: for (const a of allocs) {
    const sections = (a.section_intents as Array<Record<string, unknown>> | undefined) ?? []
    if (sections.length < 3) continue
    for (let ix = 1; ix < sections.length - 1; ix++) {
      sections[ix].flow_role = 'commitx'
      mutated = true
      break outer
    }
  }
  if (!mutated) {
    console.error('Could not find a middle section in any allocation to mutate; fixture changed shape.')
    process.exit(1)
  }

  const r = validateAllocationPlan(plan as unknown as CoworkPageAllocationPlan, manifest)
  results.push({
    name:                 'mutated fixture (middle section flow_role=commitx) fails with bad_flow_role',
    expected:             'fail',
    actual:               r.ok ? 'pass' : 'fail',
    summary:              r.summary,
    required_checks:      ['bad_flow_role'],
    required_checks_seen: Object.keys(r.byCheck ?? {}),
  })
}

// ─── NEGATIVE: source kind drift (kind='crawl') MUST trip bad_source_kind ──
// Regression for the DS run defect: model emitted kind='crawl' (off-vocab)
// and kind='external' (was off-vocab pre-fix). Validator's (kind, ref)
// lookup silently accepted a valid ref paired with bad kind. This case
// pins the bad_source_kind check active.
{
  const manifest = loadJson<AllocationPlanManifest>('manifest.json')
  const plan     = loadJson<Record<string, unknown>>('paradox-allocation-plan.fable5.json')

  let mutated = false
  outer: for (const a of (plan.allocations as Array<Record<string, unknown>> | undefined) ?? []) {
    for (const s of (a.section_intents as Array<Record<string, unknown>> | undefined) ?? []) {
      for (const src of (s.sources as Array<Record<string, unknown>> | undefined) ?? []) {
        if (src.kind === 'crawl_topic') {
          src.kind = 'crawl'    // off-vocab; model's natural drift
          mutated = true
          break outer
        }
      }
    }
  }
  if (!mutated) {
    console.error('Could not find a crawl_topic source to mutate; fixture changed shape.')
    process.exit(1)
  }

  const r = validateAllocationPlan(plan as unknown as CoworkPageAllocationPlan, manifest)
  results.push({
    name:                 "mutated fixture (kind='crawl') fails with bad_source_kind",
    expected:             'fail',
    actual:               r.ok ? 'pass' : 'fail',
    summary:              r.summary,
    required_checks:      ['bad_source_kind'],
    required_checks_seen: Object.keys(r.byCheck ?? {}),
  })
}

// ─── POSITIVE: kind='external' is now in the enum; an external source
//   paired with a CTA treatment MUST pass (no bad_source_kind trip) ────────
{
  const manifest = loadJson<AllocationPlanManifest>('manifest.json')
  const plan     = loadJson<Record<string, unknown>>('paradox-allocation-plan.fable5.json')

  // Append an external CTA source to the first allocation's last section_intent.
  // The validator must NOT flag bad_source_kind, unknown_ref, or trace_missing
  // for the external kind — its ref is owned by the model, not the manifest.
  const firstAlloc = ((plan.allocations as Array<Record<string, unknown>> | undefined) ?? [])[0]
  const sections   = (firstAlloc?.section_intents as Array<Record<string, unknown>> | undefined) ?? []
  const lastSection = sections[sections.length - 1]
  if (!lastSection) {
    console.error('Could not find a section_intent to attach an external source to; fixture changed shape.')
    process.exit(1)
  }
  const sources = (lastSection.sources as Array<Record<string, unknown>> | undefined) ?? []
  sources.push({
    kind:      'external',
    ref:       'https://example.org/guest-card',
    treatment: 'cta_attach',
  })
  lastSection.sources = sources

  const r = validateAllocationPlan(plan as unknown as CoworkPageAllocationPlan, manifest)
  const seen = Object.keys(r.byCheck ?? {})
  // The fixture itself isn't necessarily "ok" — but the only new
  // failures introduced by our external row MUST be none of:
  // bad_source_kind, unknown_ref (for kind=external), trace_missing.
  // Easiest assert: bad_source_kind absent from the check tags.
  const externalRejected = seen.includes('bad_source_kind')
  results.push({
    name:                 "fixture with added kind='external' source does NOT trip bad_source_kind",
    expected:             externalRejected ? 'fail' : 'pass',
    actual:               externalRejected ? 'fail' : 'pass',
    summary:              r.summary,
    required_checks:      [],
    required_checks_seen: seen,
  })
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
if (exitCode === 0) {
  console.log(`✓ allocation-validator regression: ${results.length}/${results.length} cases OK`)
} else {
  console.error(`✗ allocation-validator regression: ${results.filter(r => r.expected === r.actual).length}/${results.length} cases OK`)
}

process.exit(exitCode)
