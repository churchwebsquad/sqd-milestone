/**
 * Vercel Serverless Function — /api/web/agents/run-outline-page
 *
 * Cowork worker endpoint: outline ONE page.
 *
 *   POST { project_id, page_slug }
 *
 * This is the canonical pattern the other 8 cowork worker endpoints
 * will copy. Three constraints baked in by design:
 *
 *   1. Resolves system prompt via the resolveCoworkSkill pipeline —
 *      generated default → DB global override → DB project addendum.
 *      NEVER imports COWORK_SKILL_BUNDLES directly, so any future
 *      strategist override at the DB tier wins on arrival.
 *
 *   2. Stamps prompt_hash + model + skill_version into the outline's
 *      _meta block, so artifacts trace to the exact prompt snapshot
 *      that produced them (and the gateway model that actually served
 *      the call, which can differ from what was requested if the
 *      gateway routes a fallback).
 *
 *   3. Calls the import-cowork-bundle endpoint inline with the real
 *      page_outline validator — atom-UUID existence vs. project
 *      inventory + archetype/slot checks vs. canonical-templates.
 *      A 422 from the importer means the outline is unfit; we surface
 *      it to the caller verbatim so the strategist UI can show the
 *      structured failure list.
 *
 * Flow:
 *   1. Load project state (allocation slice + stage_1 + ministry_model
 *      + per-page atom/fact projections) in parallel.
 *   2. Resolve the outline-page prompt via resolveCoworkSkill.
 *   3. Call AI Gateway with forced tool-call → outline JSON.
 *   4. Stamp _meta with prompt_hash + model + skill_version + usage.
 *   5. POST to /api/web/agents/import-cowork-bundle with
 *      bundle_kind='page_outline' which validates + lands.
 *   6. Return either the validated outline summary, or the validator's
 *      structured failure list on 422.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'

import { callGateway, type ToolSchema } from '../../srp/_lib/aiGateway.js'
import { resolveCoworkSkill } from './_lib/resolveCoworkSkill.js'
import { BUNDLE_VERSION } from '../../../src/types/coworkBundle.js'

// Cowork outline calls are model-driven on Opus 4.7 with sizable
// inputs (allocation slice + atoms + facts + stage_1). Opt into the
// Pro 300s ceiling so cold starts have room.
export const maxDuration = 300

const TOOL_NAME = 'emit_page_outline'
const TOOL_DESCRIPTION =
  'Emit the page outline conforming to the CoworkPageOutline contract — sections[] ' +
  'with archetype + section_job + flow_role + atom_assignments referencing real atom_ids ' +
  'from the project inventory.'

/** JSON Schema for the forced tool call. Strict — every load-bearing
 *  field is required + additionalProperties:false so the gateway
 *  refuses malformed outputs at the wire. */
