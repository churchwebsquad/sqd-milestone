// Content-Model Formation Plan — public entry point.
//
// Compose: loadProjectInputs → classifyOne per (section × fieldDef)
// → detectFlexibleContentPages → buildWpObjects → buildAcfFieldGroups
// → wrap in ContentModelPlan envelope → persist to
// strategy_web_projects.roadmap_state.content_model_plan.
//
// Phase 1: callable from the DevHandoffWorkspace "Compute now" button.
// Phase 2: auto-recompute hook fired from src/lib/pageApprovals.ts on
// approval-state transitions (deferred).

import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase as defaultSupabase } from '../supabase'
import type { ContentModelPlan, ClassificationRecord, DiscoverySection } from './types'
import { loadProjectInputs, type FormationInputs } from './sources'
import {
  buildAcfFieldGroups,
  buildDiscoverySections,
  buildWpObjects,
  classifyOne,
  detectFlexibleContentPages,
} from './emit'
import { CHROME_ROLES } from './rules'
import { buildInventoryDiscoverySections, loadInventoryTopics } from './inventoryDiagnosis'
import type { InventoryDiscoveryRow } from './inventoryDiagnosis'
import { compareInventoryToBound } from './inventoryBoundComparator'
import { llmEnrichPlan } from './llmVerify'

export { loadProjectInputs } from './sources'
export type { FormationInputs } from './sources'
export type {
  AcfField,
  AcfFieldGroup,
  ClassificationRecord,
  ClassificationSignals,
  ContentModelPlan,
  Structure,
  WpObject,
  WpObjectCpt,
  WpObjectExternal,
  WpObjectOptionsPage,
  WpObjectRepeater,
} from './types'

// ── Top-level orchestration ──────────────────────────────────────────

/** Bumped whenever the analyzer's output shape or classification logic
 *  changes in a way that means cached plans should be recomputed. Used
 *  by the DevHandoffWorkspace stale-plan banner to detect "code moved
 *  on, plan didn't" — distinct from input drift (section edits), which
 *  is covered by the existing updated_at comparison.
 *
 *  Bumping rules: increment whenever a meaningful analyzer change ships
 *  (filter changes, new canonical fields, new CPT routing, new
 *  classification heuristics). Don't bump for non-analyzer changes
 *  (UI tweaks, unrelated edits). The shape stays at `analyzer-vMAJOR.MINOR`
 *  so the DevHandoff banner can compare lexicographically and skip
 *  the warning when plans match the current code. */
export const ANALYZER_REVISION = 'analyzer-v1.12' as const

/** Computes the ContentModelPlan for a web project. Pure: doesn't
 *  touch the DB beyond the read side. Use `saveFormationPlan` to
 *  persist. */
