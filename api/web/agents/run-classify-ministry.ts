/**
 * Vercel Serverless Function — /api/web/agents/run-classify-ministry
 *
 * Cowork worker endpoint: classify the project's ministry model.
 *
 *   POST { project_id, force?: boolean }
 *
 * Reads stage_1 + a compact pillar/fact projection + ministry_model
 * SKILL.md and emits a small JSON: {model, confidence, secondary_blend,
 * rationale, evidence, cta_default}. Drives the page-outline templates
 * downstream — plan-cross-page-allocation + outline-page both branch
 * on ministry_model to pick page patterns.
 *
 * Same hazard class as synthesize-strategy (overwriting an existing
 * ministry_model on a mid-flight account drifts every downstream
 * template choice silently). Same staleness guard: refuse if
 * ministry_model exists AND is fresher than stage_1, pass force=true
 * to regenerate.
 *
 * Iteration 1 (this commit):
 *   - Staleness guard + input assembly + gateway + direct write.
 *
 * Iteration 2 (later):
 *   - validateClassifyMinistry + importer dispatch + repair loop.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'

import { callGateway, type ToolSchema } from '../../srp/_lib/aiGateway.js'
import { resolveCoworkSkill } from './_lib/resolveCoworkSkill.js'
import { setRoadmapStateAtomic } from './_lib/roadmapStateMerge.js'
import { guardOrRefuse } from './_lib/stalenessGuard.js'
import { BUNDLE_VERSION } from '../../../src/types/coworkBundle.js'

export const maxDuration = 300

const TOOL_NAME = 'emit_ministry_model'
const TOOL_DESCRIPTION =
  'Emit the CoworkMinistryModel — {model (attractional|discipleship|missional), confidence ' +
  '(0-1), secondary_blend (or null), blend_notes (or null), evidence (atom-snippet array), ' +
  'rationale (1 paragraph), cta_default}.'

const TOOL_SCHEMA: ToolSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['model', 'confidence', 'secondary_blend', 'blend_notes', 'evidence', 'rationale', 'cta_default'],
  properties: {
    model:           { type: 'string', enum: ['attractional', 'discipleship', 'missional'] },
    confidence:      { type: 'number', minimum: 0, maximum: 1 },
    secondary_blend: { type: ['string', 'null'], enum: ['attractional', 'discipleship', 'missional', null] },
    blend_notes:     { type: ['string', 'null'] },
    evidence: {
      type: 'array',
      minItems: 2,
      maxItems: 8,
      items: { type: 'string', minLength: 1, maxLength: 280 },
    },
    rationale:   { type: 'string', minLength: 40, maxLength: 800 },
    cta_default: { type: 'string', minLength: 1, maxLength: 80 },
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

  // ── Staleness guard ─────────────────────────────────────────────
  // Refuse if ministry_model already exists AND was generated after
  // stage_1 (the director's resume rule).
  let staleness: Awaited<ReturnType<typeof guardOrRefuse>>
  try {
    staleness = await guardOrRefuse(sb, {
      project_id:   projectId,
      output_key:   'roadmap_state.ministry_model',
      output_spec:  { kind: 'roadmap_state_meta', key: 'ministry_model' },
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

  // ── Input assembly ──────────────────────────────────────────────
  let inputs: AssembledInputs
  try {
    inputs = await assembleEndpointInputs(sb, projectId)
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'input assembly failed' })
  }
  if (!inputs.stage1) {
    return res.status(400).json({
      error:  'stage_1_missing',
      detail: 'roadmap_state.stage_1 not found — synthesize-strategy must run first.',
    })
  }

  // ── Prompt resolution ───────────────────────────────────────────
  let resolved: Awaited<ReturnType<typeof resolveCoworkSkill>>
  try {
    resolved = await resolveCoworkSkill(sb, 'classify-ministry', projectId)
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'prompt resolve failed' })
  }

  // ── Gateway ─────────────────────────────────────────────────────
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
      // Small output (single classification + rationale). 4k cap is
      // generous.
      maxTokens:       4000,
    })
  } catch (e) {
    return mapGatewayError(res, e)
  }

  const now = new Date().toISOString()
  const ministryModelWithMeta = {
    ...(gatewayResult.args as Record<string, unknown>),
    _meta: {
      bundle_version: BUNDLE_VERSION,
      skill_name:     'classify-ministry',
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
      validator_iteration: 1,
    },
  }

  try {
    await setRoadmapStateAtomic(sb, projectId, ['ministry_model'], ministryModelWithMeta)
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'roadmap_state write failed' })
  }

  return res.status(200).json({
    ok:               true,
    project_id:       projectId,
    ministry_model:   ministryModelWithMeta,
    skill_meta:       (ministryModelWithMeta as any)._meta,
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

// ──────────────────────────────────────────────────────────────────────

interface AssembledInputs {
  stage1: Record<string, unknown> | null
  atoms:  Array<{ id: string; topic: string; body: string }>
  facts:  Array<{ id: string; topic: string; data: Record<string, unknown> }>
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
    // Per the SKILL: only posture-signaling topics matter for
    // classification. Filter at the query layer to keep the user
    // message focused.
    sb.from('content_atoms')
      .select('id, topic, body')
      .eq('web_project_id', projectId)
      .in('status', ['approved', 'draft'])
      .in('topic', ['ethos', 'value_statement', 'x_factor', 'story', 'mission_statement', 'vision_statement']),
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
    stage1: roadmap.stage_1 ?? null,
    atoms:  (atomsRes.data ?? []) as AssembledInputs['atoms'],
    facts:  (factsRes.data ?? []) as AssembledInputs['facts'],
  }
}

function buildUserMessage(inputs: AssembledInputs): string {
  // Fact counts BY TOPIC — the SKILL says "10 ministry facts + 0
  // partnership facts is a tell" so per-topic counts are part of
  // the classification signal.
  const factCountsByTopic: Record<string, number> = {}
  for (const f of inputs.facts) {
    factCountsByTopic[f.topic] = (factCountsByTopic[f.topic] ?? 0) + 1
  }
  // Compact fact preview (just topic + first 120 chars of data).
  const compactFacts = inputs.facts.map(f => ({
    topic:   f.topic,
    preview: typeof f.data === 'object' && f.data
      ? JSON.stringify(f.data).slice(0, 120)
      : String(f.data ?? '').slice(0, 120),
  }))

  return [
    `Classify this church's ministry model per the SKILL above.`,
    ``,
    `## stage_1 (synthesize-strategy output)`,
    '```json',
    JSON.stringify(inputs.stage1, null, 2),
    '```',
    ``,
    `## Posture-signaling pillars (${inputs.atoms.length} entries: ethos / value / x_factor / story / mission / vision)`,
    '```json',
    JSON.stringify(inputs.atoms, null, 2),
    '```',
    ``,
    `## Fact counts by topic (the tell — programs vs partnerships vs services)`,
    '```json',
    JSON.stringify(factCountsByTopic, null, 2),
    '```',
    ``,
    `## Facts (compact — topic + 120-char preview)`,
    '```json',
    JSON.stringify(compactFacts, null, 2),
    '```',
    ``,
    `Now call \`${TOOL_NAME}\` with the classification. confidence in [0,1].`,
    `evidence: 2-8 verbatim phrases (lifted from pillar bodies) supporting your model pick.`,
    `secondary_blend: null if dominant is clearly singular; otherwise the second-strongest posture.`,
  ].join('\n')
}
