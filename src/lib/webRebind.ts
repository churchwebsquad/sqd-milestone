/**
 * Section rebind orchestrator — chains markdown parser → matcher →
 * fitter → override-preserving merge → persistence.
 *
 * Fired when:
 *   • Staff edits markdown in the Text view (Slice E)
 *   • A markdown-aware import lands a fresh page (future)
 *   • Anywhere we need to "redo the bind from current source_markdown"
 *
 * The contract:
 *   1. Parse `new_markdown` into a fresh ContentDocument
 *   2. Run the matcher against the section's persisted `ir_snapshot` —
 *      node_ids on blocks/items inherit identity by content similarity
 *   3. If the section has a bound template, run the existing
 *      `bindDocumentToTemplate` → fresh field_values + fresh provenance
 *   4. Merge against the current persisted state via
 *      `applyOverridesOnRebind` — any field where the current
 *      provenance is `override` wins (staff polish is sacred)
 *   5. Update `web_sections` with new source_markdown, ir_snapshot,
 *      field_values, field_provenance
 *
 * Bind failures don't drop the markdown — `source_markdown` and the
 * fresh `ir_snapshot` always persist so the Text view stays in sync
 * with the writer's intent even when the binder is unhappy.
 */

import { supabase } from './supabase'
import {
  assignNodeIds,
  bindDocumentToTemplate,
  type ContentDocument,
  type BindProvenanceMap,
} from './webContentDocument'
import { parseCoworkSectionMarkdown, parseCoworkPageMarkdown } from './webMarkdownToDocument'
import {
  applyOverridesOnRebind,
  auto,
  deriveProvenanceFromBind,
  summarizeCoverage,
  unbound,
  type CoverageSummary,
} from './webFieldProvenance'
import { collectPaletteTemplateIds } from './webBindTelemetry'
import { augmentTemplate } from './webBrixiesSchemaAugment'
import type { FieldProvenanceMap, WebContentTemplate } from '../types/database'

// ── Public API ────────────────────────────────────────────────────────

export interface RebindContext {
  page_slug?:  string
  page_title?: string
}

export interface RebindOptions {
  /** User id / email for the override-audit trail. Optional. */
  actor?:   string
  context?: RebindContext
  /** Pre-loaded palette templates if the caller already has them.
   *  Cheaper than re-fetching when rebinding many sections at once. */
  paletteTemplates?: Record<string, WebContentTemplate>
}

export interface RebindResult {
  ok:          boolean
  section_id:  string
  error?:      string
  /** Field keys whose `override` value was kept. The Text view surfaces
   *  these as "N fields pinned" so staff can spot when their polish
   *  protected the rebind from the writer's edits. */
  preserved_overrides: string[]
  /** Snapshot of the post-merge provenance map for the gutter. */
  coverage:    CoverageSummary
  /** Non-fatal warnings (template not found, palette load partial, bind
   *  failed but source_markdown still persisted, etc.). */
  warnings:    string[]
}

/** Rebind a single section from a fresh markdown payload. Loads the
 *  section + its template + palette dependencies in one round-trip per
 *  resource type (no N+1). */
