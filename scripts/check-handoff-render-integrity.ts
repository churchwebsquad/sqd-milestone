#!/usr/bin/env tsx
/**
 * Handoff render-integrity check.
 *
 * For an existing project's pushed web_sections, verifies the
 * derived field_values would render with full Brixies layout
 * integrity:
 *   1. Every required_slot in the template's manifest entry has
 *      a populated field_values value.
 *   2. No populated value contains lorem-ipsum signature strings.
 *   3. Buttons (when present) have BOTH label + url for each.
 *   4. cowork_slot_values is bit-for-bit re-derivable to the
 *      current field_values via composeFieldValuesForBrixies.
 *      (Catches drift: someone edited field_values directly without
 *      updating cowork_slot_values + re-deriving.)
 *
 * Run:  npx tsx scripts/check-handoff-render-integrity.ts <project_id>
 *        (defaults to Arvada)
 * Exit: 0 every section integral | 1 any failure | 2 setup error
 */
/* eslint-disable no-console */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import {
  composeFieldValuesForBrixies,
  type ManifestEntry,
} from '../src/lib/cowork/coworkToBrixies.js'

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

const LOREM_SIGNATURES = [
  /lorem ipsum/i,
  /sed ut perspiciatis/i,
  /dolor sit amet/i,
  /consectetur adipiscing/i,
]

interface Failure {
  page_slug:         string
  section_intent_id: string
  template_id:       string | null
  check:             string
  detail:            string
}

function containsLorem(value: unknown): string | null {
  const flatten = (v: unknown): string[] => {
    if (typeof v === 'string') return [v]
    if (Array.isArray(v)) return v.flatMap(flatten)
    if (v && typeof v === 'object') return Object.values(v as Record<string, unknown>).flatMap(flatten)
    return []
  }
  for (const s of flatten(value)) {
    for (const re of LOREM_SIGNATURES) {
      const m = s.match(re)
      if (m) return m[0]
    }
  }
  return null
}

