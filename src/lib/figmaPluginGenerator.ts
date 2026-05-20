/**
 * Figma plugin script generators — emit two self-contained .js
 * payloads the designer pastes into Figma's plugin console (Main
 * Menu → Plugins → Development → Open Console). Both target the
 * Brixies team-library workflow:
 *
 *   1. Style Guide — `generateStyleGuidePlugin`
 *      Builds a "📐 [Project] · Style Guide" vertical auto-layout
 *      frame and drops one instance of every Brixies template the
 *      project uses (deduped), grouped by family. The designer gets
 *      a single canvas with the full section + chrome inventory.
 *
 *   2. Pages — `generatePagesPlugin`
 *      Builds one "📄 [Page Name]" frame per project page, stacking
 *      section component instances in sort_order. Each instance gets
 *      its text nodes populated by matching `data-layer` (or layer
 *      name) against the section's `field_values` text_map.
 *
 * Both scripts use `figma.importComponentByKeyAsync(key)` →
 * `component.createInstance()` so the design lives in the team
 * library; the script never edits library content. Templates without
 * a `figma_component_key` are skipped at runtime with a console
 * warning.
 *
 * Known limitations (first slice):
 *   • Text population is layer-name-keyed and matches the FIRST
 *     instance child with that name. Repeated groups (multiple cards
 *     under one section) won't fan out — the first card's text gets
 *     written, the rest stay as the library defaults.
 *   • Palette-referenced cards are rendered as their default Figma
 *     component (whatever the team library has set up); the picked
 *     `__palette_template_id` does not yet drive an instance swap.
 *   • Image, CTA, and group slot population are out of scope for v1.
 *     Phase 5 can layer in instance-property routing + nested-component
 *     instance swaps for cards.
 */

import type { WebContentTemplate, WebSection, WebFieldDef } from '../types/database'

// ── Public types ───────────────────────────────────────────────────

/** The bare minimum the plugin needs to find a template's component
 *  inside the project's local Style Guide frame: just the layer name
 *  the designer used. (We try both the layer_name from the catalog
 *  AND a few common variants — see lookupByName in the runtime.) */
export interface PluginTemplateRow {
  id: string
  layer_name: string
  family: string
}

export interface PluginSectionData {
  template_id: string
  /** Display name the plugin uses to find the matching component in
   *  the Style Guide frame. Falls back to `template_id` if the
   *  catalog's layer name was empty. */
  template_name: string
  /** Pre-resolved `{ figmaLayerName: stringValue }` map. Computed by
   *  `buildTextMapForSection` against the section's `field_values`
   *  and the template's augmented schema. */
  text_map: Record<string, string>
}

export interface PluginPageData {
  name: string
  slug: string
  sections: PluginSectionData[]
}

export interface PluginMeta {
  projectName: string
  generatedAt: string
  /** Node id of the project's "Style Guide" frame in Figma (e.g.
   *  `1:23`). Required — the plugin uses this to locate the frame
   *  and walks its children to find each template by name. */
  styleGuideNodeId: string
  /** Optional file key for the runtime to verify the script is
   *  pasted into the right file. Surfaced as a console.warn if the
   *  current file doesn't match. */
  figmaFileKey?: string
}

// ── Text-map builder ───────────────────────────────────────────────

/** Walk an (augmented) template schema + the section's field_values
 *  and produce a flat `{ layer_name: stringValue }` map the plugin
 *  uses to find + update Figma text nodes inside the component
 *  instance.
 *
 *  Rules:
 *   • text slot   → values[slot.key] as string
 *   • richtext    → plain-text from HTML (tags stripped)
 *   • cta         → values[slot.key].label
 *   • image       → skipped (image placeholders aren't text)
 *   • group       → recurse into the FIRST item only — first-pass
 *                   limitation noted in the module header.
 *
 *  `{{token}}` snippet substitution happens upstream (callers can
 *  swap with resolved values before passing in); if the value still
 *  contains a `{{token}}`, the plugin will write it literally so the
 *  designer sees what's unresolved. */
export function buildTextMapForSection(
  template: WebContentTemplate,
  values: Record<string, unknown>,
  snippetMap?: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {}
  walkFieldsForText(template.fields, values, out, snippetMap ?? {})
  return out
}

