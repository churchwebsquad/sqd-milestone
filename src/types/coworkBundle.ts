/**
 * Bundle contract — the shape every cowork skill must emit for the app to
 * accept it. Source of truth used by:
 *
 *   - cowork side (skills reference these shapes when writing back)
 *   - app side (import endpoint validates against these types before
 *               atomically writing to Supabase)
 *
 * Types mirror the Supabase column types where the cowork output lands
 * in a real table (content_atoms, church_facts), and the JSONB shape
 * where it lands inside strategy_web_projects.roadmap_state (outlines,
 * drafts, critique).
 *
 * Versioning: every artifact carries `_meta.bundle_version`. The import
 * endpoint refuses to write artifacts at a bundle_version it doesn't
 * understand. Bump the version when shapes change so older cowork runs
 * don't silently corrupt newer schemas.
 */

export const BUNDLE_VERSION = '1.0.0' as const

// ── Taxonomies ───────────────────────────────────────────────────────────
//
// Closed enums. atomize-doc is told to use ONLY these topics; anything
// outside the enum gets coerced to `prose_snippet` (for atoms) or rejected
// (for facts). Keeps downstream stages predictable.

export type AtomTopic =
  | 'mission_statement'
  | 'vision_statement'
  | 'x_factor'              // the church's distinctive — what makes it not-interchangeable
  | 'ethos'                 // posture / worldview (not a value or a rule)
  | 'value_statement'       // a stated core value
  | 'voice_rule'            // explicit how-we-write directive ("never use 'lost'")
  | 'voice_sample'          // a verbatim phrase that exemplifies voice (Director uses these as exemplars)
  | 'tone_descriptor'       // adjectival voice signal ('reverent', 'plain-spoken')
  | 'persona'               // a named audience archetype with need + barrier
  | 'story'                 // an anecdote (testimonial, vignette, founding story)
  | 'prose_snippet'         // reusable verbatim prose for a specific page or context
  | 'denominational_signal' // theological tradition markers
  | 'recommended_page'      // a partner-suggested page that the sitemap should consider

export type FactTopic =
  | 'service_time'
  | 'campus'
  | 'ministry'              // a named program area (Kids, Youth, etc.)
  | 'staff'                 // person on staff with role
  | 'belief'                // doctrinal statement
  | 'program'               // a recurring offering (Bible study, group, class)
  | 'milestone'             // founding date, growth event, anniversary
  | 'contact_method'        // phone, email, mailing address
  | 'branded_term'          // proprietary terminology ("The Vineyard Way")
  | 'audience'              // a measurable audience segment
  | 'location_detail'       // parking, accessibility, building features
  | 'partnership'           // missions / community partners
  | 'testimonial'           // attributed quote from a real person

export type AtomSourceKind =
  | 'intake_doc'            // web_intake_documents row
  | 'content_collection'    // strategy_content_collection_sessions field
  | 'crawl_topic'           // web_project_topics row's passages
  | 'discovery_questionnaire'
  | 'brand_guide'
  | 'account_handoff'       // strategy_account_progress.handoff_*
  | 'derived'               // computed by a cowork skill from other atoms

export type MinistryModel = 'attractional' | 'discipleship' | 'missional'

/** How the page-draft skill should handle each atom in its outline.
 *  - verbatim     = lift exactly as-is, no rewording
 *  - light_edit   = small polish (punctuation, snippet substitution)
 *  - heavy_edit   = restructure for slot + voice
 *  - synthesize   = combine with other atoms or invent fresh prose informed by atom */
export type TreatmentSignal = 'verbatim' | 'light_edit' | 'heavy_edit' | 'synthesize'

/** Per-section narrative role. Borrowed from in-app site_strategy work.
 *
 * IMPORTANT: This tuple is THE single source for the flow_role enum.
 * Validator sets, JSON-schema enums, prose tables in SKILL.md — every
 * one of them imports from here (or is checked against here by
 * check:skill-prompts). Adding a token here is the ONLY way to extend
 * the vocabulary; spelling a new value in a downstream consumer trips
 * the drift check. */
