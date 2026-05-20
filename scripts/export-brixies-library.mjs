// Export the Brixies catalog + curated library to a single JSON file
// for the copywriter skill to consume.
//
// Output: scripts/exports/brixies-library.json
//
// Usage:  npx tsx scripts/export-brixies-library.mjs
//
// Re-run any time templates change in DB (schemas, families, palette
// refs) or when LIBRARY_CONCEPTS changes in src/lib/webCuratedLibrary.ts.
// Commit the regenerated JSON so the skill always sees the latest shape.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { JSDOM } from 'jsdom'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.join(__dirname, '..')

function loadEnv() {
  for (const envFile of ['.env.local', '.env']) {
    const envPath = path.join(projectRoot, envFile)
    if (!fs.existsSync(envPath)) continue
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
      if (!m) continue
      if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
}
loadEnv()

// jsdom — augmentTemplate uses DOMParser to walk source_html.
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.DOMParser = dom.window.DOMParser
globalThis.Element = dom.window.Element
globalThis.Node = dom.window.Node
globalThis.NodeFilter = dom.window.NodeFilter

const { augmentTemplate } = await import('../src/lib/webBrixiesSchemaAugment.ts')
const { LIBRARY_CONCEPTS } = await import('../src/lib/webCuratedLibrary.ts')

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
)

const { data: templateRows, error } = await supabase
  .from('web_content_templates')
  .select('id, layer_name, family, kind, variant, preview_image_url, paired_post_template, paired_url_pattern, source_html, fields, is_published')
  .order('family', { ascending: true })
  .order('layer_name', { ascending: true })

if (error) {
  console.error('Failed to fetch templates:', error.message)
  process.exit(1)
}

// Augment each template (runs the schema augmenter so the exported
// fields reflect what the editor actually presents — palette-ref
// subtree dedup, CTA descendant skip, image-frame promotion, etc.).
const templates = templateRows.map(t => {
  // Augmenter requires `source_html`; templates without it get raw fields.
  if (!t.source_html) return { ...t, fields: t.fields ?? [] }
  try {
    const aug = augmentTemplate(t)
    return { ...t, fields: aug.fields }
  } catch (err) {
    console.error(`Augment failed for ${t.id}:`, err.message)
    return { ...t, fields: t.fields ?? [] }
  }
})

// Strip `source_html` from the export — copywriter doesn't need the
// rendered HTML, only the schema. Keeps the file small.
const slimTemplates = templates.map(t => {
  const { source_html: _drop, ...rest } = t
  void _drop
  return rest
})

// Curated concepts — re-emit verbatim with snake_case keys for the
// agent's convenience (skills are usually fed JSON-only context).
const curatedConcepts = LIBRARY_CONCEPTS.map(c => ({
  id: c.id,
  category: c.category,
  label: c.label,
  description: c.description,
  includes: c.includes,
  family_filter: c.familyFilter ?? null,
  kind_filter: c.kindFilter ?? null,
  max_picks: c.maxPicks,
  default_template_id: c.defaultTemplateId ?? null,
}))

const output = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  doc: {
    purpose:
      'Brixies template catalog + curated library for the copywriter skill. '
      + 'Drives field_values generation when the AI drafts a section.',
    field_kinds: {
      slot: 'A single editable field. Value type depends on `type`.',
      group: 'A repeatable list of items. Value is an array of objects, one per item, '
        + 'each containing keys defined in `item_schema`. Special shape for palette refs '
        + '(see palette_groups below).',
    },
    slot_types: {
      text: 'Plain string. Honor `max_chars`. May carry `heading_level` (h1..h6) — '
        + 'the renderer wraps the value in the matching tag.',
      richtext:
        'HTML string. Supports <p>, <strong>, <em>, <a href>, <ul>/<ol>/<li>. '
        + 'Honor `max_chars` against the plain-text length, not raw HTML.',
      cta: 'Button. Value shape: { label: string, url: string }.',
      image: 'Image. Value shape: { src: string, alt?: string }. The copywriter '
        + 'typically does NOT populate images — leave empty so the placeholder shows.',
      boolean: 'true | false. Toggles a visual variant on the section.',
      url:    'A URL string.',
      email:  'An email string.',
      phone:  'A phone string.',
      'form-input': 'A form field declaration. Rarely set by the copywriter — '
        + 'the renderer handles defaults.',
      datetime: 'ISO-8601 string.',
    },
    palette_groups: {
      detection:
        'A group with `item_template_ref: "from_palette"` and `referenced_family` '
        + '(usually "Card") is a PALETTE GROUP. Its `item_schema` is omitted because '
        + 'each item is rendered against the picked Card template\'s own `fields`.',
      value_shape:
        '{ __palette_template_id: string, items: Array<{ ...item-template fields }> }. '
        + 'Use the concept\'s `default_template_id` (or `referenced_template_id` on the '
        + 'group) when picking which Card variant the items render against.',
      example: {
        card: {
          __palette_template_id: 'card-213',
          items: [
            { heading_card: 'Sundays', description_card: '9am · 11am traditional · 6pm modern' },
            { heading_card: 'Wednesdays', description_card: '7pm midweek service' },
          ],
        },
      },
    },
    snippet_tokens:
      'Strings may contain `{{token}}` literals. The renderer resolves these against '
      + 'a project-level snippet map (church_short_name, primary_contact_first, etc.). '
      + 'Copywriter may emit tokens but is not required to — literal text is fine.',
    extras:
      'A section\'s field_values may include `__overflow_html` (freehand body stash) and '
      + '`__bind_report` (auto-bind diagnostics). Do not populate these — they\'re '
      + 'maintained by the binding flow.',
  },
  curated_concepts: curatedConcepts,
  templates: slimTemplates,
}

const outDir = path.join(projectRoot, 'scripts', 'exports')
fs.mkdirSync(outDir, { recursive: true })
const outPath = path.join(outDir, 'brixies-library.json')
fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8')

const bytes = fs.statSync(outPath).size
console.log('Wrote', outPath)
console.log('  templates:', slimTemplates.length)
console.log('  curated concepts:', curatedConcepts.length)
console.log('  size:', (bytes / 1024).toFixed(1), 'KB')
console.log('\nFamilies:')
const byFamily = new Map()
for (const t of slimTemplates) {
  byFamily.set(t.family, (byFamily.get(t.family) ?? 0) + 1)
}
for (const [family, count] of [...byFamily.entries()].sort((a, b) => b[1] - a[1])) {
  console.log('  ' + (family ?? '(none)') + ':', count)
}
