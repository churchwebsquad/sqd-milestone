/**
 * Vercel Serverless Function — /api/web/agents/extract-strategy
 *
 * Phase C-1: The first agent in the Content Manager's AI pipeline.
 * Reads everything the strategist + AM + partner submitted during
 * intake and synthesizes it into a structured strategic foundation
 * that subsequent agents (sitemap, journey, roadmap, copywriter)
 * build on.
 *
 * Source priority (when content disagrees):
 *   1. Strategy Brief  — the anchor. Mission, voice, community,
 *      personas all defer here.
 *   2. AM Handoff      — partner's real conversation with the AM.
 *      Outranks the discovery questionnaire on web specifics.
 *   3. Discovery Q     — partner's own words. Signals like
 *      "sermon-based blog" requested live here.
 *   4. Brand Handoff   — voice characteristics + style tags from
 *      Brand Squad.
 *   5. Content Collection — every fact must find a home on the new
 *      site. Drives display-mode decisions for sermons / events /
 *      groups.
 *
 * Pre-flight: every available intake source is loaded BEFORE Claude
 * is called. If any file is present but unreadable, the route fails
 * with a clear error listing what couldn't be parsed — never silently
 * skip a source on a foundational step.
 *
 * Output: structured JSON via Claude tool_use, written to
 * strategy_web_projects.roadmap_state.stage_1. Stage flips from
 * 'extracting_strategy' → 'strategy_done'.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { generateText, jsonSchema, tool } from 'ai'

// Vercel AI Gateway routes by `provider/model` slug. The gateway auths
// via AI_GATEWAY_API_KEY locally and VERCEL_OIDC_TOKEN on Vercel deploys
// — the AI SDK picks whichever is present, so no provider client setup.
const MODEL = 'anthropic/claude-opus-4-7'
const MAX_OUTPUT_TOKENS = 8000

// File formats we can feed Claude without an external parser
const TEXT_FORMATS = new Set([
  'text/plain', 'text/markdown', 'text/x-markdown', 'text/csv',
])
const PDF_FORMAT = 'application/pdf'
// Formats we can't yet decode inline — flagged in pre-flight
const UNSUPPORTED_FORMATS = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

interface PreflightFile {
  category: 'strategy_brief' | 'content_collection' | 'discovery_questionnaire_supplemental' | 'am_handoff_supplemental'
  filename: string
  mime_type: string | null
  storage_url: string
  /** Successfully decoded plain text — when not present, content_base64 + format may apply */
  text?: string
  /** PDF / image base64 for native Anthropic doc input */
  base64?: string
  /** Why this file couldn't be read */
  error?: string
}

