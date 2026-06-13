/**
 * Vercel Serverless Function — /api/web/agents/run-draft-page
 *
 * Cowork worker endpoint: draft ONE page from its outline.
 *
 *   POST { project_id, page_slug }
 *
 * Inherits the canonical pattern proven by run-outline-page (commit
 * f0241f1 — first persisted end-to-end run). Same six layers, machine-
 * checked: resolver → hash → repair → validate → import → walk.
 *
 * The difference from run-outline-page:
 *   - Model is anthropic/claude-fable-5 (per draft-page SKILL frontmatter
 *     — voice is the lever; Fable 5 is the lever-puller).
 *   - Input is the persisted outline at roadmap_state.page_outlines[<slug>]
 *     plus atom bodies (full, not previews) for atoms the outline assigned.
 *   - Output is CoworkPageDraft: archetype + voice_notes + copy slot map
 *     + atoms_used per section, plus a validation block + a rich _meta
 *     (used_outline, sections_match, atom_resolution_rate, dash_strip).
 *   - Validator does max_chars checks, verbatim-preservation (atom body
 *     MUST appear as substring in the section copy), em-dash floor.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createClient } from '@supabase/supabase-js'

import { callGateway, type ToolSchema } from '../../srp/_lib/aiGateway.js'
import { resolveCoworkSkill } from './_lib/resolveCoworkSkill.js'
import { BUNDLE_VERSION } from '../../../src/types/coworkBundle.js'
import {
  validateDraftPage,
  type DraftPageValidationManifest,
  type DraftPageValidationResult,
} from '../../../src/lib/cowork/validateDraftPage.js'
import type { CanonicalTemplateManifest } from '../../../src/lib/cowork/validatePageOutline.js'

export const maxDuration = 300

const TOOL_NAME = 'emit_page_draft'
const TOOL_DESCRIPTION =
  'Emit the page draft conforming to the CoworkPageDraft contract — one section per outline section, ' +
  'each carrying the archetype + voice_notes + copy slot map + atoms_used.'

/**
 * Build the JSON Schema for the forced tool call.
 *
 * Two enum-constraints, both built per-request from the outline:
 *
 *   1. atoms_used[] items are enum-constrained to the literal
 *      atom_ids the outline assigned to this page. Closes
 *      unknown_atom_ref at the gateway layer.
 *   2. copy keys are constrained via propertyNames.enum to the UNION
 *      of slot names across all archetypes the outline picked.
 *      Closes the majority of unknown_slot_in_copy first-pass
 *      failures (Fable 5's first fire tripped 5 on invented slot
 *      names; this prevents the gateway from accepting any slot
 *      name not declared on at least one referenced archetype).
 *      Per-archetype-precision is still the validator's job: a slot
 *      name valid for archetype A but used in a section bound to
 *      archetype B will pass the gateway and trip the validator's
 *      unknown_slot_in_copy check (defense in depth).
 *
 * "Same trick as the atom enum" per 2026-06-12 amendment: the
 * endpoint already holds the outline, build the enum per-request.
 *
 * Build both enums from the SAME projections the user message reads,
 * so the schema + prompt cannot disagree about scope.
 */
