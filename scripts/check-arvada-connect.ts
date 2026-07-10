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
  const { data: pages } = await sb.from('web_pages').select('id, slug').eq('web_project_id', projectId).eq('archived', false).eq('slug', 'connect')
  const conn = (pages?.[0] as any)
  if (!conn) { console.log('no connect page'); return }
  const { data: sections } = await sb.from('web_sections')
    .select('id, sort_order, content_template_id, cowork_slot_values')
    .eq('web_page_id', conn.id)
    .order('sort_order')
  console.log('connect page sections:', (sections ?? []).length)
  for (const s of (sections ?? []) as any[]) {
    console.log(`  ${String(s.sort_order).padStart(2)} ${s.content_template_id}`)
  }
}
main()