export async function computeFormationPlan(
  webProjectId: string,
  sb: SupabaseClient = defaultSupabase,
  opts?: { skipLlm?: boolean },
): Promise<ContentModelPlan> {
  const inputs = await loadProjectInputs(webProjectId, sb)

  // Layer 1 — classify every non-chrome section × every field def.
  const layer1: ClassificationRecord[] = []
  for (const page of inputs.approvedPages) {
    const sections = inputs.sectionsByPage.get(page.id) ?? []
    for (const section of sections) {
      if (section.section_role && CHROME_ROLES.has(section.section_role)) continue
      const template = section.content_template_id
        ? inputs.templatesById.get(section.content_template_id) ?? null
        : null
      if (!template?.fields) continue
      for (const fieldDef of template.fields) {
        layer1.push(
          classifyOne({ inputs, page, section, template }, fieldDef),
        )
      }
    }
  }
  // Append page-level flexible-content detections.
  layer1.push(...detectFlexibleContentPages(inputs))

  // Layer 2 — WordPress objects.
  const layer2 = buildWpObjects(layer1, inputs)

  // Layer 3 — ACF field groups.
  const layer3 = buildAcfFieldGroups(layer2, layer1, inputs)

  // Discovery — per-section "what's here" summaries grouped by page
  // at render time. The strategist needs this granularity (Pastors
  // vs Ministry Leaders vs Elders all use the same team_grid template
  // but carry different schemas + ship to different targets — they
  // need to be visible as DISTINCT discovery rows even though they
  // all roll up to the same staff CPT in the analyzer's suggestion).
  const discoverySections = buildDiscoverySections(inputs, layer1)

  // Inventory diagnosis (v1.6) — classify schemas from
  // web_project_topics.items BEFORE template binding. Surfaces
  // schemas that exist in source even when no bound section exists,
  // AND lets us compare source-vs-bound to catch upstream cowork
  // compression losses (the real build-time issues).
  let inventoryDiscovery: InventoryDiscoveryRow[] = []
  try {
    const topics = await loadInventoryTopics(webProjectId, sb)
    inventoryDiscovery = buildInventoryDiscoverySections(topics)
    // Mutates discoverySections to add upstream_compression_loss
    // build_time_issues where applicable.
    compareInventoryToBound(inventoryDiscovery, discoverySections)
  } catch (e) {
    // Non-fatal — inventory diagnosis is enrichment, not required.
    console.warn('[formationPlan] inventory diagnosis failed:', e)
  }

  // LLM enrichment (v1.6): adversarial verify on low/medium confidence
  // rows + fallback classification on unclassified rows. Skipped when
  // skipLlm=true or ANTHROPIC_API_KEY isn't set (graceful no-op).
  if (!opts?.skipLlm) {
    try {
      await llmEnrichPlan(discoverySections, inventoryDiscovery, {
        concurrency: 4,
        verify:      true,
        fallback:    true,
      })
    } catch (e) {
      console.warn('[formationPlan] LLM enrichment failed:', e)
    }
  }

  // Preserve strategist overrides across recomputes. Reads any
  // existing plan's schema_overrides and reapplies them to the
  // freshly-classified rows. Override = strategist confirmed/changed
  // the classification; rules should not blow that away.
  const existingPlan = (inputs.project?.roadmap_state as { content_model_plan?: ContentModelPlan } | null)?.content_model_plan
  if (existingPlan?.discovery_sections) {
    const overrideBySectionId = new Map<string, NonNullable<DiscoverySection['schema_override']>>()
    for (const prev of existingPlan.discovery_sections) {
      if (prev.schema_override) overrideBySectionId.set(prev.section_id, prev.schema_override)
    }
    for (const row of discoverySections) {
      const ov = overrideBySectionId.get(row.section_id)
      if (ov) {
        row.schema_override = ov
        // Override wins: replace classifier's schema_name + confidence.
        row.schema_name = ov.schema_name
        row.schema_confidence = 'high'
      }
    }
  }

  // Envelope + _meta.
  const plan: ContentModelPlan = {
    schema_version: 1,
    _meta: {
      generated_at: new Date().toISOString(),
      generated_by: ANALYZER_REVISION,
      input_fingerprint: computeInputFingerprint(inputs),
      counts: {
        classifications:  layer1.length,
        wp_objects:       layer2.length,
        acf_field_groups: layer3.length,
        open_questions:   countOpenQuestions(layer1, layer2),
        low_confidence:   layer1.filter(c => c.confidence === 'low').length,
      },
    },
    layer_1_classifications:  layer1,
    layer_2_wp_objects:       layer2,
    layer_3_acf_field_groups: layer3,
    discovery_sections:       discoverySections,
    inventory_discovery:      inventoryDiscovery,
  }

  return plan
}

/** Computes + writes the plan to roadmap_state.content_model_plan in
 *  a single round-trip. */
/** Write a strategist override on one discovery section. Reads the
 *  current plan, finds the row by section_id, sets schema_override,
 *  writes back. Atomic via single Supabase update. Used by the
 *  DevHandoffWorkspace per-section "confirm" / "change" / "clear"
 *  controls. The override survives recomputes via the merge logic in
 *  computeFormationPlan. */
