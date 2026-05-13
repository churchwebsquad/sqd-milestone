// Brixies catalog importer (v2 — bedrock).
//
// Parses Brixies HTML library files, infers the slot/group schema for
// each section variant per scripts/brixies-taxonomy.json, and upserts
// rows into `web_content_templates`. Optionally ingests JPG previews.
//
// Usage:
//   node scripts/import-brixies-catalog.mjs <path-to-html> [path2 ...] [options]
//
// Options:
//   --dry                Print results, don't write to DB
//   --previews <dir>     Upload matching JPGs from <dir> to brand-assets/web-templates/
//   --report-only        Print the discovery report and exit (no writes)
//   --family <name>      Restrict import to a single family (case-insensitive)
//
// Examples:
//   node scripts/import-brixies-catalog.mjs \
//     "../Web 2.0/Brixies/_HTML/Feature Sections/FeatureSections.html" --dry
//
//   node scripts/import-brixies-catalog.mjs \
//     "../Web 2.0/Brixies/_HTML/Hero Sections/HeroSections.html" \
//     --previews "../Web 2.0/Brixies/_HTML/Hero Sections"
//
// The script is idempotent — IDs are kebab-case of the section's layer
// name (e.g. "feature-section-33"), so re-running upserts in place.
//
// Architecture:
//   1. Load taxonomy + compile regex caches.
//   2. Strip RTF wrapper from each input file.
//   3. Find section roots — only `<Family> N` layers where Family is
//      in families_allowed (filters Frame N, Image N, etc.).
//   4. For each root: walk the DOM, classify every layer against the
//      taxonomy, emit a `fields` array of slots and groups (with
//      default_count + recursive item_schema).
//   5. Determine `kind` from section_kind_rules.
//   6. For listing templates, populate `paired_post_template`.
//   7. Trim source_html to one instance per detected group.
//   8. Upsert into web_content_templates; optionally upload preview JPG.
//   9. Print discovery report of any unknown layer names.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseHtml } from 'node-html-parser'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.join(__dirname, '..')
const TAXONOMY_PATH = path.join(__dirname, 'brixies-taxonomy.json')

// ── CLI parsing ───────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { inputs: [], dry: false, reportOnly: false, previewsDir: null, family: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry') out.dry = true
    else if (a === '--report-only') out.reportOnly = true
    else if (a === '--previews') out.previewsDir = argv[++i]
    else if (a === '--family') out.family = argv[++i]
    else if (a.startsWith('--')) throw new Error(`Unknown flag: ${a}`)
    else out.inputs.push(a)
  }
  return out
}

// ── Taxonomy loader ───────────────────────────────────────────────────

function loadTaxonomy() {
  const raw = JSON.parse(fs.readFileSync(TAXONOMY_PATH, 'utf-8'))

  // Slots — lowercase key → config (case-insensitive lookup)
  const slots = new Map()
  for (const [name, cfg] of Object.entries(raw.slots)) {
    if (name.startsWith('_')) continue
    slots.set(name.toLowerCase(), { name, ...cfg })
  }

  const groupContainers = new Set(raw.group_container_hints.containers.map(s => s.toLowerCase()))
  const placeholderMarkers = raw.group_container_hints.placeholder_markers || []
  const chromeAutoFields = new Map(
    Object.entries(raw.chrome_auto_populated_fields.fields).map(([k, v]) => [k.toLowerCase(), { name: k, ...v }]),
  )
  const scopedKeyParents = new Set(raw.scoped_key_rules.scope_under.map(s => s.toLowerCase()))
  // Map lowercase → canonical-case family name so "Feature section" and
  // "Feature Section" both normalize to "Feature Section" in catalog rows.
  const allowedFamilies = new Map(
    raw.families_allowed.families.map(s => [s.toLowerCase(), s]),
  )

  const compile = (patterns, flags = 'i') => patterns.map(p => new RegExp(p, flags))
  const ignoredPatterns = compile(raw.ignored_layer_patterns.patterns)
  const decorationPatterns = compile(raw.decorations.patterns)
  const wrapperPatterns = compile(raw.wrappers.patterns)
  const sectionKindRules = raw.section_kind_rules.rules.map(r => ({
    re: new RegExp(r.pattern, 'i'),
    kind: r.kind,
  }))
  const placeholderResolutions = raw.global_site_snippets.placeholder_resolution_patterns.map(p => ({
    re: new RegExp(p.pattern, 'i'),
    token: p.resolves_to,
  }))

  return {
    raw,
    slots,
    groupContainers,
    placeholderMarkers,
    chromeAutoFields,
    scopedKeyParents,
    allowedFamilies,
    ignoredPatterns,
    decorationPatterns,
    wrapperPatterns,
    sectionKindRules,
    placeholderResolutions,
    postTemplatePairs: raw.post_template_pairs.pairs,
    headingLevels: raw.heading_levels.level_map,
    headingDefaultLevel: raw.heading_levels.default_level,
  }
}

