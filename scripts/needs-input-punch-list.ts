#!/usr/bin/env tsx
/**
 * Scan a project's cowork artifacts + web_sections for unresolved
 * NEEDS_INPUT markers and report them as a strategist-actionable
 * punch list. Run AFTER an audit completes to see what the partner
 * still owes; run AGAIN later to confirm everything got resolved.
 *
 * Recognized marker shapes (matching isNeedsInput() in
 * src/lib/cowork/coworkToBrixies.ts):
 *   [NEEDS INPUT: ...]
 *   \[NEEDS INPUT: ...\]
 *   *pending: ...*
 *   *photo: [NEEDS INPUT: ...]*
 *   *image: [NEEDS INPUT: ...]*
 *
 * Scans both:
 *   - roadmap_state.page_drafts.<slug>.sections[*].slot_values
 *   - web_sections.cowork_slot_values (the durable copy that
 *     drives the rendered page)
 *
 * Run:  npx tsx scripts/needs-input-punch-list.ts <project_id>
 *       (defaults to Arvada)
 */
/* eslint-disable no-console, @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { isNeedsInput } from '../src/lib/cowork/coworkToBrixies.js'

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

interface Marker {
  source:    'roadmap' | 'web_section'
  slug:      string
  intent:    string
  path:      string
  value:     string
}

/** Walk an object recursively, yielding every string value with its
 *  jsonpath-style key trail so we can attribute the marker to a slot. */
function* walkStrings(v: unknown, trail: string[] = []): Generator<{ trail: string[]; value: string }> {
  if (typeof v === 'string') {
    yield { trail, value: v }
    return
  }
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) yield* walkStrings(v[i], [...trail, `[${i}]`])
    return
  }
  if (v && typeof v === 'object') {
    for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
      yield* walkStrings(child, [...trail, k])
    }
  }
}

async function main() {
  const projectId = process.argv[2] ?? '2eac7eb8-269d-4584-84a4-3dc9fdd6fcde'
  const url = process.env.VITE_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const sb = createClient(url, key, { auth: { persistSession: false } })

  // 1. Cowork artifacts in roadmap_state
  const { data: proj } = await sb.from('strategy_web_projects')
    .select('id, name, roadmap_state')
    .eq('id', projectId)
    .maybeSingle()
  if (!proj) { console.error('project not found'); process.exit(2) }

  const drafts = ((proj as any).roadmap_state?.page_drafts ?? {}) as Record<string, any>
  const markers: Marker[] = []

  for (const [slug, draft] of Object.entries(drafts)) {
    const sections = Array.isArray((draft as any).sections) ? (draft as any).sections : []
    for (const s of sections) {
      const intent = s.section_intent_id ?? '?'
      const slotValues = s.slot_values ?? {}
      for (const { trail, value } of walkStrings(slotValues)) {
        if (isNeedsInput(value)) {
          markers.push({
            source: 'roadmap', slug, intent,
            path:   `slot_values.${trail.join('.')}`,
            value:  value.length > 120 ? value.slice(0, 120) + '…' : value,
          })
        }
      }
    }
  }

  // 2. Live web_sections (in case strategist edited after handoff)
  const { data: pages } = await sb.from('web_pages')
    .select('id, slug')
    .eq('web_project_id', projectId)
    .eq('archived', false)
  const pageIds = (pages ?? []).map((p: any) => p.id)
  const slugByPageId = new Map((pages ?? []).map((p: any) => [p.id, p.slug]))

  if (pageIds.length > 0) {
    const { data: sections } = await sb.from('web_sections')
      .select('id, web_page_id, cowork_slot_values, cowork_section_meta')
      .in('web_page_id', pageIds)
      .not('cowork_slot_values', 'is', null)
    for (const s of (sections ?? []) as any[]) {
      const slug = slugByPageId.get(s.web_page_id) ?? '?'
      const intent = s.cowork_section_meta?.section_intent_id ?? s.id.slice(0, 8)
      for (const { trail, value } of walkStrings(s.cowork_slot_values)) {
        if (isNeedsInput(value)) {
          markers.push({
            source: 'web_section', slug, intent,
            path:   trail.join('.'),
            value:  value.length > 120 ? value.slice(0, 120) + '…' : value,
          })
        }
      }
    }
  }

  // Roll up by slug
  const bySlug = new Map<string, Marker[]>()
  for (const m of markers) {
    if (!bySlug.has(m.slug)) bySlug.set(m.slug, [])
    bySlug.get(m.slug)!.push(m)
  }
  const sortedSlugs = Array.from(bySlug.keys()).sort()

  console.log(`\nNEEDS INPUT punch list — ${(proj as any).name}`)
  console.log(`  project        ${projectId}`)
  console.log(`  total markers  ${markers.length}`)
  console.log(`  pages affected ${bySlug.size}`)
  console.log()

  for (const slug of sortedSlugs) {
    const ms = bySlug.get(slug)!
    console.log(`  ${slug}  (${ms.length})`)
    // Deduplicate by (intent, path) — markers can appear in both
    // roadmap_state AND web_sections; show one row.
    const seen = new Set<string>()
    for (const m of ms) {
      const k = `${m.intent}::${m.path}`
      if (seen.has(k)) continue
      seen.add(k)
      console.log(`    ${m.intent.padEnd(14)} ${m.path.padEnd(30)} ${m.value}`)
    }
  }

  if (markers.length === 0) {
    console.log(`  (no unresolved markers — every slot is filled)`)
  }
  console.log()
  process.exit(0)
}

main().catch(err => { console.error('crashed:', err); process.exit(2) })
