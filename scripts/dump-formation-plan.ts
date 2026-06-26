#!/usr/bin/env tsx
/* eslint-disable no-console */
/**
 * One-off: run computeFormationPlan() against a real partner project
 * and dump the output JSON to the scratchpad for inspection.
 *
 * Reads from prod via SUPABASE_SERVICE_ROLE_KEY but does NOT write
 * (uses computeFormationPlan, not saveFormationPlan).
 *
 * Usage:
 *   tsx scripts/dump-formation-plan.ts <web-project-id>
 *   tsx scripts/dump-formation-plan.ts --member 1963
 *   tsx scripts/dump-formation-plan.ts --auto      # find first project with approved pages
 */

import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

// ── env loading (matches scripts/render-one.ts pattern) ──
for (const envPath of ['.env.local', '.env']) {
  if (!existsSync(envPath)) continue
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i)
    if (!m) continue
    const [, k, raw] = m
    const v = raw.replace(/^['"]|['"]$/g, '')
    if (process.env[k] == null) process.env[k] = v
  }
}

const SCRATCHPAD = '/private/tmp/claude-501/-Users-ashleyfox-Documents-Claude-Projects-milestone-comms-app/382acdd8-b49d-4e59-a6c3-9ea84b8a3aa1/scratchpad'

async function main() {
  const args = process.argv.slice(2)
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env')
    process.exit(1)
  }
  const sb = createClient(url, key, { auth: { persistSession: false } })

  // Resolve target project id.
  let projectId: string | null = null
  let resolveNote = ''
  if (args[0] === '--member' && args[1]) {
    const member = Number(args[1])
    const { data, error } = await sb
      .from('strategy_web_projects')
      .select('id, name, member')
      .eq('member', member)
      .order('current_phase', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error || !data) { console.error('No project for member', member, error); process.exit(1) }
    projectId = (data as { id: string }).id
    resolveNote = `member ${member} → ${projectId} (${(data as { name?: string }).name ?? 'unnamed'})`
  } else if (args[0] === '--auto') {
    // Find first project with at least one approved page in
    // roadmap_state.approved_pages. Postgres JSONB ?| operator + a
    // conservative LIMIT 50 scan keeps the cost predictable.
    const { data, error } = await sb
      .from('strategy_web_projects')
      .select('id, name, member, roadmap_state')
      .not('roadmap_state', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(100)
    if (error || !data) { console.error('Auto-select query failed:', error); process.exit(1) }
    for (const row of data as Array<{ id: string; name?: string; member?: number; roadmap_state: unknown }>) {
      const rs = (row.roadmap_state ?? {}) as Record<string, unknown>
      const approved = rs.approved_pages as Record<string, { status?: string }> | undefined
      if (approved && Object.values(approved).some(v => v?.status === 'approved')) {
        projectId = row.id
        resolveNote = `auto → ${projectId} (${row.name ?? 'unnamed'}, member ${row.member ?? '?'}, approved pages: ${Object.values(approved).filter(v => v?.status === 'approved').length})`
        break
      }
    }
    if (!projectId) { console.error('No project found with approved pages.'); process.exit(1) }
  } else if (args[0]) {
    projectId = args[0]
    resolveNote = `arg ${projectId}`
  } else {
    console.error('Usage: tsx scripts/dump-formation-plan.ts <project-id> | --member <n> | --auto')
    process.exit(1)
  }

  // Import the analyzer AFTER env is loaded so the supabase client
  // it instantiates from src/lib/supabase picks up the right vars.
  // We use the named computeFormationPlan to keep this read-only.
  const { computeFormationPlan } = await import('../src/lib/acfFormationPlan')

  console.log(`Resolving project: ${resolveNote}`)
  console.log('Running computeFormationPlan...')
  const start = Date.now()
  const plan = await computeFormationPlan(projectId, sb as unknown as never)
  const elapsedMs = Date.now() - start

  // Dump to scratchpad, named by project + timestamp.
  const safeId = projectId.replace(/[^a-z0-9-]/gi, '_')
  const outPath = `${SCRATCHPAD}/formation-plan-${safeId}.json`
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(plan, null, 2))

  // Console summary so the user can eyeball before opening the file.
  console.log(`\n✓ Plan generated in ${elapsedMs}ms`)
  console.log(`  Schema version:   ${plan.schema_version}`)
  console.log(`  Generated at:     ${plan._meta.generated_at}`)
  console.log(`  Input fingerprint: ${plan._meta.input_fingerprint}`)
  console.log(`  Classifications:  ${plan._meta.counts.classifications}`)
  console.log(`  WP objects:       ${plan._meta.counts.wp_objects}`)
  console.log(`  ACF field groups: ${plan._meta.counts.acf_field_groups}`)
  console.log(`  Open questions:   ${plan._meta.counts.open_questions}`)
  console.log(`  Low confidence:   ${plan._meta.counts.low_confidence}`)
  console.log(`\nFull plan written to:\n  ${outPath}`)

  // Quick per-WP-object breakdown so we can spot multi-campus + CPT
  // routing at a glance.
  console.log('\nWP objects:')
  for (const o of plan.layer_2_wp_objects) {
    if (o.kind === 'custom_post_type') {
      console.log(`  cpt:${o.slug.padEnd(8)}  headless=${o.headless ? 'yes' : 'no '}  single_template=${o.single_template.enabled ? 'yes' : 'no'}  archive=${o.archive.enabled ? 'yes' : 'no'}  tax=${o.taxonomies.length}  ${o.open_questions.length > 0 ? `❓×${o.open_questions.length}` : ''}`)
    } else if (o.kind === 'options_page') {
      console.log(`  opt:${o.slug.padEnd(14)} cols=${o.seeded_from_project_columns.length} ${o.open_questions.length > 0 ? `❓×${o.open_questions.length}` : ''}`)
    } else if (o.kind === 'repeater') {
      console.log(`  rep:${o.on_page_slug}/${o.field_group_ref}`)
    } else {
      console.log(`  ext:${o.id} mode=${o.display_mode}`)
    }
  }

  // Distribution of structures across Layer 1
  console.log('\nLayer 1 structure distribution:')
  const dist = new Map<string, number>()
  for (const c of plan.layer_1_classifications) {
    dist.set(c.structure, (dist.get(c.structure) ?? 0) + 1)
  }
  for (const [structure, count] of [...dist.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${structure.padEnd(28)} ${count}`)
  }
}

main().catch(err => { console.error(err); process.exit(1) })
