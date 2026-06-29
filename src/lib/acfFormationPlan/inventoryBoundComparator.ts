// Inventory-vs-bound comparator (v1.6).
//
// Surfaces REAL upstream compression losses: fields that exist in
// `web_project_topics.items` (source inventory) but are absent from
// every bound section of the same schema. These are the losses
// caused by cowork's uniform 5-slot compression — invisible to a
// bound-layer-only diagnostic, but the dominant build-time issue in
// practice.
//
// The comparator runs AFTER both diagnostics:
//   1. Inventory diagnosis (buildInventoryDiscoverySections)
//   2. Bound diagnosis (buildDiscoverySections)
// and mutates the bound rows to add upstream_compression_loss
// entries to their build_time_issues array.

import type { DiscoverySection, SchemaName } from './types'
import type { InventoryDiscoveryRow } from './inventoryDiagnosis'
import { CANONICAL_SCHEMAS } from './rules'

/** Compare each inventory row against the bound rows of the same
 *  schema. Mutates bound rows to add upstream_compression_loss
 *  build_time_issues. Returns the list of losses for downstream
 *  consumers (build-time-errors.md emitter). */
export function compareInventoryToBound(
  inventoryRows: InventoryDiscoveryRow[],
  boundRows: DiscoverySection[],
): Array<{
  schema_name: SchemaName
  dropped_fields: string[]
  inventory_topic: string
  affected_section_ids: string[]
  severity: 'high' | 'medium' | 'low'
}> {
  const losses: Array<{
    schema_name: SchemaName
    dropped_fields: string[]
    inventory_topic: string
    affected_section_ids: string[]
    severity: 'high' | 'medium' | 'low'
  }> = []

  // Group bound rows by schema_name for efficient lookup.
  const boundBySchema = new Map<SchemaName, DiscoverySection[]>()
  for (const b of boundRows) {
    if (!b.schema_name) continue
    const list = boundBySchema.get(b.schema_name) ?? []
    list.push(b)
    boundBySchema.set(b.schema_name, list)
  }

  for (const inv of inventoryRows) {
    if (!inv.schema_name) continue
    const matchingBound = boundBySchema.get(inv.schema_name) ?? []
    if (matchingBound.length === 0) {
      // Inventory has this schema but NO bound section yet — that's a
      // missing-content gap, not a compression loss. The inventory
      // diagnostic surfaces this directly; nothing to attribute here.
      continue
    }

    // Find inventory fields populated in ≥ 1 item that the bound
    // rows have 0 fills for across ALL matching bound sections.
    const invFieldsPopulated = inv.schema_field_diagnostics
      ?.filter(d => d.fill_count > 0)
      .map(d => d.key) ?? []

    if (invFieldsPopulated.length === 0) continue

    // For each populated inventory field, check the bound coverage.
    const droppedFields: string[] = []
    for (const field of invFieldsPopulated) {
      const totalBoundFills = matchingBound.reduce((sum, b) => {
        const d = b.schema_field_diagnostics?.find(d => d.key === field)
        return sum + (d?.fill_count ?? 0)
      }, 0)
      if (totalBoundFills === 0) {
        droppedFields.push(field)
      }
    }
    if (droppedFields.length === 0) continue

    // Severity: high if a discriminator field is among the dropped;
    // medium if 2+ canonical fields dropped; low otherwise.
    const spec = CANONICAL_SCHEMAS[inv.schema_name]
    const droppedDiscriminator = spec.discriminator_fields.some(d => droppedFields.includes(d))
    const severity: 'high' | 'medium' | 'low' =
      droppedDiscriminator ? 'high' :
      droppedFields.length >= 2 ? 'medium' :
      'low'

    const affectedSectionIds = matchingBound.map(b => b.section_id)
    losses.push({
      schema_name:          inv.schema_name,
      dropped_fields:       droppedFields,
      inventory_topic:      inv.heading,
      affected_section_ids: affectedSectionIds,
      severity,
    })

    // Attach to each affected bound row's build_time_issues.
    for (const bound of matchingBound) {
      const issues = bound.build_time_issues ?? []
      issues.push({
        kind:                 'upstream_compression_loss',
        schema_name:          inv.schema_name,
        dropped_fields:       droppedFields,
        affected_section_ids: affectedSectionIds,
        severity,
      })
      bound.build_time_issues = issues
    }
  }

  return losses
}
