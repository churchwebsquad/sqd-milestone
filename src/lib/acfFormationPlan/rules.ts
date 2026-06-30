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
import type { AcfFieldType, CptSupportFlag, SchemaName, Structure } from './types'

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

// ── Canonical CPT fields per content kind ─────────────────────────────
//
// When a Sermon, Group, or Event CPT is emitted from the partner's
// content_collection display_preference answer (NOT from a tagged
// `sermon_card` / `group_card` / `event_*` section), the field-group
// builder has zero sections to walk and produces a CPT with only
// taxonomy fields — useless for the dev who has to populate records.
//
// These canonical sets seed the field group with the columns each CPT
// minimally needs in WordPress, varied by the partner's display
// preference (e.g. archive_pages adds notes / audio links; the
// `contact` group flavor requires contact_email).
//
// All fields are non-taxonomy — taxonomies are added separately by
// buildTaxonomies. `title` is the WP built-in post title (driven by
// `supports: ['title']`) and is intentionally omitted here.

export interface CanonicalCptField {
  name:        string
  label:       string
  type:        AcfFieldType
  required?:   boolean
  /** Short blurb so the dev knows what the partner is expected to put
   *  in this field. Surfaced in the markdown handoff next to the field. */
  description?: string
}

/** Sermon CPT canonical fields. Two shapes:
 *
 *   - `youtube-only`: cards link out to YouTube; record stores just
 *     the metadata bound to the YT link. Used for
 *     archive_youtube / latest_series_youtube / latest_sermon.
 *
 *   - `on-site-detail`: cards link to a WP detail page; record stores
 *     the full sermon (video embed, audio podcast link, sermon notes,
 *     scripture). Used for archive_pages / latest_series_pages and the
 *     legacy 'wordpress' value. */
export const CANONICAL_SERMON_FIELDS: Record<'youtube-only' | 'on-site-detail', CanonicalCptField[]> = {
  'youtube-only': [
    { name: 'sermon_date',         label: 'Sermon date',         type: 'date_time_picker', required: true,
      description: 'When the sermon was preached.' },
    { name: 'video_url',           label: 'Video URL',           type: 'url',              required: true,
      description: 'YouTube / Vimeo URL for the sermon. Card buttons link here.' },
    { name: 'scripture_reference', label: 'Scripture reference', type: 'text',
      description: 'Primary passage, e.g. "John 3:1-15".' },
  ],
  'on-site-detail': [
    { name: 'sermon_date',         label: 'Sermon date',         type: 'date_time_picker', required: true,
      description: 'When the sermon was preached.' },
    { name: 'video_url',           label: 'Video URL',           type: 'url',              required: true,
      description: 'YouTube / Vimeo URL — embedded on the detail page.' },
    { name: 'audio_url',           label: 'Audio / podcast URL', type: 'url',
      description: 'Podcast or audio file URL. Optional.' },
    { name: 'sermon_notes_url',    label: 'Sermon notes URL',    type: 'url',
      description: 'Link to a PDF or external doc of notes. Optional.' },
    { name: 'scripture_reference', label: 'Scripture reference', type: 'text',
      description: 'Primary passage, e.g. "John 3:1-15".' },
    { name: 'duration_text',       label: 'Duration',            type: 'text',
      description: 'Free text like "37 min" or "1:02:15". Optional.' },
  ],
}

/** Group CPT canonical fields. Two shapes:
 *
 *   - `detail-page`: cards link to a WP detail page (display_preference
 *     = `wordpress`). Records carry full group info + optional
 *     registration link.
 *
 *   - `headless-mailto`: cards have a mailto contact button only
 *     (display_preference = `contact`); contact_email is REQUIRED. */
