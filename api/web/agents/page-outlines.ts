/**
 * Vercel Serverless Function — /api/web/agents/page-outlines
 *
 * Replaces page-briefs. Builds the section-by-section blueprint for
 * ONE page (called once per slug). The blueprint is what page-draft
 * reads to write copy — it carries which atoms feed which section,
 * what treatment each atom gets (verbatim / light edit / heavy edit
 * / synthesize), and which sections are CMS-managed repeaters vs
 * hand-crafted content.
 *
 * The brand voice champion (page-draft) reads this output. The
 * outline IS the contract — page-draft must honor every atom_id
 * mapped to a section and respect every treatment signal.
 *
 * Inputs (READ-ONLY for protected tables):
 *   - content_atoms (filtered by topic-relevance to this page)
 *   - strategy_content_collection_marks (do_not_rewrite flags)
 *   - strategy_content_collection_sessions (display preferences,
 *     ministries_list_html, discipleship_pathway_html for the
 *     respective page slugs)
 *   - strategy_discovery_questionnaire (copy_approach treatment
 *     default, voice register signals)
 *
 * Upstream pivots:
 *   - roadmap_state.ministry_model (the SPINE)
 *   - roadmap_state.site_strategy (persona journey for this page,
 *     key info this page must surface, elevation signals)
 *   - roadmap_state.acf_plan (which sections are CMS-managed)
 *   - roadmap_state.stage_2 (the sitemap — this page's entry)
 *   - cowork-skills/page-outlines-by-ministry-model.md (frame of
 *     reference, NOT template-first — loaded at runtime)
 *
 * Output: writes to roadmap_state.page_outlines[<slug>]. No new
 * tables. page_briefs is left untouched (will be deleted in the
 * orchestrator-wiring step).
 *
 * NOTE: this file overwrites a prior page-outlines.ts that was part
 * of an earlier (never-shipped) Stage 4 pipeline. The original was
 * referenced only by PipelineWorkspace's pipeline tab — not by the
 * Copy Engine cascade. Removing it is safe in the orchestrator-
 * wiring step.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { generateText, jsonSchema, tool } from 'ai'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setRoadmapStateAtomic } from './_lib/roadmapStateMerge.js'

export const maxDuration = 180

const MODEL = 'anthropic/claude-opus-4-7'
const MAX_OUTPUT_TOKENS = 16000

const TOOL = {
  description: 'Submit the section-by-section blueprint for ONE page.',
  input_schema: {
    type: 'object',
    required: ['page_slug', 'sections', 'persona_journey_for_this_page', 'rationale'],
    properties: {
      page_slug:   { type: 'string' },
      page_job:    { type: 'string', description: 'One sentence: what this page accomplishes for the dominant persona.' },

      persona_journey_for_this_page: {
        type: 'object',
        description: 'Pulled from site_strategy.persona_journeys for the persona this page primarily serves. The outline must keep the journey intact section-by-section.',
        required: ['persona_name', 'arrival_context', 'win_state'],
        properties: {
          persona_name:    { type: 'string' },
          arrival_context: { type: 'string', description: 'How the persona arrived at this page — what they\'re carrying.' },
          win_state:       { type: 'string', description: 'What the persona walks away with if this page succeeds.' },
        },
      },

      sections: {
        type: 'array',
        description: 'Section-by-section blueprint, in order. Each section names what it does, which atoms feed it, the treatment per atom, and any CMS-managed flag.',
        items: {
          type: 'object',
          required: ['section_ix', 'archetype', 'section_job', 'atom_assignments', 'flow_role'],
          properties: {
            section_ix:  { type: 'number', description: 'Zero-indexed position on the page. Must be unique.' },
            archetype: {
              type: 'string',
              enum: [
                'hero', 'tagline_band', 'two_up', 'three_up', 'cards_grid',
                'featured_card', 'image_text_split', 'accordion', 'cta_band',
                'testimonial_block', 'stat_block', 'steps_row', 'contact_band',
                'footer_cta', 'intro_paragraph', 'rich_body',
              ],
            },
            section_job: { type: 'string', description: 'What this section does for the persona in their journey through the page (one sentence).' },
            flow_role: {
              type: 'string',
              enum: ['hook', 'orient', 'reassure', 'inform', 'deepen', 'invite', 'close'],
              description: 'Where this section sits in the page\'s narrative arc.',
            },
            atom_assignments: {
              type: 'array',
              description: 'Which atoms feed THIS section. Each carries a treatment signal driven by do_not_rewrite + copy_approach. Empty array = section is template-default (e.g., a Plan-a-Visit "What to Expect" section can run on persona reassurance language even if no specific atom maps).',
              items: {
                type: 'object',
                required: ['atom_id', 'treatment'],
                properties: {
                  atom_id:   { type: 'string', description: 'Real UUID from content_atoms.id. Never fabricate slugs.' },
                  treatment: {
                    type: 'string',
                    enum: ['verbatim', 'light_edit', 'heavy_edit', 'synthesize'],
                    description: 'verbatim = quote exactly (do_not_rewrite marks OR copy_approach=do_not_use); light_edit = preserve meaning, polish voice; heavy_edit = restructure freely while staying accurate; synthesize = use as source material to compose new copy.',
                  },
                  role_in_section: { type: 'string', description: 'How this atom is used HERE (e.g., "section heading", "card 1 description", "testimonial body").' },
                },
              },
            },
            cms_managed: {
              type: 'object',
              description: 'Set when this section sources from an ACF/CPT (per acf_plan). Page-draft + commit will treat field_values as repeater pulls.',
              required: ['module'],
              properties: {
                module: { type: 'string', description: 'Module from acf_plan.modules (people / sermons / groups / serve_teams / events / stories / jobs).' },
                query:  { type: 'string', description: 'Plain-English query the dev should implement (e.g., "all person posts with person-type=staff, ordered by sort_order").' },
              },
            },
            primary_cta: {
              type: 'object',
              description: 'If this section is the one that owns the page\'s primary CTA, name it here. Most pages have exactly one section that owns the CTA — page-draft enforces this.',
              required: ['label_hint', 'intent'],
              properties: {
                label_hint: { type: 'string', description: 'Suggested label (page-draft writes the final, voice-true version).' },
                intent:     { type: 'string', description: 'What the click promises (e.g., "Opens prefilled Plan-a-Visit form").' },
              },
            },
            voice_anchor: { type: 'string', description: 'Which voice exemplar (verbatim atom body) this section\'s writing should imitate.' },
            anti_pattern_to_avoid: { type: 'string', description: 'One thing this section MUST NOT do (driven by anti-exemplars or persona blockers).' },
            template_guide_section_referenced: { type: 'string', description: 'For traceability: the section heading in the page-outlines-by-ministry-model guide this draws from (e.g., "Set 1 — Attractional / Plan a Visit / What to Expect"). Skip if no template section applies — the outline can deviate.' },
          },
        },
      },

      unresolved_inputs: {
        type: 'array',
        description: 'Atoms or sections this page NEEDED but couldn\'t resolve from the partner\'s content. The auto-iterate loop will surface these for backfill BEFORE the page is considered complete. NEVER pass an unresolved section through to the user.',
        items: {
          type: 'object',
          required: ['what', 'why_needed'],
          properties: {
            what:        { type: 'string', description: 'What\'s missing (e.g., "no atom describing the partner\'s Starting Point class").' },
            why_needed: { type: 'string', description: 'Why this page can\'t complete without it.' },
            section_ix: { type: ['number', 'null'], description: 'If tied to a specific section, name it.' },
          },
        },
      },

      rationale: { type: 'string', description: 'One paragraph: the section sequence + why it lands for this persona on this ministry model. Strategist reads this at Gate 1 if they expand a page.' },
    },
  },
}

// The template guide that informs conventional flow. Loaded once
// per agent invocation. Treated as a FRAME OF REFERENCE — the
// guide's "this page tends to have these sections in this order"
// is a starting point, not a contract.
function loadTemplateGuide(): string {
  try {
    const candidates = [
      join(process.cwd(), 'cowork-skills', 'page-outlines-by-ministry-model.md'),
      join(__dirname, '..', '..', '..', 'cowork-skills', 'page-outlines-by-ministry-model.md'),
    ]
    for (const path of candidates) {
      try { return readFileSync(path, 'utf-8') } catch { /* try next */ }
    }
    return '(template guide not found at runtime — proceeding with content collection alone)'
  } catch {
    return '(template guide load failed — proceeding with content collection alone)'
  }
}

