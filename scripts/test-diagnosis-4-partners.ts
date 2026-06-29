/* eslint-disable */
// Test harness for the content diagnosis pipeline. Runs
// computeFormationPlan against 4 partners (Doxology / First Pres /
// CDOBC / Arvada) and prints the discovery_sections rows that the
// classifier surfaced with a schema_name. Used to validate the
// classifier in-context before wiring the UI.
//
// Run with: npx tsx scripts/test-diagnosis-4-partners.ts
//
// Read-only — does NOT call saveFormationPlan. Does NOT touch
// roadmap_state. Pure diagnostic.

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'

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

const { computeFormationPlan } = await import('../src/lib/acfFormationPlan/index.js')

const PARTNERS = [
  { name: 'Doxology Bible Church',                       member: 1963, id: '4ef827f7-3e66-46d3-a4f6-26e1a744ddba' },
  { name: 'First Presbyterian Church of Charlotte',      member: 3249, id: '435ccbf9-f755-4460-ac1f-aa6a604d0482' },
  { name: 'Canyon Del Oro Bible Church',                 member: 3672, id: '4daed885-aeda-46c9-8b9a-b57e1e8b7a5c' },
  { name: 'Arvada Vineyard',                             member: 3734, id: '2eac7eb8-269d-4584-84a4-3dc9fdd6fcde' },
]

const sb = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

const outDir = 'handoffs/diagnosis-test-runs'
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })

