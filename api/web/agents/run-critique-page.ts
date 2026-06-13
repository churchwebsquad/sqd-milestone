/**
 * Vercel Serverless Function — /api/web/agents/run-critique-page
 *
 * Cowork worker endpoint: critique ONE drafted page.
 *
 *   POST { project_id, page_slug }
 *
 * Third copy of the canonical pattern (outline → draft → critique).
 * Reads the persisted draft from roadmap_state.page_drafts[<slug>] +
 * the outline + stage_1 brief + atoms-for-page, fires Opus 4.7 with
 * the critique-page SKILL, validates locally, repairs once if needed,
 * writes through the importer's trust boundary.
 *
 * Critique-page is the QUALITY GATE — it produces 5-axis scores +
 * directives + standout/problem lines. The validator only checks
 * STRUCTURE (closed enums, score ranges, axis-directive consistency);
 * the model's JUDGMENT is what the strategist reviews. This is by
 * design — there's no automated way to confirm "good critique," only
 * "well-structured critique."
 *
 * No atom_id schema-enum on this endpoint: critique-page doesn't emit
 * atom UUIDs (it cites standout/problem LINES, free-form strings).
 * The source_coverage axis is the model's judgment, not a UUID list.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'

import { callGateway, type ToolSchema } from '../../srp/_lib/aiGateway.js'
import { resolveCoworkSkill } from './_lib/resolveCoworkSkill.js'
import { BUNDLE_VERSION } from '../../../src/types/coworkBundle.js'
import {
  validateCritiquePage,
  type CritiquePageValidationManifest,
  type CritiquePageValidationResult,
} from '../../../src/lib/cowork/validateCritiquePage.js'
import { compactCrawlTopics } from '../../../src/lib/cowork/compactCrawlTopic.js'

export const maxDuration = 300

const TOOL_NAME = 'emit_page_critique'
const TOOL_DESCRIPTION =
  'Emit the per-page critique conforming to the CoworkPageCritique contract — 5-axis scores ' +
  '(dignity, voice_character, persona_fit, source_coverage, claim_plausibility), standout_lines + ' +
  'problem_lines (verbatim quotes from the draft), directives (with fix_kind + severity + axis), ' +
  'and a strategist-facing summary.'

const TOOL_SCHEMA: ToolSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['page_slug', 'dignity', 'voice_character', 'persona_fit', 'source_coverage',
             'claim_plausibility', 'standout_lines', 'problem_lines', 'directives', 'summary'],
  properties: {
    page_slug:          { type: 'string' },
    dignity:            { type: 'integer', minimum: 0, maximum: 100 },
    voice_character:    { type: 'integer', minimum: 0, maximum: 100 },
    persona_fit:        { type: 'integer', minimum: 0, maximum: 100 },
    source_coverage:      { type: 'integer', minimum: 0, maximum: 100 },
    claim_plausibility: { type: 'integer', minimum: 0, maximum: 100 },
    standout_lines: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 400 },
    },
    problem_lines: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 400 },
    },
    directives: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['fix_kind', 'page_slug', 'note', 'severity', 'axis'],
        properties: {
          fix_kind:   { type: 'string', enum: ['slot_edit', 'page_redraft', 'sitemap_redraft', 'synthesize_rework'] },
          page_slug:  { type: 'string' },
          section_ix: { type: 'integer', minimum: 0 },
          slot_key:   { type: 'string' },
          note:       { type: 'string', minLength: 10, maxLength: 600 },
          severity:   { type: 'string', enum: ['blocker', 'warning', 'nit'] },
          axis:       { type: 'string', enum: ['dignity', 'voice_character', 'persona_fit', 'source_coverage', 'claim_plausibility'] },
        },
      },
    },
    summary: { type: 'string', minLength: 40, maxLength: 1200 },
  },
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return res.status(500).json({ error: 'Missing Supabase env vars' })

  const projectId = typeof req.body?.project_id === 'string' ? req.body.project_id : null
  const pageSlug  = typeof req.body?.page_slug  === 'string' ? req.body.page_slug  : null
  if (!projectId) return res.status(400).json({ error: 'project_id required' })
  if (!pageSlug)  return res.status(400).json({ error: 'page_slug required' })

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  // 1. Load draft + outline + stage_1 + atoms-for-page.
  let inputs: AssembledInputs
  try {
    inputs = await assembleEndpointInputs(sb, projectId, pageSlug)
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'input assembly failed' })
  }
  if (!inputs.draft) {
    return res.status(404).json({
      error: 'draft_not_found',
      detail: `roadmap_state.page_drafts.${pageSlug} not found. Run /api/web/agents/run-draft-page first.`,
    })
  }

  // 2. Resolve prompt.
  let resolved: Awaited<ReturnType<typeof resolveCoworkSkill>>
  try {
    resolved = await resolveCoworkSkill(sb, 'critique-page', projectId)
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'prompt resolve failed' })
  }

  // 3. Call gateway → validate locally → repair-on-422 → re-validate.
  const localManifest: CritiquePageValidationManifest = { expected_page_slug: pageSlug }
  const baseUserMessage = buildUserMessage(pageSlug, inputs)
  let gatewayResult: Awaited<ReturnType<typeof callGateway>>
  let firstPass: CritiquePageValidationResult | null = null
  let repaired = false
  let initialPassOutputTokens = 0
  let repairPassOutputTokens  = 0

  try {
    gatewayResult = await callGateway({
      model:           resolved.model,
      system:          resolved.systemPrompt,
      user:            baseUserMessage,
      toolName:        TOOL_NAME,
      toolDescription: TOOL_DESCRIPTION,
      toolSchema:      TOOL_SCHEMA,
      // Critique output is bounded — 5 axes + ~5-10 lines + ~5-10
      // directives + summary. 4k is enough headroom; 8k as safety.
      maxTokens:       8000,
    })
  } catch (e) {
    return mapGatewayError(res, e)
  }
  initialPassOutputTokens = gatewayResult.usage.outputTokens

  let validation = validateCritiquePage(gatewayResult.args as any, localManifest)
  if (!validation.ok) {
    firstPass = validation
    const repairMessage = [
      baseUserMessage,
      ``,
      `## Validation feedback — repair this critique`,
      ``,
      `Your critique did not pass deterministic validation. Fix the`,
      `named gaps and emit a corrected critique via the same`,
      `\`${TOOL_NAME}\` tool call.`,
      ``,
      '```',
      validation.summary,
      '```',
      ``,
      'Failures by check:',
      '```json',
      JSON.stringify(validation.byCheck, null, 2),
      '```',
    ].join('\n')

    let repairResult: Awaited<ReturnType<typeof callGateway>>
    try {
      repairResult = await callGateway({
        model:           resolved.model,
        system:          resolved.systemPrompt,
        user:            repairMessage,
        toolName:        TOOL_NAME,
        toolDescription: TOOL_DESCRIPTION,
        toolSchema:      TOOL_SCHEMA,
        maxTokens:       8000,
      })
    } catch (e) {
      return mapGatewayError(res, e)
    }
    repaired = true
    repairPassOutputTokens = repairResult.usage.outputTokens
    gatewayResult = {
      args:   repairResult.args,
      model:  repairResult.model,
      usage: {
        inputTokens:  gatewayResult.usage.inputTokens  + repairResult.usage.inputTokens,
        outputTokens: gatewayResult.usage.outputTokens + repairResult.usage.outputTokens,
      },
    }
    validation = validateCritiquePage(repairResult.args as any, localManifest)
  }

  // 4. Stamp _meta.
  const now = new Date().toISOString()
  const critiqueWithMeta = {
    ...gatewayResult.args,
    _meta: {
      bundle_version: BUNDLE_VERSION,
      skill_name:     'critique-page',
      skill_version:  resolved.skillVersion,
      generated_at:   now,
      model:          gatewayResult.model,
      prompt_hash:    resolved.promptHash,
      usage: {
        input_tokens:               gatewayResult.usage.inputTokens,
        output_tokens:              gatewayResult.usage.outputTokens,
        initial_pass_output_tokens: initialPassOutputTokens,
        repair_pass_output_tokens:  repaired ? repairPassOutputTokens : null,
      },
      repaired,
      first_pass_failures: firstPass
        ? {
            count:    firstPass.failures.length,
            by_check: Object.fromEntries(Object.entries(firstPass.byCheck).map(([k, v]) => [k, v.length])),
          }
        : null,
    },
  }

  if (!validation.ok) {
    return res.status(422).json({
      stage:        'local_validate',
      error:        'validation_failed_after_repair',
      summary:      validation.summary,
      byCheck:      validation.byCheck,
      failures:     validation.failures,
      first_pass_failures: firstPass ? {
        count:    firstPass.failures.length,
        by_check: Object.fromEntries(Object.entries(firstPass.byCheck).map(([k, v]) => [k, v.length])),
      } : null,
      critique_for_inspection: critiqueWithMeta,
    })
  }

  // 5. POST to importer for trust-boundary revalidation + atomic write.
  const importerUrl = inferImporterUrl(req)
  const importerRes = await fetch(importerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project_id:  projectId,
      bundle_kind: 'page_critique',
      page_slug:   pageSlug,
      bundle:      critiqueWithMeta,
    }),
  })
  const importerJson = await importerRes.json().catch(() => ({}))

  if (!importerRes.ok) {
    return res.status(importerRes.status).json({
      stage:        'import',
      error:        importerJson?.error ?? 'import_failed',
      summary:      importerJson?.summary,
      byCheck:      importerJson?.byCheck,
      failures:     importerJson?.failures,
      critique_for_inspection: critiqueWithMeta,
    })
  }

  return res.status(200).json({
    ok:           true,
    page_slug:    pageSlug,
    critique:     critiqueWithMeta,
    skill_meta:   critiqueWithMeta._meta,
    importer:     importerJson,
    prompt_resolution: {
      global_source:        resolved.globalSource,
      has_project_addendum: resolved.hasProjectAddendum,
    },
    validation_manifest: localManifest,
  })
}

function mapGatewayError(res: any, e: unknown) {
  const name = (e as Error)?.name ?? 'Error'
  const message = e instanceof Error ? e.message : 'gateway call failed'
  if (name === 'GatewayRateLimitError') return res.status(429).json({ error: 'gateway_rate_limited', detail: message })
  if (name === 'GatewayTransientError') return res.status(502).json({ error: 'gateway_transient',     detail: message })
  return res.status(500).json({ error: 'gateway_failure', detail: message })
}

// ──────────────────────────────────────────────────────────────────────────

interface AssembledInputs {
  draft:          any           // CoworkPageDraft (the artifact being critiqued)
  outline:        any           // outline the draft was built from (atom expectations, archetypes)
  stage1Brief:    any           // voice exemplars, anti-exemplars, ethos, personas
  atomsForPage:   Array<{ id: string; topic: string; body: string; verbatim: boolean }>
  factsForPage:   Array<{ id: string; topic: string; data: Record<string, unknown> }>
  crawlTopicsForPage: Array<Record<string, unknown>>
}

async function assembleEndpointInputs(
  sb:        any,
  projectId: string,
  pageSlug:  string,
): Promise<AssembledInputs> {
  const { data: project, error } = await sb
    .from('strategy_web_projects')
    .select('roadmap_state')
    .eq('id', projectId)
    .maybeSingle()
  if (error) throw new Error(`project load failed: ${error.message}`)

  const roadmap = (project?.roadmap_state ?? {}) as Record<string, any>
  const draft   = roadmap?.page_drafts?.[pageSlug] ?? null
  const outline = roadmap?.page_outlines?.[pageSlug] ?? null
  const stage_1 = roadmap?.stage_1 ?? null

  // Collect all three source-kind ids the outline assigned. Same set
  // the draft saw. Lets critique evaluate source_coverage honestly
  // across atoms + facts + crawl topics — 2026-06-12 widening: the
  // axis renamed from atom_coverage but the assessment now spans all
  // three kinds.
  const atomIds        = new Set<string>()
  const factIds        = new Set<string>()
  const crawlTopicKeys = new Set<string>()
  if (outline?.sections) {
    for (const s of outline.sections) {
      for (const a of (s?.atom_assignments ?? [])) {
        if (a?.atom_id) atomIds.add(String(a.atom_id))
      }
      for (const f of (s?.fact_assignments ?? [])) {
        if (f?.fact_id) factIds.add(String(f.fact_id))
      }
      for (const c of (s?.crawl_topic_assignments ?? [])) {
        if (c?.topic_key) crawlTopicKeys.add(String(c.topic_key))
      }
    }
  }

  const [atomsRes, factsRes, topicsRes] = await Promise.all([
    atomIds.size > 0
      ? sb.from('content_atoms')
          .select('id, topic, body, verbatim')
          .in('id', Array.from(atomIds))
      : Promise.resolve({ data: [] as any[], error: null }),
    factIds.size > 0
      ? sb.from('church_facts')
          .select('id, topic, data')
          .in('id', Array.from(factIds))
      : Promise.resolve({ data: [] as any[], error: null }),
    crawlTopicKeys.size > 0
      ? sb.from('web_project_topics')
          .select('topic_key, topic_label, topic_group, coverage_status, passages, items')
          .eq('web_project_id', projectId)
          .in('topic_key', Array.from(crawlTopicKeys))
      : Promise.resolve({ data: [] as any[], error: null }),
  ])
  if (atomsRes.error)  throw new Error(`content_atoms load failed: ${atomsRes.error.message}`)
  if (factsRes.error)  throw new Error(`church_facts load failed: ${factsRes.error.message}`)
  if (topicsRes.error) throw new Error(`web_project_topics load failed: ${topicsRes.error.message}`)

  const stage1Brief = stage_1 ? {
    ethos_summary:        stage_1.ethos_summary,
    personas:             stage_1.personas,
    voice_exemplars:      stage_1.voice_exemplars,
    voice_anti_exemplars: stage_1.voice_anti_exemplars,
    persuasive_posture_by_persona: stage_1.persuasive_posture_by_persona,
  } : null

  return {
    draft,
    outline,
    stage1Brief,
    atomsForPage:       (atomsRes.data  ?? []) as AssembledInputs['atomsForPage'],
    factsForPage:       (factsRes.data  ?? []) as AssembledInputs['factsForPage'],
    crawlTopicsForPage: (topicsRes.data ?? []) as AssembledInputs['crawlTopicsForPage'],
  }
}

function buildUserMessage(pageSlug: string, inputs: AssembledInputs): string {
  return [
    `Critique the draft for page \`${pageSlug}\` per the SKILL above.`,
    ``,
    `## The page draft (what you're critiquing)`,
    '```json',
    JSON.stringify(inputs.draft, null, 2),
    '```',
    ``,
    `## The outline (what the draft was rendering against — for source_coverage assessment)`,
    '```json',
    JSON.stringify(inputs.outline, null, 2),
    '```',
    ``,
    `## Stage_1 brief (voice exemplars + anti-exemplars + ethos for voice_character + dignity assessment)`,
    '```json',
    JSON.stringify(inputs.stage1Brief, null, 2),
    '```',
    ``,
    `## Atoms available to the drafter (for source_coverage + claim_plausibility)`,
    '```json',
    JSON.stringify(inputs.atomsForPage, null, 2),
    '```',
    ``,
    `## Deferred atoms — atoms the drafter explicitly chose NOT to use, and why`,
    `(EVERY entry here MUST surface in directives[] at severity ≥ warning. This`,
    `is the visibility cost on the deferral channel — escape hatches without`,
    `visibility become silent drops. For each deferred atom, emit a directive`,
    `whose note names the atom + the reason + a strategist action; axis ='source_coverage'`,
    `or 'claim_plausibility' depending on what was lost.)`,
    '```json',
    JSON.stringify(
      (inputs.draft?.sections ?? []).flatMap((s: any, ix: number) =>
        (s?.deferred_atoms ?? []).map((da: any) => ({ section_ix: ix, ...da }))),
      null, 2,
    ),
    '```',
    ``,
    `## Facts available to the drafter (also counts toward source_coverage; weave into copy via fact_assignments)`,
    '```json',
    JSON.stringify(inputs.factsForPage, null, 2),
    '```',
    ``,
    `## Crawl topics available to the drafter (also counts toward source_coverage; excerpt/rewrite/paraphrase via crawl_topic_assignments. Each topic carries a sample + total + truncation booleans — when judging coverage, treat truncated topics as "partial inventory visible," not "this is everything.")`,
    '```json',
    JSON.stringify(compactCrawlTopics(inputs.crawlTopicsForPage), null, 2),
    '```',
    ``,
    `Score each of the 5 axes (dignity, voice_character, persona_fit,`,
    `source_coverage, claim_plausibility) on a 0-100 scale.`,
    `**source_coverage is the share of ALL THREE source kinds (atoms +`,
    `facts + crawl topics) the outline routed to a section that the`,
    `draft actually consumed (atoms_used + facts_used + crawl_topics_used).`,
    `A fact-led section using facts heavily and atoms barely is NOT a`,
    `coverage failure — it's a coverage success against a different kind.**`,
    `**dignity ≤ 40 is a blocker** — if you score it that low, you MUST`,
    `emit a directive with severity='blocker' axis='dignity'.`,
    `**Any axis ≤ 40** requires at least one directive citing that axis.`,
    ``,
    `standout_lines and problem_lines are VERBATIM quotes from the draft`,
    `copy. Lift them character-for-character; do not paraphrase.`,
    ``,
    `directives carry: fix_kind (slot_edit / page_redraft /`,
    `sitemap_redraft / synthesize_rework), the page_slug being critiqued,`,
    `optional section_ix + slot_key for surgical fixes, a CONCRETE note`,
    `the re-runner can act on, severity, and axis.`,
    ``,
    `Now call \`${TOOL_NAME}\`.`,
  ].join('\n')
}

function inferImporterUrl(req: any): string {
  const proto = req.headers['x-forwarded-proto'] ?? 'https'
  const host  = req.headers['x-forwarded-host'] ?? req.headers.host
  return `${proto}://${host}/api/web/agents/import-cowork-bundle`
}