interface PreflightReport {
  ok: boolean
  files_loaded: PreflightFile[]
  files_failed: PreflightFile[]
  /** Sources missing entirely (not files — DB-sourced inputs) */
  missing_sources: string[]
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  // AI Gateway accepts either an explicit API key (local dev) or the
  // Vercel-managed OIDC token (production deploys auto-inject). Either is fine.
  const gatewayKey = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN
  const missing: string[] = []
  if (!supabaseUrl) missing.push('VITE_SUPABASE_URL')
  if (!anonKey) missing.push('VITE_SUPABASE_ANON_KEY')
  if (!serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY')
  if (!gatewayKey) missing.push('AI_GATEWAY_API_KEY (or VERCEL_OIDC_TOKEN on Vercel)')
  if (missing.length) {
    return res.status(500).json({ error: `Missing required environment variables: ${missing.join(', ')}` })
  }

  // ── Auth ────────────────────────────────────────────────────────────
  const authHeader = req.headers['authorization']
  const jwt = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null
  if (!jwt) return res.status(401).json({ error: 'Missing Authorization bearer token' })

  const authClient = createClient(supabaseUrl, anonKey)
  const { data: userData, error: userErr } = await authClient.auth.getUser(jwt)
  if (userErr || !userData?.user) return res.status(401).json({ error: 'Invalid session' })

  // ── Input ───────────────────────────────────────────────────────────
  const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : null
  const redoContext = typeof req.body?.redoContext === 'string' ? req.body.redoContext.trim() : ''
  const mock = req.body?.mock === true
  if (!projectId) return res.status(400).json({ error: 'projectId required' })

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  // ── Load project ────────────────────────────────────────────────────
  const { data: project, error: projErr } = await sb
    .from('strategy_web_projects')
    .select('*')
    .eq('id', projectId)
    .maybeSingle()
  if (projErr || !project) return res.status(404).json({ error: projErr?.message ?? 'Project not found' })

  // ── Mock short-circuit ──────────────────────────────────────────────
  // Bypass intake pre-flight + Anthropic. Lets strategists test the UI
  // flow downstream of Stage 1 (Stage 2/3/4/5, roadmap auto-fill, etc.)
  // without burning credits or needing complete intake.
  if (mock) {
    const cannedExtraction = buildMockExtraction(project)
    // Same auto-fill behavior as the real path, so mock runs fully exercise the UI.
    const existingProps = (project.roadmap_properties ?? {}) as Record<string, string>
    const derivedProps = deriveRoadmapProperties(cannedExtraction, null, project)
    const mergedProps: Record<string, string> = { ...existingProps }
    for (const [k, v] of Object.entries(derivedProps)) {
      if (v && !mergedProps[k]) mergedProps[k] = v
    }
    const derivedOpening = deriveOpeningParagraph(cannedExtraction)
    const openingToWrite = project.roadmap_opening_paragraph || derivedOpening || null

    const { error: writeErr } = await sb
      .from('strategy_web_projects')
      .update({
        roadmap_state: {
          ...(project.roadmap_state ?? {}),
          stage_1: {
            ...cannedExtraction,
            _meta: {
              model: 'mock',
              usage: { input_tokens: 0, output_tokens: 0 },
              extracted_at: new Date().toISOString(),
              redo_context: null,
              files_loaded: [],
              mocked: true,
            },
          },
        },
        roadmap_stage: 'strategy_done',
        roadmap_opening_paragraph: openingToWrite,
        roadmap_properties: mergedProps,
      })
      .eq('id', projectId)
    if (writeErr) return res.status(500).json({ error: `DB write failed: ${writeErr.message}` })
    return res.status(200).json({
      ok: true,
      extraction: cannedExtraction,
      usage: { input_tokens: 0, output_tokens: 0 },
      files_loaded: [],
      mock: true,
    })
  }

  // ── Load intake from DB ─────────────────────────────────────────────
  const member = project.member as number
  const [accountRes, brandRes, discoveryRes, intakeDocsRes] = await Promise.all([
    sb.from('strategy_account_progress').select('member, handoff_web_form').eq('member', member).maybeSingle(),
    sb.from('strategy_brand_guides').select('*').eq('member', member).eq('is_published', true).order('last_updated_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('strategy_discovery_questionnaire').select('*').eq('member', member).order('submitted_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('web_intake_documents').select('*').eq('web_project_id', projectId).eq('archived', false).order('uploaded_at', { ascending: false }),
  ])

  const accountHandoff = accountRes.data?.handoff_web_form ?? null
  const brandGuide = brandRes.data ?? null
  const discoveryQuestionnaire = discoveryRes.data ?? null
  const intakeDocs = intakeDocsRes.data ?? []

  // ── Pre-flight: check required sources + load all uploaded files ────
  const missing_sources: string[] = []
  if (!discoveryQuestionnaire && !intakeDocs.some(d => d.category === 'discovery_questionnaire_supplemental')) {
    missing_sources.push('Discovery questionnaire (DB row or supplemental upload)')
  }
  if (!brandGuide) missing_sources.push('Brand handoff (no published strategy_brand_guides row)')
  if (!intakeDocs.some(d => d.category === 'strategy_brief')) {
    missing_sources.push('Strategy brief (no uploaded file)')
  }

  if (missing_sources.length > 0) {
    return res.status(400).json({
      error: 'Required intake sources are missing. Cannot extract strategy.',
      missing_sources,
    })
  }

  // Load file contents in parallel — flag any that fail
  const filesLoaded: PreflightFile[] = []
  const filesFailed: PreflightFile[] = []

  await Promise.all(intakeDocs.map(async (doc: any) => {
    const base: PreflightFile = {
      category: doc.category,
      filename: doc.filename,
      mime_type: doc.mime_type,
      storage_url: doc.storage_url,
    }
    try {
      if (UNSUPPORTED_FORMATS.has(doc.mime_type ?? '')) {
        filesFailed.push({ ...base, error: `Format not yet supported by extractor: ${doc.mime_type}. Convert to .pdf or .md.` })
        return
      }
      const r = await fetch(doc.storage_url)
      if (!r.ok) throw new Error(`Fetch ${r.status}`)
      if (TEXT_FORMATS.has(doc.mime_type ?? '') || /\.(md|txt|csv|markdown)$/i.test(doc.filename)) {
        const text = await r.text()
        filesLoaded.push({ ...base, text })
      } else if (doc.mime_type === PDF_FORMAT || doc.filename.toLowerCase().endsWith('.pdf')) {
        const ab = await r.arrayBuffer()
        const base64 = Buffer.from(ab).toString('base64')
        filesLoaded.push({ ...base, base64 })
      } else {
        filesFailed.push({ ...base, error: `Unrecognized format: ${doc.mime_type ?? 'unknown'}` })
      }
    } catch (e) {
      filesFailed.push({ ...base, error: e instanceof Error ? e.message : 'Read failed' })
    }
  }))

  if (filesFailed.length > 0) {
    return res.status(400).json({
      error: 'One or more intake files could not be read. Stage 1 needs every available source — fix the failed files and retry.',
      files_failed: filesFailed.map(f => ({
        category: f.category, filename: f.filename, mime_type: f.mime_type, error: f.error,
      })),
      files_loaded_ok: filesLoaded.length,
    })
  }

  const preflight: PreflightReport = {
    ok: true,
    files_loaded: filesLoaded,
    files_failed: [],
    missing_sources: [],
  }

  // ── Mark stage as extracting ────────────────────────────────────────
  await sb.from('strategy_web_projects').update({ roadmap_stage: 'extracting_strategy' }).eq('id', projectId)

  // ── Build prompt + content blocks ───────────────────────────────────
  const systemPrompt = buildSystemPrompt()
  const userContent = buildUserContent({
    project, accountHandoff, brandGuide, discoveryQuestionnaire,
    filesLoaded: preflight.files_loaded,
    redoContext,
  })

  // ── Call model via AI Gateway ───────────────────────────────────────
  let toolResult: Record<string, unknown> | null = null
  let usage: { input_tokens?: number; output_tokens?: number } = {}
  try {
    const result = await generateText({
      model: MODEL,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent as any }],
      tools: {
        submit_strategy_extraction: tool({
          description: EXTRACTION_TOOL.description,
          inputSchema: jsonSchema(EXTRACTION_TOOL.input_schema as any),
        }),
      },
      toolChoice: { type: 'tool', toolName: 'submit_strategy_extraction' },
    })
    // AI SDK normalizes usage. Re-shape to the keys downstream code expects.
    usage = {
      input_tokens: result.usage?.inputTokens,
      output_tokens: result.usage?.outputTokens,
    }
    const toolCall = result.toolCalls?.[0]
    if (!toolCall || toolCall.toolName !== 'submit_strategy_extraction') {
      throw new Error('Model did not return the expected tool call')
    }
    toolResult = toolCall.input as Record<string, unknown>
  } catch (err: any) {
    // Restore stage so user can retry
    await sb.from('strategy_web_projects').update({ roadmap_stage: 'ready' }).eq('id', projectId)
    console.error('[extract-strategy] gateway error:', err?.message)
    return res.status(502).json({ error: `AI Gateway error: ${err?.message ?? 'unknown'}` })
  }

