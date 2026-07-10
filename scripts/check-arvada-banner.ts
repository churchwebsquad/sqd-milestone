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
    .select('id, web_page_id, content_template_id, field_values, cowork_slot_values')
    .in('web_page_id', (pages as any[]).map((p:any) => p.id))
    .eq('content_template_id', 'banner-section-4')
  console.log('Banner-section-4 sections in Arvada:', (sections ?? []).length)
  for (const s of (sections ?? []) as any[]) {
    console.log(' ', slugById.get(s.web_page_id), s.id.slice(0,8), 'cowork:', !!s.cowork_slot_values)
  }
}
main()
