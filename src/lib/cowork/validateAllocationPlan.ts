/**
 * Deterministic validator for CoworkPageAllocationPlan output.
 *
 * TypeScript port of `cowork-skills/plan-cross-page-allocation/validate_allocation_plan.py`.
 * Rules tracked rule-for-rule so behavior stays identical on both sides;
 * regression tested against the Paradox 99005 fixture in the same skill
 * directory.
 *
 * Two callers in this codebase:
 *  - `api/web/agents/import-cowork-bundle.ts` (server, on every paste / cron import)
 *  - the Workspace UI (browser, for live paste-time validation feedback)
 *
 * Exit-style contract:
 *  - `result.ok === true` → safe to import
 *  - `result.failures` → machine-readable list; feed back to the model
 *    for ONE repair pass (fix only named gaps, don't regenerate)
 *  - `result.summary` → human-readable multi-line block for logs/UI
 */

import type {
  AtomTopic,
  AllocationTreatment,
  CoworkPageAllocationPlan,
  CoworkUnresolvedReason,
} from '../../types/coworkBundle'

// ─── Rule constants ─────────────────────────────────────────────────────

const CONTENT_TOPICS = new Set<AtomTopic>([
  'mission_statement', 'vision_statement', 'x_factor', 'ethos',
  'value_statement', 'persona', 'story', 'denominational_signal',
])

/** Verbatim rule applies to content pillars + the legacy prose_snippet
 *  topic (which is still carried for back-compat with rows the old
 *  atomize-doc skill produced). */
const VERBATIM_CONTENT_TOPICS = new Set<AtomTopic>([
  ...CONTENT_TOPICS, 'prose_snippet',
])

const VOICE_TOPICS = new Set<AtomTopic>([
  'voice_rule', 'voice_sample', 'tone_descriptor',
])

const DIRECTIVE_TOPICS = new Set<AtomTopic>(['recommended_page'])

const TREATMENTS = new Set<AllocationTreatment>([
  'lift_verbatim', 'weave_into_paragraph', 'card_per_row', 'summarize',
  'surface_as_faq', 'reframe_for_persona', 'cta_attach', 'voice_anchor',
])

const UNRESOLVED_REASONS = new Set<CoworkUnresolvedReason>([
  'crawl_noise_parking_lot',
  'csv_routed_elsewhere',
  'structured_data_routed_to_facts',
  'insufficient_items_for_template',
  'required_slots_unfilled',
  'duplicate_of_placed_source',
  'internal_admin_contact_not_for_publication',
  'insufficient_source_content',
])

const DEFAULT_PRIMARY_PAGES = ['home', 'plan-a-visit', 'about', 'donate'] as const

// ─── Public types ───────────────────────────────────────────────────────

export interface AllocationPlanManifest {
  /** Every pillar in the input payload — id + topic + verbatim flag.
   *  Validator rejects refs not present here ("unknown_ref"). */
  pillars: Array<{ id: string; topic: AtomTopic | string; verbatim?: boolean }>
  /** Fact row UUIDs from church_facts. */
  facts: string[]
  /** Crawl topics with coverage_status so the validator can require
   *  rich/covered topics to land on a page (or be parked as noise). */
  crawl_topics: Array<{ topic_key: string; coverage_status: 'rich' | 'covered' | 'sparse' | string }>
  /** Field keys from the latest content_collection_session. */
  content_collection_fields: string[]
  /** Every sitemap page slug — validator requires an allocation entry per slug. */
  sitemap_slugs: string[]
  /** Pages eligible to host a voice_anchor for voice pillars. Defaults
   *  to home / plan-a-visit / about / donate. */
  primary_pages?: string[]
  /** Each named persona's entry-point pages — validator requires a hook
   *  flow_role on at least one of them. */
  persona_entry_points?: Record<string, string[]>
}

export interface AllocationPlanValidationFailure {
  check:  string
  detail: string
}

export interface AllocationPlanValidationResult {
  ok:       boolean
  failures: AllocationPlanValidationFailure[]
  /** Failures grouped by check name for compact display. */
  byCheck:  Record<string, string[]>
  /** Multi-line human-readable summary (mirrors the Python script's
   *  stdout, top-down per check, capped at 10 examples per check). */
  summary:  string
}

// ─── Implementation ─────────────────────────────────────────────────────

interface Placement {
  page_slug:  string
  section_ix: number
  treatment:  AllocationTreatment | string
  rationale?: string
}

const refKey = (kind: string, ref: string): string => `${kind}|${ref}`

