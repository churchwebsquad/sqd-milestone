// Per-section schema classifier (content diagnosis, v1.5).
//
// Reads the analyzed section data (page slug, heading, section_role,
// items projected on schema) and emits a canonical schema_name from
// the vocabulary in rules.ts (CANONICAL_SCHEMAS) + field-level
// diagnostics + CTA breakdown + build-time-issue flags.
//
// V1: rules-only, sync. Scores each candidate schema by signal count
// (page_slug + section_role + heading words + item count + field
// presence) minus discriminator penalty. Highest score above the
// threshold wins. When nothing crosses the threshold, schema_name
// stays null — the handoff shows the raw field keys but no canonical
// label (better than misclassifying).
//
// V2 (deferred): LLM fallback (Haiku 4.5, structured output) called
// for null-classification sections, post-pass.

import type { SectionRole } from '../../types/database'
import { CANONICAL_SCHEMAS, type SchemaSpec } from './rules'
import type { Confidence, DiagnosedCtaKind, DiscoverySection, SchemaName } from './types'

/** Input to the classifier. Caller builds this from the analyzed
 *  section data — see emit.ts buildDiscoverySections. */
export interface ClassifyContext {
  page_slug:            string
  heading:              string
  section_role:         SectionRole | null
  /** Full items array projected onto the section's schema (every item
   *  has every schema field as a key, value or null/empty). The
   *  classifier walks these to compute fill rates + discriminator
   *  matches + CTA targets. */
  items:                Array<Record<string, unknown>>
  /** Field keys the BOUND template actually carries slots for. Used
   *  to flag dropped fields (schema has more than template can hold). */
  template_field_keys:  string[]
  /** Bound template id — used in build_time_issues entries so the
   *  squad knows which template needs expansion. */
  template_id:          string
  /** Layer 1's CPT routing for this section, when present. Lets the
   *  classifier short-circuit to the canonical schema implied by the
   *  CPT slug (wp_object.staff → person_card, wp_object.event →
   *  event_card, …). Bypasses the rules-scoring path entirely. */
  cpt_subroutine_ref?:  string | null
}

/** Map from CPT subroutine ref (Layer 1 output) to canonical schema.
 *  When Layer 1 routes a section to a CPT, the schema is implied —
 *  no need for the rules-scoring path to re-derive it. */
const CPT_REF_TO_SCHEMA: Record<string, SchemaName> = {
  'wp_object.staff':  'person_card',
  'wp_object.event':  'event_card',
  'wp_object.sermon': 'sermon_card',
  'wp_object.post':   'blog_post_card',
  'wp_object.group':  'group_card',
  'wp_object.career': 'career_card',
}

/** Result of one section's diagnosis. Merged into DiscoverySection by
 *  the caller. */
export interface ClassifyResult {
  schema_name:              SchemaName | null
  schema_confidence:        Confidence
  schema_field_diagnostics: NonNullable<DiscoverySection['schema_field_diagnostics']>
  cta_target_breakdown:     NonNullable<DiscoverySection['cta_target_breakdown']>
  build_time_issues:        NonNullable<DiscoverySection['build_time_issues']>
  /** Per-schema candidate scores, exposed for debugging. Not surfaced
   *  in the handoff or UI. */
  _debug_scores?:           Array<{ schema: SchemaName; score: number; reasons: string[] }>
}

const MIN_HIGH_CONFIDENCE_SCORE   = 4
const MIN_MEDIUM_CONFIDENCE_SCORE = 3
const MIN_LOW_CONFIDENCE_SCORE    = 2
/** Below this, schema_name = null (the classifier won't guess). */
const CLASSIFICATION_THRESHOLD    = MIN_LOW_CONFIDENCE_SCORE
const DISCRIMINATOR_PENALTY       = 3

/** Brixies slot keys that semantically carry canonical schema field
 *  values. `name`/`title` flow to a card's `heading_card` slot; the
 *  data IS in the bound template even though the slot key differs.
 *  Used by the in_bound_template check so we don't false-flag fields
 *  as dropped when they're just under a differently-named slot. */
