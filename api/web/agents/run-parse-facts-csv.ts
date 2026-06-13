/**
 * Vercel Serverless Function — /api/web/agents/run-parse-facts-csv
 *
 * Cowork worker endpoint: parse structured facts from ONE CSV (or
 * structured content_collection field) into church_facts rows.
 *
 *   POST { project_id, source_kind, source_ref, source_csv?,
 *           source_records?, source_filename? }
 *
 * Sibling to run-extract-strategic-pillars — same TABLE-writer shape:
 *   - Writes to church_facts, not roadmap_state.
 *   - Idempotency via (web_project_id, source_kind, source_ref): re-
 *     running against the same source replaces existing DRAFT rows;
 *     approved + archived are preserved.
 *   - Accepts EITHER source_csv (raw text) OR source_records (already
 *     parsed array of records). Director picks whichever is cleaner
 *     for the source.
 *
 * Refusal rules (matches SKILL):
 *   - source_kind=intake_doc + filename doesn't end .csv + no
 *     source_records → 409 prose_routed_to_pillars.
 *   - No rows extractable from the source → 200 with facts=[] and
 *     a report.note. Not an error; the strategist sees "this source
 *     had nothing factsy."
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'

import { callGateway, type ToolSchema } from '../../srp/_lib/aiGateway.js'
import { resolveCoworkSkill } from './_lib/resolveCoworkSkill.js'
import { BUNDLE_VERSION } from '../../../src/types/coworkBundle.js'

export const maxDuration = 300

const TOOL_NAME = 'emit_facts'
const TOOL_DESCRIPTION =
  'Emit facts[] — church_fact rows extracted from the source. Each fact has topic + data (the structured payload). ' +
  'Empty facts[] is valid if the source has no facts. Always emit report.notes when something was flagged ' +
  '(PII concerns, ambiguous values, etc.).'

const FACT_TOPICS = [
  'service_time', 'campus', 'ministry', 'staff', 'belief', 'program',
  'milestone', 'contact_method', 'branded_term', 'audience',
  'location_detail', 'partnership', 'testimonial',
] as const

const SOURCE_KINDS = ['intake_doc', 'content_collection'] as const

const TOOL_SCHEMA: ToolSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['facts', 'report'],
  properties: {
    facts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['topic', 'data'],
        properties: {
          topic: { type: 'string', enum: [...FACT_TOPICS] },
          // data is structured per-topic — keep open here, let the
          // SKILL prose teach per-topic shape (and validator
          // enforce in iteration 2).
          data:  { type: 'object', additionalProperties: true },
        },
      },
    },
    report: {
      type: 'object',
      additionalProperties: false,
      required: ['notes'],
      properties: {
        notes:                   { type: 'array', items: { type: 'string', maxLength: 400 } },
        non_publishable_flagged: { type: 'integer', minimum: 0 },
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
  const sourceCsv      = typeof req.body?.source_csv      === 'string' ? req.body.source_csv      : null
  const sourceRecords  = Array.isArray(req.body?.source_records)         ? req.body.source_records : null
  const sourceFilename = typeof req.body?.source_filename === 'string' ? req.body.source_filename : null

  if (!projectId)  return res.status(400).json({ error: 'project_id required' })
  if (!sourceKind) return res.status(400).json({ error: 'source_kind required' })
  if (!sourceRef)  return res.status(400).json({ error: 'source_ref required' })
  if (!(SOURCE_KINDS as readonly string[]).includes(sourceKind)) {
    return res.status(400).json({ error: 'bad_source_kind', detail: `source_kind must be one of ${SOURCE_KINDS.join('|')}` })
  }
  if (!sourceCsv && !sourceRecords) {
    return res.status(400).json({ error: 'source_csv_or_source_records_required' })
  }

  // Routing refusal: source_kind=intake_doc, no CSV extension, no
  // pre-parsed records → it's prose, route to extract-strategic-pillars.
  if (sourceKind === 'intake_doc' && !sourceRecords && sourceCsv && sourceFilename && !/\.csv$/i.test(sourceFilename)) {
    return res.status(409).json({
      error:  'prose_routed_to_pillars',
      detail: `${sourceFilename} doesn't end .csv — facts extractor only handles tabular data. Route to extract-strategic-pillars.`,
    })
  }

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  let resolved: Awaited<ReturnType<typeof resolveCoworkSkill>>
  try {
    resolved = await resolveCoworkSkill(sb, 'parse-facts-csv', projectId)
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'prompt resolve failed' })
  }

  const userMessage = [
    `Parse facts from the source below per the SKILL above.`,
    ``,
    `## Source metadata`,
    '```json',
    JSON.stringify({ project_id: projectId, source_kind: sourceKind, source_ref: sourceRef, source_filename: sourceFilename }, null, 2),
    '```',
    ``,
    sourceCsv ? `## Source CSV` : `## Source records (pre-parsed)`,
    sourceCsv
      ? '```\n' + sourceCsv + '\n```'
      : '```json\n' + JSON.stringify(sourceRecords, null, 2) + '\n```',
    ``,
    `Now call \`${TOOL_NAME}\`. Topics MUST be from the closed enum. Per-topic data shape comes from the SKILL's example bodies. Empty facts[] is valid if the source has no facts.`,
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
      // Facts are short, structured. Even a long CSV (50 staff rows)
      // is ~10k chars of output. 12k cap is generous.
      maxTokens:       12000,
    })
  } catch (e) {
    return mapGatewayError(res, e)
  }

  const args = gatewayResult.args as {
    facts:  Array<{ topic: string; data: Record<string, unknown> }>
    report: { notes: string[]; non_publishable_flagged?: number }
  }

  // Idempotent upsert (same pattern as extract-strategic-pillars):
  // delete DRAFT rows for this source, insert fresh.
  const delRes = await (sb as any)
    .from('church_facts')
    .delete()
    .eq('web_project_id', projectId)
    .eq('source_kind',    sourceKind)
    .eq('source_ref',     sourceRef)
    .eq('status',         'draft')
  if (delRes.error) {
    return res.status(500).json({ error: `delete prior drafts failed: ${delRes.error.message}` })
  }

  const now = new Date().toISOString()
  const rowsToInsert = args.facts.map(f => ({
    web_project_id: projectId,
    topic:          f.topic,
    data:           f.data,
    source_kind:    sourceKind,
    source_ref:     sourceRef,
    status:         'draft',
    created_at:     now,
    updated_at:     now,
  }))

  let insertedIds: string[] = []
  if (rowsToInsert.length > 0) {
    const insRes = await (sb as any)
      .from('church_facts')
      .insert(rowsToInsert)
      .select('id')
    if (insRes.error) {
      return res.status(500).json({ error: `insert facts failed: ${insRes.error.message}` })
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
      skill_name:     'parse-facts-csv',
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