export const FLOW_ROLES = [
  'hook',      // grab attention
  'orient',    // establish what this is / where we are
  'reassure',  // address the specific barrier the persona carries
  'inform',    // deliver the facts
  'deepen',    // add texture / show character
  'invite',    // offer the next step
  'close',     // close the page with intent
] as const

export type FlowRole = typeof FLOW_ROLES[number]

// ── Artifacts ────────────────────────────────────────────────────────────

/** RENAMED + RESCOPED. Originally I designed this as a comprehensive
 *  per-doc atomizer that tried to extract every kind of atom from every
 *  source. After review the user pointed out that this duplicates work
 *  the crawl already does (web_project_topics is already a content
 *  inventory) and risks dropping info when the LLM compresses content
 *  into typed rows.
 *
 *  The new scope: content_atoms is ONLY the strategic-interpretation
 *  layer — voice samples, persona definitions, mission/vision/x_factor
 *  distillations, ethos statements, denominational signals, stories.
 *  The actual page content stays in source tables (crawl topics,
 *  content collection, intake docs) and downstream page-draft reads
 *  source directly when it needs body text.
 *
 *  User-facing label for content_atoms is "Strategic Pillars."
 *
 *  extract-strategic-pillars only mines: strategy_brief, discovery
 *  questionnaire, brand guide, handoff form, and any prose intake doc
 *  containing identity statements. CSVs go to a separate deterministic
 *  facts-parsing step; not all sources go through this skill. */
export interface CoworkStrategicPillarsResult {
  source_id:        string             // web_intake_documents.id / discovery row id / brand_guide id / etc.
  source_kind:      AtomSourceKind
  source_filename?: string             // for display only
  /** Maps 1:1 to content_atoms rows. The "Strategic Pillars" the
   *  user-facing UI shows. Includes the 11 content/voice topics in
   *  TOPICS_IN_PILLARS plus `recommended_page` (TOPICS_FOR_DIRECTIVES)
   *  which routes to `build_directives` in the allocation plan instead
   *  of into a page section. NEVER emits `prose_snippet` (legacy
   *  carry-only — see TOPICS_LEGACY). */
  pillars:          CoworkAtomRow[]
  report: {
    /** Every taxonomy category this skill SCANNED for in this source.
     *  Importer cross-checks to catch coverage gaps (e.g., "you scanned
     *  this strategy brief but didn't look for voice_sample"). */
    scanned_atom_topics: AtomTopic[]
    /** Free-text notes the skill wants to surface (e.g., "Source has
     *  no x_factor declaration — likely needs partner follow-up"). */
    notes: string[]
  }
  _meta: ArtifactMeta
}

/** Content/voice topics extract-strategic-pillars produces that get
 *  placed on a page section by plan-cross-page-allocation. Everything
 *  else (program data, staff, service times, etc.) belongs in
 *  church_facts via deterministic parsing OR stays in source. */
export const TOPICS_IN_PILLARS: readonly AtomTopic[] = [
  'mission_statement',
  'vision_statement',
  'x_factor',
  'ethos',
  'value_statement',
  'voice_rule',
  'voice_sample',
  'tone_descriptor',
  'persona',
  'story',
  'denominational_signal',
] as const

/** Topics extract-strategic-pillars ALSO produces that route to
 *  build_directives in the allocation plan output instead of landing
 *  on a page section. Partner-suggested pages, CPT/workflow
 *  requirements, redirect maps, seasonal theming, guide
 *  consolidation, page-priority directives — anything the dev/designer
 *  needs to know about that isn't page copy. The validator's
 *  `directive_dropped` check enforces routing. */
export const TOPICS_FOR_DIRECTIVES: readonly AtomTopic[] = [
  'recommended_page',
] as const

/** Topics the type union still allows for back-compat with rows
 *  written by the previous (overscoped) atomize-doc design. The new
 *  extract-strategic-pillars skill must NOT emit these — page content
 *  stays in source (crawl + content_collection) per the user's
 *  data-truth model. */
export const TOPICS_LEGACY: readonly AtomTopic[] = [
  'prose_snippet',
] as const

/** Shape that maps 1:1 to content_atoms columns. Importer can spread it
 *  into `.insert(row)`. */