  // ── Persist + advance stage ─────────────────────────────────────────
  const roadmapStatePatch = {
    stage_1: {
      ...toolResult,
      _meta: {
        model: MODEL,
        usage,
        extracted_at: new Date().toISOString(),
        redo_context: redoContext || null,
        files_loaded: preflight.files_loaded.map(f => ({ category: f.category, filename: f.filename })),
      },
    },
  }

  // Auto-fill the partner-facing roadmap deliverable from the extraction.
  // Strategists can edit these afterward; we only fill empty fields so
  // we don't clobber anything the strategist has already typed.
  const existingProps = (project.roadmap_properties ?? {}) as Record<string, string>
  const derivedProps = deriveRoadmapProperties(toolResult, brandGuide, project)
  const mergedProps: Record<string, string> = { ...existingProps }
  for (const [k, v] of Object.entries(derivedProps)) {
    if (v && !mergedProps[k]) mergedProps[k] = v
  }

  const derivedOpening = deriveOpeningParagraph(toolResult)
  const openingToWrite = project.roadmap_opening_paragraph || derivedOpening || null

  const { error: writeErr } = await sb
    .from('strategy_web_projects')
    .update({
      roadmap_state: { ...(project.roadmap_state ?? {}), ...roadmapStatePatch },
      roadmap_stage: 'strategy_done',
      roadmap_opening_paragraph: openingToWrite,
      roadmap_properties: mergedProps,
    })
    .eq('id', projectId)

