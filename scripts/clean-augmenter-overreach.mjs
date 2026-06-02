// One-off: clean up over-augmented schemas across all
// web_content_templates.
//
// The auto-import + augmenter pass has been adding redundant slots to
// nested item_schemas, producing the symptoms the user is seeing:
//
//   • Content 16: a top-level `description` slot AND a sibling
//     `description` group whose item_schema is [tagline, heading].
//     The bullet items are pulling in Tagline + Heading slots that
//     duplicate the section-level fields and have no editable text
//     of their own.
//
//   • Content 83: the `card` group's item_schema carries its own
//     `tagline`, `description`, `button_label` slots that duplicate
//     the section-level fields. Plus an `item_feature` sub-group with
//     a slot literally named `lorem_ipsum_dolor_sit_amet` — that's a
//     placeholder caption Brixies ships, captured as if it were a
//     real layer name.
//
// Rules applied:
//
//   1. Drop any slot in a NESTED item_schema whose layer_name (or key)
//      matches a TOP-LEVEL field's layer/key. Tagline, heading,
//      description, contact (button_label) belong to the section as a
//      whole — items shouldn't get phantom copies.
//
//   2. Drop any slot whose key or layer_name reads as Lorem-ipsum
//      placeholder text (≥3 words, contains "lorem" / "ipsum" /
//      "consectetur" / "adipisicing" / etc.). These are literal
//      placeholder captions Brixies ships, never real layer concepts.
//
//   3. Resolve duplicate TOP-LEVEL field keys by keeping the first
//      occurrence and dropping later duplicates. Content 16's
//      `description` slot wins; the `description` group is renamed
//      `description_items` so it stays addressable but doesn't clash.
//
// Idempotent — re-running is a no-op once the schema is clean.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

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

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
const supabase = createClient(url, key)

const LOREM_TOKENS = /\b(lorem|ipsum|consectetur|adipisicing|adipiscing|aliqua|eiusmod|tempor|incididunt|fugiat|nostrud|irure|cupidatat)\b/i

function normalize(s) {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '').trim()
}

function isLoremSlot(field) {
  const text = `${field.key ?? ''} ${field.layer_name ?? ''}`
  if (LOREM_TOKENS.test(text)) return true
  // Multi-word "layer names" that are 3+ words long and contain
  // generic placeholder words are usually entire lorem captions.
  const wc = (field.layer_name ?? '').trim().split(/\s+/).length
  if (wc >= 4) return true
  return false
}

function cleanItemSchema(itemSchema, topLevelLayers, topLevelKeys) {
  if (!Array.isArray(itemSchema)) return itemSchema
  const seenKeys = new Set()
  const out = []
  for (const f of itemSchema) {
    if (!f || typeof f !== 'object') continue
    // Skip lorem-shaped slots/groups.
    if (isLoremSlot(f)) continue
    // Skip slots that mirror top-level concepts (tagline / heading /
    // description / contact (button_label) live on the section, not
    // on each item).
    const layer = normalize(f.layer_name ?? f.key)
    const key = normalize(f.key)
    if (topLevelLayers.has(layer) || topLevelKeys.has(key)) {
      // Allow when the field is a GROUP that legitimately repeats
      // (e.g. nested buttons group). The collision rule applies to
      // SLOTS only — groups can share keys across levels.
      if (f.kind === 'slot') continue
    }
    // Recurse into group's item_schema.
    let next = f
    if (f.kind === 'group' && Array.isArray(f.item_schema)) {
      next = { ...f, item_schema: cleanItemSchema(f.item_schema, topLevelLayers, topLevelKeys) }
    }
    // Avoid duplicate keys within the same item_schema.
    let uniqueKey = next.key
    let i = 2
    while (seenKeys.has(uniqueKey)) uniqueKey = `${next.key}_${i++}`
    if (uniqueKey !== next.key) next = { ...next, key: uniqueKey }
    seenKeys.add(uniqueKey)
    out.push(next)
  }
  return out
}

function dedupTopLevel(fields) {
  if (!Array.isArray(fields)) return fields
  const seen = new Map() // key → first index
  const out = []
  for (const f of fields) {
    if (!f || typeof f !== 'object') continue
    if (isLoremSlot(f)) continue
    if (!seen.has(f.key)) {
      seen.set(f.key, out.length)
      out.push(f)
      continue
    }
    // Duplicate key. Prefer the SLOT over the GROUP for a top-level
    // semantic concept (description-slot is the section body; a
    // description-group whose items are bullets should be renamed).
    const firstIdx = seen.get(f.key)
    const first = out[firstIdx]
    if (first.kind === 'slot' && f.kind === 'group') {
      const renamed = { ...f, key: `${f.key}_items` }
      seen.set(renamed.key, out.length)
      out.push(renamed)
    } else if (first.kind === 'group' && f.kind === 'slot') {
      // Promote the slot to keep, rename the existing group.
      const renamed = { ...first, key: `${first.key}_items` }
      out[firstIdx] = renamed
      seen.delete(first.key)
      seen.set(renamed.key, firstIdx)
      seen.set(f.key, out.length)
      out.push(f)
    } else {
      // Same kind on both — keep the first, drop the second.
    }
  }
  return out
}

const { data: templates, error } = await supabase
  .from('web_content_templates')
  .select('id, layer_name, fields')

if (error) { console.error(error.message); process.exit(1) }

let updated = 0
let unchanged = 0
let errors = 0

for (const t of templates) {
  const original = JSON.stringify(t.fields)
  let fields = dedupTopLevel(t.fields)

  // Build top-level layer / key sets to filter nested item_schemas.
  const topLayers = new Set()
  const topKeys = new Set()
  for (const f of fields) {
    const layer = normalize(f.layer_name ?? f.key)
    const key = normalize(f.key)
    if (layer) topLayers.add(layer)
    if (key) topKeys.add(key)
  }

  // Recurse into every group's item_schema.
  fields = fields.map(f => {
    if (f.kind !== 'group' || !Array.isArray(f.item_schema)) return f
    return { ...f, item_schema: cleanItemSchema(f.item_schema, topLayers, topKeys) }
  })

  if (JSON.stringify(fields) === original) { unchanged++; continue }

  const { error: updErr } = await supabase
    .from('web_content_templates')
    .update({ fields })
    .eq('id', t.id)
  if (updErr) {
    console.error(`[FAIL] ${t.layer_name}: ${updErr.message}`)
    errors++
  } else {
    updated++
  }
}

console.log(`\nCleaned ${updated} schemas (${unchanged} already clean, ${errors} errors).`)