async function main(): Promise<void> {
  const projectId = process.argv[2] ?? '2eac7eb8-269d-4584-84a4-3dc9fdd6fcde'
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) { console.error('missing env'); process.exit(2) }
  const sb = createClient(url, key, { auth: { persistSession: false } })

  // Load manifest
  const { data: mRes, error: mErr } = await sb.schema('strategy').from('cowork_templates')
    .select('version, manifest')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (mErr || !mRes) { console.error(`manifest load failed: ${mErr?.message}`); process.exit(2) }
  const manifest = (mRes as { manifest: { page_section_templates: Record<string, ManifestEntry> } }).manifest
  const templatesByConcept = manifest.page_section_templates
  // Reverse map: template_id → manifest entry (sections are keyed by template_id)
  const byTemplateId = new Map<string, ManifestEntry>()
  for (const entry of Object.values(templatesByConcept)) {
    byTemplateId.set(entry.template_id, entry)
  }

  // Load this project's cowork-derived sections
  const { data: pages, error: pageErr } = await sb.from('web_pages')
    .select('id, slug')
    .eq('web_project_id', projectId)
    .eq('archived', false)
  if (pageErr) { console.error(`web_pages load failed: ${pageErr.message}`); process.exit(2) }
  if (!pages || pages.length === 0) {
    console.log(`project has no pushed pages — nothing to verify`)
    process.exit(0)
  }
  const pageIds = (pages as Array<{ id: string; slug: string }>).map(p => p.id)
  const slugByPageId = new Map((pages as Array<{ id: string; slug: string }>).map(p => [p.id, p.slug]))

  const { data: sections, error: secErr } = await sb.from('web_sections')
    .select('id, web_page_id, content_template_id, field_values, cowork_slot_values, cowork_section_meta')
    .in('web_page_id', pageIds)
  if (secErr) { console.error(`web_sections load failed: ${secErr.message}`); process.exit(2) }
  if (!sections || sections.length === 0) {
    console.log(`project has 0 sections — nothing to verify`)
    process.exit(0)
  }

  const failures: Failure[] = []
  let totalChecked = 0
  let totalLorem = 0
  let totalRequiredMissing = 0
  let totalButtonGap = 0
  let totalDrift = 0

  for (const s of sections as Array<{
    id: string
    web_page_id: string
    content_template_id: string | null
    field_values: Record<string, unknown> | null
    cowork_slot_values: Record<string, unknown> | null
    cowork_section_meta: { section_intent_id?: string; bind_quality?: string } | null
  }>) {
    if (s.cowork_slot_values == null) continue   // legacy non-cowork section
    totalChecked++
    const slug = slugByPageId.get(s.web_page_id) ?? '<unknown>'
    const intentId = s.cowork_section_meta?.section_intent_id ?? s.id.slice(0, 8)
    const tid = s.content_template_id
    const entry = tid ? byTemplateId.get(tid) : undefined

    // Check 1: required slots populated
    if (entry) {
      const fv = s.field_values ?? {}
      for (const req of entry.required_slots) {
        if (fv[req] == null || fv[req] === '') {
          failures.push({
            page_slug: slug, section_intent_id: intentId, template_id: tid,
            check: 'required_slot_missing',
            detail: `field_values.${req} is empty (template requires it)`,
          })
          totalRequiredMissing++
        }
      }
    }

    // Check 2: lorem detection in field_values
    const loremHit = containsLorem(s.field_values)
    if (loremHit) {
      failures.push({
        page_slug: slug, section_intent_id: intentId, template_id: tid,
        check: 'lorem_leakage',
        detail: `field_values contains '${loremHit}'`,
      })
      totalLorem++
    }

    // Check 3: button label+url completeness (for any button-bearing field)
    if (entry?.uniform_to_brixies.buttons) {
      const field = entry.uniform_to_brixies.buttons.field
      const nesting = entry.uniform_to_brixies.buttons.nesting
      const subL = entry.uniform_to_brixies.buttons.subfields.label
      const subU = entry.uniform_to_brixies.buttons.subfields.url
      const composed = (s.field_values?.[field] ?? []) as Array<Record<string, unknown>>
      if (Array.isArray(composed)) {
        composed.forEach((b, idx) => {
          const inner = nesting === 'contact'
            ? (b.contact as Record<string, unknown> | undefined) ?? {}
            : b
          const label = inner[subL]
          const url   = subU ? inner[subU] : undefined
          if (!label) {
            failures.push({
              page_slug: slug, section_intent_id: intentId, template_id: tid,
              check: 'button_missing_label',
              detail: `button #${idx + 1} under field '${field}' has no label`,
            })
            totalButtonGap++
          }
          if (subU && !url) {
            failures.push({
              page_slug: slug, section_intent_id: intentId, template_id: tid,
              check: 'button_missing_url',
              detail: `button #${idx + 1} under field '${field}' has no url`,
            })
            totalButtonGap++
          }
        })
      }
    }

    // Check 4: cowork_slot_values re-derives to current field_values
    if (entry && s.cowork_slot_values) {
      const re = composeFieldValuesForBrixies(s.cowork_slot_values, entry)
      // Compare TOP-LEVEL keys + values via JSON. If the strategist
      // hand-edited field_values without touching cowork_slot_values,
      // the re-derived shape will diverge.
      const stale = Object.keys(re.field_values).filter(k => {
        const a = JSON.stringify(re.field_values[k] ?? null)
        const b = JSON.stringify(s.field_values?.[k] ?? null)
        return a !== b
      })
      if (stale.length > 0) {
        failures.push({
          page_slug: slug, section_intent_id: intentId, template_id: tid,
          check: 'cowork_slot_values_drift',
          detail: `${stale.length} field(s) drifted from cowork_slot_values: ${stale.slice(0, 3).join(', ')}${stale.length > 3 ? '…' : ''}`,
        })
        totalDrift++
      }
    }
  }

  console.log(`\nHandoff render-integrity`)
  console.log(`  manifest version  ${(mRes as { version: string }).version}`)
  console.log(`  pages             ${pages.length}`)
  console.log(`  sections checked  ${totalChecked} (non-cowork sections skipped)`)
  console.log(`  failures          ${failures.length}`)
  console.log(`    required slot missing  ${totalRequiredMissing}`)
  console.log(`    lorem leakage          ${totalLorem}`)
  console.log(`    button gap             ${totalButtonGap}`)
  console.log(`    slot/field drift       ${totalDrift}`)
  if (failures.length > 0) {
    console.log()
    for (const f of failures.slice(0, 50)) {
      console.log(`  ✗ ${f.page_slug}/${f.section_intent_id} [${f.template_id ?? '?'}] · ${f.check} — ${f.detail}`)
    }
    if (failures.length > 50) console.log(`  …${failures.length - 50} more`)
    console.log(`\n✗ FAIL`)
    process.exit(1)
  }
  if (totalChecked === 0) {
    console.log(`\n(no cowork-pushed sections yet — run the handoff first)`)
    process.exit(0)
  }
  console.log(`\n✓ PASS — every cowork section renders with full layout integrity`)
  process.exit(0)
}

main().catch(err => {
  console.error('check-handoff-render-integrity crashed:', err)
  process.exit(2)
})