export async function rebindSectionFromMarkdown(
  sectionId:   string,
  newMarkdown: string,
  opts: RebindOptions = {},
): Promise<RebindResult> {
  const warnings: string[] = []

  // 1. Load section state
  const { data: sectionRow, error: secErr } = await supabase
    .from('web_sections')
    .select('id, web_page_id, content_template_id, field_values, source_markdown, ir_snapshot, field_provenance')
    .eq('id', sectionId)
    .maybeSingle()
  if (secErr || !sectionRow) {
    return failure(sectionId, secErr?.message ?? 'section not found', warnings)
  }
  const section = sectionRow as {
    id: string
    web_page_id: string
    content_template_id: string | null
    field_values: Record<string, unknown> | null
    source_markdown: string | null
    ir_snapshot: ContentDocument | null
    field_provenance: FieldProvenanceMap | null
  }

  // 2. Load template + palette dependencies (only if section has a bound template)
  let template: WebContentTemplate | null = null
  const paletteTemplates: Record<string, WebContentTemplate> = { ...(opts.paletteTemplates ?? {}) }
  if (section.content_template_id) {
    const { data: tpl } = await supabase
      .from('web_content_templates')
      .select('id, fields, source_html, layer_name, family, kind')
      .eq('id', section.content_template_id)
      .maybeSingle()
    if (tpl) {
      template = augmentTemplate(tpl as WebContentTemplate)
      const refs = collectPaletteTemplateIds(template.fields)
      const missing = refs.filter(id => !paletteTemplates[id])
      if (missing.length > 0) {
        const { data: rows } = await supabase
          .from('web_content_templates')
          .select('id, fields, source_html, layer_name, family, kind')
          .in('id', missing)
        for (const t of ((rows ?? []) as WebContentTemplate[])) {
          paletteTemplates[t.id] = augmentTemplate(t)
        }
        const stillMissing = refs.filter(id => !paletteTemplates[id])
        if (stillMissing.length > 0) {
          warnings.push(`palette templates not found: ${stillMissing.join(', ')}`)
        }
      }
    } else {
      warnings.push(`template ${section.content_template_id} not found`)
    }
  }

  // 3. Parse markdown → fresh IR, then match to carry node_ids forward
  const freshIrNoIds = parseCoworkSectionMarkdown(newMarkdown, opts.context)
  const matchedIr    = assignNodeIds(freshIrNoIds, section.ir_snapshot ?? null)

  // 4. Bind against the template, derive provenance
  let freshFieldValues: Record<string, unknown> = {}
  let freshProvenance:  FieldProvenanceMap     = {}
  if (template) {
    try {
      const bindTraces: BindProvenanceMap = {}
      freshFieldValues = bindDocumentToTemplate(matchedIr, template, paletteTemplates, bindTraces)
      freshProvenance  = deriveProvenanceFromBind(freshFieldValues, template, bindTraces)
    } catch (err) {
      warnings.push(`bind failed: ${err instanceof Error ? err.message : String(err)}`)
      // Keep current field_values intact — the rebind shouldn't blow
      // away the section just because the binder choked.
      freshFieldValues = (section.field_values as Record<string, unknown> | null) ?? {}
      freshProvenance  = (section.field_provenance as FieldProvenanceMap | null) ?? {}
    }
  } else {
    // Freehand section (no template) — keep current field_values, just
    // refresh the markdown + IR snapshot. Provenance stays as-is.
    freshFieldValues = (section.field_values as Record<string, unknown> | null) ?? {}
    freshProvenance  = (section.field_provenance as FieldProvenanceMap | null) ?? {}
  }

  // 5. Override-preserving merge against current persisted state
  const currentValues     = (section.field_values as Record<string, unknown> | null) ?? {}
  const currentProvenance = (section.field_provenance as FieldProvenanceMap | null) ?? {}
  const merged = applyOverridesOnRebind({
    fresh_field_values:   freshFieldValues,
    fresh_provenance:     freshProvenance,
    current_field_values: currentValues,
    current_provenance:   currentProvenance,
  })

  // 6. Persist — atomic single update
  const { error: updErr } = await supabase
    .from('web_sections')
    .update({
      source_markdown:  newMarkdown,
      ir_snapshot:      matchedIr,
      field_values:     merged.field_values,
      field_provenance: merged.field_provenance,
    })
    .eq('id', sectionId)
  if (updErr) return failure(sectionId, updErr.message, warnings)

  return {
    ok: true,
    section_id: sectionId,
    preserved_overrides: merged.preserved_overrides,
    coverage: summarizeCoverage(merged.field_provenance),
    warnings,
  }
}

// ── helpers ───────────────────────────────────────────────────────────

function failure(sectionId: string, error: string, warnings: string[]): RebindResult {
  return {
    ok: false,
    section_id: sectionId,
    error,
    preserved_overrides: [],
    coverage: summarizeCoverage(null),
    warnings,
  }
}

// ── Page-level ingestion ──────────────────────────────────────────────
//
// Paste a whole cowork markdown file → split into sections by position
// → for each parsed section, either rebind the existing row at the
// same sort_order, or create a fresh freehand row when the page has
// fewer sections than the markdown supplies.
//
// Existing sections at sort_orders the markdown doesn't address are
// LEFT ALONE — partial pastes work. No deletes; the user can prune
// from the Layout view if they need to.

export interface IngestExistingSection {
  id:                  string
  sort_order:          number
  /** Pass through so the rebind matcher can preserve node_ids from
   *  the prior IR. */
  ir_snapshot:         ContentDocument | null
}

export interface PageMarkdownIngestEntry {
  position:   number
  action:     'updated' | 'created' | 'failed'
  section_id?: string
  ok:         boolean
  error?:     string
  preserved_overrides: string[]
  warnings:   string[]
}

