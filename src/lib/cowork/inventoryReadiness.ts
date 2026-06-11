/**
 * Inventory Readiness Gate (P5).
 *
 * Before strategy stages launch on a project, the inventory needs to be
 * AUDIT-READY: dupes tagged, noise quarantined, PII flagged, coverage
 * gaps surfaced. Intake defects flow downstream uncaught otherwise —
 * the Paradox 99005 run surfaced four real failure modes (duplicate
 * mission atoms across strategy_brief + DQ, a 47KB crawl-noise topic
 * dominated by Squarespace boilerplate, an unpublishable personal cell
 * in church_facts, draft-vs-active atom status ambiguity).
 *
 * This module is a pure function — input is the project's loaded
 * inventory; output is a structured report. The Vercel endpoint at
 * `api/web/agents/inventory-readiness.ts` loads the inventory from
 * Supabase and calls this. The workspace UI surfaces the report and
 * gates "start cowork" on the strategist acknowledging blockers.
 */

import type { AtomTopic } from '../../types/coworkBundle'

// ─── Tunables ────────────────────────────────────────────────────────

/** Topics that count as a single "identity" — duplicates within ONE
 *  topic are signal (e.g. mission_statement appearing in both strategy
 *  brief and discovery questionnaire). Other topics tolerate dups —
 *  multiple personas / multiple voice samples are normal. */
const IDENTITY_TOPICS: ReadonlySet<AtomTopic> = new Set<AtomTopic>([
  'mission_statement', 'vision_statement', 'x_factor',
])

/** A crawl topic is "noise-suspect" when its total passage byte count
 *  exceeds this AND its topic_key is one of the catch-all buckets. */
const CRAWL_NOISE_BYTE_THRESHOLD = 30_000
const CRAWL_NOISE_TOPIC_KEYS: ReadonlySet<string> = new Set([
  'other', 'unknown', 'misc', 'misc_pages',
])

/** Templates / boilerplate substrings to scan for in noise candidates. */
const NOISE_TEMPLATE_MARKERS: readonly string[] = [
  'Imagine having a website',                  // Squarespace stock
  'site is currently being built',
  'powered by squarespace',
  'powered by wix',
  'Page not found',
  '404',
  'This page is under construction',
  'Coming soon',
  'Lorem ipsum',
]

/** US phone number heuristic. Stops short of full E.164 validation —
 *  the goal is "flag for review", not "must be valid". */
const PHONE_PATTERN = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/

/** The nine "must-have" page types for a church website. A coverage gap
 *  is a page type with ZERO contributing crawl topics OR content
 *  collection fields. Strategist sees this BEFORE strategy stages run
 *  so they can request more intake before paying for downstream LLM calls. */
const PAGE_TYPE_COVERAGE: ReadonlyArray<{ page_type: string; matches: readonly string[] }> = [
  { page_type: 'home',     matches: ['home', 'index'] },
  { page_type: 'visit',    matches: ['visit', 'plan_visit', 'new_here', 'planning'] },
  { page_type: 'kids',     matches: ['kids', 'children', 'family', 'paratots', 'preschool'] },
  { page_type: 'beliefs',  matches: ['beliefs', 'doctrine', 'theology', 'faith_statement'] },
  { page_type: 'about',    matches: ['about', 'leadership', 'staff', 'team', 'who_we_are', 'history'] },
  { page_type: 'give',     matches: ['give', 'giving', 'donate', 'tithe', 'generosity'] },
  { page_type: 'sermons',  matches: ['sermons', 'messages', 'teaching', 'podcasts'] },
  { page_type: 'events',   matches: ['events', 'calendar', 'happenings'] },
  { page_type: 'contact',  matches: ['contact', 'location_contact', 'address', 'directions'] },
]

// ─── Public types ────────────────────────────────────────────────────

