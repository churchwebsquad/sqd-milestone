#!/usr/bin/env tsx
/**
 * Real render verification.
 *
 * Polyfills window/document via jsdom, calls renderSectionToHtml
 * against every cowork section in a project, then checks the
 * rendered HTML's TEXT CONTENT contains the cowork-emitted strings
 * (heading, body, button labels, items).
 *
 * This is the regression suite that should have existed from day 1.
 * The earlier scripts checked the translator's output SHAPE; this
 * one checks the renderer's output PIXELS (text content).
 *
 * Run:  npx tsx scripts/check-real-render.ts <project_id>
 * Exit: 0 every section shows every cowork string | 1 any miss
 */
/* eslint-disable no-console, @typescript-eslint/no-explicit-any */

// @ts-ignore — jsdom not in devDependencies; installed at runtime
import { JSDOM } from 'jsdom'
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'

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

// Polyfill browser globals BEFORE importing the renderer.
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
;(globalThis as any).window      = dom.window
;(globalThis as any).document    = dom.window.document
;(globalThis as any).DOMParser   = dom.window.DOMParser
;(globalThis as any).Element     = dom.window.Element
;(globalThis as any).HTMLElement = dom.window.HTMLElement
;(globalThis as any).Node        = dom.window.Node
;(globalThis as any).NodeFilter  = dom.window.NodeFilter
;(globalThis as any).Image       = dom.window.Image
;(globalThis as any).getComputedStyle = dom.window.getComputedStyle

import { renderSectionToHtml } from '../src/lib/webBrixiesRender.js'
import { composeFieldValuesForBrixies, type ManifestEntry } from '../src/lib/cowork/coworkToBrixies.js'

interface Miss {
  page_slug: string
  intent:    string
  template:  string
  field:     string
  expected:  string
  context:   string
}

function flattenStrings(v: unknown): string[] {
  if (typeof v === 'string') return [v]
  if (Array.isArray(v)) return v.flatMap(flattenStrings)
  if (v && typeof v === 'object') return Object.values(v as Record<string, unknown>).flatMap(flattenStrings)
  return []
}

/** Aggressive normalize: decode every HTML entity then strip every
 *  non-alphanumeric. Apply to both source string and rendered text
 *  before substring match — avoids false misses from &#39; vs ' etc. */
