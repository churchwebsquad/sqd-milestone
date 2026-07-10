/* eslint-disable */
// @ts-ignore TS2307 — jsdom types not installed in this tsconfig
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
;(globalThis as any).window = dom.window
;(globalThis as any).document = dom.window.document
;(globalThis as any).DOMParser = dom.window.DOMParser
;(globalThis as any).Element = dom.window.Element
;(globalThis as any).HTMLElement = dom.window.HTMLElement
;(globalThis as any).Node = dom.window.Node
;(globalThis as any).NodeFilter = dom.window.NodeFilter
;(globalThis as any).Image = dom.window.Image
;(globalThis as any).getComputedStyle = dom.window.getComputedStyle

const { renderSectionToHtml } = await import('../src/lib/webBrixiesRender.js')

async function main(){
  const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const tplId = process.argv[2]
  const { data: tpl } = await sb.from('web_content_templates').select('*').eq('id', tplId).maybeSingle()
  const html = renderSectionToHtml(tpl, {}, {}, {})
  const out = `/tmp/render-${tplId}.html`
  writeFileSync(out, '<!doctype html><body>' + html + '</body>')
  console.log('Rendered →', out, html.length, 'chars')
}
main()
