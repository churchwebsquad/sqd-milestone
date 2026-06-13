#!/usr/bin/env tsx
/**
 * Cowork chained smoke — outline → draft → critique for ONE page in
 * one command. Every fire feeds the corpus for free (P7 seed) and
 * every fire produces a runnable known-answer test (critique against
 * draft against persisted outline).
 *
 * Pre-req: roadmap_state.page_allocation_plan with an entry for the
 * page_slug. (Run import-cowork-bundle with bundle_kind=
 * page_allocation_plan first if not present.)
 *
 * Flow (sequential; each step depends on the previous landing):
 *   1. POST /api/web/agents/run-outline-page
 *   2. POST /api/web/agents/run-draft-page
 *   3. POST /api/web/agents/run-critique-page
 *
 * Each step:
 *   - Persists fixtures under cowork-skills/<skill>/examples/<slug>/
 *     (positive + manifest + endpoint-response + mechanical negatives)
 *   - Stamps + asserts _meta provenance contract
 *   - On 422 or 500, exits with the diagnostic AND saves the failure
 *     payload so the next operator can inspect
 *
 * Defaults: Paradox 99005 / paratots. Override via --slug, --project-id,
 * --endpoint, --skip-outline (use existing outline), --skip-draft (use
 * existing draft + just re-critique).
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

const flags = new Map<string, string>()
let skipOutline = false
let skipDraft   = false
let onlyOutline = false
for (const arg of process.argv.slice(2)) {
  if (arg === '--skip-outline') { skipOutline = true; continue }
  if (arg === '--skip-draft')   { skipDraft   = true; continue }
  if (arg === '--only-outline') { onlyOutline = true; continue }
  const m = arg.match(/^--([\w-]+)=(.+)$/)
  if (m) flags.set(m[1], m[2])
}

const endpointBase = (flags.get('endpoint') ?? DEFAULT_ENDPOINT).replace(/\/+$/, '')
const projectId    = flags.get('project-id') ?? DEFAULT_PROJECT
const pageSlug     = flags.get('slug')       ?? DEFAULT_SLUG

console.log(`Cowork chained smoke — outline → draft → critique`)
console.log(`  endpoint:    ${endpointBase}`)
console.log(`  project_id:  ${projectId}${projectId === DEFAULT_PROJECT ? '  (Paradox TEST, member 99005)' : ''}`)
console.log(`  page_slug:   ${pageSlug}`)
console.log(`  skip:        outline=${skipOutline}  draft=${skipDraft}`)
console.log()

// ─── Helpers ──────────────────────────────────────────────────────────────

async function postJson(path: string, body: unknown): Promise<{ status: number; body: any; elapsedMs: number }> {
  const t0 = Date.now()
  const r = await fetch(`${endpointBase}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
  const respBody = await r.json().catch(() => ({}))
  return { status: r.status, body: respBody, elapsedMs: Date.now() - t0 }
}

function persistFailurePayload(skill: 'outline-page' | 'draft-page' | 'critique-page', body: any) {
  const dir = join(REPO_ROOT, 'cowork-skills', skill, 'examples', pageSlug)
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'endpoint-response.json'), JSON.stringify(body, null, 2), 'utf8')
    console.error(`   persisted failure payload to ${dir.replace(REPO_ROOT + '/', '')}/endpoint-response.json`)
  } catch (e) {
    console.error(`   (could not persist failure payload: ${e instanceof Error ? e.message : 'unknown'})`)
  }
}

function summarizeFailures(skill: string, status: number, body: any) {
  console.error(`✗ ${skill} failed (${status})`)
  console.error(`   error:    ${body?.error ?? '(none)'}`)
  console.error(`   detail:   ${body?.detail ?? '(none)'}`)
  if (body?.summary)  console.error(`   summary:\n${body.summary.split('\n').map((l: string) => `     ${l}`).join('\n')}`)
  if (body?.byCheck)  console.error(`   byCheck:  ${JSON.stringify(body.byCheck, null, 2)}`)
}

// ─── Step 1: outline ──────────────────────────────────────────────────────

if (!skipOutline) {
  console.log(`Step 1 — POST /api/web/agents/run-outline-page`)
  const { status, body, elapsedMs } = await postJson(
    '/api/web/agents/run-outline-page',
    { project_id: projectId, page_slug: pageSlug },
  )
  if (status !== 200) {
    summarizeFailures('run-outline-page', status, body)
    persistFailurePayload('outline-page', body)
    process.exit(1)
  }
  const meta = body.skill_meta ?? {}
  const expected = COWORK_SKILL_BUNDLES['outline-page']
  if (meta.prompt_hash !== expected.contentHash) {
    console.error(`✗ outline prompt_hash mismatch: got ${meta.prompt_hash}, expected ${expected.contentHash}`)
    process.exit(1)
  }
  console.log(`  ✓ 200 in ${elapsedMs}ms  sections=${body.outline?.sections?.length}  atoms=${meta.atom_count_used}  facts=${meta.fact_count_used ?? 0}  crawl=${meta.crawl_topic_count_used ?? 0}  repaired=${meta.repaired}  fpf=${JSON.stringify(meta.first_pass_failures)}`)
  console.log()
} else {
  console.log(`Step 1 — SKIPPED (--skip-outline; assumes roadmap_state.page_outlines.${pageSlug} already exists)`)
  console.log()
}

if (onlyOutline) {
  console.log(`✓ Outline-only mode (--only-outline) — exiting before draft + critique.`)
  console.log(`  Outline fixture landed at cowork-skills/outline-page/examples/${pageSlug}/`)
  process.exit(0)
}

// ─── Step 2: draft ────────────────────────────────────────────────────────

if (!skipDraft) {
  console.log(`Step 2 — POST /api/web/agents/run-draft-page`)
  const { status, body, elapsedMs } = await postJson(
    '/api/web/agents/run-draft-page',
    { project_id: projectId, page_slug: pageSlug },
  )
  if (status !== 200) {
    summarizeFailures('run-draft-page', status, body)
    persistFailurePayload('draft-page', body)
    process.exit(1)
  }
  const meta = body.skill_meta ?? {}
  const expected = COWORK_SKILL_BUNDLES['draft-page']
  if (meta.prompt_hash !== expected.contentHash) {
    console.error(`✗ draft prompt_hash mismatch: got ${meta.prompt_hash}, expected ${expected.contentHash}`)
    process.exit(1)
  }
  console.log(`  ✓ 200 in ${elapsedMs}ms  sections=${body.draft?.sections?.length}  resolution=${meta.atom_resolution_rate}  repaired=${meta.repaired}  fpf=${JSON.stringify(meta.first_pass_failures)}  truncation=${meta.truncation_suspected}  init_out_tok=${meta.usage?.initial_pass_output_tokens}`)
  console.log()
} else {
  console.log(`Step 2 — SKIPPED (--skip-draft; assumes roadmap_state.page_drafts.${pageSlug} already exists)`)
  console.log()
}

// ─── Step 3: critique ─────────────────────────────────────────────────────

console.log(`Step 3 — POST /api/web/agents/run-critique-page`)
const { status, body, elapsedMs } = await postJson(
  '/api/web/agents/run-critique-page',
  { project_id: projectId, page_slug: pageSlug },
)
if (status !== 200) {
  summarizeFailures('run-critique-page', status, body)
  persistFailurePayload('critique-page', body)
  process.exit(1)
}
const meta = body.skill_meta ?? {}
const expected = COWORK_SKILL_BUNDLES['critique-page']
if (meta.prompt_hash !== expected.contentHash) {
  console.error(`✗ critique prompt_hash mismatch: got ${meta.prompt_hash}, expected ${expected.contentHash}`)
  process.exit(1)
}

const critique = body.critique ?? {}
const directives = Array.isArray(critique.directives) ? critique.directives : []
const blockers = directives.filter((d: any) => d?.severity === 'blocker').length
const warnings = directives.filter((d: any) => d?.severity === 'warning').length
const nits     = directives.filter((d: any) => d?.severity === 'nit').length

console.log(`  ✓ 200 in ${elapsedMs}ms`)
console.log(`     AXIS SCORES: dignity=${critique.dignity} voice=${critique.voice_character} persona=${critique.persona_fit} source_cov=${critique.source_coverage} claim_plaus=${critique.claim_plausibility}`)
console.log(`     DIRECTIVES:  ${directives.length} total (${blockers} blockers / ${warnings} warnings / ${nits} nits)`)
console.log(`     PROBLEM LINES: ${(critique.problem_lines ?? []).length}    STANDOUT LINES: ${(critique.standout_lines ?? []).length}`)
console.log(`     repaired=${meta.repaired}  fpf=${JSON.stringify(meta.first_pass_failures)}`)
console.log()

// ─── Closing summary ──────────────────────────────────────────────────────

console.log(`✓ Chained smoke complete — outline → draft → critique all green for ${pageSlug}.`)
console.log()
console.log(`Fixtures landed at:`)
console.log(`  cowork-skills/outline-page/examples/${pageSlug}/`)
console.log(`  cowork-skills/draft-page/examples/${pageSlug}/`)
console.log(`  cowork-skills/critique-page/examples/${pageSlug}/`)
console.log()
if (pageSlug === 'paratots') {
  console.log(`Known-answer regression:  npm run check:critique-page-regression`)
}