const SYSTEM_PROMPT_HEAD = [
  'You are the Page Outline Agent. You build the section-by-section blueprint for ONE page. The page-draft agent reads this blueprint to write copy — every atom_id you assign + treatment signal you set becomes a hard contract.',
  '',
  'CORE RULE: content collection wins, the template guide informs flow.',
  'You will receive (a) the church\'s actual content via atoms + Content Collection signals, and (b) a template guide that names conventional sections per page-type × ministry model. Lead with (a). Use (b) ONLY to inform the SHAPE of the outline — never to fill sections with content the partner hasn\'t supplied.',
  '',
  'Rules:',
  '1. Every section in your output MUST be backed by atom assignments OR be a defensible structural section (Service Times block, contact form, etc.) the template guide names + the persona journey requires.',
  '2. Never fabricate atom_ids. Use real UUIDs from the content_atoms input. If you can\'t find an atom for a section the template guide suggests, EITHER drop the section OR add it to unresolved_inputs (don\'t make up content).',
  '3. Honor do_not_rewrite marks. Atoms marked approved_keep_as_is land with treatment="verbatim".',
  '4. Honor copy_approach. When copy_approach is "do_not_use" (start from scratch), default treatment to "synthesize". When copy_approach is "polish_existing", default to "light_edit". When copy_approach is "rewrite_freely" or similar, default to "heavy_edit".',
  '5. Respect the ministry model spine. The dominant model drives section ORDER and CTA emphasis. The secondary_blend can override on specific pages where it fits.',
  '6. Honor the persona journey from site_strategy.persona_journeys[]. Sections should move the persona through their stated journey arc — hook → orient → reassure → inform → deepen → invite → close.',
  '7. Mark cms_managed sections explicitly when they pull from a CPT in acf_plan (e.g., a "Meet the Team" section sourcing person posts, an Events grid sourcing tribe_events).',
  '8. Surface anything UNRESOLVED in unresolved_inputs[]. Do not silently ship a page with missing content — the auto-iterate loop will backfill OR escalate.',
  '9. Voice anchors per section: pick a specific atom body (voice_sample / voice_rule / ethos) that imitates well for this section\'s job. Quote verbatim.',
  '10. anti_pattern_to_avoid: name one specific thing this section must NOT do (driven by voice_anti_exemplars or persona blockers).',
  '',
  'TEMPLATE GUIDE (frame of reference — read it, then write the outline content-collection-first):',
  '',
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

  const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : null
  const pageSlug  = typeof req.body?.pageSlug  === 'string' ? req.body.pageSlug  : null
  if (!projectId || !pageSlug) {
    return res.status(400).json({ error: 'projectId and pageSlug required' })
  }

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  const { data: project } = await sb.from('strategy_web_projects')
    .select('id, member, roadmap_state').eq('id', projectId).maybeSingle()
  if (!project) return res.status(404).json({ error: 'Project not found' })

  const state         = (project.roadmap_state ?? {}) as Record<string, any>
  const sitemap       = state.stage_2 as any
  const siteStrategy  = state.site_strategy as any
  const ministryModel = state.ministry_model as any
  const acfPlan       = state.acf_plan as any

  // Hard pre-flight — page-outlines can't run without these upstream
  // outputs. If anything's missing, refuse loudly so the cascade
  // doesn't proceed on broken state.
  const missing: string[] = []
  if (!sitemap) missing.push('stage_2 (sitemap)')
  if (!siteStrategy) missing.push('site_strategy')
  if (!ministryModel) missing.push('ministry_model')
  if (missing.length > 0) {
    return res.status(400).json({
      error: 'Required upstream stages missing — cannot draft a page outline without them.',
      missing,
    })
  }

  // Find this page in the sitemap.
  const sitemapPage = (sitemap.pages ?? []).find((p: any) => p?.slug === pageSlug)
  if (!sitemapPage) {
    return res.status(404).json({ error: `Page "${pageSlug}" not found in sitemap.` })
  }

  const member = project.member as number
  const [atomsRes, discoveryRes, sessionRes] = await Promise.all([
    sb.from('content_atoms')
      .select('id, topic, body, metadata, source_kind, verbatim, confidence')
      .eq('web_project_id', projectId),
    sb.from('strategy_discovery_questionnaire')
      .select('copy_approach, ideal_website_experience, words_tones_to_avoid')
      .eq('member', member).order('submitted_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('strategy_content_collection_sessions')
      .select('ministries_list_html, discipleship_pathway_html, events_display_preference, sermons_display_preference, groups_display_preference, additional_context')
      .eq('member', member).order('submitted_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
  ])

  const atoms     = atomsRes.data ?? []
  const discovery = discoveryRes.data ?? null
  const session   = sessionRes.data ?? null

  // Find this page's persona journey from site_strategy.
  const journeys = Array.isArray(siteStrategy.persona_journeys) ? siteStrategy.persona_journeys : []
  const pageJourney = journeys.find((j: any) =>
    Array.isArray(j.entry_points) && j.entry_points.some((s: string) => s === pageSlug)
  ) ?? journeys[0] ?? null

  // Find this page's elevation + key_info_to_highlight relevant to this page.
  const elevations = Array.isArray(siteStrategy.page_elevations) ? siteStrategy.page_elevations : []
  const keyInfo    = Array.isArray(siteStrategy.key_info_to_highlight) ? siteStrategy.key_info_to_highlight : []
  const pageElevation = elevations.find((e: any) =>
    typeof e.topic === 'string' && e.topic.toLowerCase().includes(pageSlug.toLowerCase())
  ) ?? null
  const relevantKeyInfo = keyInfo.filter((k: any) =>
    typeof k.where === 'string' && k.where.toLowerCase().includes(pageSlug.toLowerCase())
  )

  const templateGuide = loadTemplateGuide()

  const userText = [
    `# Page being outlined`,
    '```json',
    JSON.stringify({ slug: pageSlug, sitemap_entry: sitemapPage }, null, 2),
    '```',
    '',
    `# Ministry model (the SPINE — drives section order + CTA emphasis)`,
    '```json',
    JSON.stringify({
      model:           ministryModel.model,
      confidence:      ministryModel.confidence,
      secondary_blend: ministryModel.secondary_blend,
      blend_notes:     ministryModel.blend_notes,
      cta_default:     ministryModel.cta_default,
    }, null, 2),
    '```',
    '',
    `# Persona journey for THIS page`,
    pageJourney ? '```json\n' + JSON.stringify(pageJourney, null, 2) + '\n```' : '(no specific journey — use site-wide journey from site_strategy)',
    '',
    `# Page elevation signal`,
    pageElevation ? '```json\n' + JSON.stringify(pageElevation, null, 2) + '\n```' : '(no specific elevation — default importance)',
    '',
    `# Key info that MUST surface on this page`,
    relevantKeyInfo.length > 0 ? '```json\n' + JSON.stringify(relevantKeyInfo, null, 2) + '\n```' : '(no page-specific key info from site_strategy)',
    '',
    `# Discovery — copy_approach + voice register signal`,
    discovery ? '```json\n' + JSON.stringify(discovery, null, 2) + '\n```' : '(no discovery on file — default treatment to heavy_edit)',
    '',
    `# Content Collection session — display preferences + per-page partner-supplied HTML`,
    session ? '```json\n' + JSON.stringify(session, null, 2) + '\n```' : '(no session on file)',
    '',
    `# ACF plan — modules available for cms_managed sections`,
    acfPlan ? '```json\n' + JSON.stringify({ modules: acfPlan.modules ?? [], taxonomies: acfPlan.taxonomies ?? [] }, null, 2) + '\n```' : '(no ACF plan)',
    '',
    `# ALL atoms (${atoms.length}) — pick the ones relevant to this page by topic + body match against page_job`,
    '```json',
    JSON.stringify(atoms, null, 2),
    '```',
    '',
    `Build the section-by-section blueprint for "${pageSlug}". Submit via submit_page_outline.`,
  ].filter(Boolean).join('\n')

  let toolInput: any | null = null
  let usage: { input_tokens?: number; output_tokens?: number } = {}
  try {
    const result = await generateText({
      model: MODEL,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      system: SYSTEM_PROMPT_HEAD + templateGuide,
      messages: [{ role: 'user', content: userText }],
      tools: {
        submit_page_outline: tool({
          description: TOOL.description,
          inputSchema: jsonSchema(TOOL.input_schema as any),
        }),
      },
      toolChoice: { type: 'tool', toolName: 'submit_page_outline' },
    })
    usage = { input_tokens: result.usage?.inputTokens, output_tokens: result.usage?.outputTokens }
    const toolCall = result.toolCalls?.[0]
    if (!toolCall || toolCall.toolName !== 'submit_page_outline') {
      throw new Error('Model did not return the expected tool call')
    }
    toolInput = toolCall.input
  } catch (err: any) {
    // AI SDK errors can have nested structure — err.message is sometimes
    // a string, sometimes an object, sometimes wraps a `cause`. Surface
    // EVERYTHING in the response so the client doesn't end up displaying
    // "[object Object]" with no signal about what actually broke.
    const msg = typeof err?.message === 'string' ? err.message : null
    const causeMsg = typeof err?.cause?.message === 'string' ? err.cause.message : null
    let serialized: string
    try { serialized = JSON.stringify(err, Object.getOwnPropertyNames(err ?? {})) }
    catch { serialized = String(err) }
    const detail = msg ?? causeMsg ?? serialized ?? 'unknown'
    console.error('[page-outlines] gateway error:', { msg, causeMsg, serialized, errType: err?.constructor?.name })
    return res.status(502).json({ error: `AI Gateway error: ${detail}`, detail, error_type: err?.constructor?.name ?? 'Error' })
  }

  // Validate atom_ids exist — fabricated UUIDs are a fail condition.
  // The auto-iterate loop will catch this and re-run if any section
  // references a non-existent atom.
  const realAtomIds = new Set(atoms.map((a: any) => String(a.id)))
  const sections = Array.isArray(toolInput?.sections) ? toolInput.sections : []
  const fabricated: Array<{ section_ix: number; atom_id: string }> = []
  for (const s of sections) {
    for (const aa of (s.atom_assignments ?? [])) {
      if (!realAtomIds.has(String(aa.atom_id))) {
        fabricated.push({ section_ix: s.section_ix, atom_id: aa.atom_id })
      }
    }
  }

  const outputTokens = typeof usage.output_tokens === 'number' ? usage.output_tokens : 0
  const truncationSuspected = outputTokens >= MAX_OUTPUT_TOKENS * 0.9

  const outline = {
    ...toolInput,
    _meta: {
      generated_at:           new Date().toISOString(),
      model:                  MODEL,
      usage,
      truncation_suspected:   truncationSuspected,
      truncation_pct:         outputTokens > 0 ? Math.round((outputTokens / MAX_OUTPUT_TOKENS) * 100) : 0,
      fabricated_atom_ids:    fabricated,
      has_fabricated_atoms:   fabricated.length > 0,
      unresolved_count:       Array.isArray(toolInput?.unresolved_inputs) ? toolInput.unresolved_inputs.length : 0,
      inputs_used: {
        atom_count:        atoms.length,
        has_journey:       !!pageJourney,
        has_elevation:     !!pageElevation,
        relevant_key_info: relevantKeyInfo.length,
        has_discovery:     !!discovery,
        has_session:       !!session,
        has_acf_plan:      !!acfPlan,
      },
    },
  }

  // Atomic write — sets ONLY this page's slot inside page_outlines.
  // Server-side jsonb_set; never overwrites siblings (other pages'
  // outlines OR completely unrelated keys like stage_1 / site_strategy)
  // that the prior read-modify-write pattern was clobbering.
  try {
    await setRoadmapStateAtomic(sb, projectId, ['page_outlines', pageSlug], outline)
  } catch (e: any) {
    return res.status(500).json({ error: `DB write failed: ${e?.message ?? 'unknown'}` })
  }

  return res.status(200).json({
    ok: true,
    page_slug: pageSlug,
    outline,
    truncation_suspected: truncationSuspected,
    fabricated_atom_count: fabricated.length,
    unresolved_count: outline._meta.unresolved_count,
    inputs_used: outline._meta.inputs_used,
    usage,
  })
}