function buildToolSchema(
  atomIdsInScope:        string[],
  factIdsInScope:        string[],
  crawlKeysInScope:      string[],
  allowedSlotNames:      string[],
): ToolSchema {
  const idSchemaFor = (refs: string[]): Record<string, unknown> =>
    refs.length > 0 ? { type: 'string', enum: refs } : { type: 'string' }

  const atomIdSchema  = idSchemaFor(atomIdsInScope)
  const factIdSchema  = idSchemaFor(factIdsInScope)
  const crawlKeySchema = idSchemaFor(crawlKeysInScope)

  // Constrain copy's KEY names via propertyNames; values stay flexible
  // (additionalProperties: true). Drafter still picks values; the
  // model just can't invent slot names beyond the outline's archetype
  // union.
  const copySchema: Record<string, unknown> = {
    type: 'object',
    additionalProperties: true,
  }
  if (allowedSlotNames.length > 0) {
    copySchema.propertyNames = { enum: allowedSlotNames }
  }
  return {
    type: 'object',
    additionalProperties: false,
    required: ['page_slug', 'sections', 'deviation_note', 'validation'],
    properties: {
      page_slug: { type: 'string' },
      sections: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['archetype', 'voice_notes', 'copy',
                     'atoms_used', 'facts_used', 'crawl_topics_used'],
          properties: {
            archetype:   { type: 'string' },
            // voice_notes is critique-page's per-section receipt of
            // which exemplar/rule the drafter imitated. Bounded to 240
            // chars to keep token spend on the copy itself, not on
            // narrating the writing decisions. Surfaced 2026-06-12 —
            // first Fable 5 fire's voice_notes were ~40% of total
            // output_tokens (the truncation source). 240 leaves room
            // to cite an exemplar phrase + name an atom_id + one
            // sentence of reasoning.
            voice_notes: { type: 'string', maxLength: 240 },
            copy:        copySchema,
            atoms_used:  { type: 'array', items: atomIdSchema },
            // Parallel to atoms_used. The outline's fact_assignments
            // direct the drafter to weave fact rows into copy; the
            // drafter tracks which facts it consumed here so the
            // critique-page can grade coverage and so the strategist's
            // audit trail traces what each section pulled from.
            facts_used:        { type: 'array', items: factIdSchema },
            crawl_topics_used: { type: 'array', items: crawlKeySchema },
          },
        },
      },
      deviation_note: { type: ['string', 'null'] },
      validation: {
        type: 'object',
        additionalProperties: false,
        required: ['flags', 'unused_atoms'],
        properties: {
          flags:        { type: 'array', items: { type: 'string' } },
          unused_atoms: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  }
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

  // 1. Load project state in parallel.
  let inputs: AssembledInputs
  try {
    inputs = await assembleEndpointInputs(sb, projectId, pageSlug)
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'input assembly failed' })
  }
  if (!inputs.outline) {
    return res.status(404).json({
      error: 'outline_not_found',
      detail: `roadmap_state.page_outlines.${pageSlug} not found. Run /api/web/agents/run-outline-page first.`,
    })
  }

  // 2. Build validation manifest (used twice: local pre-validate + repair loop).
  let localManifest: DraftPageValidationManifest
  try {
    localManifest = await buildLocalValidationManifest(sb, projectId, pageSlug)
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'manifest build failed' })
  }

  // 3. Resolve prompt (default + DB override + project addendum).
  let resolved: Awaited<ReturnType<typeof resolveCoworkSkill>>
  try {
    resolved = await resolveCoworkSkill(sb, 'draft-page', projectId)
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'prompt resolve failed' })
  }

  // Build the tool schema per-request — atoms_used items are
  // enum-constrained to the literal atom_ids from inputs.atomsForPage,
  // AND copy keys are constrained (via propertyNames) to the union of
  // slot names across the outline's chosen archetypes. Both enums
  // built from inputs.outline (same source the user message reads).
  // The gateway cannot emit an invalid UUID OR an invented slot name.
  // See buildToolSchema for the three-layer doctrine.
  const allowedSlotNames = collectAllowedSlotNames(inputs.outline, localManifest)
  const toolSchema = buildToolSchema(
    inputs.atomsForPage.map(a => a.id),
    inputs.factsForPage.map(f => f.id),
    inputs.crawlTopicsForPage.map(t => t.topic_key),
    allowedSlotNames,
  )

  // 4. Call gateway → local validate → repair-on-422 → re-validate.
  const baseUserMessage = buildUserMessage(pageSlug, inputs)
  let gatewayResult: Awaited<ReturnType<typeof callGateway>>
  let firstPass: DraftPageValidationResult | null = null
  let repaired = false
  // Track per-call output_tokens so we can detect truncation per-pass
  // rather than via a summed total. Surfaced 2026-06-12: the previous
  // implementation summed initial + repair output_tokens, then
  // checked >= 15500 against the sum — which fires true even when
  // neither individual call truncated (e.g. two ~8k passes summing to
  // 16k). The per-pass max is the right signal.
  let initialPassOutputTokens = 0
  let repairPassOutputTokens  = 0

  try {
    gatewayResult = await callGateway({
      model:           resolved.model,
      system:          resolved.systemPrompt,
      user:            baseUserMessage,
      toolName:        TOOL_NAME,
      toolDescription: TOOL_DESCRIPTION,
      toolSchema,
      // draft-page output is the densest of the cowork artifacts —
      // every slot of every section. Fable 5 on a page with ~6 sections
      // × ~5 slots can hit the default 1500 ceiling.
      maxTokens:       16000,
    })
  } catch (e) {
    return mapGatewayError(res, e)
  }
  initialPassOutputTokens = gatewayResult.usage.outputTokens

  let validation = validateDraftPage(gatewayResult.args as any, localManifest)
  if (!validation.ok) {
    firstPass = validation
    const repairMessage = [
      baseUserMessage,
      ``,
      `## Validation feedback — repair this draft`,
      ``,
      `The draft you produced did not pass deterministic validation`,
      `against the project inventory + outline + canonical templates.`,
      `Fix ONLY the named gaps; do not regenerate the rest. Emit a`,
      `corrected draft via the same \`${TOOL_NAME}\` tool call.`,
      ``,
      '```',
      validation.summary,
      '```',
      ``,
      'Failures by check (machine-readable):',
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
        toolSchema,
        maxTokens:       16000,
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
    validation = validateDraftPage(repairResult.args as any, localManifest)
  }

  // 5. Stamp _meta — including the rich draft-page telemetry the SKILL
  //    declares + the canonical repair telemetry from the pattern.
  const now = new Date().toISOString()
  const outlineSectionCount = inputs.outline?.sections?.length ?? 0
  const draftedSectionCount = Array.isArray(gatewayResult.args.sections) ? gatewayResult.args.sections.length : 0
  const atomIdsRequested    = new Set<string>()
  if (inputs.outline?.sections) {
    for (const s of inputs.outline.sections) {
      for (const a of (s?.atom_assignments ?? [])) {
        if (a?.atom_id) atomIdsRequested.add(String(a.atom_id))
      }
    }
  }
  const atomIdsResolved = new Set<string>()
  for (const s of (gatewayResult.args.sections ?? []) as Array<any>) {
    for (const aid of (s?.atoms_used ?? [])) {
      if (aid) atomIdsResolved.add(String(aid))
    }
  }

  const outlineWithMeta = {
    ...gatewayResult.args,
    _meta: {
      bundle_version: BUNDLE_VERSION,
      skill_name:     'draft-page',
      skill_version:  resolved.skillVersion,
      generated_at:   now,
      model:          gatewayResult.model,
      prompt_hash:    resolved.promptHash,
      usage: {
        // Combined totals for cost accounting.
        input_tokens:  gatewayResult.usage.inputTokens,
        output_tokens: gatewayResult.usage.outputTokens,
        // Per-pass output_tokens so truncation_suspected (below) can
        // be computed against the right scope and downstream tooling
        // can distinguish "two small passes" from "one big near-cap
        // pass."
        initial_pass_output_tokens: initialPassOutputTokens,
        repair_pass_output_tokens:  repaired ? repairPassOutputTokens : null,
      },
      used_outline:         true,
      outline_sections:     outlineSectionCount,
      drafted_sections:     draftedSectionCount,
      sections_match:       outlineSectionCount === draftedSectionCount,
      atom_ids_requested:   atomIdsRequested.size,
      atom_ids_resolved:    atomIdsResolved.size,
      atom_resolution_rate: atomIdsRequested.size > 0
        ? Math.round((atomIdsResolved.size / atomIdsRequested.size) * 100) / 100
        : 1.0,
      // Truncation is now per-pass max, not sum. A single call hitting
      // 15500+ tokens (out of 16000 cap) likely truncated; two ~8k
      // passes summing to 16k did not. The previous sum-based check
      // false-fired on the first Fable 5 fire — caught 2026-06-12.
      truncation_suspected: Math.max(initialPassOutputTokens, repairPassOutputTokens) >= 15500,
      // dash_strip is the drafter's own telemetry per SKILL.md. The
      // endpoint doesn't post-process to strip dashes (that's the
      // SKILL's hard rule for the drafter). We initialize empty here;
      // future iteration may post-scan + populate.
      dash_strip:           { count: 0, samples: [] },
      // Canonical repair telemetry (pattern-shared with run-outline-page).
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
      draft_for_inspection: outlineWithMeta,
    })
  }

  // 6. POST to importer for trust-boundary revalidation + atomic write
  //    via the v70 RPC + helper persistence assertion.
  const importerUrl = inferImporterUrl(req)
  const importerRes = await fetch(importerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project_id:  projectId,
      bundle_kind: 'page_draft',
      page_slug:   pageSlug,
      bundle:      outlineWithMeta,
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
      draft_for_inspection: outlineWithMeta,
    })
  }

  return res.status(200).json({
    ok:           true,
    page_slug:    pageSlug,
    draft:        outlineWithMeta,
    skill_meta:   outlineWithMeta._meta,
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
  outline:        any           // the page outline from roadmap_state
  stage1Brief:    any           // voice_exemplars + anti_exemplars + ethos + persona for THIS page
  atomsForPage:   Array<{ id: string; topic: string; body: string; verbatim: boolean }>
  factsForPage:   Array<{ id: string; topic: string; data: Record<string, unknown> }>
  crawlTopicsForPage: Array<{
    topic_key:       string
    topic_label:     string | null
    topic_group:     string | null
    coverage_status: string | null
    passages:        unknown
    items:           unknown
  }>
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
  const outline = roadmap?.page_outlines?.[pageSlug] ?? null
  const stage_1 = roadmap?.stage_1 ?? null

  // Walk all three assignment arrays on the outline's sections to
  // collect referenced ids per kind. Same source-of-truth pattern as
  // run-outline-page: the projections the model receives ARE the
  // projections the schema enums constrain, and ARE the projections
  // the validator checks.
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

  // Compact stage_1 — only fields draft-page reads.
  const stage1Brief = stage_1 ? {
    ethos_summary:        stage_1.ethos_summary,
    personas:             stage_1.personas,
    voice_exemplars:      stage_1.voice_exemplars,
    voice_anti_exemplars: stage_1.voice_anti_exemplars,
    persuasive_posture_by_persona: stage_1.persuasive_posture_by_persona,
  } : null

  return {
    outline,
    stage1Brief,
    atomsForPage:       (atomsRes.data  ?? []) as AssembledInputs['atomsForPage'],
    factsForPage:       (factsRes.data  ?? []) as AssembledInputs['factsForPage'],
    crawlTopicsForPage: (topicsRes.data ?? []) as AssembledInputs['crawlTopicsForPage'],
  }
}

function buildUserMessage(pageSlug: string, inputs: AssembledInputs): string {
  return [
    // ── Strong, leading tool-call instruction ─────────────────────────
    // Fable 5 via Vercel AI Gateway rejects forced tool_choice
    // ("tool_choice forces tool use is not compatible with this
    // model"). Helper uses tool_choice: 'auto' for fable-* models and
    // relies on this prompt-level instruction to force the tool. The
    // tools[] array carries only one tool — `emit_page_draft` — so
    // "use the tool" is unambiguous.
    `**You MUST respond by calling the \`${TOOL_NAME}\` tool with the page draft.**`,
    `Do not respond with prose or text. Do not summarize. Do not ask`,
    `clarifying questions. The only valid response is a tool call with`,
    `the structured page draft. The tools[] array contains exactly one`,
    `tool — call it.`,
    ``,
    `Draft the page with slug \`${pageSlug}\` per the SKILL above.`,
    ``,
    `## Page outline (what to draft against)`,
    '```json',
    JSON.stringify(inputs.outline, null, 2),
    '```',
    ``,
    `## Stage_1 brief (voice + personas + ethos)`,
    '```json',
    JSON.stringify(inputs.stage1Brief, null, 2),
    '```',
    ``,
    `## Atoms allocated by the outline → track in atoms_used`,
    `(full bodies; these are the ONLY ids that may appear in atoms_used)`,
    '```json',
    JSON.stringify(inputs.atomsForPage, null, 2),
    '```',
    ``,
    `## Facts allocated by the outline → track in facts_used`,
    `(church_facts rows; weave fact.data fields into copy per the outline's`,
    `fact_assignments treatment vocab — card_per_row, embed_field, etc.)`,
    '```json',
    JSON.stringify(inputs.factsForPage, null, 2),
    '```',
    ``,
    `## Crawl topics allocated by the outline → track in crawl_topics_used`,
    `(existing site content; excerpt / rewrite / paraphrase per the outline's`,
    `crawl_topic_assignments treatment)`,
    '```json',
    JSON.stringify(inputs.crawlTopicsForPage, null, 2),
    '```',
    ``,
    `Now call \`${TOOL_NAME}\` with the page draft.`,
    `Tracking rule: every section emits three arrays — atoms_used, facts_used,`,
    `crawl_topics_used — each listing exactly the ids/keys whose content`,
    `you wove into that section's copy. Empty array is fine for a kind`,
    `you didn't consume in a section; missing array fails the schema.`,
    `Cross-routing ids (atom UUID in facts_used, etc.) trips the validator.`,
    `Verbatim atoms (verbatim=true) MUST appear EXACTLY as a substring`,
    `of the section's copy — no compression, no rewording. The validator`,
    `does a substring check.`,
  ].join('\n')
}

async function buildLocalValidationManifest(
  sb:        any,
  projectId: string,
  pageSlug:  string,
): Promise<DraftPageValidationManifest> {
  const [atomsRes, factsRes, topicsRes, projectRes] = await Promise.all([
    sb.from('content_atoms')
      .select('id, body, verbatim, topic')
      .eq('web_project_id', projectId)
      .in('status', ['active', 'draft']),
    sb.from('church_facts')
      .select('id')
      .eq('web_project_id', projectId),
    sb.from('web_project_topics')
      .select('topic_key')
      .eq('web_project_id', projectId),
    sb.from('strategy_web_projects')
      .select('roadmap_state')
      .eq('id', projectId)
      .maybeSingle(),
  ])
  if (atomsRes.error)  throw new Error(`content_atoms load failed: ${atomsRes.error.message}`)
  if (factsRes.error)  throw new Error(`church_facts load failed: ${factsRes.error.message}`)
  if (topicsRes.error) throw new Error(`web_project_topics load failed: ${topicsRes.error.message}`)
  if (projectRes.error) throw new Error(`project load failed: ${projectRes.error.message}`)

  const roadmap = (projectRes.data?.roadmap_state ?? {}) as Record<string, any>
  const outline = roadmap?.page_outlines?.[pageSlug]
  if (!outline) {
    throw new Error(`page_outlines.${pageSlug} not found — run-outline-page first`)
  }

  const outline_sections: DraftPageValidationManifest['outline_sections'] = []
  if (Array.isArray(outline.sections)) {
    for (const [ix, s] of (outline.sections.entries() as IterableIterator<[number, any]>)) {
      outline_sections.push({
        section_index: ix,
        archetype:     typeof s?.archetype === 'string' ? s.archetype : '',
        atom_ids: Array.isArray(s?.atom_assignments)
          ? s.atom_assignments.map((a: any) => String(a?.atom_id ?? '')).filter(Boolean)
          : [],
        fact_ids: Array.isArray(s?.fact_assignments)
          ? s.fact_assignments.map((f: any) => String(f?.fact_id ?? '')).filter(Boolean)
          : [],
        crawl_topic_keys: Array.isArray(s?.crawl_topic_assignments)
          ? s.crawl_topic_assignments.map((c: any) => String(c?.topic_key ?? '')).filter(Boolean)
          : [],
      })
    }
  }

  // verbatim_atoms now carries topic alongside body so the validator
  // can skip the substring check for voice_*/tone_descriptor atoms
  // (which are imitation material, not literal slot content).
  const atom_ids: string[] = []
  const verbatim_atoms: Record<string, { body: string; topic: string }> = {}
  for (const row of (atomsRes.data ?? [])) {
    atom_ids.push(String(row.id))
    if (row.verbatim && typeof row.body === 'string') {
      verbatim_atoms[String(row.id)] = { body: row.body, topic: String(row.topic ?? '') }
    }
  }
  const fact_ids: string[]         = (factsRes.data  ?? []).map((r: any) => String(r.id))
  const crawl_topic_keys: string[] = (topicsRes.data ?? []).map((r: any) => String(r.topic_key))

  return {
    atom_ids,
    fact_ids,
    crawl_topic_keys,
    verbatim_atoms,
    outline_section_count: outline_sections.length,
    outline_sections,
    canonical_templates:   loadCanonicalTemplates(),
    expected_page_slug:    pageSlug,
  }
}

let _canonicalTemplatesCache: CanonicalTemplateManifest | null = null
function loadCanonicalTemplates(): CanonicalTemplateManifest {
  if (_canonicalTemplatesCache) return _canonicalTemplatesCache
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const path = resolve(__dirname, '..', '..', '..', 'cowork-skills', 'canonical-templates.json')
  _canonicalTemplatesCache = JSON.parse(readFileSync(path, 'utf8')) as CanonicalTemplateManifest
  return _canonicalTemplatesCache
}

function inferImporterUrl(req: any): string {
  const proto = req.headers['x-forwarded-proto'] ?? 'https'
  const host  = req.headers['x-forwarded-host'] ?? req.headers.host
  return `${proto}://${host}/api/web/agents/import-cowork-bundle`
}

/**
 * Collect the union of slot names across all archetypes referenced
 * by the outline's sections. The model's `copy` keys are restricted
 * (via propertyNames.enum on the tool schema) to this union — gateway
 * rejects keys the union doesn't contain. Per-archetype-precision
 * (a slot valid for archetype A used in a section bound to archetype
 * B) stays the validator's job, defense in depth.
 *
 * Skips archetypes not present in canonical_templates (validator
 * will already trip unknown_archetype for those).
 */
function collectAllowedSlotNames(
  outline:  any,
  manifest: DraftPageValidationManifest,
): string[] {
  const set = new Set<string>()
  const archetypes = manifest.canonical_templates?.page_section_templates ?? {}
  for (const s of (outline?.sections ?? [])) {
    const archetypeDef = archetypes[s?.archetype]
    if (!archetypeDef) continue
    for (const slotKey of Object.keys(archetypeDef.cowork_writable_slots ?? {})) {
      set.add(slotKey)
    }
  }
  return Array.from(set)
}
