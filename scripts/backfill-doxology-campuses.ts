/**
 * Doxology Bible Church — multi-campus backfill (Phase 1.7 / v115).
 *
 * Doxology is the lead use case for multi-campus support. The church
 * has three locations (Southwest, Alliance, Espanol) that should each
 * carry their own per-ministry content rather than getting mashed into
 * one shared topic row. This script seeds the campus registry and
 * re-runs the crawl/atomize pipeline so existing data tags correctly.
 *
 * BEFORE running this script, deploy these edge functions so the new
 * partitioning logic is live:
 *
 *   supabase functions deploy crawl-categorize
 *   supabase functions deploy atomize-crawl-into-atoms
 *
 * Then run:
 *
 *   node --env-file=.env.local.vercel --import tsx scripts/backfill-doxology-campuses.ts
 *
 * (Or set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the shell and
 *  run `npx tsx scripts/backfill-doxology-campuses.ts`.)
 *
 * Idempotent. Safe to re-run.
 *
 * What it does (in order):
 *   1. Verifies the Doxology project exists + has a completed crawl.
 *   2. Writes the campuses[] registry to strategy_web_projects.
 *      Southwest = primary (its URLs are what's currently crawled).
 *      Alliance + Espanol are registered with crawl_url=null so staff
 *      can fill them in when Cameron Sanderson provides them.
 *   3. Calls crawl-categorize on the latest completed crawl. This re-
 *      partitions every topic by URL prefix → southwest-tagged rows
 *      and a NULL/global row per topic_key.
 *   4. Calls atomize-crawl-into-atoms. This re-tags every content_atom
 *      with metadata.campus_slug.
 *   5. Prints a per-topic + per-atom campus breakdown so staff can
 *      confirm the partition looks right before pointing partners at
 *      the inventory.
 *
 * Doesn't touch:
 *   - The crawl_job's crawl_results (raw markdown stays intact).
 *   - Marks / submissions (existing partner work is preserved).
 *   - Other projects (filtered by Doxology's project_id).
 */
import { createClient } from '@supabase/supabase-js'

// Doxology Bible Church — confirmed by user. Member 1963.
// Pinning the project_id rather than looking it up so the script can
// only ever affect this one church.
const DOXOLOGY_PROJECT_ID = '4ef827f7-3e66-46d3-a4f6-26e1a744ddba'

interface CampusDef {
  slug:       string
  label:      string
  primary:    boolean
  sort_order: number
  crawl_url:  string | null
}

// Registry seeded from the Cameron Sanderson conversation. Southwest is
// the primary because it's the only campus with crawled URLs today;
// Cameron will follow up with Alliance + Espanol URLs.
const DOXOLOGY_CAMPUSES: CampusDef[] = [
  { slug: 'southwest', label: 'Southwest', primary: true,  sort_order: 1, crawl_url: 'https://doxology.church/southwest' },
  { slug: 'alliance',  label: 'Alliance',  primary: false, sort_order: 2, crawl_url: null },
  { slug: 'espanol',   label: 'Español',   primary: false, sort_order: 3, crawl_url: null },
]

