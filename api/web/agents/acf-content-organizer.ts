/**
 * Vercel Serverless Function — /api/web/agents/acf-content-organizer
 *
 * Decides which dynamic-content modules (ACF/CPT) the partner's site
 * needs and pre-populates whatever records the partner has already
 * supplied. Output conforms to the dev side's INTAKE.schema.json
 * (reference-pack/INTAKE.schema.json) so the WordPress build pipeline
 * can consume it directly.
 *
 * Why this runs BEFORE sitemap drafting:
 *   • A partner who wants events managed in WP needs an Events page
 *     in the sitemap AND a tribe_events CPT in the ACF plan. The
 *     sitemap step needs to know which CPTs exist before it can
 *     name page types correctly.
 *   • Repeater-heavy sections (staff bios, value statements, group
 *     listings) need the field schema decided so the page-outlines
 *     step can flag those sections as CMS-managed vs hand-crafted.
 *
 * Inputs (all READ-ONLY — see api/web/agents/_lib/protectedTables.ts):
 *   - strategy_content_collection_sessions (Page 2 form answers)
 *   - strategy_content_collection_marks (Page 1 inventory marks)
 *   - content_atoms (filtered to module candidates — persona/value/
 *     mission/vision atoms + church_facts of relevant topics)
 *   - church_facts
 *   - strategy_web_projects (16 global merge fields + chms hint)
 *
 * Output: writes to roadmap_state.acf_plan (JSONB, conforms to
 * INTAKE.schema.json shape). No new tables.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { generateText, jsonSchema, tool } from 'ai'

export const maxDuration = 180

const MODEL = 'anthropic/claude-opus-4-7'
const MAX_OUTPUT_TOKENS = 16000

/** Schema matching reference-pack/INTAKE.schema.json (subset the
 *  agent owns — pages[] comes from the sitemap step, NOT here). */