const TOOL_SCHEMA: ToolSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['page_slug', 'ministry_model_alignment', 'sections', 'unresolved_inputs'],
  properties: {
    page_slug: { type: 'string' },
    ministry_model_alignment: {
      type: 'string',
      enum: ['attractional', 'discipleship', 'missional', 'mixed'],
    },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['section_ix', 'archetype', 'section_job', 'flow_role',
                   'voice_anchor', 'anti_pattern_to_avoid', 'atom_assignments'],
        properties: {
          section_ix:        { type: 'integer', minimum: 0 },
          archetype:         { type: 'string' },
          section_job:       { type: 'string' },
          flow_role:         { type: 'string', enum: ['hook', 'orient', 'commit', 'reassure', 'evidence', 'invite'] },
          voice_anchor:      { type: 'string' },
          anti_pattern_to_avoid: { type: 'string' },
          cms_managed:       { type: 'boolean' },
          atom_assignments:  {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['atom_id', 'treatment', 'slot_hint'],
              properties: {
                atom_id:    { type: 'string' },
                treatment:  { type: 'string', enum: ['use_as_is', 'lift_phrase', 'compress', 'expand', 'reorder', 'omit'] },
                slot_hint:  { type: 'string' },
              },
            },
          },
        },
      },
    },
    unresolved_inputs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['what', 'where'],
        properties: {
          what:  { type: 'string' },
          where: { type: 'string' },
        },
      },
    },
  },
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return res.status(500).json({ error: 'Missing Supabase env vars' })

  const projectId = typeof req.body?.project_id === 'string' ? req.body.project_id : null
  const pageSlug  = typeof req.body?.page_slug  === 'string' ? req.body.page_slug  : null
  if (!projectId) return res.status(400).json({ error: 'project_id required' })
  if (!pageSlug)  return res.status(400).json({ error: 'page_slug required' })

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  // 1. Load project state in parallel.
  let inputs: AssembledInputs
  try {
    inputs = await assembleEndpointInputs(sb, projectId, pageSlug)
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'input assembly failed' })
  }
  if (!inputs.allocation) {
    return res.status(404).json({
      error: 'allocation_not_found',
      detail: `roadmap_state.page_allocation_plan.allocations[] has no entry for slug='${pageSlug}'. Run plan-cross-page-allocation first.`,
    })
  }

  // 2. Resolve prompt (generated default + DB override + project addendum).
  let resolved: Awaited<ReturnType<typeof resolveCoworkSkill>>
  try {
    resolved = await resolveCoworkSkill(sb, 'outline-page', projectId)
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'prompt resolve failed' })
  }

  // 3. Call gateway with forced tool call.
  const userMessage = buildUserMessage(pageSlug, inputs)
  let gatewayResult: Awaited<ReturnType<typeof callGateway>>
  try {
    gatewayResult = await callGateway({
      model:           resolved.model,
      system:          resolved.systemPrompt,
      user:            userMessage,
      toolName:        TOOL_NAME,
      toolDescription: TOOL_DESCRIPTION,
      toolSchema:      TOOL_SCHEMA,
      maxTokens:       12000,
    })
  } catch (e) {
    const name = (e as Error)?.name ?? 'Error'
    const message = e instanceof Error ? e.message : 'gateway call failed'
    if (name === 'GatewayRateLimitError') return res.status(429).json({ error: 'gateway_rate_limited', detail: message })
    if (name === 'GatewayTransientError') return res.status(502).json({ error: 'gateway_transient',     detail: message })
    return res.status(500).json({ error: 'gateway_failure', detail: message })
  }

  // 4. Stamp _meta into the outline.
  const now = new Date().toISOString()
  const outlineWithMeta = {
    ...gatewayResult.args,
    _meta: {
      bundle_version: BUNDLE_VERSION,
      skill_name:     'outline-page',
      skill_version:  resolved.skillVersion,
      generated_at:   now,
      model:          gatewayResult.model,
      prompt_hash:    resolved.promptHash,
      usage: {
        input_tokens:  gatewayResult.usage.inputTokens,
        output_tokens: gatewayResult.usage.outputTokens,
      },
      atom_count_used: countUniqueAtomIds(gatewayResult.args),
      sections_count:  Array.isArray(gatewayResult.args.sections) ? gatewayResult.args.sections.length : 0,
    },
  }

  // 5. POST to import endpoint (validates + lands).
  const importerUrl = inferImporterUrl(req)
  const importerRes = await fetch(importerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project_id:  projectId,
      bundle_kind: 'page_outline',
      page_slug:   pageSlug,
      bundle:      outlineWithMeta,
    }),
  })
  const importerJson = await importerRes.json().catch(() => ({}))

  if (!importerRes.ok) {
    // Importer returns the structured failure list on 422; pass through.
    return res.status(importerRes.status).json({
      stage:        'import',
      error:        importerJson?.error ?? 'import_failed',
      summary:      importerJson?.summary,
      byCheck:      importerJson?.byCheck,
      failures:     importerJson?.failures,
      outline_for_inspection: outlineWithMeta,
    })
  }

  return res.status(200).json({
    ok:           true,
    page_slug:    pageSlug,
    skill_meta:   outlineWithMeta._meta,
    importer:     importerJson,
    prompt_resolution: {
      global_source:        resolved.globalSource,
      has_project_addendum: resolved.hasProjectAddendum,
    },
  })
}

// ──────────────────────────────────────────────────────────────────────────

interface AssembledInputs {
  allocation:     any           // the allocation slice for this page
  stage1Brief:    any           // ethos + personas + voice exemplars + anti-exemplars
  ministryModel:  any           // { dominant_model, secondary_blend }
  atomsForPage:   Array<{ id: string; topic: string; body: string; verbatim: boolean; content_quality?: string }>
  factsForPage:   Array<{ id: string; topic: string; data: Record<string, unknown> }>
}