// Classify a single data-layer name against the taxonomy.
// Precedence: ignored → placeholder_resolution → slot → chrome_auto →
// nested_component_reference → group_container → decoration → wrapper → unknown.
function classifyLayer(name, taxonomy) {
  const lc = name.toLowerCase()
  for (const re of taxonomy.ignoredPatterns) if (re.test(name)) return { type: 'ignored' }
  for (const { re, token } of taxonomy.placeholderResolutions) if (re.test(name)) return { type: 'placeholder_resolution', token }
  if (taxonomy.slots.has(lc)) return { type: 'slot', config: taxonomy.slots.get(lc) }
  if (taxonomy.chromeAutoFields.has(lc)) return { type: 'chrome_auto', config: taxonomy.chromeAutoFields.get(lc) }
  // Nested section reference: `<Family> N` where Family is in
  // families_allowed and we encounter it INSIDE another section. Treat
  // as a reference to that section's template rather than as an
  // unknown slot. Two flavors:
  //   - Component (Card N) → palette reference (item_template_ref = 'from_palette')
  //   - Chrome (Offcanvas N inside Header) → section reference (item_template_ref = 'section_ref')
  //   - Any other allowed family nested → section reference too
  const familyMatch = name.match(/^(.+?) (\d+)$/)
  if (familyMatch) {
    const familyLc = familyMatch[1].trim().toLowerCase()
    const canonical = taxonomy.allowedFamilies.get(familyLc)
    if (canonical) {
      const kind = matchSectionKind(name, taxonomy)
      return {
        type: 'nested_section_reference',
        referenced_family: canonical,
        referenced_id: kebabCase(name),
        referenced_kind: kind,
      }
    }
  }
  // Bare Offcanvas without a number, nested inside Header
  if (lc === 'offcanvas') {
    return {
      type: 'nested_section_reference',
      referenced_family: 'Offcanvas',
      referenced_id: 'offcanvas',
      referenced_kind: 'chrome',
    }
  }
  // Single-instance numbered group container: `List Element 5`,
  // `Gallery Element 5` — the stripped form matches a known group
  // container even though there's only one instance present.
  if (familyMatch) {
    const strippedLc = familyMatch[1].trim().toLowerCase()
    if (taxonomy.groupContainers.has(strippedLc)) {
      return { type: 'group_container_hint' }
    }
  }
  if (taxonomy.groupContainers.has(lc)) return { type: 'group_container_hint' }
  for (const re of taxonomy.decorationPatterns) if (re.test(name)) return { type: 'decoration' }
  for (const re of taxonomy.wrapperPatterns) if (re.test(name)) return { type: 'wrapper' }
  for (const marker of taxonomy.placeholderMarkers) {
    if (name.includes(marker)) return { type: 'placeholder_marker' }
  }
  return { type: 'unknown' }
}

// ── HTML preprocessing ────────────────────────────────────────────────

