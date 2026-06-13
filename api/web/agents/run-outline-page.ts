/**
 * Vercel Serverless Function — /api/web/agents/run-outline-page
 *
 * Cowork worker endpoint: outline ONE page.
 *
 *   POST { project_id, page_slug }
 *
 * This is the canonical pattern the other 8 cowork worker endpoints
 * will copy. Three constraints baked in by design:
 *
 *   1. Resolves system prompt via the resolveCoworkSkill pipeline —
 *      generated default → DB global override → DB project addendum.
 *      NEVER imports COWORK_SKILL_BUNDLES directly, so any future
 *      strategist override at the DB tier wins on arrival.
 *
 *   2. Stamps prompt_hash + model + skill_version into the outline's
 *      _meta block, so artifacts trace to the exact prompt snapshot
 *      that produced them (and the gateway model that actually served
 *      the call, which can differ from what was requested if the
 *      gateway routes a fallback).
 *
 *   3. Calls the import-cowork-bundle endpoint inline with the real
 *      page_outline validator — atom-UUID existence vs. project
 *      inventory + archetype/slot checks vs. canonical-templates.
 *      A 422 from the importer means the outline is unfit; we surface
 *      it to the caller verbatim so the strategist UI can show the
 *      structured failure list.
 *
 * Flow:
 *   1. Load project state (allocation slice + stage_1 + ministry_model
 *      + per-page atom/fact projections) in parallel.
 *   2. Resolve the outline-page prompt via resolveCoworkSkill.
 *   3. Call AI Gateway with forced tool-call → outline JSON.
 *   4. Stamp _meta with prompt_hash + model + skill_version + usage.
 *   5. POST to /api/web/agents/import-cowork-bundle with
 *      bundle_kind='page_outline' which validates + lands.
 *   6. Return either the validated outline summary, or the validator's
 *      structured failure list on 422.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { callGateway, type ToolSchema } from '../../srp/_lib/aiGateway.js'
import { resolveCoworkSkill } from './_lib/resolveCoworkSkill.js'
import { BUNDLE_VERSION, FLOW_ROLES, SOURCE_TREATMENTS } from '../../../src/types/coworkBundle.js'
import {
  validatePageOutline,
  type CanonicalTemplateManifest,
  type PageOutlineValidationManifest,
  type PageOutlineValidationResult,
} from '../../../src/lib/cowork/validatePageOutline.js'
import { compactCrawlTopics } from '../../../src/lib/cowork/compactCrawlTopic.js'

// Cowork outline calls are model-driven on Opus 4.7 with sizable
// inputs (allocation slice + atoms + facts + stage_1). Opt into the
// Pro 300s ceiling so cold starts have room.
export const maxDuration = 300

const TOOL_NAME = 'emit_page_outline'
const TOOL_DESCRIPTION =
  'Emit the page outline conforming to the CoworkPageOutline contract — sections[] ' +
  'with archetype + section_job + flow_role + atom_assignments referencing real atom_ids ' +
  'from the project inventory.'

/**
 * Build the JSON Schema for the forced tool call, with `atom_id`
 * enum-constrained to the literal atom_ids from the user message's
 * atoms-for-this-page projection.
 *
 * THE THREE-LAYER DOCTRINE (banked from the SKILL tune v2 experiment
 * on 2026-06-12):
 *   1. Prose teaches SHAPE — deterministic for structural rules
 *      (slot_hint format, escape-hatch usage). v1 tune got both to
 *      exact zero on first fire.
 *   2. Schema enforces IDENTITY — open-vocabulary fields (UUIDs,
 *      registries, anything beyond a closed enum) hit a prose
 *      ceiling and need tool-schema-level enforcement. v2 prose
 *      tune on atom_id only moved unknown_atom_ref 15 -> 13
 *      (sampling noise). Schema-enum makes invalid IDs impossible
 *      by construction.
 *   3. Importer is the TRUST BOUNDARY — defense in depth. Validators
 *      stay even when schema enforces, because schema enforcement
 *      depends on the gateway honoring strict tool schemas. Free
 *      check, real safety.
 *
 * Build the enum from the SAME projection the user message receives
 * so the two can never disagree about what's in scope. (atomIdsInScope
 * here MUST come from inputs.atomsForPage.map(a => a.id) — the same
 * source `buildUserMessage` reads.)
 *
 * Edge case: empty atomIdsInScope. If a page has zero allocated atoms,
 * an empty `enum: []` would make the schema invalid (no value can
 * satisfy it). We instead drop the enum and allow any string — but
 * then there's also no valid atom_assignments to emit, so this case
 * should round-trip with sections.atom_assignments = []. The
 * validator will catch any drift.
 */
