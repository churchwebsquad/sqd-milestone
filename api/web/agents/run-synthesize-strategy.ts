/**
 * Vercel Serverless Function — /api/web/agents/run-synthesize-strategy
 *
 * Cowork worker endpoint: synthesize the project-level `stage_1` block
 * that every downstream stage reads. One call per project.
 *
 *   POST { project_id, force?: boolean }
 *
 * THE STALENESS GUARD (the reason this endpoint is more dangerous than
 * the per-page writers):
 *
 *   stage_1 is the FOUNDATION. Every other cowork SKILL — classify-
 *   ministry, plan-site-strategy, plan-cross-page-allocation, outline-
 *   page, draft-page, critique-page — reads stage_1 at the top of its
 *   prompt. A silent regeneration of stage_1 against a mid-flight real
 *   account would drift voice_exemplars, ethos_summary, personas, and
 *   x_factor — and downstream copy would be inconsistent without
 *   anyone noticing until a partner review.
 *
 *   The director's resume-conditions table promotes this rule (skip if
 *   stage_1._meta.generated_at is AFTER the latest content_atoms.
 *   created_at), but the director isn't the only caller — direct API
 *   calls, smoke scripts, scripted re-runs all bypass it. So this
 *   endpoint runs the same check FIRST (via the shared
 *   stalenessGuard helper), returns 409 with a structured detail
 *   block if stage_1 is already fresh, and accepts force=true to
 *   bypass when the strategist explicitly wants regeneration.
 *
 *   Same hazard class applies to: run-plan-site-strategy, run-
 *   classify-ministry, run-organize-acf, run-synthesize-critique. All
 *   use the same helper; this endpoint is the canonical pattern.
 *
 * Iteration 1 scope (this commit):
 *   - Staleness guard wired + structurally tested.
 *   - Input assembly from atoms + facts + discovery + brand_guide.
 *   - Gateway call with forced tool_choice + the CoworkStage1 shape.
 *   - Direct write to roadmap_state.stage_1 via setRoadmapStateAtomic.
 *   - _meta stamping (model, prompt_hash, generated_at, usage).
 *
 * Iteration 2 (next commit) adds:
 *   - validateSynthesizeStrategy (the persona-count + voice-exemplar
 *     substring checks).
 *   - import-cowork-bundle dispatch for bundle_kind='stage_1'.
 *   - Repair-on-422 loop (canonical pattern from run-outline-page).
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

const TOOL_NAME = 'emit_stage_1'
const TOOL_DESCRIPTION =
  'Emit the CoworkStage1 block — personas (3-5), x_factor, ethos_summary, ' +
  'voice_exemplars (5-15 verbatim phrases), voice_anti_exemplars (3-7), ' +
  'persuasive_posture_by_persona, and a report block (pillar_coverage, ' +
  'suspected_gaps, divergence_notes).'

/** Tool schema for the synthesize-strategy output. Conservative bounds
 *  enforced where the SKILL has hard rules; everything else is
 *  open-string so the model can phrase naturally. */
