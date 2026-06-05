/**
 * Vercel Serverless Function — /api/web/agents/coverage-audit
 *
 * Stage 6 of the copywriting pipeline. After Stage 5 binds sections,
 * audits whether every content_atom + church_fact landed somewhere.
 * Surfaces orphans for strategist review. Writes to
 * roadmap_state.stage_6.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { generateText, jsonSchema, tool } from 'ai'
import { resolvePromptServer } from './_lib/resolvePrompt.js'

export const maxDuration = 180
const MODEL = 'anthropic/claude-opus-4-7'
const MAX_OUTPUT_TOKENS = 8000

const TOOL = {
  description: 'Submit coverage audit results.',
  input_schema: {
    type: 'object',
    properties: {
      landed: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            source_id:   { type: 'string' },
            source_kind: { type: 'string', enum: ['atom','fact'] },
            landed_in: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  web_section_id: { type: 'string' },
                  field_key:      { type: 'string' },
                  snippet:        { type: 'string' },
                },
                required: ['web_section_id','field_key','snippet'],
              },
            },
          },
          required: ['source_id','source_kind','landed_in'],
        },
      },
      partially_landed: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            source_id:    { type: 'string' },
            source_kind:  { type: 'string', enum: ['atom','fact'] },
            landed_in:    { type: 'array', items: { type: 'object',
              properties: { web_section_id: { type: 'string' }, field_key: { type: 'string' }, snippet: { type: 'string' } },
              required: ['web_section_id','field_key','snippet'] } },
            missing_info: { type: 'string' },
          },
          required: ['source_id','source_kind','landed_in','missing_info'],
        },
      },
      orphaned: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            source_id:        { type: 'string' },
            source_kind:      { type: 'string', enum: ['atom','fact'] },
            rationale:        { type: 'string' },
            suggested_remedy: { type: 'string',
              enum: ['reroute','request_partner_content','archive','add_new_section'] },
          },
          required: ['source_id','source_kind','rationale','suggested_remedy'],
        },
      },
      total_score: { type: 'number' },
    },
    required: ['landed','partially_landed','orphaned','total_score'],
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
  if (!roadmapState.stage_5) {
    return res.status(400).json({ error: 'Stage 5 must complete before Stage 6 can audit.' })
  }

  const [atomsRes, factsRes, pagesRes, sectionsRes] = await Promise.all([
    sb.from('content_atoms').select('id, topic, body').eq('web_project_id', projectId),
    sb.from('church_facts').select('id, topic, data').eq('web_project_id', projectId),
    sb.from('web_pages').select('id, slug, name').eq('web_project_id', projectId).eq('archived', false),
    sb.from('web_sections')
      .select('id, web_page_id, content_template_id, field_values, sort_order')
      .eq('archived', false),
  ])
  const pages    = (pagesRes.data ?? []) as Array<{ id: string }>
  const pageIds  = pages.map(p => p.id)
  const sections = ((sectionsRes.data ?? []) as Array<Record<string, unknown>>)
    .filter(s => pageIds.includes(s.web_page_id as string))

  const previous = redoContext ? roadmapState.stage_6 : undefined
  const resolved = await resolvePromptServer(sb, 'coverage_qa', projectId)

  const userText = [
    `# Atoms\n${JSON.stringify(atomsRes.data ?? [], null, 2)}`,
    `# Facts\n${JSON.stringify(factsRes.data ?? [], null, 2)}`,
    `# Pages\n${JSON.stringify(pagesRes.data ?? [], null, 2)}`,
    `# Sections (bound)\n${JSON.stringify(sections, null, 2)}`,
    previous && `# Previous audit\n${JSON.stringify(previous, null, 2)}`,
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
        submit_coverage_audit: tool({
          description: TOOL.description,
          inputSchema: jsonSchema(TOOL.input_schema as any),
        }),
      },
      toolChoice: { type: 'tool', toolName: 'submit_coverage_audit' },
    })
    usage = { input_tokens: result.usage?.inputTokens, output_tokens: result.usage?.outputTokens }
    const toolCall = result.toolCalls?.[0]
    if (!toolCall || toolCall.toolName !== 'submit_coverage_audit') {
      throw new Error('Model did not return the expected tool call')
    }
    toolResult = toolCall.input as Record<string, unknown>
  } catch (err: any) {
    console.error('[coverage-audit] gateway error:', err?.message)
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
      roadmap_state: { ...(project.roadmap_state ?? {}), stage_6: { ...toolResult, _meta: meta } },
    })
    .eq('id', projectId)
  if (writeErr) return res.status(500).json({ error: `DB write failed: ${writeErr.message}` })

  return res.status(200).json({ ok: true, output: toolResult, usage })
}