export const CANONICAL_GROUP_FIELDS: Record<'detail-page' | 'headless-mailto', CanonicalCptField[]> = {
  'detail-page': [
    { name: 'meeting_day',     label: 'Meeting day',     type: 'text',
      description: 'Day of week or schedule pattern, e.g. "Wednesdays" or "2nd & 4th Tuesday".' },
    { name: 'meeting_time',    label: 'Meeting time',    type: 'text',
      description: 'Time of day, e.g. "7:00 PM" or "After the 9 AM service".' },
    { name: 'location_text',   label: 'Location',        type: 'text',
      description: 'Where the group meets. Free text — "Main Campus, Room 204" / "Leader’s home".' },
    { name: 'address',         label: 'Address',         type: 'text',
      description: 'Street address when the group meets off-campus. Optional.' },
    { name: 'audience',        label: 'Audience',        type: 'text',
      description: 'Who the group is for — "Adults", "Young Families", "Men 30s+".' },
    { name: 'leader_name',     label: 'Leader name',     type: 'text',
      description: 'Group leader’s name as shown on the card.' },
    { name: 'contact_email',   label: 'Contact email',   type: 'email',
      description: 'Email surfaced on the detail page for inquiries.' },
    { name: 'contact_phone',   label: 'Contact phone',   type: 'text',
      description: 'Optional phone number.' },
    { name: 'registration_url',label: 'Registration URL',type: 'url',
      description: 'External signup link (Church Center, Planning Center) if the group takes registrations.' },
  ],
  'headless-mailto': [
    { name: 'contact_email',   label: 'Contact email',   type: 'email', required: true,
      description: 'REQUIRED — drives the mailto: button on each card.' },
    { name: 'meeting_day',     label: 'Meeting day',     type: 'text',
      description: 'Day of week or schedule pattern.' },
    { name: 'meeting_time',    label: 'Meeting time',    type: 'text',
      description: 'Time of day.' },
    { name: 'location_text',   label: 'Location',        type: 'text',
      description: 'Where the group meets.' },
    { name: 'audience',        label: 'Audience',        type: 'text',
      description: 'Who the group is for.' },
    { name: 'leader_name',     label: 'Leader name',     type: 'text',
      description: 'Group leader’s name.' },
  ],
}

/** Pick the right canonical shape for a sermon CPT given the partner's
 *  sermons_display_preference. Returns null for prefs that don't map
 *  to a CPT (the External-routing path handles those). */
export function sermonCanonicalShape(
  pref: string | null,
): 'youtube-only' | 'on-site-detail' | null {
  switch (pref) {
    case 'archive_youtube':
    case 'latest_series_youtube':
    case 'latest_sermon':
      return 'youtube-only'
    case 'archive_pages':
    case 'latest_series_pages':
    case 'wordpress':
      return 'on-site-detail'
    default:
      return null
  }
}

/** Pick the right canonical shape for a group CPT given the partner's
 *  groups_display_preference. Returns null for prefs that don't map
 *  to a CPT. */
export function groupCanonicalShape(
  pref: string | null,
): 'detail-page' | 'headless-mailto' | null {
  switch (pref) {
    case 'wordpress':
      return 'detail-page'
    case 'contact':
      return 'headless-mailto'
    default:
      return null
  }
}

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

// ── Canonical schema vocabulary (content diagnosis, v1.5) ─────────────
//
// One entry per schema in handoffs/inventory-schema-audit.md Part 2.
// Consumed by the classifySchema pipeline (classifySchema.ts). When you
// add a schema to the audit doc, add it here and to SchemaName in
// types.ts. The classifier is conservative: it only emits a schema_name
// when 2+ signals align (page_slug + role + heading words + field
// pattern). When fewer than 2 signals match, the LLM fallback is
// consulted; when the LLM is also unsure, schema_name is left null
// (the section gets reported in the handoff with its raw field keys
// only — never falsely classified).

export interface SchemaSpec {
  /** Canonical per-item fields. Used to compute `in_bound_template`:
   *  fields the diagnosed schema expects but the bound template has no
   *  slot for are flagged as dropped (build-time issue). */
  canonical_fields: string[]
  /** Alternative field key names cowork / strategists might use for
   *  the same concept. The classifier normalizes via these aliases
   *  before computing the schema match. */
  field_aliases: Record<string, readonly string[]>
  /** Page-slug substrings that strongly signal this schema. Substring
   *  match, case-insensitive. */
  page_slug_signals: readonly string[]
  /** SectionRole values that strongly signal this schema. */
  section_role_signals: readonly SectionRole[]
  /** Item count hint. When item_count falls within [min, max], one
   *  signal point is added. null = no signal from count. */
  typical_item_count: readonly [number, number] | null
  /** Heading-word signals: lowercase substrings that, when present in
   *  the section heading, add a signal point. */
  heading_word_signals: readonly string[]
  /** Discriminator fields. If NO item in the section has ANY of these
   *  populated, the schema is strongly downweighted. Distinguishes
   *  event_card (needs date/time) from feature_card (no temporal
   *  fields), person_card (needs role) from generic group_card, etc.
   *  Empty array = no discriminator (fall back to fuzzy signals). */
  discriminator_fields: readonly string[]
}