const TOOL_SCHEMA: ToolSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['personas', 'x_factor', 'ethos_summary', 'voice_exemplars',
             'voice_anti_exemplars', 'persuasive_posture_by_persona', 'report'],
  properties: {
    // 3-5 personas — hard rule per SKILL.
    personas: {
      type: 'array',
      minItems: 3,
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'bio_one_line', 'desire', 'barrier', 'likely_entry_points'],
        properties: {
          name:                { type: 'string', minLength: 1, maxLength: 40 },
          bio_one_line:        { type: 'string', minLength: 1, maxLength: 80 },
          desire:              { type: 'string', minLength: 1, maxLength: 120 },
          barrier:             { type: 'string', minLength: 1, maxLength: 120 },
          likely_entry_points: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1, maxItems: 3 },
        },
      },
    },
    x_factor:      { type: 'string', minLength: 10, maxLength: 240 },
    ethos_summary: { type: 'string', minLength: 10, maxLength: 280 },
    // Voice exemplars: 5-15 verbatim phrases lifted from upstream sources.
    voice_exemplars: {
      type: 'array',
      minItems: 5,
      maxItems: 15,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['phrase', 'source', 'why_it_works'],
        properties: {
          phrase:        { type: 'string', minLength: 1, maxLength: 300 },
          source:        { type: 'string', minLength: 1 },
          why_it_works:  { type: 'string', minLength: 1, maxLength: 200 },
        },
      },
    },
    // Voice anti-exemplars: 3-7 banned phrases / shapes.
    voice_anti_exemplars: {
      type: 'array',
      minItems: 3,
      maxItems: 7,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['phrase', 'source', 'why_it_breaks'],
        properties: {
          phrase:         { type: 'string', minLength: 1, maxLength: 200 },
          source:         { type: 'string', minLength: 1 },
          why_it_breaks:  { type: 'string', minLength: 1, maxLength: 200 },
        },
      },
    },
    persuasive_posture_by_persona: {
      type: 'object',
      additionalProperties: { type: 'string', minLength: 1, maxLength: 200 },
    },
    report: {
      type: 'object',
      additionalProperties: false,
      required: ['pillar_coverage', 'suspected_gaps', 'divergence_notes'],
      properties: {
        pillar_coverage:  { type: 'object', additionalProperties: { type: 'integer', minimum: 0 } },
        suspected_gaps:   { type: 'array', items: { type: 'string' } },
        divergence_notes: { type: 'array', items: { type: 'string' } },
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

  // ── Staleness guard ─────────────────────────────────────────────
  // Refuse if stage_1 already exists AND is at least as fresh as the
  // latest content_atom that informed it. The director enforces this
  // rule when it walks the table; ad-hoc callers bypass that, so the
  // check lives here too — uniform across every roadmap_state writer.
  let staleness: Awaited<ReturnType<typeof guardOrRefuse>>
  try {
    staleness = await guardOrRefuse(sb, {
      project_id:   projectId,
      output_key:   'roadmap_state.stage_1',
      output_spec:  { kind: 'roadmap_state_meta', key: 'stage_1' },
      upstream:     [{ kind: 'content_atoms_max_created_at' }],
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
  if (inputs.atoms.length === 0) {
    return res.status(400).json({
      error:  'no_atoms_in_inventory',
      detail: 'No content_atoms exist for this project. Run extract-strategic-pillars (step 1) first.',
    })
  }

  // ── Prompt resolution ───────────────────────────────────────────
  let resolved: Awaited<ReturnType<typeof resolveCoworkSkill>>
  try {
    resolved = await resolveCoworkSkill(sb, 'synthesize-strategy', projectId)
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'prompt resolve failed' })
  }

  // ── Gateway call ────────────────────────────────────────────────
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
      // stage_1 is dense — personas + exemplars + anti-exemplars +
      // report. Empirical bound from extract-strategy's legacy output:
      // ~6-8k tokens is typical, 12k is the headroom budget.
      maxTokens:       12000,
    })
  } catch (e) {
    return mapGatewayError(res, e)
  }

  // ── _meta stamp ─────────────────────────────────────────────────
  const now = new Date().toISOString()
  const stage1WithMeta = {
    ...(gatewayResult.args as Record<string, unknown>),
    sources_used: inputs.atoms.map(a => `pillar:${a.id}`),
    _meta: {
      bundle_version: BUNDLE_VERSION,
      skill_name:     'synthesize-strategy',
      skill_version:  resolved.skillVersion,
      generated_at:   now,
      model:          gatewayResult.model,
      prompt_hash:    resolved.promptHash,
      usage: {
        input_tokens:  gatewayResult.usage.inputTokens,
        output_tokens: gatewayResult.usage.outputTokens,
      },
      atom_count:        inputs.atoms.length,
      fact_count:        inputs.facts.length,
      has_discovery_qa:  !!inputs.discoveryQa,
      has_brand_guide:   !!inputs.brandGuide,
      // Iteration 1: no validator, no repair-loop. Surface honestly
      // so the strategist UI shows "iteration 1 endpoint output —
      // not yet gated by the validator." Removed in iteration 2.
      validator_iteration: 1,
    },
  }

  // ── Direct atomic write (iteration 1 — no importer dispatch yet) ─
  // Iteration 2 will route through import-cowork-bundle for trust-
  // boundary validation; for now the endpoint writes directly so the
  // staleness guard + input assembly + gateway flow can be exercised
  // end-to-end against real accounts.
  try {
    await setRoadmapStateAtomic(sb, projectId, ['stage_1'], stage1WithMeta)
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'roadmap_state write failed' })
  }

  return res.status(200).json({
    ok:            true,
    project_id:    projectId,
    stage_1:       stage1WithMeta,
    skill_meta:    (stage1WithMeta as any)._meta,
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
  atoms:          Array<{ id: string; topic: string; body: string; verbatim: boolean; source_kind: string; source_ref: string }>
  facts:          Array<{ id: string; topic: string; data: Record<string, unknown> }>
  discoveryQa:    Record<string, unknown> | null
  brandGuide:     Record<string, unknown> | null
  strategicGoals: StrategicGoalsSnapshot | null
}

async function assembleEndpointInputs(
  sb:        any,
  projectId: string,
): Promise<AssembledInputs> {
  // Load the project to get the member number (discovery + brand_guide
  // are joined on member, not web_project_id). Same fetch pulls
  // roadmap_state for the strategic-goals snapshot.
  const { data: project, error: projErr } = await sb
    .from('strategy_web_projects')
    .select('id, member, roadmap_state')
    .eq('id', projectId)
    .maybeSingle()
  if (projErr) throw new Error(`project load failed: ${projErr.message}`)
  if (!project) throw new Error(`project ${projectId} not found`)
  const member = project.member
  const strategicGoals = ((project.roadmap_state as Record<string, unknown> | null)?.strategic_goals as StrategicGoalsSnapshot | undefined) ?? null

  const [atomsRes, factsRes, discoveryRes, brandGuideRes] = await Promise.all([
    sb.from('content_atoms')
      .select('id, topic, body, verbatim, source_kind, source_ref')
      .eq('web_project_id', projectId)
      .in('status', ['approved', 'draft']),
    sb.from('church_facts')
      .select('id, topic, data')
      .eq('web_project_id', projectId)
      .in('status', ['approved', 'draft']),
    sb.from('strategy_discovery_questionnaire')
      .select('*')
      .eq('member', member)
      .order('submitted_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    sb.from('strategy_brand_guides')
      .select('*')
      .eq('member', member)
      .eq('is_published', true)
      .order('last_updated_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
  ])
  if (atomsRes.error)       throw new Error(`content_atoms load failed: ${atomsRes.error.message}`)
  if (factsRes.error)       throw new Error(`church_facts load failed: ${factsRes.error.message}`)
  if (discoveryRes.error)   throw new Error(`discovery load failed: ${discoveryRes.error.message}`)
  if (brandGuideRes.error)  throw new Error(`brand_guide load failed: ${brandGuideRes.error.message}`)

  return {
    atoms:          (atomsRes.data ?? []) as AssembledInputs['atoms'],
    facts:          (factsRes.data ?? []) as AssembledInputs['facts'],
    discoveryQa:    discoveryRes.data ?? null,
    brandGuide:     brandGuideRes.data ?? null,
    strategicGoals,
  }
}

function buildUserMessage(inputs: AssembledInputs): string {
  // Compact projection: atoms get a body preview, facts get a data
  // preview. The model has the SKILL's contract; the user message
  // just supplies the raw material.
  const compactAtoms = inputs.atoms.map(a => ({
    id:          a.id,
    topic:       a.topic,
    body:        a.body,
    verbatim:    a.verbatim,
    source_kind: a.source_kind,
    source_ref:  a.source_ref,
  }))
  const compactFacts = inputs.facts.map(f => ({
    id:    f.id,
    topic: f.topic,
    // Surface a small preview so the model can cross-reference; full
    // fact.data isn't needed for stage_1 synthesis (it's downstream
    // copy-time material).
    preview: typeof f.data === 'object' && f.data
      ? JSON.stringify(f.data).slice(0, 200)
      : String(f.data ?? '').slice(0, 200),
  }))

  const goalsBlock = renderStrategicGoalsForStep(inputs.strategicGoals, 'synthesize-strategy')
  return [
    `Synthesize the stage_1 block for this project per the SKILL above.`,
    ``,
    goalsBlock ? goalsBlock : '_No approved strategic goals snapshot — proceed using atoms + facts + discovery alone._',
    ``,
    `## Pillar atoms (${compactAtoms.length} entries — the strategist-reviewed inventory)`,
    '```json',
    JSON.stringify(compactAtoms, null, 2),
    '```',
    ``,
    `## Church facts (${compactFacts.length} entries — structured-data sources)`,
    '```json',
    JSON.stringify(compactFacts, null, 2),
    '```',
    ``,
    `## Discovery questionnaire`,
    inputs.discoveryQa
      ? '```json\n' + JSON.stringify(inputs.discoveryQa, null, 2) + '\n```'
      : '_No discovery questionnaire found for this project._',
    ``,
    `## Brand guide`,
    inputs.brandGuide
      ? '```json\n' + JSON.stringify(inputs.brandGuide, null, 2) + '\n```'
      : '_No published brand guide found for this project._',
    ``,
    `Now call \`${TOOL_NAME}\` with the synthesized stage_1.`,
    `Personas: 3-5. Voice exemplars: 5-15 (every phrase MUST be sourceable`,
    `to an atom or upstream doc — no invented voice). Voice anti-exemplars:`,
    `3-7. Every verbatim atom (\`verbatim: true\`) MUST appear somewhere in`,
    `your output (typically as a voice_exemplar or in the ethos_summary).`,
  ].join('\n')
}
