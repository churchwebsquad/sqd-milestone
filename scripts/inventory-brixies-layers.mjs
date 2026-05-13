// Brixies vocabulary inventory.
//
// Read-only analysis tool. Walks every `data-layer="..."` attribute
// across one or more Brixies HTML exports and emits a Markdown report
// of the full vocabulary — what layer names exist, how often, what
// section roots use them, and what *parent* layers wrap them.
//
// Used to drive the taxonomy pass (slot vs group vs decoration vs
// wrapper) before the catalog importer is refactored.
//
// Usage:
//   node scripts/inventory-brixies-layers.mjs <path1> <path2> ...
//
// The output goes to:
//   reports/brixies-vocabulary-<YYYY-MM-DD>.md
//
// Each input file can be a raw HTML file or an RTF-wrapped Brixies
// export (the importer's stripRtf wrapper is reused). Mixed-family
// files are fine — section roots are detected automatically by the
// pattern `<div data-layer="<Family> N">` for any Family + integer.
//
// What this script does NOT do: classify layers. That happens
// manually in scripts/brixies-taxonomy.json once the full
// vocabulary is in front of us.

import fs from 'node:fs'
import path from 'node:path'

// ── CLI ─────────────────────────────────────────────────────────────────────

const inputs = process.argv.slice(2).filter(a => !a.startsWith('--'))
if (inputs.length === 0) {
  console.error('Usage: node scripts/inventory-brixies-layers.mjs <path1> <path2> ...')
  process.exit(1)
}

const projectRoot = new URL('..', import.meta.url).pathname
const reportsDir = path.join(projectRoot, 'reports')
fs.mkdirSync(reportsDir, { recursive: true })
const today = new Date().toISOString().slice(0, 10)
const outPath = path.join(reportsDir, `brixies-vocabulary-${today}.md`)

// ── Parsing helpers ─────────────────────────────────────────────────────────

/** Strip the RTF wrapper from a Brixies export. Returns the source
 *  unchanged if there's no `<div data-layer=` to find. */
function stripRtf(raw) {
  const idx = raw.indexOf('<div data-layer=')
  return idx >= 0 ? raw.slice(idx) : raw
}

/** Returns the index after the matching closing `</div>` for a `<div>`
 *  opening at `start`. Depth-counted. */
function findSectionEnd(html, start) {
  const re = /<div\b[^>]*>|<\/div>/gi
  re.lastIndex = start
  let depth = 0
  let m
  while ((m = re.exec(html)) !== null) {
    if (m[0].startsWith('</')) {
      depth--
      if (depth === 0) return re.lastIndex
    } else {
      depth++
    }
  }
  return html.length
}

/** Detect a section root: any `<div data-layer="<Family> <integer>">`
 *  at the top level of the file. Returns array of { layerName, family,
 *  start, end, sourceHtml }. */
function findSectionRoots(html) {
  const re = /<div\s+data-layer="([^"]+?)\s+(\d+)"[^>]*>/gi
  const out = []
  let m
  let cursor = 0
  while ((m = re.exec(html)) !== null) {
    if (m.index < cursor) continue   // already inside a previously-claimed section
    const layerName = `${m[1]} ${m[2]}`
    const family = m[1]
    const start = m.index
    const end = findSectionEnd(html, start)
    out.push({ layerName, family, start, end, sourceHtml: html.slice(start, end) })
    cursor = end
  }
  return out
}

/** Walk every `data-layer="..."` in `html`, tracking depth via a
 *  running stack of open <div data-layer=...> tags. Returns array of
 *  { layer, parent, depth, sourceFile, sectionRoot }. */
function walkLayers(html, sourceFile, sectionRoot) {
  const re = /(<div\b[^>]*?\bdata-layer="([^"]+)"[^>]*>|<\/div>)/gi
  const stack = []   // stack of layer names currently open (parent chain)
  const out = []
  let m
  while ((m = re.exec(html)) !== null) {
    if (m[0].startsWith('</')) {
      stack.pop()
      continue
    }
    const layer = m[2]
    const parent = stack[stack.length - 1] ?? null
    out.push({
      layer,
      parent,
      depth: stack.length,
      sourceFile,
      sectionRoot,
    })
    // Push for nesting tracking. Only `<div ...>` openings increment;
    // self-closing isn't standard for Brixies output but be defensive.
    if (!m[0].endsWith('/>')) stack.push(layer)
  }
  return out
}

// ── Main pass ───────────────────────────────────────────────────────────────

/** layer name → aggregated stats */
const stats = new Map()
/** family → set of section root layers (e.g. "Feature section 3") */
const familyToRoots = new Map()
/** family → set of distinct layer names seen anywhere in any of its sections */
const familyToLayers = new Map()
let totalSectionsParsed = 0

