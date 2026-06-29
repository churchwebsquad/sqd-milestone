// LLM verification + fallback pass (v1.6).
//
// Two responsibilities:
//   1. ADVERSARIAL VERIFY: for each rules-classified row with low/medium
//      confidence, ask Claude to refute the classification. If 2-of-3
//      refute, downgrade or null the classification.
//   2. LLM FALLBACK: for rows the rules left unclassified, ask Claude
//      to pick the best canonical schema (or null if none fits).
//
// Designed for offline batch use — runs after the rules-based pass in
// computeFormationPlan. Skips entirely when no ANTHROPIC_API_KEY is
// present, so local dev / CI without secrets still produces a plan
// (just without LLM enrichment).

import Anthropic from '@anthropic-ai/sdk'
import { CANONICAL_SCHEMAS } from './rules'
import type { Confidence, DiscoverySection, InventoryDiscoveryRowType, SchemaName } from './types'

const MODEL = 'claude-haiku-4-5-20251001'
const ADVERSARIAL_VOTES = 3

let _client: Anthropic | null = null
function client(): Anthropic | null {
  if (_client) return _client
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null
  _client = new Anthropic({ apiKey })
  return _client
}

const SCHEMA_VOCAB = (Object.keys(CANONICAL_SCHEMAS) as SchemaName[]).join(' | ')

/** Verify a row's classification by asking the LLM to refute it. Runs
 *  3 independent refute attempts; if ≥2 succeed in refuting, downgrades
 *  the row. Mutates the row in place. Returns the verdict for logging.
 *
 *  Skips rows with confidence='high' (rules were certain — no need to
 *  spend tokens). Skips when ANTHROPIC_API_KEY is unset. */
export async function adversarialVerify(
  row: DiscoverySection | InventoryDiscoveryRowType,
): Promise<{ confirmed: boolean; reason?: string } | null> {
  const cli = client()
  if (!cli) return null
  if (!row.schema_name) return null
  // Don't burn tokens on rules-confident classifications.
  if (row.schema_confidence === 'high') return { confirmed: true }

  const votes = await Promise.all(
    Array.from({ length: ADVERSARIAL_VOTES }, () => refuteOnce(cli, row)),
  )
  const validVotes = votes.filter((v): v is { refuted: boolean; reason?: string } => v !== null)
  if (validVotes.length === 0) return null
  const refutedCount = validVotes.filter(v => v.refuted).length
  const majorityRefutes = refutedCount >= Math.ceil(validVotes.length / 2)

  if (majorityRefutes) {
    // Downgrade: drop to next-lowest confidence, or null if low.
    const oldName = row.schema_name
    const reason = validVotes.find(v => v.refuted)?.reason ?? 'majority refuted'
    if (row.schema_confidence === 'medium') {
      row.schema_confidence = 'low' as Confidence
    } else if (row.schema_confidence === 'low') {
      row.schema_name = null
      row.schema_confidence = 'low' as Confidence
    }
    return { confirmed: false, reason: `${reason} (was ${oldName})` }
  }
  return { confirmed: true }
}

async function refuteOnce(
  cli: Anthropic,
  row: DiscoverySection | InventoryDiscoveryRowType,
): Promise<{ refuted: boolean; reason?: string } | null> {
  const spec = row.schema_name ? CANONICAL_SCHEMAS[row.schema_name] : null
  if (!spec) return null
  const sampleStr = row.sample_record ? JSON.stringify(row.sample_record, null, 2).slice(0, 1200) : '(empty)'
  const otherItems = row.sample_names.slice(0, 5).join(', ')

  const prompt = `You are evaluating whether a content section was correctly classified as the canonical schema "${row.schema_name}".

CANONICAL SCHEMA DEFINITION
- Expected per-item fields: ${spec.canonical_fields.join(', ')}
- Distinguishing fields (at least one should typically be present): ${spec.discriminator_fields.join(', ') || '(none — catch-all)'}

THE SECTION
- Heading: ${row.heading}
- Page slug: ${row.page_slug}
- Item count: ${row.item_count}
- Item names sample: ${otherItems}
- First item:
${sampleStr}

YOUR JOB
Try to REFUTE the classification. Default to refuted=true if uncertain — we want false-positives caught. Only set refuted=false if the section clearly matches the schema.

Respond with a tool call to record_verdict.`

  try {
    const resp = await cli.messages.create({
      model: MODEL,
      max_tokens: 1024,
      tools: [{
        name: 'record_verdict',
        description: 'Record whether the classification is refuted.',
        input_schema: {
          type: 'object',
          properties: {
            refuted: { type: 'boolean', description: 'true if the classification does not match the section content' },
            reason:  { type: 'string',  description: 'one-sentence reason for the verdict' },
          },
          required: ['refuted', 'reason'],
        },
      }],
      tool_choice: { type: 'tool', name: 'record_verdict' },
      messages: [{ role: 'user', content: prompt }],
    })
    const block = resp.content.find(b => b.type === 'tool_use')
    if (block?.type !== 'tool_use') return null
    const input = block.input as { refuted: boolean; reason?: string }
    return { refuted: input.refuted, reason: input.reason }
  } catch (e) {
    console.warn('[llmVerify] refuteOnce error:', (e as Error).message)
    return null
  }
}

