/**
 * Vercel Serverless Function — /api/web/agents/import-cowork-bundle
 *
 * Single import endpoint for every cowork artifact. Validates each
 * artifact against a deterministic ruleset BEFORE writing to
 * roadmap_state, so a bad model output can't poison downstream stages.
 *
 *   POST { project_id, bundle_kind, bundle, manifest? }
 *
 * v1 supports bundle_kind = 'page_allocation_plan'. Future bundle
 * kinds (page_outline, page_draft, page_critique, …) plug in here
 * via the dispatch table without changing the wire shape.
 *
 * Validation flow for 'page_allocation_plan':
 *   1. If manifest not provided, build it from the project's live
 *      Supabase inventory (content_atoms + church_facts +
 *      web_project_topics + content_collection + roadmap_state).
 *      Cowork-director can pre-build + send to lock the validation
 *      surface; UI paste mode lets the server compute.
 *   2. Run validateAllocationPlan() from src/lib/cowork. Strict —
 *      ANY failure returns 422 with the machine-readable failure
 *      list so the model can run a one-shot repair pass.
 *   3. On pass, split out build_directives (these are dev-handoff
 *      items, not page copy) and write each to its own roadmap_state
 *      slot via the v68 atomic merge RPC.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createClient } from '@supabase/supabase-js'
import { setRoadmapStateAtomic } from './_lib/roadmapStateMerge.js'
import {
  validateAllocationPlan,
  type AllocationPlanManifest,
} from '../../../src/lib/cowork/validateAllocationPlan.js'
import {
  validatePageOutline,
  type PageOutlineValidationManifest,
  type CanonicalTemplateManifest,
} from '../../../src/lib/cowork/validatePageOutline.js'

export const maxDuration = 30

const META_COLUMNS_CONTENT_COLLECTION = new Set([
  'id', 'web_project_id', 'created_at', 'updated_at', 'submitted_at', 'member', 'status',
])

const DEFAULT_PRIMARY_PAGES = ['home', 'plan-a-visit', 'about', 'donate']

/**
 * Build the validation manifest from the project's live Supabase
 * inventory. Used when the caller (cowork-director) didn't pass
 * `manifest` explicitly. Keeps the validator's "manifest matches the
 * payload the model actually saw" guarantee — the importer's manifest
 * IS the payload, by construction.
 */
