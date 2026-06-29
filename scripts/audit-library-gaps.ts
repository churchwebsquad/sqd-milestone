/* eslint-disable */
// Roll up build_time_issues from every partner's computed formation
// plan, group by template_id, write the report to
// handoffs/build-time-errors.md (the standing location for build-time
// issues the squad needs to action). Run after any code change that
// touches diagnosis to make sure issues surface as expected.
//
// Usage: npx tsx scripts/audit-library-gaps.ts

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'

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

const sb = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

// Fetch all web projects.
const { data: projects } = await sb
  .from('strategy_web_projects')
  .select('id, member, church_name')
  .order('member')

type Issue = {
  kind: 'library_coverage_gap' | 'upstream_compression_loss'
  partner: string
  member: number
  page_slug: string
  section_heading: string
  schema_name: string
  template_id: string | null
  dropped_fields: string[]
  severity: 'high' | 'medium' | 'low'
  fill_rate: number
}

const allIssues: Issue[] = []
const partnerCounts: Array<{ partner: string; member: number; sections: number; classified: number; issues: number }> = []

for (const p of (projects ?? []) as any[]) {
  let plan: any
  try {
    plan = await computeFormationPlan(p.id, sb)
  } catch {
    continue
  }
  const sections = (plan.discovery_sections ?? []) as any[]
  if (sections.length === 0) continue

  const classified = sections.filter(s => s.schema_name).length
  let partnerIssues = 0

  for (const s of sections) {
    for (const issue of (s.build_time_issues ?? [])) {
      const droppedFills = (s.schema_field_diagnostics ?? [])
        .filter((d: any) => issue.dropped_fields.includes(d.key))
        .reduce((sum: number, d: any) => sum + d.fill_count, 0)
      const totalPossible = issue.dropped_fields.length * Math.max(1, s.item_count)
      allIssues.push({
        kind:            issue.kind,
        partner:         p.church_name,
        member:          p.member,
        page_slug:       s.page_slug,
        section_heading: s.heading,
        schema_name:     issue.kind === 'upstream_compression_loss' ? issue.schema_name : s.schema_name,
        template_id:     issue.kind === 'library_coverage_gap' ? issue.template_id : null,
        dropped_fields:  issue.dropped_fields,
        severity:        issue.severity,
        fill_rate:       totalPossible > 0 ? droppedFills / totalPossible : 0,
      })
      partnerIssues++
    }
  }

  partnerCounts.push({ partner: p.church_name, member: p.member, sections: sections.length, classified, issues: partnerIssues })
}

// Partition by kind first — they need different rollups.
const libraryGaps  = allIssues.filter(i => i.kind === 'library_coverage_gap')
const upstreamLoss = allIssues.filter(i => i.kind === 'upstream_compression_loss')

const byTemplateSchema = new Map<string, Issue[]>()
for (const issue of libraryGaps) {
  const k = `${issue.template_id}::${issue.schema_name}`
  const list = byTemplateSchema.get(k) ?? []
  list.push(issue)
  byTemplateSchema.set(k, list)
}

// Upstream losses group by schema × dropped-field-set.
const bySchemaLoss = new Map<string, Issue[]>()
for (const issue of upstreamLoss) {
  const k = `${issue.schema_name}::${issue.dropped_fields.slice().sort().join(',')}`
  const list = bySchemaLoss.get(k) ?? []
  list.push(issue)
  bySchemaLoss.set(k, list)
}

// Read current build-time-errors.md so we can replace the
// "diagnostic-surfaced" section if it exists, else append.
const path = 'handoffs/build-time-errors.md'
const existing = existsSync(path) ? readFileSync(path, 'utf8') : ''

const lines: string[] = []
lines.push('## Diagnostic-surfaced library coverage gaps')
lines.push('')
lines.push(`**Last rolled up:** ${new Date().toISOString().slice(0, 10)} (run \`npx tsx scripts/audit-library-gaps.ts\` to refresh)`)
lines.push(`**Partners audited:** ${partnerCounts.length}`)
lines.push(`**Total discovery sections:** ${partnerCounts.reduce((s, p) => s + p.sections, 0)}`)
lines.push(`**Classified to canonical schema:** ${partnerCounts.reduce((s, p) => s + p.classified, 0)}`)
lines.push(`**Library coverage gaps (template):** ${libraryGaps.length}`)
lines.push(`**Upstream compression losses (cowork):** ${upstreamLoss.length}`)
lines.push('')

