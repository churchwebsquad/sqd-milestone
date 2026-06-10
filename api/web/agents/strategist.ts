/**
 * Vercel Serverless Function — /api/web/agents/strategist
 *
 * Stage A — runs BEFORE sitemap drafting. Builds the strategic
 * scaffolding that informs how the sitemap groups information,
 * which pages get amplified, and how each persona moves through
 * the site.
 *
 * The strategist's output is the BRIDGE between raw content (atoms,
 * Content Collection answers) and structural decisions (sitemap,
 * page outlines). Without this step the sitemap drafter has to
 * derive site strategy from atoms on the fly — which is what's
 * been producing flat, persona-blind sitemaps.
 *
 * Inputs the user explicitly named:
 *   • 1.1 Discovery — ideal new-visitor experience, top website goal
 *   • 1.2 Strategy Brief — full persona (name, age, values, goals,
 *       challenges, how the church helps, motivations) via atoms +
 *       extract-strategy output
 *   • 1.3 Content Collection — ministries_to_grow + cms_managed_types
 *       (the "we're emphasizing X" signal)
 *
 * Plus the upstream pivots:
 *   • roadmap_state.ministry_model (just classified — drives the
 *     spine of how this site should read)
 *   • roadmap_state.acf_plan (which modules will exist, so page
 *     elevations can reference real CPTs)
 *
 * All Content Collection tables are READ-ONLY (see
 * api/web/agents/_lib/protectedTables.ts).
 *
 * Output: writes to roadmap_state.site_strategy. No new tables.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { generateText, jsonSchema, tool } from 'ai'

export const maxDuration = 180

const MODEL = 'anthropic/claude-opus-4-7'
const MAX_OUTPUT_TOKENS = 12000

const TOOL = {
  description: 'Submit the strategic scaffolding for the site — siteflow, per-persona journeys, key info to highlight, page elevation signals.',
  input_schema: {
    type: 'object',
    required: ['siteflow', 'persona_journeys', 'key_info_to_highlight', 'page_elevations', 'rationale'],
    properties: {
      siteflow: {
        type: 'object',
        description: 'How the SITE OVERALL should read. What story does the homepage tell first-to-last? Which subsequent pages does that story open up?',
        required: ['homepage_arc', 'narrative_thread'],
        properties: {
          homepage_arc: {
            type: 'array',
            description: 'Ordered list of homepage beats — 5-8 ideas. Each: what the visitor learns in that beat + why it goes there in the order it does.',
            items: {
              type: 'object',
              required: ['beat', 'job', 'rationale'],
              properties: {
                beat:      { type: 'string', description: 'A short label for this beat (e.g., "Identity hero", "Pathway band", "Mission for the city").' },
                job:       { type: 'string', description: 'What the visitor walks away with after this beat.' },
                rationale: { type: 'string', description: 'Why this beat lands HERE — what it does for the persona at this scroll depth.' },
              },
            },
          },
          narrative_thread: {
            type: 'string',
            description: 'One paragraph: the thread that runs through every page. The sentence a visitor should be able to finish after reading any 3 pages.',
          },
        },
      },

      persona_journeys: {
        type: 'array',
        description: 'One entry per primary persona (typically 2-3). For each: where they arrive, what they need first, what step they\'re likely to take next, what would make them bounce. These are the journey contracts the page-outlines step honors per page.',
        items: {
          type: 'object',
          required: ['persona_name', 'stage_today', 'entry_points', 'next_step_we_want', 'blockers'],
          properties: {
            persona_name: { type: 'string', description: 'Verbatim from atoms — do not paraphrase the partner\'s persona naming.' },
            stage_today: {
              type: 'string',
              enum: ['stranger', 'seeker', 'first_timer', 'returning_guest', 'regular', 'maturing', 'sending_member'],
              description: 'Where this persona is on their journey TODAY. Drives entry-point predictions.',
            },
            persona_summary: {
              type: 'string',
              description: 'One sentence — the persona\'s defining tension (e.g., "Maria wants community without being asked to perform after years of church hurt").',
            },
            entry_points: {
              type: 'array',
              description: 'Pages this persona is most likely to land on first (from search, from a friend, from the homepage). Use plausible page slugs the sitemap will produce.',
              items: { type: 'string' },
            },
            next_step_we_want: { type: 'string', description: 'The specific next step we want this persona to take BEFORE they leave the site (e.g., "submit a Prayer Request without leaving Plan a Visit").' },
            blockers: {
              type: 'array',
              description: 'What would make them bounce. Be specific — "any mention of membership before they know what we believe" beats "too much pressure."',
              items: { type: 'string' },
            },
          },
        },
      },

      key_info_to_highlight: {
        type: 'array',
        description: 'The 3-7 things the site MUST surface prominently. Each carries the WHY + the suggested WHERE. The sitemap + page-outlines steps treat these as constraints.',
        items: {
          type: 'object',
          required: ['info', 'why', 'where'],
          properties: {
            info:  { type: 'string', description: 'What needs to land. Quote atom bodies verbatim when relevant.' },
            why:   { type: 'string', description: 'Why this is mission-critical (driven by discovery top goals, persona blockers, or x-factor).' },
            where: { type: 'string', description: 'Suggested page + section (e.g., "Homepage hero", "Plan a Visit Step 3 — Kids check-in", "About → Story").' },
          },
        },
      },

      page_elevations: {
        type: 'array',
        description: 'Pages or topics the partner has signaled they want AMPLIFIED — typically tied to ministries_to_grow + cms_managed_types. Each says how high in the IA to promote.',
        items: {
          type: 'object',
          required: ['topic', 'reason', 'elevation'],
          properties: {
            topic:  { type: 'string', description: 'The page topic or ministry being elevated (e.g., "Sisterhood", "Young Adults", "Outreach", "Sermons").' },
            reason: { type: 'string', description: 'Why elevate — partner-stated growth priority, persona need, or x-factor.' },
            elevation: {
              type: 'string',
              enum: ['nav_top_level', 'nav_dropdown_parent', 'nav_dropdown_child', 'homepage_feature', 'dedicated_page_with_homepage_band', 'dedicated_page_only', 'footer_only'],
              description: 'How high in the IA to promote it.',
            },
          },
        },
      },

      voice_register_per_page_type: {
        type: 'array',
        description: 'Optional — only emit when the discovery / strategy brief signals a register differs by page type (e.g., "playful on Kids, sober on Grief Care"). Page-outlines + page-draft honor this.',
        items: {
          type: 'object',
          required: ['page_type', 'register'],
          properties: {
            page_type: { type: 'string' },
            register:  { type: 'string', description: 'One sentence on the tone shift expected (e.g., "warmer + more playful on Kids; more anchored + scripture-led on Grief").' },
          },
        },
      },

      rationale: {
        type: 'string',
        description: 'One paragraph the strategist reads at Gate 1 — name the dominant signals that drove this strategy and what you intentionally deprioritized.',
      },
    },
  },
}

const SYSTEM_PROMPT = [
  'You are the Site Strategist. You read everything the partner has supplied (discovery, strategy brief, content collection answers, atoms, ministry model classification) and produce the strategic scaffolding the sitemap + page outlines + page drafts pivot on.',
  '',
  'You are NOT writing copy. You are deciding what the site does, in what order, for whom. Strategy lives at the level of "what does the homepage say first," "where does Maria land," "which 3 things MUST be prominent."',
  '',
  'Inputs you receive:',
  '- Discovery (1.1): ideal new-visitor experience, top website priority, top 3 goals, copy_approach signal.',
  '- Persona atoms (1.2): full descriptions including name, age, values, goals, challenges, how the church helps, motivations.',
  '- Content Collection (1.3): ministries_to_grow + cms_managed_types + display preferences (where the partner has signaled emphasis).',
  '- Ministry model classification + secondary blend (just classified — the dominant spine of how this church thinks).',
  '- ACF plan (which modules / CPTs will exist).',
  '- Atoms: mission, vision, x-factor, ethos, value statements, voice rules, recommended pages.',
  '',
  'Rules:',
  '- Lead with the PARTNER\'s words. When you reference a persona need or x-factor, quote the atom verbatim.',
  '- The ministry model is the SPINE. An attractional church\'s homepage_arc leads with the weekend experience; a discipleship church\'s leads with the pathway; a missional church\'s leads with mission/vision for the city.',
  '- Persona journeys are SPECIFIC. "Maria lands on Plan a Visit from Google after looking up \\"non-judgy church near me\\"" beats "Maria explores the site."',
  '- page_elevations must be CONCRETE — name the topic + reason + elevation level. ministries_to_grow gets elevated by default (that\'s the partner directly saying "amplify this").',
  '- key_info_to_highlight is the 3-7 most-important things — not 20. If everything\'s critical, nothing is.',
  '- Don\'t invent goals. If discovery is silent on a topic, don\'t fabricate strategic intent for it.',
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
  if (!projectId) return res.status(400).json({ error: 'projectId required' })

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  const { data: project } = await sb.from('strategy_web_projects')
    .select('id, member, name, roadmap_state').eq('id', projectId).maybeSingle()
  if (!project) return res.status(404).json({ error: 'Project not found' })

  const state          = (project.roadmap_state ?? {}) as Record<string, any>
  const ministryModel  = state.ministry_model ?? null
  const acfPlan        = state.acf_plan ?? null
  const stage1         = state.stage_1 ?? null

  if (!ministryModel) {
    return res.status(400).json({
      error: 'Ministry model classification must run before the strategist.',
      hint: 'Call POST /api/web/agents/determine-ministry-model first.',
    })
  }

  const member = project.member as number
  const [atomsRes, discoveryRes, sessionRes] = await Promise.all([
    sb.from('content_atoms')
      .select('id, topic, body, metadata, source_kind, verbatim')
      .eq('web_project_id', projectId)
      .in('topic', [
        'persona', 'mission_statement', 'vision_statement', 'x_factor',
        'ethos', 'value_statement', 'voice_rule', 'tone_descriptor',
        'recommended_page', 'story',
      ]),
    sb.from('strategy_discovery_questionnaire')
      .select('ideal_website_experience, top_website_priority, top_3_website_goals, copy_approach, words_tones_to_avoid, how_church_refers_to_services, tone_register_preference')
      .eq('member', member).order('submitted_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('strategy_content_collection_sessions')
      .select('ministries_to_grow, ministries_list_html, cms_managed_types, events_display_preference, sermons_display_preference, groups_display_preference, additional_context, high_maintenance_pages_context')
      .eq('member', member).order('submitted_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
  ])
  const atoms     = atomsRes.data ?? []
  const discovery = discoveryRes.data ?? null
  const session   = sessionRes.data ?? null

  // Personas separately so they get prominence in the prompt.
  const personaAtoms = atoms.filter((a: any) => a.topic === 'persona')

  // Slim ACF plan — strategist only needs which modules are enabled
  // + a few signals, not the full content payload.
  const acfSlim = acfPlan ? {
    modules:     acfPlan.modules ?? [],
    blog_plan:   acfPlan.blog_plan ?? null,
    rationale:   acfPlan.rationale ?? null,
  } : null

  // Slim ministry model — drop the verbose evidence quotes (they're
  // duplicated in atoms anyway).
  const ministrySlim = ministryModel ? {
    model:           ministryModel.model,
    confidence:      ministryModel.confidence,
    secondary_blend: ministryModel.secondary_blend,
    blend_notes:     ministryModel.blend_notes,
    cta_default:     ministryModel.cta_default,
  } : null

  // Slim stage_1 — voice card + project goals only (anti-exemplars
  // matter for page-draft, not strategy).
  const stage1Slim = stage1 ? {
    audience:                       stage1.audience,
    voice_characteristics:          stage1.voice_characteristics,
    x_factor:                       stage1.x_factor,
    project_goals:                  stage1.project_goals,
    existing_pages_to_carry_forward: stage1.existing_pages_to_carry_forward,
    seo_aeo_geo_targets:            stage1.seo_aeo_geo_targets,
  } : null

  const userText = [
    '# Ministry model (already classified — this is the SPINE)',
    ministrySlim ? '```json\n' + JSON.stringify(ministrySlim, null, 2) + '\n```' : '(missing)',
    '',
    '# Discovery answers (1.1 — strategic intent from the partner)',
    discovery ? '```json\n' + JSON.stringify(discovery, null, 2) + '\n```' : '(no discovery on file)',
    '',
    '# Personas (1.2 — verbatim from strategy brief)',
    `${personaAtoms.length} persona atoms:`,
    '```json',
    JSON.stringify(personaAtoms, null, 2),
    '```',
    '',
    '# Content Collection signals (1.3 — partner-stated emphasis)',
    session ? '```json\n' + JSON.stringify(session, null, 2) + '\n```' : '(no Content Collection session on file)',
    '',
    '# ACF plan (which modules + CPTs will exist on the site)',
    acfSlim ? '```json\n' + JSON.stringify(acfSlim, null, 2) + '\n```' : '(missing)',
    '',
    '# Stage 1 — strategic foundation',
    stage1Slim ? '```json\n' + JSON.stringify(stage1Slim, null, 2) + '\n```' : '(missing)',
    '',
    `# Supporting atoms (${atoms.length} — mission / vision / x-factor / ethos / values / voice rules / recommended pages / stories)`,
    '```json',
    JSON.stringify(atoms.filter((a: any) => a.topic !== 'persona'), null, 2),
    '```',
    '',
    'Build the strategic scaffolding the sitemap + page outlines + page drafts will pivot on. Submit via submit_site_strategy.',
  ].filter(Boolean).join('\n')

  let toolInput: any | null = null
  let usage: { input_tokens?: number; output_tokens?: number } = {}
  try {
    const result = await generateText({
      model: MODEL,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userText }],
      tools: {
        submit_site_strategy: tool({
          description: TOOL.description,
          inputSchema: jsonSchema(TOOL.input_schema as any),
        }),
      },
      toolChoice: { type: 'tool', toolName: 'submit_site_strategy' },
    })
    usage = { input_tokens: result.usage?.inputTokens, output_tokens: result.usage?.outputTokens }
    const toolCall = result.toolCalls?.[0]
    if (!toolCall || toolCall.toolName !== 'submit_site_strategy') {
      throw new Error('Model did not return the expected tool call')
    }
    toolInput = toolCall.input
  } catch (err: any) {
    console.error('[strategist] gateway error:', err?.message)
    return res.status(502).json({ error: `AI Gateway error: ${err?.message ?? 'unknown'}` })
  }

  const outputTokens = typeof usage.output_tokens === 'number' ? usage.output_tokens : 0
  const truncationSuspected = outputTokens >= MAX_OUTPUT_TOKENS * 0.9

  const siteStrategy = {
    ...toolInput,
    _meta: {
      generated_at:         new Date().toISOString(),
      model:                MODEL,
      usage,
      truncation_suspected: truncationSuspected,
      truncation_pct:       outputTokens > 0 ? Math.round((outputTokens / MAX_OUTPUT_TOKENS) * 100) : 0,
      inputs_used: {
        persona_count: personaAtoms.length,
        atom_count:    atoms.length,
        has_discovery: !!discovery,
        has_session:   !!session,
        has_acf_plan:  !!acfSlim,
        has_stage_1:   !!stage1Slim,
        ministry_model: ministryModel?.model ?? null,
      },
    },
  }

  const nextState = { ...state, site_strategy: siteStrategy }
  const { error: writeErr } = await sb.from('strategy_web_projects')
    .update({ roadmap_state: nextState }).eq('id', projectId)
  if (writeErr) return res.status(500).json({ error: `DB write failed: ${writeErr.message}` })

  return res.status(200).json({
    ok: true,
    site_strategy: siteStrategy,
    truncation_suspected: truncationSuspected,
    inputs_used: siteStrategy._meta.inputs_used,
    usage,
  })
}