export interface CoworkAtomRow {
  id:             string                // uuid v4 generated by cowork
  web_project_id: string                // uuid
  topic:          AtomTopic
  body:           string                // the actual text — never empty
  metadata:       Record<string, unknown> | null
  source_kind:    AtomSourceKind | null
  source_ref:     string | null         // e.g. 'web_intake_documents/<doc_id>' or 'content_collection.kids_description'
  verbatim:       boolean               // true if this atom MUST be lifted as-is downstream
  confidence:     number | null         // 0-1
  status:         'active' | 'archived'
}

/** Shape that maps 1:1 to church_facts columns. */
export interface CoworkFactRow {
  id:             string
  web_project_id: string
  topic:          FactTopic
  /** Structured fact payload. Shape varies per topic:
   *
   *    service_time → { day, start_time, end_time?, campus_ref?, label?, notes? }
   *    campus       → { name, address, primary?, notes? }
   *    staff        → { name, role, bio?, photo_url?, email?, phone? }
   *    ministry     → { name, audience?, schedule?, leader_ref?, description? }
   *    program      → { name, audience?, cadence?, description? }
   *    belief       → { tradition?, statement }
   *    milestone    → { year, label, narrative? }
   *    contact_method → { kind: 'phone'|'email'|'address', value }
   *    branded_term → { term, definition }
   *    audience     → { segment, size? }
   *    location_detail → { kind, value }
   *    partnership  → { partner_name, focus?, since? }
   *    testimonial  → { attributed_to?, quote }
   */
  data:           Record<string, unknown>
  source_kind:    AtomSourceKind | null
  source_ref:     string | null
  status:         'active' | 'archived'
}

/** stage_1 — synthesize-strategy output. Lands at roadmap_state.stage_1. */
export interface CoworkStage1 {
  audience:                Record<string, unknown>
  personas:                Array<{
    name:               string
    age_range?:         string
    barrier:            string   // the specific friction this persona feels
    need:               string
    voice_resonance:    string   // what tone / register lands for them
    primary_pages?:     string[] // where this persona should be served
  }>
  x_factor:                string             // 1-2 sentences
  voice_exemplars:         string[]           // verbatim phrases to imitate shape of
  voice_anti_exemplars:    string[]           // verbatim phrases that show what NOT to write
  voice_characteristics:   string[]           // tone_descriptors expanded
  project_goals:           string[]
  sitemap_signals:         string[]           // partner-stated needs that drive sitemap shape
  topic_coverage_plan:     Record<string, string>  // every topic_key → which page handles it
  total_page_count?:       number
  existing_pages_to_carry_forward?: string[]
  seo_aeo_geo_targets?:    Record<string, unknown>
  sources_used:            string[]           // which atoms / docs informed this stage_1
  _meta:                   ArtifactMeta
}

export interface CoworkMinistryModel {
  model:            MinistryModel
  confidence:       number
  secondary_blend:  MinistryModel | null
  blend_notes:      string | null
  evidence:         string[]              // verbatim atom snippets that justify the classification
  rationale:        string
  cta_default:      string                // the call-to-action phrasing that fits this model
  _meta:            ArtifactMeta
}

export interface CoworkAcfPlan {
  modules:     Array<Record<string, unknown>>  // ACF module configs — opaque to the contract
  taxonomies:  Array<Record<string, unknown>>
  rationale:   string
  _meta:       ArtifactMeta
}

export interface CoworkSiteStrategy {
  siteflow: {
    homepage_arc:    string[]              // ordered phrases describing what the home page DOES
    narrative_thread: string               // how the whole site reads top-to-bottom
  }
  persona_journeys: Array<{
    persona_name:  string
    entry_points:  string[]                // page slugs where this persona lands first
    journey_arc:   string[]                // pages in order this persona moves through
    barriers_addressed: string[]
  }>
  page_elevations: Array<{
    topic:    string
    importance: 'core' | 'supporting' | 'optional'
    rationale: string
  }>
  key_info_to_highlight: Array<{
    what:  string
    where: string                          // page slug or section
  }>
  voice_register_per_page_type: Record<string, string>
  rationale: string
  _meta:     ArtifactMeta
}

