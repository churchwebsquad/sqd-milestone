import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.join(__dirname, '..')

for (const envFile of ['.env.local', '.env']) {
  const envPath = path.join(projectRoot, envFile)
  if (!fs.existsSync(envPath)) continue
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
    if (!m) continue
    if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { data } = await supabase.from('web_content_templates').select('source_html').eq('layer_name', 'Feature section 66').single()
const doc = new JSDOM(data.source_html).window.document
const tabButtons = doc.querySelectorAll('[data-layer="Tab button"]')
console.log('Tab button count:', tabButtons.length)
const parents = new Set()
tabButtons.forEach(b => parents.add(b.parentNode))
console.log('Distinct parents:', parents.size)
for (const p of parents) {
  let count = 0
  for (const c of p.children) {
    if (c.getAttribute('data-layer') === 'Tab button') count++
  }
  console.log('  Parent', p.getAttribute('data-layer'), '- Tab buttons:', count)
}
