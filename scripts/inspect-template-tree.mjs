// Print the data-layer tree of a template's source_html for human
// inspection. Usage:
//   node scripts/inspect-template-tree.mjs "Feature Section 103"
//   node scripts/inspect-template-tree.mjs "FAQ Section 10"

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

const name = process.argv[2]
if (!name) {
  console.error('Usage: node scripts/inspect-template-tree.mjs "<layer_name>"')
  process.exit(1)
}

const { data, error } = await supabase
  .from('web_content_templates')
  .select('layer_name, source_html')
  .eq('layer_name', name)
  .single()
if (error) throw error

const root = parseHtml(data.source_html)
let sectionRoot = root.firstChild
while (sectionRoot && sectionRoot.nodeType !== 1) sectionRoot = sectionRoot.nextSibling

function summarizeNodeText(el) {
  let total = ''
  for (const c of el.childNodes) {
    if (c.nodeType === 3) total += (c.text ?? c.rawText ?? '')
  }
  const trimmed = total.replace(/\s+/g, ' ').trim().slice(0, 60)
  return trimmed
}

function getFontSize(el) {
  const style = el.getAttribute('style') ?? ''
  const m = style.match(/font-size\s*:\s*([\d.]+)px/i)
  return m ? parseFloat(m[1]) : null
}
function getFontWeight(el) {
  const style = el.getAttribute('style') ?? ''
  const m = style.match(/font-weight\s*:\s*(\d+)/i)
  return m ? parseInt(m[1], 10) : null
}

function walk(el, depth) {
  if (!el || el.nodeType !== 1) return
  const layer = el.hasAttribute && el.hasAttribute('data-layer')
    ? el.getAttribute('data-layer')
    : null
  if (layer) {
    const indent = '  '.repeat(depth)
    const text = summarizeNodeText(el)
    const fs = getFontSize(el)
    const fw = getFontWeight(el)
    const tag = el.tagName.toLowerCase()
    const styleHint = (fs || fw) ? ` [${fs ?? ''}${fs ? 'px' : ''}${fw ? '/' + fw : ''}]` : ''
    const textHint = text ? `  "${text.replace(/\n/g, ' ').slice(0, 60)}"` : ''
    process.stdout.write(`${indent}<${tag}> ${layer}${styleHint}${textHint}\n`)
  }
  if (el.childNodes) {
    for (const c of el.childNodes) walk(c, layer ? depth + 1 : depth)
  }
}

console.log(`▸ ${data.layer_name}\n`)
walk(sectionRoot, 0)
