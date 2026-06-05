/**
 * Vercel Serverless Function — /api/web/agents/voice-pass
 *
 * Stage 7 of the copywriting pipeline. Brand-voice rewrite of every
 * string slot across every section, run PER PAGE so each page gets
 * the model's full attention with its full context (Stage 4 contract
 * + current field_values for that page only).
 *
 * Architectural change vs. the prior bulk approach: the old version
 * ran one Opus call across ~150 slots × 17 pages. Each rewrite got
 * shallow attention; Opus's parallel-clause/rhetorical-question tic
 * surfaced often. The new version runs one Sonnet 4.6 call per page,
 * usually 8-12 slots in scope per call. Each rewrite lands with the
 * full per-page voice context and structural rules.
 *
 * Code validation runs AFTER the model returns: every rewrite is
 * checked against hard structural rules (heading word count, no `?`
 * in heading slots, required_messages still present). Failures are
 * dropped from rewrites[] and pushed to skipped[] with a
 * "validation_failed_<reason>" tag. The strategist sees them in the
 * preview drawer and can Refine or hand-edit.
 *
 * Writes:
 *  • roadmap_state.stage_7 — the rewrite manifest (rewrites + skipped)
 *  • web_sections.field_values — applied rewrites (when apply=true)
 *  • web_sections.field_provenance — marks rewritten fields as 'voice_pass'
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { generateText, jsonSchema, tool } from 'ai'
import { resolvePromptServer } from './_lib/resolvePrompt'

export const maxDuration = 600  // 17 pages × ~10 sec parallel + overhead
// Sonnet 4.6 is the target model for voice work. If the AI Gateway
// hasn't enabled 4.6 yet (the codebase otherwise uses claude-opus-4-7
// and claude-haiku-4-5), set VOICE_PASS_MODEL_OVERRIDE on the
// environment to fall back to claude-sonnet-4-5 or another model
// without a redeploy.
const MODEL = process.env.VOICE_PASS_MODEL_OVERRIDE || 'anthropic/claude-sonnet-4-6'
const MAX_OUTPUT_TOKENS_PER_PAGE = 8000

// Field keys that get treated as headings for structural validation.
// Matches the prefix patterns Brixies templates use across families.
const HEADING_PREFIX_RE = /^(heading|title|h[1-6]|page_title|section_title)$/i
const MAX_HEADING_WORDS = 7

const TOOL = {
  description: 'Submit voice-pass rewrites + skips for this page.',
  input_schema: {
    type: 'object',
    properties: {
      rewrites: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            web_section_id:        { type: 'string' },
            field_key:             { type: 'string' },
            old_value:             { type: 'string' },
            new_value:             { type: 'string' },
            voice_alignment_score: { type: 'number' },
            rationale:             { type: 'string' },
          },
          required: ['web_section_id','field_key','old_value','new_value','voice_alignment_score','rationale'],
        },
      },
      skipped: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            web_section_id: { type: 'string' },
            field_key:      { type: 'string' },
            reason:         { type: 'string' },
          },
          required: ['web_section_id','field_key','reason'],
        },
      },
    },
    required: ['rewrites','skipped'],
  },
}

interface Rewrite {
  web_section_id:        string
  field_key:             string
  old_value:             string
  new_value:             string
  voice_alignment_score: number
  rationale:             string
}

interface Skip {
  web_section_id: string
  field_key:      string
  reason:         string
}

interface SectionContract {
  page_slug:           string
  section_id:          string
  required_messages:   string[]
  keyword_assignments: { primary?: string[]; supporting?: string[] } | null
  cta:                 { label: string; destination_page: string } | null
}

interface WebSection {
  id: string
  web_page_id: string
  content_template_id: string | null
  field_values: Record<string, unknown> | null
  field_provenance: Record<string, { source?: string }> | null
  sort_order: number | null
}

interface WebPage { id: string; slug: string; name: string }

/** Hard structural rules applied AFTER the model returns. Any rewrite
 *  that fails ends up in skipped[] with reason='validation_failed_X'
 *  instead of getting silently shipped. */