function buildToolSchema(
  atomIdsInScope:   string[],
  factIdsInScope:   string[],
  crawlKeysInScope: string[],
): ToolSchema {
  // Empty-enum edge case (same logic for all three kinds): if zero
  // refs are in scope for a kind, fall back to open string. The model
  // shouldn't emit any assignments of that kind anyway (the user
  // message won't list any sources to bind), and an empty enum
  // would make the schema invalid.
  const idSchemaFor = (refs: string[]): Record<string, unknown> =>
    refs.length > 0 ? { type: 'string', enum: refs } : { type: 'string' }

  const atomIdSchema   = idSchemaFor(atomIdsInScope)
  const factIdSchema   = idSchemaFor(factIdsInScope)
  const crawlKeySchema = idSchemaFor(crawlKeysInScope)
  const sourceTreatmentSchema = { type: 'string' as const, enum: [...SOURCE_TREATMENTS] }

  return {
    type: 'object',
    additionalProperties: false,
    required: ['page_slug', 'ministry_model_alignment', 'sections', 'unresolved_inputs'],
    properties: {
      page_slug: { type: 'string' },
      ministry_model_alignment: {
        type: 'string',
        enum: ['attractional', 'discipleship', 'missional', 'mixed'],
      },
      sections: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['section_ix', 'archetype', 'section_job', 'flow_role',
                     'voice_anchor', 'anti_pattern_to_avoid',
                     'atom_assignments', 'fact_assignments', 'crawl_topic_assignments'],
          properties: {
            section_ix:        { type: 'integer', minimum: 0 },
            archetype:         { type: 'string' },
            section_job:       { type: 'string' },
            flow_role:         { type: 'string', enum: [...FLOW_ROLES] },
            voice_anchor:      { type: 'string' },
            anti_pattern_to_avoid: { type: 'string' },
            cms_managed:       { type: 'boolean' },
            atom_assignments:  {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['atom_id', 'treatment', 'slot_hint'],
                properties: {
                  atom_id:    atomIdSchema,
                  treatment:  { type: 'string', enum: ['use_as_is', 'lift_phrase', 'compress', 'expand', 'reorder', 'omit'] },
                  slot_hint:  { type: 'string' },
                },
              },
            },
            fact_assignments: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['fact_id', 'treatment', 'slot_hint'],
                properties: {
                  fact_id:    factIdSchema,
                  treatment:  sourceTreatmentSchema,
                  slot_hint:  { type: 'string' },
                },
              },
            },
            crawl_topic_assignments: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['topic_key', 'treatment', 'slot_hint'],
                properties: {
                  topic_key:  crawlKeySchema,
                  treatment:  sourceTreatmentSchema,
                  slot_hint:  { type: 'string' },
                },
              },
            },
          },
        },
      },
      unresolved_inputs: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['what', 'where'],
          properties: {
            what:  { type: 'string' },
            where: { type: 'string' },
          },
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
  if (!inputs.allocation) {
    return res.status(404).json({
      error: 'allocation_not_found',
      detail: `roadmap_state.page_allocation_plan.allocations[] has no entry for slug='${pageSlug}'. Run plan-cross-page-allocation first.`,
    })
  }

  // 2. Resolve prompt (generated default + DB override + project addendum).
  let resolved: Awaited<ReturnType<typeof resolveCoworkSkill>>
  try {
    resolved = await resolveCoworkSkill(sb, 'outline-page', projectId)
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'prompt resolve failed' })
  }

  // Build the validation manifest ONCE — repair loop re-uses it so the
  // model is repaired against the same atom inventory + canonical
  // templates the importer will check it against. Catches drift before
  // it hits the trust boundary.
  let localManifest: PageOutlineValidationManifest
  try {
    localManifest = await buildLocalValidationManifest(sb, projectId, pageSlug)
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'manifest build failed' })
  }

  // Build the tool schema per-request — atom_id / fact_id / topic_key
  // are each enum-constrained to the literal refs from inputs (the
  // same projections the user message reads). Same source for the
  // model + the validator: the two views of "what's in scope" can
  // never disagree. (Enum enforcement is provider-conditional via the
  // gateway; the validator + repair-on-422 backstop is the trust
  // boundary.)
  const toolSchema = buildToolSchema(
    inputs.atomsForPage.map(a => a.id),
    inputs.factsForPage.map(f => f.id),
    inputs.crawlTopicsForPage.map(t => t.topic_key),
  )

  // 3-4. Call gateway → validate locally → repair-on-422 → re-validate.
  // The repair loop runs LOCALLY before the importer ever sees the
  // outline. Importer still re-validates as the trust boundary; this
  // pre-validation just avoids ping-ponging 422s through the HTTP layer
  // and gives us per-run telemetry on whether the loop earns its keep.
  const baseUserMessage = buildUserMessage(pageSlug, inputs)
  let gatewayResult: Awaited<ReturnType<typeof callGateway>>
  let firstPass: PageOutlineValidationResult | null = null
  let repaired = false

  try {
    gatewayResult = await callGateway({
      model:           resolved.model,
      system:          resolved.systemPrompt,
      user:            baseUserMessage,
      toolName:        TOOL_NAME,
      toolDescription: TOOL_DESCRIPTION,
      toolSchema,
      maxTokens:       12000,
    })
  } catch (e) {
    return mapGatewayError(res, e)
  }

  let validation = validatePageOutline(gatewayResult.args as any, localManifest)
  if (!validation.ok) {
    firstPass = validation
    // ONE repair attempt. Append the failure list to the user message —
    // the model sees exactly which checks tripped and which sections /
    // atom_ids / archetypes triggered them. Resist multi-shot retries:
    // if one targeted repair doesn't land, the prompt or input
    // projection is the real bug and we want the strategist to see it,
    // not hide it behind retry-until-it-works.
    const repairMessage = [
      baseUserMessage,
      ``,
      `## Validation feedback — repair this outline`,
      ``,
      `The outline you produced did not pass deterministic validation`,
      `against the project inventory + canonical templates. Fix ONLY the`,
      `named gaps below; do not regenerate the rest. Emit a corrected`,
      `outline via the same \`${TOOL_NAME}\` tool call.`,
      ``,
      `**Repair rule (the failure mode you must avoid):** if a fix`,
      `requires REMOVING a source from an assignment array (voice atom`,
      `routed to voice_anchor, atom that doesn't fit, fact whose data`,
      `doesn't match the slot), and removing it leaves a required slot`,
      `uncovered, name the gap in \`unresolved_inputs\` with a what+where`,
      `pair. Never invent a UUID. Never borrow an id from another`,
      `section. Never cross-route an id between assignment arrays.`,
      ``,
      '```',
      validation.summary,
      '```',
      ``,
      `Failures by check (machine-readable):`,
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
        maxTokens:       12000,
      })
    } catch (e) {
      return mapGatewayError(res, e)
    }
    repaired = true
    // Combine usage from both calls — the telemetry accounting needs
    // to reflect what the run actually cost.
    gatewayResult = {
      args:   repairResult.args,
      model:  repairResult.model,
      usage: {
        inputTokens:  gatewayResult.usage.inputTokens  + repairResult.usage.inputTokens,
        outputTokens: gatewayResult.usage.outputTokens + repairResult.usage.outputTokens,
      },
    }
    validation = validatePageOutline(repairResult.args as any, localManifest)
  }

  // Stamp _meta — including the repair telemetry. P7 seed.
  const now = new Date().toISOString()
  const sourceCounts = countUniqueSourceIds(gatewayResult.args)
  const outlineWithMeta = {
    ...gatewayResult.args,
    _meta: {
      bundle_version: BUNDLE_VERSION,
      skill_name:     'outline-page',
      skill_version:  resolved.skillVersion,
      generated_at:   now,
      model:          gatewayResult.model,
      prompt_hash:    resolved.promptHash,
      usage: {
        input_tokens:  gatewayResult.usage.inputTokens,
        output_tokens: gatewayResult.usage.outputTokens,
      },
      atom_count_used:        sourceCounts.atoms,
      fact_count_used:        sourceCounts.facts,
      crawl_topic_count_used: sourceCounts.crawlTopics,
      sections_count:  Array.isArray(gatewayResult.args.sections) ? gatewayResult.args.sections.length : 0,
      // Repair-loop telemetry — set on every artifact so the strategist
      // UI can surface which outlines self-healed vs. landed clean,
      // and so prompt-tuning has a signal to chase: a high repair rate
      // for a specific check (e.g. always trips `unknown_archetype`
      // first pass, repairs on second) means the prompt or input
      // projection isn't conveying the constraint.
      repaired,
      first_pass_failures: firstPass
        ? {
            count:   firstPass.failures.length,
            by_check: Object.fromEntries(Object.entries(firstPass.byCheck).map(([k, v]) => [k, v.length])),
          }
        : null,
    },
  }

  if (!validation.ok) {
    // Even after one repair pass, validation still fails. Surface the
    // diagnostic to the caller WITHOUT calling the importer — there's
    // no point ping-ponging a known-bad outline through the trust
    // boundary just to get the same failure list back over HTTP.
    return res.status(422).json({
      stage:        'local_validate',
      error:        'validation_failed_after_repair',
      summary:      validation.summary,
      byCheck:      validation.byCheck,
      failures:     validation.failures,
      first_pass_failures: firstPass ? {
        count:   firstPass.failures.length,
        by_check: Object.fromEntries(Object.entries(firstPass.byCheck).map(([k, v]) => [k, v.length])),
      } : null,
      outline_for_inspection: outlineWithMeta,
    })
  }

  // POST to import endpoint (the trust boundary re-validates + lands).
  const importerUrl = inferImporterUrl(req)
  const importerRes = await fetch(importerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project_id:  projectId,
      bundle_kind: 'page_outline',
      page_slug:   pageSlug,
      bundle:      outlineWithMeta,
    }),
  })
  const importerJson = await importerRes.json().catch(() => ({}))

  if (!importerRes.ok) {
    // Local validation passed but importer rejected — unusual; means
    // the trust-boundary validator caught something the local copy
    // missed (e.g. atom_id raced an atom-status change between the
    // manifest build and the import). Surface the importer's
    // structured failure list verbatim.
    return res.status(importerRes.status).json({
      stage:        'import',
      error:        importerJson?.error ?? 'import_failed',
      summary:      importerJson?.summary,
      byCheck:      importerJson?.byCheck,
      failures:     importerJson?.failures,
      outline_for_inspection: outlineWithMeta,
    })
  }

  return res.status(200).json({
    ok:           true,
    page_slug:    pageSlug,
    outline:      outlineWithMeta,
    skill_meta:   outlineWithMeta._meta,
    importer:     importerJson,
    prompt_resolution: {
      global_source:        resolved.globalSource,
      has_project_addendum: resolved.hasProjectAddendum,
    },
    /** Validation manifest the endpoint used. Returned so smoke /
     *  regression scripts can persist it alongside the outline as the
     *  reproducible fixture-pair — check:page-outline-validator
     *  re-validates without a Supabase connection. */
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

/**
 * Build the validation manifest the endpoint will use to pre-validate
 * the outline before sending to the importer. Identical shape to the
 * one the importer builds — we deliberately duplicate the build here
 * (rather than calling the importer for it) so the repair loop has
 * the same view of "what counts as valid" as the trust boundary.
 *
 * Canonical-templates cached at module scope, same as the importer.
 */
async function buildLocalValidationManifest(
  sb:        any,
  projectId: string,
  pageSlug:  string,
): Promise<PageOutlineValidationManifest> {
  // Three parallel loads — atoms (with topic for the voice-atom check),
  // facts, crawl topics. Same shape the importer's buildPageOutlineManifest-
  // FromProject loads, deliberately duplicated so the local repair loop
  // has the exact same view as the trust boundary.
  const [atomsRes, factsRes, topicsRes] = await Promise.all([
    sb.from('content_atoms')
      .select('id, topic')
      .eq('web_project_id', projectId)
      .in('status', ['active', 'draft']),
    sb.from('church_facts')
      .select('id')
      .eq('web_project_id', projectId),
    sb.from('web_project_topics')
      .select('topic_key')
      .eq('web_project_id', projectId),
  ])
  if (atomsRes.error)  throw new Error(`content_atoms load failed: ${atomsRes.error.message}`)
  if (factsRes.error)  throw new Error(`church_facts load failed: ${factsRes.error.message}`)
  if (topicsRes.error) throw new Error(`web_project_topics load failed: ${topicsRes.error.message}`)

  const atom_ids: string[] = []
  const atom_topics: Record<string, string> = {}
  for (const row of (atomsRes.data ?? [])) {
    const id = String(row.id)
    atom_ids.push(id)
    atom_topics[id] = String(row.topic ?? '')
  }
  const fact_ids: string[]         = (factsRes.data  ?? []).map((r: any) => String(r.id))
  const crawl_topic_keys: string[] = (topicsRes.data ?? []).map((r: any) => String(r.topic_key))

  return {
    atom_ids,
    atom_topics,
    fact_ids,
    crawl_topic_keys,
    canonical_templates: loadCanonicalTemplates(),
    expected_page_slug:  pageSlug,
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

// ──────────────────────────────────────────────────────────────────────────

interface AssembledInputs {
  allocation:        any           // the allocation slice for this page
  stage1Brief:       any           // ethos + personas + voice exemplars + anti-exemplars
  ministryModel:     any           // { dominant_model, secondary_blend }
  atomsForPage:      Array<{ id: string; topic: string; body: string; verbatim: boolean }>
  factsForPage:      Array<{ id: string; topic: string; data: Record<string, unknown> }>
  crawlTopicsForPage: Array<{
    topic_key:        string
    topic_label:      string | null
    topic_group:      string | null
    coverage_status:  string | null
    passages:         unknown
    items:            unknown
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
  const allocations: any[] = roadmap?.page_allocation_plan?.allocations ?? []
  const allocation = allocations.find((a: any) => a?.page_slug === pageSlug) ?? null

  const stage_1        = roadmap?.stage_1        ?? null
  const ministry_model = roadmap?.ministry_model ?? null

  // Collect atom_ids + fact_ids + crawl_topic_keys referenced by this
  // allocation's section_intents. Each source.kind routes to its own
  // load — the projections the model receives ARE the projections the
  // schema enums constrain, and ARE the projections the validator
  // checks. Three views, one source-of-truth (allocation.section_intents).
  const atomIds       = new Set<string>()
  const factIds       = new Set<string>()
  const crawlTopicKeys = new Set<string>()
  if (allocation && Array.isArray(allocation.section_intents)) {
    for (const s of allocation.section_intents) {
      for (const src of (s.sources ?? [])) {
        if (!src?.ref) continue
        if (src.kind === 'pillar')      atomIds.add(String(src.ref))
        if (src.kind === 'fact')        factIds.add(String(src.ref))
        if (src.kind === 'crawl_topic') crawlTopicKeys.add(String(src.ref))
      }
    }
  }

  const [atomsRes, factsRes, topicsRes] = await Promise.all([
    atomIds.size > 0
      // content_quality is referenced by the outline-page SKILL prompt
      // (atoms_for_page[].content_quality) but the live content_atoms
      // table doesn't carry that column today — the SKILL describes a
      // future-shape field. Drop from select; drafter sees undefined.
      // Re-add when v71+ migration adds content_quality on content_atoms.
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

  // Compact stage_1 — only fields outline-page reads.
  const stage1Brief = stage_1 ? {
    ethos_summary:        stage_1.ethos_summary,
    personas:             stage_1.personas,
    voice_exemplars:      stage_1.voice_exemplars,
    voice_anti_exemplars: stage_1.voice_anti_exemplars,
    persuasive_posture_by_persona: stage_1.persuasive_posture_by_persona,
  } : null

  return {
    allocation,
    stage1Brief,
    ministryModel:       ministry_model,
    atomsForPage:        (atomsRes.data  ?? []) as AssembledInputs['atomsForPage'],
    factsForPage:        (factsRes.data  ?? []) as AssembledInputs['factsForPage'],
    crawlTopicsForPage:  (topicsRes.data ?? []) as AssembledInputs['crawlTopicsForPage'],
  }
}

function buildUserMessage(pageSlug: string, inputs: AssembledInputs): string {
  // The systemPrompt already contains the SKILL.md body + the canonical-
  // templates + page-outlines-by-ministry-model concatenated references.
  // The user message just supplies the per-call data.
  //
  // Three source kinds in three separate buckets, with a routing rule
  // at the close. Each section may bind any combination of the three;
  // the model must NOT cross-route (no fact UUID in atom_assignments,
  // no atom UUID in fact_assignments). That mirrors the schema enum
  // constraints and the validator's three unknown_*_ref checks.
  return [
    `Outline the page with slug \`${pageSlug}\` per the SKILL above.`,
    ``,
    `## Allocation slice (the section_intents YOU MUST cover)`,
    '```json',
    JSON.stringify(inputs.allocation, null, 2),
    '```',
    ``,
    `## Stage_1 brief (voice + personas + ethos)`,
    '```json',
    JSON.stringify(inputs.stage1Brief, null, 2),
    '```',
    ``,
    `## Ministry model`,
    '```json',
    JSON.stringify(inputs.ministryModel, null, 2),
    '```',
    ``,
    `## Atoms allocated to this page → route via \`atom_assignments[].atom_id\``,
    `(full bodies; these are the ONLY ids that may appear in atom_assignments)`,
    '```json',
    JSON.stringify(inputs.atomsForPage, null, 2),
    '```',
    ``,
    `## Facts allocated to this page → route via \`fact_assignments[].fact_id\``,
    `(church_facts rows; treatment vocab: card_per_row / embed_field / list_items / summarize / lift_verbatim / weave_into_paragraph)`,
    '```json',
    JSON.stringify(inputs.factsForPage, null, 2),
    '```',
    ``,
    `## Crawl topics allocated to this page → route via \`crawl_topic_assignments[].topic_key\``,
    `(existing site content from web_project_topics; treatment vocab: excerpt / rewrite / paraphrase / summarize.`,
    `Each topic carries a sample + total + a \`*_truncated\` boolean. If \`passages_truncated: true\` or`,
    `\`items_truncated: true\`, the sample is NOT the complete inventory — write only from what you can see,`,
    `and if you need a passage/item not in the sample, declare \`unresolved_inputs\` naming the topic_key`,
    `+ what's missing. Treating the sample as the whole is a false-certainty failure mode.)`,
    '```json',
    JSON.stringify(compactCrawlTopics(inputs.crawlTopicsForPage as Record<string, unknown>[]), null, 2),
    '```',
    ``,
    `Emit the outline now via the \`${TOOL_NAME}\` tool call. Routing rule:`,
    `each source from the allocation lands in EXACTLY ONE of the three`,
    `arrays based on its kind — pillar→atom_assignments, fact→fact_assignments,`,
    `crawl_topic→crawl_topic_assignments. Cross-routing (e.g. putting a`,
    `fact_id into atom_assignments[].atom_id) trips the validator. Every`,
    `section may emit empty arrays for kinds it doesn't consume.`,
  ].join('\n')
}

function countUniqueSourceIds(outline: any): { atoms: number; facts: number; crawlTopics: number } {
  const atomSet  = new Set<string>()
  const factSet  = new Set<string>()
  const crawlSet = new Set<string>()
  for (const s of (outline?.sections ?? [])) {
    for (const a of (s?.atom_assignments ?? [])) {
      if (a?.atom_id) atomSet.add(String(a.atom_id))
    }
    for (const f of (s?.fact_assignments ?? [])) {
      if (f?.fact_id) factSet.add(String(f.fact_id))
    }
    for (const c of (s?.crawl_topic_assignments ?? [])) {
      if (c?.topic_key) crawlSet.add(String(c.topic_key))
    }
  }
  return { atoms: atomSet.size, facts: factSet.size, crawlTopics: crawlSet.size }
}

function inferImporterUrl(req: any): string {
  // On Vercel the host is reachable via the same origin; locally vercel dev
  // exposes the api/ tree on the same port.
  const proto = req.headers['x-forwarded-proto'] ?? 'https'
  const host  = req.headers['x-forwarded-host'] ?? req.headers.host
  return `${proto}://${host}/api/web/agents/import-cowork-bundle`
}
