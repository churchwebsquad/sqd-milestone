#!/usr/bin/env tsx
/* Focused single-section render: dump full output for diagnostic. */
/* eslint-disable no-console, @typescript-eslint/no-explicit-any */

// @ts-ignore — jsdom not in devDependencies; installed at runtime
import { JSDOM } from 'jsdom'
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'

for (const envPath of ['.env.local', '.env']) {
  if (!existsSync(envPath)) continue
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const k = line.slice(0, eq).trim()
    const v = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (process.env[k] == null) process.env[k] = v
  }
}

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
;(globalThis as any).window      = dom.window
;(globalThis as any).document    = dom.window.document
;(globalThis as any).DOMParser   = dom.window.DOMParser
;(globalThis as any).Element     = dom.window.Element
;(globalThis as any).HTMLElement = dom.window.HTMLElement
;(globalThis as any).Node        = dom.window.Node
;(globalThis as any).NodeFilter  = dom.window.NodeFilter
;(globalThis as any).Image       = dom.window.Image
;(globalThis as any).getComputedStyle = dom.window.getComputedStyle

import { renderSectionToHtml } from '../src/lib/webBrixiesRender.js'

async function main() {
  const templateId = process.argv[2] ?? 'content-section-16'
  const fieldValuesArg = process.argv[3]
  const url = process.env.VITE_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const sb = createClient(url, key, { auth: { persistSession: false } })

  const { data: tpl } = await sb.from('web_content_templates')
    .select('id, layer_name, family, fields, source_html')
    .eq('id', templateId).single()
  if (!tpl) { console.error('no template'); process.exit(1) }

  const fv = fieldValuesArg
    ? JSON.parse(fieldValuesArg)
    : { heading: 'TEST_HEADING_X', tagline: 'TEST_TAGLINE_Y',
        description: '<p>TEST_DESCRIPTION_Z and another sentence here.</p>',
        buttons: [{contact: {label: 'TEST_BTN', url: '/x'}}] }

  console.log(`=== Rendering ${templateId} ===`)
  console.log(`field_values:`, JSON.stringify(fv, null, 2))
  console.log()
  const html = renderSectionToHtml(tpl as any, fv, {})
  writeFileSync(`/tmp/render-${templateId}.html`, html)
  console.log(`Full HTML → /tmp/render-${templateId}.html (${html.length} bytes)`)

  // Strip + show what text content the user would actually see
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim()
  console.log(`\nVisible text:\n${text}`)
}
main()
