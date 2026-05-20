// Remove redundant text/richtext slots whose source element is nested
// INSIDE a CTA slot's wrapper element. The runtime applyCta already
// writes the label into the deepest text-bearing leaf, so a separate
// text slot for that inner label is duplicate UI for the same data.
//
// Examples this catches that the earlier scope=button dedupe missed:
//   - Feature section 38: slot { key: "heading", layer: "Learn more" }
//     whose element is inside the CTA slot's "Button" wrapper.
//   - Feature Section 54: same pattern.
//
// Usage:
//   node scripts/dedupe-cta-label-slots.mjs           # dry-run
//   node scripts/dedupe-cta-label-slots.mjs --apply
//   node scripts/dedupe-cta-label-slots.mjs --family "Feature Section"

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseHtml } from 'node-html-parser'
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
const familyIdx = args.indexOf('--family')
const family = familyIdx >= 0 ? args[familyIdx + 1] : null

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
)

function normalize(s) {
  return (s ?? '').toLowerCase().replace(/[_\s-]+/g, '')
}

function findAllElementsByLayer(root, layerName) {
  const out = []
  if (!root || !layerName) return out
  const target = normalize(layerName)
  const stack = [root]
  while (stack.length) {
    const el = stack.pop()
    if (!el) continue
    if (el.getAttribute && el.getAttribute('data-layer') && normalize(el.getAttribute('data-layer')) === target) {
      out.push(el)
    }
    if (el.childNodes) {
      for (let i = el.childNodes.length - 1; i >= 0; i--) {
        if (el.childNodes[i].nodeType === 1) stack.push(el.childNodes[i])
      }
    }
  }
  return out
}

function isDescendantOf(el, ancestor) {
  let cur = el.parentNode
  while (cur) {
    if (cur === ancestor) return true
    cur = cur.parentNode
  }
  return false
}

function walkSchema(fields, cb) {
  if (!Array.isArray(fields)) return
  for (const f of fields) {
    if (!f) continue
    cb(f)
    if (f.kind === 'group') walkSchema(f.item_schema ?? [], cb)
  }
}

function findFirstByLayer(root, layerName) {
  const all = findAllElementsByLayer(root, layerName)
  return all[0] ?? null
}

function dedupeFields(fields, sectionRoot) {
  // Find all CTA slot elements (every match, not just first)
  const ctaElements = []
  walkSchema(fields, (f) => {
    if (f.kind === 'slot' && f.type === 'cta' && f.layer_name) {
      for (const el of findAllElementsByLayer(sectionRoot, f.layer_name)) {
        ctaElements.push({ slot: f, el })
      }
    }
  })

  const removedKeys = []

  // Recursively rebuild fields, dropping text/richtext slots inside CTA wrappers
  function rebuildList(list) {
    if (!Array.isArray(list)) return list
    const out = []
    for (const f of list) {
      if (f.kind === 'slot' && (f.type === 'text' || f.type === 'richtext')) {
        const slotEl = findFirstByLayer(sectionRoot, f.layer_name ?? f.key)
        let insideCta = false
        if (slotEl) {
          for (const { el: ctaEl } of ctaElements) {
            if (slotEl === ctaEl) continue
            if (isDescendantOf(slotEl, ctaEl)) { insideCta = true; break }
          }
        }
        if (insideCta) {
          removedKeys.push(f.key)
          continue
        }
      }
      if (f.kind === 'group') {
        out.push({ ...f, item_schema: rebuildList(f.item_schema ?? []) })
      } else {
        out.push(f)
      }
    }
    return out
  }

  const next = rebuildList(fields)
  return { fields: next, removedKeys }
}

let q = supabase.from('web_content_templates')
  .select('id, layer_name, family, fields, source_html')
if (family) q = q.eq('family', family)
const { data: templates, error } = await q
if (error) throw error

let changed = 0
let total = 0
for (const t of templates) {
  if (!t.source_html) continue
  const root = parseHtml(t.source_html)
  let sectionRoot = root.firstChild
  while (sectionRoot && sectionRoot.nodeType !== 1) sectionRoot = sectionRoot.nextSibling
  if (!sectionRoot) continue
  const { fields, removedKeys } = dedupeFields(t.fields, sectionRoot)
  if (removedKeys.length === 0) continue
  changed++
  total += removedKeys.length
  console.log(`▸ ${t.layer_name} (${t.family}) — removed: ${removedKeys.join(', ')}`)
  if (apply) {
    const { error: upErr } = await supabase
      .from('web_content_templates')
      .update({ fields })
      .eq('id', t.id)
    if (upErr) console.log(`  ✗ update failed: ${upErr.message}`)
  }
}
console.log(`\nDone. ${changed} templates ${apply ? 'updated' : 'would be updated'} — total ${total} slot${total === 1 ? '' : 's'} ${apply ? 'removed' : 'flagged'}.`)
if (!apply) console.log('Re-run with --apply to write changes.')
