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
    structure: Record<string, unknown>  // boolean+numeric flags: has_tagline, has_image, cta_count, card_group_count, largest_card_group, has_step_group, step_group_size
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

    `=== HARD RULE — ONE HERO PER PAGE ===\n` +
    `A page can have AT MOST ONE template from the Hero Section family. The hero is ` +
    `section[0] (the first section, sort_order 0). EVERY OTHER section on the page MUST ` +
    `pick a non-Hero template — Feature Section, Content Section, CTA Section, Intro ` +
    `Section, etc. Stacking two heroes on a page reads as a layout bug; stacking three ` +
    `is a structural failure. If section[0]'s candidates include a Hero, prefer it. For ` +
    `every other section, if you find yourself reaching for a Hero, you are wrong — pick ` +
    `a CTA/Feature/Content variant instead. A closing-CTA section is NOT a hero; it's a ` +
    `CTA Section. A mid-page positioning band is NOT a hero; it's a Feature Section. ` +
    `Post-pick validation will strip extra Hero picks and force re-pick from non-Hero ` +
    `candidates, so save the round trip.\n\n` +

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

    `DECISION CRITERIA, in priority order:\n\n` +

    `  1. STRUCTURAL FIT — UNDERFILL (HARD REJECT).\n` +
    `       The candidate's structure.* flags MUST be compatible with the section's ` +
    `context.has_*/count fields. Specifically:\n` +
    `         - If context.has_tagline=true, the candidate MUST have structure.has_tagline=true. ` +
    `Picking a no-tagline variant when the brief has a tagline means the tagline becomes ` +
    `overflow — that's a bind failure.\n` +
    `         - If context.cta_count >= 1, the candidate's structure.cta_count should be >= 1. ` +
    `(Greater is OK; less means CTAs become overflow.)\n` +
    `         - If context.step_count >= 2, prefer candidates with structure.has_step_group=true ` +
    `whose structure.step_group_size is close to context.step_count.\n` +
    `         - If context.card_count >= 2, prefer candidates with structure.card_group_count >= 1 ` +
    `whose structure.largest_card_group is close to context.card_count.\n` +
    `         - If context.has_image=true, prefer structure.has_image=true.\n` +
    `       VIOLATIONS ARE A BIG DEAL. A bind that drops a tagline / drops a CTA / drops half ` +
    `the cards forces the strategist to manually paste them in. Always reject those candidates ` +
    `unless absolutely no alternative exists.\n\n` +

    `  2. STRUCTURAL FIT — OVERFILL (HARD REJECT, equally important).\n` +
    `       The candidate's structure.* flags should NOT have prominent slots the content can't ` +
    `fill. An empty video frame, an empty card grid, an empty stat row — these read as a ` +
    `broken layout. Specifically:\n` +
    `         - If context.has_video=false, REJECT candidates with structure.has_video=true ` +
    `unless no other family-appropriate candidate exists. A blank video player slot is visually ` +
    `more broken than a slightly smaller variant.\n` +
    `         - If context.card_count = 0 AND context.step_count = 0, REJECT candidates with ` +
    `structure.card_group_count >= 1. Don't pick a card-grid variant for body-only content — ` +
    `the empty cards stack at the bottom like a 404.\n` +
    `         - If context.has_image=false AND the candidate has structure.has_image=true with ` +
    `a LARGE image slot (image_count >= 1 AND the slot occupies > ~30% of the section visually), ` +
    `prefer a no-image variant. Small icon images are fine; large hero/feature images aren't.\n` +
    `         - If context.cta_count = 0 AND candidate.structure.cta_count >= 2, slight penalty. ` +
    `Two empty CTA pills read worse than zero.\n` +
    `       Concrete example to internalize: Content Section 80 has a prominent video player + ` +
    `4 cards. If the content is description-only with no video and no card structure, ` +
    `Content Section 80 is the WRONG pick even though it satisfies criterion 1 (it has the ` +
    `description slot). Pick a variant from Content / Intro / Feature with just heading + ` +
    `description + optional CTA instead.\n\n` +

    `  3. FAMILY APPROPRIATENESS. Match the section's content to the family's intended role. ` +
    `If the brief says "Banner Sections" but the content has multi-paragraph body + CTA, ` +
    `PICK A NON-BANNER candidate (Feature/Content/CTA). Banner is a scrolling accent, not a ` +
    `body holder. Use is_narrow_use=true as the avoid-for-content flag.\n\n` +

    `  4. SITE LIBRARY PREFERENCE. When TWO candidates BOTH satisfy criteria 1+2+3, prefer ` +
    `is_site_pick=true. Do NOT pick a site library candidate over a structurally-mismatched ` +
    `candidate — structure (both underfill AND overfill) wins first.\n\n` +

    `  5. INFORMATION DENSITY. Match visual weight to prose length. Sparse prose ` +
    `(body_length_chars < 200) → spacious variant without large media frames. Dense content ` +
    `→ tight variant.\n\n` +

    `  6. PAGE BALANCE. Don't pick three identical heavy variants in a row; vary rhythm ` +
    `across the page where the content allows.\n\n` +

    `OVERRIDES: if the brief's suggested_template_family is structurally wrong for the content ` +
    `(e.g. Banner for paragraph content, Card for full sections), prefer a candidate from the ` +
    `content-fallback pool (Feature Section, Content Section, Intro Section, CTA Section). ` +
    `Mention the override in the rationale so the strategist knows the brief's hint was set ` +
    `aside.\n\n` +

    `Return picks via the submit_picks tool. Always include every section_id in the input. ` +
    `Rationale should be one short sentence — what made this variant win. Two things the ` +
    `rationale should ALWAYS surface when relevant: (a) which content shape signals (taglines, ` +
    `CTAs, card_count, etc.) the chosen variant matches, AND (b) any structural slot the ` +
    `variant has that the content WON'T fill, with a brief reason why it's still acceptable ` +
    `(e.g. "small icon image stays decorative when empty" vs "would-be hero video is rejected"). ` +
    `When you override the brief's family hint, say so. When you pick from the site library, ` +
    `say "Site library:".`

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

    // Structural validation: at most one Hero family pick per page.
    // section[0] keeps its Hero pick if it has one; every other
    // section with a Hero pick gets re-routed to a non-Hero candidate.
    // Tracks any forced overrides so the strategist can see what was
    // changed (and re-bind manually if no non-Hero candidate was
    // available).
    const isHero = (familyName: string) =>
      typeof familyName === 'string' && familyName.toLowerCase().startsWith('hero')
    const overrides: Array<{ section_id: string; original_template_id: string; new_template_id: string | null; reason: string }> = []
    let firstHeroSeen = false
    for (let i = 0; i < cleaned.length; i++) {
      const pick = cleaned[i]
      const sec = sections.find(s => s.section_id === pick.section_id)!
      const candidate = sec.candidates.find(c => c.id === pick.template_id)!
      if (!isHero(candidate.family)) continue
      // First Hero pick (regardless of section position) is allowed.
      // We don't enforce "must be section[0]" because some pages
      // legitimately put their hero elsewhere — but at most one.
      if (!firstHeroSeen) { firstHeroSeen = true; continue }
      // Extra hero — re-route to best non-Hero candidate in this
      // section's pool. Preference order: site library > brief family > anything.
      const nonHero = sec.candidates.filter(c => !isHero(c.family))
      const replacement =
        nonHero.find(c => c.is_site_pick)    ??
        nonHero.find(c => c.is_brief_family) ??
        nonHero[0]
      if (!replacement) {
        overrides.push({
          section_id:           pick.section_id,
          original_template_id: pick.template_id,
          new_template_id:      null,
          reason:               'no_non_hero_candidate_available',
        })
        continue
      }
      overrides.push({
        section_id:           pick.section_id,
        original_template_id: pick.template_id,
        new_template_id:      replacement.id,
        reason:               'enforced_one_hero_per_page',
      })
      cleaned[i] = {
        section_id:  pick.section_id,
        template_id: replacement.id,
        rationale:   `[auto] Reassigned from ${candidate.family} to ${replacement.family} — enforcing one-hero-per-page rule. Original model pick was ${pick.template_id} (${candidate.family}); ${replacement.family} chosen from same section's candidate pool.`,
      }
    }

    return res.status(200).json({
      ok: true,
      picks: cleaned,
      overrides,
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
