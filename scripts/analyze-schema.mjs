// Comprehensive source-html → schema analyzer.
// For each template, walks the source HTML and produces a proposed
// schema. Compares against current DB schema. Reports the diff.
//
// Heuristics:
//   - GROUP: parent element has 2+ data-layer children with the same
//     data-layer name. The shared name becomes the group's
//     layer_name, the children form the item template.
//   - CTA: data-layer whose name matches "Buttons" / "Button" / "Cta"
//     AND has inner styled text (font-weight >= 500 OR specific
//     button-shaped child). Don't surface inner label as a separate
//     slot.
//   - IMAGE: img tag with data-layer, OR div with data-layer name
//     containing "Image" AND background-image style.
//   - HEADING / TEXT: data-layer with substantive direct text, font
//     style >= 24px or weight >= 600 → text (heading), else text or
//     richtext based on text length.
//   - SKIPPED: Path_NN, material-symbols, Union, Frame NNN, Icon,
//     Vector (decorative SVG).
//
// Field key strategy: if a slot's layer matches an existing schema
// slot's layer, REUSE the existing key (so field_values survive
// migration). Otherwise generate a sensible new key.
//
// Usage:
//   node scripts/analyze-schema.mjs                # all Process+Feature, dry-run
//   node scripts/analyze-schema.mjs "Process Section 6"
//   node scripts/analyze-schema.mjs --apply        # write to DB

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
const filter = args.find(a => !a.startsWith('--'))

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
)

// ── Style + layer helpers ────────────────────────────────────────────

