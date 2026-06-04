/**
 * Vercel Serverless Function — /api/web/agents/normalize-intake
 *
 * Stage 0 of the copywriting pipeline. Atomizes raw intake into
 * content_atoms + church_facts that Stages 3 + 6 consume. Same
 * intake pre-flight as Stage 1 (strategy brief required; brand
 * source from either published guide OR handoff_brand_form).
 *
 * Idempotent: deletes any previously-emitted atoms + facts for the
 * project before writing new ones. Strategist can re-run as many
 * times as needed.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { generateText, jsonSchema, tool } from 'ai'
import { resolvePromptServer } from './_lib/resolvePrompt'

export const maxDuration = 300
const MODEL = 'anthropic/claude-opus-4-7'
const MAX_OUTPUT_TOKENS = 24000  // ~90 atoms + ~30 facts fits comfortably

const TEXT_FORMATS = new Set(['text/plain','text/markdown','text/x-markdown','text/csv'])
const PDF_FORMAT = 'application/pdf'

const TOOL = {
  description: 'Submit normalized intake — atoms + facts.',
  input_schema: {
    type: 'object',
    properties: {
      atoms: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            topic: {
              type: 'string',
              enum: [
                'persona','voice_rule','mission_statement','vision_statement',
                'x_factor','denominational_signal','recommended_page',
                'tone_descriptor','prose_snippet','voice_sample','ethos',
                'story','value_statement',
              ],
            },
            body:        { type: 'string' },
            metadata:    { type: 'object', additionalProperties: true },
            source_kind: { type: 'string', enum:
              ['strategy_brief','brand_handoff','discovery_questionnaire','am_handoff','content_collection'] },
            source_ref:  { type: 'string' },
            verbatim:    { type: 'boolean' },
            confidence:  { type: 'number', minimum: 0, maximum: 1 },
          },
          required: ['topic','body','source_kind','verbatim','confidence'],
        },
      },
      facts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            topic: {
              type: 'string',
              enum: [
                'service_time','campus','ministry','staff','belief',
                'program','milestone','contact_method','branded_term',
                'audience','location_detail','partnership','testimonial',
              ],
            },
            data:        { type: 'object', additionalProperties: true },
            source_kind: { type: 'string' },
            source_ref:  { type: 'string' },
          },
          required: ['topic','data','source_kind'],
        },
      },
      summary: {
        type: 'object',
        properties: {
          atom_count_by_topic: { type: 'object', additionalProperties: { type: 'number' } },
          fact_count_by_topic: { type: 'object', additionalProperties: { type: 'number' } },
          gaps_noted:          { type: 'array', items: { type: 'string' } },
        },
      },
    },
    required: ['atoms','facts'],
  },
}

async function loadIntakeFiles(docs: any[]): Promise<any[]> {
  const loaded: any[] = []
  await Promise.all(docs.map(async (doc: any) => {
    const base = {
      category: doc.category, filename: doc.filename,
      mime_type: doc.mime_type, storage_url: doc.storage_url,
    }
    try {
      const r = await fetch(doc.storage_url)
      if (!r.ok) throw new Error(`Fetch ${r.status}`)
      if (TEXT_FORMATS.has(doc.mime_type ?? '') || /\.(md|txt|csv|markdown)$/i.test(doc.filename)) {
        loaded.push({ ...base, text: await r.text() })
      } else if (doc.mime_type === PDF_FORMAT || doc.filename.toLowerCase().endsWith('.pdf')) {
        const ab = await r.arrayBuffer()
        loaded.push({ ...base, base64: Buffer.from(ab).toString('base64') })
      }
    } catch {
      // silently skip; pre-flight already validated presence
    }
  }))
  return loaded
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

  const member = project.member as number
  const [accountRes, brandRes, discoveryRes, intakeDocsRes] = await Promise.all([
    sb.from('strategy_account_progress').select('member, handoff_web_form, handoff_brand_form').eq('member', member).maybeSingle(),
    sb.from('strategy_brand_guides').select('*').eq('member', member).eq('is_published', true).order('last_updated_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('strategy_discovery_questionnaire').select('*').eq('member', member).order('submitted_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('web_intake_documents').select('*').eq('web_project_id', projectId).eq('archived', false),
  ])

  const brandHandoffForm = accountRes.data?.handoff_brand_form ?? null
  const brandGuide       = brandRes.data ?? null
  const intakeDocs       = intakeDocsRes.data ?? []

  // Same minimum-intake pre-flight as Stage 1 (loosened to accept handoff_brand_form).
  const missing: string[] = []
  if (!discoveryRes.data && !intakeDocs.some(d => d.category === 'discovery_questionnaire_supplemental')) {
    missing.push('Discovery questionnaire')
  }
  if (!brandGuide && !brandHandoffForm) missing.push('Brand source (published guide OR handoff_brand_form)')
  if (!intakeDocs.some(d => d.category === 'strategy_brief')) missing.push('Strategy brief')
  if (missing.length > 0) {
    return res.status(400).json({ error: 'Required intake sources missing', missing })
  }

  const filesLoaded = await loadIntakeFiles(intakeDocs)
  const resolved    = await resolvePromptServer(sb, 'normalize', projectId)
  const previous    = redoContext
    ? (project.roadmap_state as Record<string, unknown>)?.stage_0
    : undefined

  // Build user content — all intake sources stacked.
  const userBlocks: Array<{ type: 'text', text: string } | { type: 'file', data: string, mediaType: string }> = []
  userBlocks.push({ type: 'text', text: `# Project\n${JSON.stringify({
    id: project.id, member: project.member, name: project.name, kind: project.kind,
  }, null, 2)}` })
  if (accountRes.data?.handoff_web_form) {
    userBlocks.push({ type: 'text', text: `# AM handoff (web)\n\`\`\`json\n${JSON.stringify(accountRes.data.handoff_web_form, null, 2)}\n\`\`\`` })
  }
  if (brandGuide) {
    userBlocks.push({ type: 'text', text: `# Brand guide (Brand Squad)\n\`\`\`json\n${JSON.stringify(brandGuide, null, 2)}\n\`\`\`` })
  } else if (brandHandoffForm) {
    userBlocks.push({ type: 'text', text: `# Brand handoff (AM intake)\n\`\`\`json\n${JSON.stringify(brandHandoffForm, null, 2)}\n\`\`\`` })
  }
  if (discoveryRes.data) {
    userBlocks.push({ type: 'text', text: `# Discovery questionnaire\n\`\`\`json\n${JSON.stringify(discoveryRes.data, null, 2)}\n\`\`\`` })
  }
  for (const f of filesLoaded) {
    if (f.text) {
      userBlocks.push({ type: 'text', text: `# Intake file (${f.category}): ${f.filename}\n\n${f.text}` })
    } else if (f.base64) {
      userBlocks.push({ type: 'file', data: f.base64, mediaType: f.mime_type ?? 'application/pdf' })
    }
  }
  if (previous) {
    userBlocks.push({ type: 'text', text: `# Previous normalization (refine, don't restart)\n\`\`\`json\n${JSON.stringify(previous, null, 2)}\n\`\`\`` })
  }
  if (redoContext) {
    userBlocks.push({ type: 'text', text: `# Strategist redo feedback\n${redoContext}` })
  }

  let toolResult: { atoms: any[]; facts: any[]; summary?: any } | null = null
  let usage: { input_tokens?: number; output_tokens?: number } = {}
  try {
    const result = await generateText({
      model: MODEL,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      system: resolved.systemPrompt,
      messages: [{ role: 'user', content: userBlocks as any }],
      tools: {
        submit_normalized_intake: tool({
          description: TOOL.description,
          inputSchema: jsonSchema(TOOL.input_schema as any),
        }),
      },
      toolChoice: { type: 'tool', toolName: 'submit_normalized_intake' },
    })
    usage = { input_tokens: result.usage?.inputTokens, output_tokens: result.usage?.outputTokens }
    const toolCall = result.toolCalls?.[0]
    if (!toolCall || toolCall.toolName !== 'submit_normalized_intake') {
      throw new Error('Model did not return the expected tool call')
    }
    toolResult = toolCall.input as { atoms: any[]; facts: any[]; summary?: any }
  } catch (err: any) {
    console.error('[normalize-intake] gateway error:', err?.message)
    return res.status(502).json({ error: `AI Gateway error: ${err?.message ?? 'unknown'}` })
  }

  // Idempotent write: blow away prior rows for this project, then insert.
  await sb.from('content_atoms').delete().eq('web_project_id', projectId)
  await sb.from('church_facts').delete().eq('web_project_id', projectId)

  const atomRows = (toolResult?.atoms ?? []).map(a => ({
    web_project_id: projectId,
    topic:          a.topic,
    body:           a.body,
    metadata:       a.metadata ?? null,
    source_kind:    a.source_kind ?? null,
    source_ref:     a.source_ref ?? null,
    verbatim:       a.verbatim === true,
    confidence:     typeof a.confidence === 'number' ? a.confidence : null,
  }))
  const factRows = (toolResult?.facts ?? []).map(f => ({
    web_project_id: projectId,
    topic:          f.topic,
    data:           f.data,
    source_kind:    f.source_kind ?? null,
    source_ref:     f.source_ref ?? null,
  }))

  if (atomRows.length > 0) {
    const { error } = await sb.from('content_atoms').insert(atomRows as never)
    if (error) return res.status(500).json({ error: `atoms insert: ${error.message}` })
  }
  if (factRows.length > 0) {
    const { error } = await sb.from('church_facts').insert(factRows as never)
    if (error) return res.status(500).json({ error: `facts insert: ${error.message}` })
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
    atom_count: atomRows.length,
    fact_count: factRows.length,
  }

  const { error: writeErr } = await sb.from('strategy_web_projects')
    .update({
      roadmap_state: {
        ...(project.roadmap_state ?? {}),
        stage_0: {
          summary: toolResult?.summary ?? null,
          _meta:   meta,
        },
      },
    })
    .eq('id', projectId)
  if (writeErr) return res.status(500).json({ error: `state write: ${writeErr.message}` })

  return res.status(200).json({
    ok: true,
    atoms: atomRows.length,
    facts: factRows.length,
    summary: toolResult?.summary ?? null,
    usage,
  })
}
