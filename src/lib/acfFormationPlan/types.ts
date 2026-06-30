// Content-Model Formation Plan — TypeScript types
//
// The formation plan reads a partner's approved web project (layouts =
// the source of truth, since partner edits land there) and emits a
// 3-layer recommendation that McNeel reviews and dev executes:
//
//   Layer 1 — Classification:   one record per content piece, A–G taxonomy
//   Layer 2 — WordPress object: one record per CPT / Options Page / Repeater target
//   Layer 3 — ACF field group:  one record per group, ACF JSON Sync compatible
//
// Persisted at strategy_web_projects.roadmap_state.content_model_plan.
// (NOT roadmap_state.acf_plan — that key is taken by cowork's
// organize-acf output. The two are unrelated concepts.)

import type { SectionRole, WebFieldType } from '../../types/database'

// ── Taxonomy ──────────────────────────────────────────────────────────

/** A–G from the spec, plus a Bricks-native alternative for bucket D
 *  that respects this codebase's actual stack (Bricks + ACF Pro). */
export type Structure =
  | 'PLAIN_FIELD'             // A: one-off body copy on one page
  | 'GROUP'                   // B: small fixed cluster of related fields on one page
  | 'REPEATER'                // C: similar items repeating within one page, bounded
  | 'FLEXIBLE_CONTENT'        // D-ACF: ACF Flexible Content
  | 'BRICKS_NESTABLE_SECTION' // D-Bricks: Bricks native (preferred for perf)
  | 'GLOBAL_OPTIONS'          // E: ACF Options page / wp_options single-source
  | 'CUSTOM_POST_TYPE'        // F: CPT (+ optional taxonomies, optional single template)
  | 'EXTERNAL'                // G: managed elsewhere (Church Center, CCB), link/embed only

export type Confidence = 'high' | 'medium' | 'low'

export type ClassificationStatus = 'suggested' | 'confirmed' | 'overridden'

export type CtaTargetKind =
  | 'internal-anchor'
  | 'internal-page'
  | 'external'
  | 'mailto'
  | 'tel'
  | 'unset'

export type EditFrequencyProxy = 'high' | 'medium' | 'low' | 'unknown'

// ── Layer 1: Classification ───────────────────────────────────────────

/** Signals that fed the classifier. Persisted so a reader can see WHY
 *  the analyzer chose a structure without re-running the rules. */
export interface ClassificationSignals {
  /** From web_content_templates.fields[].kind. The strongest repeater signal. */
  kind_in_template: 'slot' | 'group' | null
  /** WebGroupDef.default_count when kind=group. */
  default_count: number | null
  /** Length of the actual filled array in web_sections.field_values. */
  actually_filled_count: number | null
  /** How many other approved pages have a section with the same section_role. */
  section_role_reuse_count: number
  /** Curated mapping from section_role + override count; not measured live. */
  edit_frequency_proxy: EditFrequencyProxy
  /** True when section_role appears in MULTIPLE_LOCATION_ROLES (hero excluded). */
  is_featured_global: boolean
  /** Single-detail section_roles imply this. */
  needs_own_url: boolean
  /** Set when strategy_content_collection_sessions explicitly routes the
   *  partner to a third-party system. */
  external_system: 'church-center' | 'ccb' | 'youtube' | 'vimeo' | 'planning-center' | string | null
  /** Lifted from the existing sanitizeUrl / CTA helpers — distinguishes
   *  mailto, https, anchor, internal page. */
  cta_target_kind: CtaTargetKind
  /** True when any field in this section has field_provenance.source ===
   *  'override'. Used as an edit-presence proxy, not a frequency measure. */
  has_client_overrides: boolean
}

/** One record per isolated content piece. Identified by
 *  `{page_slug}/{item_label}` so the id is stable across re-runs even
 *  when section_id changes (e.g. layout swap). */
