#!/usr/bin/env tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Smoke test: project bundle must surface partner-added inventory.
 *
 * Drives `api/web/cowork/page-context-bundle.ts` against Arvada
 * (project 2eac7eb8-269d-4584-84a4-3dc9fdd6fcde) by mocking the
 * Vercel req/res pair and asserts `partner_added_inventory[]` lands
 * with the 8 partner-written entries the cowork pipeline was
 * silently dropping. Non-destructive — readonly DB queries only.
 *
 * Run: npx tsx scripts/smoke-bundle-partner-added.ts
 * Exit: 0 inventory surfaces | 1 inventory missing / partial
 */
/* eslint-disable no-console, @typescript-eslint/no-explicit-any */

import { readFileSync, existsSync } from 'node:fs'
for (const envPath of ['.env.local', '.env']) {
  if (!existsSync(envPath)) continue
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const k = line.slice(0, eq).trim()
    const v = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (process.env[k] == null) process.env[k] = v
  }
}

const ARVADA_PROJECT_ID = '2eac7eb8-269d-4584-84a4-3dc9fdd6fcde'

const handler = (await import('../api/web/cowork/page-context-bundle.js')).default

const req: any = { method: 'GET', query: { project_id: ARVADA_PROJECT_ID } }
let statusCode = 0
let headers: Record<string, string> = {}
let body: string | null = null
const res: any = {
  status(c: number) { statusCode = c; return this },
  json(obj: unknown) { body = JSON.stringify(obj); return this },
  send(s: string) { body = s; return this },
  setHeader(k: string, v: string) { headers[k] = v },
}

await handler(req, res)
if (statusCode !== 200 || !body) {
  console.error(`✗ FAIL — handler returned ${statusCode}: ${(body as string | null)?.slice(0, 200) ?? '<empty>'}`)
  process.exit(1)
}

const bundle = JSON.parse(body as string)
const inv: any[] = Array.isArray(bundle.partner_added_inventory) ? bundle.partner_added_inventory : []

console.log(`\nproject_id              ${ARVADA_PROJECT_ID}`)
console.log(`bundle bytes            ${(body as string).length}`)
console.log(`partner_added_inventory ${inv.length} entries\n`)

let failures = 0
const mark = (ok: boolean, label: string, extra?: string): void => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`)
  if (!ok) failures++
}

mark(inv.length >= 8, `inventory has ≥ 8 entries`, `actual=${inv.length}`)

const expectedNames = new Set([
  'Ways to give summarized',
  'Repeated Saying',
  'Why Give',
  'Global Outreach opportunities',
  'Local Ministry Partners',
  'Justice Partnerships',
  'Prayer Ministry',
  'Recovery Ministry',
])
const presentNames = new Set(inv.map(e => String(e.name ?? '')))
for (const name of expectedNames) {
  mark(presentNames.has(name), `inventory contains "${name}"`)
}

// Spot-check shape of one entry
const sample = inv.find(e => e.name === 'Ways to give summarized') ?? inv[0]
if (sample) {
  console.log('\nSample entry shape:')
  console.log(JSON.stringify({
    bucket_key:         sample.bucket_key,
    source:             sample.source,
    baseline_field_key: sample.baseline_field_key,
    name:               sample.name,
    description_chars:  typeof sample.description === 'string' ? sample.description.length : null,
    target_path:        sample.target_path,
    attachments:        Array.isArray(sample.attachments) ? sample.attachments.length : null,
  }, null, 2))
  mark(typeof sample.bucket_key === 'string' && sample.bucket_key.length > 0, 'sample.bucket_key set')
  mark(sample.source === 'baseline' || sample.source === 'standalone', `sample.source ∈ {baseline,standalone}`)
  mark(typeof sample.target_path === 'string' && sample.target_path.startsWith('missing:'), 'sample.target_path well-formed')
  mark(Array.isArray(sample.attachments), 'sample.attachments is array')
}

// Bucket coverage
const buckets = new Set<string>(inv.map(e => String(e.bucket_key ?? '')))
console.log(`\nbuckets represented: ${[...buckets].sort().join(', ')}`)

// Also confirm the other source pools didn't regress
mark(Array.isArray(Object.keys(bundle.atoms_pool?.by_id ?? {})) && Object.keys(bundle.atoms_pool.by_id).length > 0,
     `atoms_pool.by_id populated (${Object.keys(bundle.atoms_pool.by_id ?? {}).length} atoms)`)
mark(Object.keys(bundle.facts_pool?.by_id ?? {}).length > 0,
     `facts_pool.by_id populated (${Object.keys(bundle.facts_pool.by_id ?? {}).length} facts)`)
mark(Object.keys(bundle.crawl_topics_pool?.by_key ?? {}).length > 0,
     `crawl_topics_pool.by_key populated (${Object.keys(bundle.crawl_topics_pool.by_key ?? {}).length} topics)`)

if (failures > 0) {
  console.log(`\n✗ ${failures} failure(s)`)
  process.exit(1)
}
console.log(`\n✓ PASS — bundle surfaces partner-added inventory end-to-end`)
