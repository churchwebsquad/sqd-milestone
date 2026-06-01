/**
 * Field provenance — the override-flag system that makes the
 * Text / Layout / Preview round-trip safe.
 *
 * Every populated field on a `web_sections` row gets a tag:
 *
 *   • `auto`     — the value came from the IR via `ir_path`. Free to
 *                  overwrite on the next bind from markdown.
 *   • `override` — staff edited this field in the Layout view. Preserved
 *                  on rebind so writer markdown edits never clobber
 *                  designer polish.
 *   • `default`  — the template required a value and the IR didn't
 *                  supply one, so the template's placeholder filled in.
 *                  Visible as "needs content" in the Text view gutter.
 *   • `unbound`  — the template required a value, the IR didn't supply
 *                  one, and no placeholder exists. Loud failure: the
 *                  section can't render this slot without help.
 *
 * The two load-bearing operations are:
 *
 *   • `applyOverridesOnRebind(prev, fresh)` — merge a fresh bind's
 *     field_values + field_provenance with the section's current
 *     state, keeping any `override`d fields intact.
 *
 *   • `markOverride(provenance, fieldKey, actor)` — flip a field's
 *     source to `override` when staff edits it in the Layout view.
 *
 * Path syntax for `ir_path` mirrors what `webContentDocument.resolveIrPath`
 * understands — node-id-anchored, e.g.
 *   "blocks{node_id=heading:welcome-x7q}.text"
 */

import type { FieldProvenance, FieldProvenanceMap, WebContentTemplate } from '../types/database'
import { buildBlockIrPath, type BindProvenanceMap, type BindTrace } from './webContentDocument'

// ── Construction helpers ──────────────────────────────────────────────

/** Tag a field as auto-bound from the IR. Accepts either a bare
 *  `ir_path` string (legacy callers) or a `BindTrace` from the binder
 *  carrying `ir_node_id` + `ir_kind` + `ir_text_snippet` — the latter
 *  populates inspector display fields and lets "reset to text" refresh a
 *  single field from the IR without re-running the whole bind.
 *
 *  A field can still be tagged `auto` with no trace at all (zero-arg
 *  call) — the rebind cycle just won't be able to surface the source
 *  block for it. Used by legacy paths that haven't been wired through
 *  the trace map yet. */
export function auto(traceOrPath?: BindTrace | string): FieldProvenance {
  if (!traceOrPath) return { source: 'auto' }
  if (typeof traceOrPath === 'string') {
    return { source: 'auto', ir_path: traceOrPath }
  }
  const trace = traceOrPath
  const out: FieldProvenance = { source: 'auto' }
  if (trace.ir_node_id)     out.ir_path        = buildBlockIrPath(trace.ir_node_id)
  if (trace.ir_kind)        out.ir_kind        = trace.ir_kind
  if (trace.ir_text_snippet) out.ir_text_snippet = trace.ir_text_snippet
  return out
}

/** Tag a field as template-default (no IR source, placeholder used). */
export function defaultProvenance(): FieldProvenance {
  return { source: 'default' }
}

/** Tag a field as required-but-unbound (template wanted a value, IR
 *  had nothing, no placeholder available). Surface in the Text view
 *  coverage gutter so staff sees the loud failure. */
export function unbound(): FieldProvenance {
  return { source: 'unbound' }
}

/** Tag a field as a staff override. Records who + when so the audit
 *  log can show "edited 2026-05-29 by ashley@cms". */
export function override(actor?: string): FieldProvenance {
  return {
    source: 'override',
    override_at: new Date().toISOString(),
    override_by: actor ?? null as unknown as string | undefined,
  }
}

// ── Override-preserving merge (the round-trip primitive) ──────────────

export interface ProvenanceMergeInput {
  /** The fresh bind's outputs — what the fitter just produced. */
  fresh_field_values: Record<string, unknown>
  fresh_provenance:   FieldProvenanceMap
  /** Current persisted state for the section. */
  current_field_values: Record<string, unknown>
  current_provenance:   FieldProvenanceMap | null
}

