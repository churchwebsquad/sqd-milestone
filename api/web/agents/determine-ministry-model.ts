/**
 * Vercel Serverless Function — /api/web/agents/determine-ministry-model
 *
 * Classifies the partner church into one of three ministry-model
 * archetypes (see cowork-skills/page-outlines-by-ministry-model.md):
 *   • attractional — "Get them in the room. Remove every barrier."
 *   • discipleship — "Move people from rows to circles along a pathway."
 *   • missional    — "Equip and send people as leaders into culture."
 *
 * Output is the SPINE the strategist + sitemap + page-outlines steps
 * pivot on. The strategist can override at Gate 1 if the
 * classification is off; that override flows back here.
 *
 * Most churches blend models. The classifier returns the dominant
 * model + an optional secondary_blend signal so downstream stages
 * know when to borrow conventions from another model on specific
 * pages (e.g., a discipleship church may run an attractional Plan
 * a Visit page).
 *
 * Inputs (READ-ONLY):
 *   - content_atoms (mission_statement, vision_statement,
 *     x_factor, ethos, recommended_page atoms — these carry the
 *     strongest signal of how the church thinks)
 *   - church_facts (program / ministry topic distribution)
 *   - strategy_discovery_questionnaire (top_website_priority,
 *     top_3_website_goals, copy_approach signal)
 *   - web_project_topics (crawl signal — what does the live site
 *     currently emphasize?)
 *
 * Output: writes to roadmap_state.ministry_model. No new tables.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { generateText, jsonSchema, tool } from 'ai'

export const maxDuration = 60

const MODEL = 'anthropic/claude-opus-4-7'
const MAX_OUTPUT_TOKENS = 4000

const TOOL = {
  description: 'Submit the church\'s ministry model classification with evidence.',
  input_schema: {
    type: 'object',
    required: ['model', 'confidence', 'rationale', 'evidence'],
    properties: {
      model: {
        type: 'string',
        enum: ['attractional', 'discipleship', 'missional'],
        description: 'The dominant ministry model. Picks the SINGLE strongest fit — secondary_blend below carries the second-most-likely model.',
      },
      confidence: {
        type: 'string',
        enum: ['high', 'medium', 'low'],
        description: 'high = clear evidence in multiple signals; medium = leaning but mixed; low = genuine blend or insufficient evidence (default to attractional with low confidence in this case).',
      },
      secondary_blend: {
        type: ['string', 'null'],
        enum: ['attractional', 'discipleship', 'missional', null],
        description: 'Secondary model the church blends with. Most churches do blend; emit unless the partner is a pure single-model church.',
      },
      blend_notes: {
        type: ['string', 'null'],
        description: 'When secondary_blend is set: one sentence on which pages should borrow the secondary model\'s conventions (e.g., "Discipleship overall, but the Plan a Visit page reads attractional — partner emphasizes a great first experience for newcomers").',
      },
      rationale: {
        type: 'string',
        description: 'One paragraph naming the signals that drove the classification. Quote atom bodies, mission language, or crawl topic emphasis verbatim. Strategist reads this at Gate 1 to confirm or override.',
      },
      evidence: {
        type: 'object',
        description: 'Per-model signal counts and quotes. Surfaces in the workspace so the strategist can see WHY the classifier chose this model.',
        properties: {
          attractional_signals: { type: 'array', items: { type: 'string' } },
          discipleship_signals: { type: 'array', items: { type: 'string' } },
          missional_signals:    { type: 'array', items: { type: 'string' } },
        },
      },
      cta_default: {
        type: 'string',
        description: 'The default site-wide primary CTA implied by the model: "Plan a Visit" (attractional) | "Take Your Next Step" (discipleship) | "Join the Mission" (missional). Replaceable per page; this is the starting point.',
      },
    },
  },
}

const SYSTEM_PROMPT = [
  'You are the Ministry Model Classifier. Read the church\'s mission, vision, x-factor signals, ethos atoms, recommended-page rationales, discovery answers, and crawl topic emphasis. Classify the church\'s DOMINANT ministry model into one of three archetypes:',
  '',
  '  attractional — "Get them in the room. Remove every barrier." The weekend is the front door. Signals:',
  '    • Mission language about reaching newcomers / first-time guests / removing barriers.',
  '    • Strong production / weekend experience emphasis.',
  '    • "Plan a Visit," "Watch Online," "what to expect" central.',
  '    • Discovery: top priority "attract new visitors," "easier for first-timers."',
  '    • Crawl: heavy weekend/event emphasis, less formation pathway content.',
  '',
  '  discipleship — "Move people from rows to circles along a pathway." Maturity over attendance. Signals:',
  '    • Named growth pathway (e.g., Connect → Grow → Reach; Know → Grow → Go).',
  '    • Mission emphasizes formation, maturity, "rows to circles."',
  '    • Groups, Starting Point class, Baptism, Membership are central next-steps.',
  '    • Discovery: top priority "deepen discipleship," "connect people into community."',
  '    • Crawl: groups + classes + formation rhythms prominent.',
  '',
  '  missional — "Equip and send people as leaders into culture." The church exists for the city + world. Signals:',
  '    • Mission language about the city, vocation, sending, leadership pipeline.',
  '    • Outreach / local-global / vocation sectors front and center.',
  '    • "Live sent," "for the city," "for the nations," "engage the city" phrases.',
  '    • Discovery: top priority "serve the community," "engage the city."',
  '    • Crawl: outreach + missions + sectors are headline content, not footer items.',
  '',
  'Rules:',
  '- ONE dominant model. Pick the SINGLE strongest fit even when signals overlap.',
  '- secondary_blend names the second-strongest. Most churches blend two; emit unless the church is genuinely single-model.',
  '- Quote verbatim in rationale + evidence. Don\'t paraphrase the atom — the strategist needs to see the literal signal.',
  '- When evidence is thin or contradictory, return confidence=low and default to attractional (the safest fallback for newcomer-facing copy).',
  '- DO NOT emit a "this church is broken" judgment. Every church has a model; your job is to NAME it accurately.',
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

  // ── Load READ-ONLY inputs in parallel ──────────────────────────────
  const { data: project } = await sb.from('strategy_web_projects')
    .select('id, member, name, roadmap_state').eq('id', projectId).maybeSingle()
  if (!project) return res.status(404).json({ error: 'Project not found' })

  const member = project.member as number
  const [atomsRes, discoveryRes, topicsRes] = await Promise.all([
    // Atoms whose topics carry the strongest model signal.
    sb.from('content_atoms')
      .select('topic, body, verbatim, source_kind')
      .eq('web_project_id', projectId)
      .in('topic', ['mission_statement', 'vision_statement', 'x_factor', 'ethos', 'recommended_page', 'value_statement', 'tone_descriptor']),
    sb.from('strategy_discovery_questionnaire')
      .select('top_website_priority, top_3_website_goals, copy_approach, ideal_website_experience, words_tones_to_avoid')
      .eq('member', member).order('submitted_at', { ascending: false }).limit(1).maybeSingle(),
    // Crawl topics — slim to topic_label + topic_group + passage count.
    sb.from('web_project_topics')
      .select('topic_key, topic_label, topic_group, passages, items, source_page_urls')
      .eq('web_project_id', projectId),
  ])
  const atoms     = atomsRes.data ?? []
  const discovery = discoveryRes.data ?? null
  const topics    = topicsRes.data ?? []

  // Slim crawl topics for the prompt — passage count + a sample so
  // the model sees what the live site emphasizes without the full
  // payload bloating tokens.
  const slimTopics = topics
    .filter((t: any) => (Array.isArray(t.passages) && t.passages.length > 0) || (Array.isArray(t.items) && t.items.length > 0))
    .map((t: any) => ({
      topic_label: t.topic_label,
      topic_group: t.topic_group,
      passage_count: Array.isArray(t.passages) ? t.passages.length : 0,
      passage_sample: Array.isArray(t.passages) ? t.passages.slice(0, 1) : null,
      url_count: Array.isArray(t.source_page_urls) ? t.source_page_urls.length : 0,
    }))

  const userText = [
    '# Discovery answers (partner-stated strategic intent)',
    discovery
      ? '```json\n' + JSON.stringify(discovery, null, 2) + '\n```'
      : '(no discovery questionnaire on file)',
    '',
    `# Content atoms — mission / vision / x-factor / ethos / values / recommended pages (${atoms.length} atoms)`,
    '```json',
    JSON.stringify(atoms, null, 2),
    '```',
    '',
    `# Crawl topics — what the partner's CURRENT live site emphasizes (${slimTopics.length} topics with content)`,
    '```json',
    JSON.stringify(slimTopics, null, 2),
    '```',
    '',
    "Classify the partner's dominant ministry model. Submit via submit_ministry_model.",
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
        submit_ministry_model: tool({
          description: TOOL.description,
          inputSchema: jsonSchema(TOOL.input_schema as any),
        }),
      },
      toolChoice: { type: 'tool', toolName: 'submit_ministry_model' },
    })
    usage = { input_tokens: result.usage?.inputTokens, output_tokens: result.usage?.outputTokens }
    const toolCall = result.toolCalls?.[0]
    if (!toolCall || toolCall.toolName !== 'submit_ministry_model') {
      throw new Error('Model did not return the expected tool call')
    }
    toolInput = toolCall.input
  } catch (err: any) {
    console.error('[determine-ministry-model] gateway error:', err?.message)
    return res.status(502).json({ error: `AI Gateway error: ${err?.message ?? 'unknown'}` })
  }

  // Preserve the strategist's prior override (if any) — overrides
  // survive auto-re-runs of this agent. Stamp _meta with auto vs
  // human source so downstream stages know which.
  const prior = (project.roadmap_state as any)?.ministry_model ?? null
  const override = prior?._meta?.user_override === true ? prior : null

  const ministryModel = override ?? {
    model:            toolInput?.model            ?? 'attractional',
    confidence:       toolInput?.confidence       ?? 'low',
    secondary_blend:  toolInput?.secondary_blend  ?? null,
    blend_notes:      toolInput?.blend_notes      ?? null,
    rationale:        toolInput?.rationale        ?? '',
    evidence:         toolInput?.evidence         ?? {},
    cta_default:      toolInput?.cta_default      ?? 'Plan a Visit',
    _meta: {
      generated_at: new Date().toISOString(),
      model:        MODEL,
      usage,
      user_override: false,
      inputs_used: {
        atom_count:     atoms.length,
        topic_count:    slimTopics.length,
        has_discovery:  !!discovery,
      },
    },
  }

  const nextState = {
    ...(project.roadmap_state ?? {}),
    ministry_model: ministryModel,
  }
  const { error: writeErr } = await sb.from('strategy_web_projects')
    .update({ roadmap_state: nextState }).eq('id', projectId)
  if (writeErr) return res.status(500).json({ error: `DB write failed: ${writeErr.message}` })

  return res.status(200).json({
    ok: true,
    ministry_model: ministryModel,
    overridden_by_user: !!override,
    usage,
  })
}