export interface InventoryReadinessInput {
  /** content_atoms rows (or compact projection — only the columns we need). */
  pillars: Array<{
    id:           string
    topic:        AtomTopic | string
    body:         string
    status?:      string                 // 'draft' / 'active'
    source_kind?: string
    source_ref?:  string
    verbatim?:    boolean
    duplicate_of?: string | null         // already-tagged dups won't be re-flagged
  }>
  /** church_facts rows (compact). */
  facts: Array<{
    id:           string
    topic:        string
    data:         unknown                // JSONB; we grep the stringified version for PII
    status?:      string
    metadata?:    Record<string, unknown> | null
  }>
  /** web_project_topics rows (with passage byte totals — we don't pass
   *  the full passages[] arrays in for this gate). */
  crawl_topics: Array<{
    topic_key:        string
    topic_label?:     string
    coverage_status?: string
    passages_bytes:   number             // sum of stringified passage lengths
    item_count?:      number
    /** Optional sample of passage text the caller already loaded for
     *  noise detection. Pass a string concatenation of up to ~10KB so
     *  the template-marker scan can fire. */
    sample_text?:     string
  }>
  /** Content collection field keys present on the latest session. */
  content_collection_fields: string[]
}

export type ReadinessSeverity = 'blocker' | 'warning'

export type ReadinessIssueKind =
  | 'duplicate_atom'
  | 'crawl_noise_topic'
  | 'pii_flag_fact'
  | 'page_coverage_gap'
  | 'status_ambiguity'

export interface ReadinessIssue {
  kind:     ReadinessIssueKind
  severity: ReadinessSeverity
  detail:   string
  /** What the strategist should do about it. */
  suggested_fix?: string
  /** Row references so the workspace UI can deep-link to the offender. */
  rows?: Array<{ id: string; topic?: string; preview?: string }>
}

export interface InventoryReadinessReport {
  /** True only if ZERO blockers. Warnings don't block — strategist
   *  acknowledges them but cowork can still launch. */
  ok: boolean
  blockers: ReadinessIssue[]
  warnings: ReadinessIssue[]
  summary: {
    pillars_total:    number
    pillars_draft:    number
    facts_total:      number
    crawl_topics_total: number
    duplicates_found: number
    noise_topics_found: number
    pii_flags:        number
    coverage_gaps:    string[]
  }
}

// ─── Implementation ─────────────────────────────────────────────────

const normalizeBody = (s: string): string =>
  s.toLowerCase().replace(/[\s\W_]+/g, ' ').trim()

const previewOf = (s: string, n = 80): string => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length <= n ? t : `${t.slice(0, n)}…`
}