export async function setSchemaOverride(args: {
  webProjectId: string
  sectionId:    string
  schemaName:   import('./types').SchemaName | null
  userId:       string
  note?:        string
  /** Pass null/undefined to CLEAR the override. */
  clear?:       boolean
  sb?:          SupabaseClient
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = args.sb ?? defaultSupabase
  const { data: row, error: readErr } = await sb
    .from('strategy_web_projects')
    .select('roadmap_state')
    .eq('id', args.webProjectId)
    .maybeSingle()
  if (readErr || !row) return { ok: false, error: readErr?.message ?? 'Project not found' }
  const rs = ((row as { roadmap_state: Record<string, unknown> | null }).roadmap_state ?? {}) as Record<string, unknown>
  const plan = rs.content_model_plan as ContentModelPlan | undefined
  if (!plan?.discovery_sections) return { ok: false, error: 'No discovery_sections — recompute the plan first' }
  const target = plan.discovery_sections.find(s => s.section_id === args.sectionId)
  if (!target) return { ok: false, error: `section ${args.sectionId} not in plan` }
  if (args.clear) {
    delete target.schema_override
  } else {
    target.schema_override = {
      schema_name:  args.schemaName,
      confirmed_at: new Date().toISOString(),
      confirmed_by: args.userId,
      ...(args.note ? { note: args.note } : {}),
    }
    // Apply override to the live row too so the UI reflects it
    // immediately without another recompute.
    target.schema_name = args.schemaName
    target.schema_confidence = 'high'
  }
  const { error: writeErr } = await sb
    .from('strategy_web_projects')
    .update({ roadmap_state: { ...rs, content_model_plan: plan } } as never)
    .eq('id', args.webProjectId)
  if (writeErr) return { ok: false, error: writeErr.message }
  return { ok: true }
}

export async function saveFormationPlan(
  webProjectId: string,
  sb: SupabaseClient = defaultSupabase,
  opts?: { skipLlm?: boolean },
): Promise<ContentModelPlan> {
  const plan = await computeFormationPlan(webProjectId, sb, opts)

  // Read current roadmap_state, merge in the new plan, write back.
  // We intentionally do NOT touch any other key on roadmap_state
  // (especially `acf_plan`, which is owned by the cowork pipeline).
  const { data: row, error: readErr } = await sb
    .from('strategy_web_projects')
    .select('roadmap_state')
    .eq('id', webProjectId)
    .maybeSingle()
  if (readErr || !row) {
    throw new Error(`Read roadmap_state failed: ${readErr?.message ?? 'no row'}`)
  }
  const nextRs = {
    ...((row.roadmap_state as Record<string, unknown> | null) ?? {}),
    content_model_plan: plan,
  }
  const { error: writeErr } = await sb
    .from('strategy_web_projects')
    .update({ roadmap_state: nextRs } as never)
    .eq('id', webProjectId)
  if (writeErr) {
    throw new Error(`Write content_model_plan failed: ${writeErr.message}`)
  }
  return plan
}

// ── Helpers ──────────────────────────────────────────────────────────

function countOpenQuestions(
  layer1: ClassificationRecord[],
  layer2: ReturnType<typeof buildWpObjects>,
): number {
  let n = 0
  for (const c of layer1) n += c.open_questions.length
  for (const o of layer2) {
    if (o.kind === 'custom_post_type') n += o.open_questions.length
    if (o.kind === 'options_page')     n += o.open_questions.length
    if (o.kind === 'repeater')         n += o.open_questions.length
  }
  return n
}

/** Stable hash of the inputs that produced the plan. Used by the
 *  UI's "stale" badge to detect whether the underlying sections have
 *  changed since the last compute. Simple character-sum hash — we
 *  don't need cryptographic strength here. */
function computeInputFingerprint(inputs: FormationInputs): string {
  const parts: string[] = [
    inputs.webProjectId,
    String(inputs.approvedPages.length),
    String(inputs.isMultiCampus),
    inputs.displayPreferences.events  ?? '',
    inputs.displayPreferences.sermons ?? '',
    inputs.displayPreferences.groups  ?? '',
  ]
  for (const page of inputs.approvedPages) {
    parts.push(`${page.slug}:${page.updated_at}`)
    const sections = inputs.sectionsByPage.get(page.id) ?? []
    for (const s of sections) parts.push(`${s.id}:${s.updated_at}`)
  }
  // Declared content models — include id + updated_at + section_ids
  // + item_bindings so an edit to bindings triggers the stale banner.
  for (const m of inputs.declaredContentModels) {
    parts.push(`cm:${m.id}:${m.updated_at}:${m.section_ids.join(',')}`)
    if (m.item_bindings) {
      for (const [sectionId, b] of Object.entries(m.item_bindings)) {
        parts.push(`cmb:${m.id}:${sectionId}:${b.indices.join(',')}`)
      }
    }
  }
  const blob = parts.join('|')
  let h = 0
  for (let i = 0; i < blob.length; i++) {
    h = (h * 31 + blob.charCodeAt(i)) | 0
  }
  return h.toString(36)
}

// ── ACF JSON Sync export ─────────────────────────────────────────────

/** Strips the private `_source` / `_source_section_ids` hints from an
 *  ACF field group so the result is ACF-JSON-Sync compatible. The
 *  hints are useful in our UI for traceability but ACF will reject
 *  unknown keys on import. */
export function toAcfJsonSync(plan: ContentModelPlan): unknown[] {
  return plan.layer_3_acf_field_groups.map(g => {
    const { _source_section_ids: _ssi, ...rest } = g
    return {
      ...rest,
      fields: rest.fields.map(stripPrivate),
    }
  })
}

function stripPrivate(field: unknown): unknown {
  if (field == null || typeof field !== 'object') return field
  const f = field as Record<string, unknown>
  const { _source: _s, ...rest } = f
  const out: Record<string, unknown> = { ...rest }
  if (Array.isArray(f.sub_fields)) {
    out.sub_fields = (f.sub_fields as unknown[]).map(stripPrivate)
  }
  return out
}
