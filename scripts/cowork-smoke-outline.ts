#!/usr/bin/env tsx
/**
 * Cowork smoke run — first real end-to-end exercise of the worker
 * pattern. Two POSTs:
 *
 *   1. /api/web/agents/import-cowork-bundle   (page_allocation_plan)
 *   2. /api/web/agents/run-outline-page       (per-slug)
 *
 * Then assertions + fixture persistence + mechanical negative-fixture
 * generation from the live positive output.
 *
 * Defaults are pre-wired for Paradox Church (TEST), member 99005,
 * web_project_id 15394f01-b371-415e-9bae-5d6e7d50c58a, first slug
 * `paratots`. The runbook at
 * Projects/copy-engine-review/smoke-run-runbook.md verifies project
 * 99005's roadmap_state holds only legacy keys today, so a smoke run
 * is additive (no clobber). Rollback is a four-key SQL delete, also
 * documented in the runbook.
 *
 * Usage:
 *   tsx scripts/cowork-smoke-outline.ts                    # full run
 *   tsx scripts/cowork-smoke-outline.ts --dry-run          # import only; print gateway payload
 *   tsx scripts/cowork-smoke-outline.ts --slug=plan-a-visit
 *   tsx scripts/cowork-smoke-outline.ts --endpoint=https://your-preview.vercel.app
 *
 * Required env when running for real:
 *   AI_GATEWAY_API_KEY    (in the Vercel function env / your local .env.local)
 *   VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY  (in the Vercel function env)
 *
 * The script itself does NOT touch Supabase or the gateway — both go
 * through the endpoints. Default endpoint is http://localhost:3000
 * (assumes `vercel dev` running). For a deployed run, pass --endpoint.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { COWORK_SKILL_BUNDLES } from '../src/lib/cowork/skillPrompts.generated.ts'

// ─── Config ───────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')

const DEFAULT_ENDPOINT  = process.env.COWORK_SMOKE_ENDPOINT ?? 'http://localhost:3000'
const DEFAULT_PROJECT   = '15394f01-b371-415e-9bae-5d6e7d50c58a'
const DEFAULT_SLUG      = 'paratots'

const ALLOCATION_FIXTURE = join(
  REPO_ROOT,
  'cowork-skills', 'plan-cross-page-allocation', 'examples', 'paradox-99005',
  'paradox-allocation-plan.fable5.json',
)

// ─── Argv ─────────────────────────────────────────────────────────────────

const flags = new Map<string, string>()
let dryRun = false
let skipAllocImport = false
for (const arg of process.argv.slice(2)) {
  if (arg === '--dry-run')              { dryRun = true; continue }
  if (arg === '--skip-alloc-import')    { skipAllocImport = true; continue }
  const m = arg.match(/^--([\w-]+)=(.+)$/)
  if (m) flags.set(m[1], m[2])
}

const endpointBase = (flags.get('endpoint') ?? DEFAULT_ENDPOINT).replace(/\/+$/, '')
const projectId    = flags.get('project-id') ?? DEFAULT_PROJECT
const pageSlug     = flags.get('slug')       ?? DEFAULT_SLUG

// ─── Prelude ──────────────────────────────────────────────────────────────

const expectedBundle = COWORK_SKILL_BUNDLES['outline-page']
if (!expectedBundle) {
  console.error('Could not load outline-page bundle from skillPrompts.generated.ts')
  process.exit(1)
}

console.log(`Cowork smoke — outline-page`)
console.log(`  endpoint:    ${endpointBase}`)
console.log(`  project_id:  ${projectId}${projectId === DEFAULT_PROJECT ? '  (Paradox TEST, member 99005)' : ''}`)
console.log(`  page_slug:   ${pageSlug}`)
console.log(`  mode:        ${dryRun ? 'DRY-RUN (no gateway call, allocation import still occurs)' : 'FULL'}`)
console.log(`  expected:    prompt_hash=${expectedBundle.contentHash}  model=${expectedBundle.model}`)
console.log()

// ─── Step 1: import the allocation fixture ────────────────────────────────

if (!skipAllocImport) {
  const allocBundle = JSON.parse(readFileSync(ALLOCATION_FIXTURE, 'utf8'))
  console.log(`Step 1 — POST /api/web/agents/import-cowork-bundle (page_allocation_plan)`)
  const r1 = await fetch(`${endpointBase}/api/web/agents/import-cowork-bundle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ project_id: projectId, bundle_kind: 'page_allocation_plan', bundle: allocBundle }),
  })
  const r1Body = await r1.json().catch(() => ({}))
  if (!r1.ok) {
    console.error(`  ✗ import failed (${r1.status}):`, JSON.stringify(r1Body, null, 2).slice(0, 1000))
    process.exit(1)
  }
  console.log(`  ✓ ${r1.status}  counts=${JSON.stringify((r1Body as any).counts ?? {})}`)
  console.log()
} else {
  console.log(`Step 1 — SKIPPED (--skip-alloc-import) — assumes allocation already in roadmap_state`)
  console.log()
}

// ─── Step 2: run outline-page ─────────────────────────────────────────────

if (dryRun) {
  console.log(`Step 2 — DRY-RUN: would POST /api/web/agents/run-outline-page`)
  console.log(`         body: { project_id: '${projectId}', page_slug: '${pageSlug}' }`)
  console.log()
  console.log(`Dry-run complete. Allocation import happened (additive to roadmap_state).`)
  console.log(`To rollback, see the SQL in copy-engine-review/smoke-run-runbook.md.`)
  process.exit(0)
}

console.log(`Step 2 — POST /api/web/agents/run-outline-page`)
const t0 = Date.now()
const r2 = await fetch(`${endpointBase}/api/web/agents/run-outline-page`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body:    JSON.stringify({ project_id: projectId, page_slug: pageSlug }),
})
const r2Body = await r2.json().catch(() => ({}))
const elapsedMs = Date.now() - t0

if (!r2.ok) {
  console.error(`  ✗ run-outline-page failed (${r2.status}) in ${elapsedMs}ms`)
  console.error(`    summary: ${(r2Body as any).summary ?? '(none)'}`)
  console.error(`    byCheck: ${JSON.stringify((r2Body as any).byCheck ?? {}, null, 2)}`)
  process.exit(1)
}

const outline           = (r2Body as any).outline as Record<string, any>
const skillMeta         = (r2Body as any).skill_meta as Record<string, any>
const validationManifest = (r2Body as any).validation_manifest as Record<string, any> | null
const promptResolution  = (r2Body as any).prompt_resolution as Record<string, any>

console.log(`  ✓ 200 in ${elapsedMs}ms`)
console.log(`    sections:    ${outline?.sections?.length ?? '?'}`)
console.log(`    atom_count:  ${skillMeta?.atom_count_used ?? '?'}`)
console.log(`    repaired:    ${skillMeta?.repaired ?? '?'}`)
console.log(`    first_pass_failures: ${JSON.stringify(skillMeta?.first_pass_failures ?? null)}`)
console.log(`    prompt_hash: ${skillMeta?.prompt_hash ?? '(missing)'}`)
console.log(`    model:       ${skillMeta?.model ?? '(missing)'}`)
console.log(`    global_source: ${promptResolution?.global_source ?? '?'}`)
console.log()

// ─── Post-run assertions ──────────────────────────────────────────────────

const assertions: Array<{ name: string; ok: boolean; detail: string }> = []
assertions.push({
  name:   'prompt_hash matches current outline-page bundle',
  ok:     skillMeta?.prompt_hash === expectedBundle.contentHash,
  detail: `got '${skillMeta?.prompt_hash}', expected '${expectedBundle.contentHash}'`,
})
assertions.push({
  name:   'model matches frontmatter (not hardcoded in endpoint)',
  ok:     skillMeta?.model === expectedBundle.model
          // Gateway may echo the model with a provider tag; tolerate exact OR suffix-match.
          || (typeof skillMeta?.model === 'string' && skillMeta.model.endsWith(expectedBundle.model.split('/').pop() ?? '')),
  detail: `got '${skillMeta?.model}', expected '${expectedBundle.model}' (suffix tolerated)`,
})
assertions.push({
  name:   'repaired field present on _meta',
  ok:     typeof skillMeta?.repaired === 'boolean',
  detail: `got typeof='${typeof skillMeta?.repaired}'`,
})
assertions.push({
  name:   'first_pass_failures stamped (null on clean run, object on repaired run)',
  ok:     'first_pass_failures' in (skillMeta ?? {}),
  detail: `key present: ${'first_pass_failures' in (skillMeta ?? {})}`,
})
assertions.push({
  name:   'validation_manifest returned for fixture persistence',
  ok:     !!validationManifest && Array.isArray((validationManifest as any).atom_ids),
  detail: `present=${!!validationManifest}, atom_ids.length=${(validationManifest as any)?.atom_ids?.length ?? 0}`,
})

console.log(`Post-run assertions:`)
let allPass = true
for (const a of assertions) {
  console.log(`  ${a.ok ? '✓' : '✗'} ${a.name}`)
  if (!a.ok) { console.log(`      ${a.detail}`); allPass = false }
}
console.log()
if (!allPass) {
  console.error(`✗ Post-run assertions failed. Outline is in roadmap_state but did not match the expected provenance contract.`)
  process.exit(1)
}

// ─── Fixture persistence ──────────────────────────────────────────────────

const fixtureDir = join(REPO_ROOT, 'cowork-skills', 'outline-page', 'examples', pageSlug)
mkdirSync(fixtureDir, { recursive: true })

writeFileSync(
  join(fixtureDir, 'outline.positive.json'),
  JSON.stringify(outline, null, 2),
  'utf8',
)
writeFileSync(
  join(fixtureDir, 'validation-manifest.json'),
  JSON.stringify(validationManifest, null, 2),
  'utf8',
)
// Persist the raw gateway response too — prompt debugging wants the
// unparsed thing. The endpoint doesn't expose it today, so what we
// have is the parsed outline; capture the full 200 response in case
// the endpoint grows to forward more telemetry.
writeFileSync(
  join(fixtureDir, 'endpoint-response.json'),
  JSON.stringify(r2Body, null, 2),
  'utf8',
)

// ─── Mechanical negative-fixture generation ───────────────────────────────
//
// Three deterministic mutations of the positive outline, mirroring the
// check-allocation-validator pattern. Each isolates ONE failure class
// so the regression script can assert exactly which check trips.

function deepClone<T>(o: T): T { return JSON.parse(JSON.stringify(o)) }

// 1) Hallucinated atom_id — replace the first atom_assignments[].atom_id
//    in any section with a UUID not in the manifest.
const negBadAtom = deepClone(outline)
{
  const FAKE_UUID = '00000000-0000-0000-0000-000000badbad'
  outer: for (const s of negBadAtom.sections ?? []) {
    for (const a of (s.atom_assignments ?? [])) {
      if (a.atom_id) { a.atom_id = FAKE_UUID; break outer }
    }
  }
  writeFileSync(join(fixtureDir, 'outline.negative-bad-atom.json'), JSON.stringify(negBadAtom, null, 2), 'utf8')
}

// 2) Unknown archetype — replace the first section's archetype.
const negBadArchetype = deepClone(outline)
if (negBadArchetype.sections?.[0]) {
  negBadArchetype.sections[0].archetype = 'not_a_real_archetype_xyz'
  writeFileSync(join(fixtureDir, 'outline.negative-bad-archetype.json'), JSON.stringify(negBadArchetype, null, 2), 'utf8')
}

// 3) Required slot uncovered — find the first non-cms_managed section
//    and remove ALL its atom_assignments. The validator's
//    required_slot_uncovered check trips for every required slot on
//    that section's archetype.
const negBadSlot = deepClone(outline)
{
  for (const s of negBadSlot.sections ?? []) {
    if (s.cms_managed) continue
    if (Array.isArray(s.atom_assignments) && s.atom_assignments.length > 0) {
      s.atom_assignments = []
      break
    }
  }
  writeFileSync(join(fixtureDir, 'outline.negative-bad-required-slot.json'), JSON.stringify(negBadSlot, null, 2), 'utf8')
}

console.log(`Fixtures written to ${fixtureDir.replace(REPO_ROOT + '/', '')}/`)
console.log(`  · outline.positive.json`)
console.log(`  · outline.negative-bad-atom.json`)
console.log(`  · outline.negative-bad-archetype.json`)
console.log(`  · outline.negative-bad-required-slot.json`)
console.log(`  · validation-manifest.json`)
console.log(`  · endpoint-response.json`)
console.log()
console.log(`✓ Smoke run complete. Now run:  npm run check:page-outline-validator`)