function validateRewrite(r: Rewrite, contract?: SectionContract): { ok: true } | { ok: false; reason: string } {
  const isHeading = HEADING_PREFIX_RE.test(r.field_key.trim())
  const value = (r.new_value ?? '').trim()
  if (isHeading) {
    if (value.includes('?')) {
      return { ok: false, reason: 'validation_failed_heading_has_question_mark' }
    }
    const wordCount = value.split(/\s+/).filter(Boolean).length
    if (wordCount > MAX_HEADING_WORDS) {
      return { ok: false, reason: `validation_failed_heading_${wordCount}_words_max_${MAX_HEADING_WORDS}` }
    }
    // Detect the question-answer pattern even without an explicit `?`:
    // "Either or? Neither." — clauses divided by `? ` and the second
    // clause is a single word or two-word punchline.
    // Already caught by the `?` check above, but keep this as a safety
    // net if the model emits the pattern with em-dash or comma instead.
    if (/^\S+(\s\S+){0,1}[.?!]$/.test(value) && /[?]/.test(value)) {
      return { ok: false, reason: 'validation_failed_question_answer_punchline' }
    }
  }
  // Contract enforcement — required_messages must remain present in
  // SOMEWHERE in the rewrite or its section (best-effort check on a
  // per-rewrite basis: at minimum, the required message keywords
  // should not be wholly absent if the OLD value contained them).
  if (contract && contract.required_messages.length > 0) {
    for (const rm of contract.required_messages) {
      // Pull a few "signal" tokens from the required message — proper
      // nouns and numeric tokens are load-bearing; if they appear in
      // old_value but vanish from new_value, that's a drop.
      const signals = (rm.match(/\b[A-Z][a-z]+|\b\d+(?:[apm]+)?\b/g) ?? []).filter(Boolean)
      for (const sig of signals) {
        if (r.old_value.includes(sig) && !r.new_value.includes(sig)) {
          return { ok: false, reason: `validation_failed_dropped_required_signal_${sig}` }
        }
      }
    }
  }
  return { ok: true }
}

/** Run one Sonnet 4.6 call for a single page. Returns rewrites + skips
 *  (server-validated) plus token usage. */
async function runPage(
  page: WebPage,
  pageSections: WebSection[],
  pageContracts: SectionContract[],
  voiceCard: unknown,
  personas: unknown,
  brandGuide: unknown,
  previousForPage: unknown,
  redoContext: string,
  systemPrompt: string,
): Promise<{ rewrites: Rewrite[]; skipped: Skip[]; usage: { input_tokens?: number; output_tokens?: number } }> {
  const userText = [
    `# Page\n${page.name} (/${page.slug})`,
    `# Voice card (Stage 1)\n${JSON.stringify(voiceCard, null, 2)}`,
    `# Personas (Stage 1)\n${JSON.stringify(personas, null, 2)}`,
    brandGuide && `# Brand guide\n${JSON.stringify(brandGuide, null, 2)}`,
    pageContracts.length > 0 &&
      `# Stage 4 section contracts — load-bearing constraints for THIS page\n` +
      `For each section_id, required_messages must survive any rewrite verbatim or paraphrased (signal tokens stay), keyword_assignments.primary phrases must remain in heading or lead sentence, and cta.label MUST NOT change.\n` +
      JSON.stringify(pageContracts, null, 2),
    `# Sections to rewrite — current field_values + provenance\n${JSON.stringify(pageSections, null, 2)}`,
    previousForPage && `# Previous voice-pass output for this page\n${JSON.stringify(previousForPage, null, 2)}`,
    redoContext && `# Strategist redo feedback\n${redoContext}`,
  ].filter(Boolean).join('\n\n')

  const result = await generateText({
    model: MODEL,
    maxOutputTokens: MAX_OUTPUT_TOKENS_PER_PAGE,
    system: systemPrompt,
    messages: [{ role: 'user', content: userText }],
    tools: {
      submit_voice_rewrites: tool({
        description: TOOL.description,
        inputSchema: jsonSchema(TOOL.input_schema as any),
      }),
    },
    toolChoice: { type: 'tool', toolName: 'submit_voice_rewrites' },
  })

  const usage = { input_tokens: result.usage?.inputTokens, output_tokens: result.usage?.outputTokens }
  const toolCall = result.toolCalls?.[0]
  if (!toolCall || toolCall.toolName !== 'submit_voice_rewrites') {
    throw new Error(`Page ${page.slug}: Model did not return submit_voice_rewrites tool call`)
  }
  const raw = toolCall.input as { rewrites: Rewrite[]; skipped: Skip[] }
  const contractBySection = new Map(pageContracts.map(c => [c.section_id, c]))

  // Filter to sections we asked about (defensive) + run validation.
  const sectionIds = new Set(pageSections.map(s => s.id))
  const rewrites: Rewrite[] = []
  const skipped:  Skip[]    = []

  for (const r of (raw.rewrites ?? [])) {
    if (!sectionIds.has(r.web_section_id)) continue  // model hallucinated a section
    // Try to find a contract by section_id — Stage 4's section_id
    // doesn't match web_section_id, so look up by sort-order alignment
    // (best-effort, will be skipped if no contract matches).
    const section = pageSections.find(s => s.id === r.web_section_id)
    let contract: SectionContract | undefined
    if (section) {
      const sortedSections = pageSections.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      const idx = sortedSections.findIndex(s => s.id === r.web_section_id)
      contract = pageContracts[idx]
    }
    void contractBySection
    const verdict = validateRewrite(r, contract)
    if (verdict.ok) {
      rewrites.push(r)
    } else {
      skipped.push({
        web_section_id: r.web_section_id,
        field_key:      r.field_key,
        reason:         verdict.reason,
      })
    }
  }
  for (const s of (raw.skipped ?? [])) {
    if (sectionIds.has(s.web_section_id)) skipped.push(s)
  }
  return { rewrites, skipped, usage }
}