function walkFieldsForText(
  fields: ReadonlyArray<WebFieldDef>,
  values: Record<string, unknown>,
  out: Record<string, string>,
  snippets: Record<string, string>,
): void {
  if (!Array.isArray(fields)) return
  for (const f of fields) {
    if (f.kind === 'slot') {
      const layer = f.layer_name ?? f.key
      if (!layer) continue
      const v = values[f.key]
      if (f.type === 'text') {
        if (typeof v === 'string' && v.trim() !== '') {
          out[layer] = resolveSnippets(v, snippets)
        }
      } else if (f.type === 'richtext') {
        if (typeof v === 'string' && v.trim() !== '') {
          out[layer] = resolveSnippets(stripHtml(v), snippets)
        }
      } else if (f.type === 'cta') {
        const obj = (v && typeof v === 'object' ? v : null) as { label?: unknown } | null
        if (obj && typeof obj.label === 'string' && obj.label.trim() !== '') {
          out[layer] = resolveSnippets(obj.label, snippets)
        }
      }
      // image / form-input / boolean / url / email / phone / datetime:
      // not text, skip.
    } else if (f.kind === 'group') {
      // Palette ref groups: recurse into `items` array via the
      // referenced template — but the referenced template isn't in
      // scope here, so we punt. The card's library component carries
      // its own defaults; first-slice limitation.
      if (f.item_template_ref) continue

      // Standard group: recurse into the FIRST item only. Multi-card
      // fan-out via Figma instance cloning needs the picked card
      // template's schema, which lives one level deeper.
      const items = Array.isArray(values[f.key])
        ? values[f.key] as Array<Record<string, unknown>>
        : []
      const first = items[0]
      if (first) walkFieldsForText(f.item_schema ?? [], first, out, snippets)
    }
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function resolveSnippets(text: string, snippets: Record<string, string>): string {
  return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (whole, token) => {
    const v = snippets[token]
    return v != null && v !== '' ? v : whole
  })
}

// ── Helpers for collecting plugin inputs from DB rows ─────────────

/** Strip a catalog row down to the shape the plugin generator needs.
 *  No filtering — every used template gets emitted; templates whose
 *  layer_name doesn't match a node in the Style Guide frame are
 *  skipped at runtime with a console warning. */
export function toPluginTemplateRow(
  t: Pick<WebContentTemplate, 'id' | 'layer_name' | 'family'>,
): PluginTemplateRow {
  return { id: t.id, layer_name: t.layer_name, family: t.family }
}

/** Build the per-page section data the Pages plugin needs. Caller
 *  is responsible for joining `web_sections` to their templates. */
export function buildPageData(
  pageName: string,
  pageSlug: string,
  sections: ReadonlyArray<{
    section: WebSection
    template: WebContentTemplate
  }>,
  snippetMap?: Record<string, string>,
): PluginPageData {
  return {
    name: pageName,
    slug: pageSlug,
    sections: sections.map(({ section, template }) => ({
      template_id:   template.id,
      template_name: template.layer_name || template.id,
      text_map: buildTextMapForSection(
        template,
        (section.field_values ?? {}) as Record<string, unknown>,
        snippetMap,
      ),
    })),
  }
}

// ── Plugin script generators ───────────────────────────────────────

// The shared runtime walks the project's local Style Guide frame
// (provided as a node id) instead of importing from a team library.
// `findComponentByName` accepts either a Component / ComponentSet (in
// which case it instantiates) or any other node (which it clones).
//
// The runtime is shared between the Style Guide and Pages scripts —
// they both need the same lookup logic.
const SHARED_RUNTIME = `
// ── Shared runtime ──────────────────────────────────────────────
function normalizeName(s) {
  return String(s || '').toLowerCase().replace(/[\\s_\\-·•—–]+/g, '');
}

async function safeSetText(node, value) {
  if (!node || node.type !== 'TEXT' || value == null || value === '') return;
  try {
    const fonts = node.getRangeAllFontNames(0, node.characters.length);
    await Promise.all(fonts.map((f) => figma.loadFontAsync(f)));
    node.characters = String(value);
  } catch (e) {
    console.warn('safeSetText failed on "' + (node.name || '?') + '":', e.message);
  }
}

// Walks an instance's subtree for every TEXT node whose name
// matches a key in textMap (case- and separator-insensitive).
async function populateInstanceText(instance, textMap) {
  const targets = new Map();
  for (const [layer, value] of Object.entries(textMap || {})) {
    targets.set(normalizeName(layer), value);
  }
  if (targets.size === 0) return;
  const matched = new Set();
  const allText = (instance.findAll
    ? instance.findAll((n) => n.type === 'TEXT')
    : []);
  for (const node of allText) {
    const norm = normalizeName(node.name);
    const value = targets.get(norm);
    if (value != null && !matched.has(norm)) {
      await safeSetText(node, value);
      matched.add(norm);
    }
  }
}

// Locate the Style Guide frame by node id (the id is baked in at
// generation time). Resolves the page if needed and returns the
// SceneNode.
async function resolveStyleGuideFrame(nodeId) {
  // figma.getNodeByIdAsync is preferred (Figma's newer async-only
  // model); fall back to getNodeById for older runtimes.
  let node = null;
  if (typeof figma.getNodeByIdAsync === 'function') {
    try { node = await figma.getNodeByIdAsync(nodeId); } catch (e) { /* fallthrough */ }
  }
  if (!node && typeof figma.getNodeById === 'function') {
    node = figma.getNodeById(nodeId);
  }
  if (!node) {
    figma.notify('Style Guide frame not found in this file. Are you in the right Figma file?', { error: true });
    return null;
  }
  return node;
}

// Build a name → component map by walking the Style Guide frame's
// descendants. Picks COMPONENT or COMPONENT_SET nodes by their visible
// name. When a name collision occurs, the first match wins.
function indexStyleGuide(frame) {
  const out = new Map();
  if (!frame || !frame.findAll) return out;
  const candidates = frame.findAll((n) =>
    n.type === 'COMPONENT' || n.type === 'COMPONENT_SET' || n.type === 'FRAME'
  );
  for (const node of candidates) {
    const key = normalizeName(node.name);
    if (key && !out.has(key)) out.set(key, node);
  }
  return out;
}

// Place a copy of the Brixies layout into the target parent. If the
// source is a Component / ComponentSet → createInstance(); otherwise
// → clone() so plain frames still work.
function placeFrom(source, parent) {
  if (!source) return null;
  let node = null;
  if (source.type === 'COMPONENT') {
    node = source.createInstance();
  } else if (source.type === 'COMPONENT_SET') {
    // Use the default variant of a component set.
    const def = source.defaultVariant || (source.children && source.children[0]);
    if (def && def.type === 'COMPONENT') node = def.createInstance();
  } else {
    node = source.clone();
  }
  if (node) parent.appendChild(node);
  return node;
}
`

/** Generates the Style Guide plugin script — places one instance of
 *  every template (looked up by name inside the local Style Guide
 *  frame) into a "Project Style Guide" frame, grouped by family.
 *
 *  Designer workflow this powers:
 *    1. Open the project's Figma file (which has a local Style Guide
 *       frame containing local components for each used Brixies layout).
 *    2. Paste this script into the plugin console.
 *    3. The script reads the Style Guide frame, walks children, and
 *       lays out a grouped overview frame next to it. */
export function generateStyleGuidePlugin(
  templates: ReadonlyArray<PluginTemplateRow>,
  meta: PluginMeta,
): string {
  const byFamily = new Map<string, PluginTemplateRow[]>()
  for (const t of templates) {
    if (!byFamily.has(t.family)) byFamily.set(t.family, [])
    byFamily.get(t.family)!.push(t)
  }
  const familyOrder = [...byFamily.entries()].sort((a, b) => {
    if (b[1].length !== a[1].length) return b[1].length - a[1].length
    return a[0].localeCompare(b[0])
  })
  const families = familyOrder.map(([family, rows]) => ({
    family,
    rows: rows.map(t => ({ id: t.id, layer_name: t.layer_name })),
  }))

  return `// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Brixies Style Guide assembler  (local-frame mode)
// Project:    ${escapeJs(meta.projectName)}
// Generated:  ${meta.generatedAt}
// Templates:  ${templates.length} (across ${families.length} families)
// Style Guide frame: ${meta.styleGuideNodeId}
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// PREREQUISITES (do these in Figma first):
//   1. Open the project's Figma file.
//   2. From the Brixies team library, drag every layout the project
//      uses into this file. Right-click each → "Detach instance".
//   3. Wrap each detached layout in a NEW local component
//      (Component → Create component, or Cmd+Opt+K). The component
//      name MUST match the Brixies layer name verbatim
//      (e.g. "Feature Section 2", "Card 213", "Hero Section 87").
//   4. Place every new component inside ONE auto-layout frame
//      named "Style Guide". Copy that frame's URL or node id; the
//      generator baked it in below as STYLE_GUIDE_NODE_ID.
//
// PASTE INTO: Main Menu → Plugins → Development → Open Console
// (in this same Figma file). The script never modifies the Style
// Guide frame — it only reads from it and creates a new
// "Project Style Guide" frame beside it.

(async () => {
${SHARED_RUNTIME}
const STYLE_GUIDE_NODE_ID = ${JSON.stringify(meta.styleGuideNodeId)};
const FAMILIES = ${JSON.stringify(families, null, 2)};

figma.notify('Loading Style Guide frame…', { timeout: 1500 });
const sg = await resolveStyleGuideFrame(STYLE_GUIDE_NODE_ID);
if (!sg) { figma.closePlugin('Style Guide frame not found.'); return; }
const index = indexStyleGuide(sg);

const root = figma.createFrame();
root.name = '📐 ${escapeJs(meta.projectName)} · Project Style Guide';
root.layoutMode = 'VERTICAL';
root.primaryAxisSizingMode = 'AUTO';
root.counterAxisSizingMode = 'AUTO';
root.itemSpacing = 80;
root.paddingTop = 120;
root.paddingBottom = 120;
root.paddingLeft = 120;
root.paddingRight = 120;
root.fills = [{ type: 'SOLID', color: { r: 0.98, g: 0.96, b: 0.94 } }];
root.x = (sg.absoluteBoundingBox ? sg.absoluteBoundingBox.x + (sg.width || 0) + 200 : 0);
root.y = (sg.absoluteBoundingBox ? sg.absoluteBoundingBox.y : 0);
figma.currentPage.appendChild(root);

let placed = 0, missing = 0;
const missingNames = [];

for (const family of FAMILIES) {
  const group = figma.createFrame();
  group.name = family.family;
  group.layoutMode = 'VERTICAL';
  group.primaryAxisSizingMode = 'AUTO';
  group.counterAxisSizingMode = 'AUTO';
  group.itemSpacing = 40;
  group.fills = [];
  root.appendChild(group);

  await figma.loadFontAsync({ family: 'Inter', style: 'Bold' });
  const header = figma.createText();
  header.fontName = { family: 'Inter', style: 'Bold' };
  header.fontSize = 32;
  header.characters = family.family + ' · ' + family.rows.length;
  header.fills = [{ type: 'SOLID', color: { r: 0.2, g: 0.1, b: 0.34 } }];
  group.appendChild(header);

  for (const row of family.rows) {
    const source = index.get(normalizeName(row.layer_name));
    if (!source) {
      console.warn('  ⚠ Style Guide is missing: "' + row.layer_name + '" — skipped');
      missingNames.push(row.layer_name);
      missing++;
      continue;
    }
    const node = placeFrom(source, group);
    if (node) {
      node.name = row.layer_name;
      placed++;
    } else { missing++; }
  }
}

figma.viewport.scrollAndZoomIntoView([root]);
const summary = '🎉 Project Style Guide ready — ' + placed + ' placed, ' + missing + ' missing.';
figma.notify(summary, { timeout: 8000 });
if (missingNames.length > 0) {
  console.log('\\nMissing components (not found in Style Guide frame):');
  for (const n of missingNames) console.log('  · ' + n);
  console.log('\\nFix: add a component with this exact name to the Style Guide frame, then re-run.');
}
figma.closePlugin();
})();
`
}

/** Generates the Pages plugin script — builds one frame per project
 *  page by walking the local Style Guide and placing instances of
 *  each section's template by name, then populating text nodes from
 *  field_values. */
export function generatePagesPlugin(
  _templates: ReadonlyArray<PluginTemplateRow>,
  pages: ReadonlyArray<PluginPageData>,
  meta: PluginMeta,
): string {
  const pluginPages = pages.map(p => ({
    name: p.name,
    slug: p.slug,
    sections: p.sections.map(s => ({
      template_id:   s.template_id,
      template_name: s.template_name,
      text_map:      s.text_map,
    })),
  }))

  return `// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Brixies Pages assembler  (local-frame mode)
// Project:    ${escapeJs(meta.projectName)}
// Generated:  ${meta.generatedAt}
// Pages:      ${pluginPages.length}
// Style Guide frame: ${meta.styleGuideNodeId}
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// PREREQUISITES: the project's Figma file must contain a Style Guide
// frame whose children are local components named after each used
// Brixies layout (Feature Section 2, Card 213, Hero Section 87, etc.).
// See the Style Guide assembler script header for the full setup.
//
// PASTE INTO: Main Menu → Plugins → Development → Open Console
// (in the same Figma file as the Style Guide frame). The script
// creates one page frame per project page beside the Style Guide.

(async () => {
${SHARED_RUNTIME}
const STYLE_GUIDE_NODE_ID = ${JSON.stringify(meta.styleGuideNodeId)};
const PAGES = ${JSON.stringify(pluginPages, null, 2)};

figma.notify('Loading Style Guide frame…', { timeout: 1500 });
const sg = await resolveStyleGuideFrame(STYLE_GUIDE_NODE_ID);
if (!sg) { figma.closePlugin('Style Guide frame not found.'); return; }
const index = indexStyleGuide(sg);

let cursorX = (sg.absoluteBoundingBox ? sg.absoluteBoundingBox.x : 0);
let cursorY = (sg.absoluteBoundingBox ? sg.absoluteBoundingBox.y + (sg.height || 0) + 400 : 0);

let totalPlaced = 0, totalMissing = 0;
const missingNames = new Set();

for (const page of PAGES) {
  console.log('Building ' + page.name + ' (/' + page.slug + ')');
  figma.notify('Building ' + page.name + '…', { timeout: 3000 });

  const frame = figma.createFrame();
  frame.name = '📄 ' + page.name;
  frame.layoutMode = 'VERTICAL';
  frame.primaryAxisSizingMode = 'AUTO';
  frame.counterAxisSizingMode = 'FIXED';
  frame.resize(1512, 100);
  frame.itemSpacing = 0;
  frame.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  frame.x = cursorX;
  frame.y = cursorY;
  figma.currentPage.appendChild(frame);

  let placed = 0, missing = 0;
  for (const section of page.sections) {
    const source = index.get(normalizeName(section.template_name));
    if (!source) {
      console.warn('  ⚠ Section component not in Style Guide: "' + section.template_name + '" — skipped');
      missingNames.add(section.template_name);
      missing++;
      continue;
    }
    const node = placeFrom(source, frame);
    if (!node) { missing++; continue; }
    node.name = section.template_name;
    if (node.layoutAlign !== undefined) node.layoutAlign = 'STRETCH';
    await populateInstanceText(node, section.text_map);
    placed++;
  }
  console.log('  ✓ ' + placed + ' placed, ' + missing + ' missing');
  totalPlaced += placed; totalMissing += missing;

  cursorX += 1512 + 400;
}

figma.viewport.scrollAndZoomIntoView(figma.currentPage.children.filter((n) => n.name && n.name.indexOf('📄') === 0));
figma.notify('🎉 Pages assembled — ' + totalPlaced + ' placed, ' + totalMissing + ' missing across ' + PAGES.length + ' pages.', { timeout: 8000 });
if (missingNames.size > 0) {
  console.log('\\nMissing components (not found in Style Guide frame):');
  for (const n of missingNames) console.log('  · ' + n);
  console.log('\\nFix: add a component with this exact name to the Style Guide frame, then re-run.');
}
figma.closePlugin();
})();
`
}

function escapeJs(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')
}
