/**
 * Vercel Serverless Function — /api/web/agents/page-draft
 *
 * One model call per page. Reads the page's brief + Stage 1 voice
 * exemplars + the page's content atoms, and writes section-by-section
 * voice-true copy. Replaces the old outlines + bind + voice_pass
 * sequence with a single embodied draft.
 *
 * Why this exists: the legacy outline→bind→voice_pass chain deferred
 * voice transformation to the end, after structure was locked. By
 * then the model could only paraphrase, not re-imagine. Page Draft
 * does everything at once with the brand voice baked into the system
 * prompt as exemplars (not rules).
 *
 * Output: per-section drafts written to roadmap_state.page_drafts.
 * Each section declares an archetype (hero, two_up, cards_grid, etc.)
 * that the slim bind agent maps to a Brixies template.
 *
 * Input shape:
 *   { projectId, pageSlug, feedback? }
 * - feedback: optional Director directive note for re-drafts.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { generateText, jsonSchema, tool } from 'ai'
import { resolvePromptServer } from './_lib/resolvePrompt.js'

export const maxDuration = 300
const MODEL = 'anthropic/claude-sonnet-4-6'
const MAX_OUTPUT_TOKENS = 8000

const TOOL = {
  description: 'Submit voice-true page draft as a sequence of archetype-tagged sections.',
  input_schema: {
    type: 'object',
    required: ['sections'],
    properties: {
      sections: {
        type: 'array',
        description: 'Ordered list of sections for this page. One entry per section_targets.archetypes[] from the brief, unless you have strong reason to deviate (note the deviation).',
        items: {
          type: 'object',
          required: ['archetype','copy'],
          properties: {
            archetype: {
              type: 'string',
              enum: [
                'hero','tagline_band','two_up','three_up','cards_grid',
                'featured_card','image_text_split','accordion','cta_band',
                'testimonial_block','stat_block','steps_row','contact_band',
                'footer_cta','intro_paragraph','rich_body',
              ],
            },
            copy: {
              type: 'object',
              description: 'Slot-shaped copy for this section. Fill the keys that apply to the archetype. Skip keys that do not apply rather than emitting empty strings.',
              properties: {
                eyebrow:     { type: ['string','null'], description: 'Optional 1-4 word label above the heading. Uppercase tracking style. Leave null when not used.' },
                heading:     { type: ['string','null'], description: 'Section headline. Under 8 words. No question marks. No "X, not Y." parallel-clause shape.' },
                tagline:     { type: ['string','null'], description: 'Short supporting line under the heading.' },
                description: { type: ['string','null'], description: 'Section description / lead paragraph. 1-3 sentences typical.' },
                body:        { type: ['string','null'], description: 'Longer prose body when the archetype supports it (rich_body, intro_paragraph).' },
                cta:         {
                  type: ['object','null'],
                  description: 'Primary call-to-action for this section, when applicable.',
                  properties: {
                    label:    { type: 'string' },
                    intent:   { type: 'string', description: 'What the visitor accomplishes by clicking. E.g. "plan_a_visit", "join_group", "give".' },
                  },
                },
                cards: {
                  type: ['array','null'],
                  description: 'For cards_grid / two_up / three_up archetypes. Each card has heading + description + optional cta.',
                  items: {
                    type: 'object',
                    properties: {
                      heading:     { type: 'string' },
                      description: { type: 'string' },
                      cta_label:   { type: ['string','null'] },
                    },
                  },
                },
                items: {
                  type: ['array','null'],
                  description: 'For accordion / steps_row archetypes. Each item has heading + body.',
                  items: {
                    type: 'object',
                    properties: {
                      heading: { type: 'string' },
                      body:    { type: 'string' },
                    },
                  },
                },
              },
            },
            atoms_used: {
              type: 'array',
              description: 'atom_ids from the brief consumed in this section. Lets the Director verify coverage.',
              items: { type: 'string' },
            },
            voice_notes: {
              type: 'string',
              description: 'Optional one-line note: which voice exemplar shaped this section, or which anti-exemplar you actively avoided. Helps the Director judge voice fit.',
            },
          },
        },
      },
      deviation_note: {
        type: ['string','null'],
        description: 'When the section count/order differs from section_targets.archetypes in the brief, explain why in one sentence. Null when you followed the brief.',
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

  const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : null
  const pageSlug  = typeof req.body?.pageSlug  === 'string' ? req.body.pageSlug  : null
  const feedback  = typeof req.body?.feedback  === 'string' ? req.body.feedback.trim() : ''
  if (!projectId || !pageSlug) {
    return res.status(400).json({ error: 'projectId and pageSlug required' })
  }

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  const { data: project } = await sb.from('strategy_web_projects')
    .select('*').eq('id', projectId).maybeSingle()
  if (!project) return res.status(404).json({ error: 'Project not found' })

  const roadmapState = (project.roadmap_state ?? {}) as Record<string, any>
  const stage1 = roadmapState.stage_1
  const stage2 = roadmapState.stage_2
  const briefs = roadmapState.page_briefs
  const brief = briefs?.[pageSlug]
  if (!stage1 || !stage2 || !brief) {
    return res.status(400).json({ error: 'Synthesize + Sitemap + Page Briefs must all be complete before page-draft.' })
  }

  const atomIds = [
    ...(brief.atoms_assigned ?? []).map((a: any) => a.atom_id).filter(Boolean),
    ...(brief.reference_atoms ?? []).map((a: any) => a.atom_id).filter(Boolean),
  ]
  const { data: atoms } = atomIds.length
    ? await sb.from('content_atoms')
        .select('id, topic, kind, body, metadata, source, verbatim')
        .in('id', atomIds)
    : { data: [] as any[] }

  const previousDraft = roadmapState.page_drafts?.[pageSlug]
  const resolved = await resolvePromptServer(sb, 'page_draft', projectId)

  // Load project snippets so the writer references {{church_name}}
  // and similar tokens instead of literal values. Non-fatal on
  // failure — drafts still produce without snippets, just less
  // normalized.
  let snippets: Array<{ token: string; expansion: string }> = []
  try {
    const { data: sn } = await sb.from('web_project_snippets')
      .select('token, expansion').eq('web_project_id', projectId).eq('archived', false)
    if (Array.isArray(sn)) {
      snippets = sn
        .filter((r: any) => typeof r?.token === 'string' && typeof r?.expansion === 'string' && r.expansion)
        .map((r: any) => ({ token: r.token, expansion: r.expansion }))
    }
  } catch { /* table absence is non-fatal */ }

  const stage1Slim = {
    audience:             stage1.audience,
    voice_characteristics: stage1.voice_characteristics,
    voice_exemplars:      stage1.voice_exemplars,
    voice_anti_exemplars: stage1.voice_anti_exemplars,
    personas:             stage1.personas,
    x_factor:             stage1.x_factor,
  }

  const userText = [
    `# Project voice (full Stage 1 slim)`,
    JSON.stringify(stage1Slim, null, 2),
    ``,
    `# This page's brief`,
    JSON.stringify(brief, null, 2),
    ``,
    `# Atoms available to this page (primary + reference)`,
    JSON.stringify(atoms ?? [], null, 2),
    ``,
    snippets.length > 0
      ? [
          `# Project snippets (use the {{token}} form in your copy where these values appear — don't type the literal)`,
          ...snippets.map(s => `- {{${s.token}}} -> "${s.expansion}"`),
        ].join('\n')
      : '',
    ``,
    previousDraft && !feedback
      ? `# Previous draft exists for this page — overwrite it cleanly with a fresh draft.\n${JSON.stringify(previousDraft.sections ?? [], null, 2)}`
      : '',
    previousDraft && feedback
      ? `# Previous draft to refine\n${JSON.stringify(previousDraft.sections ?? [], null, 2)}`
      : '',
    feedback
      ? `\n# Director feedback (apply targeted changes, preserve what isn't called out)\n${feedback}`
      : '',
    ``,
    `Write the draft for page "${pageSlug}". Submit via submit_page_draft.`,
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
        submit_page_draft: tool({
          description: TOOL.description,
          inputSchema: jsonSchema(TOOL.input_schema as any),
        }),
      },
      toolChoice: { type: 'tool', toolName: 'submit_page_draft' },
    })
    usage = { input_tokens: result.usage?.inputTokens, output_tokens: result.usage?.outputTokens }
    const toolCall = result.toolCalls?.[0]
    if (!toolCall || toolCall.toolName !== 'submit_page_draft') {
      throw new Error('Model did not return the expected tool call')
    }
    toolResult = toolCall.input as Record<string, unknown>
  } catch (err: any) {
    console.error('[page-draft] gateway error:', err?.message)
    return res.status(502).json({ error: `AI Gateway error: ${err?.message ?? 'unknown'}` })
  }

  const sections = Array.isArray((toolResult as any)?.sections) ? (toolResult as any).sections : []
  const validation = validatePageDraft(sections, brief)

  const draft = {
    sections,
    deviation_note: (toolResult as any)?.deviation_note ?? null,
    validation,
    _meta: {
      generated_at: new Date().toISOString(),
      model: MODEL,
      prompt_source: resolved.globalSource,
      has_project_addendum: resolved.hasProjectAddendum,
      feedback: feedback || null,
      redo_count: typeof previousDraft?._meta?.redo_count === 'number'
        ? previousDraft._meta.redo_count + (feedback ? 1 : 0)
        : 0,
      usage,
    },
  }

  const prevPageDrafts = roadmapState.page_drafts ?? {}
  const { error: writeErr } = await sb.from('strategy_web_projects')
    .update({
      roadmap_state: {
        ...roadmapState,
        page_drafts: { ...prevPageDrafts, [pageSlug]: draft },
      },
    })
    .eq('id', projectId)
  if (writeErr) return res.status(500).json({ error: `DB write failed: ${writeErr.message}` })

  return res.status(200).json({ ok: true, draft, validation, usage })
}