if (upstreamLoss.length > 0) {
  lines.push('### Upstream compression losses (cowork → bound)')
  lines.push('')
  lines.push('Fields present in `web_project_topics.items` source but absent from every bound section of the same schema. The loss happens at cowork\'s 5-slot uniform shape, BEFORE template binding. Unblocking these requires expanding cowork\'s per-concept output shape — separate from library coverage work.')
  lines.push('')
  const grouped = [...bySchemaLoss.entries()].sort((a, b) => b[1].length - a[1].length)
  for (const [key, issues] of grouped) {
    const [schemaName, droppedFieldsCsv] = key.split('::')
    const partners = new Set(issues.map(i => `${i.partner} (${i.member})`))
    const sections = issues.length
    const highSeverity = issues.filter(i => i.severity === 'high').length
    lines.push(`#### \`${schemaName}\` losing [${droppedFieldsCsv.split(',').map(f => `\`${f}\``).join(', ')}]`)
    lines.push(`- ${sections} bound section${sections === 1 ? '' : 's'} across ${partners.size} partner${partners.size === 1 ? '' : 's'}`)
    lines.push(`- Severity: ${highSeverity} high, ${issues.filter(i => i.severity === 'medium').length} medium, ${issues.filter(i => i.severity === 'low').length} low`)
    lines.push(`- Partners affected: ${[...partners].slice(0, 5).join(', ')}${partners.size > 5 ? ` …+${partners.size - 5}` : ''}`)
    lines.push('')
  }
}



if (libraryGaps.length === 0 && upstreamLoss.length === 0) {
  lines.push('### Current state: 0 gaps surfaced')
  lines.push('')
  lines.push('No bound-layer sections currently carry schema fields the template can\'t hold. ')
  lines.push('That **does not** mean the system is free of lossy bindings — it means cowork\'s ')
  lines.push('5-slot uniform shape compresses richer source fields upstream of the bound layer, ')
  lines.push('so the diagnostic-at-bound-layer can\'t see them.')
  lines.push('')
  lines.push('To surface real losses, we need an inventory-layer diagnostic that compares ')
  lines.push('`web_project_topics.items` source data against bound-layer output. Deferred ')
  lines.push('to v2 — see [concept-aware-extraction-proposal.md](concept-aware-extraction-proposal.md).')
  lines.push('')
} else if (libraryGaps.length > 0) {
  lines.push('### Library coverage gaps (template doesn\'t hold all schema fields)')
  lines.push('')
  const grouped = [...byTemplateSchema.entries()].sort((a, b) => b[1].length - a[1].length)
  for (const [key, issues] of grouped) {
    const [templateId, schemaName] = key.split('::')
    const allDroppedFields = new Set<string>()
    for (const issue of issues) for (const f of issue.dropped_fields) allDroppedFields.add(f)
    const partners = new Set(issues.map(i => `${i.partner} (${i.member})`))
    const highSeverity = issues.filter(i => i.severity === 'high').length
    lines.push(`#### \`${templateId}\` × \`${schemaName}\``)
    lines.push(`- ${issues.length} section${issues.length === 1 ? '' : 's'} across ${partners.size} partner${partners.size === 1 ? '' : 's'}`)
    lines.push(`- Dropped fields: ${[...allDroppedFields].map(f => `\`${f}\``).join(', ')}`)
    lines.push(`- Severity: ${highSeverity} high, ${issues.filter(i => i.severity === 'medium').length} medium, ${issues.filter(i => i.severity === 'low').length} low`)
    lines.push(`- Partners affected: ${[...partners].join(', ')}`)
    lines.push('')
  }
}

// Splice into build-time-errors.md
const marker = '## Diagnostic-surfaced library coverage gaps'
const newSection = lines.join('\n')
let updated: string
if (existing.includes(marker)) {
  // Replace from marker to end of file (this section is always last).
  const idx = existing.indexOf(marker)
  updated = existing.slice(0, idx).trimEnd() + '\n\n' + newSection + '\n'
} else {
  updated = existing.trimEnd() + '\n\n' + newSection + '\n'
}
writeFileSync(path, updated)
console.log(`✓ updated ${path}`)
console.log(`  partners audited: ${partnerCounts.length}`)
console.log(`  total sections:   ${partnerCounts.reduce((s, p) => s + p.sections, 0)}`)
console.log(`  classified:       ${partnerCounts.reduce((s, p) => s + p.classified, 0)}`)
console.log(`  gaps surfaced:    ${allIssues.length}`)