/** Output of plan-cross-page-allocation. Runs ONCE per project. Decides
 *  which sources land on which pages with what intent + treatment. The
 *  source_traces array is the auditable trail strategists can review in
 *  the workspace "content coverage" view — every source can be looked
 *  up to see where it ended up and how it gets used.
 *
 *  outline-page consumes one entry from allocations[] (the one matching
 *  its page_slug) plus the relevant source_traces, and turns it into the
 *  formal CoworkPageOutline below. */
export interface CoworkPageAllocationPlan {
  allocations: CoworkPageAllocation[]                  // one entry per sitemap page
  source_traces: CoworkSourceTrace[]                   // every source that landed somewhere
  unresolved_sources: Array<{
    /** Sources that DIDN'T land anywhere — surfaced for strategist review. */
    source_kind: string
    source_ref:  string
    reason:      CoworkUnresolvedReason
    /** Actionable specifics: what's noisy, what consent is missing, which
     *  template gapped. Required by the skill; optional here so older
     *  plans still parse. */
    detail?:     string
    /** Present only when reason === 'required_slots_unfilled'. */
    slot_gap?:   { template_id: string; slot_key: string; why: string }
  }>
  /** Build/workflow requirements that are NOT page copy (atoms with topic
   *  'recommended_page': staff CPT, redirect map, seasonal theming, guide
   *  consolidation, …). Neither placements nor unresolved — routed to dev
   *  handoff. Optional: plans generated before skill v1.1 won't have it. */
  build_directives?: Array<{
    source_kind: string
    source_ref:  string
    applies_to:  string                                // page slug or 'site_wide'
    directive:   string                                // 1-line restatement for dev handoff
  }>
  _meta: ArtifactMeta
}

/** Closed vocabulary for unresolved_sources.reason. Keep in sync with
 *  plan-cross-page-allocation/SKILL.md. Const tuple so VOCAB_DIMENSIONS
 *  + the runtime validator import the same list. */
export const UNRESOLVED_REASONS_LIST = [
  'crawl_noise_parking_lot',
  'csv_routed_elsewhere',
  'structured_data_routed_to_facts',
  'insufficient_items_for_template',
  'required_slots_unfilled',
  'duplicate_of_placed_source',
  'internal_admin_contact_not_for_publication',
  'insufficient_source_content',
] as const

/** The (string & {}) escape hatch keeps pre-v1.1 plans parseable; new
 *  plans must use a value from UNRESOLVED_REASONS_LIST. */
export type CoworkUnresolvedReason =
  | typeof UNRESOLVED_REASONS_LIST[number]
  | (string & {})

export interface CoworkPageAllocation {
  page_slug:           string
  page_job:            string                          // one sentence: what this page does for its primary persona
  primary_persona:     string | null                   // name of the persona this page is anchored to
  ministry_model_alignment: MinistryModel | 'mixed'
  /** Ordered list of section intents — the journey down the page. Each
   *  entry is just an INTENT + flow_role + treatment hints; outline-page
   *  turns this into archetype + slot bindings + atom_assignments. */
  section_intents: Array<{
    flow_role:        FlowRole
    section_job:      string                           // one sentence
    /** Sources targeted at this section. Each source has a treatment
     *  hint. outline-page resolves these to slot-level assignments. */
    sources: Array<{
      kind:        SourceKindForAllocation
      ref:         string                              // atom UUID / crawl_topic key / content_collection field / fact ID
      treatment:   AllocationTreatment
      note?:       string                              // free-text guidance for outline-page / draft-page
    }>
    suggested_archetype?: string                       // hint, outline-page may override
  }>
}

export type SourceKindForAllocation =
  | 'pillar'                                           // content_atoms row by ID
  | 'fact'                                             // church_facts row by ID
  | 'crawl_topic'                                      // web_project_topics by topic_key
  | 'content_collection'                               // strategy_content_collection_sessions field key

/** The treatment vocabulary plan-cross-page-allocation uses. Richer than
 *  the per-atom TreatmentSignal because this skill decides STRUCTURAL
 *  shape, not just word-level rewriting. */
