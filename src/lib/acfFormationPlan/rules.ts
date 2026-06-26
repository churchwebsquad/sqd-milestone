// Content-Model Formation Plan — rule constants.
//
// Externalized so we can tune behavior without touching the analyzer
// code. Two sections:
//   1. SectionRole → routing defaults (which CPT, which Options group,
//      which detail template).
//   2. WebFieldType → ACF field type mapping.
//
// Keep these maps exhaustive — when SectionRole or WebFieldType grow
// new values, this file must be updated. TypeScript won't catch a
// missing key (it's a partial Record) but the analyzer logs unmapped
// roles for follow-up.

import type { SectionRole, WebFieldType } from '../../types/database'
import type { AcfFieldType, CptSupportFlag, Structure } from './types'

// ── Section-role groupings ────────────────────────────────────────────

/** Roles whose content tends to be edited frequently AND whose edits
 *  must reach a non-technical editor without touching layout. When the
 *  router lands on PLAIN_FIELD or REPEATER-inside-FLEXIBLE for one of
 *  these, it flags a "promote to CPT or Options" recommendation. */
export const HIGH_EDIT_ROLES: ReadonlySet<SectionRole> = new Set<SectionRole>([
  'event_detail', 'post_detail',
  'team_grid', 'team_carousel', 'staff_member_detail',
  'blog_listing', 'blog_featured',
  'banner_announcement',
])

/** Roles that, when they appear on 2+ approved pages, indicate a
 *  global single-source pattern (service times, contact, socials).
 *  Hero-family AND verse_callout roles are excluded because they
 *  intentionally repeat across pages with DIFFERENT content per page
 *  (each page's hero has its own image; each page's verse callout has
 *  its own scripture pick). */
export const MULTIPLE_LOCATION_ROLES: ReadonlySet<SectionRole> = new Set<SectionRole>([
  'cta_banner_simple', 'cta_banner_split', 'cta_full_bleed',
  'mission_statement',
])

/** Roles whose default classification is a Custom Post Type. The
 *  display-preference signal in strategy_content_collection_sessions
 *  can override this (route to EXTERNAL instead) — that's Rule 2 in
 *  the routing order.
 *
 *  NOTE on sermons + groups: SectionRole has no dedicated `sermon_*`
 *  or `group_*` values, so this set can't route them. Sermons + groups
 *  are routed FROM the content-collection display_preference signal
 *  in sources.ts via CPT_FROM_CONTENT_KIND below, not from the layout
 *  section_role enum. */
export const CPT_SECTION_ROLES: ReadonlySet<SectionRole> = new Set<SectionRole>([
  'team_grid', 'team_carousel', 'staff_member_detail',  // → staff CPT
  'event_detail',                                       // → event CPT
  'post_detail', 'blog_listing', 'blog_featured',       // → post (built-in, but treat as CPT)
  'career_listing', 'career_detail',                    // → career CPT
])

/** CPTs that aren't driven by a layout SectionRole but by the
 *  partner's answer on strategy_content_collection_sessions.
 *  display_preference values that produce these CPTs:
 *
 *    events:  'wordpress'                                                   → event   (single_template = yes)
 *    sermons: 'archive_pages' | 'latest_series_pages'                       → sermon  (single_template = yes, archive yes when archive_pages)
 *             'archive_youtube' | 'latest_series_youtube' | 'latest_sermon' → sermon  (single_template = no — CPT still needed to hold metadata bound to a YT link)
 *             'wordpress' (legacy)                                          → sermon  (single_template = yes)
 *    groups:  'wordpress'                                                   → group   (single_template = yes)
 *             'contact'                                                     → group   (HEADLESS — mailto CTA, no detail URL)
 *             'embed' | 'external'                                          → EXTERNAL (no CPT)
 *
 *  sources.ts owns the value-by-value branch; this constant only
 *  declares the slugs so the rest of rules.ts can reference them
 *  consistently. */
export const CPT_FROM_CONTENT_KIND: Record<'events' | 'sermons' | 'groups', string> = {
  events:  'event',
  sermons: 'sermon',
  groups:  'group',
}