const ORGANIZER_TOOL = {
  description: 'Submit the ACF content plan — modules to enable, partner-supplied records per module, and CPT/taxonomy notes the developer needs.',
  input_schema: {
    type: 'object',
    required: ['modules', 'about', 'settings', 'rationale'],
    properties: {
      // settings.identity is pre-populated deterministically by the
      // handler from the project's global merge fields — the model
      // sees it for context and can override only if intake conflicts.
      settings: {
        type: 'object',
        properties: {
          identity: {
            type: 'object',
            properties: {
              name:           { type: 'string' },
              tagline:        { type: ['string', 'null'] },
              service_times:  { type: ['string', 'null'] },
              address:        { type: ['string', 'null'] },
              directions_url: { type: ['string', 'null'] },
              phone:          { type: ['string', 'null'] },
              email:          { type: ['string', 'null'] },
              hours:          { type: ['string', 'null'] },
            },
          },
          social: {
            type: 'object',
            properties: {
              facebook:  { type: ['string', 'null'] },
              instagram: { type: ['string', 'null'] },
              youtube:   { type: ['string', 'null'] },
              x_twitter: { type: ['string', 'null'] },
              tiktok:    { type: ['string', 'null'] },
            },
          },
          cta_links: {
            type: 'array',
            description: 'Named partner-supplied links (Give, Plan a Visit, Prayer, Baptism, Group Signup, Kids Check-in, Contact). Sourced from snippets + content_atoms with url-shaped metadata.',
            items: {
              type: 'object',
              required: ['label', 'url'],
              properties: { label: { type: 'string' }, url: { type: 'string' } },
            },
          },
        },
      },

      about: {
        type: 'object',
        description: 'Mission, vision, and values. Source verbatim from atoms tagged mission_statement / vision_statement / value_statement when available. Honor do_not_rewrite marks.',
        properties: {
          mission: { type: ['string', 'null'] },
          vision:  { type: ['string', 'null'] },
          values: {
            type: 'array',
            items: {
              type: 'object',
              required: ['heading', 'description'],
              properties: {
                eyebrow:     { type: ['string', 'null'] },
                heading:     { type: 'string' },
                description: { type: 'string' },
              },
            },
          },
        },
      },

      modules: {
        type: 'array',
        description: 'Which content modules to enable. Decisions:\n- people: enable when ≥ 1 person atom OR partner cms_managed_types includes "staff" OR an intake source names staff.\n- sermons: enable when sermons_display_preference is "wordpress" OR cms_managed_types includes "sermons".\n- groups: enable when groups_display_preference is "wordpress" OR cms_managed_types includes "groups".\n- serve_teams: enable when the church has named serve teams in atoms OR cms_managed_types includes "serve_teams".\n- events: enable when events_display_preference is "wordpress" OR cms_managed_types includes "events".\n- stories: enable when ≥ 2 story atoms exist OR cms_managed_types includes "stories".\n- jobs: enable when atoms reference open positions OR cms_managed_types includes "jobs".\n- card_grid: enable when any page is likely to need a repeater grid (most multi-ministry sites).\n- faq: enable when ≥ 1 atom is question-shaped OR the discovery names FAQ as desired content.',
        items: { type: 'string', enum: ['people', 'sermons', 'groups', 'serve_teams', 'events', 'stories', 'jobs', 'card_grid', 'faq'] },
      },

      content: {
        type: 'object',
        description: 'Pre-populated records per enabled module. Only emit keys for modules in the enabled list. Sourced from church_facts + atoms — do NOT fabricate records.',
        properties: {
          people: {
            type: 'array',
            items: {
              type: 'object',
              required: ['name'],
              properties: {
                name:       { type: 'string' },
                type:       { type: 'string', description: 'person-type term: staff | leader | global-partner' },
                role_title: { type: 'string' },
                email:      { type: 'string' },
                phone:      { type: 'string' },
                photo:      { type: 'string' },
                bio: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { question: { type: 'string' }, answer: { type: 'string' } },
                  },
                },
              },
            },
          },
          sermons: {
            type: 'array',
            items: {
              type: 'object',
              required: ['title'],
              properties: {
                title:            { type: 'string' },
                series:           { type: 'string' },
                speaker:          { type: 'string' },
                video_url:        { type: 'string' },
                podcast_url:      { type: 'string' },
                full_service_url: { type: 'string' },
              },
            },
          },
          series: {
            type: 'array',
            items: {
              type: 'object',
              required: ['name'],
              properties: {
                name:         { type: 'string' },
                image:        { type: 'string' },
                playlist_url: { type: 'string' },
                tagline:      { type: 'string' },
              },
            },
          },
          groups: {
            type: 'array',
            items: {
              type: 'object',
              required: ['name'],
              properties: {
                name:        { type: 'string' },
                type:        { type: 'string' },
                audience:    { type: 'string' },
                status:      { type: 'string', enum: ['open', 'full', 'closed'] },
                leaders:     { type: 'string' },
                description: { type: 'string' },
                meeting: {
                  type: 'object',
                  properties: {
                    day:       { type: 'string' },
                    time:      { type: 'string' },
                    frequency: { type: 'string' },
                    note:      { type: 'string' },
                  },
                },
                kid_friendly: { type: 'boolean' },
                signup_link:  { type: 'string' },
              },
            },
          },
          serve_teams: {
            type: 'array',
            items: {
              type: 'object',
              required: ['name'],
              properties: {
                name:            { type: 'string' },
                category:        { type: 'string' },
                tagline:         { type: 'string' },
                description:     { type: 'string' },
                leader:          { type: 'string' },
                what_to_expect:  { type: 'string' },
                roles: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { role_group: { type: 'string' }, role_name: { type: 'string' } },
                  },
                },
              },
            },
          },
          stories: {
            type: 'array',
            items: {
              type: 'object',
              required: ['title'],
              properties: {
                title:     { type: 'string' },
                type:      { type: 'string' },
                video_url: { type: 'string' },
                summary:   { type: 'string' },
              },
            },
          },
        },
      },

      taxonomies: {
        type: 'array',
        description: 'Taxonomies to create alongside the enabled CPTs. Sermon-series + speaker for sermons. Person-type for people (staff/leader/global-partner terms). group-type/group-audience for groups. story-type for stories.',
        items: {
          type: 'object',
          required: ['slug', 'label'],
          properties: {
            slug:     { type: 'string' },
            label:    { type: 'string' },
            cpt:      { type: 'string', description: 'The CPT slug this taxonomy attaches to.' },
            terms:    { type: 'array', items: { type: 'string' }, description: 'Seed terms the partner has supplied.' },
          },
        },
      },

      blog_plan: {
        type: 'object',
        description: 'Blog handling per partner choice. Skip when blog_handling is "none" or the partner is keeping their existing blog as-is.',
        properties: {
          handling: {
            type: 'string',
            enum: ['transfer', 'sermon_based', 'new', 'none'],
            description: 'Mirror of strategy_content_collection_sessions.blog_handling.',
          },
          taxonomies: {
            type: 'array',
            items: { type: 'string' },
            description: 'Suggested taxonomies for blog posts (topic, author, ministry, etc.) based on partner intent.',
          },
          existing_url:   { type: ['string', 'null'] },
          new_description: { type: ['string', 'null'] },
        },
      },

      rationale: {
        type: 'string',
        description: 'One paragraph: which modules you enabled, which you SKIPPED and why, which content the partner supplied vs which is missing. The strategist reviews this before sitemap drafting.',
      },

      gaps: {
        type: 'array',
        description: 'Things the partner SHOULD supply for a richer site but hasn\'t (e.g., "no staff photos uploaded yet"). Each gap is a developer-actionable note, not a blocking issue.',
        items: {
          type: 'object',
          required: ['module', 'note'],
          properties: {
            module: { type: 'string' },
            note:   { type: 'string' },
          },
        },
      },
    },
  },
}

