/**
 * Bind telemetry — record one row per section bind so we can answer
 * "which templates consistently drop content?" from aggregate data
 * instead of manual eyeballing. Single fire-and-forget entry point;
 * failures log but never block the caller (telemetry must never
 * cause a bind to fail).
 *
 * Written from:
 *   • webCopywriterOutput.importCopywriterPageOutput — bind_source='import'
 *   • PagesWorkspace.computeBindNextValues + applyBindPayload — bind_source='variant_swap'
 *
 * Read by future analytics surfaces (template-health dashboard, weekly
 * "binder hotspots" review). Schema in schema/v38_bind_telemetry.sql.
 */
import { supabase } from './supabase'
import type { WebContentTemplate, WebFieldDef } from '../types/database'
import type { ReconcileTelemetry } from './webBrixiesDoc'

export type BindSource = 'import' | 'variant_swap' | 'initial_bind'

export interface BindTelemetryRecord {
  web_section_id:  string
  web_project_id:  string
  bind_source:     BindSource
  template_id:     string
  palette_template_ids: string[]
  /** Top-level slot keys on the bound template that ended up populated.
   *  Computed by walking template.fields against final field_values. */
  matched_slot_keys:     string[]
  /** Source keys that landed in `__unmapped` (not visible in any slot). */
  unmapped_source_keys:  string[]
  /** Deep paths from computeDroppedDeepPaths — source leaves with no
   *  representation anywhere in the bound payload. */
  dropped_paths:         string[]
  used_shape_align:      boolean
  used_faq_inference:    boolean
  source_field_values_size_bytes?: number
  bind_duration_ms?:     number
  notes?:                string
}

/** Walk template fields against the final field_values and return the
 *  top-level slot/group keys that ended up populated. Used by the
 *  caller to fill matched_slot_keys at telemetry time. */
export function computeMatchedSlotKeys(
  template: WebContentTemplate | null,
  fieldValues: Record<string, unknown>,
): string[] {
  if (!template?.fields) return []
  const out: string[] = []
  for (const f of template.fields) {
    const v = fieldValues[f.key]
    if (isMeaningful(v)) out.push(f.key)
  }
  return out
}

function isMeaningful(v: unknown): boolean {
  if (v == null) return false
  if (typeof v === 'string') return v.trim() !== ''
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if ('label' in o || 'url' in o) return !!o.label || !!o.url
    if ('items' in o) {
      const items = (o as { items?: unknown }).items
      return Array.isArray(items) && items.length > 0
    }
    return Object.keys(o).length > 0
  }
  return Boolean(v)
}

/** Collect every group's `referenced_template_id` from a template's
 *  fields, deeply. Used by the recorder to capture which palette
 *  templates were in play for this bind. */
export function collectPaletteTemplateIds(fields: ReadonlyArray<WebFieldDef> | undefined): string[] {
  if (!Array.isArray(fields)) return []
  const out: string[] = []
  for (const f of fields) {
    if (f.kind === 'group' && f.item_template_ref && f.referenced_template_id) {
      out.push(f.referenced_template_id)
    }
    if (f.kind === 'group' && Array.isArray(f.item_schema)) {
      out.push(...collectPaletteTemplateIds(f.item_schema))
    }
  }
  return Array.from(new Set(out))
}

/** Build an empty ReconcileTelemetry sink suitable for passing into
 *  reconcileFieldValuesAcrossTemplates. Read after the bind to fill
 *  used_shape_align + used_faq_alias on the telemetry record. */
export function emptyReconcileTelemetry(): ReconcileTelemetry {
  return { used_shape_align: false, used_faq_alias: false, shape_align_target_keys: [] }
}

/** Fire-and-forget recorder. Errors are logged to the console but
 *  never propagated — bind correctness must not depend on telemetry
 *  write success. */
export async function recordBindTelemetry(record: BindTelemetryRecord): Promise<void> {
  try {
    const { error } = await supabase
      .from('web_bind_telemetry')
      .insert(record as never)
    if (error) {
      console.warn('[bind-telemetry] insert failed', error.message)
    }
  } catch (err) {
    console.warn('[bind-telemetry] threw', err)
  }
}