export interface ClassificationRecord {
  id: string
  page_slug: string
  page_id: string
  section_id: string
  section_role: SectionRole | null
  /** Stable label for the content piece — derived from template field
   *  key or section_role. e.g. 'next_steps', 'staff_list'. */
  item_label: string
  structure: Structure
  signals: ClassificationSignals
  rationale: string
  /** What the analyzer would pick on its own. Same as `structure` until
   *  a human overrides; then `structure` updates and this stays the
   *  original default for audit. */
  recommended_default: Structure
  /** Optional second-best when the choice is between two reasonable
   *  structures (e.g. Repeater vs Bricks Nestable section). */
  alternative: Structure | null
  open_questions: string[]
  confidence: Confidence
  /** When structure='CUSTOM_POST_TYPE', the wp_object id this record
   *  feeds into. Null otherwise. */
  cpt_subroutine_ref: string | null
  status: ClassificationStatus
  /** Free-text reason a human typed when overriding. */
  override_reason: string | null
}

// ── Layer 2: WordPress object plan ────────────────────────────────────

/** Closed list of WordPress post-type `supports` flags we emit. Shared
 *  between CptRegistrationArgs (the type) and CPT_SUPPORTS (the
 *  curated defaults in rules.ts) so the two vocabularies stay in
 *  lockstep. */
export type CptSupportFlag =
  | 'title'
  | 'editor'
  | 'thumbnail'
  | 'revisions'
  | 'excerpt'
  | 'custom-fields'
  | 'page-attributes'

/** WP register_post_type() registration arguments — emitted verbatim so
 *  dev can paste into PHP. Subset of the full args; we only emit the
 *  flags that actually need a decision. */
export interface CptRegistrationArgs {
  public: boolean
  publicly_queryable: boolean
  has_archive: boolean
  show_ui: boolean
  show_in_menu: boolean
  show_in_rest: boolean
  show_in_nav_menus: boolean
  exclude_from_search: boolean
  supports: CptSupportFlag[]
  menu_icon: string | null
  rewrite: { slug: string; with_front: boolean } | null
}

export interface TaxonomySpec {
  slug: string
  labels: { singular: string; plural: string }
  hierarchical: boolean
  show_in_rest: boolean
}

export interface SingleTemplateSpec {
  enabled: boolean
  /** Brixies template that drives the detail-page render. Hint to dev
   *  about which template to bind in Bricks. */
  brixies_template_id: string | null
  cta_target: CtaTargetKind | null
  rationale: string | null
}

export interface ArchiveSpec {
  enabled: boolean
  /** When false, content is rendered via a Bricks query loop on a
   *  bespoke listing page. Capture which page so dev knows where the
   *  query lives. */
  rendered_via_query_loop_on: string | null
  rationale: string | null
}

/** Custom Post Type record. */
export interface WpObjectCpt {
  id: string                              // 'wp_object.staff'
  kind: 'custom_post_type'
  slug: string                            // 'staff'
  labels: { singular: string; plural: string }
  registration_args: CptRegistrationArgs
  taxonomies: TaxonomySpec[]
  single_template: SingleTemplateSpec
  archive: ArchiveSpec
  /** Derived: single_template.enabled === false && archive.enabled ===
   *  false && registration_args.publicly_queryable === false. */
  headless: boolean
  external_system: ClassificationSignals['external_system']
  /** Future hook for the Church Center / CCB capability KB. */
  external_limits: string[] | null
  /** ACF field-group ids that target this post type. */
  field_group_refs: string[]
  open_questions: string[]
  confidence: Confidence
  /** Verbatim partner answers from the relevant content-collection
   *  block (events / sermons / groups). Populated only for CPTs that
   *  derive from a display_preference signal. Surfaces what the
   *  partner said about their current system, URLs they linked, and
   *  any context fields. Dev reads this to understand WHY a CPT
   *  exists, not just THAT it does. */
  _content_collection_answers?: {
    content_kind: 'events' | 'sermons' | 'groups'
    fields: Array<{ field: string; label: string; value: unknown }>
  }
}

/** Options Page record (site-wide single-source content). */
export interface WpObjectOptionsPage {
  id: string                              // 'wp_object.global_site'
  kind: 'options_page'
  slug: string                            // 'global-site'
  menu_title: string
  capability: string                      // typically 'manage_options'
  /** ACF field-group id whose location rule pins to this options page. */
  field_group_ref: string
  /** Field names sourced from strategy_web_projects columns we already
   *  store. Listed so dev knows which existing data to migrate. */
  seeded_from_project_columns: string[]
  open_questions: string[]
  confidence: Confidence
}