/** Promoted to const tuple (same pattern as FLOW_ROLES) so validators
 *  and VOCAB_DIMENSIONS drift checks can import the canonical list. */
export const ALLOCATION_TREATMENTS = [
  'lift_verbatim',           // use the source phrase exactly (voice samples, partner-stated mission)
  'weave_into_paragraph',    // source is structured/list-like but should become prose here
  'card_per_row',            // CSV/list source → one card per row
  'summarize',               // distill from a longer source — orienting line
  'surface_as_faq',          // inform-style content clearer as Q&A than narrative
  'reframe_for_persona',     // reframe source through the persona's barrier
  'cta_attach',              // use source as the close/invite for this section
  'voice_anchor',            // don't lift content — use as the voice exemplar to imitate
] as const

export type AllocationTreatment = typeof ALLOCATION_TREATMENTS[number]

/** One row per source that landed somewhere. The strategist's audit
 *  trail. The "content coverage" view in the workspace reads these. */
export interface CoworkSourceTrace {
  source_kind: SourceKindForAllocation
  source_ref:  string
  /** Where this source ended up. A source can land in MULTIPLE places
   *  (e.g., kids info as hook on home + full inform section on kids). */
  placements: Array<{
    page_slug:    string
    section_ix:   number                               // index into the page's section_intents
    treatment:    AllocationTreatment
    rationale:    string                               // 1-line: why this source belongs here
  }>
}

export interface CoworkPageOutline {
  page_slug:                string
  ministry_model_alignment: MinistryModel | 'mixed'
  sections: Array<{
    section_ix:        number              // 0-indexed
    archetype:         string              // 'hero' | 'three_up' | 'cards_grid' | ...
    section_job:       string              // 1 sentence: what this section does for the primary persona
    flow_role:         FlowRole
    voice_anchor:      string              // which voice_exemplar to imitate
    anti_pattern_to_avoid: string          // specific shape NOT to produce here
    atom_assignments: Array<{
      atom_id:    string                   // REAL UUID from content_atoms — importer validates
      treatment:  TreatmentSignal
      slot_hint:  string                   // 'heading' | 'description' | 'cards[0].body' | etc.
    }>
    cms_managed?:     boolean              // true = section reads from ACF module at render, not from copy
  }>
  unresolved_inputs: Array<{
    what:  string                          // 'No service times for Tuesday gathering'
    where: string                          // which atom/source should have it
  }>
  _meta: ArtifactMeta & {
    atom_count_used: number
    sections_count:  number
  }
}

export interface CoworkPageDraft {
  page_slug: string
  sections: Array<{
    archetype:    string
    voice_notes:  string                   // 1-line: which exemplar this section imitates
    copy:         Record<string, unknown>  // slot map — keys match the archetype's slot shape
    atoms_used:   string[]                 // atom IDs actually consumed in this section
  }>
  deviation_note: string | null            // if structure differs from the outline, explain
  validation: {
    flags:        string[]                 // human-readable issues found during draft
    unused_atoms: string[]                 // atom IDs in the outline that weren't used
  }
  _meta: ArtifactMeta & {
    used_outline:         boolean
    outline_sections:     number
    drafted_sections:     number
    sections_match:       boolean
    atom_ids_requested:   number
    atom_ids_resolved:    number
    atom_resolution_rate: number
    truncation_suspected: boolean
    dash_strip:           { count: number; samples: Array<{ where: string; before: string; after: string }> }
  }
}

/** Per-page critique — critique-page emits one of these per drafted page. */
export interface CoworkPageCritique {
  page_slug:           string
  // 5-axis scoring per CLAUDE.md / Director prompt. 0-100 each.
  dignity:             number                 // FLOOR 70 — ≤40 = blocker
  voice_character:     number
  persona_fit:         number
  atom_coverage:       number
  claim_plausibility:  number
  standout_lines:      string[]               // verbatim proof of voice + dignity intact
  problem_lines:       string[]               // verbatim quotes that violate an axis
  directives: Array<{
    fix_kind:    'slot_edit' | 'page_redraft' | 'sitemap_redraft' | 'synthesize_rework'
    page_slug:   string
    section_ix?: number
    slot_key?:   string
    note:        string                     // CONCRETE instruction the re-runner can act on
    severity:    'blocker' | 'warning' | 'nit'
    axis:        'dignity' | 'voice_character' | 'persona_fit' | 'atom_coverage' | 'claim_plausibility'
  }>
  summary: string
  _meta: ArtifactMeta
}

