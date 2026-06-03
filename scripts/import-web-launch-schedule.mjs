// One-time importer for the Web Development Estimation / Launch List
// CSV. Seeds the v58 scheduler columns on strategy_web_projects and
// the strategy_dev_weekly_allocations table so the new Website
// Manager scheduler has real data to render from day one. After this
// runs, the CSV is retired — edits happen in-app.
//
// Source CSV layout (two blocks separated by blank lines):
//
//   Block 1 (left columns, per-project):
//     Priority, Member ID, Church, Launch Date, Josh Dev Hours Allocated
//
//   Block 2 (right columns, per-week):
//     Week, Starting, Total Josh Hours, Primary Focus, Secondary, Tertiary
//
// The "Primary Focus", "Secondary", "Tertiary" cells look like
// "Mosaic (15h)" or "Mission Viejo Christian Church (30h)" — name
// plus parenthesized hours. We fuzzy-match the name to a member ID
// via strategy_account_progress, then insert a row per slot into
// strategy_dev_weekly_allocations.
//
// Idempotent: per-project upsert on member, per-allocation upsert on
// (week_starting, web_project_id, slot). Re-running is a no-op.
//
// Usage:
//   node scripts/import-web-launch-schedule.mjs --dry-run    # preview
//   node scripts/import-web-launch-schedule.mjs              # write
//   node scripts/import-web-launch-schedule.mjs --csv <path> # custom path

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const DEFAULT_CSV =
  '/Users/ashleyfox/Documents/Claude/Projects/Web 2.0/Web Development Estimation Launch List.csv'

function loadEnv() {
  for (const f of ['.env.local', '.env']) {
    const p = path.join(__dirname, '..', f)
    if (!fs.existsSync(p)) continue
    for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
      if (!m) continue
      if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
}
loadEnv()

const argv = process.argv.slice(2)
const dryRun = argv.includes('--dry-run')
const csvIdx = argv.indexOf('--csv')
const csvPath = csvIdx >= 0 ? argv[csvIdx + 1] : DEFAULT_CSV

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env')
  process.exit(1)
}
const supabase = createClient(url, key)

// ── CSV parsing ──────────────────────────────────────────────

/** Split a CSV row into cells. Quoted commas are NOT used in this
 *  CSV; a plain split is sufficient. */
function splitRow(line) {
  return line.split(',').map(c => c.trim())
}

function parseCsv(content) {
  const lines = content.split(/\r?\n/).filter(l => l.length > 0)
  if (lines.length === 0) return { projects: [], weeks: [] }

  // The header row carries BOTH block headers in one CSV row, separated
  // by an empty column. Detect the split by finding the first cell
  // matching "Week".
  const header = splitRow(lines[0])
  const weekColIdx = header.findIndex(c => c === 'Week')
  if (weekColIdx === -1) {
    throw new Error('Could not find "Week" column header in CSV')
  }

  const projects = []
  const weeks = []
  for (let i = 1; i < lines.length; i++) {
    const row = splitRow(lines[i])
    // Project columns 0..(weekColIdx-1): Priority, Member ID, Church,
    //   Launch Date, Josh Dev Hours Allocated, [pad].
    const priority    = row[0]
    const memberId    = row[1]
    const churchName  = row[2]
    const launchDate  = row[3]
    const totalHours  = row[4]
    if (memberId && churchName && launchDate) {
      projects.push({
        priority:   priority ? parseInt(priority, 10) : null,
        memberId:   parseInt(memberId, 10),
        churchName,
        launchDate,
        totalHours: totalHours ? parseFloat(totalHours) : null,
      })
    }
    // Week columns: weekColIdx..(weekColIdx+5)
    // [Week, Starting, Total, Primary, Secondary, Tertiary]
    const weekNumRaw = row[weekColIdx]
    const startingRaw = row[weekColIdx + 1]
    const totalRaw    = row[weekColIdx + 2]
    const primary     = row[weekColIdx + 3]
    const secondary   = row[weekColIdx + 4]
    const tertiary    = row[weekColIdx + 5]
    if (weekNumRaw !== '' && startingRaw) {
      weeks.push({
        weekNum: parseInt(weekNumRaw, 10),
        starting: startingRaw,
        totalHours: totalRaw ? parseFloat(totalRaw) : null,
        primary,
        secondary,
        tertiary,
      })
    }
  }
  return { projects, weeks }
}