/** Repeater target — typically attached to a single page, not a CPT.
 *  Useful when a Repeater (bucket C) is the structural pick. */
export interface WpObjectRepeater {
  id: string                              // 'wp_object.imnew_next_steps'
  kind: 'repeater'
  on_page_slug: string
  /** ACF field-group id whose location rule pins to that page template. */
  field_group_ref: string
  rationale: string
  open_questions: string[]
  confidence: Confidence
}

/** External system reference — no WP object built, but recorded for
 *  the dev-handoff sheet so they don't accidentally create one. */
export interface WpObjectExternal {
  id: string                              // 'wp_object.external.events'
  kind: 'external'
  section_role: SectionRole | null
  external_system: ClassificationSignals['external_system']
  display_mode: 'link-out' | 'embed' | 'contact'
  rationale: string
}

export type WpObject =
  | WpObjectCpt
  | WpObjectOptionsPage
  | WpObjectRepeater
  | WpObjectExternal

// ── Layer 3: ACF field group ──────────────────────────────────────────

/** Subset of ACF field types we'll actually emit. The full ACF type
 *  vocabulary is larger; we map only what the Brixies WebFieldType
 *  vocabulary produces, plus the route-driven specializations below
 *  that the CTA-route analyzer can promote a generic URL field to. */
export type AcfFieldType =
  | 'text'
  | 'wysiwyg'
  | 'image'
  | 'url'
  | 'email'
  | 'date_time_picker'
  | 'true_false'
  | 'google_map'
  | 'group'
  | 'repeater'
  | 'taxonomy'
  // Route-driven specializations applied by the CTA-analysis pass
  // when a button field is consistently used for one destination
  // type across all records. The original `cta`/`url` field becomes
  // one of these so McNeel's ACF config matches editor intent:
  | 'file'          // ACF File — editor uploads instead of pasting URLs
  | 'oembed'        // ACF oEmbed — auto-embed for YouTube / Vimeo
  | 'page_link'     // ACF Page Link — picker over existing WP pages

export interface AcfField {
  key: string                             // ACF field key — must start with 'field_'
  name: string                            // machine name
  label: string
  type: AcfFieldType
  required?: boolean
  /** ACF Pro's native field-help text. Shown to the editor under the
   *  field in WP admin AND exported in ACF JSON Sync as `instructions`.
   *  Populated on canonical CPT fields where the partner expectation
   *  isn't obvious from the label alone. */
  instructions?: string
  sub_fields?: AcfField[]                 // populated when type='group' | 'repeater'
  taxonomy?: string                       // populated when type='taxonomy'
  /** Brixies-side reference so dev can trace what each ACF field came
   *  from. Not part of the ACF JSON Sync export. */
  _source?: {
    web_field_type: WebFieldType
    template_field_key: string
  }
  /** Set on CTA-shaped fields after the route-classification pass.
   *  Tells McNeel "this button consistently points at <route> across
   *  N records → use ACF type X instead of generic URL." */
  _cta_analysis?: {
    total_records: number
    by_route_type: Record<string, number>
    recommended_acf_type: AcfFieldType
    reason: string
    /** Set to true when we promoted the field's `type` based on the
     *  recommendation (vs leaving it at the Brixies-default mapping). */
    type_promoted: boolean
  }
}

/** ACF location rule. We emit three variants depending on the parent
 *  WpObject kind: post_type==X (CPTs), options_page==X (Options page),
 *  page_template==X (Repeater scoped to a specific page template). */
export interface AcfLocationRule {
  param: 'post_type' | 'options_page' | 'page_template'
  operator: '=='
  value: string
}

export interface AcfFieldGroup {
  key: string                             // 'group_staff'
  title: string                           // 'Staff Member fields'
  fields: AcfField[]
  /** ACF supports nested arrays as OR-of-AND. We always emit a single
   *  AND-row, wrapped in the outer array for JSON-Sync shape. */
  location: AcfLocationRule[][]
  position: 'normal' | 'side' | 'acf_after_title'
  style: 'default' | 'seamless'
  /** Brixies-side hint: which sections feed into this group, so dev
   *  can spot-check the field list against the source layouts. */
  _source_section_ids?: string[]
  /** Actual partner content lifted from web_sections.field_values,
   *  shaped to align with the field group's `fields` so the dev's AI
   *  assistant can populate WP records directly after the CPT /
   *  Options page is registered. One row per record (one per CPT
   *  post; one row total for Options; N rows for a Repeater). */
  _content_rows?: Array<Record<string, unknown>>
}

