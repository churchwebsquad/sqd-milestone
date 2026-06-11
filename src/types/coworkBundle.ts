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

/** Per-section narrative role. Borrowed from in-app site_strategy work. */
export type FlowRole =
  | 'hook'      // grab attention
  | 'orient'    // establish what this is / where we are
  | 'reassure'  // address the specific barrier the persona carries
  | 'inform'    // deliver the facts
  | 'deepen'    // add texture / show character
  | 'invite'    // offer the next step
  | 'close'     // close the page with intent

// ── Artifacts ────────────────────────────────────────────────────────────

/** What atomize-doc emits per source. atoms[] + facts[] go into Supabase
 *  tables; the report goes into roadmap_state for telemetry / audit. */
export interface CoworkAtomizeDocResult {
  source_id:        string             // web_intake_documents.id / web_project_topics.id / content_collection_session field key
  source_kind:      AtomSourceKind
  source_filename?: string             // for display only
  atoms:            CoworkAtomRow[]    // ready to INSERT into content_atoms
  facts:            CoworkFactRow[]    // ready to INSERT into church_facts
  report: {
    /** Every taxonomy category this skill SCANNED for in this source.
     *  Importer cross-checks to catch coverage gaps (e.g., "you scanned
     *  this strategy brief but didn't look for voice_sample"). */
    scanned_atom_topics: AtomTopic[]
    scanned_fact_topics: FactTopic[]
    /** Free-text notes the skill wants to surface (e.g., "Source has
     *  no service times — likely needs partner follow-up"). */
    notes: string[]
  }
  _meta: ArtifactMeta
}

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
  /** Optional cost/usage telemetry the import endpoint can ignore safely. */
  usage?: {
    input_tokens?:  number
    output_tokens?: number
    cache_read_tokens?:  number
    cache_write_tokens?: number
  }
}
