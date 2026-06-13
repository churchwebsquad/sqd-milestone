/**
 * Stage_1 shape normalizer.
 *
 * The cowork pipeline reads `stage_1` from two possible producers:
 *
 *   1. run-synthesize-strategy (cowork) — emits cowork-shape fields
 *      directly (ethos_summary, persuasive_posture_by_persona, etc.).
 *
 *   2. The legacy 8-stage pipeline's extract-strategy.ts — emits a
 *      similar-but-differently-named shape. Field-name drift only;
 *      content is equivalent (often richer because the legacy version
 *      worked from the original prose sources, not just atoms).
 *
 * Cowork endpoints that read stage_1 (run-outline-page, run-draft-
 * page, run-critique-page) all do the same 5-field projection into
 * the user message. Without normalization, projects with only a
 * legacy stage_1 (every pre-cowork account — DS being the first
 * pilot) would project undefined into 2 of the 5 fields:
 *
 *   - ethos_summary             — drives dignity-floor signal
 *   - persuasive_posture_by_persona — drives reassure-section guidance
 *
 * Surfaced 2026-06-12 during the DS pilot prep: the legacy stage_1's
 * `voice_characteristics.description` is the ethos statement, just
 * under a different field name. `personas[].message` is the persuasive
 * posture, just per-persona instead of in a map. Two field renames
 * (voice_exemplars[].why_exemplar → why_it_works,
 * voice_anti_exemplars[].pattern → phrase) round it out.
 *
 * This helper normalizes legacy → cowork shape WITHOUT mutating the
 * stored row. Cowork endpoints call it before projecting. Legacy
 * provenance stays pristine; the read layer adapts.
 *
 * Compatibility decision: ADD cowork-shape keys without removing
 * legacy keys. Old keys still resolve (the model in the user message
 * sees both shapes); new keys also resolve. Safe for both pipelines.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

/** The 5 cowork-shape fields that downstream endpoints project from
 *  stage_1 into the user message. All optional on the result because
 *  the normalizer can't conjure data that isn't there — but every
 *  legacy stage_1 we've inspected has equivalent inputs for all 5. */
export interface NormalizedStage1 {
  ethos_summary?:                 string
  personas?:                      Array<{
    name?:                 string
    bio_one_line?:         string
    desire?:               string
    barrier?:              string
    likely_entry_points?:  string[]
    [key: string]:         unknown
  }>
  voice_exemplars?:               Array<{
    phrase?:        string
    source?:        string
    why_it_works?:  string
    [key: string]:  unknown
  }>
  voice_anti_exemplars?:          Array<{
    phrase?:         string
    source?:         string
    why_it_breaks?:  string
    [key: string]:   unknown
  }>
  persuasive_posture_by_persona?: Record<string, string>
  /** Everything else from the source stage_1 passes through unchanged. */
  [key: string]: unknown
}

export function normalizeStage1ForCowork(stage_1: unknown): NormalizedStage1 | null {
  if (!stage_1 || typeof stage_1 !== 'object') return null
  const s1 = stage_1 as Record<string, any>

  // ethos_summary — prefer explicit cowork field; fall back to legacy
  // voice_characteristics.description (ethos posture statement).
  const ethos_summary: string =
    typeof s1.ethos_summary === 'string'
      ? s1.ethos_summary
      : typeof s1.voice_characteristics?.description === 'string'
        ? s1.voice_characteristics.description
        : ''

  // personas — preserve every legacy key + add cowork-shape mappings.
  const personas: NormalizedStage1['personas'] = Array.isArray(s1.personas)
    ? s1.personas.map((p: any) => ({
        ...p,
        name:                p.name ?? '',
        bio_one_line:        p.bio_one_line ?? p.description ?? '',
        desire:              p.desire ?? p.goals ?? '',
        barrier:             p.barrier ?? p.challenges ?? '',
        // Legacy doesn't carry likely_entry_points; allocation is the
        // authority for per-page routing anyway. Empty array keeps the
        // schema shape consistent.
        likely_entry_points: Array.isArray(p.likely_entry_points) ? p.likely_entry_points : [],
      }))
    : []

  // voice_exemplars — field rename: why_exemplar → why_it_works.
  const voice_exemplars: NormalizedStage1['voice_exemplars'] = Array.isArray(s1.voice_exemplars)
    ? s1.voice_exemplars.map((e: any) => ({
        ...e,
        phrase:       e.phrase ?? '',
        source:       e.source ?? '',
        why_it_works: e.why_it_works ?? e.why_exemplar ?? '',
      }))
    : []

  // voice_anti_exemplars — legacy shape is { kind, pattern, why_avoid };
  // cowork is { phrase, source, why_it_breaks }. Map pattern → phrase,
  // kind → source (lacking a better signal), why_avoid → why_it_breaks.
  const voice_anti_exemplars: NormalizedStage1['voice_anti_exemplars'] = Array.isArray(s1.voice_anti_exemplars)
    ? s1.voice_anti_exemplars.map((e: any) => ({
        ...e,
        phrase:        e.phrase ?? e.pattern ?? '',
        source:        e.source ?? e.kind ?? '',
        why_it_breaks: e.why_it_breaks ?? e.why_avoid ?? '',
      }))
    : []

  // persuasive_posture_by_persona — prefer explicit cowork map; fall
  // back to constructing from legacy personas[].message.
  const persuasive_posture_by_persona: Record<string, string> = {}
  if (s1.persuasive_posture_by_persona && typeof s1.persuasive_posture_by_persona === 'object') {
    for (const [k, v] of Object.entries(s1.persuasive_posture_by_persona as Record<string, unknown>)) {
      if (typeof v === 'string') persuasive_posture_by_persona[k] = v
    }
  }
  if (Object.keys(persuasive_posture_by_persona).length === 0 && Array.isArray(s1.personas)) {
    for (const p of s1.personas as Array<any>) {
      if (typeof p?.name === 'string' && typeof p?.message === 'string') {
        persuasive_posture_by_persona[p.name] = p.message
      }
    }
  }

  return {
    ...s1,
    ethos_summary,
    personas,
    voice_exemplars,
    voice_anti_exemplars,
    persuasive_posture_by_persona,
  }
}