export interface ProvenanceMergeResult {
  field_values:     Record<string, unknown>
  field_provenance: FieldProvenanceMap
  /** Field keys whose `override` value was kept (i.e. the fresh bind
   *  wanted to set a different value but staff polish won). For the
   *  Text view coverage gutter: "3 fields are pinned overrides." */
  preserved_overrides: string[]
}

/**
 * Merge a fresh bind into the section's persisted state, preserving any
 * field whose current provenance is `override`. This is the routine
 * that runs every time markdown is re-parsed + re-bound.
 *
 * Rules:
 *   1. If `current_provenance[key].source === 'override'` → keep current value + provenance.
 *   2. Otherwise → take fresh value + provenance (auto / default / unbound).
 *   3. Fields present in current but not in fresh → drop (template changed shape).
 *   4. Fields present in fresh but not in current → add as fresh.
 */
export function applyOverridesOnRebind(input: ProvenanceMergeInput): ProvenanceMergeResult {
  const { fresh_field_values, fresh_provenance, current_field_values, current_provenance } = input
  const out_values: Record<string, unknown> = {}
  const out_provenance: FieldProvenanceMap = {}
  const preserved: string[] = []

  for (const [key, freshValue] of Object.entries(fresh_field_values)) {
    const currentProv = current_provenance?.[key]
    if (currentProv?.source === 'override') {
      out_values[key]     = current_field_values[key]
      out_provenance[key] = currentProv
      preserved.push(key)
    } else {
      out_values[key]     = freshValue
      out_provenance[key] = fresh_provenance[key] ?? defaultProvenance()
    }
  }
  return { field_values: out_values, field_provenance: out_provenance, preserved_overrides: preserved }
}

// ── Staff-edit operations ─────────────────────────────────────────────

/** Flip a field to `override` when staff edits it in the Layout view.
 *  Returns a NEW provenance map so callers can persist atomically. */
export function markOverride(
  provenance: FieldProvenanceMap | null,
  fieldKey: string,
  actor?: string,
): FieldProvenanceMap {
  const next = { ...(provenance ?? {}) }
  next[fieldKey] = override(actor)
  return next
}

/** Reset a field from `override` back to `auto` so the next rebind will
 *  refresh it from the IR. Requires the IR path the field was originally
 *  auto-bound from, so the resolver knows where to re-read. */
export function resetToAuto(
  provenance: FieldProvenanceMap | null,
  fieldKey: string,
  ir_path: string,
): FieldProvenanceMap {
  const next = { ...(provenance ?? {}) }
  next[fieldKey] = auto(ir_path)
  return next
}

// ── Coverage summary (drives the Text view gutter) ────────────────────

export interface CoverageSummary {
  /** Total declared slots on the bound template. 0 when no template
   *  is bound (freehand section). The denominator the writer cares about:
   *  "of all the slots this layout has, how many are filled?" */
  declared: number
  /** Slots that carry meaningful content (auto + override). The "X" in
   *  "X of Y filled". */
  filled: number
  /** Slots the writer's text populated. */
  auto: number
  /** Slots staff edited in the Layout view — preserved on next rebind. */
  override: number
  /** Slots holding a template placeholder (no IR source supplied). */
  default: number
  /** Required slots the template wants but nothing bound to — loud
   *  failure for the Text view gutter. */
  unbound: number
  /** Declared slots with no provenance entry yet — the section's layout
   *  expects content here but nothing has been written for them. */
  empty: number
}

// ── Derivation from a bind result ─────────────────────────────────────

/** Build a FieldProvenanceMap from the output of `bindDocumentToTemplate`.
 *
 *  For each slot the template declares:
 *    • populated in field_values → tag `auto`. If the binder supplied a
 *      `BindTrace` for this slot via `bindTraces`, the entry carries the
 *      source IR `ir_path` / `ir_kind` / `ir_text_snippet` so the
 *      inspector can show the source block and "reset to text" can
 *      refresh just this field.
 *    • required by template but unpopulated → tag `unbound`
 *    • optional + unpopulated → omit (no entry; downstream code treats
 *      a missing entry as "no provenance, treat like auto on rebind")
 *
 *  Reads only the top-level slot keys on the template. Nested item
 *  schemas (cards / faq items / etc.) bind to one container field key
 *  whose presence we tag; per-item provenance is a future slice.
 */