function normalize(s) {
  return (s ?? '').toLowerCase().replace(/[_\s-]+/g, '')
}
function spaceNorm(s) {
  return (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function getStyleProp(el, prop) {
  const style = el.getAttribute?.('style') ?? ''
  const re = new RegExp(`${prop}\\s*:\\s*([^;]+)`, 'i')
  const m = style.match(re)
  return m ? m[1].trim() : null
}
function getFontSize(el) { const v = parseFloat(getStyleProp(el, 'font-size')); return isNaN(v) ? null : v }
function getFontWeight(el) { const v = parseInt(getStyleProp(el, 'font-weight'), 10); return isNaN(v) ? null : v }
function hasBackgroundImage(el) {
  const style = el.getAttribute?.('style') ?? ''
  return /background-image\s*:\s*url/i.test(style) || /background\s*:\s*[^;]*url\(/i.test(style)
}

function getDirectText(el) {
  let total = ''
  for (const child of el.childNodes ?? []) {
    if (child.nodeType === 3) total += (child.text ?? child.rawText ?? '')
  }
  return total.replace(/\s+/g, ' ').trim()
}

function isDecorativeLayer(layer) {
  if (!layer) return true
  if (/^Path[\s_]/i.test(layer)) return true
  if (/^material-symbols/i.test(layer)) return true
  if (/^Union$/i.test(layer)) return true
  if (/^Vector/i.test(layer)) return true
  if (/^Group\s+\d/i.test(layer)) return true
  if (/^Rectangle\b/i.test(layer)) return true
  if (/^Frame\s+\d/i.test(layer)) return true
  if (/^Ellipse\b/i.test(layer)) return true
  if (/^Mask\b/i.test(layer)) return true
  return false
}

function isDecorativeText(t) {
  if (!t) return true
  if (/^\d{1,3}$/.test(t)) return true
  if (/^Step\s+\d{1,3}$/i.test(t)) return true
  if (/^\d{2,5}\s*[×x*]\s*\d{2,5}$/i.test(t)) return true
  return false
}

function getDataLayerChildren(el) {
  return (el.childNodes ?? []).filter(c => c.nodeType === 1 && c.hasAttribute?.('data-layer'))
}

function walkDataLayerDescendants(el) {
  const out = []
  for (const child of el.childNodes ?? []) {
    if (child.nodeType !== 1) continue
    if (child.hasAttribute?.('data-layer')) out.push(child)
    out.push(...walkDataLayerDescendants(child))
  }
  return out
}

// Compute a "shape signature" for a subtree — bag of normalized
// data-layer names. Used to detect siblings with similar structure.
function shapeSignature(el) {
  const layers = new Set()
  for (const desc of walkDataLayerDescendants(el)) {
    const l = normalize(desc.getAttribute('data-layer') ?? '')
    if (l && !isDecorativeLayer(desc.getAttribute('data-layer'))) layers.add(l)
  }
  return layers
}

function signatureSimilarity(a, b) {
  if (a.size === 0 && b.size === 0) return 1
  if (a.size === 0 || b.size === 0) return 0
  let intersect = 0
  for (const v of a) if (b.has(v)) intersect++
  return intersect / Math.max(a.size, b.size)
}

// ── Classification ───────────────────────────────────────────────────

function isCtaWrapper(el) {
  const layer = el.getAttribute('data-layer') ?? ''
  if (!/button|cta/i.test(layer)) return false
  // Must have inner text-bearing child (the label)
  for (const desc of walkDataLayerDescendants(el)) {
    if (getDirectText(desc).length > 0) return true
  }
  return false
}

function isImageSlot(el) {
  const layer = el.getAttribute('data-layer') ?? ''
  const tag = el.tagName?.toLowerCase()
  if (tag === 'img') return true
  if (/^(image|icon|photo|picture|logo|graphic|video)/i.test(layer) && hasBackgroundImage(el)) return true
  if (/^(image|photo|picture|logo|graphic)/i.test(layer) && tag === 'div') return true
  return false
}

// ── Schema building ──────────────────────────────────────────────────

function makeSlotKey(layer, type, used) {
  // Prefer semantic names over raw layer names
  const norm = normalize(layer)
  let base = norm
    .replace(/^heading$/, 'heading')
    .replace(/^description$/, 'description')
    .replace(/^tagline$/, 'tagline')
    .replace(/^buttons?$/, 'button')
    .replace(/^cta$/, 'cta')
  if (!base) base = type
  let key = base
  let i = 2
  while (used.has(key)) {
    key = `${base}_${i++}`
  }
  used.add(key)
  return key
}

function inferTextSlot(el, layer) {
  const fs = getFontSize(el) ?? 16
  const fw = getFontWeight(el) ?? 400
  const text = getDirectText(el)
  const isHeading = fs >= 24 || fw >= 600
  const slot = {
    kind: 'slot',
    layer_name: layer,
  }
  if (isHeading) {
    slot.type = 'text'
    slot.max_chars = 100
    if (fs >= 32) slot.heading_level = 2
    else if (fs >= 24) slot.heading_level = 3
    else slot.heading_level = 4
  } else if (text.length > 60 || /description|info|content|body|paragraph/i.test(layer)) {
    slot.type = 'richtext'
    slot.max_chars = 400
  } else {
    slot.type = 'text'
    slot.max_chars = 80
  }
  return slot
}

// Build fields for the contents of `el` — meaning: data-layer elements
// in el's subtree that should be editable. Returns array of WebFieldDef.
function buildFieldsFor(el, existingByLayer, usedKeys, ancestorClaimed) {
  const fields = []
  // claimed = elements already absorbed by a group or CTA, so we skip
  // them during slot collection.
  const claimed = new Set(ancestorClaimed)

  // ── Pass 1: detect group patterns in the immediate subtree ────────
  // Walk descendants and find parents whose data-layer children
  // include 2+ siblings with the same data-layer name.
  const groupParents = []
  const visit = (parent) => {
    const dataKids = getDataLayerChildren(parent)
    // Group children by data-layer name
    const byName = new Map()
    for (const c of dataKids) {
      const name = c.getAttribute('data-layer')
      if (isDecorativeLayer(name)) continue
      // Skip if claimed
      if (claimed.has(c)) continue
      const arr = byName.get(name) ?? []
      arr.push(c)
      byName.set(name, arr)
    }
    for (const [name, siblings] of byName) {
      if (siblings.length < 2) continue
      // Skip if all siblings are decorative (e.g. dots)
      if (siblings.every(s => isDecorativeLayer(s.getAttribute('data-layer')))) continue
      groupParents.push({ parent, name, siblings })
      for (const s of siblings) claimed.add(s)
    }
    // Recurse into children that are NOT in groupings we found
    for (const c of dataKids) {
      if (!claimed.has(c)) visit(c)
    }
    // Also recurse into non-data-layer wrappers (structural)
    for (const c of parent.childNodes ?? []) {
      if (c.nodeType === 1 && !c.hasAttribute?.('data-layer')) visit(c)
    }
  }
  visit(el)

  // ── Pass 2: build group fields from collected groups ─────────────
  for (const { name, siblings } of groupParents) {
    const item = siblings[0]
    const groupKey = makeSlotKey(name, 'group', usedKeys)
    const group = {
      kind: 'group',
      key: groupKey,
      layer_name: name,
      default_count: siblings.length,
      item_schema: [],
    }
    // Recurse to build item_schema from the first sibling's subtree.
    // Mark the descendants of `item` as NOT claimed yet (we want them
    // covered by item_schema). Then mark all sibling descendants.
    const itemUsedKeys = new Set()
    const innerClaimed = new Set()
    group.item_schema = buildFieldsFor(item, existingByLayer, itemUsedKeys, innerClaimed)
    fields.push(group)
  }

  // ── Pass 3: detect CTA wrappers in subtree (not in claimed) ──────
  const ctaWrappers = []
  const collectCtas = (cur) => {
    if (claimed.has(cur)) return
    if (cur !== el && cur.hasAttribute?.('data-layer') && isCtaWrapper(cur)) {
      ctaWrappers.push(cur)
      // Mark cur and all its descendants as claimed (the inner label
      // is handled by the CTA's applyCta, not as a separate slot).
      claimed.add(cur)
      for (const d of walkDataLayerDescendants(cur)) claimed.add(d)
      return
    }
    for (const c of cur.childNodes ?? []) {
      if (c.nodeType === 1) collectCtas(c)
    }
  }
  collectCtas(el)
  for (const ctaEl of ctaWrappers) {
    const layer = ctaEl.getAttribute('data-layer')
    const key = makeSlotKey(layer, 'cta', usedKeys)
    fields.push({
      kind: 'slot',
      key,
      layer_name: layer,
      type: 'cta',
      label: 'CTA',
    })
  }

  // ── Pass 4: detect image slots ──────────────────────────────────
  const imageSlots = []
  const collectImages = (cur) => {
    if (claimed.has(cur)) return
    if (cur !== el && cur.hasAttribute?.('data-layer') && isImageSlot(cur)) {
      imageSlots.push(cur)
      claimed.add(cur)
      // Don't claim descendants — Brixies image frames sometimes wrap
      // additional content (text overlays). Those should still surface.
      return
    }
    for (const c of cur.childNodes ?? []) {
      if (c.nodeType === 1) collectImages(c)
    }
  }
  collectImages(el)
  for (const imgEl of imageSlots) {
    const layer = imgEl.getAttribute('data-layer')
    const key = makeSlotKey(layer, 'image', usedKeys)
    fields.push({
      kind: 'slot',
      key,
      layer_name: layer,
      type: 'image',
    })
  }

  // ── Pass 5: text leaves (data-layer with substantive direct text) ─
  const textCandidates = []
  const collectText = (cur) => {
    if (claimed.has(cur)) return
    if (cur !== el && cur.hasAttribute?.('data-layer')) {
      const layer = cur.getAttribute('data-layer')
      if (!isDecorativeLayer(layer)) {
        const txt = getDirectText(cur)
        if (txt && !isDecorativeText(txt)) {
          textCandidates.push(cur)
        }
      }
    }
    for (const c of cur.childNodes ?? []) {
      if (c.nodeType === 1) collectText(c)
    }
  }
  collectText(el)
  for (const textEl of textCandidates) {
    if (claimed.has(textEl)) continue
    const layer = textEl.getAttribute('data-layer')
    const slot = inferTextSlot(textEl, layer)
    slot.key = makeSlotKey(layer, slot.type, usedKeys)
    fields.push(slot)
    claimed.add(textEl)
  }

  // Reorder: top-level slots (tagline / heading / description / image)
  // before groups. Group fields tend to be the last visual chunks.
  fields.sort((a, b) => {
    const order = (f) => {
      if (f.kind === 'slot') {
        if (/tagline|eyebrow/i.test(f.layer_name ?? '')) return 0
        if (/^heading$/i.test(f.layer_name ?? '')) return 1
        if (/^description$/i.test(f.layer_name ?? '')) return 2
        if (f.type === 'image') return 3
        return 4
      }
      return 5
    }
    return order(a) - order(b)
  })

  // ── Key preservation: for each field, if an existing schema has a
  // field with the same layer_name (case-insensitive), reuse its key.
  for (const f of fields) {
    const existing = existingByLayer.get(spaceNorm(f.layer_name))
    if (existing && existing.key) f.key = existing.key
    if (f.kind === 'group') {
      // Recurse item_schema key preservation
      preserveKeys(f.item_schema, existingByLayer)
    }
  }
  return fields
}

function preserveKeys(fields, existingByLayer) {
  for (const f of fields) {
    const existing = existingByLayer.get(spaceNorm(f.layer_name))
    if (existing && existing.key) f.key = existing.key
    if (f.kind === 'group' && Array.isArray(f.item_schema)) {
      preserveKeys(f.item_schema, existingByLayer)
    }
  }
}

// Build a flat map of layer_name → field from existing schema (for
// key preservation).
function buildExistingByLayer(fields, map = new Map()) {
  for (const f of fields ?? []) {
    if (f.layer_name) map.set(spaceNorm(f.layer_name), f)
    if (f.kind === 'group') buildExistingByLayer(f.item_schema, map)
  }
  return map
}

// ── Diff / display ──────────────────────────────────────────────────

function summarize(fields, indent = 0) {
  const lines = []
  for (const f of fields ?? []) {
    const pad = '  '.repeat(indent)
    if (f.kind === 'slot') {
      lines.push(`${pad}slot:${f.key}=${f.type} (layer="${f.layer_name}")`)
    } else if (f.kind === 'group') {
      lines.push(`${pad}group:${f.key} ×${f.default_count} (layer="${f.layer_name}")`)
      lines.push(...summarize(f.item_schema, indent + 1))
    }
  }
  return lines
}

// ── Main ─────────────────────────────────────────────────────────────

let q = supabase.from('web_content_templates')
  .select('id, layer_name, family, fields, source_html')
  .in('family', ['Process Section', 'Feature Section'])
if (filter) q = q.eq('layer_name', filter)
const { data: templates, error } = await q
if (error) throw error

for (const t of templates) {
  const root = parseHtml(t.source_html)
  let sectionRoot = root.firstChild
  while (sectionRoot && sectionRoot.nodeType !== 1) sectionRoot = sectionRoot.nextSibling
  if (!sectionRoot) continue

  const existingByLayer = buildExistingByLayer(t.fields)
  const usedKeys = new Set()
  const proposed = buildFieldsFor(sectionRoot, existingByLayer, usedKeys, new Set())

  console.log(`\n▸ ${t.layer_name} (${t.family})`)
  console.log('  --- Current schema:')
  for (const l of summarize(t.fields, 1)) console.log(l)
  console.log('  --- Proposed schema:')
  for (const l of summarize(proposed, 1)) console.log(l)

  if (apply) {
    const { error: upErr } = await supabase
      .from('web_content_templates')
      .update({ fields: proposed })
      .eq('id', t.id)
    if (upErr) console.log(`  ✗ update failed: ${upErr.message}`)
    else console.log('  ✓ applied')
  }
}

console.log(`\nDone. ${templates.length} templates inspected.${apply ? ' Applied.' : ' Dry-run.'}`)
if (!apply) console.log('Re-run with --apply to write changes.')