async function assembleEndpointInputs(
  sb:        any,
  projectId: string,
  pageSlug:  string,
): Promise<AssembledInputs> {
  const { data: project, error } = await sb
    .from('strategy_web_projects')
    .select('roadmap_state')
    .eq('id', projectId)
    .maybeSingle()
  if (error) throw new Error(`project load failed: ${error.message}`)

  const roadmap = (project?.roadmap_state ?? {}) as Record<string, any>
  const allocations: any[] = roadmap?.page_allocation_plan?.allocations ?? []
  const allocation = allocations.find((a: any) => a?.page_slug === pageSlug) ?? null

  const stage_1        = roadmap?.stage_1        ?? null
  const ministry_model = roadmap?.ministry_model ?? null

  // Collect atom_ids + fact_ids referenced by this allocation's section_intents.
  const atomIds = new Set<string>()
  const factIds = new Set<string>()
  if (allocation && Array.isArray(allocation.section_intents)) {
    for (const s of allocation.section_intents) {
      for (const src of (s.sources ?? [])) {
        if (src?.kind === 'pillar' && src?.ref) atomIds.add(String(src.ref))
        if (src?.kind === 'fact'   && src?.ref) factIds.add(String(src.ref))
      }
    }
  }

  const [atomsRes, factsRes] = await Promise.all([
    atomIds.size > 0
      ? sb.from('content_atoms')
          .select('id, topic, body, verbatim, content_quality')
          .in('id', Array.from(atomIds))
      : Promise.resolve({ data: [] as any[], error: null }),
    factIds.size > 0
      ? sb.from('church_facts')
          .select('id, topic, data')
          .in('id', Array.from(factIds))
      : Promise.resolve({ data: [] as any[], error: null }),
  ])
  if (atomsRes.error) throw new Error(`content_atoms load failed: ${atomsRes.error.message}`)
  if (factsRes.error) throw new Error(`church_facts load failed: ${factsRes.error.message}`)

  // Compact stage_1 — only fields outline-page reads.
  const stage1Brief = stage_1 ? {
    ethos_summary:        stage_1.ethos_summary,
    personas:             stage_1.personas,
    voice_exemplars:      stage_1.voice_exemplars,
    voice_anti_exemplars: stage_1.voice_anti_exemplars,
    persuasive_posture_by_persona: stage_1.persuasive_posture_by_persona,
  } : null

  return {
    allocation,
    stage1Brief,
    ministryModel:  ministry_model,
    atomsForPage:   (atomsRes.data ?? []) as AssembledInputs['atomsForPage'],
    factsForPage:   (factsRes.data ?? []) as AssembledInputs['factsForPage'],
  }
}

function buildUserMessage(pageSlug: string, inputs: AssembledInputs): string {
  // The systemPrompt already contains the SKILL.md body + the canonical-
  // templates + page-outlines-by-ministry-model concatenated references.
  // The user message just supplies the per-call data.
  return [
    `Outline the page with slug \`${pageSlug}\` per the SKILL above.`,
    ``,
    `## Allocation slice (the section_intents YOU MUST cover)`,
    '```json',
    JSON.stringify(inputs.allocation, null, 2),
    '```',
    ``,
    `## Stage_1 brief (voice + personas + ethos)`,
    '```json',
    JSON.stringify(inputs.stage1Brief, null, 2),
    '```',
    ``,
    `## Ministry model`,
    '```json',
    JSON.stringify(inputs.ministryModel, null, 2),
    '```',
    ``,
    `## Atoms allocated to this page (full bodies — these are the ONLY atom_ids you may reference)`,
    '```json',
    JSON.stringify(inputs.atomsForPage, null, 2),
    '```',
    ``,
    `## Facts allocated to this page`,
    '```json',
    JSON.stringify(inputs.factsForPage, null, 2),
    '```',
    ``,
    `Emit the outline now via the \`${TOOL_NAME}\` tool call. Every`,
    `atom_assignments[].atom_id MUST appear in the atoms list above —`,
    `hallucinated UUIDs trip the importer's validator and reject the run.`,
  ].join('\n')
}

function countUniqueAtomIds(outline: any): number {
  const set = new Set<string>()
  for (const s of (outline?.sections ?? [])) {
    for (const a of (s?.atom_assignments ?? [])) {
      if (a?.atom_id) set.add(String(a.atom_id))
    }
  }
  return set.size
}

function inferImporterUrl(req: any): string {
  // On Vercel the host is reachable via the same origin; locally vercel dev
  // exposes the api/ tree on the same port.
  const proto = req.headers['x-forwarded-proto'] ?? 'https'
  const host  = req.headers['x-forwarded-host'] ?? req.headers.host
  return `${proto}://${host}/api/web/agents/import-cowork-bundle`
}
