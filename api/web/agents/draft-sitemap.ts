/**
 * Vercel Serverless Function — /api/web/agents/draft-sitemap
 *
 * Phase C-2: Stage 2 of the Content Manager AI pipeline.
 * Consumes Stage 1's strategic foundation + all intake sources and
 * proposes a strategic sitemap: page list with rationale + outlines,
 * navigation structure, vocabulary decisions, AEO/GEO keyword targets,
 * and CS flags.
 *
 * Adapts the team's sitemap-generator skill (see
 * references/sitemap-strategy.md). The Notion delivery sub-steps and
 * partner-facing artifact assembly don't apply — this endpoint writes
 * structured JSON to strategy_web_projects.roadmap_state.stage_2 for
 * downstream stages and the Sitemap workspace to consume.
 *
 * Authentication: AI_GATEWAY_API_KEY (local) or VERCEL_OIDC_TOKEN
 * (auto-injected on Vercel deploys), same pattern as Stage 1.
 *
 * Stage transition: strategy_done → drafting_sitemap → sitemap_done.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { generateText, jsonSchema, tool } from 'ai'

// Sonnet 4.6 handles Stage 2's structured derivative work at ~5× lower cost
// than Opus, and supports a far higher output ceiling — page outlines × 13+
// pages packed Opus into truncation on the first run.
const MODEL = 'anthropic/claude-sonnet-4-6'
const MAX_OUTPUT_TOKENS = 20000

const TEXT_FORMATS = new Set([
  'text/plain', 'text/markdown', 'text/x-markdown', 'text/csv',
])
const PDF_FORMAT = 'application/pdf'
const UNSUPPORTED_FORMATS = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

interface PreflightFile {
  category: string
  filename: string
  mime_type: string | null
  storage_url: string
  text?: string
  base64?: string
  error?: string
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
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

  const stage1 = (project.roadmap_state as { stage_1?: Record<string, unknown> } | null)?.stage_1
  if (!stage1) {
    return res.status(400).json({ error: 'Stage 1 extraction must be complete before Stage 2 can run.' })
  }

  // ── Mock short-circuit ──────────────────────────────────────────────
  if (mock) {
    const canned = buildMockSitemap(project, stage1)
    const { error: writeErr } = await sb
      .from('strategy_web_projects')
      .update({
        roadmap_state: {
          ...(project.roadmap_state ?? {}),
          stage_2: {
            ...canned,
            _meta: {
              model: 'mock',
              usage: { input_tokens: 0, output_tokens: 0 },
              extracted_at: new Date().toISOString(),
              redo_context: null,
              mocked: true,
            },
          },
        },
        roadmap_stage: 'sitemap_done',
      })
      .eq('id', projectId)
    if (writeErr) return res.status(500).json({ error: `DB write failed: ${writeErr.message}` })
    return res.status(200).json({ ok: true, sitemap: canned, usage: { input_tokens: 0, output_tokens: 0 }, mock: true })
  }

  // ── Load intake from DB ─────────────────────────────────────────────
  const member = project.member as number
  const [accountRes, brandRes, discoveryRes, intakeDocsRes] = await Promise.all([
    sb.from('strategy_account_progress').select('member, handoff_web_form, church_name').eq('member', member).maybeSingle(),
    sb.from('strategy_brand_guides').select('*').eq('member', member).eq('is_published', true).order('last_updated_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('strategy_discovery_questionnaire').select('*').eq('member', member).order('submitted_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('web_intake_documents').select('*').eq('web_project_id', projectId).eq('archived', false).order('uploaded_at', { ascending: false }),
  ])

  const accountHandoff = accountRes.data?.handoff_web_form ?? null
  const churchName = (accountRes.data as any)?.church_name ?? null
  const brandGuide = brandRes.data ?? null
  const discoveryQuestionnaire = discoveryRes.data ?? null
  const intakeDocs = intakeDocsRes.data ?? []

  // ── Pre-flight: load all uploaded files ─────────────────────────────
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
        filesFailed.push({ ...base, error: `Format not yet supported: ${doc.mime_type}. Convert to .pdf or .md.` })
        return
      }
      const r = await fetch(doc.storage_url)
      if (!r.ok) throw new Error(`Fetch ${r.status}`)
      if (TEXT_FORMATS.has(doc.mime_type ?? '') || /\.(md|txt|csv|markdown)$/i.test(doc.filename)) {
        const text = await r.text()
        filesLoaded.push({ ...base, text })
      } else if (doc.mime_type === PDF_FORMAT || doc.filename.toLowerCase().endsWith('.pdf')) {
        const ab = await r.arrayBuffer()
        filesLoaded.push({ ...base, base64: Buffer.from(ab).toString('base64') })
      } else {
        filesFailed.push({ ...base, error: `Unrecognized format: ${doc.mime_type ?? 'unknown'}` })
      }
    } catch (e) {
      filesFailed.push({ ...base, error: e instanceof Error ? e.message : 'Read failed' })
    }
  }))

  if (filesFailed.length > 0) {
    return res.status(400).json({
      error: 'One or more intake files could not be read.',
      files_failed: filesFailed.map(f => ({ category: f.category, filename: f.filename, mime_type: f.mime_type, error: f.error })),
    })
  }

  // ── Mark stage as drafting ──────────────────────────────────────────
  await sb.from('strategy_web_projects').update({ roadmap_stage: 'drafting_sitemap' }).eq('id', projectId)

  // ── Build prompt + content blocks ───────────────────────────────────
  const systemPrompt = buildSystemPrompt()
  const userContent = buildUserContent({
    project, churchName, accountHandoff, brandGuide, discoveryQuestionnaire, stage1,
    filesLoaded, redoContext,
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
        submit_sitemap: tool({
          description: SITEMAP_TOOL.description,
          inputSchema: jsonSchema(SITEMAP_TOOL.input_schema as any),
        }),
      },
      toolChoice: { type: 'tool', toolName: 'submit_sitemap' },
    })
    usage = {
      input_tokens: result.usage?.inputTokens,
      output_tokens: result.usage?.outputTokens,
    }
    const toolCall = result.toolCalls?.[0]
    if (!toolCall || toolCall.toolName !== 'submit_sitemap') {
      throw new Error('Model did not return the expected tool call')
    }
    let raw = toolCall.input as Record<string, unknown>
    // Unwrap potential redundant top-level envelope (same pattern as Stage 1)
    if (
      raw && typeof raw === 'object'
      && Object.keys(raw).length === 1
      && raw.sitemap && typeof raw.sitemap === 'object'
    ) {
      raw = raw.sitemap as Record<string, unknown>
    }
    toolResult = raw
  } catch (err: any) {
    // Roll back so user can retry
    await sb.from('strategy_web_projects').update({ roadmap_stage: 'strategy_done' }).eq('id', projectId)
    console.error('[draft-sitemap] gateway error:', err?.message)
    return res.status(502).json({ error: `AI Gateway error: ${err?.message ?? 'unknown'}` })
  }

  // ── Persist + advance stage ─────────────────────────────────────────
  const patch = {
    stage_2: {
      ...toolResult,
      _meta: {
        model: MODEL,
        usage,
        extracted_at: new Date().toISOString(),
        redo_context: redoContext || null,
        files_loaded: filesLoaded.map(f => ({ category: f.category, filename: f.filename })),
      },
    },
  }

  const { error: writeErr } = await sb
    .from('strategy_web_projects')
    .update({
      roadmap_state: { ...(project.roadmap_state ?? {}), ...patch },
      roadmap_stage: 'sitemap_done',
    })
    .eq('id', projectId)

  if (writeErr) {
    await sb.from('strategy_web_projects').update({ roadmap_stage: 'strategy_done' }).eq('id', projectId)
    return res.status(500).json({ error: `DB write failed: ${writeErr.message}` })
  }

  return res.status(200).json({
    ok: true,
    sitemap: toolResult,
    usage,
    files_loaded: filesLoaded.map(f => ({ category: f.category, filename: f.filename })),
  })
}

// ── System prompt ─────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `You are the Sitemap Architect for Church Media Squad's Content Manager pipeline. Stage 2 of 5. You receive Stage 1's strategic foundation (audience, voice, personas, x-factor, project goals, sitemap signals, sources) plus the original intake sources, and you propose a strategic sitemap.

# Core principles

**1. Less is more.** Aim for the smallest page count that gives every important content item a home. Stage 1's recommended_pages is a first proposal — challenge it. Density-driven nesting beats page proliferation.

**2. Phase 1 = 6 pages. Hard cap at 7.**

Mandatory 4 (always Phase 1, no exceptions):
- Homepage
- Plan a Visit / Next Steps (whatever the church names it)
- Sermons / Watch / Messages (whatever the church names it)
- Give / Generosity (whatever the church names it)

Pick 2 more from: About / Our Story, Kids Ministry, What We Believe / Beliefs, Meet Our Team / Staff. Choose based on the church's primary audience and stated goals. Only pick 2.

**Bilingual override:** Any Spanish-language or non-English congregation gets a dedicated Phase 1 page (legitimate path to 7).

**3. Phase 2 = everything else.** Cap total Phase 1 + Phase 2 at 20 pages. Consolidate when count threatens to exceed:
- Combine Men's + Women's → "Adults" with sections
- Combine Local + Global Outreach → "Outreach"
- Roll Baptism + New Believer into Discipleship / Next Steps
- Move Membership into an About section

Note every consolidation in absorbed_content.

**4. Vocabulary fits the voice.** Default names like "Plan a Visit," "About Us," "Sermons" are safe but generic. Match the church's voice register from Stage 1's voice_characteristics.top_attributes:

- Bold / city / grit voice → "Sundays," "Who We Are," "Listen"
- Formal / traditional → "Visit," "Our Story," "Sermons"
- Conversational → "First Time?," "Us," "Watch"
- Thematic groupings (Reality LA pattern) → "Jesus / You / Us"
- Action verbs (Austin Stone pattern) → "Take / Attend / Join / Go / Learn / Lead / Serve"
- Minimal → "Visit," "About," "Watch," "Give"

When voice is unclear, default conservative. Don't force novelty. Record every non-default choice in vocabulary_decisions.

**5. Nav patterns.** Pick one that fits:
- flat: each item is a page. Best for simple sites.
- grouped_dropdowns: parent labels reveal child pages. Best for 10+ pages.
- thematic_groups: themed parent labels (Reality LA's Jesus / You / Us).
- thematic_verbs: action labels (Austin Stone's Take / Attend / Join).
- offcanvas: slide-in menu for 15+ pages.
- megamenu: wide grid dropdown for large churches.

Default conservative: flat or grouped_dropdowns. Reserve thematic patterns for churches whose voice register supports it.

Primary nav max 6 items.

**6. Density signals:**
- high = enough unique content for a robust page
- medium = adequate; may need section work
- low = absorb into a parent page or drop

**7. Phase tagging:**
- '1' = MVP launch
- '2' = post-launch parking lot
- 'nav-only' = item in nav, page not built (external link/archive)
- 'global' = chrome

# AEO / GEO

For each page, think:
- Direct answer structure (who/what/where/when questions)
- Entity clarity (church name + city + state)
- Intent matching (visitor language, not insider language)

Surface AEO notes on Plan a Visit, Contact, Sermons, Kids, Beliefs at minimum.

Provide aeo_keywords:
- primary: 2–3 high-intent local terms
- secondary: 5–7 semantic variations
- long_tail: specific question phrases this church can own

Ground in church's actual location + denomination + audience. "Church near me" is not useful. Specific local terms are.

# Page outlines

Every page in pages[] needs:
- name, slug, nav_label, phase, parent_slug, page_type
- strategic_purpose (one sentence)
- rationale (why exists, why named this way)
- content_sources (which intake source(s))
- density
- hero: { headline_direction, subheadline_direction, primary_cta: { label, destination } }
- sections: array of { name, contains, content_source, aeo_note? }
- primary_action, secondary_action

Phase 1 outlines: detailed enough to begin copywriting in Stage 5.
Phase 2 outlines: lighter blueprints.

# Strategic discipline

- Be strategic, not literal. Challenge content collection where it lists 5 thin sub-pages.
- Every page traces to a source. Speculative pages → cs_flags.soft_assumptions.
- Use partner vocabulary (e.g., "Disciples Serve" if that's their volunteer term, "Messages" if that's their sermon term).
- Vocabulary decisions explained in vocabulary_decisions.

# CS flags

- hard_blockers: copy cannot be written without resolving. Specific page + what's missing.
- soft_assumptions: verify with partner/AM. What was assumed + how to verify.
- design_flags: route to Web Director. Page + technical consideration.

# Voice rules (carry from Stage 1)

Apply to every string you emit:
- No em-dashes (— or –). Periods or commas instead.
- No three-adjective clusters. Pick the single strongest word.
- No filler intensifiers: truly, really, deeply, incredibly, very, amazing, just, simply.
- No AI clichés: delve, tapestry, unlock, unleash, elevate, beacon, embark, resonate, dynamic, synergistic, game-changer, seamless, robust, leverage, transformative, vibrant, foster, pivotal, paramount.
- No church clichés: "come as you are," "life-changing," "vibrant community," "spiritual journey," "walk with God."
- No "We / Our" framing for partner-facing copy. Refer to church by name.
- Jesus is the destination. Programs are the vehicle. Name Jesus explicitly at least once across the page outlines.

# Output

Submit your complete sitemap via the submit_sitemap tool. Cover every required field.`
}

// ── User content assembly ─────────────────────────────────────────────

interface UserContentInputs {
  project: any
  churchName: string | null
  accountHandoff: unknown
  brandGuide: any
  discoveryQuestionnaire: any
  stage1: Record<string, unknown>
  filesLoaded: PreflightFile[]
  redoContext: string
}

function buildUserContent(inputs: UserContentInputs): unknown[] {
  const blocks: unknown[] = []

  blocks.push({
    type: 'text',
    text: `# Project: ${inputs.project.name}
Church: ${inputs.churchName ?? '(unknown)'}
Member: ${inputs.project.member}
Engagement type: ${inputs.project.kind ?? 'unknown'}`,
  })

  // Stage 1 — the most important input
  blocks.push({
    type: 'text',
    text: `# Stage 1 strategic foundation (THE PRIMARY INPUT)\n\nThis is the synthesized strategy from Stage 1. Use it to drive vocabulary, nav pattern, and page selection.\n\n\`\`\`json\n${JSON.stringify(stripMeta(inputs.stage1), null, 2)}\n\`\`\``,
  })

  // AM handoff
  if (inputs.accountHandoff && typeof inputs.accountHandoff === 'object' && Object.keys(inputs.accountHandoff).length > 0) {
    blocks.push({
      type: 'text',
      text: `# Source: AM Handoff\n\n\`\`\`json\n${JSON.stringify(inputs.accountHandoff, null, 2)}\n\`\`\``,
    })
  }

  appendCategoryFiles(blocks, inputs.filesLoaded, 'am_handoff_supplemental', 'AM Handoff supplemental upload')

  // Strategy brief
  blocks.push({ type: 'text', text: '# Source: Strategy Brief' })
  appendCategoryFiles(blocks, inputs.filesLoaded, 'strategy_brief', 'Strategy Brief file')

  // Discovery questionnaire
  if (inputs.discoveryQuestionnaire) {
    blocks.push({
      type: 'text',
      text: `# Source: Discovery Questionnaire\n\n\`\`\`json\n${JSON.stringify(redactNulls(inputs.discoveryQuestionnaire), null, 2)}\n\`\`\``,
    })
  }
  appendCategoryFiles(blocks, inputs.filesLoaded, 'discovery_questionnaire_supplemental', 'Discovery Questionnaire supplemental upload')

  // Brand handoff
  if (inputs.brandGuide) {
    const guide = inputs.brandGuide
    blocks.push({
      type: 'text',
      text: `# Source: Brand Handoff
Display name: ${guide.display_name ?? '—'}
Style tags: ${(guide.style_tags ?? []).join(', ') || '—'}
Brand statement: ${guide.brand_statement ?? '—'}

Voice overview:
${guide.voice_overview ?? '(none)'}`,
    })
  }

  // Content collection — most important for page density decisions
  blocks.push({ type: 'text', text: '# Source: Content Collection (drives page list + density decisions)' })
  appendCategoryFiles(blocks, inputs.filesLoaded, 'content_collection', 'Content Collection file')

  if (inputs.redoContext) {
    blocks.push({
      type: 'text',
      text: `# Redo context (strategist's feedback)\n\n${inputs.redoContext}\n\nApply this feedback when proposing.`,
    })
  }

  blocks.push({
    type: 'text',
    text: 'Now propose the strategic sitemap via the submit_sitemap tool. Phase 1 = 6 pages (target). Total ≤ 20. Vocabulary fits voice. Density-driven nesting. Flag every assumption.',
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
      blocks.push({ type: 'text', text: `## ${prefix}: ${f.filename}\n\n${f.text}` })
    } else if (f.base64) {
      blocks.push({ type: 'file', data: f.base64, mediaType: 'application/pdf' })
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

function stripMeta(obj: Record<string, unknown>): Record<string, unknown> {
  const { _meta, ...rest } = obj as { _meta?: unknown; [k: string]: unknown }
  void _meta
  return rest
}

// ── Structured output tool ────────────────────────────────────────────

const SITEMAP_TOOL = {
  name: 'submit_sitemap',
  description: 'Submit the proposed strategic sitemap for this church website project.',
  input_schema: {
    type: 'object' as const,
    required: ['nav_strategy', 'nav_voice_register', 'nav_pattern', 'phase_summary', 'pages', 'nav_items', 'sources_used'],
    properties: {
      nav_strategy: {
        type: 'string',
        description: '2-3 sentences explaining how this church\'s nav reflects voice + audience.',
      },
      nav_voice_register: {
        type: 'string',
        enum: ['formal', 'conversational', 'bold', 'minimal', 'thematic'],
      },
      nav_pattern: {
        type: 'string',
        enum: ['flat', 'grouped_dropdowns', 'thematic_groups', 'thematic_verbs', 'offcanvas', 'megamenu'],
      },
      phase_summary: {
        type: 'object',
        required: ['phase_1_count', 'phase_2_count', 'total', 'rationale'],
        properties: {
          phase_1_count: { type: 'integer' },
          phase_2_count: { type: 'integer' },
          total: { type: 'integer' },
          rationale: { type: 'string', description: 'Why these counts. Explain consolidations and what got nested.' },
        },
      },
      pages: {
        type: 'array',
        description: 'Every page in the sitemap. Phase 1 outlines should be detailed enough to begin copywriting.',
        items: {
          type: 'object',
          required: ['name', 'slug', 'phase', 'page_type', 'strategic_purpose', 'rationale', 'density'],
          properties: {
            name: { type: 'string', description: 'Display name (e.g., "Plan a Visit," "Sundays").' },
            slug: { type: 'string', description: 'URL slug (e.g., "plan-a-visit").' },
            nav_label: { type: 'string', description: 'Label shown in nav (often same as name).' },
            phase: { type: 'string', enum: ['1', '2', 'nav-only', 'global'] },
            parent_slug: { type: ['string', 'null'], description: 'Null for top-level; parent slug for nested.' },
            page_type: { type: 'string', enum: ['content', 'chrome', 'functional'] },
            strategic_purpose: { type: 'string', description: 'One sentence: what this page does for the visitor.' },
            rationale: { type: 'string', description: 'Why exists, why named this way.' },
            content_sources: { type: 'array', items: { type: 'string' } },
            density: { type: 'string', enum: ['high', 'medium', 'low'] },
            hero: {
              type: 'object',
              properties: {
                headline_direction: { type: 'string' },
                subheadline_direction: { type: 'string' },
                primary_cta: {
                  type: 'object',
                  properties: {
                    label: { type: 'string' },
                    destination: { type: 'string', description: 'Slug or URL where the CTA leads.' },
                  },
                },
              },
            },
            sections: {
              type: 'array',
              items: {
                type: 'object',
                required: ['name', 'contains'],
                properties: {
                  name: { type: 'string' },
                  contains: { type: 'string', description: 'What this section is about.' },
                  content_source: { type: 'string', description: 'Which intake source.' },
                  aeo_note: { type: 'string', description: 'AEO/GEO consideration if applicable.' },
                },
              },
            },
            primary_action: { type: 'string', description: 'The one thing the visitor should do on this page.' },
            secondary_action: { type: 'string' },
          },
        },
      },
      nav_items: {
        type: 'array',
        description: 'The actual nav tree. Items can be pages (kind="page") or groupings (kind="group") with children.',
        items: {
          type: 'object',
          required: ['label', 'kind'],
          properties: {
            label: { type: 'string' },
            kind: { type: 'string', enum: ['page', 'group'] },
            slug: { type: 'string', description: 'Required when kind=page.' },
            rationale: { type: 'string' },
            children: {
              type: 'array',
              items: {
                type: 'object',
                required: ['label', 'kind'],
                properties: {
                  label: { type: 'string' },
                  kind: { type: 'string', enum: ['page', 'group'] },
                  slug: { type: 'string' },
                  rationale: { type: 'string' },
                },
              },
            },
          },
        },
      },
      absorbed_content: {
        type: 'array',
        description: 'Content items that got nested into other pages instead of becoming their own page.',
        items: {
          type: 'object',
          required: ['content_item', 'rationale'],
          properties: {
            content_item: { type: 'string', description: 'What the content collection called this thing.' },
            absorbed_into: { type: ['string', 'null'], description: 'Slug of the page that absorbs it; null if dropped.' },
            rationale: { type: 'string' },
          },
        },
      },
      vocabulary_decisions: {
        type: 'array',
        description: 'Non-default naming choices with rationale tied to Stage 1 voice.',
        items: {
          type: 'object',
          required: ['we_chose', 'why'],
          properties: {
            instead_of: { type: 'string', description: 'The default name we passed on.' },
            we_chose: { type: 'string' },
            why: { type: 'string' },
          },
        },
      },
      aeo_keywords: {
        type: 'object',
        properties: {
          primary: { type: 'array', items: { type: 'string' }, description: '2-3 high-intent local terms.' },
          secondary: { type: 'array', items: { type: 'string' }, description: '5-7 semantic variations.' },
          long_tail: { type: 'array', items: { type: 'string' }, description: 'Specific question phrases.' },
        },
      },
      cs_flags: {
        type: 'object',
        properties: {
          hard_blockers: { type: 'array', items: { type: 'string' } },
          soft_assumptions: { type: 'array', items: { type: 'string' } },
          design_flags: { type: 'array', items: { type: 'string' } },
        },
      },
      sources_used: {
        type: 'object',
        required: ['conflicts_resolved'],
        properties: {
          stage_1: { type: 'string', description: 'How Stage 1 drove choices.' },
          content_collection: { type: 'string' },
          am_handoff: { type: 'string' },
          discovery_questionnaire: { type: 'string' },
          brand_handoff: { type: 'string' },
          strategy_brief: { type: 'string' },
          conflicts_resolved: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
}

// ── Mock sitemap (used when ?mock=true) ──────────────────────────────

function buildMockSitemap(project: any, _stage1: Record<string, unknown>): Record<string, unknown> {
  void _stage1
  void project
  return {
    nav_strategy: 'Mock run. Flat nav with city-tuned vocabulary. Six primary items keep the header scannable while honoring the church\'s direct voice.',
    nav_voice_register: 'bold',
    nav_pattern: 'flat',
    phase_summary: {
      phase_1_count: 6,
      phase_2_count: 7,
      total: 13,
      rationale: 'Phase 1 covers the mandatory four plus About + Kids per audience priorities. Phase 2 nests Care, Outreach, and Discipleship pages. Ministry sub-pages collapsed into a single Adults page.',
    },
    pages: [
      { name: 'Home', slug: 'home', phase: '1', page_type: 'content', strategic_purpose: 'Mock', rationale: 'Mock', density: 'high', primary_action: 'Plan your visit' },
      { name: 'Sundays', slug: 'sundays', phase: '1', page_type: 'content', strategic_purpose: 'Mock', rationale: 'Replaces "Plan a Visit" to match voice', density: 'high', primary_action: 'Plan your first Sunday' },
      { name: 'Listen', slug: 'listen', phase: '1', page_type: 'content', strategic_purpose: 'Mock', rationale: 'Replaces "Sermons" — voice fit', density: 'high', primary_action: 'Watch the latest message' },
      { name: 'Give', slug: 'give', phase: '1', page_type: 'content', strategic_purpose: 'Mock', rationale: 'Mock', density: 'high', primary_action: 'Give now' },
      { name: 'About', slug: 'about', phase: '1', page_type: 'content', strategic_purpose: 'Mock', rationale: 'Mock', density: 'high', primary_action: 'Meet the team' },
      { name: 'Kids', slug: 'kids', phase: '1', page_type: 'content', strategic_purpose: 'Mock', rationale: 'Mock', density: 'high', primary_action: 'Pre-register' },
    ],
    nav_items: [
      { label: 'Sundays', kind: 'page', slug: 'sundays' },
      { label: 'Listen', kind: 'page', slug: 'listen' },
      { label: 'About', kind: 'page', slug: 'about' },
      { label: 'Kids', kind: 'page', slug: 'kids' },
      { label: 'Give', kind: 'page', slug: 'give' },
    ],
    absorbed_content: [
      { content_item: 'Apple Podcast', absorbed_into: null, rationale: 'Mock — Strategy Brief said don\'t promote.' },
    ],
    vocabulary_decisions: [
      { instead_of: 'Plan a Visit', we_chose: 'Sundays', why: 'Mock — voice fit.' },
      { instead_of: 'Sermons', we_chose: 'Listen', why: 'Mock — voice fit.' },
    ],
    aeo_keywords: {
      primary: ['mock church city', 'mock services city'],
      secondary: ['mock'],
      long_tail: ['mock'],
    },
    cs_flags: { hard_blockers: [], soft_assumptions: ['(Mock run.)'], design_flags: [] },
    sources_used: {
      stage_1: '(Mock run.)',
      conflicts_resolved: ['(Mock run.)'],
    },
  }
}