// ── Validation — same family of checks the legacy voice-pass uses,
// applied to fresh drafts. Anything that fails surfaces in the
// validation report so the Director can decide whether to re-draft.

const EM_DASH_RE = /—|–|--/g
const PARALLEL_CLAUSE_RE = /^[A-Z]\S*(?:\s\S+){0,2},\s+(not|but|and|yet|or)\s+\S+\.?$/i
const MAX_HEADING_WORDS = 8

function validatePageDraft(sections: any[], brief: any): {
  ok: boolean
  flags: Array<{ section_ix: number; kind: string; field: string; value: string }>
  unused_atoms: string[]
} {
  const flags: Array<{ section_ix: number; kind: string; field: string; value: string }> = []
  const usedAtomIds = new Set<string>()

  sections.forEach((s, ix) => {
    const copy = s?.copy ?? {}
    const heading = String(copy.heading ?? '').trim()
    if (heading) {
      const wc = heading.split(/\s+/).filter(Boolean).length
      if (wc > MAX_HEADING_WORDS) flags.push({ section_ix: ix, kind: 'heading_too_long', field: 'heading', value: heading })
      if (heading.includes('?')) flags.push({ section_ix: ix, kind: 'heading_has_question_mark', field: 'heading', value: heading })
      if (PARALLEL_CLAUSE_RE.test(heading)) flags.push({ section_ix: ix, kind: 'parallel_clause_heading', field: 'heading', value: heading })
    }

    const slotEmDashes: Array<[string, string]> = [
      ['heading', String(copy.heading ?? '')],
      ['tagline', String(copy.tagline ?? '')],
      ['description', String(copy.description ?? '')],
      ['body', String(copy.body ?? '')],
    ]
    for (const [field, val] of slotEmDashes) {
      const count = (val.match(EM_DASH_RE) ?? []).length
      if (count >= 2) flags.push({ section_ix: ix, kind: 'em_dash_overload', field, value: val })
    }

    for (const aid of (s?.atoms_used ?? [])) usedAtomIds.add(String(aid))
  })

  const assignedAtomIds = (brief?.atoms_assigned ?? []).map((a: any) => String(a.atom_id ?? '')).filter(Boolean)
  const unused = assignedAtomIds.filter((aid: string) => !usedAtomIds.has(aid))

  return { ok: flags.length === 0, flags, unused_atoms: unused }
}
