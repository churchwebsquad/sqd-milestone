/**
 * Strategic Goals — type definitions + field metadata.
 *
 * The Strategic Goals workspace mirrors Core Messages but covers WHY
 * (goals, vision, intent) and the constraints around HOW (copy
 * approach, nav satisfaction, display preferences). The data is
 * aggregated from three source tables into a single curated jsonb
 * block on `strategy_web_projects.roadmap_state.strategic_goals` that
 * the AI pipeline reads as its strategic-intent input.
 *
 *   Source tables:
 *     - strategy_discovery_questionnaire (9 typed columns)
 *     - strategy_content_collection_sessions (4 typed columns)
 *     - strategy_account_progress.handoff_web_form->'form'   (5 JSONB keys)
 *
 * Field metadata below names each field's category, source, the
 * pipeline steps that should consume it, and whether it's
 * high-importance enough to gate the inventory-readiness warning.
 */

export type StrategicGoalCategory =
  | 'goals_and_vision'
  | 'voice_and_tone'
  | 'content_and_allocation'
  | 'display_and_technical'
  | 'inspiration_and_notes'

export type StrategicGoalSource =
  | 'discovery'
  | 'content_collection'
  | 'am_handoff'

export type StrategicGoalStatus =
  | 'draft'      // strategist hasn't reviewed
  | 'approved'   // flowing to pipeline
  | 'archived'   // suppressed from pipeline

/** Per-field record on `roadmap_state.strategic_goals.<category>.<key>`. */
export interface StrategicGoalField {
  value:            string | number | null
  source_kind:      StrategicGoalSource
  source_ref:       string | null            // member number / session id / handoff JSONB path
  status:           StrategicGoalStatus
  last_synced_at:   string | null            // ISO ts of last refresh from source
  strategist_edited: boolean                  // true if value diverged from source after edit
  /** Derived values computed at aggregation time + carried for pipeline use. */
  derived?: {
    /** `current_navigation_satisfaction` rule
     *   ≤6 → 'full_rewrite' / 7-8 → 'partial' / 9 → 'tweaks' / 10 → 'preserve'. */
    nav_change_level?: 'full_rewrite' | 'partial' | 'tweaks' | 'preserve'
    /** `copy_approach` → intended verbatim ratio band for outline/draft. */
    intended_verbatim_band?: 'high' | 'mid' | 'low'
    /** `additional_clarifications` — which step's context the strategist
     *  routed this to (defaults to 'unrouted' until classified). */
    routed_to?: string[]
    /** `inspirational_websites` — phrases the scanner pulled out for
     *  Design Handoff so the designer sees the strategic ask, not just
     *  the URL. Closed taxonomy; see scanStrategicPhrases() in Phase 3. */
    scanned_strategic_phrases?: string[]
  }
}

/** Per-category block. Field-key → field record. */
export type StrategicGoalCategoryBlock = Record<string, StrategicGoalField>

/** Top-level shape stored on `roadmap_state.strategic_goals`. */
export interface StrategicGoalsSnapshot {
  _meta: {
    generated_at:        string                                   // ISO
    version:             number                                   // schema version (bump on shape change)
    sources_synced_from: Array<{ kind: StrategicGoalSource; ref: string; synced_at: string }>
  }
  goals_and_vision:       StrategicGoalCategoryBlock
  voice_and_tone:         StrategicGoalCategoryBlock
  content_and_allocation: StrategicGoalCategoryBlock
  display_and_technical:  StrategicGoalCategoryBlock
  inspiration_and_notes:  StrategicGoalCategoryBlock
}

/** Field-definition record. Drives the aggregator (which source table
 *  + column to read) AND the workspace (what title + description to
 *  show in the card). One source of truth for both layers. */
export interface StrategicGoalFieldDef {
  key:              string
  label:            string                          // strategist-language UI title
  category:         StrategicGoalCategory
  source:           StrategicGoalSource
  source_column:    string                          // table column OR handoff JSONB key
  description:      string                          // 1-line "what this drives"
  pipeline_consumers: ReadonlyArray<string>         // step keys that consume the field
  importance:       'high' | 'medium'               // high fields gate the readiness warning
}

/** Category metadata — ordering + display label. */
export interface StrategicGoalCategoryDef {
  key:         StrategicGoalCategory
  label:       string
  description: string
  order:       number
}

export const STRATEGIC_GOAL_CATEGORIES: ReadonlyArray<StrategicGoalCategoryDef> = [
  {
    key: 'goals_and_vision',
    label: 'Goals & Vision',
    description: 'What the church is trying to achieve with this site, and the emotional outcome they want for the user.',
    order: 1,
  },
  {
    key: 'voice_and_tone',
    label: 'Voice & Tone',
    description: 'The recurring messages + one-line emotional anchor that page copy should sound like.',
    order: 2,
  },
  {
    key: 'content_and_allocation',
    label: 'Content & Allocation',
    description: 'How the strategist wants content treated (verbatim vs rewrite), which ministries get emphasis, and AM-flagged content needs.',
    order: 3,
  },
  {
    key: 'display_and_technical',
    label: 'Display & Technical',
    description: 'How specific page types (sermons, events, groups) should render, and what software the site has to integrate with.',
    order: 4,
  },
  {
    key: 'inspiration_and_notes',
    label: 'Inspiration & Notes',
    description: 'Reference sites the partner liked, timeline constraints, and other notes that route to specific handoffs.',
    order: 5,
  },
] as const

