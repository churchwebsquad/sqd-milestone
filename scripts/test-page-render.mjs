// Render every section on a page through the renderer to catch errors.
// Usage: node scripts/test-page-render.mjs <page_id>

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

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.DOMParser = dom.window.DOMParser
globalThis.Element = dom.window.Element
globalThis.Node = dom.window.Node
globalThis.NodeFilter = dom.window.NodeFilter

const { renderSectionToHtml } = await import('../src/lib/webBrixiesRender.ts')
const { augmentTemplate } = await import('../src/lib/webBrixiesSchemaAugment.ts')

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
)

const pageId = process.argv[2]
if (!pageId) {
  console.error('Usage: node scripts/test-page-render.mjs <page_id>')
  process.exit(1)
}

const { data: sections } = await supabase
  .from('web_sections')
  .select('id, sort_order, content_template_id, field_values')
  .eq('web_page_id', pageId)
  .order('sort_order')

const tplIds = [...new Set((sections ?? []).map(s => s.content_template_id).filter(Boolean))]
const { data: templates } = await supabase
  .from('web_content_templates')
  .select('*')
  .in('id', tplIds)
const templatesById = Object.fromEntries((templates ?? []).map(t => [t.id, t]))

for (const s of sections ?? []) {
  const t = templatesById[s.content_template_id]
  if (!t) { console.log(`${s.sort_order}: no template (${s.id})`); continue }
  try {
    const aug = augmentTemplate(t)
    const html = renderSectionToHtml(aug, s.field_values ?? {}, {})
    console.log(`${s.sort_order}: ${t.layer_name} — ok (${html.length} bytes)`)
  } catch (e) {
    console.log(`${s.sort_order}: ${t.layer_name} — ERROR: ${e.message}`)
    if (process.argv.includes('--stack')) console.log(e.stack)
  }
}
