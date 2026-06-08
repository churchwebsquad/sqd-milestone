/**
 * Vercel Serverless Function — /api/web/agents/page-briefs
 *
 * Cross-page atom allocator. Replaces the legacy page_inventory +
 * outlines stages. Reads Stage 1 (synthesize) + Stage 2 (sitemap) +
 * normalized content_atoms / church_facts, and produces one structured
 * brief per page that the Page Draft agent consumes.
 *
 * The brief gives each Page Draft call exactly what it needs to draft
 * voice-true copy without re-reading the entire intake:
 *   - page_job:        one-sentence purpose for this page
 *   - persona_focus:   primary persona this page serves
 *   - atoms_assigned:  atoms this page is the primary home for
 *   - reference_atoms: atoms hosted elsewhere but referenced/linked
 *   - voice_exemplars_to_imitate:  3-5 exemplars best suited to this page
 *   - voice_anti_exemplars_to_avoid: 3-5 anti-patterns most likely here
 *   - section_targets: rough count + archetypes
 *   - aeo_geo_targets: filtered slice of Stage 1's site-wide targets
 *
 * Output lands in roadmap_state.page_briefs = { [page_slug]: brief }.
 * Direct write only — no separate stage_N container.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { generateText, jsonSchema, tool } from 'ai'
import { resolvePromptServer } from './_lib/resolvePrompt.js'

export const maxDuration = 300
const MODEL = 'anthropic/claude-opus-4-7'
const MAX_OUTPUT_TOKENS = 12000

const TOOL = {
  description: 'Submit cross-page atom allocation as per-page briefs.',
  input_schema: {
    type: 'object',
    required: ['briefs'],
    properties: {
      briefs: {
        type: 'array',
        description: 'One entry per page in the sitemap. Every page in stage_2.sitemap.pages MUST have a brief — no page left without one.',
        items: {
          type: 'object',
          required: ['page_slug','page_job','persona_focus','atoms_assigned','voice_exemplars_to_imitate','voice_anti_exemplars_to_avoid','section_targets'],
          properties: {
            page_slug:  { type: 'string', description: 'The slug from stage_2.sitemap.pages[].slug. Must match exactly.' },
            page_job:   { type: 'string', description: 'One sentence: what this page exists to accomplish for the visitor. E.g. "Move first-time visitors from curiosity to a confirmed Sunday plan."' },
            persona_focus: {
              type: 'object',
              required: ['primary'],
              properties: {
                primary:   { type: 'string', description: 'Persona name from stage_1.personas[]. Pick the one whose need this page is most directly built for.' },
                secondary: { type: ['string','null'], description: 'Optional secondary persona this page also serves.' },
                rationale: { type: 'string', description: 'One sentence on why this persona is primary.' },
              },
            },
            atoms_assigned: {
              type: 'array',
              description: 'Content atoms whose PRIMARY home is this page. Each atom should appear as primary on exactly one page across all briefs.',
              items: {
                type: 'object',
                required: ['atom_id','treatment'],
                properties: {
                  atom_id:   { type: 'string', description: 'content_atoms.id' },
                  treatment: { type: 'string', description: 'How this atom should appear. E.g. "Hero quote", "Featured card", "Accordion item", "Inline paragraph", "Footer footnote".' },
                  rationale: { type: 'string' },
                },
              },
            },
            reference_atoms: {
              type: 'array',
              description: 'Atoms hosted elsewhere but linked/mentioned on this page (e.g. a Sermons CTA referencing the latest sermon atom that lives primarily on the Sermons page).',
              items: {
                type: 'object',
                required: ['atom_id','reason'],
                properties: {
                  atom_id: { type: 'string' },
                  reason:  { type: 'string', description: 'Why this page references this atom. E.g. "Recent-sermon CTA above-the-fold."' },
                },
              },
            },
            voice_exemplars_to_imitate: {
              type: 'array',
              description: '3-5 phrases from stage_1.voice_exemplars best suited to this page. Pull verbatim by phrase. Page Draft will use these as few-shot examples.',
              items: { type: 'string' },
            },
            voice_anti_exemplars_to_avoid: {
              type: 'array',
              description: '3-5 patterns from stage_1.voice_anti_exemplars most likely to surface on a page of this type. Page Draft uses these to filter its own output.',
              items: { type: 'string' },
            },
            section_targets: {
              type: 'object',
              required: ['section_count','archetypes'],
              properties: {
                section_count: { type: 'number', description: 'Rough target. Hero pages typically 5-8 sections. Utility pages 2-3.' },
                archetypes: {
                  type: 'array',
                  description: 'Ordered list of section archetypes for this page. Page Draft writes one section per entry.',
                  items: {
                    type: 'string',
                    enum: [
                      'hero','tagline_band','two_up','three_up','cards_grid',
                      'featured_card','image_text_split','accordion','cta_band',
                      'testimonial_block','stat_block','steps_row','contact_band',
                      'footer_cta','intro_paragraph','rich_body',
                    ],
                  },
                },
              },
            },
            aeo_geo_targets: {
              type: 'object',
              description: 'Filtered slice of stage_1.seo_aeo_geo_targets for this specific page.',
              properties: {
                search_phrases: { type: 'array', items: { type: 'string' } },
                answer_intents: { type: 'array', items: { type: 'string' } },
                geo_anchors:    { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
      coverage_notes: {
        type: 'array',
        description: 'Atoms intentionally NOT assigned to any page (with rationale). Helps the Director catch coverage gaps.',
        items: {
          type: 'object',
          required: ['atom_id','rationale'],
          properties: {
            atom_id:   { type: 'string' },
            rationale: { type: 'string' },
          },
        },
      },
    },
  },
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const anonKey        = process.env.VITE_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const gatewayKey     = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !gatewayKey) {
    return res.status(500).json({ error: 'Missing env vars' })
  }

  const jwt = (req.headers['authorization'] as string | undefined)?.replace(/^Bearer /, '') ?? null
  if (!jwt) return res.status(401).json({ error: 'Missing Authorization bearer token' })
  const { data: userData, error: userErr } = await createClient(supabaseUrl, anonKey).auth.getUser(jwt)
  if (userErr || !userData?.user) return res.status(401).json({ error: 'Invalid session' })

  const projectId   = typeof req.body?.projectId === 'string' ? req.body.projectId : null
  const redoContext = typeof req.body?.redoContext === 'string' ? req.body.redoContext.trim() : ''
  if (!projectId) return res.status(400).json({ error: 'projectId required' })

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  const { data: project } = await sb.from('strategy_web_projects')
    .select('*').eq('id', projectId).maybeSingle()
  if (!project) return res.status(404).json({ error: 'Project not found' })

  const roadmapState = (project.roadmap_state ?? {}) as Record<string, any>
  const stage1 = roadmapState.stage_1
  const stage2 = roadmapState.stage_2
  if (!stage1 || !stage2) {
    return res.status(400).json({ error: 'Stage 1 (synthesize) and Stage 2 (sitemap) must be complete before page-briefs.' })
  }

  const [atomsRes, factsRes] = await Promise.all([
    sb.from('content_atoms')
      .select('id, topic, kind, body, metadata, source, verbatim')
      .eq('web_project_id', projectId).eq('archived', false),
    sb.from('church_facts')
      .select('key, value, source').eq('web_project_id', projectId),
  ])

  const atoms = atomsRes.data ?? []
  const facts = factsRes.data ?? []

  const previous = redoContext ? roadmapState.page_briefs : undefined
  const resolved = await resolvePromptServer(sb, 'page_briefs', projectId)

  const userText = [
    `# Stage 1 (strategy + voice exemplars)`,
    JSON.stringify(stage1, null, 2),
    ``,
    `# Stage 2 (sitemap — pages list is authoritative)`,
    JSON.stringify(stage2, null, 2),
    ``,
    `# Content atoms (${atoms.length})`,
    JSON.stringify(atoms, null, 2),
    ``,
    `# Church facts`,
    JSON.stringify(facts, null, 2),
    previous ? `\n# Previous briefs (refine, don't rewrite)\n${JSON.stringify(previous, null, 2)}` : '',
    redoContext ? `\n# Strategist redo feedback\n${redoContext}` : '',
    ``,
    `Produce one brief per page in stage_2.sitemap.pages. Every page slug must have an entry.`,
  ].filter(Boolean).join('\n')

  let toolResult: Record<string, unknown> | null = null
  let usage: { input_tokens?: number; output_tokens?: number } = {}
  try {
    const result = await generateText({
      model: MODEL,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      system: resolved.systemPrompt,
      messages: [{ role: 'user', content: userText }],
      tools: {
        submit_page_briefs: tool({
          description: TOOL.description,
          inputSchema: jsonSchema(TOOL.input_schema as any),
        }),
      },
      toolChoice: { type: 'tool', toolName: 'submit_page_briefs' },
    })
    usage = { input_tokens: result.usage?.inputTokens, output_tokens: result.usage?.outputTokens }
    const toolCall = result.toolCalls?.[0]
    if (!toolCall || toolCall.toolName !== 'submit_page_briefs') {
      throw new Error('Model did not return the expected tool call')
    }
    toolResult = toolCall.input as Record<string, unknown>
  } catch (err: any) {
    console.error('[page-briefs] gateway error:', err?.message)
    return res.status(502).json({ error: `AI Gateway error: ${err?.message ?? 'unknown'}` })
  }

  const briefsArray = Array.isArray((toolResult as any)?.briefs) ? (toolResult as any).briefs : []
  const byPage: Record<string, unknown> = {}
  for (const b of briefsArray) {
    if (b?.page_slug) byPage[String(b.page_slug)] = b
  }

  const meta = {
    generated_at: new Date().toISOString(),
    model: MODEL,
    prompt_source: resolved.globalSource,
    has_project_addendum: resolved.hasProjectAddendum,
    redo_context: redoContext || null,
    atoms_seen: atoms.length,
    briefs_emitted: briefsArray.length,
    coverage_notes: (toolResult as any)?.coverage_notes ?? [],
    usage,
  }

  const { error: writeErr } = await sb.from('strategy_web_projects')
    .update({
      roadmap_state: {
        ...(project.roadmap_state ?? {}),
        page_briefs: { ...byPage, _meta: meta },
      },
    })
    .eq('id', projectId)
  if (writeErr) return res.status(500).json({ error: `DB write failed: ${writeErr.message}` })

  return res.status(200).json({ ok: true, briefs: byPage, coverage_notes: meta.coverage_notes, usage })
}
