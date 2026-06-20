/* eslint-disable */
/**
 * One-shot backfill — invokes atomize-crawl-into-atoms for every
 * project that has at least one completed crawl_job. Safe to re-run:
 * the function is idempotent (deletes + re-inserts the source_kind=
 * 'crawl' rows for the target project on each call).
 *
 * Usage:
 *   npx tsx scripts/atomize-crawl-backfill.ts
 */
import { createClient } from '@supabase/supabase-js'
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

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

async function main() {
  const { data: jobs, error: jobErr } = await supabase
    .schema('web-hub' as never)
    .from('crawl_jobs')
    .select('project_id')
    .eq('status', 'complete')
    .not('crawl_results', 'is', null)
  if (jobErr) {
    console.error('crawl_jobs fetch failed:', jobErr.message)
    process.exit(1)
  }
  const projectIds = Array.from(
    new Set((jobs ?? []).map((j: any) => j.project_id as string)),
  )
  console.log(`Found ${projectIds.length} project(s) with completed crawls.\n`)

  let successes = 0
  let skipped   = 0
  let failures  = 0

  for (const projectId of projectIds) {
    process.stdout.write(`  ${projectId} … `)
    const res = await fetch(`${SUPABASE_URL}/functions/v1/atomize-crawl-into-atoms`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
      body:    JSON.stringify({ project_id: projectId }),
    })
    if (res.ok) {
      const body: any = await res.json()
      console.log(`✓ ${body.pages_atomized} pages (from ${body.crawl_jobs_used} crawl${body.crawl_jobs_used === 1 ? '' : 's'}; thin skipped: ${body.pages_skipped_thin ?? 0})`)
      successes++
    } else if (res.status === 404) {
      const body: any = await res.json().catch(() => ({}))
      console.log(`— skipped (${body.error ?? 'no pages'})`)
      skipped++
    } else {
      const body = await res.text().catch(() => '')
      console.log(`✗ ${res.status} ${body.slice(0, 200)}`)
      failures++
    }
  }

  console.log(`\nDone. ${successes} atomized, ${skipped} skipped, ${failures} failed.`)
}

main().catch(e => { console.error(e); process.exit(1) })
