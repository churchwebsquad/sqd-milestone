/* eslint-disable */
/**
 * Re-derive field_values for every Arvada cowork section using the
 * CURRENT composeFieldValuesForBrixies translator + canonical-templates
 * manifest. Writes back to web_sections.field_values + updates
 * cowork_section_meta.bind_quality + gaps.
 *
 * Run after any translator override change so the live preview reflects
 * the latest mapping without a full handoff re-run.
 */
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
const { composeFieldValuesForBrixies } = await import('../src/lib/cowork/coworkToBrixies.js')

async function main(){
  const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const projectId = process.argv[2] ?? '2eac7eb8-269d-4584-84a4-3dc9fdd6fcde'
  const { data: pages } = await sb.from('web_pages').select('id, slug').eq('web_project_id', projectId).eq('archived', false)
  if (!pages?.length) { console.log('no pages'); return }
  const { data: sections } = await sb.from('web_sections')
    .select('id, content_template_id, cowork_slot_values, cowork_section_meta')
    .in('web_page_id', (pages as any[]).map((p: any) => p.id))
    .not('cowork_slot_values', 'is', null)
  if (!sections?.length) { console.log('no cowork sections'); return }
  const { data: manRes } = await sb.schema('strategy').from('cowork_templates')
    .select('manifest').order('updated_at', { ascending: false }).limit(1).maybeSingle()
  const manifest = (manRes as any)?.manifest?.page_section_templates ?? {}
  const entryByTemplateId = new Map<string, any>()
  for (const e of Object.values(manifest)) entryByTemplateId.set((e as any).template_id, e)

  let updated = 0
  let skipped = 0
  for (const s of (sections as any[])) {
    const entry = entryByTemplateId.get(s.content_template_id)
    if (!entry) { skipped++; continue }
    const bind = composeFieldValuesForBrixies((s.cowork_slot_values ?? {}) as any, entry)
    const meta = { ...(s.cowork_section_meta ?? {}), bind_quality: bind.bind_quality, gaps: bind.gaps }
    const { error } = await sb.from('web_sections')
      .update({ field_values: bind.field_values, cowork_section_meta: meta })
      .eq('id', s.id)
    if (error) { console.error('update failed', s.id, error); continue }
    updated++
  }
  console.log(`updated ${updated} sections (${skipped} skipped — no manifest entry)`)
}
main().catch(e => { console.error(e); process.exit(1) })