const SYSTEM_PROMPT = [
  'You are the ACF Content Organizer. Your job is to decide which dynamic content modules (CPT + ACF field groups) the WordPress site needs, and to pre-populate whatever records the partner has already supplied. Output conforms to the dev side\'s INTAKE.schema.json so the WordPress build pipeline can consume it directly.',
  '',
  'Inputs you receive in the user message:',
  '- 16 global merge fields (church_name, address, phone, social URLs, etc.) — these populate settings.identity + settings.social deterministically; you don\'t need to re-derive them.',
  '- Content Collection Page 2 answers (cms_managed_types, events/sermons/groups display preferences, blog handling, sermon archive features). Each tells you whether a module belongs in the plan.',
  '- Content atoms relevant to module candidates (mission_statement, vision_statement, value_statement, persona, story, x_factor).',
  '- Church facts (structured data: service_time, staff, ministry, program, etc.).',
  '',
  'Module decisions:',
  '- DECIDE which modules to enable BY EVIDENCE. A module only belongs in the plan if the partner has signaled intent (via cms_managed_types or a display_preference) OR has supplied concrete content for it. Do not enable modules speculatively.',
  '- When in doubt, prefer to enable fewer modules — modules without content become empty CPTs the partner has to fill manually.',
  '',
  'Content pre-population rules:',
  '- For about.mission / about.vision / about.values: source VERBATIM from atoms tagged mission_statement, vision_statement, value_statement. Never paraphrase these — they\'re the partner\'s identity statements.',
  '- For content.people: only emit people who appear in atoms (topic: persona — though note this is for personas, not staff) OR in church_facts with topic: staff. Each person needs at minimum a name.',
  '- For content.groups, content.sermons, content.serve_teams, etc.: only emit records that exist in atoms or church_facts. Do NOT invent.',
  '- Honor do_not_rewrite marks. If an atom is marked approved_keep_as_is, its content lands verbatim wherever it\'s used.',
  '',
  'Taxonomies:',
  '- When enabling sermons, add sermon-series + speaker taxonomies (seed terms from any partner-supplied series/speaker names).',
  '- When enabling people, add person-type taxonomy with terms partner has supplied (staff, leader, global-partner, etc.).',
  '- When enabling groups, add group-type + group-audience taxonomies.',
  '- For blog: add topic + author taxonomies by default unless blog_handling is "none".',
  '',
  'rationale (required):',
  '- One paragraph naming exactly which modules you enabled, which you skipped, and what content the partner supplied vs what\'s missing. The strategist reads this before sitemap drafting.',
  '',
  'gaps (recommended):',
  '- Surface partner-actionable gaps the developer needs to know about — "no staff photos uploaded yet", "events display_preference is wordpress but no event records supplied", etc. These are notes, not blockers.',
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

  // ── Load all READ-ONLY inputs in parallel ──────────────────────────
  // Every table touched here is on PROTECTED_TABLES (see
  // api/web/agents/_lib/protectedTables.ts). Read-only access only.
  const { data: project } = await sb.from('strategy_web_projects')
    .select('id, member, name, church_name, church_short_name, address, city_state, phone, email, denomination, pastor_name, all_service_times, social_facebook_url, social_instagram_url, social_youtube_url, social_tiktok_url, social_twitter_url, social_linkedin_url, roadmap_state')
    .eq('id', projectId).maybeSingle()
  if (!project) return res.status(404).json({ error: 'Project not found' })

  const member = project.member as number
  const [atomsRes, factsRes, sessionRes] = await Promise.all([
    sb.from('content_atoms')
      .select('id, topic, body, metadata, source_kind, verbatim')
      .eq('web_project_id', projectId),
    sb.from('church_facts')
      .select('topic, data, source_kind').eq('web_project_id', projectId),
    sb.from('strategy_content_collection_sessions')
      .select('cms_managed_types, blog_handling, blog_existing_url, blog_new_description, blog_new_filters, events_display_preference, events_external_url, events_wordpress_source_of_truth, sermons_display_preference, sermons_external_url, sermon_archive_features, sermon_youtube_playlist_url, groups_display_preference, groups_external_url, groups_wordpress_source_of_truth, merch_store_url, ministries_to_grow, ministries_list_html, discipleship_pathway_html')
      .eq('member', member).order('submitted_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
  ])
  const atoms     = atomsRes.data ?? []
  const facts     = factsRes.data ?? []
  const session   = sessionRes.data ?? null

  // ── Pre-populate settings.identity + settings.social deterministically.
  // The model sees these in the prompt and can override only if intake
  // explicitly conflicts (rare — partner-confirmed values win).
  const identity = {
    name:           project.church_name ?? project.name ?? null,
    address:        project.address ?? null,
    phone:          project.phone ?? null,
    email:          project.email ?? null,
    service_times:  project.all_service_times ?? null,
    tagline:        null,
    directions_url: null,
    hours:          null,
  }
  const social = {
    facebook:  project.social_facebook_url  ?? null,
    instagram: project.social_instagram_url ?? null,
    youtube:   project.social_youtube_url   ?? null,
    x_twitter: project.social_twitter_url   ?? null,
    tiktok:    project.social_tiktok_url    ?? null,
    linkedin:  project.social_linkedin_url  ?? null,
  }

  // Slim atoms by topic — the agent only needs module-relevant ones.
  const RELEVANT_TOPICS = new Set([
    'mission_statement', 'vision_statement', 'value_statement',
    'persona', 'story', 'x_factor', 'recommended_page', 'prose_snippet',
  ])
  const slimAtoms = atoms
    .filter(a => RELEVANT_TOPICS.has(String(a.topic ?? '')))
    .map(a => ({
      id: a.id, topic: a.topic, body: a.body, verbatim: a.verbatim, source: a.source_kind,
    }))

  // Slim facts by topic — staff / ministry / service_time / contact_method.
  const RELEVANT_FACT_TOPICS = new Set([
    'service_time', 'staff', 'ministry', 'program', 'partnership',
    'contact_method', 'campus', 'branded_term',
  ])
  const slimFacts = facts
    .filter(f => RELEVANT_FACT_TOPICS.has(String(f.topic ?? '')))
    .map(f => ({ topic: f.topic, data: f.data, source: f.source_kind }))

  const userText = [
    '# Project settings (deterministic — sourced from global merge fields)',
    '```json',
    JSON.stringify({ identity, social, denomination: project.denomination, pastor_name: project.pastor_name }, null, 2),
    '```',
    '',
    session
      ? [
          '# Content Collection — Page 2 answers (partner-supplied)',
          '```json',
          JSON.stringify(session, null, 2),
          '```',
        ].join('\n')
      : '# Content Collection — Page 2 answers\n(none on file — the partner has not filled the form yet, so module decisions must rely on atoms + facts only)',
    '',
    `# Content atoms (slim — only module-relevant topics, ${slimAtoms.length} of ${atoms.length} total)`,
    '```json',
    JSON.stringify(slimAtoms, null, 2),
    '```',
    '',
    `# Church facts (slim — only module-relevant topics, ${slimFacts.length} of ${facts.length} total)`,
    '```json',
    JSON.stringify(slimFacts, null, 2),
    '```',
    '',
    'Decide which content modules to enable, pre-populate records the partner has supplied, name the taxonomies + blog plan, and emit a rationale. Submit via submit_acf_plan.',
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
        submit_acf_plan: tool({
          description: ORGANIZER_TOOL.description,
          inputSchema: jsonSchema(ORGANIZER_TOOL.input_schema as any),
        }),
      },
      toolChoice: { type: 'tool', toolName: 'submit_acf_plan' },
    })
    usage = { input_tokens: result.usage?.inputTokens, output_tokens: result.usage?.outputTokens }
    const toolCall = result.toolCalls?.[0]
    if (!toolCall || toolCall.toolName !== 'submit_acf_plan') {
      throw new Error('Model did not return the expected tool call')
    }
    toolInput = toolCall.input
  } catch (err: any) {
    console.error('[acf-content-organizer] gateway error:', err?.message)
    return res.status(502).json({ error: `AI Gateway error: ${err?.message ?? 'unknown'}` })
  }

  // Merge model output with the deterministically-pre-populated
  // settings.identity + settings.social (we trust DB columns over
  // the model's interpretation of intake).
  const acfPlan = {
    settings: {
      identity: { ...identity, ...(toolInput?.settings?.identity ?? {}) },
      social:   { ...social,   ...(toolInput?.settings?.social   ?? {}) },
      cta_links: toolInput?.settings?.cta_links ?? [],
    },
    about:      toolInput?.about      ?? null,
    modules:    Array.isArray(toolInput?.modules) ? toolInput.modules : [],
    content:    toolInput?.content    ?? {},
    taxonomies: Array.isArray(toolInput?.taxonomies) ? toolInput.taxonomies : [],
    blog_plan:  toolInput?.blog_plan  ?? null,
    rationale:  toolInput?.rationale  ?? '',
    gaps:       Array.isArray(toolInput?.gaps) ? toolInput.gaps : [],
  }

  // Truncation guard — same pattern as extract-strategy and
  // normalize-intake. If we got close to the cap, flag for retry.
  const outputTokens = typeof usage.output_tokens === 'number' ? usage.output_tokens : 0
  const truncationSuspected = outputTokens >= MAX_OUTPUT_TOKENS * 0.9

  const meta = {
    status:                'draft',
    generated_at:          new Date().toISOString(),
    model:                 MODEL,
    usage,
    truncation_suspected:  truncationSuspected,
    truncation_pct:        outputTokens > 0 ? Math.round((outputTokens / MAX_OUTPUT_TOKENS) * 100) : 0,
    inputs_used: {
      atom_count: slimAtoms.length,
      fact_count: slimFacts.length,
      has_content_collection_session: !!session,
    },
  }

  const nextState = {
    ...(project.roadmap_state ?? {}),
    acf_plan: { ...acfPlan, _meta: meta },
  }
  const { error: writeErr } = await sb.from('strategy_web_projects')
    .update({ roadmap_state: nextState }).eq('id', projectId)
  if (writeErr) return res.status(500).json({ error: `DB write failed: ${writeErr.message}` })

  return res.status(200).json({
    ok: true,
    acf_plan: acfPlan,
    truncation_suspected: truncationSuspected,
    inputs_used: meta.inputs_used,
    usage,
  })
}
