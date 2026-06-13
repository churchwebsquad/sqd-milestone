#!/usr/bin/env tsx
/**
 * Cowork smoke run — page-draft (second worker endpoint copy of the
 * canonical pattern from cowork-smoke-outline.ts).
 *
 * Pre-req: roadmap_state.page_outlines[<slug>] must exist on the
 * project — run cowork-smoke-outline.ts first.
 *
 * Flow:
 *   1. POST /api/web/agents/run-draft-page { project_id, page_slug }.
 *   2. Validate post-run assertions (prompt_hash matches bundle, model
 *      matches frontmatter, repair telemetry present, validation
 *      manifest returned).
 *   3. Persist 6 fixtures to cowork-skills/draft-page/examples/<slug>/.
 *   4. Generate 4 mechanical negative fixtures targeting specific
 *      validator checks.
 *
 * Defaults match the outline smoke (Paradox 99005 / paratots). Same
 * --endpoint / --slug / --project-id / --dry-run flags.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { COWORK_SKILL_BUNDLES } from '../src/lib/cowork/skillPrompts.generated.ts'

// ─── Config ───────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')

const DEFAULT_ENDPOINT  = process.env.COWORK_SMOKE_ENDPOINT ?? 'http://localhost:3000'
const DEFAULT_PROJECT   = '15394f01-b371-415e-9bae-5d6e7d50c58a'
const DEFAULT_SLUG      = 'paratots'

// ─── Argv ─────────────────────────────────────────────────────────────────

const flags = new Map<string, string>()
let dryRun = false
for (const arg of process.argv.slice(2)) {
  if (arg === '--dry-run')  { dryRun = true; continue }
  const m = arg.match(/^--([\w-]+)=(.+)$/)
  if (m) flags.set(m[1], m[2])
}

const endpointBase = (flags.get('endpoint') ?? DEFAULT_ENDPOINT).replace(/\/+$/, '')
const projectId    = flags.get('project-id') ?? DEFAULT_PROJECT
const pageSlug     = flags.get('slug')       ?? DEFAULT_SLUG

const expectedBundle = COWORK_SKILL_BUNDLES['draft-page']
if (!expectedBundle) {
  console.error('Could not load draft-page bundle from skillPrompts.generated.ts')
  process.exit(1)
}

console.log(`Cowork smoke — draft-page`)
console.log(`  endpoint:    ${endpointBase}`)
console.log(`  project_id:  ${projectId}${projectId === DEFAULT_PROJECT ? '  (Paradox TEST, member 99005)' : ''}`)
console.log(`  page_slug:   ${pageSlug}`)
console.log(`  mode:        ${dryRun ? 'DRY-RUN (no gateway call; endpoint must already have an outline persisted)' : 'FULL'}`)
console.log(`  expected:    prompt_hash=${expectedBundle.contentHash}  model=${expectedBundle.model}`)
console.log()

if (dryRun) {
  console.log(`Dry-run: would POST /api/web/agents/run-draft-page`)
  console.log(`         body: { project_id: '${projectId}', page_slug: '${pageSlug}' }`)
  console.log()
  console.log(`Pre-req: roadmap_state.page_outlines.${pageSlug} must exist on the project.`)
  console.log(`If absent, run npm run smoke:outline first.`)
  process.exit(0)
}

// ─── Fire ─────────────────────────────────────────────────────────────────

console.log(`Step 1 — POST /api/web/agents/run-draft-page`)
const t0 = Date.now()
const r = await fetch(`${endpointBase}/api/web/agents/run-draft-page`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body:    JSON.stringify({ project_id: projectId, page_slug: pageSlug }),
})
const body = await r.json().catch(() => ({}))
const elapsedMs = Date.now() - t0

if (!r.ok) {
  console.error(`  ✗ run-draft-page failed (${r.status}) in ${elapsedMs}ms`)
  console.error(`    error:    ${(body as any).error ?? '(none)'}`)
  console.error(`    detail:   ${(body as any).detail ?? '(none)'}`)
  console.error(`    summary:  ${(body as any).summary ?? '(none)'}`)
  console.error(`    byCheck:  ${JSON.stringify((body as any).byCheck ?? {}, null, 2)}`)
  // Persist the failure payload anyway — the endpoint includes the
  // draft under `draft_for_inspection` on 422 + the full response body
  // is useful for debugging Fable 5's actual output, not just the
  // validator's complaints. Same fixture dir as success runs; the
  // filename `endpoint-response.json` is the canonical inspection
  // artifact regardless of outcome.
  const failureDir = join(REPO_ROOT, 'cowork-skills', 'draft-page', 'examples', pageSlug)
  try {
    mkdirSync(failureDir, { recursive: true })
    writeFileSync(
      join(failureDir, 'endpoint-response.json'),
      JSON.stringify(body, null, 2),
      'utf8',
    )
    console.error(`    persisted failure payload to ${failureDir.replace(REPO_ROOT + '/', '')}/endpoint-response.json`)
  } catch (e) {
    console.error(`    (could not persist failure payload: ${e instanceof Error ? e.message : 'unknown'})`)
  }
  process.exit(1)
}

const draft              = (body as any).draft as Record<string, any>
const skillMeta          = (body as any).skill_meta as Record<string, any>
const validationManifest = (body as any).validation_manifest as Record<string, any> | null
const promptResolution   = (body as any).prompt_resolution as Record<string, any>

console.log(`  ✓ 200 in ${elapsedMs}ms`)
console.log(`    sections:                ${draft?.sections?.length ?? '?'}`)
console.log(`    atoms used (unique):     ${skillMeta?.atom_ids_resolved ?? '?'}`)
console.log(`    atom_resolution_rate:    ${skillMeta?.atom_resolution_rate ?? '?'}`)
console.log(`    sections_match:          ${skillMeta?.sections_match ?? '?'}`)
console.log(`    truncation_suspected:    ${skillMeta?.truncation_suspected ?? '?'}`)
console.log(`    repaired:                ${skillMeta?.repaired ?? '?'}`)
console.log(`    first_pass_failures:     ${JSON.stringify(skillMeta?.first_pass_failures ?? null)}`)
console.log(`    prompt_hash:             ${skillMeta?.prompt_hash ?? '(missing)'}`)
console.log(`    model:                   ${skillMeta?.model ?? '(missing)'}`)
console.log(`    global_source:           ${promptResolution?.global_source ?? '?'}`)
console.log()

// ─── Post-run assertions ──────────────────────────────────────────────────

const assertions: Array<{ name: string; ok: boolean; detail: string }> = []
assertions.push({
  name:   'prompt_hash matches current draft-page bundle',
  ok:     skillMeta?.prompt_hash === expectedBundle.contentHash,
  detail: `got '${skillMeta?.prompt_hash}', expected '${expectedBundle.contentHash}'`,
})
assertions.push({
  name:   'model matches frontmatter (not hardcoded in endpoint)',
  ok:     (() => {
    // Vercel AI Gateway normalizes the version separator: gateway returns
    // `claude-opus-4.8` (dot) for our `claude-opus-4-8` (dash) frontmatter.
    // Apply the same tolerance as outline smoke.
    const norm = (s: string) => s.toLowerCase().replace(/\./g, '-')
    const got   = norm(typeof skillMeta?.model === 'string' ? skillMeta.model : '')
    const want  = norm(expectedBundle.model)
    const tail  = norm(expectedBundle.model.split('/').pop() ?? '')
    return got === want || got.endsWith(tail)
  })(),
  detail: `got '${skillMeta?.model}', expected '${expectedBundle.model}' (tolerates suffix-match + ./- normalization)`,
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
assertions.push({
  name:   'sections_match: drafted sections count matches outline',
  ok:     skillMeta?.sections_match === true,
  detail: `outline_sections=${skillMeta?.outline_sections}, drafted_sections=${skillMeta?.drafted_sections}`,
})

console.log(`Post-run assertions:`)
let allPass = true
for (const a of assertions) {
  console.log(`  ${a.ok ? '✓' : '✗'} ${a.name}`)
  if (!a.ok) { console.log(`      ${a.detail}`); allPass = false }
}
console.log()
if (!allPass) {
  console.error(`✗ Post-run assertions failed. Draft is in roadmap_state but did not match the expected provenance contract.`)
  process.exit(1)
}

// ─── Fixture persistence ──────────────────────────────────────────────────

const fixtureDir = join(REPO_ROOT, 'cowork-skills', 'draft-page', 'examples', pageSlug)
mkdirSync(fixtureDir, { recursive: true })

writeFileSync(join(fixtureDir, 'draft.positive.json'),       JSON.stringify(draft, null, 2), 'utf8')
writeFileSync(join(fixtureDir, 'validation-manifest.json'),  JSON.stringify(validationManifest, null, 2), 'utf8')
writeFileSync(join(fixtureDir, 'endpoint-response.json'),    JSON.stringify(body, null, 2), 'utf8')

// ─── Mechanical negative-fixture generation ───────────────────────────────
//
// Four deterministic mutations, each isolating one validator check.
// The fifth (verbatim_atom_dropped) requires knowing which atoms in
// the section copy came from verbatim atoms — derive from the
// validation_manifest.verbatim_atoms map.

function deepClone<T>(o: T): T { return JSON.parse(JSON.stringify(o)) }

// 1) Hallucinated atom_id in atoms_used → unknown_atom_ref
const negBadAtom = deepClone(draft)
{
  const FAKE_UUID = '00000000-0000-0000-0000-000000badbad'
  outer: for (const s of negBadAtom.sections ?? []) {
    if (Array.isArray(s.atoms_used) && s.atoms_used.length > 0) {
      s.atoms_used[0] = FAKE_UUID
      break outer
    }
  }
  writeFileSync(join(fixtureDir, 'draft.negative-bad-atom.json'), JSON.stringify(negBadAtom, null, 2), 'utf8')
}

// 2) Unknown archetype → unknown_archetype
const negBadArchetype = deepClone(draft)
if (negBadArchetype.sections?.[0]) {
  negBadArchetype.sections[0].archetype = 'not_a_real_archetype_xyz'
  writeFileSync(join(fixtureDir, 'draft.negative-bad-archetype.json'), JSON.stringify(negBadArchetype, null, 2), 'utf8')
}

// 3) Unknown slot in copy → unknown_slot_in_copy
const negBadSlot = deepClone(draft)
if (negBadSlot.sections?.[0]?.copy && typeof negBadSlot.sections[0].copy === 'object') {
  ;(negBadSlot.sections[0].copy as Record<string, unknown>)['totally_made_up_slot_xyz'] = 'whatever value'
  writeFileSync(join(fixtureDir, 'draft.negative-bad-slot.json'), JSON.stringify(negBadSlot, null, 2), 'utf8')
}

// 4) em-dash injection → em_dash_present
const negEmDash = deepClone(draft)
outer: for (const s of negEmDash.sections ?? []) {
  if (s.copy && typeof s.copy === 'object') {
    for (const [k, v] of Object.entries(s.copy as Record<string, unknown>)) {
      if (typeof v === 'string' && v.length > 0) {
        (s.copy as Record<string, unknown>)[k] = `Inject — an em-dash here ${v}`
        break outer
      }
    }
  }
}
writeFileSync(join(fixtureDir, 'draft.negative-em-dash.json'), JSON.stringify(negEmDash, null, 2), 'utf8')

// 5) verbatim deletion → verbatim_atom_dropped
//    Find a verbatim atom in the manifest, find the section that
//    outlines it (via outline_sections in the manifest), and scrub
//    its body from that section's copy.
const negVerbatim = deepClone(draft)
{
  const verbatimMap: Record<string, string> = (validationManifest as any)?.verbatim_atoms ?? {}
  const outlineSecs: Array<{ section_index: number; atom_ids: string[] }> = (validationManifest as any)?.outline_sections ?? []
  let mutated = false
  for (const os of outlineSecs) {
    for (const aid of os.atom_ids) {
      const body = verbatimMap[aid]
      if (!body) continue
      const section = negVerbatim.sections?.[os.section_index]
      if (!section?.copy || typeof section.copy !== 'object') continue
      let removedSomewhere = false
      for (const [k, v] of Object.entries(section.copy as Record<string, unknown>)) {
        if (typeof v === 'string' && v.includes(body)) {
          (section.copy as Record<string, unknown>)[k] = v.replace(body, '')
          removedSomewhere = true
        }
      }
      if (removedSomewhere) { mutated = true; break }
    }
    if (mutated) break
  }
  if (mutated) {
    writeFileSync(join(fixtureDir, 'draft.negative-verbatim-dropped.json'), JSON.stringify(negVerbatim, null, 2), 'utf8')
  } else {
    console.log(`  (skipped verbatim-dropped mutation — no verbatim atoms surfaced in this draft's copy)`)
  }
}

console.log(`Fixtures written to ${fixtureDir.replace(REPO_ROOT + '/', '')}/`)
console.log(`  · draft.positive.json`)
console.log(`  · draft.negative-bad-atom.json          (unknown_atom_ref)`)
console.log(`  · draft.negative-bad-archetype.json     (unknown_archetype)`)
console.log(`  · draft.negative-bad-slot.json          (unknown_slot_in_copy)`)
console.log(`  · draft.negative-em-dash.json           (em_dash_present)`)
console.log(`  · draft.negative-verbatim-dropped.json  (verbatim_atom_dropped, if applicable)`)
console.log(`  · validation-manifest.json`)
console.log(`  · endpoint-response.json`)
console.log()
console.log(`✓ Smoke run complete. Now run:  npm run check:draft-page-validator`)
