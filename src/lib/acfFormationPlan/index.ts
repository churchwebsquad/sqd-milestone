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
import type { ContentModelPlan, ClassificationRecord } from './types'
import { loadProjectInputs, type FormationInputs } from './sources'
import {
  buildAcfFieldGroups,
  buildWpObjects,
  classifyOne,
  detectFlexibleContentPages,
} from './emit'
import { CHROME_ROLES } from './rules'

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

/** Computes the ContentModelPlan for a web project. Pure: doesn't
 *  touch the DB beyond the read side. Use `saveFormationPlan` to
 *  persist. */
export async function computeFormationPlan(
  webProjectId: string,
  sb: SupabaseClient = defaultSupabase,
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

  // Envelope + _meta.
  const plan: ContentModelPlan = {
    schema_version: 1,
    _meta: {
      generated_at: new Date().toISOString(),
      generated_by: 'analyzer-v1',
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
  }

  return plan
}

/** Computes + writes the plan to roadmap_state.content_model_plan in
 *  a single round-trip. */
export async function saveFormationPlan(
  webProjectId: string,
  sb: SupabaseClient = defaultSupabase,
): Promise<ContentModelPlan> {
  const plan = await computeFormationPlan(webProjectId, sb)

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