// ── Date conversion ──────────────────────────────────────────

/** Convert CSV date strings ("May 18" or "2026-11-09") to ISO
 *  yyyy-mm-dd in local time. Current calendar year; if the parsed
 *  date is in the past (before today), roll forward one year. */
function toIsoDate(raw, today = new Date()) {
  const trimmed = String(raw).trim()
  // Already ISO?
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10)
  // "May 18" or "May 18, 2026"
  const m = /^([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?$/.exec(trimmed)
  if (!m) return null
  const monthName = m[1]
  const day = parseInt(m[2], 10)
  const year = m[3]
    ? parseInt(m[3], 10)
    : today.getFullYear()
  const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
  const monthIdx = months.indexOf(monthName.slice(0, 3).toLowerCase())
  if (monthIdx === -1) return null
  let d = new Date(year, monthIdx, day, 12, 0, 0)
  if (!m[3] && d < today) {
    d = new Date(year + 1, monthIdx, day, 12, 0, 0)
  }
  const y = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${mm}-${dd}`
}

// ── Focus-cell parser ────────────────────────────────────────

/** Parse "Mosaic (15h)" → { name: 'Mosaic', hours: 15 }.
 *  Returns null for empty / placeholder cells. */
function parseFocusCell(raw) {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('—') || /^open\b/i.test(trimmed)) return null
  const m = /^(.+?)\s*\((\d+(?:\.\d+)?)\s*h?\)\s*$/.exec(trimmed)
  if (!m) return { name: trimmed, hours: 0 }
  return { name: m[1].trim(), hours: parseFloat(m[2]) }
}

// ── Member resolution ────────────────────────────────────────

async function loadMemberLookup(memberIds) {
  // Load every project + every account once to bridge churchName -> member
  // and member -> web_project_id.
  const { data: accounts } = await supabase
    .from('strategy_account_progress')
    .select('member, church_name')
    .in('member', memberIds)
  const memberToChurch = new Map()
  const churchToMember = new Map()
  for (const a of accounts ?? []) {
    memberToChurch.set(a.member, a.church_name ?? null)
    if (a.church_name) {
      churchToMember.set(normalizeName(a.church_name), a.member)
    }
  }

  const { data: projects } = await supabase
    .from('strategy_web_projects')
    .select('id, member, archived, created_at')
    .in('member', memberIds)
    .eq('archived', false)
    .order('created_at', { ascending: false })
  const memberToProject = new Map()
  for (const p of projects ?? []) {
    if (!memberToProject.has(p.member)) memberToProject.set(p.member, p.id)
  }
  return { memberToChurch, churchToMember, memberToProject }
}

function normalizeName(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

// ── Main flow ────────────────────────────────────────────────

async function main() {
  const content = fs.readFileSync(csvPath, 'utf-8')
  const { projects, weeks } = parseCsv(content)
  console.log(`Parsed ${projects.length} projects, ${weeks.length} weeks from ${csvPath}`)

  const memberIds = projects.map(p => p.memberId)
  const { memberToChurch, churchToMember, memberToProject } = await loadMemberLookup(memberIds)

  // ── Stub creation for missing projects ───────────────────
  // Partners present in the CSV but missing a strategy_web_projects
  // row get a stub created here (kind='redesign', phase='intake').
  // Skipped in --dry-run.
  const stubsToCreate = []
  for (const proj of projects) {
    if (!memberToProject.has(proj.memberId)) {
      stubsToCreate.push({
        member: proj.memberId,
        name: `${proj.churchName} Redesign`,
        kind: 'redesign',
        current_phase: 'intake',
      })
    }
  }
  if (stubsToCreate.length > 0) {
    if (dryRun) {
      console.log(`[dry-run] Would create ${stubsToCreate.length} stub projects:`)
      for (const s of stubsToCreate) console.log(`  • member ${s.member}: ${s.name}`)
    } else {
      console.log(`Creating ${stubsToCreate.length} stub projects...`)
      const { data: created, error: stubErr } = await supabase
        .from('strategy_web_projects')
        .insert(stubsToCreate)
        .select('id, member')
      if (stubErr) {
        console.error(`[fail] stub insert: ${stubErr.message}`)
      } else {
        for (const c of created ?? []) {
          memberToProject.set(c.member, c.id)
          churchToMember.set(
            normalizeName(projects.find(p => p.memberId === c.member)?.churchName ?? ''),
            c.member,
          )
        }
        console.log(`Created ${created?.length ?? 0} stub projects.`)
      }
    }
  }

  // ── Project rows ─────────────────────────────────────────
  const projUpdates = []
  for (const proj of projects) {
    const webProjectId = memberToProject.get(proj.memberId)
    if (!webProjectId) {
      console.log(`[skip] member ${proj.memberId} (${proj.churchName}) — no active web project`)
      continue
    }
    const launchIso = toIsoDate(proj.launchDate)
    if (!launchIso) {
      console.log(`[warn] member ${proj.memberId}: couldn't parse launch date "${proj.launchDate}"`)
    }
    projUpdates.push({
      web_project_id: webProjectId,
      member: proj.memberId,
      church: proj.churchName,
      patch: {
        launch_date:        launchIso,
        priority_order:     proj.priority,
        dev_hours_estimate: proj.totalHours,
      },
    })
  }
  console.log(`Project updates queued: ${projUpdates.length}`)

  // ── Weekly allocations ───────────────────────────────────
  // For each week × slot ('primary'|'secondary'|'tertiary'), map
  // the focus name to a member → web_project_id and insert one row.
  // Add the canonical churches from the CSV's project block to the
  // churchToMember lookup so primary-focus cells that use the
  // exact CSV church name match even when account_progress is
  // missing (or differs in casing).
  for (const p of projects) {
    churchToMember.set(normalizeName(p.churchName), p.memberId)
  }

  const allocRows = []
  const unmatchedFocus = new Set()
  for (const w of weeks) {
    const weekIso = toIsoDate(w.starting)
    if (!weekIso) {
      console.log(`[warn] week ${w.weekNum}: couldn't parse starting "${w.starting}"`)
      continue
    }
    for (const slot of ['primary', 'secondary', 'tertiary']) {
      const cell = parseFocusCell(w[slot])
      if (!cell || cell.hours === 0) continue
      const member = churchToMember.get(normalizeName(cell.name))
      const projectId = member ? memberToProject.get(member) : null
      if (!projectId) {
        unmatchedFocus.add(cell.name)
        continue
      }
      allocRows.push({
        week_starting: weekIso,
        web_project_id: projectId,
        hours: cell.hours,
        slot,
      })
    }
  }
  console.log(`Allocation rows queued: ${allocRows.length}`)
  if (unmatchedFocus.size > 0) {
    console.log(`[warn] ${unmatchedFocus.size} focus names didn't resolve to a project:`)
    for (const name of unmatchedFocus) console.log(`  • ${name}`)
  }

  if (dryRun) {
    console.log('\n[dry-run] No writes. Sample project patches:')
    for (const u of projUpdates.slice(0, 3)) {
      console.log(`  ${u.member} ${u.church}: ${JSON.stringify(u.patch)}`)
    }
    console.log('Sample allocations:')
    for (const a of allocRows.slice(0, 5)) console.log(`  ${a.week_starting} ${a.slot} ${a.hours}h project=${a.web_project_id}`)
    return
  }

  // ── Apply ────────────────────────────────────────────────
  let projOk = 0, projFail = 0
  for (const u of projUpdates) {
    const { error } = await supabase
      .from('strategy_web_projects')
      .update(u.patch)
      .eq('id', u.web_project_id)
    if (error) {
      console.error(`[fail] update ${u.member}: ${error.message}`)
      projFail++
    } else {
      projOk++
    }
  }

  let allocOk = 0, allocFail = 0
  for (const a of allocRows) {
    const { error } = await supabase
      .from('strategy_dev_weekly_allocations')
      .upsert(a, { onConflict: 'week_starting,web_project_id,slot' })
    if (error) {
      console.error(`[fail] alloc ${a.week_starting}/${a.slot}: ${error.message}`)
      allocFail++
    } else {
      allocOk++
    }
  }

  console.log(`\nDone. Projects updated: ${projOk} (${projFail} failed). Allocations upserted: ${allocOk} (${allocFail} failed).`)
}

await main()
