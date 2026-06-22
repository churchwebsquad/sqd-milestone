/**
 * Smoke test the simulator against WoodCreek's real-world ask:
 *   "Can we launch by October 31 if we run 20 pages with Novamira?"
 *
 * Pulls the current active queue from Supabase, runs
 * simulateNewProjectLaunch, and prints the answer + cascade.
 *
 * Run: SUPABASE_URL=... SUPABASE_ANON_KEY=... npx tsx scripts/smoke-new-project-simulator.ts
 */
import { createClient } from '@supabase/supabase-js'
import { simulateNewProjectLaunch } from '../src/lib/webNewProjectSimulator'
import type { StrategyWebProject } from '../src/types/database'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Quick-and-dirty .env.local loader so we don't pull in dotenv.
for (const f of ['.env.local', '.env']) {
  try {
    const txt = readFileSync(resolve(process.cwd(), f), 'utf8')
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"]*)"?\s*$/i)
      if (m) process.env[m[1]] = process.env[m[1]] ?? m[2]
    }
  } catch {}
}

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL!
const key = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY!
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_ANON_KEY')
  process.exit(1)
}
const supabase = createClient(url, key)

async function main() {
  const { data: rows, error } = await supabase
    .from('strategy_web_projects')
    .select('*')
    .eq('archived', false)
    .neq('current_phase', 'launched')

  if (error) throw error
  const projects = (rows ?? []) as StrategyWebProject[]

  console.log(`Loaded ${projects.length} active projects from the queue.`)
  console.log('Projects by priority:')
  for (const p of [...projects].sort((a, b) => (a.priority_order ?? 999) - (b.priority_order ?? 999))) {
    console.log(`  #${p.priority_order ?? '?'} ${p.church_name ?? p.name ?? p.id.slice(0,8)}  (${p.current_phase}, dev_hours_estimate=${p.dev_hours_estimate ?? '—'}, expected_pages=${p.expected_page_count ?? '—'}, novamira=${p.uses_novamira})`)
  }

  const desiredPriority = Math.max(0, ...projects.map(p => p.priority_order ?? 0)) + 1

  console.log('\n────── SCENARIO: WoodCreek wants Oct 31 ──────')
  console.log('20 pages × 3 hrs/p × 0.5 (Novamira) = 30h target')
  const result = simulateNewProjectLaunch({
    expectedPageCount:    20,
    devHoursPerPage:      3.0,
    usesNovamira:         true,
    devEditsToDesigner:   false,
    assistHoursPerWeek:   0,
    desiredPriority,
    capacityPerWeek:      35,
    existingProjects:     projects,
    today:                new Date(),
  })
  console.log(`Hours needed:     ${result.hoursNeeded}h  (${result.hoursNote})`)
  console.log(`Earliest dev start: ${result.earliestDevStart}`)
  console.log(`Earliest launch:   ${result.earliestLaunch}`)
  console.log(`Weekly consumption: ${JSON.stringify(result.weeklyHours)}`)
  console.log(`Target Oct 31 2026 → ${result.earliestLaunch && result.earliestLaunch <= '2026-10-31' ? 'FEASIBLE' : 'NOT FEASIBLE'}`)
  if (result.cascadeImpact.length) {
    console.log('Cascade:')
    for (const r of result.cascadeImpact) {
      console.log(`  ${r.projectName}: ${r.beforeDevEnd} → ${r.afterDevEnd} (${r.deltaDays > 0 ? '+' : ''}${r.deltaDays}d)`)
    }
  } else {
    console.log('Cascade: no impact on existing projects.')
  }

  console.log('\n────── SCENARIO: WoodCreek + 5h Ashley assist ──────')
  const r2 = simulateNewProjectLaunch({
    expectedPageCount:    20,
    devHoursPerPage:      3.0,
    usesNovamira:         true,
    devEditsToDesigner:   false,
    assistHoursPerWeek:   5,
    desiredPriority,
    capacityPerWeek:      35,
    existingProjects:     projects,
    today:                new Date(),
  })
  console.log(`Earliest launch:   ${r2.earliestLaunch}`)
  console.log(`Weekly consumption: ${JSON.stringify(r2.weeklyHours)}`)
}

main().catch(e => { console.error(e); process.exit(1) })