  if (writeErr) {
    console.error('[extract-strategy] DB write error:', writeErr.message)
    // Roll back stage so the project isn't stuck in `extracting_strategy`
    await sb.from('strategy_web_projects').update({ roadmap_stage: 'ready' }).eq('id', projectId)
    return res.status(500).json({ error: `DB write failed: ${writeErr.message}` })
  }

  return res.status(200).json({
    ok: true,
    extraction: toolResult,
    usage,
    files_loaded: preflight.files_loaded.map(f => ({ category: f.category, filename: f.filename })),
  })
}

// ── System prompt ─────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `You are the Strategy Extractor for Church Media Squad's Content Manager. You synthesize a partner church's intake materials into a structured strategic foundation that downstream agents (sitemap, user journey, per-page roadmap, copywriter) will build on.

# Source priority
When sources conflict, resolve in this order:
1. **Strategy Brief** — the anchor for mission, voice, community, personas. If Strategy Brief disagrees with anything below, Strategy Brief wins.
2. **AM Handoff** — notes from real Account Manager calls with the partner. On web specifics, AM Handoff outranks the Discovery Questionnaire.
3. **Discovery Questionnaire** — the partner's own words. Especially load-bearing for: sermon-based blog requests, audience self-description, denomination, mission/vision/values, and "what to avoid."
4. **Brand Handoff** — Brand Squad's published handoff. Voice characteristics + style tags.
5. **Content Collection** — every concrete fact (service times, ministries, staff, events, beliefs, giving). Drives display-mode decisions for sermons/events/groups. Nothing in here should be lost downstream.

# Outputs
Emit a single structured object via the \`submit_strategy_extraction\` tool. Cover:

- **Audience** — who this church is reaching (summary + segments + age distribution + geographic reach + online-vs-in-person notes)
- **Voice characteristics** — top attributes (3–5 chips), 2–3 sentence description, 4–6 Do examples, 4–6 Don't examples. Pull from Brand Handoff's voice_overview + Strategy Brief's voice section.
- **Personas** — per-project persona archetypes from the Strategy Brief. Each has name, archetype, description, goals, challenges, motivations, and a direct message addressing them.
- **X-factor** — the single top attribute that makes this church distinctive + the messaging focus.
- **Project goals** — Identity / Connection / Growth, in plain language.
- **Sitemap signals** — decisions that will shape Stage 2:
  - sermon_blog_requested (boolean)
  - sermons_display_mode / events_display_mode / groups_display_mode (one of: archive_link, chms_embed, wordpress_managed)
  - recommended_pages (list — your initial proposal; Stage 2 refines)
  - tech_flags (Requires ACF Setup, Requires PCO Integration, etc.)
- **Sources used** — short attribution per source (1 sentence) + a list of any conflicts you encountered and how you resolved them.

# Voice rules to internalize
Apply these to every string you emit:
- No em-dashes (— or –). Use periods or commas.
- No three-adjective clusters. Pick the single strongest word.
- No filler intensifiers: truly, really, deeply, incredibly, very, amazing, just, simply.
- No AI cliché vocabulary: delve, tapestry, unlock, unleash, elevate, beacon, embark, resonate, dynamic, synergistic, game-changer.
- No "We / Our" framing. Refer to the church by name.

# Discipline
- Every concrete fact you write should be traceable to a source. If something isn't in the intake, don't invent it — say "Not specified in intake."
- Be honest about gaps. If the strategy brief is sparse on personas, say so.
- Use the partner's own vocabulary when possible (e.g. "Disciples Serve" for volunteers if that's their term).
- Identify display modes (Option 1 / 2 / 3 per the sermons-events-groups rule) by reading the Discovery Questionnaire's display-preference fields and the Content Collection for evidence of PCO / ChMS usage.`
}

