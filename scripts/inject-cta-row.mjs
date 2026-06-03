// One-off: inject a CTA button row into Brixies templates that have
// Description but no Buttons. The Brixies catalog has many heading
// sections that ship without a CTA — Hero 37, Hero 44, Content 80,
// etc. The user expects every section to allow a button.
//
// For each template missing a buttons field:
//   1. Insert a Buttons row in source_html AFTER the Description
//      element (sibling, inside the same flex column).
//   2. Add a `buttons` group field to the schema with default_count=1
//      and item_schema = [{kind:'slot', type:'text', scope:'button',
//      label:'Button label', key:'contact'}].
//
// Idempotent. Checks for the marker before re-applying.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function loadEnv() {
  for (const f of ['.env.local', '.env']) {
    const p = path.join(__dirname, '..', f)
    if (!fs.existsSync(p)) continue
    for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
      if (!m) continue
      if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
}
loadEnv()

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
const supabase = createClient(url, key)

const MARKER = '<!-- mcms:injected-cta -->'

// Brixies-shaped button HTML (Container buttons wrapper + 1 dark
// button by default). Matches the inline styles in the canonical
// catalog so it visually fits without class CSS.
const BUTTON_HTML = `
  <div data-layer="Container buttons" class="ContainerButtons" style="justify-content: center; align-items: center; gap: 20px; display: inline-flex; margin-top: 20px;"> ${MARKER}
    <div data-layer="Buttons" data-color="Neutral" data-device="Laptop" data-type="Button" class="Buttons" style="padding: 13.3px 30px; background: #161616; border-radius: 4px; display: inline-flex; justify-content: center; align-items: center; gap: 13.3px;">
      <div data-layer="Contact" class="Contact" style="color: white; font-size: 13.5px; font-family: Inter; font-weight: 600; line-height: 20.25px;">Contact now</div>
    </div>
  </div>`

const BUTTON_FIELD = {
  key: 'buttons',
  kind: 'group',
  layer_name: 'Buttons',
  item_schema: [{
    key: 'contact',
    kind: 'slot',
    type: 'text',
    label: 'Button label',
    scope: 'button',
    max_chars: 30,
    layer_name: 'Contact',
  }],
  default_count: 1,
}

function hasButtonsField(fields) {
  if (!Array.isArray(fields)) return false
  return fields.some(f =>
    f.key === 'buttons' ||
    (f.kind === 'slot' && f.type === 'cta') ||
    (f.layer_name && /buttons?$/i.test(f.layer_name)) ||
    (f.key && /^(button|cta)/i.test(f.key)),
  )
}

function hasDescription(fields) {
  if (!Array.isArray(fields)) return false
  return fields.some(f => f.key === 'description' || (f.layer_name && /^description$/i.test(f.layer_name)))
}

function injectAfterDescription(html) {
  // Find the Description element's CLOSING tag. The description is
  // either an inline-text div (closing > of opening tag is followed by
  // text + </div>) or wraps content. Match the OPENING tag, then walk
  // to its matching </div>.
  const descOpen = html.match(/<div\s+[^>]*data-layer="Description"[^>]*>/)
  if (!descOpen) return null
  const openIdx = descOpen.index
  const openEnd = openIdx + descOpen[0].length
  // Walk tags forward to find the matching </div>.
  let depth = 1
  let i = openEnd
  const tagRe = /<\/?div[\s>]/g
  tagRe.lastIndex = i
  let m
  while ((m = tagRe.exec(html)) !== null) {
    if (m[0].startsWith('</')) depth--
    else depth++
    if (depth === 0) {
      const closeEnd = m.index + m[0].length
      return html.slice(0, closeEnd) + BUTTON_HTML + html.slice(closeEnd)
    }
  }
  return null
}

const { data: templates, error } = await supabase
  .from('web_content_templates')
  .select('id, layer_name, source_html, fields')

if (error) { console.error(error.message); process.exit(1) }

let injected = 0
let alreadyHas = 0
let skipped = 0
let errors = 0

for (const t of templates) {
  const htmlHasMarker = t.source_html?.includes(MARKER)
  const fieldsHaveButtons = hasButtonsField(t.fields)

  // Case 1: HTML has marker AND fields have buttons — fully done.
  if (htmlHasMarker && fieldsHaveButtons) { alreadyHas++; continue }

  // Case 2: HTML has marker but fields lack buttons (e.g. after a
  // schema-restore wiped the field but the source_html injection
  // persisted). Re-add the field WITHOUT touching HTML.
  if (htmlHasMarker && !fieldsHaveButtons) {
    const newFields = [...t.fields, BUTTON_FIELD]
    const { error: updErr } = await supabase
      .from('web_content_templates')
      .update({ fields: newFields })
      .eq('id', t.id)
    if (updErr) { console.error(`[FAIL] ${t.layer_name}: ${updErr.message}`); errors++ }
    else { injected++ }
    continue
  }

  // Case 3: Fields have buttons already (probably native to the
  // template) — no work needed.
  if (fieldsHaveButtons) { alreadyHas++; continue }

  // Case 4: Fresh template — needs both HTML + fields injection.
  if (!hasDescription(t.fields)) { skipped++; continue }
  if (!t.source_html?.includes('data-layer="Description"')) { skipped++; continue }

  const newHtml = injectAfterDescription(t.source_html)
  if (!newHtml) { skipped++; continue }
  const newFields = [...t.fields, BUTTON_FIELD]

  const { error: updErr } = await supabase
    .from('web_content_templates')
    .update({ source_html: newHtml, fields: newFields })
    .eq('id', t.id)
  if (updErr) {
    console.error(`[FAIL] ${t.layer_name}: ${updErr.message}`)
    errors++
  } else {
    injected++
  }
}

console.log(`\nInjected CTA row into ${injected} templates (${alreadyHas} already had buttons, ${skipped} skipped, ${errors} errors).`)
