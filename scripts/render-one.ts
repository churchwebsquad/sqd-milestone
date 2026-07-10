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
;(globalThis as any).window      = dom.window
;(globalThis as any).document    = dom.window.document
;(globalThis as any).DOMParser   = dom.window.DOMParser
;(globalThis as any).Element     = dom.window.Element
;(globalThis as any).HTMLElement = dom.window.HTMLElement
;(globalThis as any).Node        = dom.window.Node
;(globalThis as any).NodeFilter  = dom.window.NodeFilter
;(globalThis as any).Image       = dom.window.Image
;(globalThis as any).getComputedStyle = dom.window.getComputedStyle

const { renderSectionToHtml } = await import('../src/lib/webBrixiesRender.js')
const { composeFieldValuesForBrixies } = await import('../src/lib/cowork/coworkToBrixies.js')

async function main(){
  const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const tplId = process.argv[2]
  const projectId = '2eac7eb8-269d-4584-84a4-3dc9fdd6fcde'
  const { data: pages } = await sb.from('web_pages').select('id, slug').eq('web_project_id', projectId).eq('archived', false)
  const slugById = new Map((pages as any[]).map(p => [p.id, p.slug]))
  const { data: sections } = await sb.from('web_sections')
    .select('id, web_page_id, content_template_id, field_values, cowork_slot_values')
    .in('web_page_id', (pages as any[]).map(p => p.id))
    .eq('content_template_id', tplId)
    .not('cowork_slot_values', 'is', null)
    .limit(1)
  if (!sections?.length) { console.error('no section'); process.exit(1) }
  const s = sections[0] as any
  const { data: tpl } = await sb.from('web_content_templates').select('*').eq('id', s.content_template_id).maybeSingle()
  const { data: cardTpls } = await sb.from('web_content_templates').select('*').eq('family', 'Card')
  const cardTemplatesById: Record<string, any> = Object.fromEntries(((cardTpls ?? []) as any[]).map(t => [t.id, t]))
  const { data: manRes } = await sb.schema('strategy').from('cowork_templates')
    .select('manifest').order('updated_at', { ascending: false }).limit(1).maybeSingle()
  const manifest = (manRes as any)?.manifest?.page_section_templates ?? {}
  const entryByTemplateId = new Map<string, any>()
  for (const e of Object.values(manifest)) entryByTemplateId.set((e as any).template_id, e)
  const entry = entryByTemplateId.get(tplId)
  const bind = entry ? composeFieldValuesForBrixies((s.cowork_slot_values ?? {}) as any, entry) : { field_values: s.field_values, gaps: [] }
  console.log('=== SLUG', slugById.get(s.web_page_id), '===')
  console.log('cowork_slot_values:', JSON.stringify(s.cowork_slot_values, null, 2))
  console.log('field_values (re-derived):', JSON.stringify(bind.field_values, null, 2))
  const html = renderSectionToHtml(tpl, bind.field_values as any, {}, cardTemplatesById)
  const out = `/tmp/render-${tplId}.html`
  writeFileSync(out, '<!doctype html><meta charset=utf-8><body>' + html + '</body>')
  console.log('Rendered HTML →', out)
  // Count visible images
  const dom2 = new JSDOM(html)
  const imgs = dom2.window.document.querySelectorAll('img')
  console.log('img count:', imgs.length)
  let visibleCount = 0
  for (const img of Array.from(imgs)) {
    let p: any = img
    let hidden = false
    while (p && p !== dom2.window.document) {
      const s = p.getAttribute?.('style') ?? ''
      if (/display\s*:\s*none/i.test(s)) { hidden = true; break }
      p = p.parentElement
    }
    if (!hidden) visibleCount++
  }
  console.log('visible img count:', visibleCount)
}
main().catch(e => { console.error(e); process.exit(1) })
