/**
 * Vercel Serverless Function — /api/web/agents/sitemap-coverage
 *
 * Stage 2.5 of the copywriting pipeline. Cross-checks Stage 0 atoms +
 * Stage 0 crawl topics against the Stage 2 sitemap. Emits a per-topic
 * coverage audit so the strategist can catch absorbed-but-invisible
 * audiences, orphaned topics, and weak anchor-nav before Stage 3+ work.
 * Writes to roadmap_state.stage_2_5.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { generateText, jsonSchema, tool } from 'ai'
import { resolvePromptServer } from './_lib/resolvePrompt'

export const maxDuration = 180
const MODEL = 'anthropic/claude-opus-4-7'
const MAX_OUTPUT_TOKENS = 12000

const TOOL = {
  description: 'Submit the per-topic sitemap coverage audit.',
  input_schema: {
    type: 'object',
    properties: {
      topic_audit: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            topic_key:        { type: 'string' },
            topic_label:      { type: 'string' },
            topic_group:      { type: 'string' },
            atom_count:       { type: 'number' },
            fact_count:       { type: 'number' },
            crawl_passages:   { type: 'number' },
            crawl_coverage:   { type: ['string','null'], enum: ['rich','covered','partial','sparse','gap',null] },
            importance:       { type: 'string', enum: ['high','medium','low'] },
            destination_kind: { type: 'string',
              enum: ['dedicated_page','anchored_section','nav_only','orphan','intentional_omission'] },
            destination_slug:   { type: ['string','null'] },
            destination_anchor: { type: ['string','null'] },
            nav_reference: { type: 'string',
              enum: ['header','footer','in_page_grid','breadcrumb_from_related','none'] },
            findable_score: { type: 'number', minimum: 0, maximum: 1 },
            rationale:      { type: 'string' },
          },
          required: ['topic_key','topic_label','importance','destination_kind',
                     'nav_reference','findable_score','rationale'],
        },
      },
      summary: {
        type: 'object',
        properties: {
          total_topics:           { type: 'number' },
          dedicated_pages:        { type: 'number' },
          anchored_sections:      { type: 'number' },
          nav_only:               { type: 'number' },
          orphans:                { type: 'number' },
          intentional_omissions:  { type: 'number' },
          gaps_count:             { type: 'number' },
          average_findable_score: { type: 'number', minimum: 0, maximum: 1 },
          overall_coverage_score: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['total_topics','gaps_count','overall_coverage_score'],
      },
      gaps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            topic_key:     { type: 'string' },
            topic_label:   { type: 'string' },
            importance:    { type: 'string', enum: ['high','medium','low'] },
            why_a_gap:     { type: 'string' },
            suggested_fix: { type: 'string' },
          },
          required: ['topic_key','topic_label','importance','why_a_gap','suggested_fix'],
        },
      },
      recommended_action: { type: 'string',
        enum: ['proceed_to_stage_3','redo_stage_2_with_gaps'] },
    },
    required: ['topic_audit','summary','gaps','recommended_action'],
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
  if (!projectId) return res.status(400).json({ error: 'projectId required' })

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  const { data: project } = await sb.from('strategy_web_projects')
    .select('*').eq('id', projectId).maybeSingle()
  if (!project) return res.status(404).json({ error: 'Project not found' })

  const roadmapState = (project.roadmap_state ?? {}) as Record<string, any>
  if (!roadmapState.stage_2) {
    return res.status(400).json({ error: 'Stage 2 sitemap must complete before the coverage audit can run.' })
  }

  const [atomsRes, factsRes, topicsRes] = await Promise.all([
    sb.from('content_atoms').select('id, topic, body, metadata').eq('web_project_id', projectId),
    sb.from('church_facts').select('id, topic, data').eq('web_project_id', projectId),
    sb.from('web_project_topics').select('topic_key, topic_label, topic_group, coverage_status, inventory_kind, passages, items, source_page_urls').eq('web_project_id', projectId),
  ])

  const previous = redoContext ? roadmapState.stage_2_5 : undefined
  const resolved = await resolvePromptServer(sb, 'sitemap_coverage', projectId)

  // Trim crawl topic passage bodies to keep tokens reasonable; the audit
  // only needs to know passage COUNT + a sample, not every word.
  const topicsSlim = (topicsRes.data ?? []).map((t: any) => ({
    topic_key: t.topic_key, topic_label: t.topic_label, topic_group: t.topic_group,
    coverage_status: t.coverage_status, inventory_kind: t.inventory_kind,
    passage_count: Array.isArray(t.passages) ? t.passages.length : 0,
    passage_sample: Array.isArray(t.passages) ? t.passages.slice(0, 2) : null,
    items_count: Array.isArray(t.items) ? t.items.length : 0,
    source_url_count: Array.isArray(t.source_page_urls) ? t.source_page_urls.length : 0,
  }))

  const stage2 = roadmapState.stage_2
  const stage2Slim = {
    pages:                stage2.pages,
    header_nav:           stage2.header_nav,
    footer_nav:           stage2.footer_nav,
    absorbed_content:     stage2.absorbed_content,
    vocabulary_decisions: stage2.vocabulary_decisions,
    phase_summary:        stage2.phase_summary,
  }

  const userText = [
    `# Stage 0 — content atoms (${atomsRes.data?.length ?? 0})\n` +
    `\`\`\`json\n${JSON.stringify(atomsRes.data ?? [], null, 2)}\n\`\`\``,
    `# Stage 0 — church facts (${factsRes.data?.length ?? 0})\n` +
    `\`\`\`json\n${JSON.stringify(factsRes.data ?? [], null, 2)}\n\`\`\``,
    `# Stage 0 — crawl topics (${topicsSlim.length})\n` +
    `\`\`\`json\n${JSON.stringify(topicsSlim, null, 2)}\n\`\`\``,
    `# Stage 2 — sitemap\n\`\`\`json\n${JSON.stringify(stage2Slim, null, 2)}\n\`\`\``,
    previous && `# Previous audit (refine, don't restart)\n\`\`\`json\n${JSON.stringify(previous, null, 2)}\n\`\`\``,
    redoContext && `# Strategist redo feedback\n${redoContext}`,
  ].filter(Boolean).join('\n\n')

  let toolResult: Record<string, any> | null = null
  let usage: { input_tokens?: number; output_tokens?: number } = {}
  try {
    const result = await generateText({
      model: MODEL,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      system: resolved.systemPrompt,
      messages: [{ role: 'user', content: userText }],
      tools: {
        submit_sitemap_coverage: tool({
          description: TOOL.description,
          inputSchema: jsonSchema(TOOL.input_schema as any),
        }),
      },
      toolChoice: { type: 'tool', toolName: 'submit_sitemap_coverage' },
    })
    usage = { input_tokens: result.usage?.inputTokens, output_tokens: result.usage?.outputTokens }
    const toolCall = result.toolCalls?.[0]
    if (!toolCall || toolCall.toolName !== 'submit_sitemap_coverage') {
      throw new Error('Model did not return the expected tool call')
    }
    toolResult = toolCall.input as Record<string, any>
  } catch (err: any) {
    console.error('[sitemap-coverage] gateway error:', err?.message)
    return res.status(502).json({ error: `AI Gateway error: ${err?.message ?? 'unknown'}` })
  }

  const meta = {
    status: 'draft',
    generated_at: new Date().toISOString(),
    model: MODEL,
    prompt_source: resolved.globalSource,
    has_project_addendum: resolved.hasProjectAddendum,
    redo_count: typeof (previous as any)?._meta?.redo_count === 'number'
      ? (previous as any)._meta.redo_count + (redoContext ? 1 : 0)
      : 0,
    usage,
  }

  const { error: writeErr } = await sb.from('strategy_web_projects')
    .update({
      roadmap_state: { ...(project.roadmap_state ?? {}), stage_2_5: { ...toolResult, _meta: meta } },
    })
    .eq('id', projectId)
  if (writeErr) return res.status(500).json({ error: `DB write failed: ${writeErr.message}` })

  return res.status(200).json({ ok: true, output: toolResult, usage })
}
