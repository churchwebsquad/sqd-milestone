/* eslint-disable @typescript-eslint/no-explicit-any */
import { JSDOM } from 'jsdom'
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
for (const envPath of ['.env.local','.env']) {
  if (!existsSync(envPath)) continue
  for (const line of readFileSync(envPath,'utf8').split('\n')) {
    if (!line||line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq<=0) continue
    const k = line.slice(0,eq).trim()
    const v = line.slice(eq+1).trim().replace(/^["']|["']$/g,'')
    if (process.env[k]==null) process.env[k]=v
  }
}
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
;(globalThis as any).window=dom.window
;(globalThis as any).document=dom.window.document
;(globalThis as any).DOMParser=dom.window.DOMParser
;(globalThis as any).Element=dom.window.Element
;(globalThis as any).HTMLElement=dom.window.HTMLElement
;(globalThis as any).Node=dom.window.Node
;(globalThis as any).NodeFilter=dom.window.NodeFilter
;(globalThis as any).Image=dom.window.Image
;(globalThis as any).getComputedStyle=dom.window.getComputedStyle

const { renderSectionToHtml } = await import('../src/lib/webBrixiesRender.js')

const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {auth:{persistSession:false}})
const { data: tpl } = await sb.from('web_content_templates').select('*').eq('id','feature-section-2').single()
const { data: cardRows } = await sb.from('web_content_templates').select('*').eq('family','Card')
const cardTemplates = Object.fromEntries((cardRows ?? []).map((t: any) => [t.id, t]))

const fv = {
  heading: 'OUTER_HEAD',
  card: {
    __palette_template_id: 'card-193',
    items: [
      { heading: 'OUTH1', description: '<p>OUTB1</p>',
        card: [{ heading_card: 'INH1', description_card: '<p>INB1</p>', buttons: [{ contact_card: 'INBTN1', url:'/x' }] }] },
      { heading: 'OUTH2', description: '<p>OUTB2</p>',
        card: [{ heading_card: 'INH2', description_card: '<p>INB2</p>', buttons: [{ contact_card: 'INBTN2', url:'/y' }] }] },
    ],
  },
}
const html = renderSectionToHtml(tpl as any, fv, {}, cardTemplates)
writeFileSync('/tmp/fs2.html', html)
const text = html.replace(/<[^>]+>/g,' ').replace(/&[a-z#0-9]+;/gi,' ').replace(/\s+/g,' ')
for (const m of ['OUTER_HEAD','OUTH1','OUTB1','INH1','INB1','INBTN1','OUTH2','OUTB2','INH2','INB2','INBTN2']) {
  console.log(`${m.padEnd(15)} ${text.includes(m) ? 'YES' : 'NO'}`)
}
