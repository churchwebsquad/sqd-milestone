/**
 * Vercel Serverless Function — /api/web/agents/run-synthesize-critique
 *
 * Cowork worker endpoint: roll up per-page critiques into a project-
 * level verdict the strategist sees at Gate 2.
 *
 *   POST { project_id, force?: boolean }
 *
 * Reads roadmap_state.page_critiques.* (every per-page critique) +
 * stage_1 + site_strategy + the page drafts themselves, and emits a
 * CoworkCritiqueRollup with overall_band, voice_consistency,
 * persona_coverage, structural_parity, source_coverage rollup, and
 * cross_page_findings.
 *
 * Staleness guard: refuse if critique_rollup is newer than the LATEST
 * per-page critique (max child of page_critiques.*).
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
import { renderStrategicGoalsForStep } from '../../../src/lib/cowork/strategicGoalsContext.js'
import type { StrategicGoalsSnapshot } from '../../../src/lib/cowork/strategicGoals.js'

export const maxDuration = 300

const TOOL_NAME = 'emit_critique_rollup'
const TOOL_DESCRIPTION =
  'Emit the CoworkCritiqueRollup — overall_band + voice_consistency + persona_coverage + ' +
  'structural_parity + source_coverage rollup + cross_page_findings.'

const BAND_3   = ['green', 'yellow', 'red'] as const
const VOICE_4  = ['tight', 'close', 'drift', 'wrong'] as const
const PRES_4   = ['strong', 'present', 'weak', 'missing'] as const

const TOOL_SCHEMA: ToolSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['overall_band', 'voice_consistency', 'persona_coverage', 'structural_parity', 'source_coverage', 'cross_page_findings'],
  properties: {
    overall_band: { type: 'string', enum: [...BAND_3] },
    voice_consistency: {
      type: 'object',
      additionalProperties: false,
      required: ['band', 'note', 'drift_pages'],
      properties: {
        band: { type: 'string', enum: [...VOICE_4] },
        note: { type: 'string', minLength: 1, maxLength: 400 },
        drift_pages: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['page_slug', 'drift_axis', 'note'],
            properties: {
              page_slug:  { type: 'string' },
              drift_axis: { type: 'string', enum: ['rhythm', 'register', 'pronoun', 'vocabulary'] },
              note:       { type: 'string', maxLength: 200 },
            },
          },
        },
      },
    },
    persona_coverage: {
      type: 'object',
      additionalProperties: false,
      required: ['band', 'per_persona'],
      properties: {
        band: { type: 'string', enum: [...BAND_3] },
        per_persona: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['persona', 'entry_point_quality', 'journey_walkable', 'barrier_addressed_pages',
                       'barrier_unaddressed_note', 'commit_endpoint_quality'],
            properties: {
              persona:                  { type: 'string' },
              entry_point_quality:      { type: 'string', enum: [...PRES_4] },
              journey_walkable:         { type: 'boolean' },
              barrier_addressed_pages:  { type: 'array', items: { type: 'string' } },
              barrier_unaddressed_note: { type: ['string', 'null'] },
              commit_endpoint_quality:  { type: 'string', enum: [...PRES_4] },
            },
          },
        },
      },
    },
    structural_parity: {
      type: 'object',
      additionalProperties: false,
      required: ['band', 'pages_in_nav_but_undrafted', 'pages_drafted_but_unreachable', 'nav_target_404s'],
      properties: {
        band: { type: 'string', enum: [...BAND_3] },
        pages_in_nav_but_undrafted:    { type: 'array', items: { type: 'string' } },
        pages_drafted_but_unreachable: { type: 'array', items: { type: 'string' } },
        nav_target_404s: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['from_slug', 'cta_label', 'broken_target'],
            properties: {
              from_slug:     { type: 'string' },
              cta_label:     { type: 'string' },
              broken_target: { type: 'string' },
            },
          },
        },
      },
    },
    source_coverage: {
      type: 'object',
      additionalProperties: false,
      required: ['band', 'project_orphans', 'over_used'],
      properties: {
        band: { type: 'string', enum: [...BAND_3] },
        project_orphans: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['atom_id', 'topic', 'pages_attempted'],
            properties: {
              atom_id:          { type: 'string' },
              topic:            { type: 'string' },
              pages_attempted:  { type: 'array', items: { type: 'string' } },
            },
          },
        },
        over_used: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['atom_id', 'appears_on_pages'],
            properties: {
              atom_id:          { type: 'string' },
              appears_on_pages: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
    cross_page_findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'description'],
        properties: {
          kind:        { type: 'string', enum: ['voice_drift', 'persona_gap', 'atom_orphan', 'nav_parity', 'duplicate_message'] },
          description: { type: 'string', maxLength: 400 },
          pages:       { type: 'array', items: { type: 'string' } },
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
  const force     = req.body?.force === true
  if (!projectId) return res.status(400).json({ error: 'project_id required' })

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  // Staleness: critique_rollup must be newer than the latest per-page
  // critique (max child of page_critiques.*).
  let staleness: Awaited<ReturnType<typeof guardOrRefuse>>
  try {
    staleness = await guardOrRefuse(sb, {
      project_id:   projectId,
      output_key:   'roadmap_state.critique_rollup',
      output_spec:  { kind: 'roadmap_state_meta', key: 'critique_rollup' },
      upstream: [
        { kind: 'roadmap_state_meta_max_child', parent_key: 'page_critiques' },
        // church_vision (AM handoff) is now a critique input — fresh snapshot
        // means the rollup needs to re-run with the updated vision context.
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
  if (Object.keys(inputs.pageCritiques).length === 0) {
    return res.status(400).json({
      error:  'no_page_critiques',
      detail: 'roadmap_state.page_critiques is empty. Run critique-page on each drafted page first.',
    })
  }

  let resolved: Awaited<ReturnType<typeof resolveCoworkSkill>>
  try {
    resolved = await resolveCoworkSkill(sb, 'synthesize-critique', projectId)
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
      // Rollup is small — bands + summaries + per-persona block.
      // 6k cap is generous.
      maxTokens:       6000,
    })
  } catch (e) {
    return mapGatewayError(res, e)
  }

  const now = new Date().toISOString()
  const rollupWithMeta = {
    ...(gatewayResult.args as Record<string, unknown>),
    _meta: {
      bundle_version: BUNDLE_VERSION,
      skill_name:     'synthesize-critique',
      skill_version:  resolved.skillVersion,
      generated_at:   now,
      model:          gatewayResult.model,
      prompt_hash:    resolved.promptHash,
      usage: {
        input_tokens:  gatewayResult.usage.inputTokens,
        output_tokens: gatewayResult.usage.outputTokens,
      },
      page_critique_count: Object.keys(inputs.pageCritiques).length,
      drafts_count:        Object.keys(inputs.pageDrafts).length,
      validator_iteration: 1,
    },
  }

  try {
    await setRoadmapStateAtomic(sb, projectId, ['critique_rollup'], rollupWithMeta)
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'roadmap_state write failed' })
  }

  return res.status(200).json({
    ok:               true,
    project_id:       projectId,
    critique_rollup:  rollupWithMeta,
    skill_meta:       (rollupWithMeta as any)._meta,
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
  siteStrategy:   Record<string, unknown> | null
  pageCritiques:  Record<string, Record<string, unknown>>
  pageDrafts:     Record<string, Record<string, unknown>>
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
    stage1:         roadmap.stage_1        ?? null,
    siteStrategy:   roadmap.site_strategy  ?? null,
    pageCritiques:  (roadmap.page_critiques ?? {}) as Record<string, Record<string, unknown>>,
    pageDrafts:     (roadmap.page_drafts    ?? {}) as Record<string, Record<string, unknown>>,
    strategicGoals: (roadmap.strategic_goals as StrategicGoalsSnapshot | undefined) ?? null,
  }
}

function buildUserMessage(inputs: AssembledInputs): string {
  // Compact critique projection — keep scores + directives + summary
  // per page; drop the verbose problem_lines / standout_lines (they
  // were the per-page reviewer's evidence, already factored into the
  // scores the rollup reads).
  const compactCritiques: Record<string, unknown> = {}
  for (const [slug, c] of Object.entries(inputs.pageCritiques)) {
    compactCritiques[slug] = {
      dignity:             (c as any).dignity,
      voice_character:     (c as any).voice_character,
      persona_fit:         (c as any).persona_fit,
      source_coverage:     (c as any).source_coverage,
      claim_plausibility:  (c as any).claim_plausibility,
      directives_count:    Array.isArray((c as any).directives) ? (c as any).directives.length : 0,
      blockers_count:      Array.isArray((c as any).directives)
        ? ((c as any).directives as Array<{ severity?: string }>).filter(d => d?.severity === 'blocker').length
        : 0,
      summary:             (c as any).summary,
    }
  }

  // Compact draft projection — just sections.archetype + a sample
  // of each section's body. The rollup model reads these to detect
  // voice drift across pages without needing every slot.
  const compactDrafts: Record<string, unknown> = {}
  for (const [slug, d] of Object.entries(inputs.pageDrafts)) {
    const sections = ((d as any).sections ?? []) as Array<any>
    compactDrafts[slug] = {
      sections: sections.map(s => ({
        archetype: s?.archetype,
        copy_sample: (() => {
          const copy = (s?.copy ?? {}) as Record<string, unknown>
          const firstStr = Object.values(copy).find(v => typeof v === 'string') as string | undefined
          return firstStr ? firstStr.slice(0, 240) : ''
        })(),
      })),
    }
  }

  const goalsBlock = renderStrategicGoalsForStep(inputs.strategicGoals, 'synthesize-critique')
  return [
    `Roll up the per-page critiques into a project-level verdict per the SKILL above.`,
    ``,
    goalsBlock ? goalsBlock : '_No approved strategic goals snapshot — roll up using stage_1 + per-page critiques alone._',
    ``,
    `## stage_1 (personas, voice exemplars, ethos)`,
    '```json',
    JSON.stringify(inputs.stage1, null, 2),
    '```',
    ``,
    `## site_strategy (sitemap, nav, persona_journeys)`,
    '```json',
    JSON.stringify(inputs.siteStrategy, null, 2),
    '```',
    ``,
    `## Per-page critiques (compact — scores + directive counts + summary)`,
    '```json',
    JSON.stringify(compactCritiques, null, 2),
    '```',
    ``,
    `## Per-page draft samples (section archetype + first slot value, for voice-drift detection)`,
    '```json',
    JSON.stringify(compactDrafts, null, 2),
    '```',
    ``,
    `Now call \`${TOOL_NAME}\`. overall_band reflects the worst of any axis (red if any persona is`,
    `missing entry/commit endpoint, or any structural parity issue blocks navigation).`,
    `persona_coverage.per_persona must have one entry per stage_1.personas[].name.`,
  ].join('\n')
}
