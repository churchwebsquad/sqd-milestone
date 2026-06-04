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
import { resolvePromptServer } from './_lib/resolvePrompt'

export const maxDuration = 300
const MODEL = 'anthropic/claude-opus-4-7'
const MAX_OUTPUT_TOKENS = 12000

const DISPLAY_OPTIONS = [
  'card_grid','split_column','accordion','tabs','timeline',
  'cta_hero','feature_strip','staff_grid','gallery','rich_text_long','process_steps',
]

const TOOL = {
  description: 'Submit page outlines with display option suggestions for every page.',
  input_schema: {
    type: 'object',
    properties: {
      page_outlines: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            page_slug: { type: 'string' },
            sections: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  section_id:      { type: 'string' },
                  section_job:     { type: 'string' },
                  content_summary: { type: 'string' },
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
                required: ['section_id','section_job','content_summary','display_options','atoms_used'],
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

  const previous = redoContext ? roadmapState.stage_4 : undefined
  const resolved = await resolvePromptServer(sb, 'outlines', projectId)

  const userText = [
    `# Stage 1 strategy\n${JSON.stringify(stage1, null, 2)}`,
    `# Stage 2 sitemap\n${JSON.stringify(stage2, null, 2)}`,
    `# Stage 3 page inventory (atom placements)\n${JSON.stringify(stage3, null, 2)}`,
    `# Atoms\n${JSON.stringify(atomsRes.data ?? [], null, 2)}`,
    `# Facts\n${JSON.stringify(factsRes.data ?? [], null, 2)}`,
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
    redo_count: typeof (previous as any)?._meta?.redo_count === 'number'
      ? (previous as any)._meta.redo_count + (redoContext ? 1 : 0)
      : 0,
    usage,
  }

  const { error: writeErr } = await sb.from('strategy_web_projects')
    .update({
      roadmap_state: { ...(project.roadmap_state ?? {}), stage_4: { ...toolResult, _meta: meta } },
    })
    .eq('id', projectId)
  if (writeErr) return res.status(500).json({ error: `DB write failed: ${writeErr.message}` })

  return res.status(200).json({ ok: true, output: toolResult, usage })
}
