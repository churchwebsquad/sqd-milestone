#!/usr/bin/env tsx
/* Per-template shape trials, derived from each schema's item_schema. */
/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
// @ts-ignore — jsdom not in devDependencies; installed at runtime
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

function vt(html: string) { return html.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ') }

async function trial(sb: any, tid: string, fv: any, markers: string[], label: string) {
  const { data: tpl } = await sb.from('web_content_templates').select('*').eq('id', tid).single()
  const html = renderSectionToHtml(tpl, fv, {})
  const text = vt(html)
  const hits = markers.filter(m => text.includes(m))
  const misses = markers.filter(m => !text.includes(m))
  const sym = misses.length === 0 ? '✓' : '~'
  console.log(`  ${sym} ${label.padEnd(60)} ${hits.length}/${markers.length}${misses.length ? '  miss: ' + misses.join(',') : ''}`)
}

async function main() {
  const url = process.env.VITE_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const sb = createClient(url, key, { auth: { persistSession: false } })

  const H='MARK_HEAD', B='MARK_BODY', BTN='MARK_BTN'
  const I1H='MARK_I1H', I1B='MARK_I1B', I2H='MARK_I2H', I2B='MARK_I2B'

  console.log(`\n=== faq-section-10 ===`)
  // Schema: accordion_left.item_schema = [{key:text,type:text}, {key:text,type:richtext}]
  // Two slots with same key 'text'. Renderer may pick by index/order.
  // Try: each item has heading + body keyed as text variants
  await trial(sb, 'faq-section-10', {
    heading: H,
    accordion_left:  [{text: I1H}, {text: `<p>${I1B}</p>`}],   // 2 items each with just text
    accordion_right: [{text: I2H}, {text: `<p>${I2B}</p>`}],
  }, [H, I1H, I1B, I2H, I2B], 'A. one text per item, alternating')
  // Pair shape — single item carries both
  await trial(sb, 'faq-section-10', {
    heading: H,
    accordion_left:  [{text: `${I1H}|${I1B}`}],
    accordion_right: [{text: `${I2H}|${I2B}`}],
  }, [H, I1H, I1B, I2H, I2B], 'B. concat as single text per item')
  // Item with BOTH text values — array under text?
  await trial(sb, 'faq-section-10', {
    heading: H,
    accordion_left:  [{text: [I1H, `<p>${I1B}</p>`]}],
    accordion_right: [{text: [I2H, `<p>${I2B}</p>`]}],
  }, [H, I1H, I1B, I2H, I2B], 'C. text as array of [heading, body]')

  console.log(`\n=== team-section-14 ===`)
  // row_grid.item_schema = [card_team(group, default_count:3, item_schema:[team_name, team_position, team_description])]
  await trial(sb, 'team-section-14', {
    heading: H,
    row_grid: [{card_team: [
      {team_name: I1H, team_position: 'role', team_description: `<p>${I1B}</p>`},
      {team_name: I2H, team_position: 'role', team_description: `<p>${I2B}</p>`},
    ]}],
  }, [H, I1H, I1B, I2H, I2B], 'A. row_grid:[{card_team:[...]}]')

  console.log(`\n=== feature-section-103 ===`)
  // row_list.item_schema = [heading, button(cta), item_list(group → card(group) → heading_card, list_item(group → description), button_card(cta))]
  // Brutally deep. Simplest: row_list[0].heading = group heading. Items go in row_list[0].item_list[0].card[0].
  await trial(sb, 'feature-section-103', {
    heading: H,
    row_list: [
      {heading: I1H, item_list: [{card: [{heading_card: I1H, list_item: [{description: `<p>${I1B}</p>`}]}]}]},
      {heading: I2H, item_list: [{card: [{heading_card: I2H, list_item: [{description: `<p>${I2B}</p>`}]}]}]},
    ],
  }, [H, I1H, I1B, I2H, I2B], 'A. row_list[].item_list[].card[].heading_card+list_item[].description')

  console.log(`\n=== content-section-96 ===`)
  // counter_contain.item_schema = [counter(group), counter_description(richtext)]
  await trial(sb, 'content-section-96', {
    heading: H,
    counter_contain: [
      {counter_description: `<p>${I1B}</p>`, counter: [{description: I1H}]},
      {counter_description: `<p>${I2B}</p>`, counter: [{description: I2H}]},
    ],
  }, [H, I1H, I1B, I2H, I2B], 'A. counter_contain[]{counter:[{description}], counter_description}')

  console.log(`\n=== content-section-25 (verify works) ===`)
  await trial(sb, 'content-section-25', {
    heading: H,
    description: `<p>${B}</p>`,
    accent_description: `<p>MARK_ACCENT</p>`,
    buttons: [{contact: {label: BTN, url: '/x'}}],
  }, [H, B, BTN, 'MARK_ACCENT'], 'A. current translator shape (verified)')
}
main()
