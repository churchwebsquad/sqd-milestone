/**
 * Vercel Serverless Function — /api/web/agents/run-extract-strategic-pillars
 *
 * Cowork worker endpoint: extract strategic pillars from ONE prose
 * source into content_atoms rows.
 *
 *   POST { project_id, source_kind, source_ref, source_text, source_filename? }
 *
 * Different SHAPE from the roadmap_state writers (synthesize-strategy
 * et al.). This endpoint:
 *
 *   - Writes to a TABLE (content_atoms), not roadmap_state. No v70 RPC.
 *   - Idempotency is via (web_project_id, source_kind, source_ref) on
 *     the row: re-running against the same source replaces existing
 *     DRAFT rows for that source. Approved rows are preserved (the
 *     strategist accepted them; the strategist gets to keep them or
 *     archive them via the Atoms tab, not the extractor).
 *   - No staleness guard in the roadmap_state sense. The idempotency
 *     key IS the staleness mechanism — re-running on the same source
 *     is harmless. If the source CHANGED, new atoms come back as
 *     draft for re-review.
 *
 * Inputs: ONE source per call. The director picks the source list and
 * calls this endpoint N times (one per source doc). Keeps payloads
 * small + lets the strategist see source-by-source progress.
 *
 * Per the SKILL: refuse early on routing mismatches (CSVs go to
 * parse-facts-csv; structured content_collection fields too).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'

import { callGateway, type ToolSchema } from '../../srp/_lib/aiGateway.js'
import { resolveCoworkSkill } from './_lib/resolveCoworkSkill.js'
import { BUNDLE_VERSION } from '../../../src/types/coworkBundle.js'

export const maxDuration = 300

const TOOL_NAME = 'emit_pillars'
const TOOL_DESCRIPTION =
  'Emit pillars[] — strategic-pillar atoms extracted from the source. Each pillar has topic + body + ' +
  'verbatim + confidence + optional metadata. Empty pillars[] is valid if the source has nothing extractable.'

const ATOM_TOPICS = [
  'mission_statement', 'vision_statement', 'x_factor', 'ethos', 'value_statement',
  'voice_rule', 'voice_sample', 'tone_descriptor', 'persona', 'story',
  'denominational_signal', 'recommended_page',
] as const

const SOURCE_KINDS = [
  'intake_doc', 'discovery_questionnaire', 'brand_guide', 'account_handoff', 'content_collection',
] as const

const TOOL_SCHEMA: ToolSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['pillars', 'report'],
  properties: {
    pillars: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['topic', 'body', 'verbatim', 'confidence'],
        properties: {
          topic:      { type: 'string', enum: [...ATOM_TOPICS] },
          body:       { type: 'string', minLength: 1, maxLength: 2000 },
          verbatim:   { type: 'boolean' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          metadata:   { type: 'object', additionalProperties: true },
        },
      },
    },
    report: {
      type: 'object',
      additionalProperties: false,
      required: ['scanned_atom_topics', 'notes'],
      properties: {
        scanned_atom_topics: { type: 'array', items: { type: 'string', enum: [...ATOM_TOPICS] } },
        notes:               { type: 'array', items: { type: 'string', maxLength: 400 } },
      },
    },
  },
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return res.status(500).json({ error: 'Missing Supabase env vars' })

  const projectId      = typeof req.body?.project_id      === 'string' ? req.body.project_id      : null
  const sourceKind     = typeof req.body?.source_kind     === 'string' ? req.body.source_kind     : null
  const sourceRef      = typeof req.body?.source_ref      === 'string' ? req.body.source_ref      : null
  const sourceText     = typeof req.body?.source_text     === 'string' ? req.body.source_text     : null
  const sourceFilename = typeof req.body?.source_filename === 'string' ? req.body.source_filename : null

  if (!projectId)  return res.status(400).json({ error: 'project_id required' })
  if (!sourceKind) return res.status(400).json({ error: 'source_kind required' })
  if (!sourceRef)  return res.status(400).json({ error: 'source_ref required' })
  if (!sourceText) return res.status(400).json({ error: 'source_text required' })
  if (!(SOURCE_KINDS as readonly string[]).includes(sourceKind)) {
    return res.status(400).json({ error: 'bad_source_kind', detail: `source_kind must be one of ${SOURCE_KINDS.join('|')}` })
  }

  // Routing-mismatch refusals per the SKILL: CSVs and structured
  // content_collection fields go to parse-facts-csv. The director
  // should filter these out upstream; the refusal here is the
  // defense-in-depth check.
  if (sourceKind === 'intake_doc' && sourceFilename && /\.csv$/i.test(sourceFilename)) {
    return res.status(409).json({
      error:  'csv_routed_elsewhere',
      detail: `${sourceFilename} is a CSV — extract-strategic-pillars only handles prose. Route to parse-facts-csv.`,
    })
  }
  if (sourceKind === 'content_collection' && (sourceText.startsWith('[') || sourceText.startsWith('{'))) {
    // Structured data heuristic: starts with [ or {. The director can
    // also pre-classify; this is just a defensive backstop.
    return res.status(409).json({
      error:  'structured_data_routed_to_facts',
      detail: `content_collection field value looks structured (JSON array/object). Route to parse-facts-csv.`,
    })
  }

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  let resolved: Awaited<ReturnType<typeof resolveCoworkSkill>>
  try {
    resolved = await resolveCoworkSkill(sb, 'extract-strategic-pillars', projectId)
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'prompt resolve failed' })
  }

  const userMessage = [
    `Extract strategic pillars from the source below per the SKILL above.`,
    ``,
    `## Source metadata`,
    '```json',
    JSON.stringify({ project_id: projectId, source_kind: sourceKind, source_ref: sourceRef, source_filename: sourceFilename }, null, 2),
    '```',
    ``,
    `## Source text`,
    '```',
    sourceText,
    '```',
    ``,
    `Now call \`${TOOL_NAME}\`. Topics MUST be from the closed enum. Empty pillars[] is valid if the source has nothing extractable. Always emit report.scanned_atom_topics (every topic you actually scanned for).`,
  ].join('\n')

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

  const args = gatewayResult.args as {
    pillars: Array<{ topic: string; body: string; verbatim: boolean; confidence: number; metadata?: Record<string, unknown> }>
    report:  { scanned_atom_topics: string[]; notes: string[] }
  }

  // ── Idempotent upsert ───────────────────────────────────────────
  // Step 1: delete the DRAFT atoms already attached to this exact
  //   (project, source_kind, source_ref). Approved + archived are
  //   preserved — strategist owns those; we don't auto-overwrite.
  // Step 2: insert the new pillars.
  // Result: re-running against the same source replaces the draft
  //   side; the strategist's prior approvals stay intact.
  const delRes = await (sb as any)
    .from('content_atoms')
    .delete()
    .eq('web_project_id', projectId)
    .eq('source_kind',    sourceKind)
    .eq('source_ref',     sourceRef)
    .eq('status',         'draft')
  if (delRes.error) {
    return res.status(500).json({ error: `delete prior drafts failed: ${delRes.error.message}` })
  }

  const now = new Date().toISOString()
  const rowsToInsert = args.pillars.map(p => ({
    web_project_id: projectId,
    topic:          p.topic,
    body:           p.body,
    verbatim:       p.verbatim,
    confidence:     p.confidence,
    status:         'draft',
    source_kind:    sourceKind,
    source_ref:     sourceRef,
    metadata:       p.metadata ?? {},
    created_at:     now,
    updated_at:     now,
  }))

  let insertedIds: string[] = []
  if (rowsToInsert.length > 0) {
    const insRes = await (sb as any)
      .from('content_atoms')
      .insert(rowsToInsert)
      .select('id')
    if (insRes.error) {
      return res.status(500).json({ error: `insert pillars failed: ${insRes.error.message}` })
    }
    insertedIds = (insRes.data ?? []).map((r: any) => String(r.id))
  }

  return res.status(200).json({
    ok:         true,
    project_id: projectId,
    source_kind: sourceKind,
    source_ref:  sourceRef,
    inserted_count: insertedIds.length,
    inserted_ids:   insertedIds,
    report:     args.report,
    skill_meta: {
      bundle_version: BUNDLE_VERSION,
      skill_name:     'extract-strategic-pillars',
      skill_version:  resolved.skillVersion,
      generated_at:   now,
      model:          gatewayResult.model,
      prompt_hash:    resolved.promptHash,
      usage: {
        input_tokens:  gatewayResult.usage.inputTokens,
        output_tokens: gatewayResult.usage.outputTokens,
      },
    },
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