for (const partner of PARTNERS) {
  console.log(`\n══════════════════════════════════════════════════════════`)
  console.log(`  ${partner.name} (member ${partner.member})`)
  console.log(`══════════════════════════════════════════════════════════\n`)

  let plan: any
  try {
    // skipLlm=true for the first run — validates inventory + comparator
    // path quickly. Re-run with skipLlm=false to layer in LLM verify +
    // fallback (slower, costs tokens).
    plan = await computeFormationPlan(partner.id, sb, { skipLlm: true })
  } catch (err) {
    console.log(`✗ computeFormationPlan failed: ${(err as Error).message}\n`)
    continue
  }

  const sections = (plan.discovery_sections ?? []) as any[]
  const inventoryRows = (plan.inventory_discovery ?? []) as any[]
  console.log(`Total bound discovery sections: ${sections.length}`)
  console.log(`Inventory concepts: ${inventoryRows.length}`)
  const upstreamLosses = sections.reduce((sum: number, s: any) => sum + (s.build_time_issues?.filter((i: any) => i.kind === 'upstream_compression_loss').length ?? 0), 0)
  if (upstreamLosses > 0) console.log(`🔴 Upstream compression losses: ${upstreamLosses}`)

  // Roll up by schema
  const bySchema: Record<string, number> = {}
  for (const s of sections) {
    const k = s.schema_name ?? '(unclassified)'
    bySchema[k] = (bySchema[k] ?? 0) + 1
  }
  console.log(`Schemas observed: ${Object.entries(bySchema).map(([k, n]) => `${k}=${n}`).join('  ')}\n`)

  // Per-page detail
  const byPage = new Map<string, any[]>()
  for (const s of sections) {
    const list = byPage.get(s.page_slug) ?? []
    list.push(s)
    byPage.set(s.page_slug, list)
  }

  const buildIssues: any[] = []
  const lines: string[] = []
  lines.push(`# Diagnosis test run — ${partner.name} (${partner.member})`)
  lines.push('')
  lines.push(`Generated: ${plan._meta.generated_at}`)
  lines.push(`Total discovery sections: ${sections.length}`)
  lines.push(`Schemas: ${Object.entries(bySchema).map(([k, n]) => `${k}=${n}`).join(', ')}`)
  lines.push('')

  for (const [slug, list] of [...byPage.entries()].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`## /${slug} · ${list.length} section${list.length === 1 ? '' : 's'}`)
    lines.push('')
    for (const s of list) {
      lines.push(`**${s.heading}**`)
      lines.push(`- ${s.item_count} item${s.item_count === 1 ? '' : 's'}`)
      if (s.schema_name) {
        lines.push(`- schema: \`${s.schema_name}\` (${s.schema_confidence})`)
      } else {
        lines.push(`- schema: (unclassified)`)
      }
      lines.push(`- template: \`${s.cpt_subroutine_ref ? '(CPT-bound) ' : ''}\` target: ${s.target_hint}`)
      if (s.cta_target_breakdown && Object.keys(s.cta_target_breakdown).length > 0) {
        lines.push(`- cta: ${JSON.stringify(s.cta_target_breakdown)}`)
      }
      if (s.schema_field_diagnostics) {
        const dropped = s.schema_field_diagnostics.filter((d: any) => !d.in_bound_template && d.fill_count > 0)
        const present = s.schema_field_diagnostics.filter((d: any) => d.in_bound_template)
        if (present.length > 0) {
          lines.push(`- in template: ${present.map((d: any) => `${d.key}=${d.fill_count}/${d.fill_total}`).join('  ')}`)
        }
        if (dropped.length > 0) {
          lines.push(`- ⚠ dropped at render: ${dropped.map((d: any) => `${d.key}=${d.fill_count}/${d.fill_total}`).join('  ')}`)
        }
      }
      if (s.build_time_issues && s.build_time_issues.length > 0) {
        for (const issue of s.build_time_issues) {
          if (issue.kind === 'upstream_compression_loss') {
            lines.push(`- ⚠ upstream_compression_loss on schema \`${issue.schema_name}\` — dropped: ${issue.dropped_fields.join(', ')} (${issue.severity})`)
          } else {
            lines.push(`- 🔴 library_coverage_gap on \`${issue.template_id}\` — dropped: ${issue.dropped_fields.join(', ')} (${issue.severity})`)
          }
          buildIssues.push({ partner: partner.name, member: partner.member, page: slug, ...issue })
        }
      }
      if (s.partner_context) {
        const pc = s.partner_context
        lines.push(`- partner context: ${pc.content_kind}, display=\`${pc.display_preference}\`${pc.external_url ? `, external=${pc.external_url}` : ''}`)
      }
      lines.push('')
    }
  }

  const outPath = `${outDir}/${partner.member}-${partner.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`
  writeFileSync(outPath, lines.join('\n'))
  console.log(`✓ wrote ${outPath}`)

  // Append inventory concepts to the markdown so we can SEE them.
  if (inventoryRows.length > 0) {
    lines.push('---')
    lines.push('')
    lines.push(`## Inventory-layer discovery (${inventoryRows.length} concepts)`)
    lines.push('')
    lines.push('Pre-binding diagnostic — what schemas the partner HAS in source even if no bound section exists yet.')
    lines.push('')
    for (const inv of inventoryRows) {
      lines.push(`**${inv.heading}** (topic: \`${inv.section_id}\`)`)
      lines.push(`- ${inv.item_count} items (of ${inv.total_topic_items} total in topic), dominant kind: \`${inv.dominant_kind ?? '?'}\``)
      if (inv.schema_name) lines.push(`- diagnosed: \`${inv.schema_name}\` (${inv.schema_confidence})`)
      else lines.push(`- diagnosed: (unclassified)`)
      const itemKeys = (inv.schema_field_diagnostics ?? []).filter((d: any) => d.fill_count > 0).map((d: any) => `${d.key}=${d.fill_count}/${d.fill_total}`)
      if (itemKeys.length > 0) lines.push(`- fields with data: ${itemKeys.join('  ')}`)
      lines.push('')
    }
    writeFileSync(outPath, lines.join('\n'))
  }

  // Console summary
  const issueCount = buildIssues.length
  console.log(`Build-time issues surfaced: ${issueCount}`)
  if (issueCount > 0) {
    for (const issue of buildIssues.slice(0, 5)) {
      if (issue.kind === 'upstream_compression_loss') {
        console.log(`  ⚠ ${issue.page} · schema=${issue.schema_name} · dropped: ${issue.dropped_fields.join(', ')} (${issue.severity})`)
      } else {
        console.log(`  🔴 ${issue.page} · ${issue.template_id} · dropped: ${issue.dropped_fields.join(', ')} (${issue.severity})`)
      }
    }
    if (issueCount > 5) console.log(`  …+${issueCount - 5} more`)
  }
}

console.log('\nDone.\n')