/** Every strategic-goal field, in display order within its category.
 *  The aggregator endpoint loops this list; the workspace renders it.
 *  Adding a new field = add one entry here + extend the parser. */
export const STRATEGIC_GOAL_FIELDS: ReadonlyArray<StrategicGoalFieldDef> = [
  // ── Goals & Vision ─────────────────────────────────────────────
  {
    key: 'top_3_website_goals',
    label: 'Top website goals',
    category: 'goals_and_vision',
    source: 'discovery',
    source_column: 'top_3_website_goals',
    description: 'The 1-3 outcomes the partner most wants the site to drive (e.g. "Help first-time visitors find information easily").',
    pipeline_consumers: ['synthesize-strategy', 'plan-site-strategy', 'plan-cross-page-allocation', 'plan-page-seo'],
    importance: 'high',
  },
  {
    key: 'primary_goals',
    label: 'Primary goals (AM)',
    category: 'goals_and_vision',
    source: 'am_handoff',
    source_column: 'primaryGoals',
    description: 'The AM\'s read of the partner\'s primary site goals and target audiences — usually more concrete than the questionnaire answer.',
    pipeline_consumers: ['plan-site-strategy', 'plan-page-seo'],
    importance: 'high',
  },
  {
    key: 'church_vision',
    label: 'Church vision',
    category: 'goals_and_vision',
    source: 'am_handoff',
    source_column: 'churchVision',
    description: 'The emotional outcome the partner most wants from the site — used by critique as a vision-fit check on every page.',
    pipeline_consumers: ['critique-page', 'synthesize-critique'],
    importance: 'medium',
  },
  {
    key: 'ideal_website_experience',
    label: 'Ideal experience',
    category: 'goals_and_vision',
    source: 'discovery',
    source_column: 'ideal_website_experience',
    description: 'How the partner describes the experience they want a visitor to have on the finished site.',
    pipeline_consumers: ['synthesize-strategy', 'plan-site-strategy', 'plan-cross-page-allocation', 'plan-page-seo'],
    importance: 'medium',
  },

  // ── Voice & Tone ───────────────────────────────────────────────
  {
    key: 'one_key_message',
    label: 'One key message',
    category: 'voice_and_tone',
    source: 'discovery',
    source_column: 'one_key_message',
    description: 'The single sentence the partner wants every visitor to walk away with — used as a voice anchor by outline + draft.',
    pipeline_consumers: ['synthesize-strategy', 'outline-page', 'draft-page'],
    importance: 'high',
  },
  {
    key: 'recurring_message_theme',
    label: 'Recurring theme',
    category: 'voice_and_tone',
    source: 'discovery',
    source_column: 'recurring_message_theme',
    description: 'The repeated message the church returns to from the pulpit — anchors page copy in the same theological centre.',
    pipeline_consumers: ['synthesize-strategy', 'outline-page', 'draft-page'],
    importance: 'medium',
  },

  // ── Content & Allocation ───────────────────────────────────────
  {
    key: 'copy_approach',
    label: 'Copy approach',
    category: 'content_and_allocation',
    source: 'discovery',
    source_column: 'copy_approach',
    description: 'How much existing copy to keep verbatim vs. rewrite. Drives the verbatim ratio outline + draft must hit on each section.',
    pipeline_consumers: ['plan-cross-page-allocation', 'outline-page', 'draft-page'],
    importance: 'high',
  },
  {
    key: 'content_needs',
    label: 'Content needs (AM)',
    category: 'content_and_allocation',
    source: 'am_handoff',
    source_column: 'contentNeeds',
    description: 'The AM\'s read of what content is missing, weak, or needs to be written from scratch.',
    pipeline_consumers: ['plan-cross-page-allocation', 'outline-page'],
    importance: 'medium',
  },
  {
    key: 'best_outreach_methods',
    label: 'Best outreach methods',
    category: 'content_and_allocation',
    source: 'discovery',
    source_column: 'best_outreach_methods',
    description: 'The outreach programs (events, ministries) that already work for connecting with the community.',
    pipeline_consumers: ['plan-cross-page-allocation', 'outline-page', 'plan-page-seo'],
    importance: 'medium',
  },
  {
    key: 'ministries_to_grow',
    label: 'Ministries to grow',
    category: 'content_and_allocation',
    source: 'content_collection',
    source_column: 'ministries_to_grow',
    description: 'The 1-2 ministries the partner is actively trying to grow — gets navigation prominence + homepage emphasis + clear progression CTAs.',
    pipeline_consumers: ['plan-site-strategy', 'plan-cross-page-allocation', 'outline-page', 'plan-page-seo'],
    importance: 'medium',
  },
  {
    key: 'additional_clarifications',
    label: 'Additional clarifications (AM)',
    category: 'content_and_allocation',
    source: 'am_handoff',
    source_column: 'additionalClarifications',
    description: 'Free-form notes the AM added — strategist routes each item to the step that should hear about it.',
    pipeline_consumers: ['plan-site-strategy', 'plan-cross-page-allocation', 'outline-page'],
    importance: 'medium',
  },

  // ── Display & Technical ────────────────────────────────────────
  {
    key: 'current_navigation_satisfaction',
    label: 'Nav satisfaction (1–10)',
    category: 'display_and_technical',
    source: 'discovery',
    source_column: 'current_navigation_satisfaction',
    description: 'How happy the partner is with their current nav. ≤6 → full rewrite; 7-8 → partial; 9 → tweaks only; 10 → preserve.',
    pipeline_consumers: ['plan-site-strategy'],
    importance: 'medium',
  },
  {
    key: 'software_in_use',
    label: 'Software in use',
    category: 'display_and_technical',
    source: 'discovery',
    source_column: 'software_in_use',
    description: 'Existing software (Planning Center, giving providers, etc.) the site has to integrate with — shown on Dev Handoff.',
    pipeline_consumers: [],
    importance: 'medium',
  },
  {
    key: 'sermons_display_preference',
    label: 'Sermons display',
    category: 'display_and_technical',
    source: 'content_collection',
    source_column: 'sermons_display_preference',
    description: 'How the partner wants sermons rendered (embed most-recent vs. archive). Drives the sermon page template.',
    pipeline_consumers: ['outline-page'],
    importance: 'medium',
  },
  {
    key: 'events_display_preference',
    label: 'Events display',
    category: 'display_and_technical',
    source: 'content_collection',
    source_column: 'events_display_preference',
    description: 'Card / list / calendar — drives the events grid variant on Site Library.',
    pipeline_consumers: [],
    importance: 'medium',
  },
  {
    key: 'groups_display_preference',
    label: 'Groups display',
    category: 'display_and_technical',
    source: 'content_collection',
    source_column: 'groups_display_preference',
    description: 'How groups are displayed — drives the groups section template on Site Library.',
    pipeline_consumers: [],
    importance: 'medium',
  },

  // ── Inspiration & Notes ────────────────────────────────────────
  {
    key: 'inspirational_websites',
    label: 'Inspirational sites',
    category: 'inspiration_and_notes',
    source: 'discovery',
    source_column: 'inspirational_websites',
    description: 'Sites the partner finds aspirational — scanned for strategic phrases (e.g. "easy to access") that surface on Design Handoff.',
    pipeline_consumers: [],
    importance: 'medium',
  },
  {
    key: 'timeline_notes',
    label: 'Timeline notes (AM)',
    category: 'inspiration_and_notes',
    source: 'am_handoff',
    source_column: 'timelineNotes',
    description: 'Timeline constraints the AM flagged — surfaced on the Cowork tab header so the strategist sees them at pipeline time.',
    pipeline_consumers: [],
    importance: 'medium',
  },
] as const

