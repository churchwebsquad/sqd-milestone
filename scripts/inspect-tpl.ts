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
  const id = process.argv[2]
  const { data, error } = await sb.from('web_content_templates').select('id, layer_name, fields, source_html').eq('id', id).maybeSingle()
  if (error) { console.error(error); process.exit(1) }
  if (!data) { console.error('not found'); process.exit(1) }
  console.log('--- TEMPLATE', id, '---')
  console.log('layer_name:', data.layer_name)
  console.log('fields:')
  console.log(JSON.stringify(data.fields, null, 2))
  if (process.argv.includes('--html')) {
    console.log('\n--- source_html ---\n')
    console.log(data.source_html)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
