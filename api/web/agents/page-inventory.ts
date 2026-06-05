/**
 * Vercel Serverless Function — /api/web/agents/page-inventory
 *
 * Stage 3 of the copywriting pipeline. Reads every content_atom +
 * church_fact for the project + the Stage 2 sitemap; decides which
 * page each item belongs on as its primary home plus optional
 * reference pages. Writes to roadmap_state.stage_3.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { generateText, jsonSchema, tool } from 'ai'
import { resolvePromptServer } from './_lib/resolvePrompt.js'

export const maxDuration = 240
const MODEL = 'anthropic/claude-opus-4-7'
const MAX_OUTPUT_TOKENS = 8000

const TOOL = {
  description: 'Submit the page-inventory mapping for this project.',
  input_schema: {
    type: 'object',
    properties: {
      atom_placements: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            source_id:           { type: 'string' },
            source_kind:         { type: 'string', enum: ['atom'] },
            primary_page_slug:   { type: 'string' },
            reference_pages: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  slug: { type: 'string' },
                  treatment: { type: 'string',
                    enum: ['hero_anchor','section_body','card_in_grid','sidebar_callout','footer_link','cta_button','schema_only'] },
                },
                required: ['slug','treatment'],
              },
            },
            suggested_treatment: { type: 'string',
              enum: ['hero_anchor','section_body','card_in_grid','sidebar_callout','footer_link','cta_button','schema_only'] },
            rationale:           { type: 'string' },
          },
          required: ['source_id','source_kind','primary_page_slug','suggested_treatment','rationale'],
        },
      },
      fact_placements: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            source_id:           { type: 'string' },
            source_kind:         { type: 'string', enum: ['fact'] },
            primary_page_slug:   { type: 'string' },
            reference_pages: { type: 'array', items: { type: 'object',
              properties: { slug: { type: 'string' }, treatment: { type: 'string' } },
              required: ['slug','treatment'] } },
            suggested_treatment: { type: 'string' },
            rationale:           { type: 'string' },
          },
          required: ['source_id','source_kind','primary_page_slug','suggested_treatment','rationale'],
        },
      },
      orphans: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            source_id:        { type: 'string' },
            source_kind:      { type: 'string', enum: ['atom','fact'] },
            rationale:        { type: 'string' },
            suggested_action: { type: 'string',
              enum: ['archive','request_more_content','reroute_to_global_snippet'] },
          },
          required: ['source_id','source_kind','rationale','suggested_action'],
        },
      },
      per_page_atom_count: {
        type: 'object',
        additionalProperties: { type: 'number' },
      },
    },
    required: ['atom_placements','fact_placements','orphans','per_page_atom_count'],
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

  const authHeader = req.headers['authorization']
  const jwt = typeof authHeader === 'string' && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!jwt) return res.status(401).json({ error: 'Missing Authorization bearer token' })

  const authClient = createClient(supabaseUrl, anonKey)
  const { data: userData, error: userErr } = await authClient.auth.getUser(jwt)
  if (userErr || !userData?.user) return res.status(401).json({ error: 'Invalid session' })

  const projectId   = typeof req.body?.projectId === 'string' ? req.body.projectId : null
  const redoContext = typeof req.body?.redoContext === 'string' ? req.body.redoContext.trim() : ''
  if (!projectId) return res.status(400).json({ error: 'projectId required' })

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  // ── Load project + stage_1 + stage_2 + atoms + facts ───────────────
  const { data: project, error: projErr } = await sb
    .from('strategy_web_projects').select('*').eq('id', projectId).maybeSingle()
  if (projErr || !project) return res.status(404).json({ error: projErr?.message ?? 'Project not found' })

  const roadmapState = (project.roadmap_state ?? {}) as Record<string, unknown>
  const stage1 = roadmapState.stage_1 as Record<string, unknown> | undefined
  const stage2 = roadmapState.stage_2 as Record<string, unknown> | undefined
  if (!stage1 || !stage2) {
    return res.status(400).json({
      error: 'Stages 1 + 2 must be complete before Stage 3 can run.',
      missing: [!stage1 && 'stage_1', !stage2 && 'stage_2'].filter(Boolean),
    })
  }

  const [atomsRes, factsRes] = await Promise.all([
    sb.from('content_atoms').select('*').eq('web_project_id', projectId),
    sb.from('church_facts').select('*').eq('web_project_id', projectId),
  ])
  const atoms = (atomsRes.data ?? []) as Array<Record<string, unknown>>
  const facts = (factsRes.data ?? []) as Array<Record<string, unknown>>

  if (atoms.length === 0 && facts.length === 0) {
    return res.status(400).json({
      error: 'No content atoms or church facts found. Run the intake normalizer first.',
    })
  }

  const previous = redoContext
    ? (roadmapState.stage_3 as Record<string, unknown> | undefined)
    : undefined

  // ── Resolve system prompt ───────────────────────────────────────────
  const resolved = await resolvePromptServer(sb, 'page_inventory', projectId)

  // ── Build user content ──────────────────────────────────────────────
  const userText = [
    `# Project\n${JSON.stringify({
      member: project.member, name: project.name, kind: project.kind,
    }, null, 2)}`,
    `# Stage 1 strategy\n${JSON.stringify(stage1, null, 2)}`,
    `# Stage 2 sitemap\n${JSON.stringify(stage2, null, 2)}`,
    `# Content atoms (${atoms.length})\n${JSON.stringify(atoms.map(a => ({
      id: a.id, topic: a.topic, body: a.body, source_kind: a.source_kind,
    })), null, 2)}`,
    `# Church facts (${facts.length})\n${JSON.stringify(facts.map(f => ({
      id: f.id, topic: f.topic, data: f.data,
    })), null, 2)}`,
    previous && `# Previous draft (refine, don't restart)\n${JSON.stringify(previous, null, 2)}`,
    redoContext && `# Strategist redo feedback\n${redoContext}`,
  ].filter(Boolean).join('\n\n')

  // ── Call model ──────────────────────────────────────────────────────
  let toolResult: Record<string, unknown> | null = null
  let usage: { input_tokens?: number; output_tokens?: number } = {}
  try {
    const result = await generateText({
      model: MODEL,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      system: resolved.systemPrompt,
      messages: [{ role: 'user', content: userText }],
      tools: {
        submit_page_inventory: tool({
          description: TOOL.description,
          inputSchema: jsonSchema(TOOL.input_schema as any),
        }),
      },
      toolChoice: { type: 'tool', toolName: 'submit_page_inventory' },
    })
    usage = {
      input_tokens:  result.usage?.inputTokens,
      output_tokens: result.usage?.outputTokens,
    }
    const toolCall = result.toolCalls?.[0]
    if (!toolCall || toolCall.toolName !== 'submit_page_inventory') {
      throw new Error('Model did not return the expected tool call')
    }
    toolResult = toolCall.input as Record<string, unknown>
  } catch (err: any) {
    console.error('[page-inventory] gateway error:', err?.message)
    return res.status(502).json({ error: `AI Gateway error: ${err?.message ?? 'unknown'}` })
  }

  // ── Persist ─────────────────────────────────────────────────────────
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

  const { error: writeErr } = await sb
    .from('strategy_web_projects')
    .update({
      roadmap_state: {
        ...(project.roadmap_state ?? {}),
        stage_3: { ...toolResult, _meta: meta },
      },
    })
    .eq('id', projectId)

  if (writeErr) {
    console.error('[page-inventory] DB write error:', writeErr.message)
    return res.status(500).json({ error: `DB write failed: ${writeErr.message}` })
  }

  return res.status(200).json({ ok: true, output: toolResult, usage })
}
