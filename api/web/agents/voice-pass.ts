/**
 * Vercel Serverless Function — /api/web/agents/voice-pass
 *
 * Stage 7 of the copywriting pipeline. Element-by-element brand-voice
 * rewrite of every text + richtext slot across every section. Single
 * model call (Opus) processes the full batch and returns rewrites +
 * skips; that's cheaper + more coherent than per-slot calls until
 * cost demands otherwise.
 *
 * Writes:
 *  • roadmap_state.stage_7 — the rewrite manifest
 *  • web_sections.field_values — applied rewrites (skipping anything
 *    flagged field_provenance='override')
 *  • web_sections.field_provenance — marks rewritten fields as 'voice_pass'
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { generateText, jsonSchema, tool } from 'ai'
import { resolvePromptServer } from './_lib/resolvePrompt'

export const maxDuration = 600  // big batch
const MODEL = 'anthropic/claude-opus-4-7'
const MAX_OUTPUT_TOKENS = 16000

const TOOL = {
  description: 'Submit voice-pass rewrites + skips.',
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
            reason:         { type: 'string',
              enum: ['already_on_voice','override_locked','over_budget_after_rewrite'] },
          },
          required: ['web_section_id','field_key','reason'],
        },
      },
    },
    required: ['rewrites','skipped'],
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
  /** When true, apply rewrites to web_sections.field_values in addition
   *  to writing the manifest. Strategist sets this on a second click
   *  after reviewing the manifest. */
  const apply = req.body?.apply === true
  /** Optional scope: when present, the agent only generates (or
   *  applies) rewrites for sections that belong to these page slugs.
   *  Iterative testing surface — pair with page-outlines' pageSlugs to
   *  rerun a single page through the contract → voice flow without
   *  touching the rest of the project. */
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
  // Apply page-slug scope here so every downstream lookup is naturally
  // narrowed to the targeted pages.
  const scopedPages = pageSlugs && pageSlugs.length > 0
    ? (pages ?? []).filter(p => pageSlugs.includes(p.slug as string))
    : (pages ?? [])
  const pageIds = scopedPages.map(p => p.id as string)
  const { data: sections } = await sb.from('web_sections')
    .select('id, web_page_id, content_template_id, field_values, field_provenance, sort_order')
    .eq('archived', false)
  const ourSections = (sections ?? []).filter(s => pageIds.includes(s.web_page_id as string))

  // Apply mode: write the previous run's rewrites back to web_sections.
  // Honors strategist annotations from the preview drawer:
  //   • r.omitted === true  → skip; the original copy survives.
  //   • r.user_value (non-empty string) → write that string instead
  //     of r.new_value (the strategist hand-edited this row).
  // Skips fields where field_provenance='override' to respect human edits.
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
      // Strategist-edited rows carry source='strategist_voice_pass' so
      // the round-trip is auditable. Pure model rewrites stay 'voice_pass'.
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

  const previous = redoContext ? roadmapState.stage_7 : undefined
  const resolved = await resolvePromptServer(sb, 'voice_pass', projectId)

  // Pull Stage 4 section contracts so the model can honor required_messages,
  // keyword_assignments, and cta.label per section. Without these, the
  // voice pass has no way to know which words it must preserve, and
  // ends up paraphrasing away load-bearing content + keywords. We thin
  // the payload to the load-bearing fields — the full content_summary
  // lives in Stage 4 but the binder already used it; voice pass only
  // needs the contract guards.
  const stage4 = roadmapState.stage_4 as { page_outlines?: any[] } | undefined
  const sectionContracts: Array<{
    page_slug:           string
    section_id:          string
    required_messages:   string[]
    keyword_assignments: { primary?: string[]; supporting?: string[] } | null
    cta:                 { label: string; destination_page: string } | null
  }> = []
  if (stage4?.page_outlines) {
    for (const page of stage4.page_outlines) {
      // Honor the scope filter — drop contracts for pages we're not
      // touching so the model isn't distracted by them.
      if (pageSlugs && pageSlugs.length > 0 && !pageSlugs.includes(page.page_slug)) continue
      for (const sec of (page.sections ?? [])) {
        sectionContracts.push({
          page_slug:           page.page_slug,
          section_id:          sec.section_id,
          required_messages:   Array.isArray(sec.required_messages) ? sec.required_messages : [],
          keyword_assignments: sec.keyword_assignments ?? null,
          cta:                 sec.cta ? { label: sec.cta.label, destination_page: sec.cta.destination_page } : null,
        })
      }
    }
  }

  const userText = [
    `# Voice card (Stage 1)\n${JSON.stringify((stage1 as any).voice_characteristics, null, 2)}`,
    `# Personas (Stage 1)\n${JSON.stringify((stage1 as any).personas, null, 2)}`,
    brandGuide && `# Brand guide\n${JSON.stringify(brandGuide, null, 2)}`,
    sectionContracts.length > 0 &&
      `# Stage 4 section contracts — load-bearing constraints\n` +
      `For each section_id, required_messages must survive any rewrite, keyword_assignments.primary phrases must stay in heading or lead sentence, and cta.label must not change. The section_id here matches web_section_id in the Sections payload below.\n` +
      JSON.stringify(sectionContracts, null, 2),
    `# Sections (current field_values + provenance)\n${JSON.stringify(ourSections, null, 2)}`,
    previous && `# Previous run\n${JSON.stringify(previous, null, 2)}`,
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
        submit_voice_rewrites: tool({
          description: TOOL.description,
          inputSchema: jsonSchema(TOOL.input_schema as any),
        }),
      },
      toolChoice: { type: 'tool', toolName: 'submit_voice_rewrites' },
    })
    usage = { input_tokens: result.usage?.inputTokens, output_tokens: result.usage?.outputTokens }
    const toolCall = result.toolCalls?.[0]
    if (!toolCall || toolCall.toolName !== 'submit_voice_rewrites') {
      throw new Error('Model did not return the expected tool call')
    }
    toolResult = toolCall.input as Record<string, unknown>
  } catch (err: any) {
    console.error('[voice-pass] gateway error:', err?.message)
    return res.status(502).json({ error: `AI Gateway error: ${err?.message ?? 'unknown'}` })
  }

  const meta = {
    status: 'draft',
    generated_at: new Date().toISOString(),
    model: MODEL,
    prompt_source: resolved.globalSource,
    has_project_addendum: resolved.hasProjectAddendum,
    scoped_to_page_slugs: pageSlugs ?? null,
    redo_count: typeof (previous as any)?._meta?.redo_count === 'number'
      ? (previous as any)._meta.redo_count + (redoContext ? 1 : 0)
      : 0,
    usage,
  }

  // Merge mode when scoped: keep rewrites + skips from other pages,
  // replace only those targeting sections on the scoped pages. The
  // scoped sectionId set determines what's "in scope" — anything
  // matching gets replaced; anything else survives untouched.
  const sectionIdsInScope = new Set(ourSections.map(s => s.id as string))
  let mergedRewrites: any[]
  let mergedSkipped:  any[]
  if (pageSlugs && pageSlugs.length > 0) {
    const previousAny  = (previous as any) ?? {}
    const prevRewrites = Array.isArray(previousAny.rewrites) ? previousAny.rewrites : []
    const prevSkipped  = Array.isArray(previousAny.skipped)  ? previousAny.skipped  : []
    const newRewrites  = Array.isArray((toolResult as any)?.rewrites) ? (toolResult as any).rewrites : []
    const newSkipped   = Array.isArray((toolResult as any)?.skipped)  ? (toolResult as any).skipped  : []
    mergedRewrites = [
      ...prevRewrites.filter((r: any) => !sectionIdsInScope.has(r?.web_section_id)),
      ...newRewrites,
    ]
    mergedSkipped = [
      ...prevSkipped.filter((s: any) => !sectionIdsInScope.has(s?.web_section_id)),
      ...newSkipped,
    ]
  } else {
    mergedRewrites = Array.isArray((toolResult as any)?.rewrites) ? (toolResult as any).rewrites : []
    mergedSkipped  = Array.isArray((toolResult as any)?.skipped)  ? (toolResult as any).skipped  : []
  }

  const stage7Write = {
    ...toolResult,
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