/** Per-role default for the CPT sub-routine's single_template question.
 *  'maybe' means the analyzer surfaces an open question for McNeel. */
export const CPT_SINGLE_TEMPLATE_DEFAULT: Partial<Record<SectionRole, 'yes' | 'no' | 'maybe'>> = {
  'staff_member_detail':  'yes',
  'team_grid':            'no',     // listing → query loop
  'team_carousel':        'no',     // listing → query loop
  'event_detail':         'maybe',  // depends on events_display_preference
  'post_detail':          'yes',
  'blog_listing':         'no',     // listing → query loop
  'blog_featured':        'no',     // listing → query loop
  'career_listing':       'no',
  'career_detail':        'yes',
}

/** Curated CPT slug per SectionRole. Multiple roles can map to the
 *  same CPT (e.g. team_grid + staff_member_detail → 'staff'). */
export const CPT_SLUG_BY_ROLE: Partial<Record<SectionRole, string>> = {
  'team_grid':            'staff',
  'team_carousel':        'staff',
  'staff_member_detail':  'staff',
  'event_detail':         'event',
  'post_detail':          'post',          // WP built-in; we still register a field group
  'blog_listing':         'post',
  'blog_featured':        'post',
  'career_listing':       'career',
  'career_detail':        'career',
}

/** Suggested taxonomies per CPT slug. The "campus" / "campuses" labels
 *  on per-congregation taxonomies use placeholder tokens; the emitter
 *  swaps them per-project via the project's chosen term — "Campus" for
 *  most partners, "Congregation" for partners (e.g. Doxology) who
 *  prefer that vocabulary. See `applyCampusTerm()` in emit.ts.
 *
 *  Slug convention: singular noun matches WP's built-in `post` and
 *  scales cleanly to single-record archives (e.g. /staff/jane-doe). */
export const TAXONOMY_SUGGESTIONS: Record<string, Array<{ slug: string; singular: string; plural: string; hierarchical: boolean; campus_term_aware?: boolean }>> = {
  staff: [
    { slug: 'staff_team',     singular: 'Team',          plural: 'Teams',          hierarchical: true },
    { slug: 'staff_campus',   singular: '{campus_term}', plural: '{campus_term_plural}', hierarchical: false, campus_term_aware: true },
  ],
  event: [
    { slug: 'event_category', singular: 'Category',      plural: 'Categories',     hierarchical: true },
    { slug: 'event_campus',   singular: '{campus_term}', plural: '{campus_term_plural}', hierarchical: false, campus_term_aware: true },
  ],
  group: [
    { slug: 'group_type',     singular: 'Type',          plural: 'Types',          hierarchical: true },
    { slug: 'group_day',      singular: 'Day',           plural: 'Days',           hierarchical: false },
    { slug: 'group_campus',   singular: '{campus_term}', plural: '{campus_term_plural}', hierarchical: false, campus_term_aware: true },
  ],
  sermon: [
    { slug: 'sermon_series',  singular: 'Series',        plural: 'Series',         hierarchical: false },
    { slug: 'sermon_speaker', singular: 'Speaker',       plural: 'Speakers',       hierarchical: false },
    { slug: 'sermon_topic',   singular: 'Topic',         plural: 'Topics',         hierarchical: true },
  ],
  career: [
    { slug: 'career_department', singular: 'Department', plural: 'Departments',    hierarchical: true },
  ],
  post: [
    { slug: 'category',       singular: 'Category',      plural: 'Categories',     hierarchical: true },  // built-in
    { slug: 'post_tag',       singular: 'Tag',           plural: 'Tags',           hierarchical: false }, // built-in
  ],
}

/** Default menu_icon dashicon per CPT slug. */
export const CPT_MENU_ICON: Record<string, string> = {
  staff:  'dashicons-groups',
  event:  'dashicons-calendar-alt',
  sermon: 'dashicons-microphone',
  group:  'dashicons-networking',
  career: 'dashicons-businessperson',
}

