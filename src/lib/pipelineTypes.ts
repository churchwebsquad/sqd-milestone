/**
 * Output shapes for each of the 8 copywriting pipeline stages.
 *
 * Each stage writes its artifact to
 * `strategy_web_projects.roadmap_state.stage_<N>` as JSONB.
 * Stages 1 + 2 are pre-existing — their shapes are documented here
 * to match the live writers (api/web/agents/extract-strategy.ts and
 * api/web/agents/draft-sitemap.ts). Stages 3-8 are new and these
 * are the canonical types.
 *
 * Pipeline state machine:
 *   stage_N.status: 'draft' (just written by agent) → 'approved'
 *                   (strategist gated it) → 'superseded' (next run
 *                   was started → old artifact archived).
 */

import type { PipelineStage } from './pipelinePrompts'

/** Status common to every stage artifact. */
export type StageStatus = 'draft' | 'approved' | 'superseded'

export interface StageMeta {
  status:        StageStatus
  generated_at:  string                  // ISO timestamp
  model:         string                  // e.g. 'claude-opus-4-7'
  prompt_source: 'db' | 'fallback'       // from resolvePrompt
  has_project_addendum: boolean
  redo_count:    number                  // # of redos before this draft
}

// ─── Stage 1 — Synthesize ──────────────────────────────────────

export interface Stage1Persona {
  name:               string
  need:               string
  goal:               string
  voice_resonance:    string             // how voice should land for them
}

export interface Stage1Page {
  slug:               string
  rationale:          string
  carry_forward_from: string | null      // current-site URL/slug if applicable
}

export interface Stage1SeoTargets {
  page_slug:        string
  search_phrases:   string[]             // ranking queries
  answer_intents:   string[]             // AEO conversational queries
  geo_anchors:      string[]             // local landmarks / city references
}

export interface Stage1Output {
  audience: {
    primary:   string
    secondary: string
  }
  voice_characteristics: {
    signature_moves:  string[]
    sample_sentences: string[]
  }
  personas:           Stage1Persona[]
  x_factor:           string
  project_goals:      string[]
  total_page_count:   number
  recommended_pages:  Stage1Page[]
  existing_pages_to_carry_forward: Stage1Page[]
  seo_targets:        Stage1SeoTargets[]
  sources_used:       string[]           // filenames referenced
  _meta:              StageMeta
}

// ─── Stage 2 — Sitemap ─────────────────────────────────────────

export interface Stage2Page {
  slug:        string
  name:        string
  phase:       '1' | '2' | 'global' | 'nav-only'
  parent_slug: string | null
  aeo_keywords: string[]
  cs_flags:    string[]                  // content-service follow-ups
}

export interface Stage2NavItem {
  label:    string
  slug:     string | null                // null for parent-only headers
  children: Stage2NavItem[]
}

export interface Stage2Output {
  pages:                Stage2Page[]
  header_nav:           Stage2NavItem[]
  footer_nav:           Stage2NavItem[]
  content_coverage_audit: {
    covered: string[]
    gaps:    string[]
  }
  vocabulary_decisions: Record<string, string>  // e.g. "service" → "gathering"
  aeo_keywords:         string[]
  cs_flags:             string[]
  sources_used:         string[]
  _meta:                StageMeta
}

// ─── Stage 3 — Page inventory ──────────────────────────────────

export type SuggestedTreatment =
  | 'hero_anchor'
  | 'section_body'
  | 'card_in_grid'
  | 'sidebar_callout'
  | 'footer_link'
  | 'cta_button'
  | 'schema_only'

export interface Stage3Placement {
  source_id:           string            // atom_id or fact_id
  source_kind:         'atom' | 'fact'
  primary_page_slug:   string
  reference_pages:     Array<{ slug: string; treatment: SuggestedTreatment }>
  suggested_treatment: SuggestedTreatment
  rationale:           string
}

export interface Stage3Orphan {
  source_id:    string
  source_kind:  'atom' | 'fact'
  rationale:    string
  suggested_action: 'archive' | 'request_more_content' | 'reroute_to_global_snippet'
}

export interface Stage3Output {
  atom_placements: Stage3Placement[]
  fact_placements: Stage3Placement[]
  orphans:         Stage3Orphan[]
  per_page_atom_count: Record<string, number>  // slug → count
  _meta:           StageMeta
}

// ─── Stage 4 — Page outlines ───────────────────────────────────

export type DisplayOptionKind =
  | 'card_grid'
  | 'split_column'
  | 'accordion'
  | 'tabs'
  | 'timeline'
  | 'cta_hero'
  | 'feature_strip'
  | 'staff_grid'
  | 'gallery'
  | 'rich_text_long'
  | 'process_steps'

export interface Stage4DisplayOption {
  kind:        DisplayOptionKind
  rationale:   string
  fits_count?: number                    // optional — # of items it can hold
}