const BRIXIES_SLOT_ALIASES: Record<string, readonly string[]> = {
  name:        ['heading_card', 'primary_heading', 'heading', 'title'],
  title:       ['heading_card', 'primary_heading', 'heading', 'name'],
  description: ['description_card', 'body', 'subtitle'],
  body:        ['description_card', 'description', 'body_card'],
  cta_url:     ['url', 'button_url', 'link_url', 'action_url'],
  cta_label:   ['label', 'button_label', 'link_label'],
}

export function classifySchema(ctx: ClassifyContext, opts?: { debug?: boolean }): ClassifyResult {
  const heading_lower  = ctx.heading.toLowerCase()
  const page_slug_lower= ctx.page_slug.toLowerCase()
  const itemKeys       = collectItemKeys(ctx.items)

  // ── CPT-bound short-circuit ─────────────────────────────────────────
  // When Layer 1 has already routed this section to a CPT, the schema
  // is implied. Skip the rules-scoring path entirely.
  if (ctx.cpt_subroutine_ref && CPT_REF_TO_SCHEMA[ctx.cpt_subroutine_ref]) {
    const forced = CPT_REF_TO_SCHEMA[ctx.cpt_subroutine_ref]
    const diagnostics = buildFieldDiagnostics(forced, ctx)
    return {
      schema_name:              forced,
      schema_confidence:        'high',
      schema_field_diagnostics: diagnostics,
      cta_target_breakdown:     computeCtaBreakdown(ctx.items),
      build_time_issues:        deriveBuildTimeIssues(forced, diagnostics, ctx),
      ...(opts?.debug ? { _debug_scores: [{ schema: forced, score: 99, reasons: ['cpt_ref=' + ctx.cpt_subroutine_ref] }] } : {}),
    }
  }

  // ── Score every candidate schema ────────────────────────────────────
  const scores: Array<{ schema: SchemaName; score: number; reasons: string[] }> = []
  for (const [name, spec] of Object.entries(CANONICAL_SCHEMAS) as Array<[SchemaName, SchemaSpec]>) {
    const reasons: string[] = []
    let score = 0

    // Signal 1: page slug substring match
    if (spec.page_slug_signals.some(sig => page_slug_lower.includes(sig))) {
      score += 1
      reasons.push('page_slug')
    }

    // Signal 2: section_role match
    if (ctx.section_role && spec.section_role_signals.includes(ctx.section_role)) {
      score += 1
      reasons.push('section_role')
    }

    // Signal 3: heading-word substring match
    if (spec.heading_word_signals.some(w => heading_lower.includes(w))) {
      score += 1
      reasons.push('heading_word')
    }

    // Signal 4: item count within typical range
    if (spec.typical_item_count) {
      const [min, max] = spec.typical_item_count
      if (ctx.items.length >= min && ctx.items.length <= max) {
        score += 1
        reasons.push('item_count')
      }
    }

    // Signal 5: canonical field presence (any 2+ canonical fields
    // appear as item keys — including via aliases).
    const canonicalMatchCount = countCanonicalFieldMatches(itemKeys, spec)
    if (canonicalMatchCount >= 2) {
      score += 1
      reasons.push(`canonical_fields=${canonicalMatchCount}`)
    }

    // Discriminator penalty: if the schema declares discriminators AND
    // none appear in any item, heavily downweight. feature_card has
    // no discriminators (it's the catch-all) — skip the penalty there.
    if (spec.discriminator_fields.length > 0) {
      const hasAnyDiscriminator = spec.discriminator_fields.some(
        d => itemKeys.has(d) || hasFieldViaAlias(itemKeys, d, spec)
      )
      if (!hasAnyDiscriminator) {
        score -= DISCRIMINATOR_PENALTY
        reasons.push(`-discriminator_missing`)
      }
    }

    scores.push({ schema: name, score, reasons })
  }

  // Sort: highest score first; ties broken by schema name for determinism.
  scores.sort((a, b) => (b.score - a.score) || a.schema.localeCompare(b.schema))

  // ── Pick winner ─────────────────────────────────────────────────────
  const top = scores[0]
  let schema_name:      SchemaName | null = null
  let schema_confidence: Confidence       = 'low'

  if (top && top.score >= CLASSIFICATION_THRESHOLD) {
    schema_name = top.schema
    schema_confidence =
      top.score >= MIN_HIGH_CONFIDENCE_SCORE   ? 'high'   :
      top.score >= MIN_MEDIUM_CONFIDENCE_SCORE ? 'medium' :
                                                 'low'
  }

  const schema_field_diagnostics = buildFieldDiagnostics(schema_name, ctx)
  const cta_target_breakdown     = computeCtaBreakdown(ctx.items)
  const build_time_issues        = schema_name
    ? deriveBuildTimeIssues(schema_name, schema_field_diagnostics, ctx)
    : []

  return {
    schema_name,
    schema_confidence,
    schema_field_diagnostics,
    cta_target_breakdown,
    build_time_issues,
    ...(opts?.debug ? { _debug_scores: scores } : {}),
  }
}