function stripRtfWrapper(raw) {
  // Brixies HTML can wrap div opening across multiple lines:
  //   <div\n  data-layer="..."
  // So we look for the first `<div` whose first attribute (after any
  // whitespace) is data-layer=. The string indexOf for `<div data-layer=`
  // would skip past these and land on a nested same-line match.
  const m = raw.match(/<div\s+data-layer=/)
  return m ? raw.slice(m.index) : raw
}

// Find section roots in document order. Only matches `<Family> N` where
// Family is in families_allowed. Recurses through layout wrappers that
// don't carry a data-layer.
function findSectionRoots(rootNode, taxonomy) {
  const out = []
  function walkTopLevel(node) {
    for (const child of node.childNodes || []) {
      if (!child.tagName) continue
      const dataLayer = child.getAttribute?.('data-layer')
      if (dataLayer) {
        const m = dataLayer.match(/^(.+?) (\d+)$/)
        if (m) {
          const familyDetected = m[1].trim()
          const variant = m[2]
          const canonical = taxonomy.allowedFamilies.get(familyDetected.toLowerCase())
          if (canonical) {
            out.push({ family: canonical, variant, layerName: dataLayer, node: child })
            continue
          }
        }
        // Offcanvas may appear without a trailing number
        if (dataLayer.toLowerCase() === 'offcanvas' && taxonomy.allowedFamilies.has('offcanvas')) {
          out.push({ family: 'Offcanvas', variant: '', layerName: dataLayer, node: child })
          continue
        }
      }
      walkTopLevel(child)
    }
  }
  walkTopLevel(rootNode)
  return out
}

// ── Slug helpers ──────────────────────────────────────────────────────

