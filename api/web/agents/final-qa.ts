/**
 * Vercel Serverless Function — /api/web/agents/final-qa
 *
 * Stage 8 of the copywriting pipeline. Cross-page consistency,
 * persona coverage, merge-field resolution, nav-vs-page parity, and
 * SEO completeness. Writes to roadmap_state.stage_8.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { generateText, jsonSchema, tool } from 'ai'
import { resolvePromptServer } from './_lib/resolvePrompt'

export const maxDuration = 240
const MODEL = 'anthropic/claude-opus-4-7'
const MAX_OUTPUT_TOKENS = 8000

const TOOL = {
  description: 'Submit final-QA findings + scores.',
  input_schema: {
    type: 'object',
    properties: {
      findings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            severity:       { type: 'string', enum: ['blocker','warning','nit'] },
            page_slug:      { type: ['string','null'] },
            web_section_id: { type: ['string','null'] },
            category:       { type: 'string',
              enum: ['nav_parity','persona_coverage','voice_drift','merge_field','seo'] },
            issue:          { type: 'string' },
            suggested_fix:  { type: 'string' },
          },
          required: ['severity','category','issue','suggested_fix'],
        },
      },
      scores: {
        type: 'object',
        properties: {
          nav_parity:             { type: 'number' },
          persona_coverage:       { type: 'number' },
          voice_consistency:      { type: 'number' },
          merge_field_resolution: { type: 'number' },
          seo_completeness:       { type: 'number' },
          overall:                { type: 'number' },
        },
        required: ['nav_parity','persona_coverage','voice_consistency','merge_field_resolution','seo_completeness','overall'],
      },
    },
    required: ['findings','scores'],
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

  const roadmapState = (project.roadmap_state ?? {}) as Record<string, unknown>

  const { data: pages } = await sb.from('web_pages')
    .select('id, slug, name, seo').eq('web_project_id', projectId).eq('archived', false)
  const pageIds = (pages ?? []).map(p => p.id as string)
  const { data: sections } = await sb.from('web_sections')
    .select('id, web_page_id, content_template_id, field_values, sort_order')
    .eq('archived', false)
  const ourSections = (sections ?? []).filter(s => pageIds.includes(s.web_page_id as string))

  const { data: snippets } = await sb.from('web_project_snippets')
    .select('token, expansion').eq('web_project_id', projectId).eq('archived', false)

  const previous = redoContext ? roadmapState.stage_8 : undefined
  const resolved = await resolvePromptServer(sb, 'final_qa', projectId)

  const userText = [
    `# Stage 1\n${JSON.stringify(roadmapState.stage_1, null, 2)}`,
    `# Stage 2 sitemap\n${JSON.stringify(roadmapState.stage_2, null, 2)}`,
    `# Pages\n${JSON.stringify(pages ?? [], null, 2)}`,
    `# Sections\n${JSON.stringify(ourSections, null, 2)}`,
    `# Snippets (merge fields)\n${JSON.stringify(snippets ?? [], null, 2)}`,
    previous && `# Previous QA\n${JSON.stringify(previous, null, 2)}`,
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
        submit_final_qa: tool({
          description: TOOL.description,
          inputSchema: jsonSchema(TOOL.input_schema as any),
        }),
      },
      toolChoice: { type: 'tool', toolName: 'submit_final_qa' },
    })
    usage = { input_tokens: result.usage?.inputTokens, output_tokens: result.usage?.outputTokens }
    const toolCall = result.toolCalls?.[0]
    if (!toolCall || toolCall.toolName !== 'submit_final_qa') {
      throw new Error('Model did not return the expected tool call')
    }
    toolResult = toolCall.input as Record<string, unknown>
  } catch (err: any) {
    console.error('[final-qa] gateway error:', err?.message)
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
      roadmap_state: { ...(project.roadmap_state ?? {}), stage_8: { ...toolResult, _meta: meta } },
    })
    .eq('id', projectId)
  if (writeErr) return res.status(500).json({ error: `DB write failed: ${writeErr.message}` })

  return res.status(200).json({ ok: true, output: toolResult, usage })
}