/** Cross-page critique synthesis — synthesize-critique reads all per-page
 *  critiques and emits the rollup the strategist sees at Gate 2. */
export interface CoworkCritiqueRollup {
  scores: {
    dignity:            number     // SITE-WIDE MIN (not avg) — if any page ≤40, this reflects it
    voice_character:    number
    persona_fit:        number
    atom_coverage:      number
    claim_plausibility: number
    overall:            number
  }
  overall_verdict: 'approved' | 'needs_revision' | 'needs_strategy_rework'
  cross_page_findings: Array<{
    kind:        'voice_drift' | 'persona_gap' | 'atom_orphan' | 'nav_parity' | 'duplicate_message'
    description: string
    pages:       string[]
  }>
  per_page_summary: Array<{
    page_slug: string
    /** Pointer; full critique lives in CoworkPageCritique rows. */
    overall: number
    dignity: number
  }>
  _meta: ArtifactMeta
}

// ── Progress state ───────────────────────────────────────────────────────

/** Status the cowork director writes to roadmap_state.cowork_progress after
 *  every dispatched skill. Workspace polls this same key for live status. */
export interface CoworkBundleProgress {
  bundle_version:  string
  /** 'queued' | 'running' | 'done' | 'failed' | 'paused' */
  status:          CoworkRunStatus
  current_step:    string                        // e.g. 'atomize-doc:strategy_brief.md' / 'outline-page:home'
  completed_steps: string[]                      // ordered list of step keys done so far
  total_steps:     number                        // planned at start
  started_at:      string                        // ISO
  last_action_at:  string
  last_artifact?: {
    kind: 'atom_batch' | 'fact_batch' | 'stage_1' | 'ministry_model' | 'acf_plan' | 'site_strategy' | 'page_outline' | 'page_draft' | 'page_critique' | 'critique_rollup'
    /** For per-page kinds, the slug. For per-doc kinds, the source_id. */
    key:  string
  }
  last_error?: {
    step:    string                              // which step's call failed
    message: string
    /** Whether the director will retry or hand off to the strategist. */
    retriable: boolean
  }
}

export type CoworkRunStatus = 'queued' | 'running' | 'done' | 'failed' | 'paused'

// ── Common shape — every artifact carries a _meta ────────────────────────

export interface ArtifactMeta {
  bundle_version: string                         // BUNDLE_VERSION at write time
  skill_name:     string                         // e.g. 'atomize-doc', 'outline-page'
  skill_version:  string                         // semver of the SKILL.md
  generated_at:   string                         // ISO
  model:          string                         // e.g. 'claude-opus-4-7'
  /** First 16 hex chars of sha256(systemPrompt) from the skill bundle
   *  the endpoint actually used. Lets approval snapshots trace which
   *  prompt version produced this artifact — if the SKILL.md or any of
   *  its references changes, downstream tooling sees a new hash and
   *  can decide whether to re-run. */
  prompt_hash?:   string
  /** Optional cost/usage telemetry the import endpoint can ignore safely. */
  usage?: {
    input_tokens?:  number
    output_tokens?: number
    cache_read_tokens?:  number
    cache_write_tokens?: number
  }
  /** True if the endpoint ran a repair pass before this artifact landed
   *  (deterministic validator tripped on first-pass output; a single
   *  repair call corrected the named gaps). Strategist UI can surface
   *  the badge; prompt-tuning watches the rate. */
  repaired?:      boolean
  /** Only set when repaired=true. Counts of which checks failed on the
   *  FIRST pass (before repair). High counts on a specific check
   *  across many runs = prompt or input projection isn't conveying
   *  that constraint. P7 telemetry seed; reviewer telemetry table
   *  reads this when it lands. */
  first_pass_failures?: {
    count:    number
    by_check: Record<string, number>
  } | null
}
