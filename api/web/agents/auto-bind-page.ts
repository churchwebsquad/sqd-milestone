/**
 * Vercel Serverless Function — /api/web/agents/auto-bind-page
 *
 * One AI call per page that picks the best Brixies template variant
 * for every section in the brief. Returns `{ section_id → template_id }`
 * with rationale per section.
 *
 * Inputs include the full brief, the project's curated library (so
 * the model prefers site-specific picks), and pre-filtered candidate
 * templates per section. The model sees the whole page at once so it
 * can balance choices across sections (don't pick two card-heavy
 * variants in a row, etc.).
 *
 * Model: Claude Haiku 4.5 — routing decisions are fast/cheap and the
 * candidate spaces (~5-50 per family) are small enough that depth
 * doesn't pay off. The client-side deterministic ranker remains the
 * fallback when this endpoint fails.
 *
 * Authentication: AI_GATEWAY_API_KEY (local) or VERCEL_OIDC_TOKEN
 * (Vercel deploys), same pattern as the other agents.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { generateText, jsonSchema, tool } from 'ai'

export const maxDuration = 120

const MODEL = 'anthropic/claude-haiku-4-5'
const MAX_OUTPUT_TOKENS = 6000

interface SectionInput {
  /** Brief section id — round-tripped back in the response. */
  section_id: string
  /** Family hint from the brief (e.g. "Hero Section", "Feature Section").
   *  Treat as a HINT, not a constraint — the candidate pool intentionally
   *  includes templates from other families so the AI can override a
   *  misclassified hint. */
  brief_suggested_family: string
  /** Slim brief context — heading, prose summary, structure flags. */
  context: Record<string, unknown>
  /** Pre-filtered candidate templates for this section. Includes:
   *    - Project's curated-library picks (is_site_pick=true)
   *    - Brief's suggested family (is_brief_family=true)
   *    - Content fallback families (Feature/Content/Intro/CTA) so the
   *      AI can override when the brief's family is wrong for the
   *      content shape. */
  candidates: Array<{
    id: string
    family: string
    family_usage: string    // role description for this family
    layer_name: string
    kind: string
    fields_summary: string  // human-readable shape, e.g. "tagline + heading + 4-card grid + 2 CTAs"
    is_site_pick: boolean   // bound in the project's curated library
    is_brief_family: boolean // matches the brief's suggested_family
    is_narrow_use: boolean   // narrow-use family — only pick if content matches role
  }>
}

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
  const pageContext = typeof req.body?.pageContext === 'string' ? req.body.pageContext : ''
  const sections = req.body?.sections as SectionInput[] | undefined

  if (!Array.isArray(sections) || sections.length === 0) {
    return res.status(400).json({ error: 'sections (non-empty array) required' })
  }
  // Cap to keep the prompt small.
  if (sections.length > 30) {
    return res.status(400).json({ error: 'Max 30 sections per request' })
  }
  for (const s of sections) {
    if (!s.section_id || !Array.isArray(s.candidates) || s.candidates.length === 0) {
      return res.status(400).json({
        error: `Section ${s.section_id} missing required fields or has no candidates`,
      })
    }
  }

  // ── Build prompt ────────────────────────────────────────────────────
  const systemPrompt =
    `You are a Brixies template-routing expert for Church Media Squad's Content Manager. ` +
    `You're given a page brief with multiple sections and a list of candidate Brixies template variants for each section. ` +
    `Your job: pick the single best-fit template id for every section.\n\n` +

    `EACH CANDIDATE HAS METADATA YOU MUST CONSIDER:\n` +
    `  - family_usage: what this Brixies family is actually used for. This is authoritative — ` +
    `the brief's suggested_template_family is just a hint and is sometimes wrong.\n` +
    `  - is_brief_family: candidate matches the brief's family hint.\n` +
    `  - is_site_pick: candidate is in the project's curated Brixies library (Global Elements).\n` +
    `  - is_narrow_use: this family has a SPECIFIC narrow role (Banner = scrolling marquee, ` +
    `Footer/Header/Megamenu = chrome, Filter = functional). Do NOT pick narrow-use ` +
    `templates for ordinary content sections, even if the brief's suggested_template_family ` +
    `points at them.\n` +
    `  - fields_summary: structural shape (slots + groups + default item counts).\n\n` +

    `DECISION CRITERIA, in priority order:\n` +
    `  1. FAMILY APPROPRIATENESS (highest priority). Match the section's content to the ` +
    `family's intended role. If the brief says "Banner Sections" but the content has ` +
    `multi-paragraph body + CTA, PICK A NON-BANNER candidate (Feature/Content/CTA). ` +
    `Banner is a scrolling accent, not a body holder.\n` +
    `  2. Site library preference — when a candidate is BOTH is_site_pick=true AND its ` +
    `family is appropriate for the content, prefer it.\n` +
    `  3. Content-shape fit — does the variant's slot/group shape match the brief's ` +
    `content? A text-only section needs a no-cards variant. A 4-step process needs a ` +
    `4-step variant. A section with 1 CTA fits a 1-button variant best.\n` +
    `  4. Information density — match the variant's visual weight to content density. ` +
    `Sparse prose → spacious variant. Multi-card content → card-grid variant.\n` +
    `  5. Page balance — don't pick three identical heavy variants in a row; vary ` +
    `rhythm across the page where the content allows.\n\n` +

    `OVERRIDES: if the brief's suggested_template_family is structurally wrong for ` +
    `the content (e.g. Banner for paragraph content, Card for full sections), prefer a ` +
    `candidate from the content-fallback pool (Feature Section, Content Section, Intro ` +
    `Section, CTA Section). Mention the override in the rationale so the strategist ` +
    `knows the brief's hint was set aside.\n\n` +

    `Return picks via the submit_picks tool. Always include every section_id in the input. ` +
    `Rationale should be one short sentence — what made this variant win.`

  const userContent =
    `Page context:\n${pageContext || '(none)'}\n\n` +
    `Sections (in order):\n${JSON.stringify(sections, null, 2)}`

  const picksSchema = {
    type: 'object',
    properties: {
      picks: {
        type: 'array',
        description: 'One pick per section. Include every section_id in the input.',
        items: {
          type: 'object',
          properties: {
            section_id: { type: 'string' },
            template_id: { type: 'string', description: 'Must be a candidate id from the input.' },
            rationale:   { type: 'string', description: 'One short sentence — what made this variant win.' },
          },
          required: ['section_id', 'template_id', 'rationale'],
        },
      },
    },
    required: ['picks'],
  }

  try {
    const result = await generateText({
      model: MODEL,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
      tools: {
        submit_picks: tool({
          description: 'Submit one template pick per section.',
          inputSchema: jsonSchema(picksSchema as any),
        }),
      },
      toolChoice: { type: 'tool', toolName: 'submit_picks' },
    })

    const toolCall = result.toolCalls?.[0]
    if (!toolCall || toolCall.toolName !== 'submit_picks') {
      throw new Error('Model did not return submit_picks tool call')
    }
    const raw = toolCall.input as {
      picks?: Array<{ section_id: string; template_id: string; rationale: string }>
    }
    const picks = Array.isArray(raw.picks) ? raw.picks : []

    // Defensive validation — drop picks with unknown section ids or
    // template_ids not in that section's candidate list.
    const cleaned: Array<{ section_id: string; template_id: string; rationale: string }> = []
    for (const pick of picks) {
      const sec = sections.find(s => s.section_id === pick.section_id)
      if (!sec) continue
      const candidate = sec.candidates.find(c => c.id === pick.template_id)
      if (!candidate) continue
      cleaned.push(pick)
    }

    return res.status(200).json({
      ok: true,
      picks: cleaned,
      usage: {
        input_tokens: result.usage?.inputTokens,
        output_tokens: result.usage?.outputTokens,
      },
    })
  } catch (err: any) {
    console.error('[auto-bind-page] gateway error:', err?.message)
    return res.status(502).json({ error: `AI Gateway error: ${err?.message ?? 'unknown'}` })
  }
}