function normalize(s: string): string {
  const decoded = (s ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g,         (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
  return decoded.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
}

function tagSafeSnippet(s: string): string {
  // First ~50 chars normalized — long enough to be specific, short
  // enough to survive minor truncation in tight layouts.
  return normalize(s).slice(0, 40)
}

async function main(): Promise<void> {
  const projectId = process.argv[2] ?? '2eac7eb8-269d-4584-84a4-3dc9fdd6fcde'
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) { console.error('missing env'); process.exit(2) }
  const sb = createClient(url, key, { auth: { persistSession: false } })

  // Load all cowork sections + their templates for the project
  const { data: pages } = await sb.from('web_pages')
    .select('id, slug')
    .eq('web_project_id', projectId)
    .eq('archived', false)
  if (!pages?.length) { console.log('no pages'); process.exit(0) }
  const slugById = new Map((pages as any[]).map(p => [p.id, p.slug]))

  const { data: sections } = await sb.from('web_sections')
    .select('id, web_page_id, content_template_id, field_values, cowork_slot_values, cowork_section_meta, sort_order')
    .in('web_page_id', (pages as any[]).map(p => p.id))
    .not('cowork_slot_values', 'is', null)
    .order('sort_order')
  if (!sections?.length) { console.log('no cowork sections'); process.exit(0) }

  const tplIds = Array.from(new Set((sections as any[]).map(s => s.content_template_id).filter(Boolean)))
  const { data: templates } = await sb.from('web_content_templates')
    .select('id, family, layer_name, fields, source_html')
    .in('id', tplIds)
  const tplById = new Map((templates as any[]).map(t => [t.id, t]))

  // Card-family templates used by palette groups (item_template_ref:
  // 'from_palette'). The renderer's expandPaletteGroup looks up the
  // picked card template via the cardTemplates param — must be loaded
  // and passed for sections like feature-section-2 to bind correctly.
  const { data: cardTpls } = await sb.from('web_content_templates')
    .select('id, family, layer_name, fields, source_html')
    .eq('family', 'Card')
  const cardTemplatesById = Object.fromEntries(((cardTpls ?? []) as any[]).map(t => [t.id, t]))

  // Load v2.0.1 manifest so we re-derive field_values via the CURRENT
  // translator (not whatever stale state the DB row was written with).
  const { data: manRes } = await sb.schema('strategy').from('cowork_templates')
    .select('manifest')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const manifest = (manRes as any)?.manifest?.page_section_templates ?? {}
  const entryByTemplateId = new Map<string, ManifestEntry>()
  for (const e of Object.values(manifest)) entryByTemplateId.set((e as ManifestEntry).template_id, e as ManifestEntry)

  const misses: Miss[] = []
  const renderedSample: Record<string, string> = {}
  let checked = 0
  let withGap = 0

  for (const s of sections as any[]) {
    const tpl = tplById.get(s.content_template_id)
    if (!tpl) continue
    checked++
    const slug = slugById.get(s.web_page_id) ?? '?'
    const intent = s.cowork_section_meta?.section_intent_id ?? s.id.slice(0, 8)

    // Re-derive field_values from cowork_slot_values via the CURRENT
    // translator (the stored field_values reflect whatever the
    // handoff endpoint wrote at last push — which may be stale).
    const entry = entryByTemplateId.get(tpl.id)
    const bindResult = entry
      ? composeFieldValuesForBrixies((s.cowork_slot_values ?? {}) as any, entry)
      : { field_values: (s.field_values ?? {}) as Record<string, unknown>, gaps: [] as any[] }
    const derived = bindResult.field_values

    // Known-intentional template-cap losses get reported separately
    // — these aren't bugs, they're documented limits the strategist
    // resolves via the variant picker. Currently:
    //   secondary_button_unfilled_by_template — cta_callout has 1
    //     cta slot but cowork emitted 2+ buttons. Surfaced as a
    //     warning in the audit panel; secondary preserved in
    //     cowork_slot_values + Rich Companion.
    const intentionalGapKinds = new Set([
      'secondary_button_unfilled_by_template',
    ])
    const intentionalGaps = (bindResult.gaps ?? []).filter((g: any) => intentionalGapKinds.has(g.kind))

    let html: string
    try {
      html = renderSectionToHtml(tpl, derived as any, {}, cardTemplatesById)
    } catch (e) {
      misses.push({ page_slug: slug, intent, template: tpl.id, field: '<render-throw>', expected: String(e).slice(0, 80), context: '' })
      continue
    }

    // Stash one rendered output per template for human review.
    if (!renderedSample[tpl.id]) renderedSample[tpl.id] = html.slice(0, 2000)

    // Strip HTML tags + decode entities + strip non-alphanumeric so
    // we can compare against tagSafeSnippet(coworkValue) directly.
    const textRaw = html.replace(/<[^>]+>/g, ' ')
    const text = normalize(textRaw)

    // Every cowork string must appear in the rendered text.
    const cowork = (s.cowork_slot_values ?? {}) as Record<string, unknown>
    const fieldSightings: Array<[string, unknown]> = []
    if (cowork.primary_heading) fieldSightings.push(['primary_heading', cowork.primary_heading])
    if (cowork.tagline)         fieldSightings.push(['tagline',         cowork.tagline])
    if (cowork.body)            fieldSightings.push(['body',            cowork.body])
    if (cowork.accent_body)     fieldSightings.push(['accent_body',     cowork.accent_body])
    for (const [i, it] of Array.from((cowork.items as any[]) ?? []).entries()) {
      if (it.item_heading) fieldSightings.push([`items[${i}].item_heading`, it.item_heading])
      if (it.item_body)    fieldSightings.push([`items[${i}].item_body`,    it.item_body])
    }
    // Skip secondary button label check when the template has the
    // documented "1 cta slot, multiple buttons" loss (cta_callout)
    // — that's an intentional template-cap limit, not a render bug.
    // Strategist resolves via variant picker (swap to cta_simple).
    const skipSecondaryButton = intentionalGaps.some((g: any) => g.kind === 'secondary_button_unfilled_by_template')
    for (const [i, b] of Array.from((cowork.buttons as any[]) ?? []).entries()) {
      if (skipSecondaryButton && i > 0) continue
      if (b.label) fieldSightings.push([`buttons[${i}].label`, b.label])
    }

    let sectionHasGap = false
    for (const [field, raw] of fieldSightings) {
      for (const v of flattenStrings(raw)) {
        const snip = tagSafeSnippet(v)
        if (!snip) continue
        if (!text.includes(snip)) {
          misses.push({
            page_slug: slug, intent, template: tpl.id, field,
            expected: snip,
            context:  v.slice(0, 100),
          })
          sectionHasGap = true
        }
      }
    }
    if (sectionHasGap) withGap++
  }

  // Write a per-template rendered HTML sample for inspection.
  if (process.argv.includes('--dump')) {
    writeFileSync('/tmp/render-samples.html', Object.entries(renderedSample)
      .map(([k, v]) => `<!-- ${k} -->\n${v}\n\n<hr>\n`).join('\n'))
    console.log('Per-template render samples → /tmp/render-samples.html')
  }

  // Roll up misses by template
  const byTemplate = new Map<string, Miss[]>()
  for (const m of misses) {
    const k = m.template
    if (!byTemplate.has(k)) byTemplate.set(k, [])
    byTemplate.get(k)!.push(m)
  }

  console.log(`\nReal render verification`)
  console.log(`  project    ${projectId}`)
  console.log(`  sections   ${checked}`)
  console.log(`  with gap   ${withGap}`)
  console.log(`  total misses ${misses.length}`)

  if (byTemplate.size > 0) {
    console.log(`\nMisses by template:`)
    for (const [tpl, ms] of [...byTemplate.entries()].sort((a,b)=>b[1].length-a[1].length)) {
      console.log(`  ${tpl}  (${ms.length})`)
      const byField = new Map<string, number>()
      for (const m of ms) byField.set(m.field.replace(/\[\d+\]/g, '[N]'), (byField.get(m.field.replace(/\[\d+\]/g, '[N]')) ?? 0) + 1)
      for (const [f, n] of byField) console.log(`     ${String(n).padStart(3)}  ${f}`)
    }
    console.log(`\nSample misses:`)
    for (const m of misses.slice(0, 15)) {
      console.log(`  ✗ ${m.page_slug}/${m.intent} [${m.template}] · ${m.field} — expected "${m.expected}"`)
    }
    console.log(`\n✗ FAIL`)
    process.exit(1)
  }
  console.log(`\n✓ PASS — every cowork string visible in rendered HTML`)
  process.exit(0)
}

main().catch(err => { console.error('crashed:', err); process.exit(2) })
