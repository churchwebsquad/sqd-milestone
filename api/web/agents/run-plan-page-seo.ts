/**
 * Vercel Serverless Function — /api/web/agents/run-plan-page-seo
 *
 * Cowork worker endpoint: produce ONE per-page SEO plan for every
 * page in the sitemap BEFORE outline-page + draft-page run. Reads
 * site_strategy (page list), page_allocation_plan (what content
 * lands on each page), stage_1 (voice / personas), ministry_model,
 * strategic_goals (audience + local context), and church_facts
 * (address / neighborhoods). Emits an object keyed by slug and
 * persists to roadmap_state.page_seo_plans.
 *
 *   POST { project_id, force?: boolean }
 *
 * Same hazard class as plan-site-strategy: page_seo_plans is a
 * shared key that outline + draft ingest, and handoff-to-pages
 * copies each slug's entry into web_pages.seo. A silent regenerate
 * against a mid-flight account would rewrite the SEO plan every
 * downstream step is working against. Staleness guard blocks
 * regenerate unless force=true.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'

import { callGateway, type ToolSchema } from '../../srp/_lib/aiGateway.js'
import { resolveCoworkSkill } from './_lib/resolveCoworkSkill.js'
import { setRoadmapStateAtomic } from './_lib/roadmapStateMerge.js'
import { guardOrRefuse } from './_lib/stalenessGuard.js'
import { BUNDLE_VERSION } from '../../../src/types/coworkBundle.js'
import { renderStrategicGoalsForStep } from '../../../src/lib/cowork/strategicGoalsContext.js'
import type { StrategicGoalsSnapshot } from '../../../src/lib/cowork/strategicGoals.js'

export const maxDuration = 300

const TOOL_NAME = 'emit_page_seo_plans'
const TOOL_DESCRIPTION =
  'Emit per-page SEO plans keyed by slug. Each entry: primary_keyword, secondary_keywords, ' +
  'meta_title, meta_description, h1_directive, aeo_qa[], local_geo, search_intent, notes, ' +
  'rank_math_ready (always false — strategist flips it after loading RankMath). One entry per ' +
  'page in site_strategy.pages. Plus a handoff_note for outline + draft.'

const SEO_PLAN_ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'primary_keyword', 'secondary_keywords', 'meta_title', 'meta_description',
    'h1_directive', 'aeo_qa', 'local_geo', 'search_intent', 'rank_math_ready', 'notes',
  ],
  properties: {
    primary_keyword:    { type: 'string', minLength: 3, maxLength: 80 },
    secondary_keywords: {
      type: 'array', minItems: 2, maxItems: 6,
      items: { type: 'string', minLength: 2, maxLength: 80 },
    },
    meta_title:         { type: 'string', minLength: 20, maxLength: 70 },
    meta_description:   { type: 'string', minLength: 100, maxLength: 175 },
    h1_directive:       { type: 'string', minLength: 20, maxLength: 240 },
    aeo_qa: {
      type: 'array', minItems: 2, maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['question', 'short_answer'],
        properties: {
          question:     { type: 'string', minLength: 8,  maxLength: 160 },
          short_answer: { type: 'string', minLength: 30, maxLength: 480 },
        },
      },
    },
    local_geo: {
      type: 'object',
      additionalProperties: false,
      required: ['city', 'state', 'neighborhoods', 'service_areas'],
      properties: {
        city:          { type: ['string', 'null'] },
        state:         { type: ['string', 'null'] },
        neighborhoods: { type: 'array', items: { type: 'string' }, maxItems: 8 },
        service_areas: { type: 'array', items: { type: 'string' }, maxItems: 8 },
      },
    },
    search_intent:   { type: 'string', enum: ['informational', 'navigational', 'transactional', 'commercial'] },
    rank_math_ready: { type: 'boolean' },
    notes:           { type: 'string', minLength: 8, maxLength: 320 },
  },
} as const

const TOOL_SCHEMA: ToolSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['pages', 'handoff_note'],
  properties: {
    // JSON Schema on our gateway path can't express arbitrary-key
    // objects with a fixed value schema cleanly, so we emit `pages`
    // as an array of { slug, plan } and reshape server-side. Cleaner
    // for the LLM too (arrays are easier than dynamic keys).
    pages: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['slug', 'plan'],
        properties: {
          slug: { type: 'string', minLength: 1, maxLength: 80 },
          plan: SEO_PLAN_ITEM_SCHEMA,
        },
      },
    },
    handoff_note: {
      type: 'string',
      minLength: 100,
      maxLength: 4000,
      description:
        '≤1-screen markdown handoff for outline + draft: which pages carry a local-SEO opportunity vs. branded-only, keyword cannibalization risks between adjacent pages, and any pages where primary_audience + allocated content don\'t match the chosen keyword.',
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

  // Staleness guard: SEO plan gets stale when site_strategy (page
  // list), page_allocation_plan (what content each page carries),
  // or strategic_goals (audience/voice) freshen. Refuse unless
  // force=true so a mid-flight regenerate doesn't rewrite plans
  // outline + draft are already working from.
  let staleness: Awaited<ReturnType<typeof guardOrRefuse>>
  try {
    staleness = await guardOrRefuse(sb, {
      project_id:   projectId,
      output_key:   'roadmap_state.page_seo_plans',
      output_spec:  { kind: 'roadmap_state_meta', key: 'page_seo_plans' },
      upstream: [
        { kind: 'roadmap_state_meta', key: 'site_strategy' },
        { kind: 'roadmap_state_meta', key: 'page_allocation_plan' },
        { kind: 'roadmap_state_meta', key: 'strategic_goals' },
      ],
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
  if (!inputs.siteStrategy)   return res.status(400).json({ error: 'site_strategy_missing',   detail: 'Run plan-site-strategy first.' })
  if (!inputs.allocationPlan) return res.status(400).json({ error: 'allocation_plan_missing', detail: 'Run plan-cross-page-allocation first.' })

  let resolved: Awaited<ReturnType<typeof resolveCoworkSkill>>
  try {
    resolved = await resolveCoworkSkill(sb, 'plan-page-seo', projectId)
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
      maxTokens:       16000,
    })
  } catch (e) {
    return mapGatewayError(res, e)
  }

  // Reshape the array-of-{slug,plan} into a keyed map so downstream
  // consumers (outline / draft / handoff-to-pages) index by slug.
  const emitted = gatewayResult.args as { pages?: Array<{ slug: string; plan: unknown }>; handoff_note?: string }
  const bySlug: Record<string, unknown> = {}
  for (const entry of emitted.pages ?? []) {
    if (typeof entry.slug === 'string' && entry.slug.trim().length > 0 && entry.plan) {
      bySlug[entry.slug] = entry.plan
    }
  }

  const now = new Date().toISOString()
  const artifactBody = {
    pages: bySlug,
    _meta: {
      bundle_version: BUNDLE_VERSION,
      skill_name:     'plan-page-seo',
      skill_version:  resolved.skillVersion,
      generated_at:   now,
      model:          gatewayResult.model,
      prompt_hash:    resolved.promptHash,
      usage: {
        input_tokens:  gatewayResult.usage.inputTokens,
        output_tokens: gatewayResult.usage.outputTokens,
      },
      handoff_note: typeof emitted.handoff_note === 'string' ? emitted.handoff_note : undefined,
      pages_planned: Object.keys(bySlug).length,
    },
  }

  try {
    await setRoadmapStateAtomic(sb, projectId, ['page_seo_plans'], artifactBody)
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'roadmap_state write failed' })
  }

  return res.status(200).json({
    ok:              true,
    project_id:      projectId,
    page_seo_plans:  artifactBody,
    skill_meta:      artifactBody._meta,
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
  siteStrategy:   Record<string, unknown> | null
  allocationPlan: Record<string, unknown> | null
  strategicGoals: StrategicGoalsSnapshot | null
  facts:          Array<Record<string, unknown>>
  projectRow:     { church_name: string | null; address: string | null; city_state: string | null } | null
}

async function assembleEndpointInputs(
  sb:        any,
  projectId: string,
): Promise<AssembledInputs> {
  const [projRes, factsRes] = await Promise.all([
    sb.from('strategy_web_projects')
      .select('roadmap_state, church_name, address, city_state')
      .eq('id', projectId)
      .maybeSingle(),
    sb.from('church_facts')
      .select('topic, fact, is_primary_service')
      .eq('web_project_id', projectId)
      .eq('archived', false)
      .limit(200),
  ])
  if (projRes.error)  throw new Error(`project load failed: ${projRes.error.message}`)
  if (factsRes.error) throw new Error(`facts load failed: ${factsRes.error.message}`)

  const roadmap = (projRes.data?.roadmap_state ?? {}) as Record<string, any>
  return {
    stage1:         roadmap.stage_1              ?? null,
    ministryModel:  roadmap.ministry_model       ?? null,
    siteStrategy:   roadmap.site_strategy        ?? null,
    allocationPlan: roadmap.page_allocation_plan ?? null,
    strategicGoals: (roadmap.strategic_goals as StrategicGoalsSnapshot | undefined) ?? null,
    facts:          (factsRes.data ?? []) as Array<Record<string, unknown>>,
    projectRow: projRes.data
      ? { church_name: projRes.data.church_name ?? null, address: projRes.data.address ?? null, city_state: projRes.data.city_state ?? null }
      : null,
  }
}

function buildUserMessage(inputs: AssembledInputs): string {
  const goalsBlock = renderStrategicGoalsForStep(inputs.strategicGoals, 'plan-page-seo')
  const church = inputs.projectRow?.church_name ?? 'this church'
  const geoLine = [inputs.projectRow?.address, inputs.projectRow?.city_state].filter(Boolean).join(' · ')

  return [
    `Produce one SEO plan for every page in site_strategy.pages per the SKILL above.`,
    ``,
    `## Project`,
    `- Church: **${church}**`,
    geoLine ? `- Location signal: ${geoLine}` : '- Location signal: (none in project row — read church_facts)',
    ``,
    goalsBlock ? goalsBlock : '_No approved strategic goals snapshot — infer audience / local context from stage_1 + church_facts._',
    ``,
    `## stage_1 (voice, personas, ethos, x_factor)`,
    '```json',
    JSON.stringify(inputs.stage1, null, 2),
    '```',
    ``,
    `## ministry_model (attractional / discipleship / missional posture)`,
    '```json',
    JSON.stringify(inputs.ministryModel, null, 2),
    '```',
    ``,
    `## site_strategy — the page list you are planning SEO for`,
    '```json',
    JSON.stringify(inputs.siteStrategy, null, 2),
    '```',
    ``,
    `## page_allocation_plan — what content each page carries`,
    '```json',
    JSON.stringify(inputs.allocationPlan, null, 2),
    '```',
    ``,
    `## church_facts (topic + fact) — for local-SEO Q&A + service areas`,
    '```json',
    JSON.stringify(inputs.facts, null, 2),
    '```',
    ``,
    `Now call \`${TOOL_NAME}\` with the per-page SEO plans.`,
    `Emit ONE entry for every slug in site_strategy.pages[]. Do not skip pages.`,
    `Keyword targets MUST speak the primary_audience's search language, not the church's internal language (see SKILL §Persona + audience gates).`,
  ].join('\n')
}