// ── User content assembly ─────────────────────────────────────────────

interface UserContentInputs {
  project: any
  accountHandoff: unknown
  brandGuide: any
  discoveryQuestionnaire: any
  filesLoaded: PreflightFile[]
  redoContext: string
}

function buildUserContent(inputs: UserContentInputs): unknown[] {
  const blocks: unknown[] = []

  // Project meta
  blocks.push({
    type: 'text',
    text: `# Project: ${inputs.project.name}
Member: ${inputs.project.member}
Engagement type: ${inputs.project.kind ?? 'unknown'}
Current phase: ${inputs.project.current_phase ?? 'intake'}`,
  })

  // AM handoff (highest priority for web specifics)
  if (inputs.accountHandoff && typeof inputs.accountHandoff === 'object' && Object.keys(inputs.accountHandoff).length > 0) {
    blocks.push({
      type: 'text',
      text: `# Source: AM Handoff (takes priority over Discovery on web specifics)\n\n\`\`\`json\n${JSON.stringify(inputs.accountHandoff, null, 2)}\n\`\`\``,
    })
  } else {
    blocks.push({ type: 'text', text: '# Source: AM Handoff\n\n(No AM handoff form on file)' })
  }

  // AM handoff supplemental uploads
  appendCategoryFiles(blocks, inputs.filesLoaded, 'am_handoff_supplemental', 'AM Handoff supplemental upload')

  // Strategy brief (the anchor)
  blocks.push({ type: 'text', text: '# Source: Strategy Brief (THE ANCHOR — wins all conflicts)' })
  appendCategoryFiles(blocks, inputs.filesLoaded, 'strategy_brief', 'Strategy Brief file')

  // Discovery questionnaire
  if (inputs.discoveryQuestionnaire) {
    blocks.push({
      type: 'text',
      text: `# Source: Discovery Questionnaire (partner's own words)\n\n\`\`\`json\n${JSON.stringify(redactNulls(inputs.discoveryQuestionnaire), null, 2)}\n\`\`\``,
    })
  } else {
    blocks.push({ type: 'text', text: '# Source: Discovery Questionnaire\n\n(No DB row — see supplemental upload below)' })
  }
  appendCategoryFiles(blocks, inputs.filesLoaded, 'discovery_questionnaire_supplemental', 'Discovery Questionnaire supplemental upload')

  // Brand handoff
  if (inputs.brandGuide) {
    const guide = inputs.brandGuide
    blocks.push({
      type: 'text',
      text: `# Source: Brand Handoff (Brand Squad)
Display name: ${guide.display_name ?? '—'}
Style tags: ${(guide.style_tags ?? []).join(', ') || '—'}
Brand statement: ${guide.brand_statement ?? '—'}

Voice overview:
${guide.voice_overview ?? '(none)'}

Handoff notes:
${guide.handoff_notes ?? '(none)'}`,
    })
  } else {
    blocks.push({ type: 'text', text: '# Source: Brand Handoff\n\n(No published brand guide row)' })
  }

  // Content collection (highest detail volume)
  blocks.push({ type: 'text', text: '# Source: Content Collection (every concrete fact must find a home on the new site)' })
  appendCategoryFiles(blocks, inputs.filesLoaded, 'content_collection', 'Content Collection file')

  // Optional redo context
  if (inputs.redoContext) {
    blocks.push({
      type: 'text',
      text: `# Redo context (strategist's feedback on the previous extraction)\n\n${inputs.redoContext}\n\nApply this feedback when synthesizing.`,
    })
  }

  // Final instruction
  blocks.push({
    type: 'text',
    text: 'Now synthesize the above into a single structured extraction via the submit_strategy_extraction tool. Respect the source priority order. Cite which sources you used and any conflicts you resolved.',
  })

  return blocks
}

