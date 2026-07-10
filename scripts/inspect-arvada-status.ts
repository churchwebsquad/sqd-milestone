/* eslint-disable */
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
async function main(){
  const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const projectId = '2eac7eb8-269d-4584-84a4-3dc9fdd6fcde'
  const { data: pages } = await sb.from('web_pages').select('id, slug').eq('web_project_id', projectId).eq('archived', false)
  const slugById = new Map((pages as any[]).map(p => [p.id, p.slug]))
  const { data: sections } = await sb.from('web_sections')
    .select('id, web_page_id, content_template_id, updated_at, field_values, cowork_slot_values, cowork_section_meta')
    .in('web_page_id', (pages as any[]).map(p => p.id))
    .order('updated_at', { ascending: false })
    .limit(5)
  console.log('5 most-recently-updated sections:')
  for (const s of (sections as any[])) {
    console.log(`  ${s.updated_at}  ${slugById.get(s.web_page_id)} / ${s.content_template_id}`)
  }
  // Roll-up by template
  const { data: all } = await sb.from('web_sections')
    .select('id, content_template_id, cowork_slot_values')
    .in('web_page_id', (pages as any[]).map(p => p.id))
    .not('cowork_slot_values', 'is', null)
  const byTpl: Record<string, number> = {}
  for (const s of (all as any[])) {
    byTpl[s.content_template_id] = (byTpl[s.content_template_id] ?? 0) + 1
  }
  console.log('\nTemplates used by Arvada (with cowork content):')
  for (const [tpl, n] of Object.entries(byTpl).sort((a,b)=>b[1]-a[1])) {
    console.log(`  ${String(n).padStart(3)}  ${tpl}`)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