export const CANONICAL_SCHEMAS: Record<SchemaName, SchemaSpec> = {
  person_card: {
    canonical_fields: ['name', 'role', 'bio', 'email', 'phone', 'headshot', 'linkedin', 'ministry_area'],
    field_aliases: {
      headshot: ['photo_url', 'profile_url', 'image', 'image_url', 'photo'],
      role:     ['title', 'position'],
      name:     ['full_name'],
    },
    page_slug_signals:    ['staff', 'team', 'leadership', 'pastors', 'elders', 'care', 'counseling'],
    section_role_signals: ['team_grid', 'team_carousel', 'staff_member_detail'],
    typical_item_count:   [2, 60],
    heading_word_signals: ['team', 'staff', 'pastors', 'leadership', 'elders', 'deacons', 'counselors'],
    discriminator_fields: ['role', 'title', 'position', 'bio'],
  },
  sermon_card: {
    canonical_fields: ['title', 'series', 'speaker', 'date', 'scripture', 'video_url', 'audio_url', 'notes_url', 'transcript_url', 'bulletin_url', 'duration'],
    field_aliases: {
      video_url: ['youtube_url', 'vimeo_url', 'watch_url'],
      title:     ['name', 'sermon_title'],
      speaker:   ['preacher', 'pastor'],
    },
    page_slug_signals:    ['sermons', 'messages', 'watch', 'listen'],
    section_role_signals: [],
    typical_item_count:   [0, 200],
    heading_word_signals: ['sermon', 'message', 'series', 'watch', 'listen', 'latest'],
    discriminator_fields: ['video_url', 'youtube_url', 'audio_url', 'series', 'scripture', 'speaker', 'preacher'],
  },
  event_card: {
    canonical_fields: ['name', 'description', 'audience', 'start_date', 'end_date', 'time', 'location', 'register_url', 'featured_image', 'cost'],
    field_aliases: {
      name:         ['title', 'event_name'],
      register_url: ['signup_url', 'rsvp_url', 'ticket_url'],
      start_date:   ['date', 'event_date'],
    },
    page_slug_signals:    ['events', 'calendar', 'camps', 'retreats'],
    section_role_signals: ['event_detail'],
    typical_item_count:   [0, 100],
    heading_word_signals: ['event', 'calendar', 'upcoming', 'camp', 'retreat'],
    discriminator_fields: ['start_date', 'date', 'event_date', 'register_url', 'rsvp_url', 'ticket_url'],
  },
  service_time: {
    canonical_fields: ['name', 'when', 'location', 'description', 'audience', 'note'],
    field_aliases: {
      when: ['time', 'day_time', 'schedule'],
      name: ['service_name', 'label'],
    },
    page_slug_signals:    ['sundays', 'plan-visit', 'new-here', 'new', 'home', 'visit', 'services'],
    section_role_signals: [],
    typical_item_count:   [1, 6],
    heading_word_signals: ['service', 'sunday', 'join us', 'gather', 'worship time'],
    discriminator_fields: ['when', 'time', 'day_time', 'schedule'],
  },
  faq_qna: {
    canonical_fields: ['question', 'answer', 'scripture_ref', 'audience', 'context'],
    field_aliases: {
      question:      ['q', 'prompt'],
      answer:        ['a', 'response'],
      scripture_ref: ['scripture', 'verse', 'reference'],
    },
    page_slug_signals:    ['beliefs', 'baptism', 'plan-visit', 'membership', 'what-to-expect', 'faq'],
    section_role_signals: ['faq_accordion', 'faq_grid'],
    typical_item_count:   [3, 30],
    heading_word_signals: ['faq', 'frequently asked', 'questions', 'beliefs', 'what we believe'],
    discriminator_fields: ['question', 'q', 'prompt', 'answer', 'a'],
  },
  ministry_program_card: {
    canonical_fields: ['name', 'description', 'audience', 'contact', 'day', 'time', 'location', 'sign_up_url', 'philosophy'],
    field_aliases: {
      name:        ['title', 'program_name'],
      sign_up_url: ['signup_url', 'register_url'],
      audience:    ['age_range', 'grade'],
    },
    page_slug_signals:    ['kids', 'students', 'youth', 'adults', 'college', 'young-adults', 'worship-music', 'care', 'next-gen', 'nextgen'],
    section_role_signals: ['feature_grid', 'card_grid', 'card_carousel'],
    typical_item_count:   [2, 20],
    heading_word_signals: ['ministry', 'community', 'belonging', 'for families', 'for students', 'for kids', 'for adults', 'for women', 'for men', 'for seniors'],
    discriminator_fields: ['audience', 'age_range', 'grade'],
  },
  volunteer_opportunity: {
    canonical_fields: ['name', 'description', 'audience', 'time_commitment', 'sign_up_url', 'contact'],
    field_aliases: {
      sign_up_url: ['signup_url', 'apply_url'],
      name:        ['role', 'opportunity'],
    },
    page_slug_signals:    ['serve', 'missions', 'volunteer', 'outreach', 'opportunities'],
    section_role_signals: [],
    typical_item_count:   [2, 30],
    heading_word_signals: ['serve', 'volunteer', 'mission', 'outreach', 'get involved'],
    discriminator_fields: ['sign_up_url', 'signup_url', 'apply_url', 'time_commitment'],
  },
  group_card: {
    canonical_fields: ['name', 'description', 'leader', 'day', 'time', 'location', 'audience', 'contact_email', 'duration', 'philosophy', 'meeting_locations', 'focus_areas', 'support_model'],
    field_aliases: {
      contact_email: ['email', 'leader_email'],
      name:          ['title', 'group_name'],
    },
    page_slug_signals:    ['groups', 'connect', 'small-groups', 'life-groups', 'community-groups'],
    section_role_signals: [],
    typical_item_count:   [2, 200],
    heading_word_signals: ['groups', 'small group', 'life group', 'community group', 'find your group', 'ways to connect'],
    discriminator_fields: ['leader', 'meeting_locations', 'day', 'philosophy', 'duration'],
  },
  pathway_step: {
    canonical_fields: ['step_order', 'name', 'description', 'audience', 'action_url', 'duration', 'philosophy'],
    field_aliases: {
      action_url: ['next_url', 'cta_url'],
      name:       ['step_name', 'title'],
    },
    page_slug_signals:    ['next-steps', 'discover', 'discipleship', 'pathway', 'membership', 'home'],
    section_role_signals: ['steps_horizontal', 'steps_vertical'],
    typical_item_count:   [3, 8],
    heading_word_signals: ['next steps', 'grow', 'pathway', 'discipleship', 'discover', 'rhythms', 'grow, serve, give'],
    discriminator_fields: ['step_order', 'action_url', 'next_url'],
  },
  blog_post_card: {
    canonical_fields: ['title', 'author', 'date', 'excerpt', 'body', 'featured_image', 'category', 'tags', 'url'],
    field_aliases: {
      title:          ['name', 'post_title'],
      featured_image: ['image', 'hero_image'],
    },
    page_slug_signals:    ['blog', 'news', 'stories', 'articles'],
    section_role_signals: ['blog_listing', 'blog_featured', 'post_detail'],
    typical_item_count:   [0, 500],
    heading_word_signals: ['blog', 'news', 'latest', 'recent posts', 'stories'],
    discriminator_fields: ['author', 'date', 'category', 'excerpt', 'body', 'tags'],
  },
  way_to_give_card: {
    canonical_fields: ['name', 'description', 'give_now_url', 'reference'],
    field_aliases: {
      give_now_url: ['donate_url', 'pledge_url'],
      name:         ['method', 'channel'],
    },
    page_slug_signals:    ['give', 'giving', 'donate'],
    section_role_signals: [],
    typical_item_count:   [2, 8],
    heading_word_signals: ['ways to give', 'giving', 'donate', 'pledge', 'support'],
    discriminator_fields: ['give_now_url', 'donate_url', 'pledge_url', 'reference'],
  },
  featured_campaign_card: {
    canonical_fields: ['name', 'description', 'target_amount', 'give_now_url', 'image_url', 'audience', 'progress'],
    field_aliases: {
      give_now_url: ['donate_url', 'pledge_url'],
      name:         ['campaign_name', 'title'],
    },
    page_slug_signals:    ['give', 'campaign', 'capital-campaign', 'building-fund', 'home'],
    section_role_signals: [],
    typical_item_count:   [1, 3],
    heading_word_signals: ['campaign', 'capital', 'building fund', 'goal', 'raised'],
    discriminator_fields: ['target_amount', 'progress', 'give_now_url', 'donate_url'],
  },
  testimony_card: {
    canonical_fields: ['name', 'role', 'story', 'scripture_ref', 'format', 'image_url'],
    field_aliases: {
      name:      ['person', 'who'],
      story:     ['testimony', 'description', 'quote'],
      image_url: ['photo_url', 'image', 'headshot'],
    },
    page_slug_signals:    ['testimonies', 'stories'],
    section_role_signals: [],
    typical_item_count:   [2, 50],
    heading_word_signals: ['testimony', 'testimonies', 'stories', 'changed life'],
    discriminator_fields: ['story', 'testimony', 'quote'],
  },
  career_card: {
    canonical_fields: ['title', 'department', 'location', 'employment_type', 'description', 'apply_url'],
    field_aliases: {
      title:     ['role', 'position', 'name'],
      apply_url: ['signup_url', 'register_url'],
    },
    page_slug_signals:    ['careers', 'jobs', 'employment', 'opportunities'],
    section_role_signals: ['career_listing', 'career_detail'],
    typical_item_count:   [0, 50],
    heading_word_signals: ['career', 'jobs', 'open positions', 'hiring'],
    discriminator_fields: ['apply_url', 'department', 'employment_type'],
  },
  location_card: {
    canonical_fields: ['name', 'address', 'service_times', 'phone', 'email', 'pastor_name', 'description', 'directions_url', 'image_url'],
    field_aliases: {
      name:      ['campus_name', 'location_name'],
      image_url: ['photo_url', 'image'],
    },
    page_slug_signals:    ['locations', 'campuses', 'congregations', 'find-a-location'],
    section_role_signals: [],
    typical_item_count:   [2, 30],
    heading_word_signals: ['campus', 'location', 'congregation', 'find a location'],
    discriminator_fields: ['address', 'service_times', 'directions_url'],
  },
  feature_card: {
    /** Generic marketing tile — name + description ± optional CTA. The
     *  catch-all for cards that don't fit a domain schema. The classifier
     *  emits this only when NO other schema's signals reach threshold AND
     *  the items have <= 3 distinct field keys. */
    canonical_fields: ['name', 'description', 'cta_label', 'cta_url'],
    field_aliases: {
      name:        ['title', 'heading'],
      description: ['body', 'subtitle'],
    },
    page_slug_signals:    [],
    section_role_signals: ['feature_grid', 'feature_split'],
    typical_item_count:   [2, 8],
    heading_word_signals: [],
    /** Empty: feature_card is the catch-all when nothing else discriminates.
     *  The classifier only lands on feature_card when no other schema's
     *  signals reach threshold. */
    discriminator_fields: [],
  },
  Resources: {
    /** Catch-all for unrecognized "named link with optional metadata"
     *  content. Bulletins, devotionals, prayer resources, helpful links,
     *  partner library content. The category is named from the section
     *  heading at emit time, not from this constant. */
    canonical_fields: ['name', 'description', 'target_url', 'target_url_type', 'image_url', 'resource_category', 'date', 'author', 'scope'],
    field_aliases: {
      target_url: ['url', 'link', 'cta_url'],
      name:       ['title', 'label'],
    },
    page_slug_signals:    ['resources', 'bulletins', 'newsletter', 'devotionals', 'helpful-links', 'archive'],
    section_role_signals: [],
    typical_item_count:   [2, 200],
    heading_word_signals: ['resources', 'bulletins', 'newsletter', 'archive', 'helpful', 'links', 'devotionals'],
    discriminator_fields: ['target_url', 'url', 'link'],
  },
}
