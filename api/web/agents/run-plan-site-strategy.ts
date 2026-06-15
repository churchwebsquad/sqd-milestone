/**
 * Vercel Serverless Function — /api/web/agents/run-plan-site-strategy
 *
 * Cowork worker endpoint: plan the site_strategy block (sitemap +
 * nav + persona_journeys).
 *
 *   POST { project_id, force?: boolean }
 *
 * Reads stage_1 + ministry_model and emits the sitemap. Drives plan-
 * cross-page-allocation's per-page routing.
 *
 * Same hazard class as synthesize-strategy: site_strategy is a
 * shared key everything downstream reads. A silent regenerate against
 * a mid-flight account would re-shuffle the sitemap + persona
 * journeys + nav, drifting every per-page artifact built against it.
 * Same staleness guard: refuse if site_strategy newer than
 * ministry_model, force=true to bypass.
 *
 * Iteration 1 scope: guard + input assembly + gateway + direct write.
 * Iteration 2 adds validator + importer dispatch + repair loop.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'

import { callGateway, type ToolSchema } from '../../srp/_lib/aiGateway.js'
import { resolveCoworkSkill } from './_lib/resolveCoworkSkill.js'
import { setRoadmapStateAtomic } from './_lib/roadmapStateMerge.js'
import { guardOrRefuse } from './_lib/stalenessGuard.js'
import { BUNDLE_VERSION } from '../../../src/types/coworkBundle.js'
import { renderStrategicGoalsForStep, getApprovedNavChangeLevel } from '../../../src/lib/cowork/strategicGoalsContext.js'
import type { StrategicGoalsSnapshot } from '../../../src/lib/cowork/strategicGoals.js'

export const maxDuration = 300

const TOOL_NAME = 'emit_site_strategy'
const TOOL_DESCRIPTION =
  'Emit the CoworkSiteStrategy — pages[] (slug + name + purpose + audience + funnel + ' +
  'covers_cells + nav_order + nav_strategy + has_children), nav (primary/footer/cta_only), ' +
  'nav_change_level (full_rewrite/partial/tweaks/preserve/null from current_navigation_satisfaction), ' +
  'persona_journeys[] (one per stage_1 persona), pages_considered_dropped[], and a report block.'

const TOOL_SCHEMA: ToolSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['pages', 'nav', 'nav_change_level', 'persona_journeys', 'pages_considered_dropped', 'report'],
  properties: {
    nav_change_level: {
      type: ['string', 'null'],
      enum: ['full_rewrite', 'partial', 'tweaks', 'preserve', null],
      description:
        'How much to change the crawled nav. MUST match the derived value from current_navigation_satisfaction when the strategist has approved that field (≤6 → full_rewrite; 7-8 → partial; 9 → tweaks; 10 → preserve). null when nav satisfaction is unknown or not approved.',
    },
    pages: {
      type: 'array',
      minItems: 4,
      maxItems: 25,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['slug', 'name', 'purpose', 'primary_audience', 'primary_funnel',
                   'covers_cells', 'nav_order', 'nav_strategy', 'has_children'],
        properties: {
          slug:             { type: 'string', minLength: 1, maxLength: 60 },
          name:             { type: 'string', minLength: 1, maxLength: 60 },
          purpose:          { type: 'string', minLength: 10, maxLength: 200 },
          primary_audience: { type: 'string', minLength: 1, maxLength: 60 },
          primary_funnel:   { type: 'string', enum: ['discover', 'consider', 'visit', 'belong', 'commit'] },
          covers_cells:     {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['audience', 'category', 'funnel'],
              properties: {
                audience: { type: 'string' },
                category: { type: 'string' },
                funnel:   { type: 'string', enum: ['discover', 'consider', 'visit', 'belong', 'commit'] },
              },
            },
          },
          nav_order:    { type: ['integer', 'null'], minimum: 0 },
          nav_strategy: { type: 'string', enum: ['primary', 'secondary', 'footer', 'contextual_only'] },
          has_children: { type: 'boolean' },
        },
      },
    },
    nav: {
      type: 'object',
      additionalProperties: false,
      required: ['primary', 'footer', 'cta_only'],
      properties: {
        primary: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['slug'],
            properties: {
              slug:     { type: 'string', minLength: 1 },
              children: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        footer:   { type: 'array', items: { type: 'string' } },
        cta_only: { type: 'array', items: { type: 'string' } },
      },
    },
    persona_journeys: {
      type: 'array',
      minItems: 3,
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['persona', 'entry_points', 'journey', 'drop_off_risk'],
        properties: {
          persona:      { type: 'string', minLength: 1 },
          entry_points: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 },
          journey:      { type: 'array', items: { type: 'string' }, minItems: 2 },
          drop_off_risk: {
            type: 'object',
            additionalProperties: false,
            required: ['at_slug', 'reason', 'mitigation'],
            properties: {
              at_slug:    { type: 'string' },
              reason:     { type: 'string', maxLength: 200 },
              mitigation: { type: 'string', maxLength: 200 },
            },
          },
        },
      },
    },
    pages_considered_dropped: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['slug', 'reason'],
        properties: {
          slug:   { type: 'string' },
          reason: { type: 'string', maxLength: 240 },
        },
      },
    },
    report: {
      type: 'object',
      additionalProperties: true,
      required: ['page_count', 'nav_primary_count'],
      properties: {
        page_count:              { type: 'integer', minimum: 0 },
        nav_primary_count:       { type: 'integer', minimum: 0 },
        pages_carried_forward:   { type: 'array', items: { type: 'string' } },
        coverage_gaps_addressed: { type: 'array', items: { type: 'string' } },
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
  const force     = req.body?.force === true
  if (!projectId) return res.status(400).json({ error: 'project_id required' })

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  // Staleness guard — upstream is ministry_model (director's resume rule).
  let staleness: Awaited<ReturnType<typeof guardOrRefuse>>
  try {
    staleness = await guardOrRefuse(sb, {
      project_id:   projectId,
      output_key:   'roadmap_state.site_strategy',
      output_spec:  { kind: 'roadmap_state_meta', key: 'site_strategy' },
      upstream:     [{ kind: 'roadmap_state_meta', key: 'ministry_model' }],
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

  let resolved: Awaited<ReturnType<typeof resolveCoworkSkill>>
  try {
    resolved = await resolveCoworkSkill(sb, 'plan-site-strategy', projectId)
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'prompt resolve failed' })
  }

  const userMessage = buildUserMessage(inputs)
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
    return mapGatewayError(res, e)
  }

  const now = new Date().toISOString()
  const siteStrategyWithMeta = {
    ...(gatewayResult.args as Record<string, unknown>),
    _meta: {
      bundle_version: BUNDLE_VERSION,
      skill_name:     'plan-site-strategy',
      skill_version:  resolved.skillVersion,
      generated_at:   now,
      model:          gatewayResult.model,
      prompt_hash:    resolved.promptHash,
      usage: {
        input_tokens:  gatewayResult.usage.inputTokens,
        output_tokens: gatewayResult.usage.outputTokens,
      },
      personas_in_stage1: Array.isArray((inputs.stage1 as any)?.personas) ? (inputs.stage1 as any).personas.length : 0,
      validator_iteration: 1,
    },
  }

  try {
    await setRoadmapStateAtomic(sb, projectId, ['site_strategy'], siteStrategyWithMeta)
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'roadmap_state write failed' })
  }

  return res.status(200).json({
    ok:             true,
    project_id:     projectId,
    site_strategy:  siteStrategyWithMeta,
    skill_meta:     (siteStrategyWithMeta as any)._meta,
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
  stage1:         Record<string, unknown> | null
  ministryModel:  Record<string, unknown> | null
  acfPlan:        Record<string, unknown> | null
  stage2:         Record<string, unknown> | null  // legacy sitemap, for carry-forward signals
  strategicGoals: StrategicGoalsSnapshot | null
}

async function assembleEndpointInputs(
  sb:        any,
  projectId: string,
): Promise<AssembledInputs> {
  const { data, error } = await sb
    .from('strategy_web_projects')
    .select('roadmap_state')
    .eq('id', projectId)
    .maybeSingle()
  if (error) throw new Error(`project load failed: ${error.message}`)
  const roadmap = (data?.roadmap_state ?? {}) as Record<string, any>
  return {
    stage1:         roadmap.stage_1         ?? null,
    ministryModel:  roadmap.ministry_model  ?? null,
    acfPlan:        roadmap.acf_plan        ?? null,
    stage2:         roadmap.stage_2         ?? null,
    strategicGoals: (roadmap.strategic_goals as StrategicGoalsSnapshot | undefined) ?? null,
  }
}

function buildUserMessage(inputs: AssembledInputs): string {
  const navLevel = getApprovedNavChangeLevel(inputs.strategicGoals)
  const goalsBlock = renderStrategicGoalsForStep(inputs.strategicGoals, 'plan-site-strategy')
  return [
    `Plan the site strategy per the SKILL above.`,
    ``,
    goalsBlock ? goalsBlock : '_No approved strategic goals snapshot — proceed using stage_1 + ministry_model only._',
    ``,
    `## stage_1 (synthesize-strategy output — personas, voice, ethos, x_factor)`,
    '```json',
    JSON.stringify(inputs.stage1, null, 2),
    '```',
    ``,
    `## ministry_model (classify-ministry output — drives template choices)`,
    '```json',
    JSON.stringify(inputs.ministryModel, null, 2),
    '```',
    ``,
    `## acf_plan (organize-acf output — drives covers_cells routing)`,
    inputs.acfPlan
      ? '```json\n' + JSON.stringify(inputs.acfPlan, null, 2) + '\n```'
      : '_acf_plan not yet generated — covers_cells will be sketched but may need refinement after organize-acf runs._',
    ``,
    `## Legacy stage_2 (for carry-forward signals — pages_to_carry_forward inferred from this)`,
    inputs.stage2
      ? '```json\n' + JSON.stringify(inputs.stage2, null, 2) + '\n```'
      : '_No legacy stage_2 — new build, no carry-forward._',
    ``,
    `Now call \`${TOOL_NAME}\` with the site strategy.`,
    `Persona_journeys count MUST match stage_1.personas.length (one journey per persona).`,
    `Every persona_journeys[].persona name MUST appear in stage_1.personas[].name.`,
    `Every nav.primary[].slug + persona_journeys[].entry_points/journey slug MUST appear in pages[].slug.`,
    navLevel
      ? `nav_change_level MUST equal "${navLevel}" — derived from the approved current_navigation_satisfaction in Strategic Goals above. ` +
        `${navLevel === 'preserve' ? 'You MUST preserve the crawled nav verbatim. Do NOT change order or labels. ' : ''}` +
        `${navLevel === 'tweaks' ? 'You may only adjust 1-2 labels — keep all crawled slugs + ordering otherwise. ' : ''}` +
        `${navLevel === 'partial' ? 'Keep the crawled spine; you may regroup + relabel where strategy demands it. ' : ''}` +
        `${navLevel === 'full_rewrite' ? 'Plan a fresh nav. Do NOT echo the crawled menu. ' : ''}`
      : `nav_change_level: emit null. The strategist has not yet approved a current_navigation_satisfaction score.`,
  ].join('\n')
}
