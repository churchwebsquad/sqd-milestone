#!/usr/bin/env tsx
/**
 * Cowork→Pages handoff DRY-RUN.
 *
 * Pulls a project's cowork artifacts (page_drafts) + the v2.0.0
 * canonical-templates manifest, runs the same translator the live
 * endpoint uses (composeFieldValuesForBrixies), and reports per-
 * section bind quality + the project-wide perfect_rate.
 *
 * Quality bar: ≥ 0.90 perfect_rate. Below 0.90 = implementation
 * failure per the moonlit-leaping-summit plan. Exits non-zero
 * to block CI / a careless push.
 *
 * Usage:
 *   npx tsx scripts/check-handoff-dry-run.ts <project_id> [--verbose]
 *
 * Default project_id: Arvada Vineyard (2eac7eb8-…).
 *
 * Exit codes:
 *   0 — perfect_rate ≥ 0.90
 *   1 — perfect_rate <  0.90 (implementation needs more work)
 *   2 — script setup error
 */
/* eslint-disable no-console */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import {
  composeFieldValuesForBrixies,
  type ManifestEntry,
} from '../src/lib/cowork/coworkToBrixies.js'

// Inline .env.local loader (project doesn't have dotenv installed).
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

interface SectionVerdict {
  slug:               string
  section_intent_id:  string
  template_key:       string
  template_in_manifest: boolean
  bind_quality:       'perfect' | 'partial' | 'unbindable'
  gap_kinds:          string[]
  gap_summary:        string
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const verbose = args.includes('--verbose')
  const projectId = args.find(a => !a.startsWith('--')) ?? '2eac7eb8-269d-4584-84a4-3dc9fdd6fcde'

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    console.error('Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env')
    process.exit(2)
  }
  const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  const [projRes, manifestRes] = await Promise.all([
    sb.from('strategy_web_projects')
      .select('id, name, roadmap_state')
      .eq('id', projectId)
      .maybeSingle(),
    sb.schema('strategy').from('cowork_templates')
      .select('version, manifest')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (projRes.error || !projRes.data) {
    console.error(`project ${projectId} not found: ${projRes.error?.message}`)
    process.exit(2)
  }
  if (manifestRes.error || !manifestRes.data) {
    console.error(`canonical templates manifest missing: ${manifestRes.error?.message}`)
    process.exit(2)
  }

  const project = projRes.data as { id: string; name: string; roadmap_state: Record<string, unknown> }
  const manifestRow = manifestRes.data as { version: string; manifest: { page_section_templates: Record<string, ManifestEntry> } }
  const templates = manifestRow.manifest?.page_section_templates ?? {}

  const drafts = (project.roadmap_state?.page_drafts ?? {}) as Record<string, { sections?: Array<Record<string, unknown>> }>
  const slugs = Object.keys(drafts).sort()

  if (slugs.length === 0) {
    console.error(`project ${project.name} has no page_drafts in roadmap_state — run cowork pipeline first`)
    process.exit(2)
  }

  console.log(`\nCowork→Pages handoff dry-run`)
  console.log(`  project          ${project.name} (${project.id})`)
  console.log(`  manifest version ${manifestRow.version}`)
  console.log(`  slugs in drafts  ${slugs.length}`)
  console.log()

  const verdicts: SectionVerdict[] = []
  const gapsByKind: Record<string, number> = {}
  const partialByTemplate: Record<string, number> = {}
  const unbindableByTemplate: Record<string, number> = {}

  for (const slug of slugs) {
    const sections = Array.isArray(drafts[slug]?.sections) ? drafts[slug]!.sections as Array<Record<string, any>> : []
    for (let i = 0; i < sections.length; i++) {
      const s = sections[i]
      const intentId = (s.section_intent_id as string | undefined) ?? `s${i + 1}`
      const templateKey = (s.template_key as string | undefined) ?? ''

      if (!templateKey) {
        verdicts.push({
          slug, section_intent_id: intentId, template_key: '<missing>',
          template_in_manifest: false,
          bind_quality: 'unbindable',
          gap_kinds: ['no_template_key'],
          gap_summary: 'section emitted with no template_key',
        })
        unbindableByTemplate['<missing>'] = (unbindableByTemplate['<missing>'] ?? 0) + 1
        continue
      }

      const entry = templates[templateKey]
      if (!entry) {
        verdicts.push({
          slug, section_intent_id: intentId, template_key: templateKey,
          template_in_manifest: false,
          bind_quality: 'unbindable',
          gap_kinds: ['template_not_in_manifest'],
          gap_summary: `template_key '${templateKey}' not in canonical manifest`,
        })
        unbindableByTemplate[templateKey] = (unbindableByTemplate[templateKey] ?? 0) + 1
        continue
      }

      const slotValues = (s.slot_values ?? {}) as Record<string, unknown>
      const bind = composeFieldValuesForBrixies(slotValues, entry)

      verdicts.push({
        slug, section_intent_id: intentId, template_key: templateKey,
        template_in_manifest: true,
        bind_quality: bind.bind_quality,
        gap_kinds: bind.gaps.map(g => g.kind),
        gap_summary: bind.gaps.map(g => g.detail).join(' • '),
      })

      if (bind.bind_quality === 'partial') {
        partialByTemplate[templateKey] = (partialByTemplate[templateKey] ?? 0) + 1
        for (const g of bind.gaps) {
          gapsByKind[g.kind] = (gapsByKind[g.kind] ?? 0) + 1
        }
      }
    }
  }

  const total      = verdicts.length
  const perfect    = verdicts.filter(v => v.bind_quality === 'perfect').length
  const partial    = verdicts.filter(v => v.bind_quality === 'partial').length
  const unbindable = verdicts.filter(v => v.bind_quality === 'unbindable').length
  const perfect_rate = total > 0 ? perfect / total : 0

  // Per-slug roll-up
  console.log(`Per-slug:`)
  for (const slug of slugs) {
    const slugVerdicts = verdicts.filter(v => v.slug === slug)
    const p = slugVerdicts.filter(v => v.bind_quality === 'perfect').length
    const pa = slugVerdicts.filter(v => v.bind_quality === 'partial').length
    const u = slugVerdicts.filter(v => v.bind_quality === 'unbindable').length
    const t = slugVerdicts.length
    const bar = t > 0 ? '█'.repeat(p) + '▒'.repeat(pa) + '░'.repeat(u) : ''
    console.log(`  ${slug.padEnd(20)} ${String(p).padStart(2)}/${String(t).padStart(2)} perfect  ${pa} partial  ${u} unbindable  ${bar}`)
  }

  console.log()
  console.log(`Gap kinds:`)
  if (Object.keys(gapsByKind).length === 0) {
    console.log(`  (none)`)
  } else {
    for (const [kind, n] of Object.entries(gapsByKind).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(3)}  ${kind}`)
    }
  }

  if (Object.keys(unbindableByTemplate).length > 0) {
    console.log()
    console.log(`Unbindable (template missing / no template_key):`)
    for (const [k, n] of Object.entries(unbindableByTemplate)) {
      console.log(`  ${String(n).padStart(3)}  ${k}`)
    }
  }

  if (Object.keys(partialByTemplate).length > 0) {
    console.log()
    console.log(`Partial by template_key:`)
    for (const [k, n] of Object.entries(partialByTemplate).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(3)}  ${k}`)
    }
  }

  if (verbose) {
    console.log()
    console.log(`Per-section verdicts (verbose):`)
    for (const v of verdicts) {
      const mark = v.bind_quality === 'perfect' ? '✓' : v.bind_quality === 'partial' ? '~' : '✗'
      console.log(`  ${mark} ${v.slug}/${v.section_intent_id}  [${v.template_key}]  ${v.bind_quality}`)
      if (v.gap_summary) console.log(`      ${v.gap_summary}`)
    }
  }

  console.log()
  console.log(`Result:`)
  console.log(`  total       ${total}`)
  console.log(`  perfect     ${perfect}`)
  console.log(`  partial     ${partial}`)
  console.log(`  unbindable  ${unbindable}`)
  console.log(`  perfect_rate ${(perfect_rate * 100).toFixed(1)}%`)

  if (perfect_rate >= 0.9) {
    console.log(`\n✓ PASS — perfect_rate ${(perfect_rate * 100).toFixed(1)}% ≥ 90% target`)
    process.exit(0)
  } else {
    console.log(`\n✗ FAIL — perfect_rate ${(perfect_rate * 100).toFixed(1)}% < 90% target`)
    console.log(`  Implementation needs more work. Inspect gap_kinds + partial_by_template above.`)
    process.exit(1)
  }
}

main().catch(err => {
  console.error('dry-run crashed:', err)
  process.exit(2)
})
