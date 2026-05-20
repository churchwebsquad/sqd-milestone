// Audit Feature Section schemas against their source_html to find
// systematic parser mislabelings. Detects:
//   1. Text slots whose element is inside a CTA slot's wrapper element
//      (the inner label is captured twice — once as the CTA, once as a
//      mislabeled heading/text slot).
//   2. Schema slots whose layer_name doesn't exist in source_html at
//      all (parser hallucinated or layer was renamed).
//   3. Source data-layer elements with substantive text that no schema
//      slot points at (missing fields).
//   4. Groups whose default_count doesn't match the observed source
//      sibling count.
//
// Dry-run only: prints findings to stdout. No DB writes.
//
// Usage:
//   node scripts/audit-feature-schemas.mjs                  # all Feature Sections
//   node scripts/audit-feature-schemas.mjs "Feature section 38"   # one template

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

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
)

function normalize(s) {
  return (s ?? '').toLowerCase().replace(/[_\s-]+/g, '')
}

function findElementByLayer(root, layerName) {
  if (!root || !layerName) return null
  const target = normalize(layerName)
  const stack = [root]
  while (stack.length) {
    const el = stack.pop()
    if (!el) continue
    if (el.getAttribute && el.getAttribute('data-layer') && normalize(el.getAttribute('data-layer')) === target) {
      return el
    }
    if (el.childNodes) {
      for (let i = el.childNodes.length - 1; i >= 0; i--) {
        if (el.childNodes[i].nodeType === 1) stack.push(el.childNodes[i])
      }
    }
  }
  return null
}

function collectAllDataLayerElements(root) {
  const out = []
  const stack = [root]
  while (stack.length) {
    const el = stack.pop()
    if (!el) continue
    if (el.getAttribute && el.getAttribute('data-layer')) out.push(el)
    if (el.childNodes) {
      for (let i = el.childNodes.length - 1; i >= 0; i--) {
        if (el.childNodes[i].nodeType === 1) stack.push(el.childNodes[i])
      }
    }
  }
  return out
}

function walkSchema(fields, cb, depth = 0, path = []) {
  if (!Array.isArray(fields)) return
  for (const f of fields) {
    if (!f) continue
    cb(f, depth, path)
    if (f.kind === 'group' && Array.isArray(f.item_schema)) {
      walkSchema(f.item_schema, cb, depth + 1, [...path, f.key])
    }
  }
}

function countSiblingsByLayer(el, targetLayer) {
  const parent = el.parentNode
  if (!parent || !parent.childNodes) return 1
  const t = normalize(targetLayer)
  let n = 0
  for (const c of parent.childNodes) {
    if (c.nodeType !== 1) continue
    if (c.getAttribute && c.getAttribute('data-layer') && normalize(c.getAttribute('data-layer')) === t) {
      n++
    }
  }
  return n
}

function isInsideElement(el, container) {
  let cur = el.parentNode
  while (cur) {
    if (cur === container) return true
    cur = cur.parentNode
  }
  return false
}

function hasSubstantiveText(node) {
  let total = ''
  for (const child of node.childNodes ?? []) {
    if (child.nodeType === 3) total += (child.text ?? child.rawText ?? '')
  }
  const trimmed = total.replace(/\s+/g, ' ').trim()
  if (!trimmed) return false
  if (/^\d{1,3}$/.test(trimmed)) return false
  if (/^Step\s+\d{1,3}$/i.test(trimmed)) return false
  if (/^\d{2,5}\s*[×x*]\s*\d{2,5}$/i.test(trimmed)) return false
  return true
}

// ── Per-template audit ─────────────────────────────────────────────