function kebabCase(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function slotKey(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

// ── DOM walker — extract fields (slots + groups) ─────────────────────

// Detect sibling groups under a parent node. A "group" is 2+ siblings
// at the same depth that should be cloned into N items.
//
// Two grouping passes:
//   1. EXACT match on data-layer (e.g. four `Card` siblings).
//   2. STRIPPED match — drop trailing ` \d+` and re-group, but only when
//      the stripped name is in the taxonomy's known group_container list
//      (e.g. `List Element 1`, `List Element 5` group as `List Element`).
//
// The stripped pass exists because Brixies inconsistently numbers
// group siblings — some templates emit `List Element 1`, `List Element
// 2`, ... instead of all `List Element`. Without this, our structural
// rule misses those groups.
function detectSiblingGroups(parentNode, taxonomy) {
  const byExact = new Map()
  const byStripped = new Map()
  for (const child of parentNode.childNodes || []) {
    if (!child.tagName) continue
    const dl = child.getAttribute?.('data-layer')
    if (!dl) continue
    if (!byExact.has(dl)) byExact.set(dl, [])
    byExact.get(dl).push(child)

    if (taxonomy) {
      const stripped = dl.replace(/ \d+$/, '')
      if (stripped !== dl && taxonomy.groupContainers.has(stripped.toLowerCase())) {
        if (!byStripped.has(stripped)) byStripped.set(stripped, [])
        byStripped.get(stripped).push(child)
      }
    }
  }
  const groups = new Map()
  for (const [layer, nodes] of byExact) {
    if (nodes.length >= 2) groups.set(layer, nodes)
  }
  for (const [stripped, nodes] of byStripped) {
    // Don't double-group a child that's already in an exact match.
    if (nodes.length >= 2 && !groups.has(stripped)) {
      groups.set(stripped, nodes)
    }
  }
  return groups
}

function computeScopeQualifier(parentChain, taxonomy) {
  for (let i = parentChain.length - 1; i >= 0; i--) {
    const parent = parentChain[i]
    if (!parent) continue
    if (taxonomy.scopedKeyParents.has(parent.toLowerCase())) return slotKey(parent)
  }
  return null
}

function walkNode(node, taxonomy, parentChain, discovery) {
  const fields = []
  if (!node.childNodes) return fields

  const siblingGroups = detectSiblingGroups(node, taxonomy)
  const handledAsGroup = new Set()

  for (const child of node.childNodes) {
    if (!child.tagName) continue
    const dl = child.getAttribute?.('data-layer')
    if (!dl) {
      fields.push(...walkNode(child, taxonomy, parentChain, discovery))
      continue
    }

    // Sibling-group case — emit once from the first sibling.
    // Group key may be the exact data-layer OR a stripped form (e.g.
    // "List Element" for `List Element 1`, `List Element 5`).
    const strippedForm = dl.replace(/ \d+$/, '')
    let groupKey = null
    if (siblingGroups.has(dl)) groupKey = dl
    else if (strippedForm !== dl && siblingGroups.has(strippedForm)) groupKey = strippedForm

    if (groupKey && !handledAsGroup.has(groupKey)) {
      handledAsGroup.add(groupKey)
      const siblings = siblingGroups.get(groupKey)
      const itemSchema = walkNode(siblings[0], taxonomy, [...parentChain, groupKey], discovery)
      fields.push({
        kind: 'group',
        key: slotKey(groupKey),
        layer_name: groupKey,
        default_count: siblings.length,
        item_schema: itemSchema,
        // When the group was detected via the stripped form, note that
        // Brixies numbered the siblings non-uniformly. Useful for
        // renderer/Figma debugging.
        ...(groupKey !== dl ? { numbered_sibling_variants: true } : {}),
      })
      continue
    }
    if (handledAsGroup.has(groupKey)) continue
    if (handledAsGroup.has(strippedForm)) continue // skip subsequent siblings of a stripped group

    const klass = classifyLayer(dl, taxonomy)

    switch (klass.type) {
      case 'ignored':
      case 'decoration':
      case 'placeholder_marker':
        break

      case 'placeholder_resolution': {
        const key = slotKey(dl)
        const scoped = computeScopeQualifier(parentChain, taxonomy)
        fields.push({
          kind: 'slot',
          key: scoped ? `${key}_${scoped}` : key,
          layer_name: dl,
          type: 'text',
          default_value: klass.token,
          source: 'global_site_snippet',
        })
        break
      }

      case 'chrome_auto': {
        fields.push({
          kind: 'slot',
          key: slotKey(klass.config.name),
          layer_name: dl,
          type: klass.config.type,
          source: klass.config.source,
          auto_populated: true,
        })
        break
      }

      case 'nested_section_reference': {
        // A reference to another section/component, encountered inside
        // this section. Two flavors:
        //   - component-kind ⇒ palette reference (item_template_ref =
        //     'from_palette') so the renderer fills with the project's
        //     chosen card from the palette
        //   - other kinds (chrome / content / etc.) ⇒ direct reference
        //     to the referenced template (item_template_ref = 'section_ref')
        const isComponent = klass.referenced_kind === 'component'
        fields.push({
          kind: 'group',
          key: slotKey(dl),
          layer_name: dl,
          default_count: 1,
          item_template_ref: isComponent ? 'from_palette' : 'section_ref',
          referenced_template_id: klass.referenced_id,
          referenced_family: klass.referenced_family,
          referenced_kind: klass.referenced_kind,
        })
        break
      }

      case 'slot': {
        const cfg = klass.config
        const baseKey = slotKey(cfg.name)
        const scoped = computeScopeQualifier(parentChain, taxonomy)
        const headingLevel = taxonomy.headingLevels[cfg.name] ?? null
        const { name: _unused, ...cfgWithoutName } = cfg
        fields.push({
          kind: 'slot',
          key: scoped ? `${baseKey}_${scoped}` : baseKey,
          layer_name: dl,
          ...cfgWithoutName,
          ...(headingLevel != null ? { heading_level: headingLevel } : {}),
        })
        break
      }

      case 'group_container_hint': {
        const itemSchema = walkNode(child, taxonomy, [...parentChain, dl], discovery)
        fields.push({
          kind: 'group',
          key: slotKey(dl),
          layer_name: dl,
          default_count: 1,
          item_schema: itemSchema,
          single_instance_hint: true,
        })
        break
      }

      case 'wrapper': {
        fields.push(...walkNode(child, taxonomy, [...parentChain, dl], discovery))
        break
      }

      case 'unknown':
      default: {
        discovery.unknownLayers.set(dl, (discovery.unknownLayers.get(dl) || 0) + 1)
        const key = slotKey(dl)
        const scoped = computeScopeQualifier(parentChain, taxonomy)
        fields.push({
          kind: 'slot',
          key: scoped ? `${key}_${scoped}` : key,
          layer_name: dl,
          type: 'text',
          unmapped: true,
        })
        fields.push(...walkNode(child, taxonomy, [...parentChain, dl], discovery))
        break
      }
    }
  }

  // Dedupe slots by key at the same level — keep first.
  const seen = new Set()
  return fields.filter(f => {
    if (f.kind === 'group') return true
    if (seen.has(f.key)) return false
    seen.add(f.key)
    return true
  })
}

// ── Section kind + paired post template ──────────────────────────────

function matchSectionKind(layerName, taxonomy) {
  for (const { re, kind } of taxonomy.sectionKindRules) {
    if (re.test(layerName)) return kind
  }
  return 'content'
}

function lookupPostTemplatePair(family, taxonomy) {
  for (const [listing, pairInfo] of Object.entries(taxonomy.postTemplatePairs)) {
    if (listing.toLowerCase() === family.toLowerCase()) return pairInfo
  }
  return null
}

// ── source_html trimming — keep one instance per group ───────────────

function trimSourceHtml(rootNode, taxonomy) {
  function walk(node) {
    if (!node.childNodes) return
    const groups = detectSiblingGroups(node, taxonomy)
    for (const siblings of groups.values()) {
      for (let i = 1; i < siblings.length; i++) siblings[i].remove()
    }
    for (const child of node.childNodes) {
      if (child.tagName) walk(child)
    }
  }
  walk(rootNode)
  return rootNode.outerHTML
}

// ── Build full template object ───────────────────────────────────────

function buildTemplate(root, taxonomy, discovery) {
  const fields = walkNode(root.node, taxonomy, [root.layerName], discovery)
  const kind = matchSectionKind(root.layerName, taxonomy)
  const pair = lookupPostTemplatePair(root.family, taxonomy)

  const cloneRoot = parseHtml(root.node.outerHTML)
  const cloneSection = cloneRoot.firstChild
  const sourceHtml = trimSourceHtml(cloneSection, taxonomy)

  return {
    id: kebabCase(root.layerName),
    family: root.family,
    variant: root.variant,
    layer_name: root.layerName,
    kind,
    fields,
    paired_post_template: pair?.single ?? null,
    paired_url_pattern: pair?.url_pattern ?? null,
    source_html: sourceHtml,
  }
}

// ── Supabase writer ──────────────────────────────────────────────────

async function getSupabaseClient() {
  // Lazy-load env vars only when we're actually going to write. Vite
  // convention is .env.local for secrets (it overrides .env at build
  // time); we check both.
  for (const envFile of ['.env.local', '.env']) {
    const envPath = path.join(projectRoot, envFile)
    if (!fs.existsSync(envPath)) continue
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n')
    for (const line of lines) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
      if (!m) continue
      const [, k, vRaw] = m
      if (!process.env[k]) {
        const v = vRaw.replace(/^["']|["']$/g, '')
        process.env[k] = v
      }
    }
  }
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars (checked .env). Service role required for upsert.')
  }
  return createClient(url, key, { auth: { persistSession: false } })
}

async function upsertTemplate(supabase, tpl) {
  const row = {
    id: tpl.id,
    family: tpl.family,
    variant: tpl.variant,
    layer_name: tpl.layer_name,
    kind: tpl.kind,
    fields: tpl.fields,
    paired_post_template: tpl.paired_post_template,
    paired_url_pattern: tpl.paired_url_pattern,
    source_html: tpl.source_html,
  }
  const { error } = await supabase
    .from('web_content_templates')
    .upsert(row, { onConflict: 'id' })
  if (error) throw new Error(`Upsert ${tpl.id}: ${error.message}`)
}

// ── JPG preview ingestion ────────────────────────────────────────────

async function uploadPreview(supabase, templateId, jpgPath) {
  const buf = fs.readFileSync(jpgPath)
  const storagePath = `web-templates/${templateId}.jpg`
  const { error: uploadErr } = await supabase.storage
    .from('brand-assets')
    .upload(storagePath, buf, { contentType: 'image/jpeg', upsert: true })
  if (uploadErr) throw new Error(`Upload ${templateId}.jpg: ${uploadErr.message}`)
  const { data: pub } = supabase.storage.from('brand-assets').getPublicUrl(storagePath)
  const { error: updErr } = await supabase
    .from('web_content_templates')
    .update({ preview_image_url: pub.publicUrl })
    .eq('id', templateId)
  if (updErr) throw new Error(`Set preview_image_url ${templateId}: ${updErr.message}`)
  return pub.publicUrl
}

// ── Main entry point ─────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.inputs.length === 0) {
    console.error('Usage: node scripts/import-brixies-catalog.mjs <path1> [path2 ...] [--dry] [--previews <dir>] [--family <name>] [--report-only]')
    process.exit(1)
  }

  const taxonomy = loadTaxonomy()
  const discovery = { unknownLayers: new Map(), filesProcessed: 0, emptyFiles: [] }
  const templates = []

  for (const input of opts.inputs) {
    if (!fs.existsSync(input)) {
      console.error(`! Skipping (not found): ${input}`)
      continue
    }
    const raw = fs.readFileSync(input, 'utf-8')
    const html = stripRtfWrapper(raw)
    const root = parseHtml(html)
    const sectionRoots = findSectionRoots(root, taxonomy)
    discovery.filesProcessed++

    if (sectionRoots.length === 0) {
      // Likely the Brixies export bug: parent wrapper has no family
      // title (file starts with `Breakpoint=Desktop` or a generic Frame).
      // Surface the first data-layer we found so the user can confirm.
      let firstLayer = '(none found)'
      for (const c of root.childNodes || []) {
        const dl = c.tagName ? c.getAttribute?.('data-layer') : null
        if (dl) { firstLayer = dl; break }
      }
      discovery.emptyFiles.push({ input, firstLayer })
    }

    for (const r of sectionRoots) {
      if (opts.family && r.family.toLowerCase() !== opts.family.toLowerCase()) continue
      const tpl = buildTemplate(r, taxonomy, discovery)
      templates.push(tpl)
    }
  }

  console.log(`\n━━ Discovery ━━`)
  console.log(`Files processed:   ${discovery.filesProcessed}`)
  console.log(`Templates parsed:  ${templates.length}`)
  console.log(`Unknown layers:    ${discovery.unknownLayers.size}`)
  if (discovery.emptyFiles.length > 0) {
    console.log(`\n⚠  Files with NO section roots found (${discovery.emptyFiles.length}):`)
    console.log(`   Likely cause: Brixies export missing the family wrapper title.`)
    console.log(`   Action: re-save the file in Brixies so the parent <div data-layer> matches a real family.`)
    for (const ef of discovery.emptyFiles) {
      console.log(`     ${path.relative(projectRoot, ef.input)}`)
      console.log(`       first data-layer found: "${ef.firstLayer}"`)
    }
  }
  if (discovery.unknownLayers.size > 0) {
    console.log(`\nUnknown layer names (count):`)
    const sorted = [...discovery.unknownLayers.entries()].sort((a, b) => b[1] - a[1])
    for (const [name, count] of sorted.slice(0, 30)) {
      console.log(`  ${count.toString().padStart(4)}  ${name}`)
    }
    if (sorted.length > 30) console.log(`  ... and ${sorted.length - 30} more`)
  }

  const byKind = templates.reduce((m, t) => { m[t.kind] = (m[t.kind] || 0) + 1; return m }, {})
  console.log(`\nBy kind:`)
  for (const [k, v] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${v.toString().padStart(4)}  ${k}`)
  }

  const byFamily = templates.reduce((m, t) => { m[t.family] = (m[t.family] || 0) + 1; return m }, {})
  console.log(`\nBy family:`)
  for (const [k, v] of Object.entries(byFamily).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${v.toString().padStart(4)}  ${k}`)
  }

  if (opts.reportOnly) {
    console.log(`\n--report-only set; no writes.`)
    return
  }

  if (opts.dry) {
    console.log(`\n--dry set; previewing first 3 templates:`)
    for (const tpl of templates.slice(0, 3)) {
      console.log(`\n${'━'.repeat(60)}`)
      console.log(`${tpl.id}  (${tpl.kind})`)
      const sourceHtmlLen = tpl.source_html.length
      const { source_html, ...preview } = tpl
      console.log(JSON.stringify(preview, null, 2))
      console.log(`source_html: ${sourceHtmlLen} bytes (trimmed)`)
    }
    console.log(`\n--dry set; ${templates.length} templates would be upserted. No writes performed.`)
    return
  }

  const supabase = await getSupabaseClient()
  let upserts = 0, errors = 0
  for (const tpl of templates) {
    try {
      await upsertTemplate(supabase, tpl)
      upserts++
    } catch (err) {
      console.error(`✗ ${tpl.id}: ${err.message}`)
      errors++
    }
  }
  console.log(`\nUpserted: ${upserts}  Errors: ${errors}`)

  if (opts.previewsDir) {
    if (!fs.existsSync(opts.previewsDir)) {
      console.warn(`! Previews dir not found: ${opts.previewsDir}`)
    } else {
      console.log(`\nIngesting previews from ${opts.previewsDir} (recursive)...`)
      // Walk the directory tree recursively and collect every .jpg / .jpeg.
      // The filename stem (e.g. "feature-section-3") is matched against
      // the set of template ids we just imported.
      const allJpgs = []
      function walk(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.name.startsWith('.')) continue
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) walk(full)
          else if (entry.isFile() && /\.jpe?g$/i.test(entry.name)) allJpgs.push(full)
        }
      }
      walk(opts.previewsDir)

      const idsInRun = new Set(templates.map(t => t.id))
      const matched = []
      const unmatched = []
      for (const f of allJpgs) {
        const idFromFilename = kebabCase(path.basename(f, path.extname(f)))
        if (idsInRun.has(idFromFilename)) matched.push({ id: idFromFilename, file: f })
        else unmatched.push(f)
      }
      console.log(`  JPGs found:  ${allJpgs.length}`)
      console.log(`  Matched:     ${matched.length}`)
      console.log(`  Unmatched:   ${unmatched.length}`)

      let uploaded = 0, failed = 0
      for (const { id, file } of matched) {
        try {
          await uploadPreview(supabase, id, file)
          uploaded++
          if (uploaded % 25 === 0) console.log(`    ${uploaded} / ${matched.length} uploaded…`)
        } catch (err) {
          console.error(`✗ Preview ${id}: ${err.message}`)
          failed++
        }
      }
      console.log(`  Uploaded:    ${uploaded}`)
      console.log(`  Failed:      ${failed}`)
      if (unmatched.length > 0) {
        console.log(`\n  Unmatched preview files (rename to match a template id):`)
        for (const f of unmatched.slice(0, 30)) console.log(`    ${path.relative(projectRoot, f)}`)
        if (unmatched.length > 30) console.log(`    ... and ${unmatched.length - 30} more`)
      }
    }
  }
}

main().catch(err => { console.error(err); process.exit(1) })
