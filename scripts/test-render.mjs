// Test the renderer against a real template + field_values from DB.
// Uses jsdom to provide DOMParser etc. in Node.
//
// Usage: node scripts/test-render.mjs "Content Section 77"

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { JSDOM } from 'jsdom'

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

// Set up DOM globals for the renderer to use
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.DOMParser = dom.window.DOMParser
globalThis.Element = dom.window.Element
globalThis.Node = dom.window.Node
globalThis.NodeFilter = dom.window.NodeFilter

// Now we can import the renderer
const { renderSectionToHtml } = await import('../src/lib/webBrixiesRender.ts')
const { augmentTemplate } = await import('../src/lib/webBrixiesSchemaAugment.ts')

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
)

const name = process.argv[2]
if (!name) {
  console.error('Usage: node scripts/test-render.mjs "<layer_name>"')
  process.exit(1)
}

const { data: template } = await supabase
  .from('web_content_templates')
  .select('*')
  .eq('layer_name', name)
  .single()

const { data: sections } = await supabase
  .from('web_sections')
  .select('*')
  .eq('content_template_id', template.id)
  .limit(1)

if (!sections || sections.length === 0) {
  console.log('No sections found for this template')
  process.exit(0)
}

const section = sections[0]
console.log('Field values:')
console.log(JSON.stringify(section.field_values, null, 2))
console.log('\n--- Rendering ---\n')

const augmented = augmentTemplate(template)
console.log('=== Augmented schema ===')
const dumpSchema = (fields, depth = 0) => {
  for (const f of fields) {
    console.log('  '.repeat(depth) + f.kind + ':' + f.key + ' (layer=' + f.layer_name + (f.type ? ', type=' + f.type : '') + ')')
    if (f.kind === 'group' && Array.isArray(f.item_schema)) dumpSchema(f.item_schema, depth + 1)
  }
}
dumpSchema(augmented.fields)
console.log()
globalThis.__DEBUG_RENDER = true
const html = renderSectionToHtml(augmented, section.field_values, {})
globalThis.__DEBUG_RENDER = false

// Strip styles to make output readable
const cleanedHtml = html
  .replace(/style="[^"]*"/g, '')
  .replace(/\s+/g, ' ')

// Dump flex containers to check wrap status
const dumpDoc = new dom.window.DOMParser().parseFromString(html, 'text/html')
for (const el of dumpDoc.querySelectorAll('[data-layer]')) {
  const style = el.getAttribute('style') ?? ''
  if (/flex-wrap/i.test(style)) {
    console.log('  flex-wrap on', el.getAttribute('data-layer') + ':', style.match(/flex-wrap[^;]*/i)?.[0])
  }
}
console.log()

// Also dump full textContent for important elements
console.log('=== textContent of key elements ===')
const extraLayers = process.argv.slice(3) // pass layer names after the template
for (const layerName of [...['Card heading', 'Card description', 'Learn more', 'Card icon'], ...extraLayers]) {
  for (const el of dumpDoc.querySelectorAll(`[data-layer="${layerName}"]`)) {
    console.log(`  [${layerName}] textContent: "${(el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)}"`)
  }
}
console.log()

// Print only the elements with substantive text
const out = new dom.window.DOMParser().parseFromString(html, 'text/html')
const walker = (el, depth) => {
  if (!el || el.nodeType !== 1) return
  const layer = el.getAttribute('data-layer')
  if (layer) {
    const text = (Array.from(el.childNodes)
      .filter(c => c.nodeType === 3)
      .map(c => c.nodeValue ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()) || ''
    console.log(`${'  '.repeat(depth)}${layer}${text ? ': ' + text.slice(0, 80) : ''}`)
  }
  for (const c of Array.from(el.children)) walker(c, layer ? depth + 1 : depth)
}
walker(out.body.firstElementChild, 0)