/** Fallback classifier: for rows the rules couldn't classify, ask
 *  the LLM to pick the best canonical schema or return null. Mutates
 *  the row in place. */
export async function llmFallbackClassify(
  row: DiscoverySection | InventoryDiscoveryRowType,
): Promise<{ schema_name: SchemaName | null } | null> {
  const cli = client()
  if (!cli) return null
  if (row.schema_name) return { schema_name: row.schema_name }
  if (row.item_count <= 1) return null
  if (!row.sample_record) return null

  const sampleStr = JSON.stringify(row.sample_record, null, 2).slice(0, 1200)
  const otherItems = row.sample_names.slice(0, 5).join(', ')
  const prompt = `Classify this content section into one of the canonical schemas, or return null if none fits.

CANONICAL SCHEMAS: ${SCHEMA_VOCAB}

THE SECTION
- Heading: ${row.heading}
- Page slug: ${row.page_slug}
- Item count: ${row.item_count}
- Item names sample: ${otherItems}
- First item shape:
${sampleStr}

Pick the schema whose shape matches the items. Return null when:
- The section is a copy block / hero / single CTA banner (no schema)
- The items don't fit any canonical shape

Respond with a tool call to record_classification.`

  try {
    const resp = await cli.messages.create({
      model: MODEL,
      max_tokens: 1024,
      tools: [{
        name: 'record_classification',
        description: 'Record the chosen canonical schema or null.',
        input_schema: {
          type: 'object',
          properties: {
            schema_name: {
              type: ['string', 'null'],
              enum: [...(Object.keys(CANONICAL_SCHEMAS) as string[]), null],
              description: 'The canonical schema name, or null if none fits.',
            },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            reason:     { type: 'string', description: 'one-sentence reason' },
          },
          required: ['schema_name', 'confidence', 'reason'],
        },
      }],
      tool_choice: { type: 'tool', name: 'record_classification' },
      messages: [{ role: 'user', content: prompt }],
    })
    const block = resp.content.find(b => b.type === 'tool_use')
    if (block?.type !== 'tool_use') return null
    const input = block.input as { schema_name: SchemaName | null; confidence: Confidence }
    if (input.schema_name) {
      row.schema_name       = input.schema_name
      row.schema_confidence = input.confidence
    }
    return { schema_name: input.schema_name }
  } catch (e) {
    console.warn('[llmVerify] llmFallbackClassify error:', (e as Error).message)
    return null
  }
}

/** Run LLM enrichment over an entire plan in batch. Bounded
 *  concurrency to avoid blowing through rate limits. */
export async function llmEnrichPlan(
  boundRows: DiscoverySection[],
  inventoryRows: InventoryDiscoveryRowType[],
  opts?: { concurrency?: number; verify?: boolean; fallback?: boolean },
): Promise<{ verified: number; fallbackClassified: number; refuted: number }> {
  const cli = client()
  if (!cli) return { verified: 0, fallbackClassified: 0, refuted: 0 }
  const concurrency = opts?.concurrency ?? 4
  const verify      = opts?.verify   ?? true
  const fallback    = opts?.fallback ?? true

  const allRows = [...boundRows, ...inventoryRows]

  // Phase 1: fallback for unclassified.
  let fallbackClassified = 0
  if (fallback) {
    const unclassified = allRows.filter(r => !r.schema_name && r.item_count > 1)
    await runWithConcurrency(unclassified, concurrency, async row => {
      const result = await llmFallbackClassify(row)
      if (result?.schema_name) fallbackClassified++
    })
  }

  // Phase 2: adversarial verify for low/medium confidence (incl.
  // freshly-fallback-classified rows).
  let verified = 0
  let refuted = 0
  if (verify) {
    const toVerify = allRows.filter(r => r.schema_name && r.schema_confidence !== 'high')
    await runWithConcurrency(toVerify, concurrency, async row => {
      const result = await adversarialVerify(row)
      if (result) {
        verified++
        if (!result.confirmed) refuted++
      }
    })
  }

  return { verified, fallbackClassified, refuted }
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items]
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()
      if (item === undefined) break
      await worker(item)
    }
  })
  await Promise.all(workers)
}