export interface PageMarkdownIngestResult {
  ok:         boolean
  entries:    PageMarkdownIngestEntry[]
  /** Sections in the page that the paste didn't touch (sort_orders the
   *  markdown didn't include). Surfaced so the UI can say "12 sections
   *  in markdown, 4 existing sections preserved at positions 12–15". */
  untouched:  IngestExistingSection[]
}

export async function ingestPageMarkdown(opts: {
  pageId:           string
  pageMarkdown:     string
  existingSections: IngestExistingSection[]
  context?:         RebindContext
}): Promise<PageMarkdownIngestResult> {
  const parsed = parseCoworkPageMarkdown(opts.pageMarkdown, opts.context)
  const entries: PageMarkdownIngestEntry[] = []
  const touchedSortOrders = new Set<number>()

  for (const section of parsed) {
    touchedSortOrders.add(section.position)
    const existing = opts.existingSections.find(s => s.sort_order === section.position)

    if (existing) {
      // Hand off to rebindSectionFromMarkdown — that one chains the
      // match + bind + override-preserve + persist correctly.
      const result = await rebindSectionFromMarkdown(existing.id, section.source_markdown, {
        context: opts.context,
      })
      entries.push({
        position:            section.position,
        action:              result.ok ? 'updated' : 'failed',
        section_id:          existing.id,
        ok:                  result.ok,
        error:               result.error,
        preserved_overrides: result.preserved_overrides,
        warnings:            result.warnings,
      })
    } else {
      // New row — assign node_ids fresh, save source_markdown +
      // ir_snapshot directly. No template bound yet; staff can pick
      // one in Layout view once they see the content.
      const irWithIds = assignNodeIds(section.ir, null)
      const { data, error } = await supabase
        .from('web_sections')
        .insert({
          web_page_id:         opts.pageId,
          content_template_id: null,
          field_values:        {},
          source_markdown:     section.source_markdown,
          ir_snapshot:         irWithIds,
          field_provenance:    {},
          sort_order:          section.position,
          content_status:      'draft',
        })
        .select('id')
        .single()
      entries.push({
        position:            section.position,
        action:              error ? 'failed' : 'created',
        section_id:          (data as { id?: string } | null)?.id,
        ok:                  !error,
        error:               error?.message,
        preserved_overrides: [],
        warnings:            [],
      })
    }
  }

  const untouched = opts.existingSections.filter(s => !touchedSortOrders.has(s.sort_order))
  return {
    ok: entries.every(e => e.ok),
    entries,
    untouched,
  }
}

// ── Per-field "Reset to text" ─────────────────────────────────────────
//
// Revert a single field from `override` back to the value the binder
// would produce from the section's current IR snapshot. Used by the Text
// view's bind inspector when staff wants to drop a Layout edit on one
// slot without re-typing or re-running a full markdown rebind.
//
// Re-runs `bindDocumentToTemplate` against the persisted `ir_snapshot`
// (no markdown re-parse — the IR is already current). For the target
// slot, takes the fresh value + trace and writes:
//   • field_values[key] = fresh value (or removed if the IR has nothing
//     to offer — the override goes away entirely)
//   • field_provenance[key] = auto(trace) (or unbound if required + no
//     value, or removed if not required + no value)
// All OTHER fields are untouched — only the one slot mutates.
//
// Safe when: the section has a template AND an ir_snapshot. Without
// either, returns an error result (the inspector hides the button in
// those cases anyway).

export interface FieldResetResult {
  ok: boolean
  section_id: string
  field_key:  string
  error?:     string
  /** Value that was written. `undefined` means the field was cleared
   *  (no IR source available; the override was dropped). */
  applied_value?: unknown
  /** Updated coverage after the change. */
  coverage:   CoverageSummary
  warnings:   string[]
}