export default async function handler(req: any, res: any) {
  try {
    return await voicePassHandler(req, res)
  } catch (err: any) {
    // Catch ANY uncaught exception (validation regex bugs, model
    // gateway failures bubbling up outside the per-page try, JSON
    // parse failures, etc.) and surface a real message in the
    // response. Without this wrap, Vercel returns a generic 500
    // with no body, which gives the strategist nothing to act on.
    const message = err instanceof Error ? err.message : String(err)
    const stack   = err instanceof Error ? err.stack    : undefined
    console.error('[voice-pass] uncaught error:', message, stack)
    return res.status(500).json({
      error: `voice-pass uncaught: ${message}`,
      model: MODEL,
      stack: stack?.split('\n').slice(0, 8).join('\n'),
    })
  }
}

async function voicePassHandler(req: any, res: any) {
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
  const apply = req.body?.apply === true
  const pageSlugs: string[] | null = Array.isArray(req.body?.pageSlugs) && req.body.pageSlugs.every((s: unknown) => typeof s === 'string')
    ? req.body.pageSlugs as string[]
    : null
  if (!projectId) return res.status(400).json({ error: 'projectId required' })

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  const { data: project } = await sb.from('strategy_web_projects')
    .select('*').eq('id', projectId).maybeSingle()
  if (!project) return res.status(404).json({ error: 'Project not found' })

  const roadmapState = (project.roadmap_state ?? {}) as Record<string, unknown>
  const stage1 = roadmapState.stage_1
  if (!stage1) return res.status(400).json({ error: 'Stage 1 strategy is required for voice context.' })

  const { data: brandGuide } = await sb.from('strategy_brand_guides')
    .select('voice_overview, brand_statement, style_tags')
    .eq('member', project.member).eq('is_published', true).maybeSingle()

  const { data: pages } = await sb.from('web_pages')
    .select('id, slug, name').eq('web_project_id', projectId).eq('archived', false)
  const scopedPages: WebPage[] = (pageSlugs && pageSlugs.length > 0
    ? (pages ?? []).filter(p => pageSlugs.includes(p.slug as string))
    : (pages ?? [])) as WebPage[]
  const pageIds = scopedPages.map(p => p.id)
  const { data: sections } = await sb.from('web_sections')
    .select('id, web_page_id, content_template_id, field_values, field_provenance, sort_order')
    .eq('archived', false)
  const ourSections = ((sections ?? []) as WebSection[]).filter(s => pageIds.includes(s.web_page_id))

  // ── Apply mode (unchanged from prior version) ──
  if (apply) {
    const stage7 = roadmapState.stage_7 as { rewrites?: Array<Record<string, unknown>> } | undefined
    if (!stage7?.rewrites) {
      return res.status(400).json({ error: 'No Stage 7 manifest to apply. Run the pass first.' })
    }
    let applied = 0, blockedByOverride = 0, omittedByUser = 0
    for (const r of stage7.rewrites) {
      if (r.omitted === true) { omittedByUser++; continue }
      const sectionId = String(r.web_section_id)
      const fieldKey  = String(r.field_key)
      const override  = typeof r.user_value === 'string' && r.user_value.length > 0
        ? r.user_value
        : null
      const newValue  = override ?? r.new_value
      const sec = ourSections.find(s => s.id === sectionId)
      if (!sec) continue
      const prov = (sec.field_provenance ?? {}) as Record<string, { source?: string }>
      if (prov[fieldKey]?.source === 'override') { blockedByOverride++; continue }
      const updated = { ...(sec.field_values as Record<string, unknown>), [fieldKey]: newValue }
      const sourceTag = override ? 'strategist_voice_pass' : 'voice_pass'
      const updatedProv = { ...prov, [fieldKey]: { ...(prov[fieldKey] ?? {}), source: sourceTag } }
      const { error } = await sb.from('web_sections')
        .update({ field_values: updated, field_provenance: updatedProv })
        .eq('id', sectionId)
      if (!error) applied++
    }
    return res.status(200).json({
      ok: true,
      applied,
      blocked_by_override: blockedByOverride,
      omitted_by_user:     omittedByUser,
    })
  }

  // ── Generation mode (NEW per-page architecture) ──
  const previous = redoContext ? roadmapState.stage_7 : undefined
  const resolved = await resolvePromptServer(sb, 'voice_pass', projectId)

  const stage4 = roadmapState.stage_4 as { page_outlines?: any[] } | undefined
  const allContracts: SectionContract[] = []
  if (stage4?.page_outlines) {
    for (const page of stage4.page_outlines) {
      if (pageSlugs && pageSlugs.length > 0 && !pageSlugs.includes(page.page_slug)) continue
      for (const sec of (page.sections ?? [])) {
        allContracts.push({
          page_slug:           page.page_slug,
          section_id:          sec.section_id,
          required_messages:   Array.isArray(sec.required_messages) ? sec.required_messages : [],
          keyword_assignments: sec.keyword_assignments ?? null,
          cta:                 sec.cta ? { label: sec.cta.label, destination_page: sec.cta.destination_page } : null,
        })
      }
    }
  }

  // Group sections + contracts by page so we can call the model once
  // per page with full per-page context.
  const sectionsByPage = new Map<string, WebSection[]>()
  for (const s of ourSections) {
    if (!sectionsByPage.has(s.web_page_id)) sectionsByPage.set(s.web_page_id, [])
    sectionsByPage.get(s.web_page_id)!.push(s)
  }
  const contractsBySlug = new Map<string, SectionContract[]>()
  for (const c of allContracts) {
    if (!contractsBySlug.has(c.page_slug)) contractsBySlug.set(c.page_slug, [])
    contractsBySlug.get(c.page_slug)!.push(c)
  }

  // Build the list of work items we'll process.
  const workItems = scopedPages
    .map(page => {
      const pageSections = (sectionsByPage.get(page.id) ?? []).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      const pageContracts = contractsBySlug.get(page.slug) ?? []
      return { page, pageSections, pageContracts }
    })
    .filter(w => w.pageSections.length > 0)

  // Per-page previous output, so each call only sees its own history.
  const previousByPageSlug = new Map<string, unknown>()
  if (previous && Array.isArray((previous as any)?.rewrites)) {
    const prevRewrites = (previous as any).rewrites as any[]
    const sectionIdToPageId = new Map(ourSections.map(s => [s.id, s.web_page_id]))
    const pageIdToSlug = new Map(scopedPages.map(p => [p.id, p.slug]))
    for (const r of prevRewrites) {
      const pageId = sectionIdToPageId.get(r.web_section_id)
      if (!pageId) continue
      const slug = pageIdToSlug.get(pageId)
      if (!slug) continue
      if (!previousByPageSlug.has(slug)) previousByPageSlug.set(slug, { rewrites: [] })
      ;((previousByPageSlug.get(slug) as any).rewrites as any[]).push(r)
    }
  }

  // Fire all pages in parallel. Sonnet 4.6 is fast enough that even
  // 17 pages finish under the 600s maxDuration. If a single page
  // errors, we keep the rest — the strategist can refine just that
  // page after seeing the partial result.
  const pageResults = await Promise.allSettled(workItems.map(w =>
    runPage(
      w.page,
      w.pageSections,
      w.pageContracts,
      (stage1 as any).voice_characteristics,
      (stage1 as any).personas,
      brandGuide ?? null,
      previousByPageSlug.get(w.page.slug) ?? null,
      redoContext,
      resolved.systemPrompt,
    ),
  ))

  const rewrites: Rewrite[] = []
  const skipped:  Skip[]    = []
  let totalIn = 0, totalOut = 0
  const pageErrors: Array<{ slug: string; error: string }> = []
  pageResults.forEach((r, i) => {
    const slug = workItems[i].page.slug
    if (r.status === 'fulfilled') {
      rewrites.push(...r.value.rewrites)
      skipped.push(...r.value.skipped)
      totalIn  += r.value.usage.input_tokens  ?? 0
      totalOut += r.value.usage.output_tokens ?? 0
    } else {
      pageErrors.push({ slug, error: r.reason instanceof Error ? r.reason.message : String(r.reason) })
    }
  })

  // Differentiate empty-workload from total-failure. An empty workItems
  // list means we found no sections in scope (probably a bad pageSlugs
  // filter); that should fail loud with a clear message, not pretend
  // 0/0 pages succeeded.
  if (workItems.length === 0) {
    return res.status(400).json({
      error: 'No sections found in scope. Check that pageSlugs match real sitemap pages with bound web_sections.',
      scoped_to_page_slugs: pageSlugs,
      scoped_page_count:    scopedPages.length,
      total_section_count:  ourSections.length,
    })
  }
  if (pageErrors.length === workItems.length) {
    return res.status(502).json({
      error: 'All per-page voice-pass calls failed',
      model: MODEL,
      pageErrors,
    })
  }

  const usage = { input_tokens: totalIn, output_tokens: totalOut }
  const meta = {
    status: 'draft',
    generated_at: new Date().toISOString(),
    model: MODEL,
    prompt_source: resolved.globalSource,
    has_project_addendum: resolved.hasProjectAddendum,
    scoped_to_page_slugs: pageSlugs ?? null,
    architecture: 'per_page_calls',
    pages_succeeded: workItems.length - pageErrors.length,
    pages_failed:    pageErrors.length,
    page_errors:     pageErrors.length > 0 ? pageErrors : undefined,
    redo_count: typeof (previous as any)?._meta?.redo_count === 'number'
      ? (previous as any)._meta.redo_count + (redoContext ? 1 : 0)
      : 0,
    usage,
  }

  // Merge with previous output when scoped: keep rewrites + skips for
  // sections NOT in scope; replace those in scope with new results.
  const sectionIdsInScope = new Set(ourSections.map(s => s.id))
  let mergedRewrites: any[]
  let mergedSkipped:  any[]
  if (pageSlugs && pageSlugs.length > 0) {
    const previousAny  = (previous as any) ?? {}
    const prevRewrites = Array.isArray(previousAny.rewrites) ? previousAny.rewrites : []
    const prevSkipped  = Array.isArray(previousAny.skipped)  ? previousAny.skipped  : []
    mergedRewrites = [
      ...prevRewrites.filter((r: any) => !sectionIdsInScope.has(r?.web_section_id)),
      ...rewrites,
    ]
    mergedSkipped = [
      ...prevSkipped.filter((s: any) => !sectionIdsInScope.has(s?.web_section_id)),
      ...skipped,
    ]
  } else {
    mergedRewrites = rewrites
    mergedSkipped  = skipped
  }

  const stage7Write = {
    rewrites: mergedRewrites,
    skipped:  mergedSkipped,
    _meta:    meta,
  }

  const { error: writeErr } = await sb.from('strategy_web_projects')
    .update({
      roadmap_state: { ...(project.roadmap_state ?? {}), stage_7: stage7Write },
    })
    .eq('id', projectId)
  if (writeErr) return res.status(500).json({ error: `DB write failed: ${writeErr.message}` })

  return res.status(200).json({ ok: true, output: stage7Write, usage })
}
