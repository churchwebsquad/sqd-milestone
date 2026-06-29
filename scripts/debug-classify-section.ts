/* eslint-disable */
// Debug a single web_section's classification. Loads the section's
// bound state, projects items, calls classifySchema with debug=true,
// dumps the full score table per candidate schema so we can see what
// signal the classifier is missing.
//
// Usage: npx tsx scripts/debug-classify-section.ts <section_id>

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

const { classifySchema } = await import('../src/lib/acfFormationPlan/classifySchema.js')

const sectionId = process.argv[2]
if (!sectionId) {
  console.error('Usage: npx tsx scripts/debug-classify-section.ts <section_id>')
  process.exit(1)
}

const sb = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

const { data: section, error } = await sb
  .from('web_sections')
  .select('id, section_role, content_template_id, field_values, web_page_id')
  .eq('id', sectionId)
  .single()
if (error || !section) { console.error(error); process.exit(1) }

const { data: page } = await sb
  .from('web_pages')
  .select('slug, name')
  .eq('id', section.web_page_id)
  .single()

const { data: template } = await sb
  .from('web_content_templates')
  .select('id, fields')
  .eq('id', section.content_template_id)
  .single()

if (!template) { console.error('Template not found'); process.exit(1) }

// Load referenced templates (matches sources.ts pass 5b)
const { data: allTemplates } = await sb
  .from('web_content_templates')
  .select('id, fields')
const templatesById = new Map((allTemplates as any[]).map(t => [t.id, t]))

// Mimic analyzeSectionItems WITH referenced-template resolution
function resolveItemSchema(group: any): any[] {
  if (Array.isArray(group.item_schema) && group.item_schema.length > 0) return group.item_schema
  if (!group.referenced_template_id) return []
  const refT = templatesById.get(group.referenced_template_id)
  return refT?.fields ?? []
}
function drill(group: any, arr: any[]): { items: any[]; schema: string[] } {
  const itemSchema = resolveItemSchema(group)
  const slotFields = itemSchema.filter((f: any) => f.kind === 'slot')
  const nested = itemSchema.filter((f: any) => f.kind === 'group')
  // Match production: only descend when level has no slot fields.
  if (nested.length > 0 && slotFields.length === 0) {
    const leaves: any[] = []
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue
      for (const ng of nested) {
        const subArr = item[ng.key]
        if (Array.isArray(subArr) && subArr.length > 0) {
          const recursed = drill(ng, subArr)
          leaves.push(...recursed.items)
        }
      }
    }
    if (leaves.length > 0) {
      const leafSchema = resolveItemSchema(nested[0]).filter((f: any) => f.kind === 'slot').map((f: any) => f.key)
      return { items: leaves, schema: leafSchema }
    }
  }
  const items = arr.filter((x: any) => x && typeof x === 'object' && !Array.isArray(x))
  const schema = itemSchema.filter((f: any) => f.kind === 'slot').map((f: any) => f.key)
  return { items, schema }
}
const fields = template.fields as any[]
const fv = (section.field_values as Record<string, any>) ?? {}

console.log(`Section ${section.id}`)
console.log(`Page: ${page?.slug ?? '?'} (${page?.name ?? '?'})`)
console.log(`section_role: ${section.section_role ?? 'null'}`)
console.log(`template: ${template.id}`)
console.log(`template fields:`, fields.map((f: any) => `${f.kind}:${f.key}`).join(', '))
console.log(`field_values top-level keys:`, Object.keys(fv).join(', '))

// Find primary group + drill with referenced-template resolution
let projectedItems: any[] = []
let schemaKeys: string[] = []
for (const def of fields) {
  if (def.kind !== 'group') continue
  const arr = fv[def.key]
  if (!Array.isArray(arr) || arr.length === 0) continue
  const drilled = drill(def, arr)
  if (drilled.items.length === 0) continue
  schemaKeys = drilled.schema
  // Project
  projectedItems = drilled.items.map((item: any) => {
    const out: Record<string, any> = {}
    for (const key of schemaKeys) {
      const v = item?.[key]
      if (v == null) { out[key] = null; continue }
      if (typeof v === 'object' && !Array.isArray(v)) {
        const nested = v as Record<string, any>
        if (typeof nested.url === 'string' || typeof nested.label === 'string') {
          if (typeof nested.label === 'string' && nested.label) out[`${key}_label`] = nested.label
          if (typeof nested.url   === 'string' && nested.url)   out[`${key}_url`]   = nested.url
          if (typeof nested.kind  === 'string')                 out[`${key}_kind`]  = nested.kind
          continue
        }
        out[key] = v
        continue
      }
      out[key] = v
    }
    return out
  })
  break
}
console.log(`projected items: ${projectedItems.length}`)
console.log(`schema keys: ${schemaKeys.join(', ')}`)
console.log(`first item keys: ${Object.keys(projectedItems[0] ?? {}).join(', ')}`)
console.log(`first item:`, JSON.stringify(projectedItems[0] ?? {}, null, 2).slice(0, 400))

const heading = (fv.primary_heading || fv.heading || fv.title || '(unnamed)') as string

const result = classifySchema({
  page_slug:           page?.slug ?? '',
  heading,
  section_role:        section.section_role,
  items:               projectedItems,
  template_field_keys: schemaKeys,
  template_id:         section.content_template_id ?? '?',
}, { debug: true })

console.log(`\n── Classification ──`)
console.log(`schema:     ${result.schema_name ?? '(null)'}  [${result.schema_confidence}]`)
console.log(`\nTop 8 scores:`)
for (const s of result._debug_scores!.slice(0, 8)) {
  console.log(`  ${s.schema.padEnd(28)} score=${s.score}  reasons=[${s.reasons.join(', ')}]`)
}
console.log(`\nfield diagnostics:`)
for (const d of result.schema_field_diagnostics) {
  console.log(`  ${d.key.padEnd(25)} ${d.fill_count}/${d.fill_total}  in_template=${d.in_bound_template}`)
}
console.log(`cta breakdown:`, result.cta_target_breakdown)
console.log(`build_time_issues:`, result.build_time_issues)