/** Default `supports` array per CPT slug. Headless CPTs trim to title
 *  + revisions; storyful CPTs add editor + thumbnail. Value type is
 *  CptSupportFlag[] so the array and CptRegistrationArgs.supports
 *  share the same closed vocabulary (fixes the earlier 'page-attributes'
 *  drift). */
export const CPT_SUPPORTS: Record<string, CptSupportFlag[]> = {
  staff:  ['title', 'editor', 'thumbnail', 'revisions'],
  event:  ['title', 'editor', 'thumbnail', 'revisions', 'excerpt'],
  sermon: ['title', 'editor', 'thumbnail', 'revisions', 'excerpt'],
  group:  ['title', 'revisions'],                                   // headless — no editor needed
  career: ['title', 'editor', 'thumbnail', 'revisions'],
  post:   ['title', 'editor', 'thumbnail', 'revisions', 'excerpt', 'custom-fields'],
}

/** Roles whose section-level structure should default to Bricks's
 *  native Nestable sections rather than ACF Flexible Content when
 *  bucket D fires. Bricks Nestable avoids the per-subfield postmeta
 *  query that ACF Flexible Content incurs per render.
 *
 *  Limited to roles that genuinely have a container/list shape —
 *  single-field roles (intro_text, content_block, mission_statement,
 *  verse_callout) are excluded because they have no nestable interior
 *  to populate. */
export const BRICKS_NESTABLE_PREFERRED_ROLES: ReadonlySet<SectionRole> = new Set<SectionRole>([
  'hero_home', 'hero_innerpage', 'hero_visual',
  'feature_grid', 'feature_split', 'card_grid', 'card_carousel',
  'cta_banner_simple', 'cta_banner_split', 'cta_full_bleed',
  'steps_horizontal', 'steps_vertical', 'timeline_chronology',
  'faq_accordion', 'faq_grid',
])

/** SectionRoles representing chrome (header/footer/menu) — skipped
 *  entirely by the analyzer because they're handled by Bricks
 *  templates, not ACF. */
export const CHROME_ROLES: ReadonlySet<SectionRole> = new Set<SectionRole>([
  'nav_header', 'footer_main', 'offcanvas_menu', 'megamenu', 'link_page',
])

// ── WebFieldType → ACF field type ─────────────────────────────────────

/** Maps Brixies WebFieldType to its closest ACF field type. CTA is
 *  special — it expands into an ACF group with sub-fields { label,
 *  url } — so this map points at `group` and the emitter handles the
 *  expansion. form-input has no ACF equivalent (the embed is rendered
 *  by Bricks against an external form provider) — null tells the
 *  emitter to omit the field. */
export const ACF_TYPE_BY_FIELD_TYPE: Record<WebFieldType, AcfFieldType | null> = {
  'text':       'text',
  'richtext':   'wysiwyg',
  'cta':        'group',             // expands to { label, url } sub-fields
  'image':      'image',
  'url':        'url',
  'email':      'email',
  'phone':      'text',              // ACF has no native phone type
  'datetime':   'date_time_picker',
  'form-input': null,                // handled by Bricks, not ACF
  'map':        'google_map',
  'boolean':    'true_false',
}

// ── Globals seeding ───────────────────────────────────────────────────

/** Site-wide globals from strategy_web_projects that are TRULY church-
 *  wide regardless of campus structure. Always seeded into the global
 *  Options page. */
export const CHURCH_WIDE_GLOBAL_COLUMNS = [
  { col: 'church_name',           label: 'Church Name',           type: 'text'     as const },
  { col: 'denomination',          label: 'Denomination',          type: 'text'     as const },
  { col: 'social_facebook_url',   label: 'Facebook URL',          type: 'url'      as const },
  { col: 'social_instagram_url',  label: 'Instagram URL',         type: 'url'      as const },
  { col: 'social_youtube_url',    label: 'YouTube URL',           type: 'url'      as const },
  { col: 'social_tiktok_url',     label: 'TikTok URL',            type: 'url'      as const },
  { col: 'social_twitter_url',    label: 'X / Twitter URL',       type: 'url'      as const },
  { col: 'social_linkedin_url',   label: 'LinkedIn URL',          type: 'url'      as const },
] as const

