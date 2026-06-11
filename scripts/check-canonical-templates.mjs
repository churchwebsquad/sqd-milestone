#!/usr/bin/env node
/**
 * Drift check between cowork-skills/canonical-templates.json and
 * cowork-skills/brixies-library.json.
 *
 * canonical-templates.json declares each cowork concept's bind target
 * (a Brixies template_id) + the cowork-side slot vocabulary with
 * max_chars enforced at allocation time. brixies-library.json is the
 * actual renderer schema; its max_chars are the ground truth.
 *
 * When the two drift (Brixies edits a slot's max_chars; canonical
 * doesn't follow), copy fails silently at bind: long text gets
 * truncated, short max passes a length check that the renderer
 * actually rejects. P1 from the review doc.
 *
 * What this script verifies (per concept):
 *   1. template_id resolves to a Brixies template (else hallucinated ref).
 *   2. family + variant on canonical match Brixies (catches drift after rename).
 *   3. For each simple cowork slot (tagline, primary_heading, body,
 *      accent_body, buttons.label) — the Brixies slot it maps to has the
 *      same max_chars canonical claims.
 *
 * Per-concept items[] mapping is intentionally OUT OF SCOPE here —
 * those map to template-specific group keys (accordion_left vs
 * card_slider vs row_list vs ...) and need a separate per-template
 * lookup table. Adding that is a follow-up only when items drift
 * actually shows up in production. Simple slots cover the ~80% case.
 *
 * Modes:
 *   node scripts/check-canonical-templates.mjs            → report drift, exit 1 on drift
 *   node scripts/check-canonical-templates.mjs --write    → auto-fix max_chars + family + variant in canonical, exit 0
 *
 * Wired up as:
 *   npm run check:canonical-templates
 *   npm run build:canonical-templates   (--write mode)
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BRIXIES_PATH = join(ROOT, 'cowork-skills/brixies-library.json')
const CANONICAL_PATH = join(ROOT, 'cowork-skills/canonical-templates.json')

/**
 * cowork-side slot → brixies-side slot key on the template's top-level
 * fields[]. These mappings are STABLE across every template that uses
 * the cowork uniform vocabulary — tagline always maps to tagline,
 * primary_heading to heading, body to description, etc.
 */
const SIMPLE_SLOT_MAP = {
  tagline:         { brixies: 'tagline'            },
  primary_heading: { brixies: 'heading'            },
  body:            { brixies: 'description'        },
  accent_body:     { brixies: 'accent_description' },
}

const WRITE = process.argv.includes('--write')

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'))
}

function findFieldByKey(fields, key) {
  return (fields || []).find(f => f.key === key) || null
}

