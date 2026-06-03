// Comprehensive schema rebuild for every Brixies template.
//
// The recent "clean over-augmenter overreach" pass deleted too much —
// legitimate per-item text slots disappeared alongside the phantom
// duplicates. The DB now has groups with empty item_schemas where
// real bullet-item / feature-item / card-item text inputs used to be.
//
// This script reads each template's source_html, re-runs the canonical
// walkNode parser from import-brixies-catalog.mjs against that HTML,
// and writes the fresh `fields` schema back. The injected `buttons`
// field from inject-cta-row.mjs is preserved when present (its marker
// in source_html means walkNode will re-derive it naturally).
//
// Idempotent. Safe to re-run. Reports per-template diffs.
//
// Usage:
//   node scripts/rebuild-schemas-from-source-html.mjs            # all
//   node scripts/rebuild-schemas-from-source-html.mjs --layer "Content Section 16"
//   node scripts/rebuild-schemas-from-source-html.mjs --dry      # no writes

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseHtml } from 'node-html-parser'
import { createClient } from '@supabase/supabase-js'
import { loadTaxonomy, walkNode } from './import-brixies-catalog.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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

const args = process.argv.slice(2)
const layerFilter = args.includes('--layer') ? args[args.indexOf('--layer') + 1] : null
const dryRun = args.includes('--dry')

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
const supabase = createClient(url, key)
const taxonomy = loadTaxonomy()

let query = supabase
  .from('web_content_templates')
  .select('id, layer_name, source_html, fields')
if (layerFilter) query = query.eq('layer_name', layerFilter)

const { data: templates, error } = await query
if (error) { console.error(error.message); process.exit(1) }

console.log(`Rebuilding schemas for ${templates.length} templates (dry=${dryRun})...`)

let updated = 0, unchanged = 0, errors = 0

function summarizeFields(fields, indent = 0) {
  if (!Array.isArray(fields)) return ''
  return fields.map(f => {
    const pad = ' '.repeat(indent)
    if (f.kind === 'slot') return `${pad}- ${f.key} (slot:${f.type})`
    const inner = summarizeFields(f.item_schema, indent + 2)
    return `${pad}- ${f.key} (group ×${f.default_count})\n${inner}`
  }).join('\n')
}

for (const t of templates) {
  if (!t.source_html) { unchanged++; continue }
  try {
    const root = parseHtml(t.source_html)
    const section = root.firstChild
    if (!section || !section.tagName) { unchanged++; continue }
    const layerName = section.getAttribute('data-layer') ?? t.layer_name
    const discovery = { unknownLayers: new Map(), filesProcessed: 0, emptyFiles: [] }
    const fields = walkNode(section, taxonomy, [layerName], discovery)

    if (!fields || fields.length === 0) {
      console.log(`[SKIP] ${t.layer_name}: walkNode produced no fields`)
      unchanged++
      continue
    }

    const beforeJson = JSON.stringify(t.fields)
    const afterJson = JSON.stringify(fields)
    if (beforeJson === afterJson) { unchanged++; continue }

    if (layerFilter) {
      console.log(`\n── ${t.layer_name} ──`)
      console.log('BEFORE:')
      console.log(summarizeFields(t.fields))
      console.log('AFTER:')
      console.log(summarizeFields(fields))
    }

    if (!dryRun) {
      const { error: updErr } = await supabase
        .from('web_content_templates')
        .update({ fields })
        .eq('id', t.id)
      if (updErr) { console.error(`[FAIL] ${t.layer_name}: ${updErr.message}`); errors++; continue }
    }
    updated++
  } catch (e) {
    console.error(`[FAIL] ${t.layer_name}: ${e.message}`)
    errors++
  }
}

console.log(`\n${dryRun ? '[DRY] Would update' : 'Updated'} ${updated}, ${unchanged} unchanged, ${errors} errors`)
