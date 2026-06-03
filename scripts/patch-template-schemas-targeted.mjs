// Targeted per-template schema patches for templates the library
// export ships with quirks the strategist hit head-on:
//
//   • Content Section 73 — library schema is just `image`; source HTML
//     has Heading + Description inside a Card inside an Image-bg div.
//     Add top-level heading + description slots.
//
//   • Content Section 16 — `description` GROUP item_schema is
//     [tagline, heading]; bullet items conceptually carry a single
//     description text. Replace with [{ key: 'text', kind: 'slot',
//     type: 'richtext', layer_name: 'Description' }].
//
//   • Content Section 83 — `card` group item_schema carries a
//     `lorem_ipsum_dolor_sit_amet` slot (placeholder text was captured
//     as the layer name) and redundant tagline/description copies of
//     section-level slots. Rename the placeholder slot to `text` and
//     drop the redundant pairs.

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
if (!url || !key) { console.error('Missing env'); process.exit(1) }
const supabase = createClient(url, key)

async function fetch(layerName) {
  const { data, error } = await supabase
    .from('web_content_templates')
    .select('id, fields')
    .eq('layer_name', layerName)
    .single()
  if (error) throw new Error(`${layerName}: ${error.message}`)
  return data
}

async function update(id, fields) {
  const { error } = await supabase
    .from('web_content_templates')
    .update({ fields })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

// ── Content Section 73 ─────────────────────────────────────────────
{
  const t = await fetch('Content Section 73')
  const has = (key) => t.fields.some(f => f.key === key)
  const fields = [...t.fields]
  if (!has('heading')) {
    fields.push({
      key: 'heading', kind: 'slot', type: 'text', required: true,
      max_chars: 100, layer_name: 'Heading', heading_level: 2,
    })
  }
  if (!has('description')) {
    fields.push({
      key: 'description', kind: 'slot', type: 'richtext',
      max_chars: 400, layer_name: 'Description',
    })
  }
  await update(t.id, fields)
  console.log('Content Section 73: ensured heading + description top-level slots')
}

// ── Content Section 16 ─────────────────────────────────────────────
{
  const t = await fetch('Content Section 16')
  const fields = t.fields.map(f => {
    if (f.kind === 'group' && f.key === 'description') {
      return {
        ...f,
        item_schema: [{
          key: 'text', kind: 'slot', type: 'richtext',
          max_chars: 400, layer_name: 'Description',
        }],
      }
    }
    return f
  })
  await update(t.id, fields)
  console.log('Content Section 16: description group item_schema → [{text}]')
}

// ── Content Section 83 ─────────────────────────────────────────────
{
  const t = await fetch('Content Section 83')
  const fields = t.fields.map(f => {
    if (f.kind === 'group' && f.key === 'card') {
      const innerItemSchema = f.item_schema
        .filter(s => {
          // Drop redundant top-level concepts.
          if (s.kind === 'slot' && (s.key === 'tagline' || s.key === 'description' || s.key === 'button_label')) return false
          return true
        })
        .map(s => {
          // Recursively patch item_feature.
          if (s.kind === 'group' && s.key === 'item_feature') {
            return {
              ...s,
              item_schema: [{
                key: 'text', kind: 'slot', type: 'text',
                max_chars: 100, layer_name: 'Item feature',
              }],
            }
          }
          return s
        })
      return { ...f, item_schema: innerItemSchema }
    }
    return f
  })
  await update(t.id, fields)
  console.log('Content Section 83: card → drop tagline/desc/button_label, item_feature.item_schema → [{text}]')
}