function appendCategoryFiles(blocks: unknown[], files: PreflightFile[], category: string, prefix: string) {
  const matched = files.filter(f => f.category === category)
  if (matched.length === 0) {
    blocks.push({ type: 'text', text: `(No ${prefix.toLowerCase()} files uploaded)` })
    return
  }
  for (const f of matched) {
    if (f.text != null) {
      blocks.push({
        type: 'text',
        text: `## ${prefix}: ${f.filename}\n\n${f.text}`,
      })
    } else if (f.base64) {
      blocks.push({
        type: 'file',
        data: f.base64,
        mediaType: 'application/pdf',
      })
      blocks.push({ type: 'text', text: `(↑ ${prefix}: ${f.filename})` })
    }
  }
}

function redactNulls(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj
  const out: any = Array.isArray(obj) ? [] : {}
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue
    if (typeof v === 'string' && v.trim() === '') continue
    out[k] = typeof v === 'object' ? redactNulls(v) : v
  }
  return out
}

// ── Structured output tool ────────────────────────────────────────────

const EXTRACTION_TOOL = {
  name: 'submit_strategy_extraction',
  description: 'Submit the synthesized strategic foundation for this church website project.',
  input_schema: {
    type: 'object' as const,
    required: ['audience', 'voice_characteristics', 'personas', 'x_factor', 'project_goals', 'sitemap_signals', 'sources_used'],
    properties: {
      audience: {
        type: 'object',
        required: ['summary'],
        properties: {
          summary: { type: 'string', description: '2-3 sentence overview of the primary audience this church is reaching.' },
          primary_segments: { type: 'array', items: { type: 'string' }, description: 'E.g. "Seniors and grandparents", "Young families".' },
          age_distribution: { type: 'string', description: 'Free text describing the current age mix.' },
          geographic_reach: { type: 'string', description: 'Local + online if applicable.' },
          online_vs_in_person: { type: 'string', description: 'How the online audience differs from in-person.' },
        },
      },
      voice_characteristics: {
        type: 'object',
        required: ['top_attributes', 'description'],
        properties: {
          top_attributes: { type: 'array', items: { type: 'string' }, description: 'E.g. "Bold Truth", "Detroit Grit", "Grace-Filled". 3–5 attributes.' },
          description: { type: 'string', description: '2–3 sentence summary of the voice.' },
          tone_examples_do: { type: 'array', items: { type: 'string' }, description: '4–6 short examples of what fits this voice.' },
          tone_examples_dont: { type: 'array', items: { type: 'string' }, description: '4–6 short examples of what does NOT fit.' },
        },
      },
      personas: {
        type: 'array',
        description: 'Project-specific personas from the strategy brief. Each persona is one card.',
        items: {
          type: 'object',
          required: ['name', 'archetype', 'description'],
          properties: {
            name: { type: 'string', description: 'E.g. "Jordan Reynolds".' },
            archetype: { type: 'string', description: 'E.g. "The Gritty Builder".' },
            description: { type: 'string', description: '1–2 sentence sketch.' },
            goals: { type: 'string' },
            challenges: { type: 'string' },
            motivations: { type: 'string' },
            message: { type: 'string', description: 'Direct message to this persona, 1–3 sentences.' },
          },
        },
      },
      x_factor: {
        type: 'object',
        required: ['top_attribute', 'messaging_focus'],
        properties: {
          top_attribute: { type: 'string', description: 'E.g. "Relational Community".' },
          messaging_focus: { type: 'string', description: '2–4 sentence explanation of how this X-factor shapes messaging.' },
        },
      },
      project_goals: {
        type: 'object',
        properties: {
          identity: { type: 'string' },
          connection: { type: 'string' },
          growth: { type: 'string' },
        },
      },
      sitemap_signals: {
        type: 'object',
        required: ['sermon_blog_requested', 'sermons_display_mode', 'events_display_mode', 'groups_display_mode'],
        properties: {
          sermon_blog_requested: { type: 'boolean', description: 'Did the discovery questionnaire ask for a sermon-based blog?' },
          sermons_display_mode: { type: 'string', enum: ['archive_link', 'chms_embed', 'wordpress_managed', 'unspecified'], description: 'Option 1 / 2 / 3 per the sermons-events-groups display rule.' },
          events_display_mode:  { type: 'string', enum: ['archive_link', 'chms_embed', 'wordpress_managed', 'unspecified'] },
          groups_display_mode:  { type: 'string', enum: ['archive_link', 'chms_embed', 'wordpress_managed', 'unspecified'] },
          recommended_pages: { type: 'array', items: { type: 'string' }, description: 'Initial proposal — Stage 2 refines.' },
          tech_flags: { type: 'array', items: { type: 'string' }, description: 'E.g. "Requires ACF Setup", "Requires PCO Integration".' },
        },
      },
      sources_used: {
        type: 'object',
        required: ['conflicts_resolved'],
        properties: {
          strategy_brief: { type: 'string', description: '1 sentence on what was drawn from here.' },
          am_handoff: { type: 'string' },
          discovery_questionnaire: { type: 'string' },
          brand_handoff: { type: 'string' },
          content_collection: { type: 'string' },
          conflicts_resolved: { type: 'array', items: { type: 'string' }, description: 'List of specific contradictions encountered + which source you deferred to.' },
        },
      },
    },
  },
}

