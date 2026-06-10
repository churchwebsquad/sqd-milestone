/**
 * Vercel Serverless Function — /api/web/agents/answer-content-collection
 *
 * Pre-populates Page 2 of the partner-facing Content Collection form
 * by reading the partner's uploaded intake files (strategy brief,
 * discovery questionnaire, AM handoff, brand handoff, content
 * collection uploads) and proposing answers per field.
 *
 * The agent does NOT auto-save. It returns a structured suggestions
 * payload that the ContentCollectionPage renders inline next to each
 * field — the partner reviews + accepts (auto-fills) or dismisses
 * each suggestion individually.
 *
 * Output shape: one entry per supported field, each carrying:
 *   - value: the proposed value (typed to match the form's schema)
 *   - confidence: 'high' | 'medium' | 'low'
 *   - source_quote: a verbatim snippet from the intake that supports
 *                   the answer, with the source category named
 *   - rationale: one sentence explaining the inference
 *
 * Skipped: fields the agent can't confidently answer from intake
 * (specific URLs, hosting credentials, etc.). The field is omitted
 * rather than emitted with empty/null — the form's existing
 * blank-by-default render handles the unfilled case.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { generateText, jsonSchema, tool } from 'ai'

export const maxDuration = 180

const MODEL = 'anthropic/claude-sonnet-4-6'
const MAX_OUTPUT_TOKENS = 6000

const TEXT_FORMATS = new Set([
  'text/plain', 'text/markdown', 'text/x-markdown', 'text/csv',
])
const PDF_FORMAT = 'application/pdf'

const SUGGEST_TOOL = {
  description: 'Submit proposed Page 2 answers, one per field. Omit fields the intake doesn\'t confidently answer.',
  input_schema: {
    type: 'object',
    required: ['suggestions'],
    properties: {
      suggestions: {
        type: 'array',
        description: 'One entry per field you have a confident answer for. Skip fields the intake doesn\'t address — don\'t emit empty placeholders.',
        items: {
          type: 'object',
          required: ['field', 'value', 'confidence', 'source_category', 'source_quote', 'rationale'],
          properties: {
            field: {
              type: 'string',
              enum: [
                'cms_managed_types',
                'blog_handling',
                'blog_existing_url',
                'blog_new_description',
                'events_display_preference',
                'events_external_url',
                'events_wordpress_source_of_truth',
                'sermons_display_preference',
                'sermons_external_url',
                'sermon_youtube_playlist_exists',
                'sermon_youtube_playlist_url',
                'groups_display_preference',
                'groups_external_url',
                'groups_wordpress_source_of_truth',
                'merch_store_url',
                'ministries_to_grow',
                'ministries_list_html',
                'discipleship_pathway_html',
              ],
            },
            // value type intentionally permissive — different fields
            // hold different shapes (string / string[] / boolean).
            // Callers validate per-field on accept.
            value: { description: 'Proposed value. String, string[], or boolean depending on the field schema.' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            source_category: {
              type: 'string',
              enum: ['strategy_brief', 'discovery_questionnaire_supplemental', 'am_handoff_supplemental', 'brand_handoff', 'content_collection', 'multiple', 'inferred'],
              description: 'Which intake category the answer came from. Use "multiple" when 2+ sources converge, "inferred" when no direct quote supports it.',
            },
            source_quote: {
              type: 'string',
              description: 'Verbatim quote (≤200 chars) from the intake that supports the answer. Empty string only when source_category="inferred".',
            },
            rationale: {
              type: 'string',
              description: 'One sentence: why this answer follows from the source. Surfaced to the partner in the suggestion card.',
            },
          },
        },
      },
      coverage_notes: {
        type: 'string',
        description: 'Optional. Up to 2 sentences on what the intake DID and DIDN\'T cover. Helps the partner know which fields they still need to think about.',
      },
    },
  },
}

const SYSTEM_PROMPT = [
  'You are the Content Collection auto-fill agent. Your job: read the partner\'s uploaded intake (strategy brief, discovery questionnaire, AM handoff, brand handoff, content collection uploads) and propose answers for the partner-facing Page 2 form.',
  '',
  'Rules:',
  '- Only propose a field when the intake gives you real signal. Empty placeholders are worse than nothing — the form already renders blank by default.',
  '- Quote VERBATIM from intake for source_quote. Trimmed to ≤200 chars. Skip ellipses; pick the most signal-dense fragment.',
  '- confidence calibration:',
  '    · high: a direct, unambiguous answer is in the intake.',
  '    · medium: the answer is implied or partial.',
  '    · low: educated guess from context — flag it as such so the partner pushes back.',
  '- For "ministries_to_grow", list ministries by name as a comma-separated string. Source: discovery_questionnaire (growth priorities), strategy_brief.',
  '- For "ministries_list_html" + "discipleship_pathway_html", generate clean HTML (a `<ul><li>...</li></ul>` for the list; a `<p>...</p>` or numbered `<ol>` for the pathway) — partner can edit before saving.',
  '- For "*_display_preference" enums, ONLY propose a value if the intake clearly says how the partner wants that content type handled. Don\'t guess — these are direct partner preferences.',
  '- For URL fields (blog_existing_url, events_external_url, etc.), only propose if the intake literally contains the URL string. No guessing.',
  '- coverage_notes: end with a one-sentence note about what the intake didn\'t cover (e.g., "Intake didn\'t address sermon archive or merch store preferences — partner will need to fill those manually").',
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

  // This endpoint is partner-facing — the partner accesses the Content
  // Collection form via a portal_token URL (no Supabase auth session).
  // We accept TWO auth shapes so the same agent can serve both:
  //   1. Authorization: Bearer <jwt>  — staff use
  //   2. body.portalToken + body.sessionId — partner use
  // Either path must end with a verified projectId the caller is
  // allowed to read.
  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  const jwt = (req.headers['authorization'] as string | undefined)?.replace(/^Bearer /, '') ?? null
  const portalToken = typeof req.body?.portalToken === 'string' ? req.body.portalToken.trim() : null
  const sessionId   = typeof req.body?.sessionId   === 'string' ? req.body.sessionId.trim()   : null
  const bodyProjectId = typeof req.body?.projectId === 'string' ? req.body.projectId : null
  const alreadyFilled = Array.isArray(req.body?.alreadyFilled) ? req.body.alreadyFilled : []

  let projectId: string | null = null

  if (jwt) {
    const { data: userData, error: userErr } = await createClient(supabaseUrl, anonKey).auth.getUser(jwt)
    if (userErr || !userData?.user) return res.status(401).json({ error: 'Invalid session' })
    projectId = bodyProjectId
    if (!projectId) return res.status(400).json({ error: 'projectId required' })
  } else if (portalToken && sessionId) {
    // Verify the portal token belongs to a partner who owns the session.
    const { data: partner, error: partnerErr } = await sb.from('strategy_account_progress')
      .select('member').eq('portal_token', portalToken).maybeSingle()
    if (partnerErr || !partner) return res.status(401).json({ error: 'Invalid portal token' })
    const { data: sessionRow, error: sessionErr } = await sb.from('strategy_content_collection_sessions')
      .select('web_project_id, member').eq('id', sessionId).maybeSingle()
    if (sessionErr || !sessionRow) return res.status(404).json({ error: 'Session not found' })
    if (sessionRow.member !== partner.member) {
      return res.status(403).json({ error: 'Session does not belong to this portal token' })
    }
    projectId = sessionRow.web_project_id as string
    if (!projectId) return res.status(400).json({ error: 'Session has no associated web project' })
  } else {
    return res.status(401).json({ error: 'Missing auth — provide either Authorization: Bearer <jwt> or body.portalToken + body.sessionId' })
  }

  // Load intake documents. We pull text directly + base64-encode PDFs
  // following the same pattern as extract-strategy.ts.
  const { data: docs, error: docsErr } = await sb
    .from('web_intake_documents')
    .select('id, category, filename, storage_url, mime_type')
    .eq('web_project_id', projectId)
  if (docsErr) return res.status(500).json({ error: `Could not load intake documents: ${docsErr.message}` })
  if (!Array.isArray(docs) || docs.length === 0) {
    return res.status(400).json({
      error: 'No intake documents uploaded yet — nothing to auto-fill from.',
      hint: 'Upload at least a strategy brief or discovery questionnaire to use this feature.',
    })
  }

  // Sort by category in priority order so the model reads strategy
  // brief / AM handoff before secondary uploads.
  const CATEGORY_PRIORITY = [
    'strategy_brief', 'am_handoff_supplemental', 'discovery_questionnaire_supplemental',
    'brand_handoff', 'content_collection',
  ]
  const sortedDocs = [...docs].sort((a: any, b: any) => {
    const ia = CATEGORY_PRIORITY.indexOf(a.category)
    const ib = CATEGORY_PRIORITY.indexOf(b.category)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  })

  // Fetch + format each file. Text inlines as a markdown block; PDFs
  // get base64'd and attached as a document content block.
  const userContent: Array<{ type: 'text'; text: string } | { type: 'file'; data: string; mediaType: string; filename?: string }> = []
  for (const doc of sortedDocs as any[]) {
    try {
      const r = await fetch(doc.storage_url)
      if (!r.ok) {
        userContent.push({ type: 'text', text: `# Source: ${doc.category} (${doc.filename})\n(File could not be fetched: HTTP ${r.status})` })
        continue
      }
      const mt = (doc.mime_type ?? '').toLowerCase()
      if (TEXT_FORMATS.has(mt)) {
        const text = await r.text()
        userContent.push({
          type: 'text',
          text: `# Source: ${doc.category} — ${doc.filename}\n\n${text}`,
        })
      } else if (mt === PDF_FORMAT) {
        const buf = await r.arrayBuffer()
        const base64 = Buffer.from(buf).toString('base64')
        userContent.push({
          type: 'text',
          text: `# Source: ${doc.category} — ${doc.filename} (PDF below)`,
        })
        userContent.push({
          type: 'file',
          data: `data:application/pdf;base64,${base64}`,
          mediaType: 'application/pdf',
          filename: doc.filename,
        })
      } else {
        userContent.push({
          type: 'text',
          text: `# Source: ${doc.category} — ${doc.filename}\n(Unsupported MIME type: ${doc.mime_type ?? 'unknown'} — skipped)`,
        })
      }
    } catch (e: any) {
      userContent.push({
        type: 'text',
        text: `# Source: ${doc.category} — ${doc.filename}\n(Fetch error: ${e?.message ?? 'unknown'})`,
      })
    }
  }

  // Trailing instruction so the model knows what to do with the
  // intake it just read.
  const alreadyFilledList = alreadyFilled.length > 0
    ? `\n\nFields the partner has ALREADY answered (skip these — don't propose over their answers): ${alreadyFilled.join(', ')}`
    : ''
  userContent.push({
    type: 'text',
    text: [
      '# Your task',
      '',
      'Read the intake above and propose Page 2 form answers for the partner. Submit via submit_content_collection_suggestions.',
      '',
      'Page 2 covers: blog handling (transfer / sermon_based / new), events display (external / embed / wordpress / none), sermons display (cta_only / embed_latest / wordpress), groups display (external / embed / wordpress / contact), CMS-managed types (multi-select: blog / events / sermons / groups / staff / ministries), ministries-to-grow, ministry list HTML, discipleship pathway HTML, plus URL fields.',
      '',
      'Skip a field if intake doesn\'t confidently answer it. Per-field confidence calibration matters — partners trust high more than low.',
      alreadyFilledList,
    ].join('\n'),
  })

  let toolInput: { suggestions: any[]; coverage_notes?: string } | null = null
  let usage: { input_tokens?: number; output_tokens?: number } = {}
  try {
    const result = await generateText({
      model: MODEL,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent as any }],
      tools: {
        submit_content_collection_suggestions: tool({
          description: SUGGEST_TOOL.description,
          inputSchema: jsonSchema(SUGGEST_TOOL.input_schema as any),
        }),
      },
      toolChoice: { type: 'tool', toolName: 'submit_content_collection_suggestions' },
    })
    usage = { input_tokens: result.usage?.inputTokens, output_tokens: result.usage?.outputTokens }
    const toolCall = result.toolCalls?.[0]
    if (!toolCall || toolCall.toolName !== 'submit_content_collection_suggestions') {
      throw new Error('Model did not return the expected tool call')
    }
    toolInput = toolCall.input as { suggestions: any[]; coverage_notes?: string }
  } catch (err: any) {
    console.error('[answer-content-collection] gateway error:', err?.message)
    return res.status(502).json({ error: `AI Gateway error: ${err?.message ?? 'unknown'}` })
  }

  // Strip out any suggestions targeting already-filled fields. The
  // model is instructed to skip these but we belt-and-suspenders.
  const filteredSuggestions = (Array.isArray(toolInput?.suggestions) ? toolInput.suggestions : [])
    .filter((s: any) => s && typeof s.field === 'string' && !alreadyFilled.includes(s.field))

  return res.status(200).json({
    ok: true,
    suggestions: filteredSuggestions,
    coverage_notes: toolInput?.coverage_notes ?? null,
    docs_read: sortedDocs.length,
    usage,
  })
}
