// Systematic schema sweep — applies a fixed set of safe transforms
// across every Brixies template. The earlier `clean-augmenter-overreach`
// script was too aggressive (deleted legitimate nested heading/
// description slots alongside the phantom duplicates). This pass is
// narrower and reversible:
//
//   1. RENAME slots whose key or layer_name reads as lorem-ipsum
//      placeholder text. Preserves the slot as editable but gives it
//      a semantic key (`text`) and a clean label so the strategist
//      knows what to type. Content 83's
//      `lorem_ipsum_dolor_sit_amet` → `text`, label "Item text".
//
//   2. DROP NESTED tagline slots only. Tagline is conceptually a
//      section-level eyebrow per the user's guidance — items inside
//      cards / bullets / features should not carry their own tagline.
//      Top-level taglines are untouched.
//
//   3. DEDUPE top-level field keys. When the same key appears twice
//      (slot + group), keep the slot and rename the group to
//      `<key>_items`. Pure rename — no data loss.
//
//   4. ENSURE top-level heading + description slots when the source
//      HTML contains those layers but the schema doesn't. Catches
//      templates where the library schema only emits `image` because
//      the heading lives nested inside an Image-bg div.
//
// Idempotent and dry-run friendly:
//   node scripts/sweep-schemas-systemic-fixes.mjs --dry     # report
//   node scripts/sweep-schemas-systemic-fixes.mjs           # apply

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseHtml } from 'node-html-parser'
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

const args = process.argv.slice(2)
const dryRun = args.includes('--dry')

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(url, key)

const LOREM_TOKENS = /lorem|ipsum|consectetur|adipisicing|adipiscing|aliqua|eiusmod|tempor|incididunt|cupidatat|nostrud|laudantium|veniam|exercitation|laboris/i

function looksLorem(s) {
  if (!s) return false
  return LOREM_TOKENS.test(String(s))
}

// Rule 1 + 2 applied recursively to a single field.
function transformField(f, isTopLevel) {
  if (!f || typeof f !== 'object') return f
  // Rule 1: rename lorem-keyed slots.
  if (f.kind === 'slot' && (looksLorem(f.key) || looksLorem(f.layer_name))) {
    const renamed = {
      ...f,
      key: 'text',
      layer_name: f.layer_name && !looksLorem(f.layer_name) ? f.layer_name : 'Item text',
      label: f.label ?? 'Item text',
    }
    return renamed
  }
  // Rule 2: at NESTED level, drop tagline slots.
  if (!isTopLevel && f.kind === 'slot' && f.key === 'tagline') return null
  // Recurse into group's item_schema.
  if (f.kind === 'group' && Array.isArray(f.item_schema)) {
    const next = []
    for (const child of f.item_schema) {
      const transformed = transformField(child, false)
      if (transformed) next.push(transformed)
    }
    return { ...f, item_schema: next }
  }
  return f
}

// Rule 3: top-level dedupe.
function dedupeTopLevel(fields) {
  const seen = new Map()
  const out = []
  for (const f of fields) {
    if (!seen.has(f.key)) { seen.set(f.key, out.length); out.push(f); continue }
    const firstIdx = seen.get(f.key)
    const first = out[firstIdx]
    if (first.kind === 'slot' && f.kind === 'group') {
      const renamed = { ...f, key: `${f.key}_items` }
      seen.set(renamed.key, out.length)
      out.push(renamed)
    } else if (first.kind === 'group' && f.kind === 'slot') {
      const renamedFirst = { ...first, key: `${first.key}_items` }
      out[firstIdx] = renamedFirst
      seen.delete(first.key)
      seen.set(renamedFirst.key, firstIdx)
      seen.set(f.key, out.length)
      out.push(f)
    }
    // Same-kind duplicates: drop the second.
  }
  return out
}

// Rule 4: ensure top-level heading + description slots when source has them.
function ensureTopLevelSlotsFromSource(fields, sourceHtml) {
  if (!sourceHtml) return fields
  try {
    const root = parseHtml(sourceHtml)
    // Helper: does ANY element in the tree carry the data-layer name?
    const findByLayer = (name) => {
      const stack = [root]
      while (stack.length) {
        const node = stack.pop()
        if (!node?.childNodes) continue
        for (const c of node.childNodes) {
          if (!c.tagName) continue
          if ((c.getAttribute?.('data-layer') ?? '').trim() === name) return c
          stack.push(c)
        }
      }
      return null
    }
    const hasKey = (k) => fields.some(f => f.key === k)
    const out = [...fields]
    if (findByLayer('Heading') && !hasKey('heading')) {
      out.unshift({
        key: 'heading', kind: 'slot', type: 'text', required: true,
        max_chars: 100, layer_name: 'Heading', heading_level: 2,
      })
    }
    if (findByLayer('Description') && !hasKey('description')) {
      // Insert AFTER heading to keep natural reading order.
      const idx = out.findIndex(f => f.key === 'heading')
      const descField = {
        key: 'description', kind: 'slot', type: 'richtext',
        max_chars: 400, layer_name: 'Description',
      }
      if (idx >= 0) out.splice(idx + 1, 0, descField)
      else out.push(descField)
    }
    if (findByLayer('Tagline') && !hasKey('tagline')) {
      out.unshift({
        key: 'tagline', kind: 'slot', type: 'text',
        max_chars: 60, layer_name: 'Tagline',
      })
    }
    return out
  } catch {
    return fields
  }
}

const { data: templates, error } = await supabase
  .from('web_content_templates')
  .select('id, layer_name, source_html, fields')
if (error) { console.error(error.message); process.exit(1) }

console.log(`Sweeping ${templates.length} templates (dry=${dryRun})...`)

let updated = 0, unchanged = 0, errors = 0
const changes = []

for (const t of templates) {
  if (!Array.isArray(t.fields)) { unchanged++; continue }
  const before = JSON.stringify(t.fields)

  // Apply rules 1 + 2 to every top-level field.
  let fields = t.fields
    .map(f => transformField(f, true))
    .filter(Boolean)
  // Rule 3
  fields = dedupeTopLevel(fields)
  // Rule 4
  fields = ensureTopLevelSlotsFromSource(fields, t.source_html)

  const after = JSON.stringify(fields)
  if (before === after) { unchanged++; continue }

  changes.push({ layer: t.layer_name, before: t.fields, after: fields })

  if (!dryRun) {
    const { error: updErr } = await supabase
      .from('web_content_templates')
      .update({ fields })
      .eq('id', t.id)
    if (updErr) { console.error(`[FAIL] ${t.layer_name}: ${updErr.message}`); errors++; continue }
  }
  updated++
}

console.log(`\n${dryRun ? '[DRY] Would update' : 'Updated'} ${updated}, ${unchanged} unchanged, ${errors} errors`)
if (dryRun && changes.length > 0) {
  console.log(`\nFirst 5 changes:`)
  for (const c of changes.slice(0, 5)) {
    console.log(`  ${c.layer}: keys ${c.before.map(f => f.key).join(',')} -> ${c.after.map(f => f.key).join(',')}`)
  }
}