async function buildManifestFromProject(sb: any, projectId: string): Promise<AllocationPlanManifest> {
  const [pillarsRes, factsRes, topicsRes, ccRes, projectRes] = await Promise.all([
    sb.from('content_atoms')
      .select('id, topic, verbatim')
      .eq('web_project_id', projectId)
      .in('status', ['active', 'draft']),
    sb.from('church_facts')
      .select('id')
      .eq('web_project_id', projectId)
      .in('status', ['active', 'draft']),
    sb.from('web_project_topics')
      .select('topic_key, coverage_status')
      .eq('web_project_id', projectId),
    sb.from('strategy_content_collection_sessions')
      .select('*')
      .eq('web_project_id', projectId)
      .order('submitted_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    sb.from('strategy_web_projects')
      .select('roadmap_state')
      .eq('id', projectId)
      .maybeSingle(),
  ])

  if (pillarsRes.error) throw new Error(`content_atoms load failed: ${pillarsRes.error.message}`)
  if (factsRes.error)   throw new Error(`church_facts load failed: ${factsRes.error.message}`)
  if (topicsRes.error)  throw new Error(`web_project_topics load failed: ${topicsRes.error.message}`)
  if (ccRes.error)      throw new Error(`content_collection load failed: ${ccRes.error.message}`)
  if (projectRes.error) throw new Error(`project load failed: ${projectRes.error.message}`)

  const ccRow = ccRes.data as Record<string, unknown> | null
  const ccFields = ccRow
    ? Object.entries(ccRow)
        .filter(([k, v]) => !META_COLUMNS_CONTENT_COLLECTION.has(k) && v !== null && v !== undefined && v !== '')
        .map(([k]) => k)
    : []

  const roadmap = (projectRes.data?.roadmap_state ?? {}) as Record<string, any>
  const stage2  = roadmap.stage_2 ?? {}
  const siteStrategy = roadmap.site_strategy ?? {}

  const sitemapPages = Array.isArray(stage2.pages) ? stage2.pages : []
  const sitemap_slugs = sitemapPages
    .map((p: any) => typeof p?.slug === 'string' ? p.slug : null)
    .filter((s: string | null): s is string => !!s)

  // persona_entry_points pulled from site_strategy.persona_journeys[*].entry_points (if present)
  const persona_entry_points: Record<string, string[]> = {}
  const personaJourneys = siteStrategy?.persona_journeys ?? []
  if (Array.isArray(personaJourneys)) {
    for (const pj of personaJourneys) {
      if (typeof pj?.persona === 'string' && Array.isArray(pj?.entry_points)) {
        persona_entry_points[pj.persona] = pj.entry_points.filter((s: any) => typeof s === 'string')
      }
    }
  }

  return {
    pillars: (pillarsRes.data ?? []).map((p: any) => ({
      id:       String(p.id),
      topic:    p.topic,
      verbatim: !!p.verbatim,
    })),
    facts: (factsRes.data ?? []).map((f: any) => String(f.id)),
    crawl_topics: (topicsRes.data ?? []).map((t: any) => ({
      topic_key:       String(t.topic_key),
      coverage_status: t.coverage_status ?? 'sparse',
    })),
    content_collection_fields: ccFields,
    sitemap_slugs,
    primary_pages: DEFAULT_PRIMARY_PAGES,
    persona_entry_points,
  }
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return res.status(500).json({ error: 'Missing Supabase env vars' })

  const projectId  = typeof req.body?.project_id === 'string' ? req.body.project_id : null
  const bundleKind = typeof req.body?.bundle_kind === 'string' ? req.body.bundle_kind : null
  const bundle     = req.body?.bundle ?? null
  const manifestIn = req.body?.manifest ?? null

  if (!projectId)  return res.status(400).json({ error: 'project_id required' })
  if (!bundleKind) return res.status(400).json({ error: 'bundle_kind required' })
  if (!bundle)     return res.status(400).json({ error: 'bundle required' })

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  if (bundleKind === 'page_allocation_plan') {
      // Build or use provided manifest
    let manifest: AllocationPlanManifest
    try {
      manifest = manifestIn ?? (await buildManifestFromProject(sb, projectId))
    } catch (e) {
      return res.status(500).json({ error: e instanceof Error ? e.message : 'manifest build failed' })
    }

    // Validate
    const result = validateAllocationPlan(bundle, manifest)
    if (!result.ok) {
      return res.status(422).json({
        error:    'validation_failed',
        summary:  result.summary,
        byCheck:  result.byCheck,
        failures: result.failures,
      })
    }

    // Split build_directives out of the plan body — they live on their
    // own roadmap_state key so dev-handoff surfaces can read them
    // without traversing the full allocation plan.
    const planForRoadmap = { ...bundle }
    const buildDirectives = Array.isArray(bundle.build_directives) ? bundle.build_directives : []
    delete planForRoadmap.build_directives

    try {
      await setRoadmapStateAtomic(sb, projectId, ['page_allocation_plan'], planForRoadmap)
      if (buildDirectives.length > 0) {
        await setRoadmapStateAtomic(sb, projectId, ['build_directives'], buildDirectives)
      }
      await setRoadmapStateAtomic(sb, projectId, ['cowork_progress', 'plan_cross_page_allocation'], {
        status:       'completed',
        completed_at: new Date().toISOString(),
        pages:        Array.isArray(bundle.allocations) ? bundle.allocations.length : 0,
      })
    } catch (e) {
      return res.status(500).json({ error: e instanceof Error ? e.message : 'roadmap_state write failed' })
    }

    const allocations = Array.isArray(bundle.allocations) ? bundle.allocations : []
    return res.status(200).json({
      ok:          true,
      bundle_kind: 'page_allocation_plan',
      counts: {
        pages:               allocations.length,
        section_intents:     allocations.reduce((n: number, a: any) => n + (Array.isArray(a.section_intents) ? a.section_intents.length : 0), 0),
        source_traces:       Array.isArray(bundle.source_traces) ? bundle.source_traces.length : 0,
        unresolved_sources:  Array.isArray(bundle.unresolved_sources) ? bundle.unresolved_sources.length : 0,
        build_directives:    buildDirectives.length,
      },
    })
  }

  if (bundleKind === 'page_outline') {
    // The endpoint that calls this for page_outline MUST also supply
    // page_slug — outlines are slug-scoped, the importer needs to know
    // which key under roadmap_state.page_outlines to write to.
    const pageSlug = typeof req.body?.page_slug === 'string' ? req.body.page_slug : null
    if (!pageSlug) return res.status(400).json({ error: 'page_slug required for bundle_kind=page_outline' })

    // Build the outline-specific manifest from live inventory.
    let manifest: PageOutlineValidationManifest
    try {
      manifest = await buildPageOutlineManifestFromProject(sb, projectId, pageSlug)
    } catch (e) {
      return res.status(500).json({ error: e instanceof Error ? e.message : 'page-outline manifest build failed' })
    }

    const result = validatePageOutline(bundle, manifest)
    if (!result.ok) {
      return res.status(422).json({
        error:    'validation_failed',
        summary:  result.summary,
        byCheck:  result.byCheck,
        failures: result.failures,
      })
    }

    // Write the outline into roadmap_state.page_outlines[slug].
    try {
      await setRoadmapStateAtomic(sb, projectId, ['page_outlines', pageSlug], bundle)
      await setRoadmapStateAtomic(sb, projectId, ['cowork_progress', 'outline_page', pageSlug], {
        status:       'completed',
        completed_at: new Date().toISOString(),
        sections:     Array.isArray(bundle.sections) ? bundle.sections.length : 0,
        atom_count:   bundle?._meta?.atom_count_used ?? null,
        prompt_hash:  bundle?._meta?.prompt_hash ?? null,
      })
    } catch (e) {
      return res.status(500).json({ error: e instanceof Error ? e.message : 'roadmap_state write failed' })
    }

    return res.status(200).json({
      ok:          true,
      bundle_kind: 'page_outline',
      page_slug:   pageSlug,
      counts: {
        sections:           Array.isArray(bundle.sections) ? bundle.sections.length : 0,
        atom_assignments:   Array.isArray(bundle.sections)
          ? bundle.sections.reduce((n: number, s: any) => n + (Array.isArray(s.atom_assignments) ? s.atom_assignments.length : 0), 0)
          : 0,
        unresolved_inputs:  Array.isArray(bundle.unresolved_inputs) ? bundle.unresolved_inputs.length : 0,
      },
    })
  }

  return res.status(400).json({
    error: `Unknown bundle_kind: ${bundleKind}`,
    supported: ['page_allocation_plan', 'page_outline'],
  })
}

/**
 * Builds the per-page outline validation manifest from live Supabase
 * inventory + the checked-in canonical-templates.json. Inputs the
 * validator needs:
 *   - atom_ids: every active+draft content_atom for the project (the
 *     outline's atom_assignments MUST reference one of these — catches
 *     hallucinated UUIDs).
 *   - canonical_templates: archetype → cowork_writable_slots map;
 *     archetype/slot_hint checks resolve against this.
 *   - expected_page_slug: confirms the outline targets the right page.
 *
 * NOTE: church_facts are NOT loaded — the current CoworkPageOutline
 * shape only carries atom_assignments. When outline-page grows fact
 * bindings, add fact_ids to the manifest + validator together.
 */
async function buildPageOutlineManifestFromProject(
  sb:        any,
  projectId: string,
  pageSlug:  string,
): Promise<PageOutlineValidationManifest> {
  const atomsRes = await sb.from('content_atoms')
    .select('id')
    .eq('web_project_id', projectId)
    .in('status', ['active', 'draft'])
  if (atomsRes.error) throw new Error(`content_atoms load failed: ${atomsRes.error.message}`)

  const canonical_templates = loadCanonicalTemplates()

  return {
    atom_ids: (atomsRes.data ?? []).map((r: any) => String(r.id)),
    canonical_templates,
    expected_page_slug: pageSlug,
  }
}

let _canonicalTemplatesCache: CanonicalTemplateManifest | null = null
function loadCanonicalTemplates(): CanonicalTemplateManifest {
  if (_canonicalTemplatesCache) return _canonicalTemplatesCache
  const __dirname = dirname(fileURLToPath(import.meta.url))
  // api/web/agents/import-cowork-bundle.ts → repo root → cowork-skills/canonical-templates.json
  const path = resolve(__dirname, '..', '..', '..', 'cowork-skills', 'canonical-templates.json')
  const raw = readFileSync(path, 'utf8')
  _canonicalTemplatesCache = JSON.parse(raw) as CanonicalTemplateManifest
  return _canonicalTemplatesCache
}
