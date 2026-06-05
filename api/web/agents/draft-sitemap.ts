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
import { resolvePromptServer } from './_lib/resolvePrompt'
import { FALLBACK_PROMPTS } from '../../../src/lib/pipelinePromptsCore'

// Vercel serverless functions default to a short timeout (10s Hobby / 60s
// Pro). Stage 2's full intake + 20K output ceiling can exceed that on
// cold-start runs. Opt into the Pro 300s ceiling so the agent has room.
export const maxDuration = 300

// Stage 2 makes voice-critical decisions (nav structure, page naming
// vocabulary) AND must rigorously account for every fact in the content
// collection. That's the same shape as Stage 1 (foundational synthesis) —
// Opus 4.7 handles it noticeably better than Sonnet on early testing
// (Sonnet emitted duplicate-label nav structures like "About > About,
// Beliefs" that Opus catches as malformed). With the lean schema (~5K
// output target) Opus has plenty of headroom under its output cap.
const MODEL = 'anthropic/claude-opus-4-7'
const MAX_OUTPUT_TOKENS = 16000  // 12k was hitting the ceiling for ~20+ page sitemaps with per-page AEO targets

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

  const roadmapState = project.roadmap_state as { stage_1?: Record<string, unknown>; stage_2?: Record<string, unknown> } | null
  const stage1 = roadmapState?.stage_1
  if (!stage1) {
    return res.status(400).json({ error: 'Stage 1 extraction must be complete before Stage 2 can run.' })
  }
  // If a redo is happening and a previous proposal exists, include it as
  // context so the model refines rather than rewriting from scratch.
  const previousStage2 = redoContext ? roadmapState?.stage_2 : null

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
  // FALLBACK_PROMPTS.sitemap (in pipelinePromptsCore) is the canonical
  // doc-driven Stage 2 prompt — single source of truth, mirrored into
  // the test runner. resolvePromptServer still applies any in-DB
  // global override + per-project addendum on top.
  const resolved = await resolvePromptServer(sb, 'sitemap', projectId)
  const systemPrompt = resolved.globalSource === 'fallback'
    ? FALLBACK_PROMPTS.sitemap
    : resolved.systemPrompt
  const userContent = buildUserContent({
    project, churchName, accountHandoff, brandGuide, discoveryQuestionnaire, stage1,
    filesLoaded, redoContext, previousStage2,
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
      // Note: extended thinking (providerOptions.anthropic.thinking)
      // is incompatible with forced tool_choice: 'tool'. The voice_audit
      // required field + post-emit integrity audit are the substitute
      // reasoning forcing mechanisms.
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

    // Post-emit integrity audit. Catches model failure modes the prompt
    // alone can't enforce: dropped pages on a redo, empty coverage audit,
    // orphaned pages, duplicate slugs, voice-contradicting labels.
    // Surfaces in cs_flags so the strategist sees what went wrong without
    // losing the draft.
    raw = applyIntegrityAudit(raw, previousStage2, !!redoContext, stage1)

    // Hard-enforce footer-only utility topics (newsletter/bulletin/etc).
    // The prompt says these can't appear in pages[], header_nav, or
    // nav_presentation above-the-fold surfaces — coerce regardless of
    // what the model emitted.
    raw = enforceFooterOnlyTopicsServer(raw)

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

export function buildSystemPrompt(): string {
  // FALLBACK_PROMPTS.sitemap is the canonical doc-driven prompt,
  // shared with the test runner so both paths use one source.
  return FALLBACK_PROMPTS.sitemap
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
  /** Previous Stage 2 proposal — only set on redo. When present, the
   *  model refines that proposal rather than rewriting from scratch. */
  previousStage2: Record<string, unknown> | null | undefined
}

export function buildUserContent(inputs: UserContentInputs): unknown[] {
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

  if (inputs.previousStage2) {
    // Strip _meta before sharing back to the model — it's bookkeeping
    const { _meta: _, ...prevWithoutMeta } = inputs.previousStage2 as { _meta?: unknown; [k: string]: unknown }
    void _
    blocks.push({
      type: 'text',
      text: `# Previous proposal (LOCKED — refine only what feedback names)\n\nThis is your previous proposal. It is the LOCKED BASELINE. The strategist's feedback follows in the next block.\n\n\`\`\`json\n${JSON.stringify(prevWithoutMeta, null, 2)}\n\`\`\``,
    })
  }

  if (inputs.redoContext) {
    blocks.push({
      type: 'text',
      text: `# Strategist's redo feedback\n\n${inputs.redoContext}\n\n# How to apply this feedback (read carefully)\n\n**The previous proposal is LOCKED except for the specific items the feedback names.**\n\nWhat that means concretely:\n\n1. **Page list:** Do not add, remove, rename, or consolidate any page unless the feedback explicitly says to. If the feedback mentions Events and Grow Tracks, only those change. Every other page (and its slug, name, parent, density, content_sources) stays IDENTICAL to the previous proposal — copy them through verbatim.\n\n2. **Nav structure:** Do not move, rename, or restructure any nav item, dropdown parent, or dropdown child unless the feedback names it. Header_nav and footer_nav stay byte-for-byte identical except where the feedback explicitly requests change.\n\n3. **Coverage audit, vocabulary decisions, AEO keywords, sources_used, cs_flags:** Carry forward verbatim from the previous proposal unless the feedback names them. If the previous proposal had a content_coverage_audit, COPY IT — do not regenerate it from scratch.\n\n4. **No "while I'm in here" improvements.** If you notice something you'd change but the strategist didn't mention, leave it. The strategist will request it in a future redo if they want it changed.\n\n5. **Test:** After drafting, walk every page in your output and ask "did the feedback explicitly name this for change?" If no, the page must match the previous proposal exactly. If you find yourself consolidating, renaming, or dropping a page that wasn't in the feedback — STOP and copy the previous version.\n\nThis is the most important rule of redo. Overstepping breaks the strategist's trust. The previous proposal had decisions you made for reasons — preserve them unless told otherwise.`,
    })
  }

  blocks.push({
    type: 'text',
    text: `Now propose the LEAN sitemap via the submit_sitemap tool.

Before submitting, run these audits in your head and revise until you pass each:

1. **Voice contradiction check.** Look at Stage 1's voice top_attributes and tone_examples_do. Does every nav label in header_nav and footer_nav honor that voice? If voice is participatory, no passive labels like "Listen" / "Watch". If voice is bold, no soft labels like "Get Involved".

2. **Goal contradiction check.** Look at the partner's stated primary goal. If it's about visitor accessibility / clarity, scrub insider language out of header_nav. Insider terms (ECC Kids, internal program names) belong on the page body, not in nav.

3. **X-factor leverage.** Is the X-factor reflected in nav vocabulary? If X-factor is "Relational Community", "Community" as a dropdown label is the natural move. If you didn't use it, justify in nav_strategy.

4. **Categorization sanity.** Walk every group and ask "would a visitor expect THIS child to live under THIS parent?". Events under Next Steps fails. Stories under Next Steps fails. Teens under Kids fails.

5. **Coverage check.** Every page must appear in header_nav OR footer_nav. Every concrete content collection item must appear in content_coverage_audit with a status. Nothing dropped silently.

6. **No duplicate parent labels.** No dropdown labeled the same word as one of its children.

Phase 1 = 6 pages (target). Total ≤ 20. Density-driven nesting. Flag every assumption.`,
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

export const SITEMAP_TOOL = {
  name: 'submit_sitemap',
  description: 'Submit the proposed strategic sitemap for this church website project.',
  input_schema: {
    type: 'object' as const,
    required: ['nav_strategy', 'nav_voice_register', 'nav_pattern', 'voice_audit', 'phase_summary', 'pages', 'header_nav', 'footer_nav', 'content_coverage_audit', 'sources_used', 'nav_presentation'],
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
      voice_audit: {
        type: 'object',
        description: 'REQUIRED reasoning trace. Forces explicit justification of nav vocabulary against Stage 1 voice. Skipping this = failure.',
        required: ['banned_terms', 'header_label_checks'],
        properties: {
          banned_terms: {
            type: 'array',
            description: 'Words/phrases Stage 1 voice rules out as nav labels. Extracted from tone_examples_do statements like "this isn\'t a church you watch" → "watch" is banned. Include synonyms (Watch / View / Stream). At least 1 entry if voice has any "isn\'t / doesn\'t / not" pattern.',
            items: {
              type: 'object',
              required: ['term', 'source'],
              properties: {
                term: { type: 'string', description: 'The banned word/phrase, e.g. "Watch".' },
                source: { type: 'string', description: 'The Stage 1 quote that bans it, e.g. "This isn\'t a church you watch."' },
              },
            },
          },
          header_label_checks: {
            type: 'array',
            description: 'For EVERY header_nav top-level item (page or group), one row justifying the label against Stage 1.',
            items: {
              type: 'object',
              required: ['label', 'voice_justification', 'passes_ban_check'],
              properties: {
                label: { type: 'string', description: 'The header_nav item label as you emitted it.' },
                voice_justification: { type: 'string', description: 'Which Stage 1 voice attribute or x_factor supports this label. If you can\'t justify it, change the label before emitting.' },
                passes_ban_check: { type: 'boolean', description: 'true if this label is NOT in banned_terms and doesn\'t contradict any tone_examples_do statement. If false, change the label.' },
              },
            },
          },
        },
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
        description: 'Every page in the sitemap. LEAN — no hero, sections, or CTAs. Those come in Stage 4 per-page.',
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
            strategic_purpose: { type: 'string', description: 'ONE sentence: what this page does for the visitor.' },
            rationale: { type: 'string', description: 'ONE sentence: why this page exists, why named this way.' },
            content_sources: { type: 'array', items: { type: 'string' }, description: 'Short list of intake sources that feed this page.' },
            density: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
        },
      },
      header_nav: {
        type: 'array',
        description: 'The primary header navigation tree. Items can be pages (kind="page") or groupings (kind="group") with children. Max 6 top-level items. Every kind="group" entry MUST carry intent_type + grouping_rationale so Stage 2.5 can audit grouping correctness.',
        items: {
          type: 'object',
          required: ['label', 'kind'],
          properties: {
            label: { type: 'string' },
            kind: { type: 'string', enum: ['page', 'group'] },
            slug: { type: 'string', description: 'Required when kind=page.' },
            rationale: { type: 'string' },
            intent_type: {
              type: 'string',
              enum: ['commitment_pathway','current_state','audience_pages',
                     'identity_trust','media_archive','giving_conversion',
                     'mandatory_visitor','misc'],
              description: 'Required when kind=group. Names the single intent the group serves. Children must share this intent.',
            },
            grouping_rationale: {
              type: 'string',
              description: 'Required when kind=group. Why these specific children cluster under this intent.',
            },
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
      footer_nav: {
        type: 'array',
        description: 'Footer navigation — required. Group pages into sections like "Connect" / "About" / "Resources". Every page not in header_nav MUST appear here. Includes utility (Contact, Privacy), secondary content (Blog, Share Your Story), tertiary (Membership, Jobs).',
        items: {
          type: 'object',
          required: ['section_label', 'items'],
          properties: {
            section_label: { type: 'string', description: 'E.g., "Connect", "About", "Resources".' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                required: ['label'],
                properties: {
                  label: { type: 'string' },
                  slug: { type: 'string', description: 'For internal pages. Omit for external links.' },
                  url: { type: 'string', description: 'For external links (e.g., social media).' },
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
      content_coverage_audit: {
        type: 'array',
        description: 'Required. Every concrete content item in the content collection, with its destination. The strategist uses this to verify nothing got silently dropped.',
        items: {
          type: 'object',
          required: ['content_item', 'status'],
          properties: {
            content_item: { type: 'string', description: 'Name as it appears in the content collection.' },
            landed_on: { type: ['string', 'null'], description: 'Page slug where it lives, or null if dropped.' },
            status: {
              type: 'string',
              enum: ['placed', 'nested', 'navonly', 'dropped'],
              description: 'placed = got a page; nested = section of another page; navonly = nav link only; dropped = intentionally excluded.',
            },
            note: { type: 'string', description: 'Why nested or dropped, when relevant.' },
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
      nav_presentation: {
        type: 'object',
        description: 'How the chosen nav_pattern is actually laid out — visible items + per-shell config. See the prompt for shell-specific schema.',
        required: ['shell','visible_top_level','presentation_rationale'],
        properties: {
          shell: { type: 'string',
            enum: ['standard_dropdowns','megamenu','offcanvas'] },
          presentation_rationale: { type: 'string',
            description: '1-2 sentences: why this shell fits the partner.' },
          visible_top_level: {
            type: 'array',
            description: 'Items visible in the header in their display order. For offcanvas this is intentionally lean (1-3 items + hamburger).',
            items: {
              type: 'object',
              required: ['kind','label'],
              properties: {
                kind:        { type: 'string', enum: ['page','group','button','hamburger'] },
                label:       { type: 'string' },
                slug:        { type: 'string' },
                group_label: { type: 'string', description: 'Refers to the header_nav group this represents.' },
              },
            },
          },
          standard_dropdowns: {
            type: 'object',
            description: 'Required when shell=standard_dropdowns.',
            properties: {
              groups: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['group_label','children'],
                  properties: {
                    group_label: { type: 'string' },
                    children: {
                      type: 'array',
                      items: {
                        type: 'object',
                        required: ['label','slug'],
                        properties: {
                          label:                { type: 'string' },
                          slug:                 { type: 'string' },
                          one_line_description: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          megamenu_panels: {
            type: 'array',
            description: 'Required when shell=megamenu. One panel per top-level dropdown.',
            items: {
              type: 'object',
              required: ['triggered_by','columns'],
              properties: {
                triggered_by: { type: 'string', description: 'Top-level label that opens this panel.' },
                columns: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['heading','links'],
                    properties: {
                      heading:     { type: 'string' },
                      description: { type: 'string' },
                      links: {
                        type: 'array',
                        items: {
                          type: 'object',
                          required: ['label','slug'],
                          properties: {
                            label:                { type: 'string' },
                            slug:                 { type: 'string' },
                            one_line_description: { type: 'string' },
                          },
                        },
                      },
                    },
                  },
                },
                featured_tile: {
                  type: 'object',
                  properties: {
                    kind:       { type: 'string', enum: ['image_cta','sermon_card','event_card','persona_callout'] },
                    heading:    { type: 'string' },
                    body:       { type: 'string' },
                    link_label: { type: 'string' },
                    link_slug:  { type: 'string' },
                  },
                },
              },
            },
          },
          offcanvas_overlay: {
            type: 'object',
            description: 'Required when shell=offcanvas. The full nav lives inside this overlay.',
            properties: {
              hero_message: { type: 'string' },
              sections: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['section_label','links'],
                  properties: {
                    section_label: { type: 'string' },
                    links: {
                      type: 'array',
                      items: {
                        type: 'object',
                        required: ['label','slug'],
                        properties: {
                          label: { type: 'string' },
                          slug:  { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
              surfaced_facts: {
                type: 'object',
                properties: {
                  service_times: { type: 'string' },
                  address:       { type: 'string' },
                  socials:       { type: 'array', items: { type: 'object',
                    properties: { platform: { type: 'string' }, url: { type: 'string' } } } },
                  search:        { type: 'boolean' },
                },
              },
            },
          },
        },
      },
    },
  },
}

// ── Post-emit integrity audit ────────────────────────────────────────

/**
 * Run sanity checks on the model's output. Surfaces violations in
 * cs_flags.hard_blockers so the strategist sees what the model failed
 * to enforce, without losing the partial draft.
 *
 * Checks:
 *  - Redo: previous pages that vanished without being named in redo
 *  - Empty coverage audit
 *  - Pages orphaned from both header_nav and footer_nav
 *  - Duplicate slugs
 *  - Mandatory Phase 1 pages missing
 */
/**
 *  Footer-only utility enforcement. Belt-and-suspenders for newsletter
 *  and similar signup-only topics. Strips them from pages[], header_nav
 *  (top-level + dropdown children), nav_presentation (visible_top_level,
 *  standard_dropdowns groups, megamenu panels, offcanvas overlay), and
 *  ensures they land in footer_nav under a "Stay in Touch" column.
 */
const FOOTER_ONLY_LABEL_RX = /^(newsletter|bulletin|sign[\-_ ]?up|stay[\-_ ]?in[\-_ ]?touch|email[\-_ ]?list)/i
const FOOTER_ONLY_SLUG_RX  = /(^|[\/_-])(newsletter|bulletin|signup|sign-up|emaillist)([\/_-]|$)/i
function isFooterOnlyItem(it: { label?: string; slug?: string; name?: string } | null | undefined): boolean {
  if (!it) return false
  const label = it.label ?? it.name ?? ''
  if (label && FOOTER_ONLY_LABEL_RX.test(label)) return true
  if (it.slug && FOOTER_ONLY_SLUG_RX.test(it.slug)) return true
  return false
}
function enforceFooterOnlyTopicsServer(raw: Record<string, unknown>): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return raw
  const sitemap = raw as any
  const stripped: Array<{ slug?: string; label?: string }> = []

  if (Array.isArray(sitemap.pages)) {
    sitemap.pages = sitemap.pages.filter((p: any) => {
      if (isFooterOnlyItem(p)) { stripped.push({ slug: p.slug, label: p.name }); return false }
      return true
    })
  }
  if (Array.isArray(sitemap.header_nav)) {
    sitemap.header_nav = sitemap.header_nav
      .filter((it: any) => !isFooterOnlyItem(it))
      .map((it: any) => {
        if (Array.isArray(it.children)) {
          it.children = it.children.filter((c: any) => !isFooterOnlyItem(c))
        }
        return it
      })
  }
  const np = sitemap.nav_presentation
  if (np && typeof np === 'object') {
    if (Array.isArray(np.visible_top_level)) {
      np.visible_top_level = np.visible_top_level.filter((it: any) => !isFooterOnlyItem(it))
    }
    if (np.standard_dropdowns?.groups) {
      for (const g of np.standard_dropdowns.groups) {
        if (Array.isArray(g.children)) g.children = g.children.filter((c: any) => !isFooterOnlyItem(c))
      }
    }
    if (Array.isArray(np.megamenu_panels)) {
      for (const p of np.megamenu_panels) {
        if (Array.isArray(p.columns)) {
          for (const col of p.columns) {
            if (Array.isArray(col.links)) col.links = col.links.filter((l: any) => !isFooterOnlyItem(l))
          }
        }
        if (p.featured_tile && isFooterOnlyItem({ slug: p.featured_tile.link_slug })) {
          delete p.featured_tile
        }
      }
    }
    if (np.offcanvas_overlay?.sections) {
      for (const s of np.offcanvas_overlay.sections) {
        if (Array.isArray(s.links)) s.links = s.links.filter((l: any) => !isFooterOnlyItem(l))
      }
    }
  }
  if (stripped.length > 0 && Array.isArray(sitemap.footer_nav)) {
    let stayCol = sitemap.footer_nav.find((c: any) =>
      /stay|touch|connect|follow|utility/i.test(String(c?.section_label ?? '')))
    if (!stayCol) {
      stayCol = { section_label: 'Stay in Touch', items: [] }
      sitemap.footer_nav.push(stayCol)
    }
    stayCol.items = stayCol.items ?? []
    for (const s of stripped) {
      const label = s.label ?? 'Newsletter'
      if (!stayCol.items.some((it: any) => (it.label ?? '').toLowerCase() === label.toLowerCase())) {
        stayCol.items.push({ label, slug: null, url: null, kind: 'footer_signup' })
      }
    }
    console.log(`[draft-sitemap] footer-only enforcement: stripped ${stripped.length} item(s) from above-the-fold nav: ${stripped.map(s => s.label ?? s.slug).join(', ')}`)
  }
  return sitemap
}

function applyIntegrityAudit(
  raw: Record<string, unknown>,
  previousStage2: Record<string, unknown> | null | undefined,
  isRedo: boolean,
  stage1: Record<string, unknown>,
): Record<string, unknown> {
  const violations: string[] = []

  const pages = Array.isArray(raw.pages) ? raw.pages as Array<Record<string, unknown>> : []
  const pageSlugs = new Set(pages.map(p => String(p.slug ?? '')).filter(Boolean))

  // 0. Voice-contradicting nav labels. Extract "isn't a church you X"
  // / "not a Y" / "doesn't Z" patterns from tone_examples_do and ban
  // those verbs/nouns as nav labels.
  const voiceChar = stage1.voice_characteristics as Record<string, unknown> | undefined
  const toneDo = Array.isArray(voiceChar?.tone_examples_do) ? voiceChar!.tone_examples_do as string[] : []
  const bannedTerms = new Set<string>()
  const banContext: Record<string, string> = {}
  for (const example of toneDo) {
    // Match patterns like "isn't a church you watch", "not a place to listen", "doesn't preach"
    const patterns = [
      /isn't a (?:church|place) (?:you |where (?:you )?)?(\w+)/gi,
      /not a (?:church|place) (?:you |where (?:you )?)?(\w+)/gi,
      /doesn't (?:just )?(\w+)/gi,
      /this isn't [\w\s]*?(?:you |to )(\w+)/gi,
    ]
    for (const rx of patterns) {
      let m: RegExpExecArray | null
      while ((m = rx.exec(example)) !== null) {
        const verb = m[1].toLowerCase()
        if (verb.length > 2 && !COMMON_WORDS.has(verb)) {
          bannedTerms.add(verb)
          banContext[verb] = example
        }
      }
    }
  }
  // Synonym groups — if "watch" is banned, also catch "view" / "stream" / "listen-passive"
  const synonymGroups: Record<string, string[]> = {
    watch: ['view', 'stream', 'tune'],
    listen: ['hear'],
  }
  for (const banned of [...bannedTerms]) {
    if (synonymGroups[banned]) {
      for (const syn of synonymGroups[banned]) {
        bannedTerms.add(syn)
        banContext[syn] = `Synonym of "${banned}" — ${banContext[banned]}`
      }
    }
  }
  if (bannedTerms.size > 0) {
    const headerLabels = collectLabels(raw.header_nav as Array<Record<string, unknown>> | undefined)
    const violatingLabels = headerLabels.filter(l => bannedTerms.has(l.toLowerCase()))
    if (violatingLabels.length > 0) {
      const offenders = violatingLabels.map(l => `"${l}" (banned by: ${banContext[l.toLowerCase()] ?? '?'})`).join('; ')
      violations.push(`Nav label(s) contradict Stage 1 voice: ${offenders}. The voice tone_examples_do explicitly rules these terms out.`)
    }
  }

  // 1. Dropped pages on a redo
  if (isRedo && previousStage2) {
    const prevPages = Array.isArray(previousStage2.pages) ? previousStage2.pages as Array<Record<string, unknown>> : []
    const dropped = prevPages
      .map(p => ({ slug: String(p.slug ?? ''), name: String(p.name ?? '') }))
      .filter(p => p.slug && !pageSlugs.has(p.slug))
    if (dropped.length > 0) {
      violations.push(
        `Pages from the previous proposal that the redo dropped without being mentioned in the strategist's feedback: ${dropped.map(p => `${p.name} (${p.slug})`).join(', ')}. Verify these were intentional removals — if not, redo with feedback that preserves them.`,
      )
    }
  }

  // 2. Empty coverage audit
  const audit = Array.isArray(raw.content_coverage_audit) ? raw.content_coverage_audit as Array<unknown> : []
  if (audit.length === 0) {
    violations.push('content_coverage_audit is empty. The agent skipped the required audit pass — content collection items may have been dropped silently.')
  }

  // 3. Orphaned pages (not in header or footer)
  const headerSlugs = collectSlugs(raw.header_nav as Array<Record<string, unknown>> | undefined)
  const footerSlugs = collectFooterSlugs(raw.footer_nav as Array<Record<string, unknown>> | undefined)
  const navSlugs = new Set([...headerSlugs, ...footerSlugs])
  const orphans = pages.filter(p => p.slug && !navSlugs.has(String(p.slug))).map(p => `${p.name} (${p.slug})`)
  if (orphans.length > 0) {
    violations.push(`Pages not reachable from header_nav or footer_nav: ${orphans.join(', ')}. Every page must have a nav home.`)
  }

  // 4. Duplicate slugs in pages
  const slugCounts = new Map<string, number>()
  pages.forEach(p => {
    const s = String(p.slug ?? '')
    if (s) slugCounts.set(s, (slugCounts.get(s) ?? 0) + 1)
  })
  const dupes = Array.from(slugCounts.entries()).filter(([, count]) => count > 1)
  if (dupes.length > 0) {
    violations.push(`Duplicate slugs in pages[]: ${dupes.map(([s, n]) => `/${s} (×${n})`).join(', ')}.`)
  }

  // 5. Mandatory Phase 1 pages — match by likely name patterns
  const checkPage = (patterns: RegExp[], required: string) => {
    const found = pages.some(p => {
      const name = String(p.name ?? '').toLowerCase()
      const slug = String(p.slug ?? '').toLowerCase()
      return patterns.some(rx => rx.test(name) || rx.test(slug))
    })
    if (!found) violations.push(`Mandatory Phase 1 page missing: ${required}.`)
  }
  checkPage([/^home$|homepage/], 'Homepage')
  checkPage([/visit|sunday|first.?time|new.?here/], 'Plan a Visit / Sundays equivalent')
  checkPage([/sermon|message|listen|watch/], 'Sermons / Messages equivalent')
  checkPage([/give|generosity|tith/], 'Give / Generosity equivalent')

  if (violations.length === 0) return raw

  // Inject violations into cs_flags.hard_blockers so the strategist sees them
  const existingFlags = raw.cs_flags as Record<string, unknown> | undefined
  const existingBlockers = Array.isArray(existingFlags?.hard_blockers) ? existingFlags!.hard_blockers as string[] : []
  return {
    ...raw,
    cs_flags: {
      ...(existingFlags ?? {}),
      hard_blockers: [...violations.map(v => `[Auto-detected] ${v}`), ...existingBlockers],
    },
  }
}

// Words that show up in "isn't a church you ___" patterns but aren't real
// constraints — skip them.
const COMMON_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'be', 'to', 'of',
  'in', 'on', 'at', 'by', 'for', 'with', 'as', 'into', 'just', 'about',
])

function collectLabels(items: Array<Record<string, unknown>> | undefined): string[] {
  if (!Array.isArray(items)) return []
  const out: string[] = []
  for (const it of items) {
    if (it.label && typeof it.label === 'string') out.push(it.label)
    if (Array.isArray(it.children)) {
      for (const child of it.children as Array<Record<string, unknown>>) {
        if (child.label && typeof child.label === 'string') out.push(child.label)
      }
    }
  }
  return out
}

function collectSlugs(items: Array<Record<string, unknown>> | undefined): string[] {
  if (!Array.isArray(items)) return []
  const out: string[] = []
  for (const it of items) {
    if (it.slug && typeof it.slug === 'string') out.push(it.slug)
    if (Array.isArray(it.children)) {
      for (const child of it.children as Array<Record<string, unknown>>) {
        if (child.slug && typeof child.slug === 'string') out.push(child.slug)
      }
    }
  }
  return out
}

function collectFooterSlugs(sections: Array<Record<string, unknown>> | undefined): string[] {
  if (!Array.isArray(sections)) return []
  const out: string[] = []
  for (const section of sections) {
    if (Array.isArray(section.items)) {
      for (const item of section.items as Array<Record<string, unknown>>) {
        if (item.slug && typeof item.slug === 'string') out.push(item.slug)
      }
    }
  }
  return out
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
      { name: 'Home',    slug: 'home',    phase: '1', page_type: 'content', strategic_purpose: 'Welcome visitors and route them to their next step.', rationale: 'Always Phase 1. Anchors the brand refresh online.', density: 'high', content_sources: ['Strategy Brief', 'Content Collection'] },
      { name: 'Sundays', slug: 'sundays', phase: '1', page_type: 'content', strategic_purpose: 'Help first-time visitors plan their first Sunday.', rationale: 'Replaces "Plan a Visit" — bolder voice fit.', density: 'high', content_sources: ['Content Collection'] },
      { name: 'Listen',  slug: 'listen',  phase: '1', page_type: 'content', strategic_purpose: 'Surface the most recent message and curated clips.', rationale: 'Replaces "Sermons" — voice fit.', density: 'high', content_sources: ['AM Handoff', 'Content Collection'] },
      { name: 'Give',    slug: 'give',    phase: '1', page_type: 'content', strategic_purpose: 'Make giving frictionless and trust-building.', rationale: 'Mandatory Phase 1 across every project.', density: 'high', content_sources: ['Content Collection'] },
      { name: 'About',   slug: 'about',   phase: '1', page_type: 'content', strategic_purpose: 'Tell the church story and introduce the team.', rationale: 'Chosen as Phase 1 because trust-building is primary goal.', density: 'high', content_sources: ['Strategy Brief', 'Content Collection'] },
      { name: 'Kids',    slug: 'kids',    phase: '1', page_type: 'content', strategic_purpose: 'Reassure parents and pre-register for kids ministry.', rationale: 'Chosen as Phase 1 because families are explicit target.', density: 'high', content_sources: ['Content Collection'] },
    ],
    header_nav: [
      { label: 'Sundays',   kind: 'page', slug: 'sundays' },
      { label: 'Messages',  kind: 'page', slug: 'messages' },
      { label: 'Community', kind: 'group', children: [
        { label: 'About', kind: 'page', slug: 'about' },
        { label: 'Kids',  kind: 'page', slug: 'kids' },
      ]},
      { label: 'Give', kind: 'page', slug: 'give' },
    ],
    footer_nav: [
      { section_label: 'Connect', items: [{ label: 'Contact', slug: 'contact' }, { label: 'Share Your Story', slug: 'share-your-story' }] },
      { section_label: 'About',   items: [{ label: 'Our Beliefs', slug: 'beliefs' }] },
    ],
    content_coverage_audit: [
      { content_item: '(Mock run — full audit lands on real runs.)', status: 'placed', landed_on: 'home' },
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