function buildFieldDiagnostics(
  schema_name: SchemaName | null,
  ctx: ClassifyContext,
): NonNullable<DiscoverySection['schema_field_diagnostics']> {
  const itemKeys = collectItemKeys(ctx.items)
  const fieldsToDiagnose = schema_name
    ? CANONICAL_SCHEMAS[schema_name].canonical_fields
    : Array.from(itemKeys)
  return fieldsToDiagnose.map(key => {
    const spec = schema_name ? CANONICAL_SCHEMAS[schema_name] : null
    const schemaAliases  = spec?.field_aliases?.[key] ?? []
    const brixiesAliases = BRIXIES_SLOT_ALIASES[key] ?? []
    const allAliases = [...schemaAliases, ...brixiesAliases]
    let fill_count = 0
    for (const item of ctx.items) {
      if (isNonEmpty(item[key])) { fill_count++; continue }
      let matched = false
      for (const alias of allAliases) {
        if (isNonEmpty(item[alias])) { matched = true; break }
      }
      if (matched) fill_count++
    }
    const in_bound_template =
      ctx.template_field_keys.includes(key) ||
      allAliases.some(a => ctx.template_field_keys.includes(a)) ||
      isFlattenedFromTemplateKey(key, ctx.template_field_keys) ||
      allAliases.some(a => isFlattenedFromTemplateKey(a, ctx.template_field_keys))
    return { key, fill_count, fill_total: ctx.items.length, in_bound_template }
  })
}

/** projectItemOntoSchema flattens nested CTA objects, so a template
 *  slot `contact: {label, url}` becomes `contact_label` + `contact_url`
 *  in the projected item. Those flattenings aren't separate template
 *  slots — they belong to the original `contact` slot. Recognize the
 *  suffix and resolve to the base slot. */
function isFlattenedFromTemplateKey(key: string, templateFieldKeys: string[]): boolean {
  for (const suffix of ['_label', '_url', '_kind', '_target']) {
    if (!key.endsWith(suffix)) continue
    const base = key.slice(0, -suffix.length)
    if (templateFieldKeys.includes(base)) return true
  }
  return false
}

function deriveBuildTimeIssues(
  schema_name: SchemaName,
  diagnostics: NonNullable<DiscoverySection['schema_field_diagnostics']>,
  ctx: ClassifyContext,
): NonNullable<DiscoverySection['build_time_issues']> {
  // Surface dropped fields ONLY when at least one item has data in a
  // field the bound template can't hold. "Field exists in schema but
  // empty across every item" isn't a build-time issue (it's a field
  // the partner didn't fill).
  void schema_name
  const droppedWithData = diagnostics
    .filter(d => !d.in_bound_template && d.fill_count > 0)
    .map(d => d.key)
  if (droppedWithData.length === 0) return []
  const totalDroppedFills = diagnostics
    .filter(d => droppedWithData.includes(d.key))
    .reduce((sum, d) => sum + d.fill_count, 0)
  const totalPossible = droppedWithData.length * Math.max(1, ctx.items.length)
  const fillFraction  = totalDroppedFills / totalPossible
  const severity: 'high' | 'medium' | 'low' =
    fillFraction >= 0.5 ? 'high'   :
    fillFraction >= 0.2 ? 'medium' :
                          'low'
  return [{
    kind:           'library_coverage_gap',
    template_id:    ctx.template_id,
    dropped_fields: droppedWithData,
    severity,
  }]
}