export type NavChangeLevel = 'full_rewrite' | 'partial' | 'tweaks' | 'preserve'

/** Derive the nav_change_level enum from a 1-10 nav satisfaction score.
 *  Closed mapping per the strategist's rule. Null on out-of-band input. */
export function deriveNavChangeLevel(score: number | null | undefined): NavChangeLevel | null {
  if (typeof score !== 'number' || score < 1 || score > 10) return null
  if (score <= 6)   return 'full_rewrite'
  if (score <= 8)   return 'partial'
  if (score === 9)  return 'tweaks'
  return 'preserve'
}

/** Derive the intended-verbatim band from the copy_approach text.
 *  Closed-token match against common partner-stated approaches.
 *  Unknown → 'mid' (the safe default — strategist can override). */
export function deriveVerbatimBand(approach: string | null | undefined): 'high' | 'mid' | 'low' {
  if (!approach) return 'mid'
  const norm = approach.toLowerCase()
  if (norm.includes('keep most') || norm.includes('keep our current'))         return 'high'
  if (norm.includes('start from scratch') || norm.includes('write from scratch')) return 'low'
  if (norm.includes('rewrite'))                                                return 'low'
  if (norm.includes('mix') || norm.includes('blend'))                          return 'mid'
  return 'mid'
}

/** Empty snapshot used when no aggregation has run yet. Keeps the
 *  workspace renderable without runtime null checks at every key. */
export function emptyStrategicGoalsSnapshot(): StrategicGoalsSnapshot {
  return {
    _meta: { generated_at: '', version: 1, sources_synced_from: [] },
    goals_and_vision:       {},
    voice_and_tone:         {},
    content_and_allocation: {},
    display_and_technical:  {},
    inspiration_and_notes:  {},
  }
}
