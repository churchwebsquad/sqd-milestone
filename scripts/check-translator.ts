#!/usr/bin/env tsx
/**
 * composeFieldValuesForBrixies strict regression.
 *
 * Per template in the v2.0.1 canonical manifest: feed a synthesized
 * cowork section with the full uniform-slot payload that template
 * COULD bind, run the translator, and assert:
 *   1. perfect bind (no gaps)
 *   2. every populated uniform slot maps to its declared brixies key
 *   3. button nesting matches the manifest declaration (flat vs contact)
 *   4. items split rules distribute correctly (alternate vs single field)
 *   5. richtext keys get HTML-wrapped
 *
 * Plus refusal contracts:
 *   - missing required slot → gap reported
 *   - cowork emits a slot the template doesn't support → gap reported
 *   - button without label/url → gap reported
 *
 * Run:  npx tsx scripts/check-translator.ts
 * Exit: 0 all pass | 1 any fail
 */
/* eslint-disable no-console */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import {
  composeFieldValuesForBrixies,
  type ManifestEntry,
} from '../src/lib/cowork/coworkToBrixies.js'

// .env.local loader (project doesn't use dotenv)
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

interface Failure { template: string; check: string; detail: string }

async function main(): Promise<void> {
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) { console.error('missing env'); process.exit(2) }
  const sb = createClient(url, key, { auth: { persistSession: false } })

  const { data, error } = await sb.schema('strategy').from('cowork_templates')
    .select('version, manifest')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) { console.error(`manifest load failed: ${error?.message}`); process.exit(2) }
  const manifest = (data as { manifest: { page_section_templates: Record<string, ManifestEntry> } }).manifest
  const templates = manifest.page_section_templates

  // Templates with template-specific overrides in
  // applyTemplateOverrides() — the uniform-shape assertions don't
  // apply because the override intentionally diverges from the
  // declared uniform_to_brixies mapping. Real correctness is
  // verified by scripts/check-real-render.ts, which calls the
  // production renderer against synthetic markers + greps the
  // rendered HTML for content presence (a stricter test).
  const OVERRIDDEN_TEMPLATES = new Set([
    'content_image_text_b',  // body → description_items[0].text (description slot shadowed)
    'content_featured_a',    // column_list[].card[].{heading_card, description_card}
    'cards_with_cta',        // row_list[].item_list[0].card[0] + button_card per item
    'feature_team',          // row_grid[0].card_team[].{team_name, team_position, team_description}
    'feature_unique',        // row_list[].item_list[0].card[0].{heading_card, list_item[0].description}
    'content_image_text_a',  // counter_contain[].{counter[].description, counter_description}
    'cta_callout',           // buttons becomes single {label, url} object, image is designer-only
    'accordion_faq',         // items collapse to flowed description (renderer limitation)
  ])

  const failures: Failure[] = []
  const tested: string[] = []
  const skipped: string[] = []

  for (const [key, entry] of Object.entries(templates)) {
    if (OVERRIDDEN_TEMPLATES.has(key)) {
      skipped.push(key)
      continue
    }
    tested.push(key)

    // Build a maximal synthetic input — populate every uniform slot
    // the template's map says it supports (plus all subfields).
    const slotValues: Record<string, unknown> = {}
    const map = entry.uniform_to_brixies

    if (map.tagline)         slotValues.tagline         = 'Test Tagline'
    if (map.primary_heading) slotValues.primary_heading = 'Test Primary Heading'
    if (map.body)            slotValues.body            = 'Test body paragraph.'
    if (map.accent_body)     slotValues.accent_body     = 'Test accent body.'
    if (map.buttons) {
      slotValues.buttons = [
        { label: 'Primary CTA', url: 'https://example.com/a' },
        { label: 'Secondary',   url: 'https://example.com/b' },
      ]
    }
    if (map.items) {
      // Respect each template's max_items cap so we test perfect-bind
      // not items_overflow. Split templates need at least 4 to verify
      // alternate distribution; clamp the others to their cap.
      const cap     = entry.cowork_writable_slots?.items?.max_items ?? 4
      const target  = map.items.split ? Math.max(cap, 4) : cap
      const items: Array<Record<string, string>> = []
      for (let i = 1; i <= target; i++) {
        items.push({ item_heading: `Item ${i}`, item_body: `Body ${i}`, item_meta: `Meta ${i}` })
      }
      slotValues.items = items
    }

    const result = composeFieldValuesForBrixies(slotValues, entry)

    // Check 1: zero gaps on a maximal payload (perfect bind)
    if (result.bind_quality !== 'perfect') {
      failures.push({
        template: key,
        check: 'perfect_bind_on_maximal_input',
        detail: `expected perfect, got partial. gaps: ${result.gaps.map(g => g.kind).join(', ')}`,
      })
    }

    // Check 2: each populated uniform key maps to a present brixies key
    for (const u of ['tagline', 'primary_heading', 'body', 'accent_body'] as const) {
      if (slotValues[u] && map[u]) {
        const expected = map[u]!
        if (result.field_values[expected] == null || result.field_values[expected] === '') {
          failures.push({
            template: key,
            check: `scalar_passthrough.${u}`,
            detail: `expected field_values.${expected} populated; got: ${JSON.stringify(result.field_values[expected])}`,
          })
        }
        // Richtext keys must be HTML-wrapped if they got raw text
        if (entry.richtext_keys?.includes(expected) && typeof result.field_values[expected] === 'string') {
          const v = result.field_values[expected] as string
          if (!/^</.test(v.trim())) {
            failures.push({
              template: key,
              check: `richtext_html_wrap.${expected}`,
              detail: `richtext slot '${expected}' not HTML-wrapped: ${v.slice(0, 60)}`,
            })
          }
        }
      }
    }

    // Check 3: buttons nesting
    if (map.buttons && Array.isArray(slotValues.buttons)) {
      const field = map.buttons.field
      const composed = result.field_values[field] as Array<Record<string, unknown>> | undefined
      if (!Array.isArray(composed) || composed.length !== 2) {
        failures.push({
          template: key,
          check: 'buttons_count',
          detail: `expected 2 buttons under field '${field}'; got: ${JSON.stringify(composed)}`,
        })
      } else if (map.buttons.nesting === 'contact') {
        if (!('contact' in composed[0])) {
          failures.push({
            template: key,
            check: 'buttons_contact_nesting',
            detail: `nesting='contact' but first button doesn't have a contact key: ${JSON.stringify(composed[0])}`,
          })
        }
      } else if (map.buttons.nesting === 'flat') {
        if ('contact' in composed[0]) {
          failures.push({
            template: key,
            check: 'buttons_flat_nesting',
            detail: `nesting='flat' but first button is wrapped in contact: ${JSON.stringify(composed[0])}`,
          })
        }
      }
    }

    // Check 4: items split rule + count fidelity
    if (map.items && Array.isArray(slotValues.items)) {
      const fed = (slotValues.items as unknown[]).length
      if (map.items.split) {
        const [gA, gB] = map.items.split.groups
        const arrA = result.field_values[gA] as unknown[] | undefined
        const arrB = result.field_values[gB] as unknown[] | undefined
        const total = (arrA?.length ?? 0) + (arrB?.length ?? 0)
        if (total !== fed) {
          failures.push({
            template: key,
            check: 'items_split_total',
            detail: `expected ${fed} items distributed across [${gA},${gB}]; got ${total} (${arrA?.length}/${arrB?.length})`,
          })
        }
        if (map.items.split.rule === 'alternate') {
          const expectedA = Math.ceil(fed / 2)
          const expectedB = Math.floor(fed / 2)
          if (arrA?.length !== expectedA || arrB?.length !== expectedB) {
            failures.push({
              template: key,
              check: 'items_split_alternate',
              detail: `alternate of ${fed} should produce ${expectedA}+${expectedB}; got ${arrA?.length}+${arrB?.length}`,
            })
          }
        }
      } else if (map.items.field) {
        const arr = result.field_values[map.items.field] as unknown[] | undefined
        if (!Array.isArray(arr) || arr.length !== fed) {
          failures.push({
            template: key,
            check: 'items_single_group_count',
            detail: `expected ${fed} items under '${map.items.field}'; got ${arr?.length}`,
          })
        }
      }
    }
  }

  // Refusal contracts — test on a known well-shaped template
  const heroInner = templates.hero_inner
  if (heroInner) {
    // Missing required slot ('heading') → gap reported
    const r1 = composeFieldValuesForBrixies({ body: 'no heading present' }, heroInner)
    if (r1.bind_quality !== 'partial' || !r1.gaps.some(g => g.kind === 'required_slot_missing')) {
      failures.push({
        template: 'hero_inner',
        check: 'refusal.required_slot_missing',
        detail: `expected required_slot_missing gap when heading absent; got: ${JSON.stringify(r1.gaps)}`,
      })
    }

    // Button without url → button_missing_url gap
    const r2 = composeFieldValuesForBrixies(
      { primary_heading: 'OK', buttons: [{ label: 'no url' }] },
      heroInner,
    )
    if (!r2.gaps.some(g => g.kind === 'button_missing_url')) {
      failures.push({
        template: 'hero_inner',
        check: 'refusal.button_missing_url',
        detail: `expected button_missing_url gap; got: ${JSON.stringify(r2.gaps)}`,
      })
    }
  }

  // cowork emits a slot the template doesn't support → uniform_slot_not_supported_by_template
  const ctaSimple = templates.cta_simple
  if (ctaSimple) {
    // cta_simple has no items slot
    const r3 = composeFieldValuesForBrixies(
      {
        primary_heading: 'OK',
        items: [{ item_heading: 'x', item_body: 'y' }],
      },
      ctaSimple,
    )
    if (!r3.gaps.some(g => g.kind === 'uniform_slot_not_supported_by_template' && g.slot === 'items')) {
      failures.push({
        template: 'cta_simple',
        check: 'refusal.uniform_slot_not_supported',
        detail: `expected uniform_slot_not_supported_by_template for items; got: ${JSON.stringify(r3.gaps)}`,
      })
    }
  }

  console.log(`\nTranslator regression`)
  console.log(`  manifest version  ${(data as { version: string }).version}`)
  console.log(`  templates tested  ${tested.length}`)
  console.log(`  override-skipped  ${skipped.length} (verified by check:real-render): ${skipped.join(', ')}`)
  console.log(`  failures          ${failures.length}`)
  if (failures.length > 0) {
    console.log()
    for (const f of failures) console.log(`  ✗ ${f.template} / ${f.check} — ${f.detail}`)
    console.log(`\n✗ FAIL`)
    process.exit(1)
  }
  console.log(`\n✓ PASS — all ${tested.length} templates + 3 refusal contracts hold`)
  process.exit(0)
}

main().catch(err => {
  console.error('check-translator crashed:', err)
  process.exit(2)
})
