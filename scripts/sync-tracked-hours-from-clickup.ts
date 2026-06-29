/* eslint-disable */
// Sync strategy_web_projects.tracked_hours from ClickUp.
//
// The squad logs time in ClickUp at the task level. Tasks live in a
// per-partner folder named "{member} - {church_name}" (folder ID
// stored on strategy_web_projects.clickup_folder_id, populated by
// the v120 migration + backfill).
//
// This script pulls workspace-wide time entries from ClickUp for all
// squad employees, aggregates by folder, and writes the per-project
// total back to Supabase. Run it manually for one-off refresh, OR
// wrap into an edge function on a cron schedule (see the matching
// `supabase/functions/sync-tracked-hours` once it lands).
//
// Run with:
//   npx tsx scripts/sync-tracked-hours-from-clickup.ts            # dry run
//   npx tsx scripts/sync-tracked-hours-from-clickup.ts --apply    # write tracked_hours

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

const APPLY = process.argv.includes('--apply')
const CLICKUP_TOKEN = process.env.CLICKUP_MILESTONE_API_TOKEN
if (!CLICKUP_TOKEN) {
  console.error('CLICKUP_MILESTONE_API_TOKEN missing from env')
  process.exit(1)
}

// How far back to look. 365 days covers any in-flight project.
// Older completed projects are launched and excluded from active
// scheduling anyway.
const LOOKBACK_DAYS = 365

const sb = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

// ── 1. Get team ID + staff IDs ──────────────────────────────────────

async function clickupJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: CLICKUP_TOKEN! } })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`ClickUp ${res.status}: ${body.slice(0, 400)}`)
  }
  return res.json() as Promise<T>
}

const teamData = await clickupJson<{ teams: Array<{ id: string }> }>('https://api.clickup.com/api/v2/team')
const teamId = teamData.teams[0]?.id
if (!teamId) throw new Error('No ClickUp team found for this token')

const { data: staffRows, error: staffErr } = await sb
  .from('clickup_users')
  .select('clickup_id')
  .ilike('email', '%@churchmediasquad.com')
  .not('clickup_id', 'is', null)
  .gt('clickup_id', 1000)
if (staffErr) throw staffErr
const staffIds = (staffRows as Array<{ clickup_id: number }>).map(r => r.clickup_id)
console.log(`Team: ${teamId}`)
console.log(`Squad staff IDs: ${staffIds.length}`)

// ── 2. Fetch time entries ────────────────────────────────────────────
// ClickUp caps the assignee comma list at ~100 user IDs per request,
// so split into batches if we ever cross that. Right now we're at 97.

interface ClickUpTimeEntry {
  id: string
  duration: string | number      // milliseconds, sometimes returned as string
  start: string
  end: string
  user: { id: number; username: string }
  task_location?: {
    list_id?: string | null
    folder_id?: string | null
    space_id?: string | null
  } | null
  task?: { id: string; name: string } | null
}

const endMs = Date.now()
const startMs = endMs - LOOKBACK_DAYS * 86400_000

console.log(`Lookback window: ${new Date(startMs).toISOString().slice(0,10)} → ${new Date(endMs).toISOString().slice(0,10)}`)

async function fetchEntries(assigneeBatch: number[]): Promise<ClickUpTimeEntry[]> {
  const url = `https://api.clickup.com/api/v2/team/${teamId}/time_entries`
    + `?start_date=${startMs}&end_date=${endMs}&assignee=${assigneeBatch.join(',')}`
  const body = await clickupJson<{ data: ClickUpTimeEntry[] }>(url)
  return body.data ?? []
}

const allEntries: ClickUpTimeEntry[] = []
const BATCH = 10  // ClickUp 500s on larger assignee lists
for (let i = 0; i < staffIds.length; i += BATCH) {
  const batch = staffIds.slice(i, i + BATCH)
  try {
    const entries = await fetchEntries(batch)
    allEntries.push(...entries)
    process.stdout.write(`  batch ${(i / BATCH + 1).toString().padStart(2)}: +${entries.length.toString().padStart(4)} entries (running ${allEntries.length})\n`)
  } catch (e) {
    // Individual batch failure — keep going so a single bad ID doesn't
    // wipe the run. Fall back to per-user fetch for the affected batch.
    console.warn(`  batch ${i / BATCH + 1} failed (${(e as Error).message.slice(0, 80)}). Falling back to per-user.`)
    for (const uid of batch) {
      try {
        const entries = await fetchEntries([uid])
        allEntries.push(...entries)
      } catch (e2) {
        console.warn(`    user ${uid} failed: ${(e2 as Error).message.slice(0, 60)}`)
      }
    }
  }
}

