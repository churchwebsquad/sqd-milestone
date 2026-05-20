// Brixies catalog schema regenerator.
//
// The original importer (scripts/import-brixies-catalog.mjs) created
// `fields` schemas that systematically miss slots — most often by
// leaving groups with `item_schema: []` even when the source HTML
// contains real text inside each item. This script walks every
// template's `source_html` once and rebuilds the `item_schema` for
// every group that's empty or under-populated, using style-based
// inference (font-size + font-weight) since Brixies layer names are
// frequently the literal lorem-ipsum text from Figma rather than
// semantic identifiers.
//
// Usage:
//   node scripts/regenerate-brixies-schemas.mjs           # dry-run, print diff for every template
//   node scripts/regenerate-brixies-schemas.mjs --apply   # actually write changes back to Supabase
//   node scripts/regenerate-brixies-schemas.mjs --template "FAQ Section 10"
//   node scripts/regenerate-brixies-schemas.mjs --family "Feature Section"
//   node scripts/regenerate-brixies-schemas.mjs --limit 5 # print only first 5 changed
//
// Changes are PURELY ADDITIVE:
//   • Existing slots are preserved (key + layer_name + type).
//   • Existing group keys + layer_names are preserved.
//   • Empty `item_schema` arrays gain new slots derived from source.
//   • Nested groups recurse; their item_schemas get the same treatment.
//
// The script does NOT add new top-level groups even if source has
// repeating containers the import missed — that requires a more
// invasive rebuild and risks breaking field_values that are already
// stored against the original schema.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseHtml } from 'node-html-parser'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.join(__dirname, '..')

// ── CLI ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { apply: false, template: null, family: null, limit: Infinity }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--apply') out.apply = true
    else if (a === '--template') out.template = argv[++i]
    else if (a === '--family') out.family = argv[++i]
    else if (a === '--limit') out.limit = parseInt(argv[++i], 10)
    else if (a.startsWith('--')) throw new Error(`Unknown flag: ${a}`)
  }
  return out
}

// ── Supabase client (reuses .env / .env.local) ──────────────────────

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

function getSupabase() {
  loadEnv()
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env / .env.local')
  }
  return createClient(url, key, { auth: { persistSession: false } })
}

// ── Inference helpers (mirrors the runtime augmenter) ───────────────

const NUMERIC_RE       = /^\d{1,3}$/
const STEP_RE          = /^Step\s+\d{1,3}$/i
const DIMENSION_RE     = /^\d{2,5}\s*[×x*]\s*\d{2,5}$/i
const GENERIC_NAME_RE  = /^(?:frame\d+|path[_\d]|material-symbols|svg|icon)/i
const LOREM_NAME_RE    = /lorem\s+ipsum/i

function normalize(s) {
  return (s ?? '').toLowerCase().replace(/[_\s-]+/g, '')
}