export function buildInventoryReadinessReport(input: InventoryReadinessInput): InventoryReadinessReport {
  const blockers: ReadinessIssue[] = []
  const warnings: ReadinessIssue[] = []

  // 1. Duplicate identity atoms (mission/vision/x_factor across sources)
  const dupMap = new Map<string, typeof input.pillars[number][]>()
  for (const p of input.pillars) {
    if (!IDENTITY_TOPICS.has(p.topic as AtomTopic)) continue
    if (p.duplicate_of) continue                              // already tagged
    const key = `${p.topic}|${normalizeBody(p.body)}`
    const list = dupMap.get(key) ?? []
    list.push(p)
    dupMap.set(key, list)
  }
  let duplicates_found = 0
  for (const list of dupMap.values()) {
    if (list.length < 2) continue
    duplicates_found += list.length - 1
    warnings.push({
      kind:     'duplicate_atom',
      severity: 'warning',
      detail:   `${list[0].topic} appears ${list.length}× across sources: ${list.map(p => p.source_kind ?? '?').join(' + ')}`,
      suggested_fix: 'Tag the non-canonical rows with duplicate_of pointing at the strongest one so plan-cross-page-allocation skips them.',
      rows:     list.map(p => ({ id: p.id, topic: p.topic, preview: previewOf(p.body) })),
    })
  }

  // 2. Crawl noise topics (large + dominated by Squarespace/404 markers)
  let noise_topics_found = 0
  for (const t of input.crawl_topics) {
    const isCatchAll = CRAWL_NOISE_TOPIC_KEYS.has(t.topic_key)
    const overSize   = t.passages_bytes >= CRAWL_NOISE_BYTE_THRESHOLD
    const markerHits = (t.sample_text || '').split('\n').filter(line =>
      NOISE_TEMPLATE_MARKERS.some(m => line.toLowerCase().includes(m.toLowerCase())),
    ).length
    const dominantNoise = markerHits >= 3                   // ≥3 boilerplate hits in the sample
    if ((isCatchAll && overSize) || dominantNoise) {
      noise_topics_found += 1
      warnings.push({
        kind:     'crawl_noise_topic',
        severity: 'warning',
        detail:   `crawl topic '${t.topic_key}' is ${(t.passages_bytes / 1024).toFixed(1)}KB`
          + (markerHits > 0 ? ` with ${markerHits} boilerplate-marker hit${markerHits === 1 ? '' : 's'}` : '')
          + ' — likely Squarespace template content or 404 pages, not partner copy',
        suggested_fix: 'Send to plan-cross-page-allocation pre-quarantined; let it use unresolved_sources reason=crawl_noise_parking_lot.',
        rows: [{ id: t.topic_key, topic: t.topic_key }],
      })
    }
  }

  // 3. PII flags on contact facts (personal cells, emails not in published contacts)
  let pii_flags = 0
  for (const f of input.facts) {
    if (f.topic !== 'contact_method') continue
    const blob = JSON.stringify(f.data ?? '')
    if (PHONE_PATTERN.test(blob)) {
      pii_flags += 1
      const metaSaysOk = f.metadata && (f.metadata.published === true || f.metadata.publishable === true)
      warnings.push({
        kind:     'pii_flag_fact',
        severity: metaSaysOk ? 'warning' : 'blocker',
        detail:   `contact_method fact ${f.id} contains a phone-number-shaped string. ${metaSaysOk ? 'Marked publishable in metadata.' : 'No publishable=true on metadata — likely a personal cell from AM handoff.'}`,
        suggested_fix: metaSaysOk
          ? 'Verified publishable — no action required, just acknowledge.'
          : 'Confirm with the partner before publishing. If personal-only, tag the fact non-publishable so it stays out of plan-cross-page-allocation.',
        rows: [{ id: f.id, topic: f.topic, preview: previewOf(blob) }],
      })
      // The blocker version goes to blockers[], the warning to warnings[] —
      // but we already pushed once above. Recategorize:
      if (!metaSaysOk) {
        blockers.push(warnings.pop()!)
      }
    }
  }

  // 4. Page-type coverage gaps
  const crawlKeys = new Set(input.crawl_topics.map(t => t.topic_key.toLowerCase()))
  const ccKeys    = new Set(input.content_collection_fields.map(k => k.toLowerCase()))
  const allTokens = new Set<string>()
  for (const k of crawlKeys) for (const tok of k.split(/[\s_-]+/)) allTokens.add(tok)
  for (const k of ccKeys)    for (const tok of k.split(/[\s_-]+/)) allTokens.add(tok)
  const coverage_gaps: string[] = []
  for (const { page_type, matches } of PAGE_TYPE_COVERAGE) {
    const has = matches.some(m =>
      crawlKeys.has(m) || ccKeys.has(m) || allTokens.has(m),
    )
    if (!has) coverage_gaps.push(page_type)
  }
  if (coverage_gaps.length > 0) {
    warnings.push({
      kind:     'page_coverage_gap',
      severity: 'warning',
      detail:   `No crawl topic or content-collection field covers: ${coverage_gaps.join(', ')}`,
      suggested_fix: 'Strategist should either confirm these pages are intentionally skipped OR follow up with the partner for missing intake (content collection extra-fields, supplemental brief).',
    })
  }

  // 5. Status ambiguity — atoms still marked 'draft' (never reviewed/promoted)
  const draftAtoms = input.pillars.filter(p => p.status === 'draft')
  if (draftAtoms.length > 0) {
    warnings.push({
      kind:     'status_ambiguity',
      severity: 'warning',
      detail:   `${draftAtoms.length} content_atoms still have status='draft'. plan-cross-page-allocation includes them but the strategist hasn't reviewed.`,
      suggested_fix: 'Bulk-promote to status=active if review is complete, or filter them OUT of the next cowork run.',
      rows: draftAtoms.slice(0, 5).map(p => ({ id: p.id, topic: p.topic, preview: previewOf(p.body) })),
    })
  }

  return {
    ok: blockers.length === 0,
    blockers,
    warnings,
    summary: {
      pillars_total:      input.pillars.length,
      pillars_draft:      draftAtoms.length,
      facts_total:        input.facts.length,
      crawl_topics_total: input.crawl_topics.length,
      duplicates_found,
      noise_topics_found,
      pii_flags,
      coverage_gaps,
    },
  }
}
