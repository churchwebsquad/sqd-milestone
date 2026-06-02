// One-off: restore web_content_templates.fields from the exported
// brixies-library.json. The recent re-import correctly captured the
// canonical source_html (multi-image siblings, etc.) but its
// schema-generation pass regressed on templates like Feature
// section 66 — collapsing previously-hoisted tab + tab_button into
// nested single_instance groups. The brixies-library.json export
// represents the schema state that the renderer's
// preprocessNestedTopLevelGroups / Feature-66 fan-out logic was
// designed for. Restore those fields without touching source_html.
//
// Usage:
//   node scripts/restore-template-schemas.mjs
//
// Idempotent — re-running upserts in place.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LIBRARY = path.join(__dirname, 'exports/brixies-library.json')

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

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(url, key)
const lib = JSON.parse(fs.readFileSync(LIBRARY, 'utf-8'))
const templates = lib.templates

let updated = 0
let skipped = 0
let errors = 0

for (const t of templates) {
  const name = t.layer_name
  if (!name) { skipped++; continue }
  // Only restore fields when the exported library actually carries
  // them — defensively skip empty arrays so we don't blow away a
  // freshly-augmented schema with nothing.
  const fields = Array.isArray(t.fields) ? t.fields : null
  if (!fields || fields.length === 0) { skipped++; continue }

  const { error } = await supabase
    .from('web_content_templates')
    .update({ fields })
    .eq('layer_name', name)
  if (error) {
    console.error(`[FAIL] ${name}: ${error.message}`)
    errors++
  } else {
    updated++
  }
}

console.log(`\nRestored ${updated} template schemas (${skipped} skipped, ${errors} errors).`)