// ── Top-level envelope ────────────────────────────────────────────────

/** Per-section discovery summary — the human-facing "what's here"
 *  view that powers the dev handoff's discovery section. One entry
 *  per approved web_section, grouped by page at render time. Carries
 *  heading + item count + schema + sample names + target hint so
 *  McNeel can scan-and-disagree without having to read the analyzer's
 *  CPT-grouped suggestion. */
export interface DiscoverySection {
  section_id:        string
  web_page_id:       string
  page_slug:         string
  page_name:         string
  /** Display heading lifted from field_values.primary_heading /
   *  .heading. Falls back to section_role_label, then the template's
   *  layer_name, then a generic placeholder. */
  heading:           string
  section_role:      SectionRole | null
  /** Number of records in the section's primary repeating field. 1
   *  when the section has no group/repeater (treats the section
   *  itself as one record). */
  item_count:        number
  /** Distinct field keys observed across the section's items (or the
   *  top-level slot keys when the section isn't a group). */
  schema:            string[]
  /** First 3 humanish names from the items array — useful "preview"
   *  of what the section contains at a glance. */
  sample_names:      string[]
  /** One complete record from the section's items array (or the
   *  section itself when not group-shaped), with every schema field
   *  + its actual value. Dev reads this to see what a real instance
   *  of this content looks like in the partner's site. Values are
   *  raw — HTML stripping + truncation happens at render time. */
  sample_record:     Record<string, unknown> | null
  /** Strategist-readable hint about what each item should land as.
   *  Detail role → 'individual-page'; listing role with CPT single
   *  template enabled → 'individual-page'; listing role without
   *  single → 'flat-list'; group/contact display preference → 'mailto';
   *  embed/external display preference → 'embed' or 'external';
   *  unknown otherwise (strategist confirms). */
  target_hint:       'individual-page' | 'flat-list' | 'embed' | 'external' | 'mailto' | 'unknown'
  /** Link to the analyzer's suggested WpObject (for cross-reference). */
  cpt_subroutine_ref: string | null
  /** Partner-supplied context for sections tied to content-collection
   *  display_preferences (events / sermons / groups). Surfaces the
   *  partner's own answers about display mode, embed source URL,
   *  filter needs, CTA target etc. — the missing detail that makes
   *  these sections actually buildable. Null when the section role
   *  doesn't map to a content-collection kind. */
  partner_context?: {
    content_kind: 'events' | 'sermons' | 'groups'
    /** Display preference value (e.g. 'wordpress', 'archive_pages',
     *  'contact', 'embed'). */
    display_preference: string | null
    /** Free-text format note ("Calendar view", "Grid"). Events only. */
    display_format?: string | null
    /** External source URL — for embeds, this is the third-party
     *  URL the partner wants the section pulling from. For wordpress
     *  mode, this is often the partner's current-site sample URL. */
    external_url?: string | null
    /** "Current source of truth" answer — what system the partner is
     *  migrating away from. */
    source_of_truth?: string | null
    /** Free-text frustration the partner has with their current
     *  system. Helps the dev avoid repeating mistakes. */
    frustration?: string | null
    /** Sermon-specific: YouTube playlist URL when the partner has one. */
    playlist_url?: string | null
    /** Sermon-specific: archive feature flags (notes, audio, podcast, filters). */
    archive_features?: string[] | null
  }

  // ── Content diagnosis (added in v1.5) ───────────────────────────────
  // Per-section schema classification + field-level diagnostics. Fed by
  // the classifySchema pipeline (rules first, LLM fallback). All fields
  // here are OPTIONAL so existing readers keep working until the
  // pipeline has run.

