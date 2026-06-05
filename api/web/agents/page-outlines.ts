/**
 * Vercel Serverless Function — /api/web/agents/page-outlines
 *
 * Stage 4 of the copywriting pipeline. Per page in stage_2 sitemap,
 * drafts plain-prose section outlines + display option suggestions
 * using stage_3 atom placements. PRE-binding — no Brixies awareness.
 * Writes to roadmap_state.stage_4.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { generateText, jsonSchema, tool } from 'ai'
import { resolvePromptServer } from './_lib/resolvePrompt.js'

export const maxDuration = 300
const MODEL = 'anthropic/claude-opus-4-7'
const MAX_OUTPUT_TOKENS = 12000

const DISPLAY_OPTIONS = [
  'card_grid','split_column','accordion','tabs','timeline',
  'cta_hero','feature_strip','staff_grid','gallery','rich_text_long','process_steps',
]

// CTA intent — what the visitor is being asked to do. The button-or-
// not decision belongs to Stage 5 (some templates have button slots,
// some don't); Stage 4 commits to whether the section needs a CTA at
// all + what the action should be.
const CTA_INTENTS = [
  'visit',           // plan an in-person visit
  'attend',          // join a specific event/service
  'contact',         // talk to a person
  'give',            // donation
  'subscribe',       // newsletter / email
  'signup',          // small group / volunteer signup
  'watch',           // watch sermon / video
  'read',            // read further content / blog
  'navigate',        // go to a related hub page
  'other',
]

const TOOL = {
  description: 'Submit page outlines with display options and section contracts for every page.',
  input_schema: {
    type: 'object',
    properties: {
      page_outlines: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            page_slug: { type: 'string' },
            /** Stage 1 persona label this page is primarily designed to
             *  serve. Pages may serve secondary personas in individual
             *  sections — those go in section.serves_personas. */
            primary_persona: { type: ['string','null'] },
            /** Per-page SEO/AEO/GEO bundle pulled from Stage 1's
             *  seo_aeo_geo_targets and refined for this page. Stage 5's
             *  page_seo writes title/meta_description directly from
             *  this; the rest distributes down to section.keyword_assignments. */
            page_seo_targets: {
              type: ['object','null'],
              properties: {
                search_phrases: { type: 'array', items: { type: 'string' },
                  description: 'SEO — phrases users would type into Google for this page.' },
                answer_intents: { type: 'array', items: { type: 'string' },
                  description: 'AEO — conversational queries this page should answer (e.g. "what time is church", "is X church welcoming").' },
                geo_anchors:    { type: 'array', items: { type: 'string' },
                  description: 'GEO — local landmarks, neighborhoods, city/region references this page should mention.' },
                title_target:   { type: ['string','null'],
                  description: 'Suggested <title> tag — keyword-led, under 60 chars. Stage 5 writes this verbatim into page_seo.title.' },
                meta_description_target: { type: ['string','null'],
                  description: 'Suggested meta description — under 160 chars. Stage 5 writes verbatim into page_seo.meta_description.' },
              },
            },
            sections: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  section_id:      { type: 'string' },
                  section_job:     { type: 'string',
                    description: 'One sentence: what this section accomplishes for the visitor.' },
                  content_summary: { type: 'string',
                    description: 'Plain prose. Lead with "Heading: <3-7 word phrase>. Body: <prose>." so Stage 5 knows what goes where.' },

                  // ── Section contract — the "what must be said" half ──
                  /** Persona labels (from Stage 1) this section addresses.
                   *  An array because some sections serve multiple personas
                   *  at once (e.g. a Beliefs section serving both newcomers
                   *  and skeptics). Empty = serves whoever the page serves. */
                  serves_personas: { type: 'array', items: { type: 'string' } },
                  /** Stage 1 strategy goal this section advances. Freeform
                   *  text referencing one of stage_1.goals (or the broader
                   *  brand objective when no single goal applies). */
                  addresses_goal: { type: ['string','null'] },
                  /** 1-3 concrete claims that MUST appear in the copy.
                   *  Stage 5 may paraphrase but cannot drop. Stage 7
                   *  voice pass also cannot rewrite these away. Example:
                   *  ["Service times are Sundays 9am + 11am",
                   *   "Childcare is provided through 5th grade",
                   *   "Coffee is served before each service"]. */
                  required_messages: { type: 'array', items: { type: 'string' } },
                  /** When the section's job is to drive a visitor action,
                   *  declare the CTA here. Stage 5 will look for a button
                   *  slot in the chosen template and wire this label +
                   *  destination. Null when no CTA belongs here (e.g.
                   *  staff bios, photo galleries, content-only sections). */
                  cta: {
                    type: ['object','null'],
                    properties: {
                      intent:           { type: 'string', enum: CTA_INTENTS },
                      label:            { type: 'string',
                        description: 'Button label — short and scannable. Must use any vocabulary_decisions.we_chose values from Stage 2.' },
                      destination_page: { type: 'string',
                        description: 'Slug from Stage 2 sitemap (e.g. "/visit" or "/visit#service-times"). Must resolve to a real page.' },
                    },
                    required: ['intent','label','destination_page'],
                  },
                  /** Which Stage 1 SEO/AEO/GEO phrases this section owns.
                   *  primary[] must appear in the section's heading slot
                   *  OR the first sentence of body/description. supporting[]
                   *  appears naturally in body copy. Distribute Stage 1's
                   *  phrases across the page — don't repeat the same phrase
                   *  in multiple sections of the same page. */
                  keyword_assignments: {
                    type: ['object','null'],
                    properties: {
                      primary:    { type: 'array', items: { type: 'string' } },
                      supporting: { type: 'array', items: { type: 'string' } },
                    },
                  },
                  // ── End contract ──

                  display_options: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        kind:       { type: 'string', enum: DISPLAY_OPTIONS },
                        rationale:  { type: 'string' },
                        fits_count: { type: 'number' },
                      },
                      required: ['kind','rationale'],
                    },
                  },
                  atoms_used:  { type: 'array', items: { type: 'string' } },
                  voice_notes: { type: ['string','null'] },
                },
                required: [
                  'section_id','section_job','content_summary','display_options','atoms_used',
                  'serves_personas','required_messages',
                ],
              },
            },
            voice_notes: { type: ['string','null'] },
          },
          required: ['page_slug','sections'],
        },
      },
    },
    required: ['page_outlines'],
  },
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl     = process.env.VITE_SUPABASE_URL
  const anonKey         = process.env.VITE_SUPABASE_ANON_KEY
  const serviceRoleKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
  const gatewayKey      = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !gatewayKey) {
    return res.status(500).json({ error: 'Missing env vars' })
  }

  const jwt = (req.headers['authorization'] as string | undefined)?.replace(/^Bearer /, '') ?? null
  if (!jwt) return res.status(401).json({ error: 'Missing Authorization bearer token' })

  const { data: userData, error: userErr } = await createClient(supabaseUrl, anonKey).auth.getUser(jwt)
  if (userErr || !userData?.user) return res.status(401).json({ error: 'Invalid session' })

  const projectId   = typeof req.body?.projectId === 'string' ? req.body.projectId : null
  const redoContext = typeof req.body?.redoContext === 'string' ? req.body.redoContext.trim() : ''
  /** Optional scope: when present, the agent processes ONLY these
   *  page slugs and merges results into roadmap_state.stage_4.page_outlines —
   *  the other pages' outlines are preserved verbatim. Use for
   *  iterative testing on a single page without re-burning the whole
   *  17-page sitemap each pass. */
  const pageSlugs: string[] | null = Array.isArray(req.body?.pageSlugs) && req.body.pageSlugs.every((s: unknown) => typeof s === 'string')
    ? req.body.pageSlugs as string[]
    : null
  if (!projectId) return res.status(400).json({ error: 'projectId required' })

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  const { data: project, error: projErr } = await sb
    .from('strategy_web_projects').select('*').eq('id', projectId).maybeSingle()
  if (projErr || !project) return res.status(404).json({ error: projErr?.message ?? 'Project not found' })

  const roadmapState = (project.roadmap_state ?? {}) as Record<string, unknown>
  const stage1 = roadmapState.stage_1
  const stage2 = roadmapState.stage_2
  const stage3 = roadmapState.stage_3
  if (!stage1 || !stage2 || !stage3) {
    return res.status(400).json({
      error: 'Stages 1, 2, 3 must be complete before Stage 4 can run.',
      missing: [!stage1 && 'stage_1', !stage2 && 'stage_2', !stage3 && 'stage_3'].filter(Boolean),
    })
  }

  const [atomsRes, factsRes] = await Promise.all([
    sb.from('content_atoms').select('id, topic, body').eq('web_project_id', projectId),
    sb.from('church_facts').select('id, topic, data').eq('web_project_id', projectId),
  ])

  const previous = redoContext || pageSlugs ? roadmapState.stage_4 : undefined
  const resolved = await resolvePromptServer(sb, 'outlines', projectId)

  // Scope filter — when present, narrow Stage 2's page list + Stage 3
  // placements to just the targeted pages. The model then emits
  // outlines only for those pages, and we merge with the existing
  // roadmap_state.stage_4.page_outlines preserving the rest.
  let scopedStage2 = stage2
  let scopedStage3 = stage3
  if (pageSlugs && pageSlugs.length > 0) {
    const stage2Pages = ((stage2 as any)?.pages ?? []) as Array<{ slug?: string }>
    const filteredPages = stage2Pages.filter(p => pageSlugs.includes(p.slug ?? ''))
    scopedStage2 = { ...(stage2 as any), pages: filteredPages }
    const stage3Placements = ((stage3 as any)?.atom_placements ?? []) as Array<{ primary_page_slug?: string }>
    const stage3Facts = ((stage3 as any)?.fact_placements ?? []) as Array<{ primary_page_slug?: string }>
    scopedStage3 = {
      ...(stage3 as any),
      atom_placements: stage3Placements.filter(a => pageSlugs.includes(a.primary_page_slug ?? '')),
      fact_placements: stage3Facts.filter(f => pageSlugs.includes(f.primary_page_slug ?? '')),
    }
  }

  const scopeInstruction = pageSlugs && pageSlugs.length > 0
    ? `# Scope — IMPORTANT\nEmit page_outlines ONLY for these page slugs: ${pageSlugs.join(', ')}. Do not emit outlines for any other page. The other pages' outlines already exist and will be preserved untouched.`
    : ''

  const userText = [
    `# Stage 1 strategy\n${JSON.stringify(stage1, null, 2)}`,
    `# Stage 2 sitemap${pageSlugs ? ' (filtered to scope)' : ''}\n${JSON.stringify(scopedStage2, null, 2)}`,
    `# Stage 3 page inventory (atom placements)\n${JSON.stringify(scopedStage3, null, 2)}`,
    `# Atoms\n${JSON.stringify(atomsRes.data ?? [], null, 2)}`,
    `# Facts\n${JSON.stringify(factsRes.data ?? [], null, 2)}`,
    scopeInstruction,
    previous && `# Previous draft\n${JSON.stringify(previous, null, 2)}`,
    redoContext && `# Strategist redo feedback\n${redoContext}`,
  ].filter(Boolean).join('\n\n')

  let toolResult: Record<string, unknown> | null = null
  let usage: { input_tokens?: number; output_tokens?: number } = {}
  try {
    const result = await generateText({
      model: MODEL,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      system: resolved.systemPrompt,
      messages: [{ role: 'user', content: userText }],
      tools: {
        submit_page_outlines: tool({
          description: TOOL.description,
          inputSchema: jsonSchema(TOOL.input_schema as any),
        }),
      },
      toolChoice: { type: 'tool', toolName: 'submit_page_outlines' },
    })
    usage = { input_tokens: result.usage?.inputTokens, output_tokens: result.usage?.outputTokens }
    const toolCall = result.toolCalls?.[0]
    if (!toolCall || toolCall.toolName !== 'submit_page_outlines') {
      throw new Error('Model did not return the expected tool call')
    }
    toolResult = toolCall.input as Record<string, unknown>
  } catch (err: any) {
    console.error('[page-outlines] gateway error:', err?.message)
    return res.status(502).json({ error: `AI Gateway error: ${err?.message ?? 'unknown'}` })
  }

  const meta = {
    status: 'draft',
    generated_at: new Date().toISOString(),
    model: MODEL,
    prompt_source: resolved.globalSource,
    has_project_addendum: resolved.hasProjectAddendum,
    scoped_to_page_slugs: pageSlugs ?? null,
    redo_count: typeof (previous as any)?._meta?.redo_count === 'number'
      ? (previous as any)._meta.redo_count + (redoContext ? 1 : 0)
      : 0,
    usage,
  }

  // Merge mode when scoped: keep existing outlines for pages NOT in
  // pageSlugs, and replace the targeted pages with the new output.
  // Stops the strategist from losing 16 other page outlines when
  // testing one.
  let mergedOutlines: any[] = []
  if (pageSlugs && pageSlugs.length > 0) {
    const existingOutlines = ((previous as any)?.page_outlines ?? []) as Array<{ page_slug?: string }>
    const newOutlines = ((toolResult as any)?.page_outlines ?? []) as Array<{ page_slug?: string }>
    const newSlugs = new Set(newOutlines.map(o => o.page_slug))
    mergedOutlines = [
      ...existingOutlines.filter(o => !newSlugs.has(o.page_slug)),
      ...newOutlines,
    ]
  } else {
    mergedOutlines = ((toolResult as any)?.page_outlines ?? [])
  }

  const stage4Write = {
    ...toolResult,
    page_outlines: mergedOutlines,
    _meta: meta,
  }

  const { error: writeErr } = await sb.from('strategy_web_projects')
    .update({
      roadmap_state: { ...(project.roadmap_state ?? {}), stage_4: stage4Write },
    })
    .eq('id', projectId)
  if (writeErr) return res.status(500).json({ error: `DB write failed: ${writeErr.message}` })

  return res.status(200).json({ ok: true, output: stage4Write, usage })
}
