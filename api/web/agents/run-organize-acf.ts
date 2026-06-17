/**
 * Vercel Serverless Function — /api/web/agents/run-organize-acf
 *
 * Cowork worker endpoint: organize all pillars + facts into the
 * Audience × Category × Funnel matrix.
 *
 *   POST { project_id, force?: boolean }
 *
 * Reads stage_1 + ministry_model + the full pillar/fact inventory and
 * emits acf_plan — every atom + fact routed to (audience, category,
 * funnel) cells with rationale. plan-site-strategy + plan-cross-page-
 * allocation read this matrix to know what content density exists per
 * cell (drives page consolidation decisions).
 *
 * Staleness guard: refuse if acf_plan newer than stage_1.
 *
 * Iteration 1 scope: guard + input assembly + gateway + direct write.
 * Iteration 2 adds validator + importer dispatch + repair loop. The
 * critical validator check (every input atom_id appears in exactly
 * one atom_routes[].atom_id) is iteration 2.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'

import { callGateway, type ToolSchema } from '../../srp/_lib/aiGateway.js'
import { resolveCoworkSkill } from './_lib/resolveCoworkSkill.js'
import { setRoadmapStateAtomic } from './_lib/roadmapStateMerge.js'
import { guardOrRefuse } from './_lib/stalenessGuard.js'
import { BUNDLE_VERSION } from '../../../src/types/coworkBundle.js'

export const maxDuration = 300

const TOOL_NAME = 'emit_acf_plan'
const TOOL_DESCRIPTION =
  'Emit the CoworkAcfPlan — atom_routes[] (every pillar routed to a primary_cell + optional ' +
  'secondary_cells), fact_routes[] (every fact routed similarly), cell_density[] (aggregated counts ' +
  'per cell with page_candidate boolean), coverage_gaps[] (cells where ministry_model implies the ' +
  'church needs coverage but inventory is empty).'

const CONTENT_CATEGORIES = [
  'identity', 'belief', 'gathering', 'formation', 'kids_family', 'students',
  'care', 'serve_in', 'serve_out', 'give', 'staff_org', 'practical',
] as const

const FUNNEL_STAGES = ['discover', 'consider', 'visit', 'belong', 'commit'] as const

function buildToolSchema(atomIds: string[], factIds: string[], audiences: string[]): ToolSchema {
  const atomIdSchema:  Record<string, unknown> = atomIds.length  > 0 ? { type: 'string', enum: atomIds }  : { type: 'string' }
  const factIdSchema:  Record<string, unknown> = factIds.length  > 0 ? { type: 'string', enum: factIds }  : { type: 'string' }
  const audienceSchema = audiences.length > 0 ? { type: 'string' as const, enum: audiences } : { type: 'string' as const }
  const cellSchema = {
    type: 'object' as const,
    additionalProperties: false,
    required: ['audience', 'category', 'funnel'],
    properties: {
      audience: audienceSchema,
      category: { type: 'string' as const, enum: [...CONTENT_CATEGORIES] },
      funnel:   { type: 'string' as const, enum: [...FUNNEL_STAGES] },
    },
  }
  return {
    type: 'object',
    additionalProperties: false,
    required: ['atom_routes', 'fact_routes', 'cell_density', 'coverage_gaps', 'handoff_note'],
    properties: {
      atom_routes: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['atom_id', 'primary_cell', 'rationale'],
          properties: {
            atom_id:         atomIdSchema,
            primary_cell:    cellSchema,
            secondary_cells: { type: 'array', items: cellSchema, maxItems: 2 },
            rationale:       { type: 'string', minLength: 1, maxLength: 120 },
          },
        },
      },
      fact_routes: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['fact_id', 'primary_cell', 'rationale'],
          properties: {
            fact_id:         factIdSchema,
            primary_cell:    cellSchema,
            secondary_cells: { type: 'array', items: cellSchema, maxItems: 2 },
            rationale:       { type: 'string', minLength: 1, maxLength: 120 },
          },
        },
      },
      cell_density: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['audience', 'category', 'funnel', 'atom_count', 'fact_count', 'page_candidate'],
          properties: {
            audience:       audienceSchema,
            category:       { type: 'string', enum: [...CONTENT_CATEGORIES] },
            funnel:         { type: 'string', enum: [...FUNNEL_STAGES] },
            atom_count:     { type: 'integer', minimum: 0 },
            fact_count:     { type: 'integer', minimum: 0 },
            page_candidate: { type: 'boolean' },
            notes:          { type: 'string', maxLength: 200 },
          },
        },
      },
      coverage_gaps: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['audience', 'category', 'funnel', 'gap_note'],
          properties: {
            audience: audienceSchema,
            category: { type: 'string', enum: [...CONTENT_CATEGORIES] },
            funnel:   { type: 'string', enum: [...FUNNEL_STAGES] },
            gap_note: { type: 'string', minLength: 1, maxLength: 240 },
          },
        },
      },
      handoff_note: {
        type: 'string',
        minLength: 100,
        maxLength: 4000,
        description: '≤1-screen markdown handoff note covering (a) what was written + where, (b) open/deferred issues, (c) cross-step gotchas the next session needs, (d) what the next step should read + decisions already made. Aim for 250-400 words.',
      },
    },
  }
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return res.status(500).json({ error: 'Missing Supabase env vars' })

  const projectId = typeof req.body?.project_id === 'string' ? req.body.project_id : null
  const force     = req.body?.force === true
  if (!projectId) return res.status(400).json({ error: 'project_id required' })

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  let staleness: Awaited<ReturnType<typeof guardOrRefuse>>
  try {
    staleness = await guardOrRefuse(sb, {
      project_id:   projectId,
      output_key:   'roadmap_state.acf_plan',
      output_spec:  { kind: 'roadmap_state_meta', key: 'acf_plan' },
      upstream:     [{ kind: 'roadmap_state_meta', key: 'stage_1' }],
    }, { force })
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'staleness probe failed' })
  }
  if (staleness.refuse) {
    return res.status(409).json({
      error:                 'fresh_output_exists',
      detail:                staleness.detail,
      output_key:            staleness.output_key,
      output_generated_at:   staleness.output_generated_at,
      latest_upstream_at:    staleness.latest_upstream_at,
      latest_upstream_label: staleness.latest_upstream_label,
      freshness_snapshot:    staleness.freshness_snapshot,
      hint:                  'Pass force=true on the request body to regenerate intentionally.',
    })
  }

  let inputs: AssembledInputs
  try {
    inputs = await assembleEndpointInputs(sb, projectId)
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'input assembly failed' })
  }
  if (!inputs.stage1)        return res.status(400).json({ error: 'stage_1_missing',        detail: 'Run synthesize-strategy first.' })
  if (!inputs.ministryModel) return res.status(400).json({ error: 'ministry_model_missing', detail: 'Run classify-ministry first.' })
  if (inputs.atoms.length === 0) return res.status(400).json({ error: 'no_atoms', detail: 'No atoms to route.' })

  let resolved: Awaited<ReturnType<typeof resolveCoworkSkill>>
  try {
    resolved = await resolveCoworkSkill(sb, 'organize-acf', projectId)
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'prompt resolve failed' })
  }

  const personaNames: string[] = Array.isArray((inputs.stage1 as any)?.personas)
    ? ((inputs.stage1 as any).personas as Array<{ name?: string }>).map(p => String(p.name ?? '')).filter(Boolean)
    : []
  const audiences = [...personaNames, 'general']

  const toolSchema = buildToolSchema(
    inputs.atoms.map(a => a.id),
    inputs.facts.map(f => f.id),
    audiences,
  )

  const userMessage = buildUserMessage(inputs, audiences)
  let gatewayResult: Awaited<ReturnType<typeof callGateway>>
  try {
    gatewayResult = await callGateway({
      model:           resolved.model,
      system:          resolved.systemPrompt,
      user:            userMessage,
      toolName:        TOOL_NAME,
      toolDescription: TOOL_DESCRIPTION,
      toolSchema,
      // ACF plan is structurally dense — every atom + every fact gets
      // a route. Budget linearly: ~120 chars rationale × ~150 sources
      // = ~20k chars output ≈ ~5-7k tokens. 12k cap leaves headroom
      // for adaptive thinking without exhausting Vercel's 300s
      // function window — large projects (e.g. 3249 = 83 atoms +
      // 135 facts = 218 routes) were hitting FUNCTION_INVOCATION_TIMEOUT
      // on the 16k cap because thinking + generation together stretched
      // past 5 minutes. Combined with the model switch to sonnet-4-6
      // (organize-acf SKILL v1.1.0), this keeps even the largest
      // inventories comfortably inside the function window.
      maxTokens:       12000,
    })
  } catch (e) {
    return mapGatewayError(res, e)
  }

  const now = new Date().toISOString()
  const { handoff_note, ...artifactBody } = gatewayResult.args as Record<string, unknown>
  const acfPlanWithMeta = {
    ...artifactBody,
    _meta: {
      bundle_version: BUNDLE_VERSION,
      skill_name:     'organize-acf',
      skill_version:  resolved.skillVersion,
      generated_at:   now,
      model:          gatewayResult.model,
      prompt_hash:    resolved.promptHash,
      usage: {
        input_tokens:  gatewayResult.usage.inputTokens,
        output_tokens: gatewayResult.usage.outputTokens,
      },
      atom_count: inputs.atoms.length,
      fact_count: inputs.facts.length,
      audiences,
      validator_iteration: 1,
      handoff_note: typeof handoff_note === 'string' ? handoff_note : undefined,
    },
  }

  try {
    await setRoadmapStateAtomic(sb, projectId, ['acf_plan'], acfPlanWithMeta)
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'roadmap_state write failed' })
  }

  return res.status(200).json({
    ok:         true,
    project_id: projectId,
    acf_plan:   acfPlanWithMeta,
    skill_meta: (acfPlanWithMeta as any)._meta,
    prompt_resolution: {
      global_source:        resolved.globalSource,
      has_project_addendum: resolved.hasProjectAddendum,
    },
  })
}

function mapGatewayError(res: any, e: unknown) {
  const name = (e as Error)?.name ?? 'Error'
  const message = e instanceof Error ? e.message : 'gateway call failed'
  if (name === 'GatewayRateLimitError') return res.status(429).json({ error: 'gateway_rate_limited', detail: message })
  if (name === 'GatewayTransientError') return res.status(502).json({ error: 'gateway_transient',     detail: message })
  return res.status(500).json({ error: 'gateway_failure', detail: message })
}

interface AssembledInputs {
  stage1:        Record<string, unknown> | null
  ministryModel: Record<string, unknown> | null
  atoms:         Array<{ id: string; topic: string; body: string }>
  facts:         Array<{ id: string; topic: string; data: Record<string, unknown> }>
}

async function assembleEndpointInputs(
  sb:        any,
  projectId: string,
): Promise<AssembledInputs> {
  const [projectRes, atomsRes, factsRes] = await Promise.all([
    sb.from('strategy_web_projects')
      .select('roadmap_state')
      .eq('id', projectId)
      .maybeSingle(),
    sb.from('content_atoms')
      .select('id, topic, body')
      .eq('web_project_id', projectId)
      .in('status', ['approved', 'draft']),
    sb.from('church_facts')
      .select('id, topic, data')
      .eq('web_project_id', projectId)
      .in('status', ['approved', 'draft']),
  ])
  if (projectRes.error) throw new Error(`project load failed: ${projectRes.error.message}`)
  if (atomsRes.error)   throw new Error(`content_atoms load failed: ${atomsRes.error.message}`)
  if (factsRes.error)   throw new Error(`church_facts load failed: ${factsRes.error.message}`)
  const roadmap = (projectRes.data?.roadmap_state ?? {}) as Record<string, any>
  return {
    stage1:        roadmap.stage_1        ?? null,
    ministryModel: roadmap.ministry_model ?? null,
    atoms:         (atomsRes.data ?? []) as AssembledInputs['atoms'],
    facts:         (factsRes.data ?? []) as AssembledInputs['facts'],
  }
}

function buildUserMessage(inputs: AssembledInputs, audiences: string[]): string {
  const compactAtoms = inputs.atoms.map(a => ({
    id: a.id, topic: a.topic, body: a.body.slice(0, 240),
  }))
  const compactFacts = inputs.facts.map(f => ({
    id: f.id, topic: f.topic,
    preview: typeof f.data === 'object' && f.data ? JSON.stringify(f.data).slice(0, 200) : String(f.data ?? '').slice(0, 200),
  }))
  return [
    `Organize this project's content into the Audience × Category × Funnel matrix per the SKILL above.`,
    ``,
    `## stage_1`,
    '```json',
    JSON.stringify(inputs.stage1, null, 2),
    '```',
    ``,
    `## ministry_model`,
    '```json',
    JSON.stringify(inputs.ministryModel, null, 2),
    '```',
    ``,
    `## Valid audience values (closed: stage_1.personas[*].name + 'general')`,
    '```json',
    JSON.stringify(audiences, null, 2),
    '```',
    ``,
    `## Pillars (${compactAtoms.length} — EVERY id MUST appear EXACTLY ONCE in atom_routes[].atom_id)`,
    '```json',
    JSON.stringify(compactAtoms, null, 2),
    '```',
    ``,
    `## Facts (${compactFacts.length} — EVERY id MUST appear EXACTLY ONCE in fact_routes[].fact_id)`,
    '```json',
    JSON.stringify(compactFacts, null, 2),
    '```',
    ``,
    `Call \`${TOOL_NAME}\`. atom_routes / fact_routes must cover every input exactly once.`,
    `cell_density must include only cells that have ≥1 atom or fact.`,
    `coverage_gaps surface cells where ministry_model implies the church needs coverage but inventory is empty.`,
  ].join('\n')
}