for (const input of inputs) {
  if (!fs.existsSync(input)) {
    console.warn(`! Skipping (not found): ${input}`)
    continue
  }
  const raw = fs.readFileSync(input, 'utf-8')
  const html = stripRtf(raw)
  const sourceFile = path.relative(projectRoot, input)
  const roots = findSectionRoots(html)

  for (const root of roots) {
    totalSectionsParsed++
    const family = root.family
    if (!familyToRoots.has(family)) familyToRoots.set(family, new Set())
    familyToRoots.get(family).add(root.layerName)
    if (!familyToLayers.has(family)) familyToLayers.set(family, new Set())

    const events = walkLayers(root.sourceHtml, sourceFile, root.layerName)
    for (const ev of events) {
      familyToLayers.get(family).add(ev.layer)
      if (!stats.has(ev.layer)) {
        stats.set(ev.layer, {
          layer: ev.layer,
          occurrences: 0,
          parents: new Set(),
          rootSamples: new Set(),
          families: new Set(),
          minDepth: Infinity,
          maxDepth: 0,
        })
      }
      const s = stats.get(ev.layer)
      s.occurrences++
      if (ev.parent) s.parents.add(ev.parent)
      s.rootSamples.add(ev.sectionRoot)
      s.families.add(family)
      if (ev.depth < s.minDepth) s.minDepth = ev.depth
      if (ev.depth > s.maxDepth) s.maxDepth = ev.depth
    }
  }
}

// ── Render report ──────────────────────────────────────────────────────────

const lines = []
lines.push(`# Brixies vocabulary inventory`)
lines.push('')
lines.push(`**Generated:** ${today}`)
lines.push(`**Inputs (${inputs.length}):**`)
for (const i of inputs) lines.push(`- \`${path.relative(projectRoot, i)}\``)
lines.push('')
lines.push(`**Sections parsed:** ${totalSectionsParsed}`)
lines.push(`**Distinct layer names:** ${stats.size}`)
lines.push(`**Families detected:** ${familyToRoots.size}`)
lines.push('')

// Family roll-up
lines.push(`## Families`)
lines.push('')
lines.push(`| Family | Variants | Distinct layers used |`)
lines.push(`|---|---:|---:|`)
const familyRows = [...familyToRoots.entries()].sort((a, b) => a[0].localeCompare(b[0]))
for (const [family, roots] of familyRows) {
  const layers = familyToLayers.get(family)?.size ?? 0
  lines.push(`| ${family} | ${roots.size} | ${layers} |`)
}
lines.push('')

// Full vocabulary, sorted by occurrence count desc
lines.push(`## Vocabulary (every distinct \`data-layer\` value)`)
lines.push('')
lines.push(`Sorted by frequency. Use this to drive the taxonomy classification.`)
lines.push('')
lines.push(`| Layer | Occ. | Depth | Parents (top 3) | Families | Sample sections (first 2) |`)
lines.push(`|---|---:|---|---|---|---|`)

const sorted = [...stats.values()].sort((a, b) => b.occurrences - a.occurrences || a.layer.localeCompare(b.layer))
for (const s of sorted) {
  const depth = s.minDepth === s.maxDepth ? `${s.minDepth}` : `${s.minDepth}–${s.maxDepth}`
  const parents = [...s.parents].slice(0, 3).map(p => `\`${p}\``).join(', ') || '_(root)_'
  const families = [...s.families].sort().join(', ')
  const samples = [...s.rootSamples].slice(0, 2).map(r => `\`${r}\``).join(', ')
  lines.push(`| \`${s.layer}\` | ${s.occurrences} | ${depth} | ${parents} | ${families} | ${samples} |`)
}
lines.push('')

// Per-family layer breakdown — useful for spotting family-specific vocab
lines.push(`## Layers by family`)
lines.push('')
for (const [family, layers] of familyRows) {
  lines.push(`### ${family}`)
  lines.push('')
  const familyLayers = [...layers].sort()
  // Group: which of these are unique to this family?
  const uniqueToFamily = familyLayers.filter(l => stats.get(l)?.families.size === 1)
  const sharedAcrossFamilies = familyLayers.filter(l => (stats.get(l)?.families.size ?? 1) > 1)
  if (uniqueToFamily.length > 0) {
    lines.push(`**Unique to this family (${uniqueToFamily.length}):**`)
    lines.push('')
    for (const l of uniqueToFamily) lines.push(`- \`${l}\``)
    lines.push('')
  }
  lines.push(`**Shared with other families (${sharedAcrossFamilies.length}):**`)
  lines.push('')
  lines.push(sharedAcrossFamilies.map(l => `\`${l}\``).join(', '))
  lines.push('')
}

fs.writeFileSync(outPath, lines.join('\n'))

console.log(`━━ Inventory complete ━━`)
console.log(`Sections parsed:   ${totalSectionsParsed}`)
console.log(`Distinct layers:   ${stats.size}`)
console.log(`Families detected: ${familyToRoots.size}`)
console.log(`Report: ${path.relative(projectRoot, outPath)}`)
