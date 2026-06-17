#!/usr/bin/env tsx
/* Re-derive field_values for every cowork section in a project using
 * the current translator + v2.0.1 manifest. Updates web_sections in
 * place — no handoff endpoint roundtrip needed.
 *
 * Use when:
 *   - translator code changed but Arvada was already pushed with the
 *     old translator's output (current case)
 *   - manifest version was bumped and existing rows need re-derive
 *
 * Run:  npx tsx scripts/rederive-cowork-sections.ts <project_id>
 *       (defaults to Arvada)
 */
/* eslint-disable no-console, @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { composeFieldValuesForBrixies, type ManifestEntry } from '../src/lib/cowork/coworkToBrixies.js'

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

async function main() {
  const projectId = process.argv[2] ?? '2eac7eb8-269d-4584-84a4-3dc9fdd6fcde'
  const url = process.env.VITE_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const sb = createClient(url, key, { auth: { persistSession: false } })

  // Load v2.0.1 manifest
  const { data: manRes } = await sb.schema('strategy').from('cowork_templates')
    .select('version, manifest')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const manifest = (manRes as any)?.manifest?.page_section_templates ?? {}
  const entryByTemplateId = new Map<string, ManifestEntry>()
  for (const e of Object.values(manifest)) entryByTemplateId.set((e as ManifestEntry).template_id, e as ManifestEntry)

  // Load all cowork sections
  const { data: pages } = await sb.from('web_pages')
    .select('id, slug')
    .eq('web_project_id', projectId)
    .eq('archived', false)
  if (!pages?.length) { console.log('no pages'); process.exit(0) }

  const { data: sections } = await sb.from('web_sections')
    .select('id, content_template_id, cowork_slot_values, cowork_section_meta, web_page_id')
    .in('web_page_id', (pages as any[]).map((p: any) => p.id))
    .not('cowork_slot_values', 'is', null)
  if (!sections?.length) { console.log('no cowork sections'); process.exit(0) }

  console.log(`Re-deriving field_values for ${sections.length} cowork sections (manifest v${(manRes as any).version})...\n`)

  let updated = 0
  let perfect = 0
  let partial = 0
  let failed = 0

  for (const s of sections as any[]) {
    const entry = entryByTemplateId.get(s.content_template_id)
    if (!entry) { failed++; continue }

    const bind = composeFieldValuesForBrixies(s.cowork_slot_values ?? {}, entry)
    if (bind.bind_quality === 'perfect') perfect++; else partial++

    const newMeta = {
      ...(s.cowork_section_meta ?? {}),
      bind_quality: bind.bind_quality,
      gaps:         bind.gaps,
      manifest_version: (manRes as any).version,
    }

    const { error } = await sb.from('web_sections').update({
      field_values:        bind.field_values,
      source_field_values: s.cowork_slot_values,
      cowork_section_meta: newMeta,
      updated_at:          new Date().toISOString(),
    }).eq('id', s.id)
    if (error) {
      console.log(`  ✗ ${s.id}: ${error.message}`)
      failed++
    } else {
      updated++
    }
  }

  console.log(`\nResult:`)
  console.log(`  updated   ${updated}`)
  console.log(`  perfect   ${perfect}`)
  console.log(`  partial   ${partial}`)
  console.log(`  failed    ${failed}`)
  process.exit(failed === 0 ? 0 : 1)
}
main()