// ── Auto-fill the roadmap deliverable from Stage 1 extraction ────────

function deriveRoadmapProperties(
  extraction: Record<string, unknown>,
  brandGuide: any,
  project: any,
): Record<string, string> {
  const audience = (extraction.audience ?? {}) as Record<string, any>
  const voice    = (extraction.voice_characteristics ?? {}) as Record<string, any>
  const xFactor  = (extraction.x_factor ?? {}) as Record<string, any>
  const goals    = (extraction.project_goals ?? {}) as Record<string, any>

  const goalsLine = [
    goals.identity   && `Identity: ${goals.identity}`,
    goals.connection && `Connection: ${goals.connection}`,
    goals.growth     && `Growth: ${goals.growth}`,
  ].filter(Boolean).join(' · ')

  return {
    primary_goals:     goalsLine,
    tone:              Array.isArray(voice.top_attributes) ? voice.top_attributes.join(' · ') : '',
    target_audience:   String(audience.summary ?? ''),
    x_factor:          String(xFactor.top_attribute ?? ''),
    brand_style_tags:  Array.isArray(brandGuide?.style_tags) ? brandGuide.style_tags.join(' · ') : '',
    engagement_type:   project.kind ? String(project.kind).replace(/_/g, ' ') : '',
  }
}

function deriveOpeningParagraph(extraction: Record<string, unknown>): string {
  const audience = (extraction.audience ?? {}) as Record<string, any>
  const xFactor  = (extraction.x_factor ?? {}) as Record<string, any>
  const goals    = (extraction.project_goals ?? {}) as Record<string, any>

  const parts: string[] = []
  if (audience.summary) parts.push(String(audience.summary))
  if (xFactor.messaging_focus) parts.push(String(xFactor.messaging_focus))
  if (goals.identity || goals.connection || goals.growth) {
    const goalSentence = [
      goals.identity   && goals.identity,
      goals.connection && goals.connection,
      goals.growth     && goals.growth,
    ].filter(Boolean).join(' ')
    if (goalSentence) parts.push(goalSentence)
  }
  return parts.join('\n\n')
}

