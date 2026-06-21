/**
 * Provenance model — every computed field in the planning UI carries
 * a badge that says where its value came from. Surfaces in a small
 * "auto" / "manual" chip with a hover tooltip explaining the source.
 *
 * Trust grows when the user can verify *why* a number is what it is.
 * The four-signal consolidator + the projection math both produce
 * values that look identical to manual entries; without provenance,
 * users can't tell which is which.
 */

export type ProvenanceMode = 'auto' | 'manual' | 'mixed' | 'fallback'

export interface Provenance {
  mode: ProvenanceMode
  /** Where the value came from. Strategist-language. */
  sourceLabel: string
  /** Optional ISO timestamp of when this provenance was established
   *  (e.g. when the manual override was set, or when the auto
   *  computation last ran). */
  asOf?: string
  /** Optional longer explanation rendered in a hover/tooltip. */
  detail?: string
}

export function autoFrom(sourceLabel: string, asOf?: string, detail?: string): Provenance {
  return { mode: 'auto', sourceLabel, asOf, detail }
}

export function manualBy(employeeId: string | null, asOf: string | null, detail?: string): Provenance {
  return {
    mode: 'manual',
    sourceLabel: employeeId ? `Set by ${employeeId}` : 'Manual override',
    asOf: asOf ?? undefined,
    detail,
  }
}

export function fallback(label: string, detail?: string): Provenance {
  return { mode: 'fallback', sourceLabel: label, detail }
}

export function mixedFrom(parts: Array<{ label: string; mode?: ProvenanceMode }>): Provenance {
  return {
    mode: 'mixed',
    sourceLabel: parts.map(p => p.label).join(' + '),
    detail: parts.map(p => `${p.mode ?? 'auto'}: ${p.label}`).join('; '),
  }
}