function auditTemplate(template) {
  const issues = []
  const root = parseHtml(template.source_html)
  let sectionRoot = root.firstChild
  while (sectionRoot && sectionRoot.nodeType !== 1) sectionRoot = sectionRoot.nextSibling
  if (!sectionRoot) return [{ kind: 'no_root', msg: 'No section root in source_html' }]

  // Index every CTA slot's element (every match, not just first) so we
  // can detect text slots nested inside any CTA wrapper.
  const ctaElements = []
  walkSchema(template.fields, (f) => {
    if (f.kind === 'slot' && f.type === 'cta') {
      const all = []
      const stack = [sectionRoot]
      const target = normalize(f.layer_name ?? f.key)
      while (stack.length) {
        const cur = stack.pop()
        if (!cur) continue
        if (cur.getAttribute && cur.getAttribute('data-layer') && normalize(cur.getAttribute('data-layer')) === target) {
          all.push(cur)
        }
        if (cur.childNodes) {
          for (let i = cur.childNodes.length - 1; i >= 0; i--) {
            if (cur.childNodes[i].nodeType === 1) stack.push(cur.childNodes[i])
          }
        }
      }
      for (const el of all) ctaElements.push({ slot: f, el })
    }
  })

  // (1) Text slots nested inside a CTA slot's wrapper.
  walkSchema(template.fields, (f) => {
    if (f.kind !== 'slot') return
    if (f.type === 'cta' || f.type === 'image') return
    const el = findElementByLayer(sectionRoot, f.layer_name ?? f.key)
    if (!el) return
    for (const { slot: ctaSlot, el: ctaEl } of ctaElements) {
      if (el === ctaEl) continue
      if (isInsideElement(el, ctaEl)) {
        issues.push({
          kind: 'text_inside_cta',
          msg: `text slot "${f.key}" (layer="${f.layer_name}") lives inside CTA slot "${ctaSlot.key}" — likely the button label (covered by CTA's findButtonLabelLeaf at render time)`,
          slot_key: f.key,
        })
        break
      }
    }
  })

  // (2) Schema slots/groups whose layer_name doesn't exist in source.
  // Skip groups marked numbered_sibling_variants (parser handles
  // matching "Card" against "Card 01", "Card 02", etc.) and palette
  // references (item template comes from another row).
  walkSchema(template.fields, (f) => {
    if (!f.layer_name) return
    if (f.kind === 'group' && f.numbered_sibling_variants === true) return
    if (f.kind === 'group' && f.item_template_ref) return
    const el = findElementByLayer(sectionRoot, f.layer_name)
    if (!el) {
      issues.push({
        kind: 'phantom_layer',
        msg: `${f.kind} "${f.key}" layer_name="${f.layer_name}" not found in source_html`,
        slot_key: f.key,
      })
    }
  })

  // (3) Source data-layer elements with substantive text that no schema slot binds.
  const allLayers = collectAllDataLayerElements(sectionRoot)
  const boundLayers = new Set()
  walkSchema(template.fields, (f) => {
    if (f.layer_name) boundLayers.add(normalize(f.layer_name))
    if (f.key) boundLayers.add(normalize(f.key))
  })
  for (const el of allLayers) {
    if (!hasSubstantiveText(el)) continue
    const layer = el.getAttribute('data-layer')
    if (!layer) continue
    const n = normalize(layer)
    if (boundLayers.has(n)) continue
    // Skip leaves that are descendants of a CTA element (already covered).
    let inCta = false
    for (const { el: ctaEl } of ctaElements) {
      if (el === ctaEl || isInsideElement(el, ctaEl)) { inCta = true; break }
    }
    if (inCta) continue
    issues.push({
      kind: 'unbound_text',
      msg: `source has data-layer="${layer}" with text "${(el.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)}" — no schema slot binds it`,
    })
  }

  // (4) Group default_count mismatched against observed source siblings.
  walkSchema(template.fields, (f) => {
    if (f.kind !== 'group') return
    const el = findElementByLayer(sectionRoot, f.layer_name ?? f.key)
    if (!el) return
    const siblingCount = countSiblingsByLayer(el, f.layer_name ?? f.key)
    if (siblingCount > 1 && f.default_count !== siblingCount) {
      issues.push({
        kind: 'count_mismatch',
        msg: `group "${f.key}" has default_count=${f.default_count} but source has ${siblingCount} sibling "${f.layer_name}" elements`,
        slot_key: f.key,
      })
    }
    if (siblingCount > 1 && f.single_instance_hint === true) {
      issues.push({
        kind: 'single_hint_on_multi',
        msg: `group "${f.key}" is single_instance_hint=true but source has ${siblingCount} sibling instances`,
        slot_key: f.key,
      })
    }
  })

  return issues
}

// ── Main ─────────────────────────────────────────────────────────────

const filter = process.argv[2]
let q = supabase.from('web_content_templates')
  .select('id, layer_name, family, fields, source_html')
  .in('family', ['Feature Section', 'Process Section'])
if (filter) q = q.eq('layer_name', filter)
const { data: templates, error } = await q
if (error) throw error

let totalIssues = 0
const byKind = {}
for (const t of templates) {
  const issues = auditTemplate(t)
  if (issues.length === 0) continue
  console.log(`\n▸ ${t.layer_name} (${issues.length} issue${issues.length === 1 ? '' : 's'})`)
  for (const i of issues) {
    console.log(`  ${i.kind}: ${i.msg}`)
    byKind[i.kind] = (byKind[i.kind] ?? 0) + 1
    totalIssues++
  }
}
console.log(`\n──── Summary ────`)
console.log(`Templates inspected: ${templates.length}`)
console.log(`Total issues: ${totalIssues}`)
for (const [k, n] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k}: ${n}`)
}