// ── Mock extraction (used when ?mock=true) ────────────────────────────

function buildMockExtraction(project: any): Record<string, unknown> {
  return {
    audience: {
      summary: `${project.name ?? 'This church'} reaches a multi-generational community with notable growth among young families. The website needs to speak to long-tenured members and first-time visitors in the same breath.`,
      primary_segments: ['Young families with school-age kids', 'Long-tenured members', 'Spiritually curious first-time visitors'],
      age_distribution: 'Roughly balanced 20–65, with a recent uptick in 25–40.',
      geographic_reach: 'Primarily local within a 15-mile radius, with a steady online audience across the region.',
      online_vs_in_person: 'Online viewers tend to be exploring before they visit. In-person attendees are more committed to weekly rhythms.',
    },
    voice_characteristics: {
      top_attributes: ['Grace-Filled', 'Honest', 'Welcoming'],
      description: 'A voice that meets people where they are without flinching from hard truths. Plain language, no church-jargon, no performative warmth.',
      tone_examples_do: [
        'You belong here, even before you believe.',
        'Real questions. Honest answers.',
        'Sunday is a starting line, not a finish.',
        'Come hungry. Stay messy.',
      ],
      tone_examples_dont: [
        'Embark on a transformative spiritual journey.',
        'Unlock your potential through community.',
        'A vibrant, dynamic, life-changing experience.',
        'Delve into the tapestry of faith.',
      ],
    },
    personas: [
      {
        name: 'Jordan Reynolds',
        archetype: 'The Spiritually Curious Skeptic',
        description: 'Mid-30s, professional, attends sporadically. Burned by past church experiences but still asking the big questions.',
        goals: 'Find honest answers without being preached at. Build a few genuine friendships.',
        challenges: 'Distrusts institutional language. Allergic to performative warmth.',
        motivations: 'Wants belonging that does not require pretending.',
        message: 'You can ask the hard questions here. No one will rush you toward an answer you have not earned.',
      },
      {
        name: 'Maria Chen',
        archetype: 'The Young-Family Anchor',
        description: 'Early 30s, two kids under 8. Looking for a place where her kids thrive AND she gets adult community.',
        goals: 'Find a church that takes her kids seriously and gives her room to grow as an adult.',
        challenges: 'Tired of churches that treat parents as drop-off labor.',
        motivations: 'Wants her family to grow up rooted, not performative.',
        message: 'Your kids will be loved here. So will you. Both matter equally.',
      },
    ],
    x_factor: {
      top_attribute: 'Honest Welcome',
      messaging_focus: 'Lean into the "you belong before you believe" framing. Every page should hint at this — the homepage banner, the giving page, even the events list. Visitors who have been hurt by other churches should feel the difference in the first 8 seconds.',
    },
    project_goals: {
      identity: 'Anchor the brand refresh online. Carry the new wordmark, color system, and voice into every page header and CTA.',
      connection: 'Make first-time visit and small-group sign-up the easiest paths on the site. Two clicks max.',
      growth: 'Drive online attendees toward an in-person next step. Sermon archive should funnel toward Groups and Serve.',
    },
    sitemap_signals: {
      sermon_blog_requested: true,
      sermons_display_mode: 'wordpress_managed',
      events_display_mode: 'chms_embed',
      groups_display_mode: 'wordpress_managed',
      recommended_pages: ['Home', 'About', 'New Here', 'Sermons', 'Groups', 'Events', 'Serve', 'Give', 'Contact'],
      tech_flags: ['Requires ACF Setup (sermon blog)', 'Requires PCO Integration (events embed)'],
    },
    sources_used: {
      strategy_brief: '(Mock run — extraction did not read source files.)',
      am_handoff: '(Mock run.)',
      discovery_questionnaire: '(Mock run.)',
      brand_handoff: '(Mock run.)',
      content_collection: '(Mock run.)',
      conflicts_resolved: [
        '(Mock run — no real conflicts encountered.)',
      ],
    },
  }
}