export function deriveProvenanceFromBind(
  fieldValues: Record<string, unknown>,
  template:    Pick<WebContentTemplate, 'fields'> | null,
  bindTraces?: BindProvenanceMap,
): FieldProvenanceMap {
  const out: FieldProvenanceMap = {}
  if (!template?.fields) return out
  for (const f of template.fields) {
    if (!f || typeof (f as { key?: unknown }).key !== 'string') continue
    const key = (f as { key: string }).key
    if (isFieldPopulated(fieldValues[key])) {
      const trace = bindTraces?.[key]
      out[key] = trace ? auto(trace) : auto()
    } else if ((f as { required?: boolean }).required) {
      out[key] = unbound()
    }
  }
  return out
}

/** True if a slot value is meaningful (would render something). Mirrors
 *  the populated check in webBindTelemetry — duplicated locally to keep
 *  this module's dependency graph flat. */
function isFieldPopulated(v: unknown): boolean {
  if (v == null) return false
  if (typeof v === 'string') return v.trim() !== ''
  if (Array.isArray(v))      return v.length > 0
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if ('label' in o || 'url' in o) return Boolean(o.label || o.url)
    if ('items' in o)               return Array.isArray(o.items) && o.items.length > 0
    return Object.keys(o).length > 0
  }
  return Boolean(v)
}

/** A slot the writer can fill from the Text view. Images and maps
 *  default to the Brixies starter — the writer has no path to
 *  contribute these here, so they don't count toward "X of Y filled"
 *  and don't appear in the bind inspector. Groups always count because
 *  their nested items often include writer-contributable text. */
export function isWriterContributableField(field: unknown): boolean {
  if (!field || typeof field !== 'object') return false
  const f = field as { kind?: string; type?: string; key?: string }
  if (typeof f.key !== 'string') return false
  if (f.kind === 'group') return true
  if (f.kind === 'slot') {
    return f.type !== 'image' && f.type !== 'map'
  }
  return false
}

/** Compute a one-section summary the Text view gutter + inspector read.
 *  Pass the template to get a true "X of Y filled" — without it we fall
 *  back to provenance-only counts (caller knows it's a freehand section).
 *  Image/map slots are excluded; writers can't contribute those at this
 *  stage. */
export function summarizeCoverage(
  provenance: FieldProvenanceMap | null,
  template?: { fields?: ReadonlyArray<unknown> } | null,
): CoverageSummary {
  // Build the set of writer-relevant slot keys so we filter both the
  // declared count AND the provenance buckets consistently. Skipping
  // image/map slots without filtering provenance would over-count
  // 'default' entries the binder writes for image placeholders.
  let relevantKeys: Set<string> | null = null
  if (Array.isArray(template?.fields)) {
    relevantKeys = new Set()
    for (const f of template!.fields!) {
      if (isWriterContributableField(f)) {
        relevantKeys.add((f as { key: string }).key)
      }
    }
  }

  let auto = 0, ov = 0, def = 0, un = 0
  if (provenance) {
    for (const [key, entry] of Object.entries(provenance)) {
      if (relevantKeys && !relevantKeys.has(key)) continue
      if (entry.source === 'auto')          auto++
      else if (entry.source === 'override') ov++
      else if (entry.source === 'default')  def++
      else if (entry.source === 'unbound')  un++
    }
  }
  const provCount = auto + ov + def + un
  const declared  = relevantKeys?.size ?? provCount
  const empty     = Math.max(0, declared - provCount)
  return {
    declared,
    filled: auto + ov,
    auto,
    override: ov,
    default: def,
    unbound: un,
    empty,
  }
}

