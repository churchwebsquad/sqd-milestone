// Remove redundant button_label slots from groups that also have a
// CTA slot pointing at the button's wrapper layer. The original
// importer captured both:
//   - cta slot, layer="Button"   (wrapper, handles label + url via applyCta)
//   - text slot, scope="button", layer="Contact"   (the label inside)
// The CTA slot already covers the label (its applyCta now writes to
// the deepest text-bearing leaf, preserving the inner styled wrapper).
// The text slot is redundant and clutters the editor with two fields
// for the same button.
//
// Usage:
//   node scripts/dedupe-button-slots.mjs            # dry-run
//   node scripts/dedupe-button-slots.mjs --apply

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

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

const args = process.argv.slice(2)
const apply = args.includes('--apply')

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
)

function isButtonCtaSlot(f) {
  return f && f.kind === 'slot' && f.type === 'cta'
    && /button/i.test(f.layer_name ?? '')
}
function isButtonTextSlot(f) {
  return f && f.kind === 'slot' && f.scope === 'button' && f.type === 'text'
}

function dedupeSchemaList(list) {
  if (!Array.isArray(list)) return { list: [], removed: 0 }
  // Within a single item_schema (or top-level fields), if there's a
  // button CTA slot AND a button text slot, drop the text slot.
  const hasButtonCta = list.some(isButtonCtaSlot)
  const hasButtonText = list.some(isButtonTextSlot)
  let removed = 0
  let out = list
  if (hasButtonCta && hasButtonText) {
    out = list.filter(f => {
      if (isButtonTextSlot(f)) {
        removed++
        return false
      }
      return true
    })
  }
  // Recurse into nested groups
  const recursed = out.map(f => {
    if (f.kind !== 'group') return f
    const sub = dedupeSchemaList(f.item_schema)
    removed += sub.removed
    return { ...f, item_schema: sub.list }
  })
  return { list: recursed, removed }
}

const { data: templates, error } = await supabase
  .from('web_content_templates')
  .select('id, layer_name, family, fields')
if (error) throw error

let changed = 0
let totalRemoved = 0
for (const t of templates) {
  const result = dedupeSchemaList(t.fields)
  if (result.removed === 0) continue
  changed++
  totalRemoved += result.removed
  console.log(`▸ ${t.layer_name} (${t.family}) — removed ${result.removed} button_label slot${result.removed === 1 ? '' : 's'}`)
  if (apply) {
    const { error: upErr } = await supabase
      .from('web_content_templates')
      .update({ fields: result.list })
      .eq('id', t.id)
    if (upErr) console.log(`  ✗ update failed: ${upErr.message}`)
  }
}
console.log(`\nDone. ${changed} templates ${apply ? 'updated' : 'would be updated'} — total ${totalRemoved} redundant slots ${apply ? 'removed' : 'flagged'}.`)
if (!apply) console.log('Re-run with --apply to write changes.')
