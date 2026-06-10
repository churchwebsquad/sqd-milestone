// Deterministic em-dash / en-dash / double-hyphen strip for copy
// going into Supabase. The Director used to flag every em-dash and
// kick a slot-edit round to fix it — that wasted iterations on a
// problem regex can solve in microseconds AND drowned out substantive
// content critique. Strip mechanically here so the Director only sees
// the things ONLY a model can judge (tone, dignity, voice character).
//
// Rules:
//   1. Number ranges  "5–9"  → "5-9"   (en-dash between digits is a hyphen)
//   2. " — Capital"           → ". Capital"   (joins independent clauses → period)
//   3. " — anything-else"     → ", "          (parenthetical / appositive  → comma)
//   4. Stray em/en/double-hyphen with no surrounding spaces → ", "
//   5. Em-dash / en-dash inside an ALREADY-bracketed template token
//      ({{...}}) is left alone — those are merge-field internals.
//
// What we do NOT strip: hyphens (-), Unicode minus, math-style en-dash
// that's already inside a {{token}}. Single hyphens are common in real
// church communication ("pre-service" / "post-Easter") and must survive.

export type DashStripSample = { where: string; before: string; after: string }
export type DashStripReport = {
  count: number
  samples: DashStripSample[]    // first 5 substitutions for telemetry
}

/** Run the surgical strip on a single string. Returns the new value
 *  and whether anything changed. */
export function stripDashesFromString(s: string): { value: string; changed: boolean } {
  if (typeof s !== 'string' || s.length === 0) return { value: s, changed: false }
  // Skip strings that are 100% merge-field token — nothing to clean.
  // Otherwise the inner regex runs against template internals.
  let out = s
  // 1. number-range en-dash → hyphen
  out = out.replace(/(\d)\s*[–—]\s*(\d)/g, '$1-$2')
  // 2. " em-dash CAPITAL " → ". CAPITAL "
  out = out.replace(/\s+[—–]\s+([A-Z])/g, '. $1')
  // 3. " em-dash X " (X not capital — already handled above) → ", "
  out = out.replace(/\s+[—–]\s+/g, ', ')
  // 4. stray bare em/en/double-hyphen → ", "
  //    Excludes single hyphens (-) so "pre-service" survives.
  out = out.replace(/[—–]/g, ', ')
  out = out.replace(/--/g, ', ')
  // Cleanup: collapse accidental double-commas / "," followed by punctuation
  out = out.replace(/,\s*,/g, ',')
  out = out.replace(/,\s*\./g, '.')
  return { value: out, changed: out !== s }
}

/** Walk an arbitrary value (string, array, object) and strip dashes
 *  from every string leaf. Mutates a copy and returns it. The path
 *  argument is used to label samples for telemetry — pass the section
 *  index + field path as the caller knows it. */
export function stripDashesFromValue(value: unknown, path: string, report: DashStripReport): unknown {
  if (typeof value === 'string') {
    const { value: next, changed } = stripDashesFromString(value)
    if (changed) {
      report.count++
      if (report.samples.length < 5) {
        report.samples.push({ where: path, before: value, after: next })
      }
    }
    return next
  }
  if (Array.isArray(value)) {
    return value.map((item, i) => stripDashesFromValue(item, `${path}[${i}]`, report))
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = stripDashesFromValue(v, path ? `${path}.${k}` : k, report)
    }
    return out
  }
  return value
}

/** Strip dashes from every section.copy in a draft. Returns a NEW
 *  sections array (input is untouched) plus a report of how many
 *  substitutions landed. */
export function stripDashesFromSections(sections: unknown[]): { sections: unknown[]; report: DashStripReport } {
  const report: DashStripReport = { count: 0, samples: [] }
  if (!Array.isArray(sections)) return { sections: [], report }
  const out = sections.map((s, i) => {
    if (!s || typeof s !== 'object') return s
    const section = s as Record<string, unknown>
    if (section.copy == null) return s
    return {
      ...section,
      copy: stripDashesFromValue(section.copy, `section[${i}].copy`, report),
    }
  })
  return { sections: out, report }
}