// ── 3. Aggregate by folder ───────────────────────────────────────────

const msByFolder = new Map<string, number>()
const entriesByFolder = new Map<string, number>()
for (const e of allEntries) {
  const fid = e.task_location?.folder_id ?? null
  if (!fid) continue
  const ms = Number(e.duration) || 0
  msByFolder.set(String(fid), (msByFolder.get(String(fid)) ?? 0) + ms)
  entriesByFolder.set(String(fid), (entriesByFolder.get(String(fid)) ?? 0) + 1)
}

// ── 4. Resolve to projects ───────────────────────────────────────────

const { data: projects, error: projErr } = await sb
  .from('strategy_web_projects')
  .select('id, member, church_name, clickup_folder_id, tracked_hours')
  .eq('archived', false)
  .not('clickup_folder_id', 'is', null)
if (projErr) throw projErr

const accountMap = new Map<number, string>()
{
  const { data: accounts } = await sb
    .from('strategy_account_progress')
    .select('member, church_name')
    .in('member', (projects as Array<{ member: number }>).map(p => p.member))
  for (const a of (accounts ?? []) as Array<{ member: number; church_name: string | null }>) {
    if (a.church_name) accountMap.set(a.member, a.church_name)
  }
}

interface Plan {
  id:           string
  member:       number
  church_name:  string
  folder_id:    string
  prev_hours:   number
  new_hours:    number
  entries:      number
  delta:        number
}

const plans: Plan[] = []
for (const p of projects as Array<{ id: string; member: number; church_name: string | null; clickup_folder_id: string; tracked_hours: string | number | null }>) {
  const fid = p.clickup_folder_id
  const ms = msByFolder.get(fid) ?? 0
  const newHours = Math.round((ms / 3600_000) * 100) / 100
  const prevHours = Number(p.tracked_hours ?? 0)
  if (Math.abs(newHours - prevHours) < 0.05) continue   // unchanged → skip
  plans.push({
    id:          p.id,
    member:      p.member,
    church_name: accountMap.get(p.member) ?? p.church_name ?? '?',
    folder_id:   fid,
    prev_hours:  prevHours,
    new_hours:   newHours,
    entries:     entriesByFolder.get(fid) ?? 0,
    delta:       newHours - prevHours,
  })
}

plans.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))

// ── 5. Print + apply ─────────────────────────────────────────────────

console.log('')
console.log(`Total entries fetched:      ${allEntries.length}`)
console.log(`Projects with delta ≥ 0.05: ${plans.length}`)
console.log(`Total hours across queue:   ${[...msByFolder.values()].reduce((s, ms) => s + ms, 0) / 3600_000 |0}h`)
console.log('')
console.log(`${'Member'.padEnd(7)} ${'Church'.padEnd(46)} ${'Prev'.padStart(8)} ${'New'.padStart(8)} ${'Δ'.padStart(8)} entries`)
for (const p of plans) {
  console.log(`${p.member.toString().padEnd(7)} ${(p.church_name + '').padEnd(46)} ${p.prev_hours.toFixed(2).padStart(8)} ${p.new_hours.toFixed(2).padStart(8)} ${(p.delta >= 0 ? '+' : '') + p.delta.toFixed(2).padStart(7)} ${p.entries}`)
}
console.log('')

if (!APPLY) {
  console.log('(Run with --apply to write tracked_hours.)')
  process.exit(0)
}

console.log('Applying…')
let done = 0
for (const p of plans) {
  const { error } = await sb
    .from('strategy_web_projects')
    .update({ tracked_hours: p.new_hours })
    .eq('id', p.id)
  if (error) {
    console.error(`  ✗ ${p.member} ${p.church_name}: ${error.message}`)
  } else {
    done++
  }
}
console.log(`✓ Updated ${done}/${plans.length} projects.`)
