/**
 * Vercel Serverless Function — /api/web/agents/reorg-section-for-template
 *
 * The Gate 2 "AI organize content for new Brixies template" step. When
 * the strategist swaps a section's template at Gate 2, the new
 * template's slot shape may not match the section's current copy
 * shape — e.g. the section was a hero (heading + description + cta)
 * and the new template is a cards_grid (heading + 4 cards each with
 * heading + description + cta_label). The deterministic field mapper
 * can carry heading + description but doesn't know how to split a
 * single description into N cards.
 *
 * This agent reads the section's current copy + the brief + the
 * target template's field schema, and redistributes the copy into
 * the new shape. Flags content that didn't fit so the strategist
 * sees what dropped.
 *
 * Writes the new copy back to roadmap_state.page_drafts[slug].sections
 * [sectionIx] — and also flips the section's archetype to match the
 * new template family so downstream tooling stays consistent.
 *
 * No effect on web_sections — that's the Commit step's job.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { generateText, jsonSchema, tool } from 'ai'
import { loadSnippetsForAgent } from './_lib/loadSnippets.js'

export const maxDuration = 60

const MODEL = 'anthropic/claude-sonnet-4-6'
const MAX_OUTPUT_TOKENS = 4000

const REORG_TOOL = {
  description: 'Submit the reorganized section copy in the new template\'s slot shape.',
  input_schema: {
    type: 'object',
    required: ['new_archetype', 'new_copy', 'rationale'],
    properties: {
      new_archetype: {
        type: 'string',
        enum: [
          'hero','tagline_band','two_up','three_up','cards_grid',
          'featured_card','image_text_split','accordion','cta_band',
          'testimonial_block','stat_block','steps_row','contact_band',
          'footer_cta','intro_paragraph','rich_body',
        ],
        description: 'Pick the archetype that best matches the new template\'s field shape. The Page Draft tooling reads this to render the section correctly.',
      },
      new_copy: {
        type: 'object',
        description: 'The redistributed copy. Match the new template\'s slot schema as closely as you can — cards[] for card grids, items[] for accordions/steps/stats, plain heading/description for hero-shaped templates. Skip slots that don\'t exist in the new template rather than emitting empty strings.',
        properties: {
          eyebrow:     { type: ['string','null'] },
          heading:     { type: ['string','null'] },
          tagline:     { type: ['string','null'] },
          description: { type: ['string','null'] },
          body:        { type: ['string','null'] },
          cta:         { type: ['object','null'] },
          cards:       { type: 'array', items: { type: 'object' } },
          items:       { type: 'array', items: { type: 'object' } },
        },
      },
      dropped_content: {
        type: 'array',
        description: 'Verbatim chunks of the old copy that didn\'t fit the new shape. Strategist sees these as warnings so nothing disappears silently.',
        items: { type: 'string' },
      },
      rationale: {
        type: 'string',
        description: 'One sentence: how you mapped the old copy into the new shape and why anything dropped (if it did).',
      },
    },
  },
}

const SYSTEM_PROMPT = [
  'You restructure ONE section\'s copy from its current archetype shape to a new Brixies template\'s slot shape. Strict scope: ONE section, no cross-section changes.',
  '',
  'Inputs you receive in the user message:',
  '- The section\'s CURRENT copy (heading, description, cards, items, cta, etc.)',
  '- The page\'s brief (persona, voice exemplars, atoms)',
  '- The TARGET Brixies template\'s field schema (which slots it has, including arrays like cards[] / items[])',
  '- A strategist instruction (optional — only present when the user explicitly typed one)',
  '',
  'Rules:',
  '- The new_copy you submit MUST fit the target template\'s field schema. If the new template has cards[3] but no description slot, distribute the description across the cards. If the new template is hero-shaped (single heading + description) and the source had cards, condense the best card content into the description.',
  '- Pick the new_archetype that names the shape you produced. The Page Draft tooling reads this to render the section correctly — be honest about what shape you ended up with.',
  '- Preserve voice. Use the brief\'s voice_exemplars_to_imitate as your shape anchor, even if the source copy was off-voice. Avoid em-dashes; use periods or commas.',
  '- Use {{token}} form for any value that maps to a project snippet (church_name, address, etc.) when the user message includes a snippets list. Don\'t type literals.',
  '- If you can\'t fit a chunk of the original copy into the new shape, surface it verbatim in dropped_content[]. Don\'t paraphrase or shorten — the strategist needs to see what was lost so they can decide whether to redistribute elsewhere or accept the drop.',
  '- Skip slots that don\'t exist in the new template rather than emitting empty strings. Empty placeholders confuse downstream binders.',
].join('\n')

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

  const projectId  = typeof req.body?.projectId  === 'string' ? req.body.projectId  : null
  const pageSlug   = typeof req.body?.pageSlug   === 'string' ? req.body.pageSlug   : null
  const sectionIx  = typeof req.body?.sectionIx  === 'number' ? req.body.sectionIx  : null
  const templateId = typeof req.body?.templateId === 'string' ? req.body.templateId.trim() : null
  const instruction = typeof req.body?.instruction === 'string' ? req.body.instruction.trim() : ''
  if (!projectId || !pageSlug || sectionIx === null || !templateId) {
    return res.status(400).json({ error: 'projectId, pageSlug, sectionIx, templateId required' })
  }

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  // Load the draft section + brief + target template schema in parallel.
  const [{ data: project }, { data: template }] = await Promise.all([
    sb.from('strategy_web_projects').select('id, roadmap_state').eq('id', projectId).maybeSingle(),
    sb.from('web_content_templates').select('id, layer_name, family, fields').eq('id', templateId).maybeSingle(),
  ])
  if (!project) return res.status(404).json({ error: 'Project not found' })
  if (!template) return res.status(404).json({ error: `Template "${templateId}" not found` })

  const state = (project.roadmap_state ?? {}) as Record<string, any>
  const draft = (state.page_drafts ?? {})[pageSlug] as { sections?: any[]; _meta?: any } | undefined
  const sections = Array.isArray(draft?.sections) ? draft.sections : []
  const section  = sections[sectionIx]
  if (!section) return res.status(404).json({ error: `No section at index ${sectionIx} on page "${pageSlug}"` })

  const brief = (state.page_briefs ?? {})[pageSlug]

  // Snippets — 16 global merge fields + custom snippets table. Same
  // shared loader as page-draft + slot-edit.
  const snippets = await loadSnippetsForAgent(sb, projectId)

  // Slim the template fields for the prompt — keep only what the
  // model needs to understand the slot shape (key + kind + label).
  // The fields blob can be large; we don't need every nested detail.
  const slimFields = (Array.isArray(template.fields) ? template.fields : []).map((f: any) => ({
    key:        f?.key,
    kind:       f?.kind,
    label:      f?.label,
    item_schema: Array.isArray(f?.item_schema)
      ? f.item_schema.map((it: any) => ({ key: it?.key, kind: it?.kind, label: it?.label }))
      : undefined,
  }))

  const briefSlim = brief ? {
    page_job:                  (brief as any).page_job,
    persona_focus:             (brief as any).persona_focus,
    voice_exemplars_to_imitate: (brief as any).voice_exemplars_to_imitate,
    voice_anti_exemplars_to_avoid: (brief as any).voice_anti_exemplars_to_avoid,
  } : null

  const userText = [
    `# Current section copy (page="${pageSlug}", section_ix=${sectionIx})`,
    `Current archetype: ${section.archetype ?? '—'}`,
    '```json',
    JSON.stringify({ archetype: section.archetype, copy: section.copy ?? {} }, null, 2),
    '```',
    '',
    briefSlim && '# Page brief',
    briefSlim && '```json',
    briefSlim && JSON.stringify(briefSlim, null, 2),
    briefSlim && '```',
    '',
    `# Target template: ${template.layer_name} (family: ${template.family})`,
    'Field schema (the new slot shape):',
    '```json',
    JSON.stringify(slimFields, null, 2),
    '```',
    '',
    snippets.length > 0 && [
      '# Available snippets (use {{token}} form for these values)',
      ...snippets.map(s => `- {{${s.token}}} -> "${s.expansion}"`),
    ].join('\n'),
    '',
    instruction
      ? `# Strategist instruction\n${instruction}`
      : '# Strategist instruction\n(none — restructure straightforwardly to fit the new template\'s shape)',
    '',
    'Restructure the copy. Submit via submit_section_reorg.',
  ].filter(Boolean).join('\n')

  let toolInput: {
    new_archetype: string
    new_copy: Record<string, unknown>
    dropped_content?: string[]
    rationale: string
  } | null = null
  let usage: { input_tokens?: number; output_tokens?: number } = {}
  try {
    const result = await generateText({
      model: MODEL,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userText }],
      tools: {
        submit_section_reorg: tool({
          description: REORG_TOOL.description,
          inputSchema: jsonSchema(REORG_TOOL.input_schema as any),
        }),
      },
      toolChoice: { type: 'tool', toolName: 'submit_section_reorg' },
    })
    usage = { input_tokens: result.usage?.inputTokens, output_tokens: result.usage?.outputTokens }
    const toolCall = result.toolCalls?.[0]
    if (!toolCall || toolCall.toolName !== 'submit_section_reorg') {
      throw new Error('Model did not return the expected tool call')
    }
    toolInput = toolCall.input as typeof toolInput
  } catch (err: any) {
    console.error('[reorg-section-for-template] gateway error:', err?.message)
    return res.status(502).json({ error: `AI Gateway error: ${err?.message ?? 'unknown'}` })
  }

  if (!toolInput) return res.status(502).json({ error: 'Empty reorg result' })

  // Write the new copy back into the draft. Stamp section._meta with
  // the reorg history (target template, dropped content, rationale)
  // so the strategist can audit later.
  const nextSections = [...sections]
  const nextSection = {
    ...section,
    archetype: toolInput.new_archetype,
    copy: toolInput.new_copy,
    _meta: {
      ...(section._meta ?? {}),
      last_reorg: {
        target_template_id:   templateId,
        target_template_name: template.layer_name,
        previous_archetype:   section.archetype,
        dropped_content:      Array.isArray(toolInput.dropped_content) ? toolInput.dropped_content : [],
        rationale:            toolInput.rationale,
        reorged_at:           new Date().toISOString(),
      },
    },
  }
  nextSections[sectionIx] = nextSection
  const nextDrafts = {
    ...(state.page_drafts ?? {}),
    [pageSlug]: {
      ...(draft as any),
      sections: nextSections,
      _meta: { ...((draft as any)?._meta ?? {}), last_reorg_at: new Date().toISOString() },
    },
  }
  const { error: writeErr } = await sb.from('strategy_web_projects')
    .update({ roadmap_state: { ...state, page_drafts: nextDrafts } })
    .eq('id', projectId)
  if (writeErr) return res.status(500).json({ error: `DB write failed: ${writeErr.message}` })

  return res.status(200).json({
    ok: true,
    page_slug: pageSlug,
    section_ix: sectionIx,
    template: { id: template.id, layer_name: template.layer_name },
    new_archetype: toolInput.new_archetype,
    new_copy: toolInput.new_copy,
    dropped_content: Array.isArray(toolInput.dropped_content) ? toolInput.dropped_content : [],
    rationale: toolInput.rationale,
    usage,
  })
}