function checkTemplate(concept, canonical, brixies) {
  const drift = []
  const fix = []

  // 1. template_id resolution + family/variant integrity
  if (!brixies) {
    drift.push({ kind: 'missing_template', detail: `brixies has no template id=${canonical.template_id}` })
    return { drift, fix }
  }

  if (canonical.family !== brixies.family) {
    drift.push({
      kind:     'family_mismatch',
      detail:   `expected ${JSON.stringify(brixies.family)}, canonical has ${JSON.stringify(canonical.family)}`,
      autofix:  () => { canonical.family = brixies.family },
    })
  }
  if (String(canonical.variant) !== String(brixies.variant)) {
    drift.push({
      kind:    'variant_mismatch',
      detail:  `expected ${JSON.stringify(brixies.variant)}, canonical has ${JSON.stringify(canonical.variant)}`,
      autofix: () => { canonical.variant = String(brixies.variant) },
    })
  }

  // 2. simple cowork slots
  for (const [cwSlot, mapping] of Object.entries(SIMPLE_SLOT_MAP)) {
    const cwDef = canonical.cowork_writable_slots?.[cwSlot]
    if (!cwDef) continue                                     // slot not used on this template
    if (typeof cwDef.max_chars !== 'number') continue        // not a max-chars slot (e.g. nested)
    const brixiesSlot = findFieldByKey(brixies.fields, mapping.brixies)
    if (!brixiesSlot) {
      drift.push({
        kind:    'missing_brixies_slot',
        detail:  `canonical declares slot '${cwSlot}' but brixies template ${brixies.id} has no field key '${mapping.brixies}'`,
      })
      continue
    }
    if (brixiesSlot.max_chars !== cwDef.max_chars) {
      drift.push({
        kind:    'max_chars_drift',
        slot:    cwSlot,
        detail:  `${cwSlot}: brixies ${mapping.brixies}.max_chars=${brixiesSlot.max_chars}, canonical max_chars=${cwDef.max_chars}`,
        autofix: () => { cwDef.max_chars = brixiesSlot.max_chars },
      })
    }
  }

  // 3. buttons.label max_chars (group with single inner slot, typically 'contact')
  const cwButtons = canonical.cowork_writable_slots?.buttons
  if (cwButtons?.item_subfields?.label) {
    // Find the brixies buttons-style group. Concepts use either 'buttons' (group)
    // or 'cta' (slot, no group) — cta_callout is the cta:slot case.
    const brixiesButtons = findFieldByKey(brixies.fields, 'buttons')
    const brixiesCta     = findFieldByKey(brixies.fields, 'cta')
    if (brixiesButtons && brixiesButtons.kind === 'group') {
      const innerLabel = (brixiesButtons.item_schema || []).find(s => s.kind === 'slot')
      const expected   = innerLabel?.max_chars
      const actual     = cwButtons.item_subfields.label.max_chars
      if (typeof expected === 'number' && expected !== actual) {
        drift.push({
          kind:    'buttons_max_chars_drift',
          detail:  `buttons.label: brixies buttons.${innerLabel.key}.max_chars=${expected}, canonical max_chars=${actual}`,
          autofix: () => { cwButtons.item_subfields.label.max_chars = expected },
        })
      }
    } else if (brixiesCta && brixiesCta.kind === 'slot' && typeof brixiesCta.max_chars === 'number') {
      const actual = cwButtons.item_subfields.label.max_chars
      if (brixiesCta.max_chars !== actual) {
        drift.push({
          kind:    'buttons_max_chars_drift',
          detail:  `buttons.label (cta slot): brixies cta.max_chars=${brixiesCta.max_chars}, canonical max_chars=${actual}`,
          autofix: () => { cwButtons.item_subfields.label.max_chars = brixiesCta.max_chars },
        })
      }
    }
    // else: this concept doesn't have a buttons-style field in Brixies — nothing to check
  }

  // Collect autofix callables for --write mode
  for (const d of drift) {
    if (d.autofix) fix.push(d)
  }
  return { drift, fix }
}

function main() {
  const bl = loadJson(BRIXIES_PATH)
  const ct = loadJson(CANONICAL_PATH)

  const sections = ct.page_section_templates || {}
  const concepts = Object.keys(sections)
  let totalDrift = 0
  let totalFixed = 0

  console.log(`Checking ${concepts.length} canonical concepts against brixies-library…`)
  for (const concept of concepts) {
    const canonical = sections[concept]
    const brixies   = bl.templates.find(t => t.id === canonical.template_id)
    const { drift, fix } = checkTemplate(concept, canonical, brixies)
    if (drift.length === 0) continue

    totalDrift += drift.length
    console.log(`  ✗ ${concept} (${canonical.template_id}) — ${drift.length} issue${drift.length === 1 ? '' : 's'}`)
    for (const d of drift) console.log(`      ${d.kind}: ${d.detail}`)

    if (WRITE && fix.length > 0) {
      for (const f of fix) f.autofix()
      totalFixed += fix.length
    }
  }

  // Verify post-and-listing template_ids resolve too (no slots, just existence check)
  const postLT = ct.post_and_listing_templates_for_design_handoff || {}
  for (const [name, tid] of Object.entries(postLT)) {
    if (!bl.templates.find(t => t.id === tid)) {
      totalDrift += 1
      console.log(`  ✗ post_and_listing.${name} — brixies has no template id=${tid}`)
    }
  }

  console.log('')
  if (totalDrift === 0) {
    console.log('✓ canonical-templates.json is in sync with brixies-library.json')
    process.exit(0)
  }

  if (WRITE) {
    writeFileSync(CANONICAL_PATH, JSON.stringify(ct, null, 2) + '\n', 'utf-8')
    console.log(`✓ Wrote ${totalFixed} fix${totalFixed === 1 ? '' : 'es'} to canonical-templates.json (${totalDrift - totalFixed} non-auto-fixable issue${totalDrift - totalFixed === 1 ? '' : 's'} remaining)`)
    process.exit(totalDrift - totalFixed === 0 ? 0 : 1)
  } else {
    console.log(`✗ ${totalDrift} drift issue${totalDrift === 1 ? '' : 's'} found. Run with --write to auto-fix max_chars / family / variant.`)
    process.exit(1)
  }
}

main()
