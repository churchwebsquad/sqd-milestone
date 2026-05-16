/**
 * Vercel Serverless Function — /api/web/agents/suggest-template-variant
 *
 * Ranks candidate Brixies templates against a single brief section.
 * The catalog panel already pre-filters by family + kind; this endpoint
 * picks the *variant* (e.g., Feature Section 21 vs 33 vs 56) based on
 * the brief's content shape, voice, and intent — signals the
 * deterministic ranker on the client can't read.
 *
 * Why a separate endpoint vs running rankVariantsByBrief() client-side:
 * the deterministic scorer reads structure (slot count, group fit). This
 * one reads *content* — the brief's purpose, voice_notes, persona_focus.
 * Two templates with identical structure can still be a better/worse fit
 * for "warm and pastoral" vs "punchy and urgent."
 *
 * Authentication: AI_GATEWAY_API_KEY (local) or VERCEL_OIDC_TOKEN
 * (Vercel deploys), same pattern as the Stage 1/2 agents.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { generateText, jsonSchema, tool } from 'ai'

export const maxDuration = 60

// Routing decision, not deep synthesis — Haiku is fast and cheap, and the
// candidates already share a family so the choice space is small (~5–20
// templates). Opus's depth doesn't pay off here.
const MODEL = 'anthropic/claude-haiku-4-5'
const MAX_OUTPUT_TOKENS = 1500

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  const gatewayKey = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN
  const missing: string[] = []
  if (!supabaseUrl) missing.push('VITE_SUPABASE_URL')
  if (!anonKey) missing.push('VITE_SUPABASE_ANON_KEY')
  if (!gatewayKey) missing.push('AI_GATEWAY_API_KEY (or VERCEL_OIDC_TOKEN on Vercel)')
  if (missing.length) {
    return res.status(500).json({ error: `Missing required environment variables: ${missing.join(', ')}` })
  }

  // ── Auth ────────────────────────────────────────────────────────────
  const authHeader = req.headers['authorization']
  const jwt = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null
  if (!jwt) return res.status(401).json({ error: 'Missing Authorization bearer token' })

  const authClient = createClient(supabaseUrl, anonKey)
  const { data: userData, error: userErr } = await authClient.auth.getUser(jwt)
  if (userErr || !userData?.user) return res.status(401).json({ error: 'Invalid session' })

  // ── Input ───────────────────────────────────────────────────────────
  const briefSection = req.body?.briefSection as Record<string, unknown> | null
  const candidates = req.body?.candidates as Array<{
    id: string
    family: string
    layer_name: string
    kind: string
    fields: Array<{ kind: 'slot' | 'group'; key: string; default_count?: number }>
  }> | null
  const pageContext = typeof req.body?.pageContext === 'string' ? req.body.pageContext : ''

  if (!briefSection || typeof briefSection !== 'object') {
    return res.status(400).json({ error: 'briefSection required' })
  }
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return res.status(400).json({ error: 'candidates (array) required' })
  }
  if (candidates.length > 30) {
    return res.status(400).json({ error: 'candidates max length is 30 — pre-filter on the client' })
  }

  // ── Build prompt ────────────────────────────────────────────────────
  const systemPrompt =
    `You are a Brixies template-routing expert for Church Media Squad's Content Manager. ` +
    `You're given a single section brief and a list of candidate template variants from the same family. ` +
    `Your job: rank the candidates by best fit for this specific brief, considering: ` +
    `(1) slot/group shape vs brief content shape, (2) voice and tone fit, (3) information density.\n\n` +
    `Return a ranked array via the submit_ranking tool. Use the same template IDs as input. ` +
    `For each candidate, give a short rationale (one sentence) explaining the rank.`

  const userContent =
    `Page context:\n${pageContext || '(none)'}\n\n` +
    `Brief section:\n${JSON.stringify(briefSection, null, 2)}\n\n` +
    `Candidate templates (same family):\n${JSON.stringify(candidates, null, 2)}`

  const rankingSchema = {
    type: 'object',
    properties: {
      ranking: {
        type: 'array',
        description: 'Templates ranked best-fit first. Include every candidate id.',
        items: {
          type: 'object',
          properties: {
            template_id: { type: 'string', description: 'The candidate id' },
            rationale: { type: 'string', description: 'One short sentence explaining the rank.' },
          },
          required: ['template_id', 'rationale'],
        },
      },
    },
    required: ['ranking'],
  }

  try {
    const result = await generateText({
      model: MODEL,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
      tools: {
        submit_ranking: tool({
          description: 'Submit the ranked list of candidate templates.',
          inputSchema: jsonSchema(rankingSchema as any),
        }),
      },
      toolChoice: { type: 'tool', toolName: 'submit_ranking' },
    })

    const toolCall = result.toolCalls?.[0]
    if (!toolCall || toolCall.toolName !== 'submit_ranking') {
      throw new Error('Model did not return submit_ranking tool call')
    }
    const raw = toolCall.input as { ranking?: Array<{ template_id: string; rationale: string }> }
    const ranking = Array.isArray(raw.ranking) ? raw.ranking : []

    // Filter to valid ids only (defensive) and de-dupe by template_id.
    const validIds = new Set(candidates.map(c => c.id))
    const seen = new Set<string>()
    const cleaned = ranking
      .filter(r => validIds.has(r.template_id) && !seen.has(r.template_id))
      .map(r => { seen.add(r.template_id); return r })

    // Append any unranked candidates at the end so the response always
    // covers the full set — guards against the model dropping one.
    for (const c of candidates) {
      if (!seen.has(c.id)) cleaned.push({ template_id: c.id, rationale: 'Not ranked by AI.' })
    }

    return res.status(200).json({
      ok: true,
      ranking: cleaned,
      usage: {
        input_tokens: result.usage?.inputTokens,
        output_tokens: result.usage?.outputTokens,
      },
    })
  } catch (err: any) {
    console.error('[suggest-template-variant] gateway error:', err?.message)
    return res.status(502).json({ error: `AI Gateway error: ${err?.message ?? 'unknown'}` })
  }
}