function sanitizeKey(layer) {
  return (layer ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'field'
}

/** Element has its OWN substantive text (direct text children), and
 *  it's not a decorative numeric/step/dimension placeholder. */
function hasSubstantiveText(node) {
  // node-html-parser nodes: child.nodeType === 3 for text nodes
  let total = ''
  for (const child of node.childNodes) {
    if (child.nodeType === 3) total += (child.text ?? child.rawText ?? '')
  }
  const trimmed = total.replace(/\s+/g, ' ').trim()
  if (!trimmed) return false
  if (NUMERIC_RE.test(trimmed)) return false
  if (STEP_RE.test(trimmed)) return false
  if (DIMENSION_RE.test(trimmed)) return false
  return true
}

/** Pull a CSS property value out of an inline style attribute. */
function getStyleProp(el, prop) {
  const style = el.getAttribute('style') ?? ''
  const re = new RegExp(`${prop}\\s*:\\s*([^;]+)`, 'i')
  const m = style.match(re)
  return m ? m[1].trim() : null
}

/** Decide what kind of slot best represents this text element. Style
 *  signals win over layer-name patterns because Brixies layer names
 *  are often the literal lorem-ipsum text. */
function inferSlot(layer, el) {
  const fontSize = parseFloat(getStyleProp(el, 'font-size') ?? '') || NaN
  const fontWeight = parseInt(getStyleProp(el, 'font-weight') ?? '', 10) || NaN
  const color = (getStyleProp(el, 'color') ?? '').toLowerCase()
  const isBold = !isNaN(fontWeight) && fontWeight >= 600
  const isBig = !isNaN(fontSize) && fontSize >= 28
  const isMedium = !isNaN(fontSize) && fontSize >= 18 && fontSize < 28
  const isSmall = !isNaN(fontSize) && fontSize < 18
  const isLight = /white|#fff|rgba?\(\s*255\s*,\s*255\s*,\s*255/i.test(color)

  // Semantic naming hint — when the layer name carries meaning, use
  // it for the key/heading_level. Generic / lorem-ipsum names fall
  // through to pure style inference.
  const norm = normalize(layer)
  const isGenericName = GENERIC_NAME_RE.test(layer) || LOREM_NAME_RE.test(layer)

  if (!isGenericName) {
    // Specific patterns first (so e.g. "Tagline" stays a tagline).
    if (/(^|_)tagline$|eyebrow|kicker|pretitle/i.test(norm)) {
      return { kind: 'slot', key: 'tagline', layer_name: layer, type: 'text', max_chars: 60 }
    }
    if (/question$/.test(norm)) {
      return { kind: 'slot', key: 'question', layer_name: layer, type: 'text', max_chars: 200, heading_level: 3 }
    }
    if (/answer$/.test(norm)) {
      return { kind: 'slot', key: 'answer', layer_name: layer, type: 'richtext', max_chars: 400 }
    }
    if (/(?:button[_\s]?label|contact|^cta$|^cta_|button$)/.test(norm)) {
      return {
        kind: 'slot', key: 'button_label', layer_name: layer, type: 'text',
        max_chars: 30, scope: 'button', label: 'Button label',
      }
    }
    if (/^(?:heading|title)(?:_card|_list_item)?$/.test(norm)) {
      const level = isBig ? 2 : 3
      return { kind: 'slot', key: 'heading', layer_name: layer, type: 'text', max_chars: 100, heading_level: level }
    }
    if (/(?:description|body|content|info|detail|summary|paragraph|answer)$/.test(norm)) {
      return { kind: 'slot', key: 'description', layer_name: layer, type: 'richtext', max_chars: 400 }
    }
    if (/(?:author|byline)$/.test(norm)) {
      return { kind: 'slot', key: 'author', layer_name: layer, type: 'text', max_chars: 60, scope: 'author' }
    }
    if (/(?:reading[_\s]?time|readtime)$/.test(norm)) {
      return { kind: 'slot', key: 'reading_time', layer_name: layer, type: 'text', max_chars: 20, scope: 'post' }
    }
    if (/(?:label|tag|category|badge)$/.test(norm)) {
      return { kind: 'slot', key: 'label', layer_name: layer, type: 'text', max_chars: 40 }
    }
  }

  // Style-based inference for generic / lorem-ipsum names.
  if (isBold && isBig) {
    return { kind: 'slot', key: 'heading', layer_name: layer, type: 'text', max_chars: 100, heading_level: 2 }
  }
  if (isBold && isMedium) {
    return { kind: 'slot', key: 'heading', layer_name: layer, type: 'text', max_chars: 100, heading_level: 3 }
  }
  if (isBold && isSmall) {
    return { kind: 'slot', key: 'label', layer_name: layer, type: 'text', max_chars: 60 }
  }
  if (isBig) {
    return { kind: 'slot', key: 'heading', layer_name: layer, type: 'text', max_chars: 100, heading_level: 2 }
  }
  // Default: short → text, long → richtext.
  const textLen = (el.text ?? '').replace(/\s+/g, ' ').trim().length
  if (textLen > 60 || isMedium) {
    return { kind: 'slot', key: 'description', layer_name: layer, type: 'richtext', max_chars: 400 }
  }
  return { kind: 'slot', key: sanitizeKey(layer), layer_name: layer, type: 'text', max_chars: 100 }

  // Note: isLight is unused above but kept as a hook for future
  // (scoped color metadata, etc.).
  void isLight
}

// ── DOM walking ─────────────────────────────────────────────────────

function getDataLayerDescendants(root) {
  const out = []
  const walk = (el) => {
    for (const child of el.childNodes) {
      if (child.nodeType !== 1) continue
      if (child.hasAttribute && child.hasAttribute('data-layer')) {
        out.push(child)
      }
      walk(child)
    }
  }
  walk(root)
  return out
}

function findElementByLayer(root, layerName) {
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

/** Decide whether groupEl is itself the item template or a container
 *  that holds the item template as its first data-layer child. */
function pickItemTemplate(groupEl, recursedSchema) {
  const schemaLayers = recursedSchema.map(f => normalize(f.layer_name ?? f.key))
  // Direct data-layer children of groupEl
  const directChildren = (groupEl.childNodes ?? []).filter(c => c.nodeType === 1 && c.hasAttribute && c.hasAttribute('data-layer'))
  // If any direct child matches an existing schema entry's layer, that
  // child is the item template (container pattern).
  for (const c of directChildren) {
    const l = normalize(c.getAttribute('data-layer'))
    if (schemaLayers.includes(l)) return c
  }
  // Otherwise groupEl itself is the item template (its descendants are
  // the per-item content).
  return groupEl
}

// ── Schema rebuild ──────────────────────────────────────────────────

function buildItemSchemaForGroup(groupEl, existingItemSchema) {
  const itemEl = pickItemTemplate(groupEl, existingItemSchema)

  // Collect every text-bearing data-layer descendant of itemEl.
  // Include itemEl itself when it's a leaf with text.
  const candidates = []
  const pushCandidate = (node) => {
    if (node.hasAttribute && node.hasAttribute('data-layer') && hasSubstantiveText(node)) {
      candidates.push({ layer: node.getAttribute('data-layer'), element: node })
    }
  }
  pushCandidate(itemEl)
  for (const desc of getDataLayerDescendants(itemEl)) {
    if (hasSubstantiveText(desc)) candidates.push({ layer: desc.getAttribute('data-layer'), element: desc })
  }

  // Brixies sometimes splits a logical group across two siblings —
  // FAQ Section 10 has `Accordion left` AND `Accordion right` under
  // one `Accordion` parent, and only one has the expanded "answer"
  // text. To capture missing slots, also walk groupEl's data-layer
  // siblings under the same parent — these usually share the
  // structure but may have richer per-state content.
  const parent = groupEl.parentNode
  if (parent && parent.childNodes) {
    for (const sib of parent.childNodes) {
      if (sib === groupEl) continue
      if (sib.nodeType !== 1) continue
      if (!sib.hasAttribute || !sib.hasAttribute('data-layer')) continue
      // Walk sibling's descendants too — these are candidate item
      // structures the schema doesn't model but could enrich slots.
      pushCandidate(sib)
      for (const desc of getDataLayerDescendants(sib)) {
        if (hasSubstantiveText(desc)) candidates.push({ layer: desc.getAttribute('data-layer'), element: desc })
      }
    }
  }

  // Existing layers (deep) — preserve them, don't duplicate.
  const existingLayers = new Set()
  const walkSchema = (schema) => {
    for (const f of schema) {
      existingLayers.add(normalize(f.layer_name ?? f.key))
      if (f.kind === 'group') walkSchema(f.item_schema)
    }
  }
  walkSchema(existingItemSchema)

  // The group's own layer name shouldn't become a slot inside itself,
  // unless groupEl IS the leaf with text (Hero 37 case).
  const groupOwnLayer = normalize(itemEl.getAttribute('data-layer') ?? '')
  const itemIsLeafText = candidates.length === 1
    && candidates[0].element === itemEl
    && groupOwnLayer

  const additions = []
  const seenKeys = new Set(existingItemSchema.map(f => f.key))
  const seenLayers = new Set()

  for (const cand of candidates) {
    const norm = normalize(cand.layer)
    if (existingLayers.has(norm)) continue
    if (seenLayers.has(norm)) continue
    if (norm === groupOwnLayer && !itemIsLeafText) continue

    const slot = inferSlot(cand.layer, cand.element)
    if (!slot) continue

    // Ensure unique key
    let key = slot.key
    let n = 2
    while (seenKeys.has(key)) key = `${slot.key}_${n++}`
    slot.key = key

    seenKeys.add(key)
    seenLayers.add(norm)
    additions.push(slot)
  }

  return additions
}

function rebuildField(field, sourceRoot) {
  if (field.kind === 'slot') return field

  // Recurse into nested groups first (so existingLayers in parent
  // augment correctly reflects deep schema).
  const recursedSchema = field.item_schema.map(f => rebuildField(f, sourceRoot))

  // Find this group's element in the source.
  const groupEl = findElementByLayer(sourceRoot, field.layer_name ?? field.key)
  if (!groupEl) {
    return { ...field, item_schema: recursedSchema }
  }

  // Add missing slots to the recursed schema.
  const additions = buildItemSchemaForGroup(groupEl, recursedSchema)
  if (additions.length === 0) {
    return { ...field, item_schema: recursedSchema }
  }
  return { ...field, item_schema: [...recursedSchema, ...additions] }
}

function regenerateSchema(template) {
  if (!template.source_html || !Array.isArray(template.fields)) return template.fields
  const root = parseHtml(template.source_html)
  // node-html-parser's parse returns a root with the first real
  // element as a child. The Brixies source's top-level div is the
  // section root.
  let sectionRoot = root.firstChild
  while (sectionRoot && sectionRoot.nodeType !== 1) sectionRoot = sectionRoot.nextSibling
  if (!sectionRoot) return template.fields
  return template.fields.map(f => rebuildField(f, sectionRoot))
}

// ── Diff printing ───────────────────────────────────────────────────

function summarizeAdditions(before, after, indent = '  ') {
  const lines = []
  for (let i = 0; i < after.length; i++) {
    const b = before[i]
    const a = after[i]
    if (!b || a.kind !== b.kind || a.key !== b.key) continue
    if (a.kind !== 'group') continue
    const beforeSlots = new Set(b.item_schema.map(s => s.key))
    const newSlots = a.item_schema.filter(s => !beforeSlots.has(s.key))
    if (newSlots.length > 0) {
      lines.push(`${indent}+ ${a.key} (${a.layer_name}): ${newSlots.map(s => `${s.key}[${s.type}${s.heading_level ? '/H' + s.heading_level : ''}]`).join(', ')}`)
    }
    // Recurse
    const subLines = summarizeAdditions(b.item_schema, a.item_schema, indent + '  ')
    lines.push(...subLines)
  }
  return lines
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const supabase = getSupabase()

  console.log(`Mode: ${args.apply ? 'APPLY (writes to DB)' : 'DRY-RUN (preview only)'}`)
  if (args.template) console.log(`Filter: template = "${args.template}"`)
  if (args.family) console.log(`Filter: family = "${args.family}"`)
  console.log('')

  let q = supabase.from('web_content_templates').select('id, layer_name, family, fields, source_html')
  if (args.template) q = q.eq('layer_name', args.template)
  if (args.family) q = q.eq('family', args.family)
  const { data: templates, error } = await q
  if (error) throw error
  console.log(`Loaded ${templates.length} templates.\n`)

  let changedCount = 0
  let printedCount = 0
  for (const t of templates) {
    let newFields
    try {
      newFields = regenerateSchema(t)
    } catch (e) {
      console.log(`✗ ${t.layer_name}: parse error — ${e.message}`)
      continue
    }
    if (JSON.stringify(newFields) === JSON.stringify(t.fields)) continue

    changedCount++
    if (printedCount < args.limit) {
      const lines = summarizeAdditions(t.fields, newFields)
      if (lines.length > 0) {
        console.log(`▸ ${t.layer_name} (${t.family})`)
        for (const l of lines) console.log(l)
        printedCount++
      }
    }

    if (args.apply) {
      const { error: updateErr } = await supabase
        .from('web_content_templates')
        .update({ fields: newFields })
        .eq('id', t.id)
      if (updateErr) {
        console.log(`  ✗ update failed: ${updateErr.message}`)
      }
    }
  }

  console.log('')
  console.log(`Done. ${changedCount}/${templates.length} templates ${args.apply ? 'updated' : 'would be updated'}.`)
  if (!args.apply) {
    console.log('Re-run with --apply to write changes.')
  }
}

main().catch(e => {
  console.error(e.stack ?? e.message)
  process.exit(1)
})
