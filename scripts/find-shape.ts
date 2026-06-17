#!/usr/bin/env tsx
/* Try multiple field_values shapes per template, report which shape
 * renders all the synthetic markers. */
/* eslint-disable no-console, @typescript-eslint/no-explicit-any */

import { JSDOM } from 'jsdom'
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'

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

function visibleText(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ')
}

interface Trial { name: string; fv: any; markers: string[] }

async function main() {
  const templateIds = process.argv.slice(2)
  if (!templateIds.length) {
    console.error('usage: find-shape.ts <template-id> [...]')
    process.exit(1)
  }
  const url = process.env.VITE_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const sb = createClient(url, key, { auth: { persistSession: false } })

  for (const tid of templateIds) {
    const { data: tpl } = await sb.from('web_content_templates')
      .select('id, layer_name, fields, source_html')
      .eq('id', tid).single()
    if (!tpl) { console.log(`${tid}: NO TEMPLATE`); continue }

    console.log(`\n=== ${tid} ===`)

    // Common scalars present everywhere
    const H = 'MARK_HEAD'
    const T = 'MARK_TAG'
    const B = 'MARK_BODY'
    const AB = 'MARK_ACCENT'
    const I1H = 'MARK_I1H', I1B = 'MARK_I1B'
    const I2H = 'MARK_I2H', I2B = 'MARK_I2B'
    const BTN = 'MARK_BTN'

    const trials: Trial[] = [
      // Trial A: my current translator shape
      { name: 'A. translator-current',
        fv: { heading: H, tagline: T, description: `<p>${B}</p>`, accent_description: `<p>${AB}</p>`,
              column_list: [{heading_card: I1H, description_card: `<p>${I1B}</p>`}, {heading_card: I2H, description_card: `<p>${I2B}</p>`}],
              accordion_left: [{title: I1H, description: `<p>${I1B}</p>`}], accordion_right: [{title: I2H, description: `<p>${I2B}</p>`}],
              description_items: [{text: `<p>${B}</p>`}],
              row_grid: [{name: I1H, title: 'role', description_member: `<p>${I1B}</p>`}, {name: I2H, title: 'role', description_member: `<p>${I2B}</p>`}],
              grid:    [{item_heading: I1H, item_body: `<p>${I1B}</p>`}, {item_heading: I2H, item_body: `<p>${I2B}</p>`}],
              tab:     [{heading: I1H, description: `<p>${I1B}</p>`, tagline: 'tag'}, {heading: I2H, description: `<p>${I2B}</p>`, tagline: 'tag'}],
              buttons: [{contact: {label: BTN, url: '/x'}}], image: [{contact: {label: BTN, url: '/x'}}],
              markers: [H, T, B, BTN, AB, I1H, I1B, I2H, I2B] },
        markers: [H, T, B, BTN, AB, I1H, I1B, I2H, I2B] },

      // Trial B: body inside description_items (works for content-section-16)
      { name: 'B. body→description_items[0].text',
        fv: { heading: H, tagline: T, description_items: [{text: `<p>${B}</p>`}], buttons: [{contact:{label:BTN,url:'/x'}}] },
        markers: [H, T, B, BTN] },

      // Trial C: items as flat group with single 'text' key (accordion case)
      { name: 'C. accordion items as {text}',
        fv: { heading: H, accordion_left: [{text: I1H}, {text: `<p>${I1B}</p>`}], accordion_right: [{text: I2H}, {text: `<p>${I2B}</p>`}] },
        markers: [H, I1H, I1B, I2H, I2B] },

      // Trial D: cta_callout buttons as single object
      { name: 'D. buttons=single {label,url}',
        fv: { heading: H, description: `<p>${B}</p>`, buttons: {label: BTN, url: '/x'} },
        markers: [H, B, BTN] },

      // Trial E: column_list items have nested card group
      { name: 'E. column_list→[{card:[{heading_card,description_card}]}]',
        fv: { heading: H,
              column_list: [
                {card: [{heading_card: I1H, description_card: `<p>${I1B}</p>`}]},
                {card: [{heading_card: I2H, description_card: `<p>${I2B}</p>`}]},
              ],
              buttons: [{contact:{label:BTN,url:'/x'}}] },
        markers: [H, I1H, I1B, I2H, I2B, BTN] },

      // Trial F: accordion alternating items mapped pairwise — pair of texts in sequence
      { name: 'F. accordion_left/right with pair shape',
        fv: { heading: H, accordion_left: [{text_heading: I1H, text_body: `<p>${I1B}</p>`}], accordion_right: [{text_heading: I2H, text_body: `<p>${I2B}</p>`}] },
        markers: [H, I1H, I1B, I2H, I2B] },
    ]

    for (const t of trials) {
      try {
        const html = renderSectionToHtml(tpl as any, t.fv, {})
        const text = visibleText(html)
        const hits = t.markers.filter(m => text.includes(m))
        const misses = t.markers.filter(m => !text.includes(m))
        const score = `${hits.length}/${t.markers.length}`
        const symbol = misses.length === 0 ? '✓' : misses.length === t.markers.length ? '✗' : '~'
        console.log(`  ${symbol} ${t.name.padEnd(50)} ${score}${misses.length ? '  miss: ' + misses.join(',') : ''}`)
      } catch (e: any) {
        console.log(`  ! ${t.name} CRASHED ${e.message?.slice(0,60)}`)
      }
    }
  }
}

main()