export async function resetSectionFieldToText(
  sectionId: string,
  fieldKey:  string,
  opts: { paletteTemplates?: Record<string, WebContentTemplate> } = {},
): Promise<FieldResetResult> {
  const warnings: string[] = []

  // 1. Load section state
  const { data: sectionRow, error: secErr } = await supabase
    .from('web_sections')
    .select('id, content_template_id, field_values, ir_snapshot, field_provenance')
    .eq('id', sectionId)
    .maybeSingle()
  if (secErr || !sectionRow) {
    return resetFailure(sectionId, fieldKey, secErr?.message ?? 'section not found', warnings)
  }
  const section = sectionRow as {
    id: string
    content_template_id: string | null
    field_values: Record<string, unknown> | null
    ir_snapshot: ContentDocument | null
    field_provenance: FieldProvenanceMap | null
  }

  if (!section.content_template_id) {
    return resetFailure(sectionId, fieldKey, 'section has no bound template', warnings)
  }
  if (!section.ir_snapshot) {
    return resetFailure(sectionId, fieldKey, 'section has no IR snapshot yet — save Text first', warnings)
  }

  // 2. Load template + palette dependencies
  const paletteTemplates: Record<string, WebContentTemplate> = { ...(opts.paletteTemplates ?? {}) }
  const { data: tpl } = await supabase
    .from('web_content_templates')
    .select('id, fields, source_html, layer_name, family, kind')
    .eq('id', section.content_template_id)
    .maybeSingle()
  if (!tpl) {
    return resetFailure(sectionId, fieldKey, `template ${section.content_template_id} not found`, warnings)
  }
  const template = augmentTemplate(tpl as WebContentTemplate)
  const refs = collectPaletteTemplateIds(template.fields)
  const missing = refs.filter(id => !paletteTemplates[id])
  if (missing.length > 0) {
    const { data: rows } = await supabase
      .from('web_content_templates')
      .select('id, fields, source_html, layer_name, family, kind')
      .in('id', missing)
    for (const t of ((rows ?? []) as WebContentTemplate[])) {
      paletteTemplates[t.id] = augmentTemplate(t)
    }
    const stillMissing = refs.filter(id => !paletteTemplates[id])
    if (stillMissing.length > 0) {
      warnings.push(`palette templates not found: ${stillMissing.join(', ')}`)
    }
  }

  // Confirm the field key actually exists on this template — protect
  // against stale UI sending a key the template no longer declares.
  const declared = Array.isArray(template.fields)
    ? template.fields.find(f =>
        f && typeof (f as { key?: unknown }).key === 'string'
        && (f as { key: string }).key === fieldKey)
    : null
  if (!declared) {
    return resetFailure(sectionId, fieldKey, `field "${fieldKey}" is not declared on the bound template`, warnings)
  }
  const isRequired = (declared as { kind?: string; required?: boolean }).kind === 'slot'
                     && Boolean((declared as { required?: boolean }).required)

  // 3. Re-run the binder against the current IR (no markdown re-parse)
  let freshFieldValues: Record<string, unknown> = {}
  const bindTraces: BindProvenanceMap = {}
  try {
    freshFieldValues = bindDocumentToTemplate(section.ir_snapshot, template, paletteTemplates, bindTraces)
  } catch (err) {
    return resetFailure(
      sectionId, fieldKey,
      `bind failed: ${err instanceof Error ? err.message : String(err)}`,
      warnings,
    )
  }

  // 4. Build the patch — only mutate the target field
  const nextValues     = { ...((section.field_values as Record<string, unknown> | null) ?? {}) }
  const nextProvenance = { ...((section.field_provenance as FieldProvenanceMap | null) ?? {}) }

  const freshValue = freshFieldValues[fieldKey]
  const populated  = freshValue !== undefined
                     && !(typeof freshValue === 'string' && freshValue.trim() === '')
                     && !(Array.isArray(freshValue) && freshValue.length === 0)

  if (populated) {
    nextValues[fieldKey] = freshValue
    const trace = bindTraces[fieldKey]
    nextProvenance[fieldKey] = trace ? auto(trace) : auto()
  } else {
    // No IR source available — clear the override entirely.
    delete nextValues[fieldKey]
    if (isRequired) nextProvenance[fieldKey] = unbound()
    else            delete nextProvenance[fieldKey]
  }

  // 5. Persist
  const { error: updErr } = await supabase
    .from('web_sections')
    .update({
      field_values:     nextValues,
      field_provenance: nextProvenance,
    })
    .eq('id', sectionId)
  if (updErr) return resetFailure(sectionId, fieldKey, updErr.message, warnings)

  return {
    ok: true,
    section_id: sectionId,
    field_key:  fieldKey,
    applied_value: populated ? freshValue : undefined,
    coverage:   summarizeCoverage(nextProvenance, template),
    warnings,
  }
}

function resetFailure(
  sectionId: string,
  fieldKey:  string,
  error:     string,
  warnings:  string[],
): FieldResetResult {
  return {
    ok: false,
    section_id: sectionId,
    field_key:  fieldKey,
    error,
    coverage:   summarizeCoverage(null),
    warnings,
  }
}