async function main() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL
  // Backfill needs service role — RLS would otherwise block the project
  // update + topic delete cascade. The script is staff-only by design.
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env')
    process.exit(1)
  }
  const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  // ── 1. Verify the project exists + has a completed crawl ─────────
  const { data: proj, error: projErr } = await sb
    .from('strategy_web_projects')
    .select('id, member, campuses, name')
    .eq('id', DOXOLOGY_PROJECT_ID)
    .maybeSingle()
  if (projErr) throw projErr
  if (!proj) throw new Error(`Doxology project ${DOXOLOGY_PROJECT_ID} not found`)
  console.log(`Project: ${(proj as { name: string }).name} (member ${(proj as { member: number }).member})`)
  const existingCampuses = Array.isArray((proj as { campuses?: unknown }).campuses) ? (proj as { campuses: unknown[] }).campuses : []
  if (existingCampuses.length > 0) {
    console.log(`  existing campuses: ${existingCampuses.length} → will replace`)
  }

  const { data: latestJob, error: jobErr } = await sb
    .schema('web-hub' as never)
    .from('crawl_jobs')
    .select('id, status, completed_at, crawl_results')
    .eq('project_id', DOXOLOGY_PROJECT_ID)
    .eq('status', 'complete')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (jobErr) throw jobErr
  if (!latestJob) throw new Error('No completed crawl for Doxology — run a crawl first')
  console.log(`Latest completed crawl: ${(latestJob as { id: string }).id} (${(latestJob as { completed_at: string }).completed_at})`)

  // ── 2. Write the campus registry ──────────────────────────────────
  const { error: updErr } = await sb
    .from('strategy_web_projects')
    .update({ campuses: DOXOLOGY_CAMPUSES } as never)
    .eq('id', DOXOLOGY_PROJECT_ID)
  if (updErr) throw updErr
  console.log(`Wrote ${DOXOLOGY_CAMPUSES.length} campuses to registry`)

  // ── 3. Re-run crawl-categorize on the latest job ─────────────────
  // The edge function reads the project's campuses[] before partition,
  // so step 2 MUST be done first (which it is). After this call the
  // web_project_topics table will have one row per (topic_key, campus)
  // for any topic with campus-scoped URLs in its source_page_urls.
  const catRes = await fetch(`${supabaseUrl}/functions/v1/crawl-categorize`, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      project_id:   DOXOLOGY_PROJECT_ID,
      crawl_job_id: (latestJob as { id: string }).id,
    }),
  })
  const catJson = await catRes.json() as Record<string, unknown>
  if (!catRes.ok) throw new Error(`crawl-categorize failed: ${JSON.stringify(catJson)}`)
  console.log(`crawl-categorize: ${JSON.stringify(catJson)}`)

  // ── 4. Re-run atomize-crawl-into-atoms ───────────────────────────
  // Each atom's metadata.campus_slug is set from the page's URL prefix.
  const atomRes = await fetch(`${supabaseUrl}/functions/v1/atomize-crawl-into-atoms`, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ project_id: DOXOLOGY_PROJECT_ID }),
  })
  const atomJson = await atomRes.json() as Record<string, unknown>
  if (!atomRes.ok) throw new Error(`atomize failed: ${JSON.stringify(atomJson)}`)
  console.log(`atomize-crawl-into-atoms: ${JSON.stringify(atomJson)}`)

  // ── 5. Print the breakdown ───────────────────────────────────────
  const { data: topicCounts } = await sb
    .from('web_project_topics')
    .select('topic_key, campus_slug')
    .eq('web_project_id', DOXOLOGY_PROJECT_ID)
  const topicBreakdown = new Map<string, number>()
  for (const t of (topicCounts ?? []) as Array<{ topic_key: string; campus_slug: string | null }>) {
    const key = `${t.campus_slug ?? '(global)'}`
    topicBreakdown.set(key, (topicBreakdown.get(key) ?? 0) + 1)
  }
  console.log('\nTopic rows by campus:')
  for (const [campus, n] of [...topicBreakdown.entries()].sort()) {
    console.log(`  ${campus.padEnd(12)} ${n}`)
  }

  const { data: atoms } = await sb
    .from('content_atoms')
    .select('metadata')
    .eq('web_project_id', DOXOLOGY_PROJECT_ID)
    .eq('source_kind', 'crawl')
  const atomBreakdown = new Map<string, number>()
  for (const a of (atoms ?? []) as Array<{ metadata: { campus_slug?: string | null } | null }>) {
    const key = `${a.metadata?.campus_slug ?? '(global)'}`
    atomBreakdown.set(key, (atomBreakdown.get(key) ?? 0) + 1)
  }
  console.log('\nCrawl atoms by campus:')
  for (const [campus, n] of [...atomBreakdown.entries()].sort()) {
    console.log(`  ${campus.padEnd(12)} ${n}`)
  }

  console.log('\nDone. Spot-check the inventory at /wm/<project>/intake before sharing.')
  console.log('When Cameron supplies Alliance + Espanol URLs, update DOXOLOGY_CAMPUSES.crawl_url and re-crawl.')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