export function validateAllocationPlan(
  plan: CoworkPageAllocationPlan,
  mf:   AllocationPlanManifest,
): AllocationPlanValidationResult {
  const failures: AllocationPlanValidationFailure[] = []
  const fail = (check: string, detail: string): void => { failures.push({ check, detail }) }

  const allocs     = plan.allocations         ?? []
  const traces     = plan.source_traces       ?? []
  const unresolved = plan.unresolved_sources  ?? []
  const directives = plan.build_directives    ?? []

  // (kind, ref) → list of placements where the source landed
  const placed = new Map<string, Placement[]>()
  for (const t of traces) {
    const k = refKey(t.source_kind, t.source_ref)
    const list = placed.get(k) ?? []
    list.push(...(t.placements as Placement[] ?? []))
    placed.set(k, list)
  }
  const unresolvedRefs = new Set(unresolved.map(u => refKey(u.source_kind, u.source_ref)))
  const directiveRefs  = new Set(directives.map(d => refKey(d.source_kind, d.source_ref)))
  const slugs          = new Set(allocs.map(a => a.page_slug))
  const primary        = new Set(mf.primary_pages ?? DEFAULT_PRIMARY_PAGES)

  // Cross-consistency — refs must exist in the input manifest
  const known = new Set<string>()
  for (const p of mf.pillars)                        known.add(refKey('pillar', p.id))
  for (const fid of mf.facts)                        known.add(refKey('fact', fid))
  for (const t of mf.crawl_topics)                   known.add(refKey('crawl_topic', t.topic_key))
  for (const k of mf.content_collection_fields ?? []) known.add(refKey('content_collection', k))

  for (const a of allocs) {
    for (const [ix, s] of (a.section_intents ?? []).entries()) {
      for (const src of s.sources ?? []) {
        const k = refKey(src.kind, src.ref)
        if (!known.has(k))             fail('unknown_ref',     `${a.page_slug}[${ix}] references {${src.kind}, ${src.ref}} not present in input manifest (hallucinated ref?)`)
        if (!TREATMENTS.has(src.treatment as AllocationTreatment)) {
                                       fail('bad_treatment',   `${a.page_slug}[${ix}] {${src.kind}, ${src.ref}}: '${src.treatment}' not in treatment vocabulary`)
        }
        if (!placed.has(k))            fail('trace_missing',   `{${src.kind}, ${src.ref}} used in ${a.page_slug}[${ix}] but absent from source_traces`)
      }
    }
  }

  for (const [k, pls] of placed.entries()) {
    if (!known.has(k)) {
      const [kind, ref] = k.split('|')
      fail('unknown_ref', `source_traces references {${kind}, ${ref}} not present in input manifest`)
    }
    for (const pl of pls) {
      const a = allocs.find(x => x.page_slug === pl.page_slug)
      if (!a) {
        const [kind, ref] = k.split('|')
        fail('bad_placement_page', `{${kind}, ${ref}} placed on unknown page '${pl.page_slug}'`)
      } else {
        const n = a.section_intents.length
        if (!(pl.section_ix >= 0 && pl.section_ix < n)) {
          const [kind, ref] = k.split('|')
          fail('bad_section_ix', `{${kind}, ${ref}} → ${pl.page_slug}[${pl.section_ix}] out of range (page has ${n} sections)`)
        }
      }
      if (!pl.rationale) {
        const [kind, ref] = k.split('|')
        fail('missing_rationale', `{${kind}, ${ref}} → ${pl.page_slug}[${pl.section_ix}] has no rationale`)
      }
    }
  }

  // Sitemap completeness
  for (const slug of mf.sitemap_slugs) {
    if (!slugs.has(slug)) fail('missing_page', `sitemap page '${slug}' has no allocation entry`)
  }

  // Pillar coverage / routing / verbatim
  for (const p of mf.pillars) {
    const k     = refKey('pillar', p.id)
    const topic = p.topic as AtomTopic
    if (CONTENT_TOPICS.has(topic) && !placed.has(k) && !unresolvedRefs.has(k)) {
      fail('content_pillar_dropped', `${topic} pillar ${p.id} not in source_traces or unresolved_sources`)
    }
    if (VOICE_TOPICS.has(topic)) {
      const anchors = (placed.get(k) ?? []).filter(pl =>
        pl.treatment === 'voice_anchor' && primary.has(pl.page_slug),
      )
      if (anchors.length === 0) {
        fail('voice_not_routed', `${topic} pillar ${p.id} has no voice_anchor placement on a primary page ${JSON.stringify([...primary].sort())}`)
      }
    }
    if (VERBATIM_CONTENT_TOPICS.has(topic) && p.verbatim) {
      const bad = (placed.get(k) ?? []).filter(pl =>
        pl.treatment === 'weave_into_paragraph' || pl.treatment === 'reframe_for_persona',
      )
      if (bad.length > 0) {
        fail('verbatim_violated', `verbatim ${topic} pillar ${p.id} placed with ${JSON.stringify(bad.map(b => b.treatment))}`)
      }
      if (placed.has(k) && !(placed.get(k) ?? []).some(pl => pl.treatment === 'lift_verbatim')) {
        fail('verbatim_no_lift', `verbatim ${topic} pillar ${p.id} placed but never lift_verbatim`)
      }
    }
    if (DIRECTIVE_TOPICS.has(topic) && !directiveRefs.has(k) && !unresolvedRefs.has(k) && !placed.has(k)) {
      fail('directive_dropped', `recommended_page pillar ${p.id} not routed to build_directives`)
    }
  }

  // Crawl coverage
  const noiseParked = new Set(
    unresolved
      .filter(u => u.source_kind === 'crawl_topic' && u.reason === 'crawl_noise_parking_lot')
      .map(u => u.source_ref),
  )
  for (const t of mf.crawl_topics) {
    const k = refKey('crawl_topic', t.topic_key)
    if ((t.coverage_status === 'rich' || t.coverage_status === 'covered')
        && !placed.has(k) && !noiseParked.has(t.topic_key)) {
      fail('crawl_topic_dropped', `${t.topic_key} (${t.coverage_status}) must be placed (or parked as crawl noise)`)
    } else if (!placed.has(k) && !unresolvedRefs.has(k)) {
      fail('crawl_topic_dropped', `${t.topic_key} not placed or unresolved`)
    }
  }

  // Facts + content_collection coverage
  for (const fid of mf.facts) {
    const k = refKey('fact', fid)
    if (!placed.has(k) && !unresolvedRefs.has(k)) fail('fact_dropped', `fact ${fid} not placed or unresolved`)
  }
  for (const cc of mf.content_collection_fields ?? []) {
    const k = refKey('content_collection', cc)
    if (!placed.has(k) && !unresolvedRefs.has(k)) fail('cc_field_dropped', `content_collection field '${cc}' not placed or unresolved`)
  }

  // Journey shape
  for (const a of allocs) {
    const flows = (a.section_intents ?? []).map(s => s.flow_role)
    const pg = a.page_slug
    if (flows.length < 3)                                   fail('journey_too_short',  `${pg}: ${flows.length} sections (<3)`)
    if (flows.length === 0 || flows[0] !== 'hook')          fail('hook_not_first',     `${pg}: first flow_role is ${flows[0] ?? null}`)
    if (flows.length > 0 && !['invite', 'close'].includes(flows[flows.length - 1])) {
                                                            fail('bad_ending',         `${pg}: ends in ${flows[flows.length - 1]}`)
    }
    const inviteCount = flows.filter(f => f === 'invite').length
    if (inviteCount !== 1)                                  fail('invite_count',       `${pg}: ${inviteCount} invite sections (need exactly 1)`)
    for (const [ix, s] of (a.section_intents ?? []).entries()) {
      if (!s.section_job)                                   fail('missing_section_job',`${pg}[${ix}]`)
      if (!s.sources || s.sources.length === 0)             fail('empty_section',      `${pg}[${ix}] (${s.flow_role}) has no sources`)
    }
  }

  // Persona entry hooks
  const flowsBySlug: Record<string, string[]> = {}
  for (const a of allocs) flowsBySlug[a.page_slug] = (a.section_intents ?? []).map(s => s.flow_role)
  for (const [persona, pages] of Object.entries(mf.persona_entry_points ?? {})) {
    const hasHook = pages.some(pg => flowsBySlug[pg]?.[0] === 'hook')
    if (!hasHook) {
      fail('persona_no_hook', `${persona}: no hook-first page among entry points ${JSON.stringify(pages)}`)
    }
  }

  // Unresolved hygiene
  for (const u of unresolved) {
    if (!UNRESOLVED_REASONS.has(u.reason as CoworkUnresolvedReason)) {
                                                            fail('bad_unresolved_reason', `${u.source_ref}: reason '${u.reason}' not in enum`)
    }
    if (!u.detail)                                          fail('unresolved_no_detail',  `${u.source_ref}: missing detail`)
    if (u.reason === 'required_slots_unfilled' && !u.slot_gap) {
                                                            fail('missing_slot_gap',      `${u.source_ref}: required_slots_unfilled without slot_gap`)
    }
  }

  // Group failures by check + format summary
  const byCheck: Record<string, string[]> = {}
  for (const f of failures) {
    (byCheck[f.check] ??= []).push(f.detail)
  }
  const summaryLines: string[] = []
  for (const check of Object.keys(byCheck).sort()) {
    const details = byCheck[check]
    summaryLines.push(`FAIL ${check} (${details.length})`)
    for (const d of details.slice(0, 10)) summaryLines.push(`   - ${d}`)
    if (details.length > 10) summaryLines.push(`   … +${details.length - 10} more`)
  }
  summaryLines.push(failures.length === 0 ? 'ALL CHECKS PASS' : `${failures.length} FAILURES`)

  return {
    ok:       failures.length === 0,
    failures,
    byCheck,
    summary:  summaryLines.join('\n'),
  }
}

// Re-export the rule constants so callers can introspect / display them
export {
  CONTENT_TOPICS,
  VERBATIM_CONTENT_TOPICS,
  VOICE_TOPICS,
  DIRECTIVE_TOPICS,
  TREATMENTS,
  UNRESOLVED_REASONS,
  DEFAULT_PRIMARY_PAGES,
}