  /** Canonical schema name from the inventory-schema-audit.md Part 2
   *  vocabulary — 'group_card', 'ministry_program_card', 'pathway_step',
   *  'feature_card', 'service_time', 'person_card', 'event_card',
   *  'sermon_card', 'faq_qna', 'volunteer_opportunity', 'blog_post_card',
   *  'way_to_give_card', 'featured_campaign_card', 'location_card',
   *  'testimony_card', 'career_card', 'pathway_step', 'Resources'.
   *  Null when no canonical shape fits (the section is copy-only or has
   *  no repeating items). */
  schema_name?: SchemaName | null

  /** Confidence in the schema_name classification. 'high' when rules
   *  match cleanly; 'medium' when LLM fallback resolved; 'low' when the
   *  LLM was unsure. */
  schema_confidence?: Confidence

  /** Per-field diagnostic. fill_count/fill_total tracks the partner's
   *  data quality. in_bound_template flags whether the BOUND template
   *  carries a slot for this field — when false, the field is in the
   *  schema (and in the source) but is dropped at render. That's the
   *  signal that drives build-time-errors.md library coverage entries. */
  schema_field_diagnostics?: Array<{
    key: string
    fill_count: number
    fill_total: number
    in_bound_template: boolean
  }>

  /** CTA target type counts across items in this section. Lets the
   *  dev see at a glance: "4 external_url + 1 mailto" vs "6 internal_route". */
  cta_target_breakdown?: Partial<Record<DiagnosedCtaKind, number>>

  /** Build-time issues the diagnostic surfaced on this section. Two
   *  kinds:
   *    - library_coverage_gap: the bound template doesn't carry slots
   *      for fields the schema declares (diagnosed at bound layer).
   *    - upstream_compression_loss: the source inventory has fields
   *      that cowork's uniform shape dropped before binding (diagnosed
   *      by comparing inventory layer to bound layer). These are the
   *      "real" losses — invisible at bound layer alone.
   *  Both pipe to handoffs/build-time-errors.md as squad backlog. */
  build_time_issues?: Array<
    | {
        kind: 'library_coverage_gap'
        template_id: string
        dropped_fields: string[]
        severity: 'high' | 'medium' | 'low'
      }
    | {
        kind: 'upstream_compression_loss'
        /** Schema this loss affects (e.g. 'person_card'). */
        schema_name: SchemaName
        /** Fields populated in inventory but absent from every bound
         *  section of this schema. */
        dropped_fields: string[]
        /** Section IDs of bound sections affected by this loss. */
        affected_section_ids: string[]
        severity: 'high' | 'medium' | 'low'
      }
  >

  /** Strategist confirmation / override on the classifier's output.
   *  Persisted across recomputes so the strategist's review doesn't
   *  get blown away. When set, the recompute respects this value
   *  instead of re-running the rules. */
  schema_override?: {
    /** What the strategist chose. Null = "this isn't a schema-bearing
     *  section, classifier was wrong to label it." */
    schema_name: SchemaName | null
    confirmed_at: string
    confirmed_by: string
    /** Optional note explaining why (helps train future classifier
     *  rule changes). */
    note?: string
  }

  /** Strategist-declared content model this section feeds (when one
   *  exists). Populated by buildDiscoverySections when the section's
   *  id appears in any model's `section_ids` on
   *  roadmap_state.content_models. Overrides the inferred schema +
   *  drives the WP-objects layer.
   *
   *  When `item_indices` is set, the strategist has restricted the
   *  binding to a subset of the section's primary-group items (e.g.
   *  Feature 22 has 3 cards but only 2 are services). The discovery
   *  row's `item_count`, `schema`, `sample_names`, `sample_record`,
   *  and `schema_field_diagnostics` reflect the FILTERED items so
   *  the dev sees the model's actual shape, not the section's raw
   *  composition. Indices are 0-based into the section's primary
   *  group as the strategist saw it in the Content Model panel.
   *
   *  When per-card filtering can't be applied (e.g. the analyzer
   *  drilled into a nested group whose count no longer matches the
   *  strategist's top-level indices), `item_indices` is still set so
   *  the UI can show the strategist's intent — but counts/schema
   *  remain unfiltered with `item_indices_applied: false`. */
  declared_content_model?: {
    id: string
    name: string
    /** Indices the strategist scoped the binding to. Omitted when
     *  the model covers the whole section. */
    item_indices?: number[]
    /** False when the analyzer couldn't safely apply the per-card
     *  filter because the projectedItems count diverged from the
     *  top-level group (nested-group drilling case). Lets the UI
     *  surface "model says items 0,2 — but section drills to a deeper
     *  group, so the filter wasn't applied." */
    item_indices_applied?: boolean
  }
}