// ── Helpers ───────────────────────────────────────────────────────────

function collectItemKeys(items: Array<Record<string, unknown>>): Set<string> {
  const keys = new Set<string>()
  for (const item of items) for (const k of Object.keys(item)) keys.add(k)
  return keys
}

function countCanonicalFieldMatches(itemKeys: Set<string>, spec: SchemaSpec): number {
  let count = 0
  for (const f of spec.canonical_fields) {
    if (itemKeys.has(f)) { count++; continue }
    const schemaAliases  = spec.field_aliases?.[f] ?? []
    const brixiesAliases = BRIXIES_SLOT_ALIASES[f] ?? []
    if (schemaAliases.some(a => itemKeys.has(a))) { count++; continue }
    if (brixiesAliases.some(a => itemKeys.has(a))) count++
  }
  return count
}

function hasFieldViaAlias(itemKeys: Set<string>, field: string, spec: SchemaSpec): boolean {
  for (const [canonical, aliases] of Object.entries(spec.field_aliases ?? {})) {
    if (canonical === field && (aliases as readonly string[]).some(a => itemKeys.has(a))) return true
    if ((aliases as readonly string[]).includes(field) && itemKeys.has(canonical)) return true
  }
  return false
}

function isNonEmpty(v: unknown): boolean {
  if (v == null) return false
  if (typeof v === 'string') return v.trim().length > 0
  if (Array.isArray(v))      return v.length > 0
  if (typeof v === 'object') return Object.keys(v as object).length > 0
  return true
}

/** Walk items, classify each CTA url into a DiagnosedCtaKind, count. */
function computeCtaBreakdown(items: Array<Record<string, unknown>>): NonNullable<DiscoverySection['cta_target_breakdown']> {
  const counts: Partial<Record<DiagnosedCtaKind, number>> = {}
  for (const item of items) {
    const urls = collectCtaUrls(item)
    if (urls.length === 0) {
      counts.no_link = (counts.no_link ?? 0) + 1
      continue
    }
    // Count each distinct kind once per item (don't double-count when
    // an item has two CTAs of the same kind).
    const kindsThisItem = new Set<DiagnosedCtaKind>()
    for (const url of urls) kindsThisItem.add(classifyCtaUrl(url))
    for (const k of kindsThisItem) counts[k] = (counts[k] ?? 0) + 1
  }
  return counts
}

/** Pull any URL-shaped strings from an item. Looks at common CTA keys
 *  (cta_url, url, action_url, link) and any flat key ending in _url. */
function collectCtaUrls(item: Record<string, unknown>): string[] {
  const urls: string[] = []
  for (const [k, v] of Object.entries(item)) {
    if (typeof v !== 'string') continue
    if (k === 'cta_url' || k === 'url' || k === 'action_url' || k === 'link' || k.endsWith('_url')) {
      const t = v.trim()
      if (t) urls.push(t)
    }
  }
  return urls
}

function classifyCtaUrl(url: string): DiagnosedCtaKind {
  const u = url.trim()
  if (u.startsWith('mailto:'))                 return 'mailto'
  if (u.startsWith('tel:'))                    return 'tel'
  if (u.startsWith('#'))                       return 'anchor'
  if (u.startsWith('/'))                       return 'internal_route'
  // File downloads — heuristic on extension.
  if (/\.(pdf|docx?|xlsx?|pptx?|zip|csv)(\?|$)/i.test(u)) return 'file_download'
  // Form signals — common signup hosts + ChurchCenter people/forms.
  if (/churchcenter\.com\/people\/forms/i.test(u))            return 'signup_form'
  if (/formstack\.com|jotform\.com|docs\.google\.com\/forms/i.test(u)) return 'signup_form'
  if (/^https?:/i.test(u))                     return 'external_url'
  return 'no_link'
}
