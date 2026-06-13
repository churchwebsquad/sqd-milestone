#!/usr/bin/env tsx
/**
 * Cowork smoke run — critique-page (third worker endpoint copy of the
 * canonical pattern; the known-answer test of the quality gate).
 *
 * Pre-req: roadmap_state.page_drafts[<slug>] must exist on the
 * project — run cowork-smoke-draft first.
 *
 * Defaults: Paradox 99005 / paratots. The persisted draft has known
 * defects (section 3 redundancy + ungrounded check-in claim per the
 * fact-check read on 2026-06-12); this smoke fires critique-page at
 * it and asks whether the 5-axis verdict flags the same defects a
 * human just flagged. Known-answer test.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { COWORK_SKILL_BUNDLES } from '../src/lib/cowork/skillPrompts.generated.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')

const DEFAULT_ENDPOINT  = process.env.COWORK_SMOKE_ENDPOINT ?? 'http://localhost:3000'
const DEFAULT_PROJECT   = '15394f01-b371-415e-9bae-5d6e7d50c58a'
const DEFAULT_SLUG      = 'paratots'

const flags = new Map<string, string>()
let dryRun = false
for (const arg of process.argv.slice(2)) {
  if (arg === '--dry-run') { dryRun = true; continue }
  const m = arg.match(/^--([\w-]+)=(.+)$/)
  if (m) flags.set(m[1], m[2])
}

const endpointBase = (flags.get('endpoint') ?? DEFAULT_ENDPOINT).replace(/\/+$/, '')
const projectId    = flags.get('project-id') ?? DEFAULT_PROJECT
const pageSlug     = flags.get('slug')       ?? DEFAULT_SLUG

const expectedBundle = COWORK_SKILL_BUNDLES['critique-page']
if (!expectedBundle) {
  console.error('Could not load critique-page bundle from skillPrompts.generated.ts')
  process.exit(1)
}

console.log(`Cowork smoke — critique-page`)
console.log(`  endpoint:    ${endpointBase}`)
console.log(`  project_id:  ${projectId}${projectId === DEFAULT_PROJECT ? '  (Paradox TEST, member 99005)' : ''}`)
console.log(`  page_slug:   ${pageSlug}`)
console.log(`  mode:        ${dryRun ? 'DRY-RUN (no gateway call; endpoint must already have a draft persisted)' : 'FULL'}`)
console.log(`  expected:    prompt_hash=${expectedBundle.contentHash}  model=${expectedBundle.model}`)
console.log()

if (dryRun) {
  console.log(`Dry-run: would POST /api/web/agents/run-critique-page`)
  console.log(`         body: { project_id: '${projectId}', page_slug: '${pageSlug}' }`)
  console.log()
  console.log(`Pre-req: roadmap_state.page_drafts.${pageSlug} must exist.`)
  console.log(`If absent, run npm run smoke:draft first.`)
  process.exit(0)
}

console.log(`Step 1 — POST /api/web/agents/run-critique-page`)
const t0 = Date.now()
const r = await fetch(`${endpointBase}/api/web/agents/run-critique-page`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body:    JSON.stringify({ project_id: projectId, page_slug: pageSlug }),
})
const body = await r.json().catch(() => ({}))
const elapsedMs = Date.now() - t0

// Persist the failure payload even on 422/500 so we can inspect what
// the model actually produced.
const fixtureDir = join(REPO_ROOT, 'cowork-skills', 'critique-page', 'examples', pageSlug)
mkdirSync(fixtureDir, { recursive: true })
writeFileSync(join(fixtureDir, 'endpoint-response.json'), JSON.stringify(body, null, 2), 'utf8')

if (!r.ok) {
  console.error(`  ✗ run-critique-page failed (${r.status}) in ${elapsedMs}ms`)
  console.error(`    error:    ${(body as any).error ?? '(none)'}`)
  console.error(`    detail:   ${(body as any).detail ?? '(none)'}`)
  console.error(`    summary:  ${(body as any).summary ?? '(none)'}`)
  console.error(`    byCheck:  ${JSON.stringify((body as any).byCheck ?? {}, null, 2)}`)
  console.error(`    persisted failure payload to ${fixtureDir.replace(REPO_ROOT + '/', '')}/endpoint-response.json`)
  process.exit(1)
}

const critique         = (body as any).critique as Record<string, any>
const skillMeta        = (body as any).skill_meta as Record<string, any>
const promptResolution = (body as any).prompt_resolution as Record<string, any>

const directives = Array.isArray(critique?.directives) ? critique.directives : []
const blockers   = directives.filter((d: any) => d?.severity === 'blocker').length
const warnings   = directives.filter((d: any) => d?.severity === 'warning').length
const nits       = directives.filter((d: any) => d?.severity === 'nit').length

console.log(`  ✓ 200 in ${elapsedMs}ms`)
console.log()
console.log(`  AXIS SCORES (0-100; dignity ≤ 40 = blocker):`)
console.log(`    dignity:            ${critique?.dignity}`)
console.log(`    voice_character:    ${critique?.voice_character}`)
console.log(`    persona_fit:        ${critique?.persona_fit}`)
console.log(`    source_coverage:      ${critique?.source_coverage}`)
console.log(`    claim_plausibility: ${critique?.claim_plausibility}`)
console.log()
console.log(`  DIRECTIVES: ${directives.length} total (${blockers} blockers / ${warnings} warnings / ${nits} nits)`)
for (const d of directives) {
  const where = d?.section_ix !== undefined ? ` (sec ${d.section_ix}${d?.slot_key ? `.${d.slot_key}` : ''})` : ''
  console.log(`    [${d?.severity}/${d?.axis}/${d?.fix_kind}]${where}`)
  console.log(`      ${(d?.note ?? '').slice(0, 200)}${(d?.note ?? '').length > 200 ? '…' : ''}`)
}
console.log()
console.log(`  STANDOUT LINES (${(critique?.standout_lines ?? []).length}):`)
for (const l of (critique?.standout_lines ?? [])) {
  console.log(`    + ${l.slice(0, 120)}${l.length > 120 ? '…' : ''}`)
}
console.log()
console.log(`  PROBLEM LINES (${(critique?.problem_lines ?? []).length}):`)
for (const l of (critique?.problem_lines ?? [])) {
  console.log(`    - ${l.slice(0, 120)}${l.length > 120 ? '…' : ''}`)
}
console.log()
console.log(`  SUMMARY:`)
console.log(`    ${(critique?.summary ?? '').slice(0, 400)}${(critique?.summary ?? '').length > 400 ? '…' : ''}`)
console.log()
console.log(`  TELEMETRY:`)
console.log(`    repaired:                ${skillMeta?.repaired}`)
console.log(`    first_pass_failures:     ${JSON.stringify(skillMeta?.first_pass_failures ?? null)}`)
console.log(`    prompt_hash:             ${skillMeta?.prompt_hash}`)
console.log(`    model:                   ${skillMeta?.model}`)
console.log(`    initial_pass_tokens:     ${skillMeta?.usage?.initial_pass_output_tokens}`)
console.log(`    repair_pass_tokens:      ${skillMeta?.usage?.repair_pass_output_tokens}`)
console.log(`    total_input_tokens:      ${skillMeta?.usage?.input_tokens}`)
console.log(`    total_output_tokens:     ${skillMeta?.usage?.output_tokens}`)
console.log(`    global_source:           ${promptResolution?.global_source}`)
console.log()

// Post-run assertions
const assertions: Array<{ name: string; ok: boolean; detail: string }> = []
assertions.push({
  name:   'prompt_hash matches current critique-page bundle',
  ok:     skillMeta?.prompt_hash === expectedBundle.contentHash,
  detail: `got '${skillMeta?.prompt_hash}', expected '${expectedBundle.contentHash}'`,
})
assertions.push({
  name:   'model matches frontmatter (not hardcoded in endpoint)',
  ok:     (() => {
    const norm = (s: string) => s.toLowerCase().replace(/\./g, '-')
    const got   = norm(typeof skillMeta?.model === 'string' ? skillMeta.model : '')
    const want  = norm(expectedBundle.model)
    const tail  = norm(expectedBundle.model.split('/').pop() ?? '')
    return got === want || got.endsWith(tail)
  })(),
  detail: `got '${skillMeta?.model}', expected '${expectedBundle.model}'`,
})
assertions.push({
  name:   'all 5 axis scores present + in range',
  ok:     ['dignity', 'voice_character', 'persona_fit', 'source_coverage', 'claim_plausibility'].every(a => {
    const v = (critique as any)[a]
    return typeof v === 'number' && v >= 0 && v <= 100 && Number.isInteger(v)
  }),
  detail: 'one or more axes missing or out of [0, 100]',
})
assertions.push({
  name:   'summary present + non-trivial',
  ok:     typeof critique?.summary === 'string' && critique.summary.trim().length >= 40,
  detail: `summary length: ${(critique?.summary ?? '').trim().length}`,
})
assertions.push({
  name:   'repaired field present on _meta',
  ok:     typeof skillMeta?.repaired === 'boolean',
  detail: `got typeof='${typeof skillMeta?.repaired}'`,
})

console.log(`Post-run assertions:`)
let allPass = true
for (const a of assertions) {
  console.log(`  ${a.ok ? '✓' : '✗'} ${a.name}`)
  if (!a.ok) { console.log(`      ${a.detail}`); allPass = false }
}
console.log()
if (!allPass) {
  console.error(`✗ Post-run assertions failed.`)
  process.exit(1)
}

// Persist fixtures.
writeFileSync(join(fixtureDir, 'critique.positive.json'), JSON.stringify(critique, null, 2), 'utf8')
writeFileSync(join(fixtureDir, 'endpoint-response.json'), JSON.stringify(body, null, 2), 'utf8')

console.log(`Fixtures written to ${fixtureDir.replace(REPO_ROOT + '/', '')}/`)
console.log(`  · critique.positive.json`)
console.log(`  · endpoint-response.json`)
console.log()
console.log(`✓ Smoke run complete.`)
console.log()
console.log(`KNOWN-ANSWER TEST: did the critique flag what a human flagged?`)
console.log(`  Expected human-spotted defects in the paratots draft:`)
console.log(`    (1) Section 3 redundancy — same logistics repeated across heading/tagline/items`)
console.log(`    (2) Ungrounded claim — "check-in is inside the lobby, and a teacher will walk you`)
console.log(`        to the room" is not in any allocated atom or fact (claim_plausibility issue)`)
console.log()
console.log(`  Read the directives + problem_lines above. Cross-check against the persisted draft`)
console.log(`  at cowork-skills/draft-page/examples/${pageSlug}/draft.positive.json.`)
