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
  const { data } = await sb.schema('strategy').from('cowork_templates').select('manifest').order('updated_at', { ascending: false }).limit(1).maybeSingle()
  const m = (data as any).manifest
  const pickable = m.pickable_templates ?? []
  const banners = pickable.filter((p: any) => String(p.template_id ?? p).includes('banner') || String(p.template_id ?? p).includes('Banner'))
  console.log('banner-tagged pickable_templates:', banners)
  const psm = m.page_section_templates ?? {}
  const psmBanners = Object.entries(psm).filter(([k,v]: any) => String(v.template_id ?? '').includes('banner'))
  console.log('page_section_templates banner entries:')
  for (const [k, v] of psmBanners) console.log(' ', k, JSON.stringify(v).slice(0,200))
}
main()