/** Fields on strategy_web_projects that are inherently per-campus when
 *  the project is multi-campus. For single-campus projects (campuses[]
 *  empty), these are seeded into the global Options page alongside
 *  CHURCH_WIDE_GLOBAL_COLUMNS — they really ARE site-wide. For multi-
 *  campus projects (Doxology, etc.), the analyzer SKIPS seeding these
 *  as flat globals and instead emits open_questions asking McNeel to
 *  confirm the per-campus modeling (typically a Campus CPT or per-
 *  campus repeater on a Visit page).
 *
 *  Why: the project-row values for these columns represent ONE campus
 *  (usually the primary one), so promoting them as site-wide bakes
 *  that campus's facts in as church-wide — the exact leak we spent
 *  the multi-campus rollout scrubbing out of the inventory. */
export const CAMPUS_SCOPED_COLUMNS = [
  { col: 'address',               label: 'Address',               type: 'text'     as const },
  { col: 'city_state',            label: 'City, State',           type: 'text'     as const },
  { col: 'phone',                 label: 'Phone',                 type: 'phone'    as const },
  { col: 'email',                 label: 'Email',                 type: 'email'    as const },
  { col: 'primary_service_time',  label: 'Primary Service Time',  type: 'text'     as const },
  { col: 'all_service_times',     label: 'All Service Times',     type: 'richtext' as const },
  { col: 'pastor_name',           label: 'Pastor Name',           type: 'text'     as const },
] as const

/** Convenience union for code paths that don't care about the split.
 *  15 columns total — single-campus projects seed all of them; multi-
 *  campus projects seed only the 8 church-wide ones plus an open
 *  question for the 7 campus-scoped ones. */
export const ALL_PROJECT_GLOBAL_COLUMNS = [
  ...CHURCH_WIDE_GLOBAL_COLUMNS,
  ...CAMPUS_SCOPED_COLUMNS,
] as const

// ── Default structure fallback by SectionRole ─────────────────────────

/** Used by the analyzer when a section has no template-level group
 *  signal and no other rule fires. Provides a sensible default per
 *  role so the analyzer never lands on PLAIN_FIELD for sections that
 *  obviously want repeater-style storage. */
export const STRUCTURE_DEFAULT_BY_ROLE: Partial<Record<SectionRole, Structure>> = {
  'feature_grid':       'REPEATER',
  'feature_split':      'GROUP',
  'card_grid':          'REPEATER',
  'card_carousel':      'REPEATER',
  'team_grid':          'CUSTOM_POST_TYPE',
  'team_carousel':      'CUSTOM_POST_TYPE',
  'steps_horizontal':   'REPEATER',
  'steps_vertical':     'REPEATER',
  'timeline_chronology':'REPEATER',
  'faq_accordion':      'REPEATER',
  'faq_grid':           'REPEATER',
  'gallery_grid':       'REPEATER',
  'gallery_carousel':   'REPEATER',
  'blog_listing':       'CUSTOM_POST_TYPE',
  'blog_featured':      'CUSTOM_POST_TYPE',
  'career_listing':     'CUSTOM_POST_TYPE',
  'event_detail':       'CUSTOM_POST_TYPE',
  'post_detail':        'CUSTOM_POST_TYPE',
  'staff_member_detail':'CUSTOM_POST_TYPE',
  'career_detail':      'CUSTOM_POST_TYPE',
  'intro_text':         'PLAIN_FIELD',
  'content_block':      'PLAIN_FIELD',
  'mission_statement':  'PLAIN_FIELD',
  'verse_callout':      'PLAIN_FIELD',
  'hero_home':          'GROUP',
  'hero_innerpage':     'GROUP',
  'hero_visual':        'GROUP',
  'cta_banner_simple':  'GROUP',
  'cta_banner_split':   'GROUP',
  'cta_full_bleed':     'GROUP',
  'banner_announcement':'GLOBAL_OPTIONS',
  'category_filter':    'PLAIN_FIELD',
  'search_bar':         'PLAIN_FIELD',
}