/** Canonical schema vocabulary — kept in sync with
 *  handoffs/inventory-schema-audit.md Part 2. When you add a new schema
 *  there, add it here and update CANONICAL_SCHEMAS in rules.ts. */
export type SchemaName =
  | 'person_card'
  | 'sermon_card'
  | 'event_card'
  | 'service_time'
  | 'faq_qna'
  | 'ministry_program_card'
  | 'volunteer_opportunity'
  | 'group_card'
  | 'pathway_step'
  | 'blog_post_card'
  | 'way_to_give_card'
  | 'featured_campaign_card'
  | 'testimony_card'
  | 'career_card'
  | 'location_card'
  | 'feature_card'
  | 'Resources'

/** CTA target types surfaced by the diagnostic. Aligned with the CTA
 *  target vocabulary in inventory-schema-audit.md Part 1. Distinct from
 *  CtaTargetKind (which is the existing Layer 1 classifier's narrower
 *  set) — this vocabulary is finer-grained and reflects what the
 *  diagnostic emits to the dev. */
export type DiagnosedCtaKind =
  | 'internal_route'
  | 'external_url'
  | 'mailto'
  | 'tel'
  | 'file_download'
  | 'signup_form'
  | 'anchor'
  | 'next_step'
  | 'no_link'

/** Persisted at strategy_web_projects.roadmap_state.content_model_plan. */
export interface ContentModelPlan {
  /** Bumped when the analyzer's output shape changes in a breaking way.
   *  Readers should check this before destructuring. */
  schema_version: 1
  _meta: {
    generated_at: string                  // ISO timestamp
    generated_by: 'analyzer-v1' | string
    /** Hash of the inputs that produced this plan. Used to detect when
     *  the plan is stale relative to the underlying sections. */
    input_fingerprint: string
    /** Counts for at-a-glance scanning. */
    counts: {
      classifications: number
      wp_objects:      number
      acf_field_groups: number
      open_questions:  number
      low_confidence:  number
    }
  }
  layer_1_classifications: ClassificationRecord[]
  layer_2_wp_objects:      WpObject[]
  layer_3_acf_field_groups: AcfFieldGroup[]
  /** Per-section discovery (added in v1.4 — the human-facing view).
   *  Older plans without this field render the discovery section
   *  empty; recompute to populate. */
  discovery_sections?:     DiscoverySection[]
  /** Inventory-layer discovery (added in v1.6). Per-topic rows
   *  classified from web_project_topics.items BEFORE binding. Lets
   *  the dev see schemas the partner HAS in source even when no
   *  bound section exists, and feeds the inventory-vs-bound
   *  comparator that surfaces real upstream compression losses. */
  inventory_discovery?:    InventoryDiscoveryRowType[]
}

/** Type-only re-export to avoid circular import. The runtime type
 *  lives in inventoryDiagnosis.ts; we mirror the public shape here
 *  so ContentModelPlan can reference it without pulling the module. */
export interface InventoryDiscoveryRowType {
  source:              'inventory'
  section_id:          string
  web_page_id:         string
  page_slug:           string
  page_name:           string
  heading:             string
  section_role:        null
  item_count:          number
  schema:              string[]
  sample_names:        string[]
  sample_record:       Record<string, unknown> | null
  target_hint:         DiscoverySection['target_hint']
  cpt_subroutine_ref:  null
  total_topic_items:   number
  dominant_kind:       string | null
  schema_name?:        DiscoverySection['schema_name']
  schema_confidence?:  DiscoverySection['schema_confidence']
  schema_field_diagnostics?: DiscoverySection['schema_field_diagnostics']
  cta_target_breakdown?:     DiscoverySection['cta_target_breakdown']
  build_time_issues?:        DiscoverySection['build_time_issues']
}
