/**
 * Vercel Serverless Function — /api/web/agents/director
 *
 * The Director agent. Two modes:
 *
 * 1. CRITIQUE mode (default)
 *    Reads the project spec + every page draft (or bound sections, if
 *    drafts haven't been produced) and scores each page against:
 *      - voice match (vs. Stage 1 exemplars + anti-exemplars)
 *      - persona fit (vs. brief.persona_focus)
 *      - atom coverage (vs. brief.atoms_assigned)
 *      - slot health (no tics, no truncation, no pass-throughs)
 *    Emits findings + per-page directives:
 *      { page_slug, stage_to_rerun, note, severity }
 *    Findings are written to roadmap_state.director_critique. The
 *    orchestration loop (built in a later step) acts on directives.
 *    For v1, this endpoint produces critique-only — it does NOT
 *    execute directives. Strategist can read them and decide.
 *
 * 2. ROUTE mode
 *    Takes a free-text user_feedback string and the current state and
 *    classifies it into ONE dispatch. Used at the final review gate
 *    when the strategist says "the homepage feels generic" — the
 *    Director decides whether that's a synthesize / page_briefs /
 *    page_draft / single-slot issue.
 *    Returns the dispatch directly. Does not write anywhere.
 *
 * Mode is selected by req.body.mode: 'critique' (default) | 'route'.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { generateText, jsonSchema, tool } from 'ai'
import { resolvePromptServer } from './_lib/resolvePrompt.js'
import { setRoadmapStateAtomic } from './_lib/roadmapStateMerge.js'

export const maxDuration = 300
const MODEL = 'anthropic/claude-opus-4-7'
const MAX_OUTPUT_TOKENS = 12000

const CRITIQUE_TOOL = {
  description: 'Submit cross-page critique + directives for which pages need re-drafting.',
  input_schema: {
    type: 'object',
    required: ['per_page','directives','scores','overall_verdict'],
    properties: {
      per_page: {
        type: 'array',
        description: 'One entry per page with a draft. Pages without drafts get skipped (not emitted here).',
        items: {
          type: 'object',
          required: ['page_slug','dignity','voice_character','persona_fit','source_coverage','claim_plausibility','summary'],
          properties: {
            page_slug:           { type: 'string' },
            dignity:             { type: 'number', description: '0-100. NON-NEGOTIABLE FLOOR AT 70. Treats people with respect — no commodification ("We Send People"), no othering ("the lost"), no pity-bait, no superiority signaling, no gendered defaults. ≤40 = blocker.' },
            voice_character:     { type: 'number', description: '0-100. Reads like a real person from THIS church — concrete details, matches discovery-Q voice samples, NOT swappable with another church name.' },
            persona_fit:         { type: 'number', description: '0-100. Addresses brief.persona_focus.primary by specific need/posture, not generic "we welcome everyone".' },
            source_coverage:       { type: 'number', description: '0-100. Share of brief.atoms_assigned + facts_assigned + crawl_topics_assigned that landed somewhere in a section. Renamed from atom_coverage 2026-06-12 with the three-source contract widening; scale is comparable across the rename. A fact-led section using facts heavily and atoms barely is NOT a coverage failure.' },
            claim_plausibility:  { type: 'number', description: '0-100. Every assertion about the church is backed by atoms / discovery / content-collection. No unsourced numbers, no invented awards, no theological claims that don\'t appear in the church\'s own voice.' },
            standout_lines:      { type: 'array', items: { type: 'string' }, description: 'Up to 3 lines you\'d show the strategist as proof of voice fit + dignity intact.' },
            problem_lines:       { type: 'array', items: { type: 'string' }, description: 'Up to 3 lines that violate one of the five axes. Quote verbatim. Each MUST have a matching directive.' },
            summary:             { type: 'string', description: '2-3 sentences. What this page does well + the single most important thing to fix.' },
          },
        },
      },
      directives: {
        type: 'array',
        description: 'Actions the orchestration loop should take. Order matters — earliest first. Empty array means everything passes; no re-runs needed.',
        items: {
          type: 'object',
          required: ['page_slug','stage_to_rerun','fix_kind','note','severity'],
          properties: {
            page_slug:       { type: 'string', description: 'Which page this directive targets. Use "*" for project-wide directives (synthesize re-run).' },
            // 'page_briefs' was removed in the outlines refactor — the
            // file no longer exists and the orchestrator now routes
            // brief-style fixes through page_draft (full redraft) or
            // single_slot (slot-edit). Leaving page_briefs in this enum
            // caused the Director to emit directives the iterate loop
            // would 404 on when calling the deleted endpoint.
            stage_to_rerun:  { type: 'string', enum: ['synthesize','sitemap','page_draft','single_slot'] },
            fix_kind: {
              type: 'string',
              enum: ['slot_edit','page_redraft','brief_update','sitemap_redraft','synthesize_rework'],
              description: 'How the orchestrator should apply this directive. Pick the LEAST invasive fix that solves the issue — slot_edit beats page_redraft because page_redraft can re-introduce other slots\' issues. Use slot_edit when ONE slot/heading/CTA reads wrong; page_redraft when the page\'s structure or atom usage is wrong; brief_update when the brief itself misdirected the writer; sitemap_redraft when the page shouldn\'t exist OR is the wrong page_type; synthesize_rework when the strategy is wrong.',
            },
            slot_locator: {
              type: ['object','null'],
              description: 'Required when fix_kind=slot_edit. Identifies the single slot to rewrite — section_ix is zero-indexed against page_drafts[slug].sections, slot_key is one of "eyebrow","heading","tagline","description","body","cta", OR for group slots use "cards[N].heading" / "items[N].body" form.',
              properties: {
                section_ix: { type: 'number' },
                slot_key:   { type: 'string' },
              },
            },
            note:            { type: 'string', description: 'Specific feedback to pass to the re-running stage. Concrete, not vague — "Hero heading reads like an ad slogan; use the discovery Q14 phrase instead" beats "make hero better".' },
            severity:        { type: 'string', enum: ['blocker','warning','nit'] },
          },
        },
      },
      cross_page_findings: {
        type: 'array',
        description: 'Issues that span multiple pages (voice drift across pages, persona missed entirely, atom orphaned site-wide).',
        items: {
          type: 'object',
          required: ['kind','description'],
          properties: {
            kind:        { type: 'string', enum: ['voice_drift','persona_gap','atom_orphan','nav_parity','duplicate_message'] },
            description: { type: 'string' },
            pages:       { type: 'array', items: { type: 'string' } },
          },
        },
      },
      scores: {
        type: 'object',
        required: ['dignity','voice_character','persona_fit','source_coverage','claim_plausibility','overall'],
        properties: {
          dignity:             { type: 'number', description: 'Cross-page minimum, not average. If ANY page scored ≤40 on dignity, this score must reflect that.' },
          voice_character:     { type: 'number', description: 'Cross-page voice consistency + distinctiveness from generic church copy.' },
          persona_fit:         { type: 'number', description: 'Cross-page persona coverage — does each defined persona have at least one page that serves them?' },
          source_coverage:     { type: 'number', description: 'Site-wide landing rate across all three source kinds (atoms + facts + crawl topics).' },
          claim_plausibility:  { type: 'number', description: 'Cross-page count of unsupported assertions.' },
          overall:             { type: 'number', description: 'Weighted: dignity * 0.30 + voice_character * 0.25 + persona_fit * 0.20 + source_coverage * 0.15 + claim_plausibility * 0.10. If dignity is ≤40, overall is also ≤40 (floor).' },
        },
      },
      overall_verdict: {
        type: 'string',
        enum: ['approved','needs_revision','needs_strategy_rework'],
        description: 'approved = ship as-is. needs_revision = re-run page_draft on flagged pages and re-critique. needs_strategy_rework = the spec itself is the problem; escalate to synthesize.',
      },
    },
  },
}

const ROUTE_TOOL = {
  description: 'Classify strategist feedback into ONE dispatch.',
  input_schema: {
    type: 'object',
    required: ['dispatch','rationale'],
    properties: {
      dispatch: {
        type: 'object',
        required: ['stage_to_rerun','note'],
        properties: {
          stage_to_rerun: { type: 'string', enum: ['synthesize','sitemap','page_draft','single_slot','none'] },
          page_slug:      { type: ['string','null'], description: 'When stage_to_rerun is page_draft or single_slot.' },
          section_ix:     { type: ['number','null'], description: 'When stage_to_rerun is single_slot.' },
          slot_key:       { type: ['string','null'], description: 'When stage_to_rerun is single_slot — e.g. "heading", "description".' },
          note:           { type: 'string', description: 'Concrete instruction to pass to the re-running stage. Translate the strategist\'s feedback into an actionable prompt.' },
        },
      },
      rationale: { type: 'string', description: 'One sentence on why this is the right dispatch.' },
      alternative_dispatches: {
        type: 'array',
        description: 'Up to 2 other dispatches you considered but rejected. Helps the strategist see the reasoning if your primary call is wrong.',
        items: {
          type: 'object',
          properties: {
            stage_to_rerun: { type: 'string' },
            why_rejected:   { type: 'string' },
          },
        },
      },
    },
  },
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const anonKey        = process.env.VITE_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const gatewayKey     = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !gatewayKey) {
    return res.status(500).json({ error: 'Missing env vars' })
  }

  const jwt = (req.headers['authorization'] as string | undefined)?.replace(/^Bearer /, '') ?? null
  if (!jwt) return res.status(401).json({ error: 'Missing Authorization bearer token' })
  const { data: userData, error: userErr } = await createClient(supabaseUrl, anonKey).auth.getUser(jwt)
  if (userErr || !userData?.user) return res.status(401).json({ error: 'Invalid session' })

  const projectId   = typeof req.body?.projectId === 'string' ? req.body.projectId : null
  const mode        = req.body?.mode === 'route' ? 'route' : 'critique'
  const userFeedback = typeof req.body?.user_feedback === 'string' ? req.body.user_feedback.trim() : ''
  if (!projectId) return res.status(400).json({ error: 'projectId required' })
  if (mode === 'route' && !userFeedback) {
    return res.status(400).json({ error: 'mode=route requires user_feedback' })
  }

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  const { data: project } = await sb.from('strategy_web_projects')
    .select('*').eq('id', projectId).maybeSingle()
  if (!project) return res.status(404).json({ error: 'Project not found' })

  const roadmapState = (project.roadmap_state ?? {}) as Record<string, any>
  const stage1 = roadmapState.stage_1
  const stage2 = roadmapState.stage_2
  const briefs = roadmapState.page_briefs ?? {}
  const drafts = roadmapState.page_drafts ?? {}

  if (!stage1) return res.status(400).json({ error: 'Synthesize must be complete before director can critique.' })

  const resolved = await resolvePromptServer(sb, 'director', projectId)

  if (mode === 'critique') {
    const briefsByPage = Object.fromEntries(
      Object.entries(briefs).filter(([k]) => k !== '_meta')
    )
    const draftsByPage = Object.fromEntries(
      Object.entries(drafts).filter(([k]) => k !== '_meta')
    )

    const userText = [
      `# Mode: CRITIQUE`,
      ``,
      `# Stage 1 spec (voice exemplars are load-bearing)`,
      JSON.stringify({
        voice_characteristics: stage1.voice_characteristics,
        voice_exemplars:       stage1.voice_exemplars,
        voice_anti_exemplars:  stage1.voice_anti_exemplars,
        personas:              stage1.personas,
        x_factor:              stage1.x_factor,
      }, null, 2),
      ``,
      `# Stage 2 sitemap`,
      JSON.stringify(stage2 ?? null, null, 2),
      ``,
      `# Page briefs (per-page coordination contract)`,
      JSON.stringify(briefsByPage, null, 2),
      ``,
      `# Page drafts (what to critique)`,
      JSON.stringify(draftsByPage, null, 2),
      ``,
      `Critique every page that has a draft. Quote problem lines verbatim. Emit directives only for pages that genuinely need a re-run — don't manufacture work.`,
    ].join('\n')

    let toolResult: Record<string, unknown> | null = null
    let usage: { input_tokens?: number; output_tokens?: number } = {}
    try {
      const result = await generateText({
        model: MODEL,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        system: resolved.systemPrompt,
        messages: [{ role: 'user', content: userText }],
        tools: {
          submit_director_critique: tool({
            description: CRITIQUE_TOOL.description,
            inputSchema: jsonSchema(CRITIQUE_TOOL.input_schema as any),
          }),
        },
        toolChoice: { type: 'tool', toolName: 'submit_director_critique' },
      })
      usage = { input_tokens: result.usage?.inputTokens, output_tokens: result.usage?.outputTokens }
      const toolCall = result.toolCalls?.[0]
      if (!toolCall || toolCall.toolName !== 'submit_director_critique') {
        throw new Error('Model did not return the expected tool call')
      }
      toolResult = toolCall.input as Record<string, unknown>
    } catch (err: any) {
      console.error('[director] critique error:', err?.message)
      return res.status(502).json({ error: `AI Gateway error: ${err?.message ?? 'unknown'}` })
    }

    const meta = {
      generated_at: new Date().toISOString(),
      mode: 'critique',
      model: MODEL,
      prompt_source: resolved.globalSource,
      has_project_addendum: resolved.hasProjectAddendum,
      pages_critiqued: Object.keys(draftsByPage).length,
      usage,
    }

    try {
      await setRoadmapStateAtomic(sb, projectId, ['director_critique'], { ...toolResult, _meta: meta })
    } catch (e: any) {
      return res.status(500).json({ error: `DB write failed: ${e?.message ?? 'unknown'}` })
    }

    return res.status(200).json({ ok: true, critique: toolResult, usage })
  }

  // ── ROUTE mode ───────────────────────────────────────────────────────
  const userText = [
    `# Mode: ROUTE`,
    ``,
    `# Strategist feedback (free text from the final review gate)`,
    userFeedback,
    ``,
    `# Stage 1 spec`,
    JSON.stringify({
      voice_characteristics: stage1.voice_characteristics,
      voice_exemplars:       stage1.voice_exemplars,
      voice_anti_exemplars:  stage1.voice_anti_exemplars,
      personas:              stage1.personas,
    }, null, 2),
    ``,
    `# Sitemap (slugs available for routing)`,
    JSON.stringify(stage2?.pages ?? [], null, 2),
    ``,
    `# Current page drafts (the surface the strategist is reacting to)`,
    JSON.stringify(drafts, null, 2),
    ``,
    `Classify this feedback into exactly ONE dispatch. Pick the most specific stage that resolves it — don't escalate to synthesize when a single page_draft would do.`,
  ].join('\n')

  let toolResult: Record<string, unknown> | null = null
  let usage: { input_tokens?: number; output_tokens?: number } = {}
  try {
    const result = await generateText({
      model: MODEL,
      maxOutputTokens: 4000,
      system: resolved.systemPrompt,
      messages: [{ role: 'user', content: userText }],
      tools: {
        submit_director_route: tool({
          description: ROUTE_TOOL.description,
          inputSchema: jsonSchema(ROUTE_TOOL.input_schema as any),
        }),
      },
      toolChoice: { type: 'tool', toolName: 'submit_director_route' },
    })
    usage = { input_tokens: result.usage?.inputTokens, output_tokens: result.usage?.outputTokens }
    const toolCall = result.toolCalls?.[0]
    if (!toolCall || toolCall.toolName !== 'submit_director_route') {
      throw new Error('Model did not return the expected tool call')
    }
    toolResult = toolCall.input as Record<string, unknown>
  } catch (err: any) {
    console.error('[director] route error:', err?.message)
    return res.status(502).json({ error: `AI Gateway error: ${err?.message ?? 'unknown'}` })
  }

  return res.status(200).json({ ok: true, route: toolResult, usage })
}