export interface Stage4Section {
  section_id:       string               // synthesized per outline
  section_job:      string
  content_summary:  string               // plain prose, no markdown
  display_options:  Stage4DisplayOption[]
  atoms_used:       string[]
  voice_notes:      string | null
}

export interface Stage4PageOutline {
  page_slug:    string
  sections:     Stage4Section[]
  voice_notes:  string | null
}

export interface Stage4Output {
  page_outlines: Stage4PageOutline[]
  _meta:         StageMeta
}

// ─── Stage 5 — Bind (writes web_pages + web_sections) ──────────

export interface Stage5SectionResult {
  section_id:        string              // from Stage 4
  template_id:       string              // chosen Brixies template
  template_rationale: string
  field_values:      Record<string, unknown>
  source_markdown:   string              // reconstructed via fieldValuesToDocHtml round-trip
  atoms_landed:      string[]
  atoms_deferred:    string[]            // moved to Stage 6 orphan candidates
}

export interface Stage5Output {
  // Per page → section results, in render order
  page_results: Array<{
    page_slug: string
    web_page_id: string                  // FK to web_pages row that got written
    sections:    Stage5SectionResult[]
  }>
  _meta:        StageMeta
}

// ─── Stage 6 — Coverage QA ─────────────────────────────────────

export interface Stage6LandedItem {
  source_id:   string
  source_kind: 'atom' | 'fact'
  landed_in:   Array<{ web_section_id: string; field_key: string; snippet: string }>
}

export interface Stage6PartialItem {
  source_id:    string
  source_kind:  'atom' | 'fact'
  landed_in:    Array<{ web_section_id: string; field_key: string; snippet: string }>
  missing_info: string                   // what got dropped
}

export interface Stage6Orphan {
  source_id:        string
  source_kind:      'atom' | 'fact'
  rationale:        string
  suggested_remedy: 'reroute' | 'request_partner_content' | 'archive' | 'add_new_section'
}

export interface Stage6Output {
  landed:           Stage6LandedItem[]
  partially_landed: Stage6PartialItem[]
  orphaned:         Stage6Orphan[]
  total_score:      number               // percentage 0-100
  _meta:            StageMeta
}

// ─── Stage 7 — Voice pass ──────────────────────────────────────

export interface Stage7Rewrite {
  web_section_id:         string
  field_key:              string
  old_value:              string
  new_value:              string
  voice_alignment_score:  number         // 0-100, model-reported
  rationale:              string
  skipped:                false
}

export interface Stage7Skipped {
  web_section_id:  string
  field_key:       string
  reason:          'already_on_voice' | 'override_locked' | 'over_budget_after_rewrite'
  skipped:         true
}

export interface Stage7Output {
  rewrites:      Stage7Rewrite[]
  skipped:       Stage7Skipped[]
  cost_estimate: {
    haiku_calls:  number
    sonnet_calls: number
    est_usd:      number
  }
  _meta:         StageMeta
}

// ─── Stage 8 — Final QA ────────────────────────────────────────

export type Stage8Severity = 'blocker' | 'warning' | 'nit'

export interface Stage8Finding {
  severity:        Stage8Severity
  page_slug:       string | null         // null for site-wide findings
  web_section_id:  string | null
  category:        'nav_parity' | 'persona_coverage' | 'voice_drift' | 'merge_field' | 'seo'
  issue:           string
  suggested_fix:   string
}

export interface Stage8Output {
  findings: Stage8Finding[]
  scores: {
    nav_parity:        number            // 0-100
    persona_coverage:  number
    voice_consistency: number
    merge_field_resolution: number
    seo_completeness:  number
    overall:           number            // weighted average
  }
  _meta: StageMeta
}

// ─── Roadmap state container ──────────────────────────────────

export interface RoadmapState {
  stage_1?: Stage1Output
  stage_2?: Stage2Output
  stage_3?: Stage3Output
  stage_4?: Stage4Output
  stage_5?: Stage5Output
  stage_6?: Stage6Output
  stage_7?: Stage7Output
  stage_8?: Stage8Output
  // Archived prior runs — keys like stage_3_v2_2026-06-04. The
  // pipeline orchestrator moves the current draft here when the
  // user redoes a stage so we can compare.
  history?: Record<string, unknown>
}

// ─── Stage lookup helpers ─────────────────────────────────────

/** Key in roadmap_state for a given stage. */
export function stageKey(stage: PipelineStage): keyof RoadmapState {
  const n = STAGE_TO_NUMBER[stage]
  return `stage_${n}` as keyof RoadmapState
}

const STAGE_TO_NUMBER: Record<PipelineStage, number> = {
  synthesize:     1,
  sitemap:        2,
  page_inventory: 3,
  outlines:       4,
  bind:           5,
  coverage_qa:    6,
  voice_pass:     7,
  final_qa:       8,
}
