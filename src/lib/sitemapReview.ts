/**
 * Sitemap Review, the partner-facing snapshot of a project's page
 * structure, persona postures, navigation layout, and content-
 * consolidation rationale.
 *
 * Distinct from `roadmap_state.stage_2` (the strategist's proposal ,
 * includes strategist-only info like scoring, considered alternatives,
 * cowork provenance). The review is the client-safe view: a curated
 * summary the partner reads and can edit, then approves as the
 * official path forward that downstream tools consume.
 *
 * Storage: `strategy_web_projects.roadmap_state.sitemap_review`, a
 * single JSONB blob. No new table (matches the CLAUDE.md rule that
 * roadmap_state absorbs strategist-authored data). Partner writes go
 * through a SECURITY DEFINER RPC that checks the token before merging
 * back into the row.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase as defaultSupabase } from './supabase'

// ── Types ────────────────────────────────────────────────────────────

export type SitemapReviewStatus =
  | 'draft'             // staff is authoring, not yet shared with partner
  | 'published'         // shared with partner, awaiting their input
  | 'partner_reviewed'  // partner made edits, waiting for staff confirmation
  | 'approved'          // locked as canonical, downstream tools read from here

/** Ordered step in a persona's journey, either an anchor to one of
 *  the site's pages (via `page_slug`) or a free-text milestone
 *  (e.g. "Watches a service online" without a specific page). */
export interface JourneyStep {
  step_label: string
  page_slug?: string
  note?: string
}

/** How the site is postured toward one persona. Composed by the
 *  strategist from the project's `personas[]`, one posture per
 *  persona the site is meant to serve.
 *
 *  Sourcing rule: personas are NOT invented at the sitemap review
 *  step. Extract them from the strategy brief (project.personas or
 *  roadmap_state.stage_1.personas) and contextualize their existing
 *  needs, desires, and barriers to the website. If the strategy
 *  brief has zero personas, the posture list stays empty until the
 *  brief captures them — never seed placeholder personas here.
 *
 *  Composition rules — apply when authoring or generating for ANY
 *  partner:
 *
 *  1. Goal is persona-specific and concrete. "Attend a DivorceCare
 *     cohort", "join a community group this semester", "coordinate a
 *     neighboring day." Not "plan a visit" for every persona and not
 *     "give more" for anyone. The goal is the site's job for this
 *     specific person, framed in their language and against their
 *     stated desire/barrier from the strategy brief.
 *
 *  2. Key pages are the top 3 pages (max) that must serve this
 *     persona to reach their goal. Selected from the review's
 *     current page list, not invented. Not a laundry list of pages
 *     we hope they see — the pages whose content strategy is
 *     load-bearing for this persona's outcome.
 *
 *  3. Posture summary is contextualized to the website. Read the
 *     strategy brief's bio_one_line, desire, and barrier for this
 *     persona and translate them into "how the site meets this
 *     person" — the tone, the first-page priority, the friction we
 *     are removing. Do not rewrite the persona's identity.
 *
 *  4. One persona, one primary congregation. For multi-campus sites,
 *     assign each persona to a single congregation via
 *     primary_congregation_id. Do not fabricate cross-congregation
 *     scenarios. */
export interface PersonaPosture {
  persona_id: string
  persona_name: string
  /** One-paragraph "here's how the site is angled to this person",
   *  contextualized from the strategy brief's bio + desire + barrier.
   *  What the site does for them, in their language. */
  posture_summary: string
  /** The specific outcome this persona is trying to reach on the site.
   *  Concrete and persona-specific ("register for baptism and join a
   *  group", "attend a DivorceCare cohort", "decide whether to visit
   *  Sunday"). Framed against the strategy brief's stated desire and
   *  barrier for this persona. */
  goal?: string
  /** Top 3 pages (max) whose content is load-bearing for this
   *  persona's outcome. Chosen from the review's current page list,
   *  not invented. Used to signal "these are your pages" per persona
   *  and to drive downstream content-strategy priority. */
  key_page_slugs: string[]
  /** Congregation this persona is anchored to on multi-campus sites.
   *  Empty on single-campus reviews. */
  primary_congregation_id?: string
  /** Where the strategist predicts this persona might bail. */
  drop_off_risk?: {
    at_slug:    string
    reason:     string
    mitigation: string
  }
  /** @deprecated Replaced by `key_page_slugs`. Retained for
   *  backward-compat during the migration off sequenced journeys.
   *  Do not render on partner view; do not author on new postures. */
  user_journey?: JourneyStep[]
  /** @deprecated See `user_journey`. */
  journeys_by_congregation?: Record<string, JourneyStep[]>
  /** @deprecated Merged into `key_page_slugs`; kept for older data. */
  entry_points?: string[]
}

/** One page in the review's pages list. Independent from the real
 *  web_pages row so the strategist can compose the review before pages
 *  are committed; when `web_page_id` is set, it points at the real
 *  page for downstream link-back. */
export interface ReviewPage {
  id: string
  web_page_id?: string
  slug: string
  name: string
  /** Client-facing "what this page is for" note. Editable throughout;
   *  strategist drafts, partner refines, both writes flow into the
   *  edit_history. */
  purpose: string
  /** Human label of where this page lives in the nav (e.g. "Header,
   *  under About") Purely descriptive; the actual nav tree lives in
   *  nav_layout. */
  nav_position?: string
  parent_slug?: string | null
  order: number
  /** Persona ids this page is primarily for. Cross-referenced against
   *  persona_postures[].persona_id. */
  persona_relevance?: string[]
  /** Primary audience label lifted from the cowork sitemap. Free text:
   *  "general", persona name, "Jordan & Ashley", etc. */
  primary_audience?: string | null
  /** Funnel stage this page serves. Typically "discover", "consider",
   *  "visit", "commit". */
  funnel_stage?: string | null
  /** Where in the nav this page lives ("primary", "secondary", "footer",
   *  "contextual_only", etc.). */
  nav_strategy?: string | null
  /** Consolidated "here's the strategy behind this page" block used
   *  by the partner review card. Three optional fields the strategist
   *  fills in per page; each is free text. The card only renders
   *  filled fields, so pages the strategist hasn't annotated stay
   *  clean instead of showing empty section labels. */
  what_changed?:        string
  why_change?:          string
  strategic_alignment?: string

  /** Role tag describing what this page IS in the new site — rendered
   *  as a colored pill on the partner-facing Full Page List. Focus is
   *  the page's role, not its migration status. Content-origin notes
   *  live separately in `what_changed`.
   *
   *  Vocabulary:
   *    'hub'         Hub page. Aggregates related content or entry
   *                  points (Start Here, Get Connected). Often
   *                  formed by merging several current-site pages.
   *    'ministry'    A specific ministry landing (Kids, Youth, Care,
   *                  Community Groups).
   *    'churchwide'  Info about the whole church (About, Beliefs,
   *                  Staff, Contact).
   *    'foundation'  Foundational action page (Give, Watch,
   *                  Plan a Visit) — the primary CTAs.
   *
   *  Legacy values ('kept' / 'unified' / 'consolidated' / 'new') are
   *  accepted in the type so older saved reviews typecheck. Renderer
   *  ignores them; editor doesn't offer them. Strategist re-tags via
   *  the editor when they open an old review. */
  sitemap_tag?: 'hub' | 'ministry' | 'churchwide' | 'foundation'
             | 'kept' | 'unified' | 'consolidated' | 'new'

  /** True when this row is a nav dropdown label, NOT a real page.
   *  Examples: "Teaching" or "Life at Woodcreek" on a site where
   *  clicking those in the nav only opens a dropdown of child pages
   *  (Messages, Blog, Podcast) rather than routing to /teaching.
   *
   *  When true:
   *    - Hidden from the partner Full Page List (still shows in
   *      Primary Navigation / Offcanvas / mega panels as a parent).
   *    - Skipped by the Pages workspace list + spreadsheet overview.
   *    - Not created as a web_pages row on handoff-to-pages.
   *    - Not written as copy by outline-page / draft-page.
   *
   *  Default false — strategist ticks the checkbox on the review
   *  page card when the row is a nav grouping only. Heuristic hint
   *  from site_strategy: `has_children === true` + this label appears
   *  as a dropdown parent in nav_layout.header but is not clicked
   *  through to as a leaf. Compose seeds the flag when both signals
   *  hold; strategist can override either way. */
  is_nav_parent_only?: boolean
}

export interface NavItem {
  label: string
  slug?: string   // internal, points at ReviewPage.slug
  url?: string    // external
  children?: NavItem[]
}

export interface FooterSection {
  label: string
  items: NavItem[]
}

export interface NavLayout {
  header: NavItem[]
  /** CTA-only items — slugs the strategist wants rendered as buttons
   *  on the primary nav row (Give, Plan a Visit) rather than as
   *  regular text links inside the header dropdown structure. Sourced
   *  from site_strategy.nav.cta_only at compose time. Downstream nav
   *  previews render these as `kind: 'button'` entries in
   *  visible_top_level; the topnav then displays them as pill buttons
   *  at the far-right of the primary row (or, in the offcanvas shell,
   *  at the bottom of the slide-out panel). */
  cta_only?: NavItem[]
  /** Secondary navigation region. Sits between primary (header) and
   *  footer conceptually: items that are important but shouldn't
   *  compete with the primary nav's guest-focused CTAs. Common
   *  patterns:
   *    - "Off-canvas" hamburger menu carrying About / Give / Events
   *      / Care that opens alongside the primary nav (Lakeway).
   *    - "Utility" nav strip above the header carrying Login /
   *      Search / Give.
   *    - "More" drawer for mobile that surfaces the deeper set.
   *  The strategist renames the visible label via `secondary_label`;
   *  render surfaces show the label instead of a generic word. */
  secondary?: NavItem[]
  /** Display label for the secondary region. Defaults to
   *  "Secondary menu"; the strategist typically renames this to
   *  match the site (e.g. "Off-canvas menu", "Utility nav",
   *  "More", "Drawer"). */
  secondary_label?: string
  footer_sections: FooterSection[]
}

/** "Where content went", captures the strategist's consolidation
 *  decisions so the partner sees "Youth + Kids → Family, because a
 *  single Family entry point aligns with how young families actually
 *  arrive" instead of silently losing the pages they had. */
export interface ContentMigration {
  id: string
  title: string
  merged_from: string[]  // labels of the pre-existing pages
  merged_to: string      // label of the destination page
  rationale: string
  /** Slug of the destination page, when it exists in the review. */
  merged_to_slug?: string
}

/** One entry in the edit log. Every save that changes a field
 *  appends here so both sides can see the trail. */
export interface EditLogEntry {
  at: string                  // ISO
  by: 'staff' | 'partner'
  field_path: string          // dotted path, e.g. "pages[3].purpose"
  old_value: unknown
  new_value: unknown
  note?: string
}

/** Site-wide footer information the partner reviews for accuracy.
 *  Populated at compose-time from `strategy_web_projects` global
 *  columns; every field remains editable so the partner can correct
 *  anything that changed since the intake questionnaire. */
export interface FooterInfo {
  church_name?:         string | null
  address?:             string | null
  phone?:               string | null
  email?:               string | null
  office_hours?:        string | null
  /** Human-readable service times for the footer's contact column.
   *  Seeded from strategy_web_projects.all_service_times (or
   *  primary_service_time as a fallback) at compose time. Renders
   *  above the contact info block on the partner review's footer. */
  service_times?:       string | null
  newsletter_signup_url?: string | null
  social_links?: Array<{
    platform: 'facebook' | 'instagram' | 'youtube' | 'tiktok' | 'twitter' | 'linkedin' | 'other'
    url:      string
    label?:   string
  }>
  /** Additional footer page links (Weekday Preschool, Careers,
   *  Contact, Memorial Garden, etc.). Strategist adds these as they
   *  emerge from cowork; partner confirms or edits.
   *
   *  Legacy flat-list shape. Preferred going forward is
   *  `footer_link_groups` which supports multiple headed columns.
   *  When both are present, `footer_link_groups` wins in the
   *  partner-facing render; `footer_page_links` shows only as the
   *  fallback single "Explore" column when groups are empty. */
  footer_page_links?: Array<{ label: string; url: string }>

  /** Grouped footer link columns with headings. Powers the multi-
   *  column footer layout ("Visiting", "Take a next step", "Get to
   *  know us", etc). When set (non-empty), replaces the legacy
   *  single "Explore" column. Order in the array is render order,
   *  left to right. Each group renders as its own column.
   *
   *  Typical churches have 2-4 groups; the renderer distributes
   *  them into a responsive grid. Empty groups (no links) are
   *  skipped at render time. */
  footer_link_groups?: Array<FooterLinkGroup>
}

/** One grouped column of footer links. */
export interface FooterLinkGroup {
  id: string
  /** Column heading, shown above the links (e.g., "Visiting"). */
  heading: string
  /** Links inside this column. Each link has a partner-facing label
   *  and an optional URL. URL is optional so a strategist can outline
   *  the intended column shape before every destination is finalized. */
  links: Array<{ label: string; url?: string | null }>
}

/** Announcement strip above the primary nav. Renders as a thin
 *  horizontal band with a message + optional CTA arrow. Used for
 *  seasonal callouts (summer camp registration, Christmas services,
 *  giving campaigns). Absent on most reviews. */
export interface AnnouncementBanner {
  /** The banner copy. Plain text; no markdown. */
  text: string
  /** Optional destination for the arrow/CTA at the right end of the
   *  banner. Absent = no arrow, banner is informational only. */
  cta_url?: string | null
  /** Optional label for the CTA at the right end. When absent but
   *  cta_url is present, a bare arrow (→) shows. */
  cta_label?: string | null
  /** Visual tone. `warning` = amber (upcoming deadline / registration);
   *  `info` = purple (general announcement); `neutral` = subtle gray.
   *  Defaults to `info` when absent. */
  tone?: 'warning' | 'info' | 'neutral'
}

/** One partner-requested edit pinned to a specific section of the
 *  review. The partner opens a drawer on any section, leaves a note
 *  (optionally with a suggested change), and it lands here. The
 *  approve-vs-share-feedback button state on the partner portal is
 *  driven by the count of `status: 'open'` entries.
 *
 *  Sections use stable string IDs (kebab-case): `nav-primary`,
 *  `nav-secondary`, `hubs`, `footer`, `page-<slug>`, `what-changed`,
 *  `why`. Staff resolves each entry after acting on it. */
export interface PartnerEditRequest {
  id: string
  section_id:    string
  section_label: string
  comment:       string
  suggested_change?: string
  status:        'open' | 'resolved'
  created_at:    string
  author_name?:  string
}

/** Authored "presentation" layer: fields the strategist (or a Claude
 *  Code cowork session) writes into after the sitemap step has already
 *  produced the mechanical output. These are the extras that turn the
 *  system-generated sitemap into a partner-ready walkthrough:
 *  per-congregation nav bars, featured highlights, tiered page
 *  grouping, authored summary cards, and partner prompts.
 *
 *  Doxology's cowork session, for example, produces the 3-congregation
 *  persistent nav, the Kingdom Come featured highlight, and the
 *  4 "what's changing" summary cards; those get pushed back into
 *  roadmap_state.sitemap_review.presentation and picked up here.
 *
 *  Every field is optional. When absent, the partner render falls
 *  back to the auto-derived defaults so a partner who hasn't had a
 *  cowork session still sees a usable review. */
export interface SitemapReviewPresentation {
  /** Optional italic-emphasis phrase in the hero subline. Rendered
   *  in the serif-italic brand voice inside the surrounding sans
   *  body. Doxology example: "three congregations". */
  hero_em_phrase?: string

  /** Optional announcement strip rendered above the primary nav
   *  preview. Seasonal callout: summer camp registration, Christmas
   *  service times, giving campaign, etc. Absent on most reviews.
   *  See AnnouncementBanner for shape + tone options. */
  announcement_banner?: AnnouncementBanner

  /** Per-congregation persistent nav bars, rendered below the
   *  Primary Navigation section. Absent (or empty) for
   *  single-campus partners. Doxology-specific override; the app
   *  does not derive this from anywhere. */
  congregations?: Array<{
    id:            string
    label:         string
    service_time?: string
    address?:      string
    is_primary?:   boolean
    /** Left-column and right-column links, mirroring the artifact's
     *  two-column persistent nav layout. `is_shared: true` renders
     *  the "shared" pill; `is_dropdown: true` renders the ▾ caret. */
    links_left?:   Array<{ label: string; slug?: string; is_shared?: boolean; is_dropdown?: boolean; kids?: string }>
    links_right?:  Array<{ label: string; slug?: string; is_shared?: boolean; is_dropdown?: boolean; kids?: string }>
    /** Optional visit-page slug this congregation's "Visit" button
     *  routes to. Falls back to `/visit` when unset. */
    visit_slug?:   string
    /** Optional note rendered under address (e.g., "Future campus:
     *  1805 FM 156, Haslet"). */
    note?:         string
  }>

  /** Optional featured highlight anchored in the primary nav
   *  megamenu. Doxology: Kingdom Come, linking to its own site. */
  featured_highlight?: {
    label:        string
    description:  string
    url?:         string
    cta_label?:   string
    secondary_cta_label?: string
  }

  /** Tiered grouping of the page list. When absent, the render
   *  falls back to grouping by parent_slug. When present, each page
   *  slug in `page_slugs` slots into that tier in order; unassigned
   *  pages appear in a final "Other pages" tier so nothing is
   *  silently dropped. */
  tiers?: Array<{
    id:         string
    letter?:    string
    title:      string
    meta?:      string
    /** Slugs of pages that live in this tier. Order determines
     *  the display order within the tier. Child pages can be
     *  marked with an `is_child` flag on the tier entry (see the
     *  `page_entries` alternate below) or via ReviewPage.parent_slug
     *  when the tier just lists top-level slugs. */
    page_slugs?: string[]
    /** Alternate: fully-specified entries with per-page overrides
     *  (child indent, custom description). Preferred over
     *  page_slugs when authoring a rich Southwest-style tier. */
    page_entries?: Array<{
      slug:        string
      is_child?:   boolean
      description_override?: string
    }>
  }>

  /** Authored "What's changing from your current site" summary
   *  cards. When present, replaces the default (which is derived
   *  from content_migrations). The artifact renders 4 of these,
   *  each with a tag pill + short heading + body sentence. */
  whats_changing_cards?: Array<{
    id:    string
    tag?:  'kept' | 'unified' | 'consolidated' | 'new'
    title: string
    body:  string
  }>

  /** Authored "Why we shaped it this way" cards. When present,
   *  replaces the default 4 cards the renderer ships. */
  why_cards?: Array<{
    id:    string
    icon?: string
    title: string
    body:  string
  }>

  /** Authored "Your turn" prompts. When present, replaces the
   *  default 3 prompts the CTA section ships. */
  your_turn_prompts?: string[]

  /** Section-level intro copy for the Shared Hub Pages block. Both
   *  fields optional; falls back to defaults when unset. Only
   *  renders on multi-campus partners (where congregations exist). */
  shared_hubs_headline?: string
  shared_hubs_body?:     string

  /** Optional inspiration image — a reference visual the strategist
   *  wants the partner to see below the sitemap visualization
   *  (moodboard tile, competitor screenshot, brand-guide swatch,
   *  a photograph of the physical space). Absent by default; when
   *  URL is empty the partner view does not render the section at
   *  all so the review stays clean.
   *
   *  The upload is stored in the `brand-assets` bucket via
   *  attachmentUpload.uploadAttachment with pathPrefix keyed to the
   *  project id so cleanup is straightforward. Only the URL is
   *  persisted here; the review UI streams it as a plain <img>. */
  inspiration_image?: {
    url:      string
    alt?:     string
    caption?: string
  }
}

/** Snapshot of the cowork sitemap step's nav_presentation. Copied
 *  into the review at compose time so the partner portal can render
 *  the same visible-header + megamenu preview the strategist saw in
 *  the sitemap step, without reaching for site_strategy through a
 *  second RPC call. Structurally identical to
 *  NavPresentationPanel's expected shape; we keep the local
 *  definition minimal (all fields optional) to stay tolerant of
 *  older runs. */
export interface SitemapReviewNavPresentation {
  shell?:                  'standard_dropdowns' | 'megamenu' | 'offcanvas'
  presentation_rationale?: string
  /** First-class header CTA field — the pill buttons on the far
   *  right of the primary nav row (Give, Plan a Visit, etc). Each
   *  entry supports either an in-site page (slug) or an external
   *  URL, plus a display style. Independent from visible_top_level
   *  so the strategist can promote different sets:
   *
   *    - visible_top_level → the text-link items in the topnav row.
   *    - header_ctas       → the pill buttons at the far right.
   *    - offcanvas_overlay.featured_links → the big vertical stack
   *                          inside the offcanvas panel.
   *
   *  Render precedence (partner view): if header_ctas is authored,
   *  hydrateNavPresentation uses it verbatim for the button row.
   *  Otherwise it falls back to `visible_top_level` items with
   *  kind='button', and then to `nav_layout.cta_only`. */
  header_ctas?: Array<{
    label?:        string
    slug?:         string          // in-site page slug (matches review.pages[].slug)
    url?:          string          // OR external URL
    style?:        'pill_primary' | 'pill_secondary'
  }>
  visible_top_level?:      Array<{ kind?: 'page' | 'group' | 'button' | 'hamburger'; label?: string; slug?: string; group_label?: string }>
  standard_dropdowns?:     { groups?: Array<{ group_label?: string; children?: Array<{ label?: string; slug?: string; one_line_description?: string }> }> }
  megamenu_panels?:        Array<{
    triggered_by?:  string
    columns?:       Array<{ heading?: string; description?: string; links?: Array<{ label?: string; slug?: string; one_line_description?: string }> }>
    featured_tile?: { kind?: 'image_cta' | 'sermon_card' | 'event_card' | 'persona_callout'; heading?: string; body?: string; link_label?: string; link_slug?: string }
  }>
  offcanvas_overlay?: {
    hero_message?: string
    /** Featured links rendered as the large primary column at the
     *  top of the offcanvas panel. Independent from visible_top_level
     *  (which drives the topnav next to the hamburger) so the
     *  strategist can promote a different set of pages inside the
     *  offcanvas than what shows in the compact topnav. Each link
     *  is either an in-site page (page_slug) or an external URL. */
    featured_links?: Array<{ label?: string; page_slug?: string; external_url?: string }>
    sections?:     Array<{ section_label?: string; links?: Array<{ label?: string; slug?: string }> }>
    surfaced_facts?: {
      service_times?: string
      address?:       string
      socials?:       Array<{ platform?: string; url?: string }>
      search?:        boolean
    }
  }
}

export interface SitemapReview {
  schema_version: 1
  token: string
  status: SitemapReviewStatus
  created_at: string
  updated_at: string
  published_at: string | null
  approved_at:  string | null
  approved_by:  'staff' | 'partner' | null
  /** When the partner clicked "Share Sitemap Review Feedback" and the
   *  review flipped to `partner_reviewed`. Also carries the name they
   *  entered at the name gate so the staff-side confirmation banner
   *  can credit them. Both remain null until the partner submits. */
  partner_reviewed_at?: string | null
  partner_reviewed_by?: string | null

  /** ISO timestamp of the last time this review re-hydrated auto-fields
   *  (pages list, nav_layout, persona names/descriptions, migrations)
   *  from `roadmap_state.site_strategy`. Compared against
   *  `site_strategy._meta.generated_at` to decide whether a re-run of
   *  the cowork sitemap step needs to flow into the review.
   *
   *  When strategy is fresher: compose treats strategy as authoritative
   *  for auto-fields while keeping strategist-authored fields
   *  (posture_summary, goal, key_page_slugs, per-page purpose, per-page
   *  what_changed/why_change/strategic_alignment, presentation.*,
   *  congregations, footer_info, intro, executive_summary,
   *  navigation_strategy) intact.
   *
   *  Absent on reviews composed before this watermark was introduced;
   *  compose treats that as "sync required" so the first refresh after
   *  the upgrade fills it in. */
  last_synced_from_strategy_at?: string

  /** Cowork sitemap step's nav_presentation, copied at compose time.
   *  The partner portal renders this via the existing
   *  NavPresentationPanel so the strategist and partner see the same
   *  visible-header + megamenu preview. */
  nav_presentation?: SitemapReviewNavPresentation

  /** Authored presentation layer for the artifact-style wrapper
   *  sections (congregations, featured highlight, page tiers,
   *  summary cards, prompts). Populated by cowork sessions after
   *  the sitemap step; every field is optional and the renderer
   *  falls back to sensible defaults when absent. */
  presentation?: SitemapReviewPresentation

  /** Intro block shown at the top of the partner-facing review; sets
   *  the tone. Editable; strategist authors, partner can rewrite. */
  intro?: {
    headline: string
    body:     string
  }

  /** Big-picture strategic framing that opens the review. Explains
   *  what the site is designed to accomplish for this partner in
   *  plain, partnership-focused language. Two to four short
   *  paragraphs typically. */
  executive_summary?: string

  /** The "heart and why" behind the navigation choices, written
   *  as a warm paragraph that gives the partner context before
   *  they scan the menu structure. */
  navigation_strategy?: string

  /** Site-wide footer contact + link info the partner reviews. */
  footer_info?: FooterInfo

  pages:             ReviewPage[]
  persona_postures:  PersonaPosture[]
  nav_layout:        NavLayout
  content_migrations: ContentMigration[]

  /** Partner-typed free-text feedback that isn't tied to a specific
   *  field. Lives alongside per-field edits. */
  partner_notes?: string

  /** Section-scoped edit requests the partner has pinned. Each entry
   *  has a stable `section_id`; the partner portal drives the
   *  approve-vs-"Share Sitemap Review Feedback" button state from the
   *  count of entries with `status: 'open'`. */
  partner_edit_requests?: PartnerEditRequest[]

  edit_history: EditLogEntry[]
}

// ── Read / write ─────────────────────────────────────────────────────

/** Read the sitemap review for a project (staff context, uses the
 *  authenticated user's session). Returns null when the review hasn't
 *  been initialized yet. */
export async function loadSitemapReview(
  sb: SupabaseClient,
  projectId: string,
): Promise<SitemapReview | null> {
  const { data } = await sb
    .from('strategy_web_projects')
    .select('roadmap_state')
    .eq('id', projectId)
    .maybeSingle()
  const rs = (data as { roadmap_state?: Record<string, unknown> } | null)?.roadmap_state ?? {}
  const raw = (rs as { sitemap_review?: unknown }).sitemap_review
  if (!raw || typeof raw !== 'object') return null
  return raw as SitemapReview
}

/** Write the sitemap review back. Read-merge-write so other roadmap_state
 *  keys are preserved. `updated_at` is stamped automatically.
 *
 *  Also syncs the shared editable fields back into
 *  `roadmap_state.site_strategy` so the cowork step (and its Copy
 *  markdown / Copy JSON download) reflects the strategist's + partner's
 *  latest edits. Without this, editing a page's name / purpose /
 *  audience / funnel in the review UI would silently diverge from the
 *  cowork markdown someone might download from Content Engine.
 *
 *  Sync scope (only the shared fields; review-only fields like
 *  what_changed / persona postures / footer_info stay on
 *  sitemap_review):
 *    - site_strategy.pages[N].name / purpose / primary_audience /
 *      primary_funnel / nav_strategy  (matched by slug)
 *    - site_strategy.pages_considered_dropped[N].reason (matched by
 *      merged_from label ↔ slug when available)
 *    - site_strategy.nav.primary / secondary / secondary_label
 *      (rebuilt from nav_layout when the strategist has edited it) */
export async function saveSitemapReview(
  sb: SupabaseClient,
  projectId: string,
  next: SitemapReview,
): Promise<{ ok: true; review: SitemapReview } | { ok: false; error: string }> {
  const { data: row, error: readErr } = await sb
    .from('strategy_web_projects')
    .select('roadmap_state')
    .eq('id', projectId)
    .maybeSingle()
  if (readErr) return { ok: false, error: readErr.message }
  const rs = ((row as { roadmap_state?: Record<string, unknown> } | null)?.roadmap_state) ?? {}
  const stamped: SitemapReview = { ...next, updated_at: new Date().toISOString() }

  // Sync shared fields back into site_strategy when it exists.
  const nextSiteStrategy = syncToSiteStrategy(rs.site_strategy as unknown, stamped)

  const merged = {
    ...rs,
    sitemap_review: stamped,
    ...(nextSiteStrategy ? { site_strategy: nextSiteStrategy } : {}),
  }
  const { error: writeErr } = await sb
    .from('strategy_web_projects')
    .update({ roadmap_state: merged } as never)
    .eq('id', projectId)
  if (writeErr) return { ok: false, error: writeErr.message }
  return { ok: true, review: stamped }
}

/** Merge the review's edits back into a site_strategy blob so cowork
 *  and the site_strategy JSON download stay in sync. Only touches the
 *  fields that overlap between the two shapes; leaves cowork-only
 *  fields (persona_journeys, covers_cells, has_children, etc.)
 *  untouched. Returns null when there's no site_strategy to sync into
 *  (cowork step hasn't run) so the caller skips the merge. */
function syncToSiteStrategy(
  existingSiteStrategy: unknown,
  review: SitemapReview,
): Record<string, unknown> | null {
  if (!existingSiteStrategy || typeof existingSiteStrategy !== 'object') return null
  const strategy = existingSiteStrategy as {
    pages?:                    Array<Record<string, unknown>>
    nav?:                      { primary?: unknown; footer?: unknown; cta_only?: unknown } | Record<string, unknown>
    pages_considered_dropped?: Array<Record<string, unknown>>
    [k: string]:               unknown
  }

  // Sync pages by slug. Only the strategist-mutable fields are touched;
  // everything else on the site_strategy page (covers_cells, nav_order,
  // has_children, parent_slug from cowork's original run) is preserved.
  const reviewBySlug = new Map(review.pages.map(p => [p.slug, p]))
  const nextPages: Array<Record<string, unknown>> = (strategy.pages ?? []).map(sp => {
    const slug = sp.slug as string | undefined
    if (!slug) return sp
    const rp = reviewBySlug.get(slug)
    if (!rp) return sp
    return {
      ...sp,
      name:             rp.name,
      purpose:          rp.purpose,
      primary_audience: rp.primary_audience ?? sp.primary_audience,
      primary_funnel:   rp.funnel_stage ?? sp.primary_funnel,
      nav_strategy:     rp.nav_strategy ?? sp.nav_strategy,
    }
  })

  // Sync nav layout. Rebuild strategy.nav.primary + .secondary from
  // review header + secondary items when present; keep footer +
  // cta_only from the strategy since the review doesn't fully model
  // those yet (footer editor is still a follow-up).
  const existingNav = (strategy.nav && typeof strategy.nav === 'object') ? strategy.nav : {}
  const rebuildNavList = (items: NavItem[]): Array<Record<string, unknown>> =>
    items.map(item => item.slug
      ? { slug: item.slug, label: item.label, ...(item.children && item.children.length > 0
          ? { children: item.children.map(c => c.slug ? { slug: c.slug, label: c.label } : { label: c.label }) }
          : {}) }
      : { label: item.label })
  const rebuiltPrimary = review.nav_layout.header.length > 0
    ? rebuildNavList(review.nav_layout.header)
    : (existingNav as { primary?: unknown }).primary
  const reviewSecondary = review.nav_layout.secondary ?? []
  const rebuiltSecondary = reviewSecondary.length > 0
    ? rebuildNavList(reviewSecondary)
    : (existingNav as { secondary?: unknown }).secondary
  const rebuiltSecondaryLabel = review.nav_layout.secondary_label
    ?? (existingNav as { secondary_label?: string }).secondary_label

  // Sync migrations. Match by merged_from[0] label since that's what
  // buildDroppedFromMigrations emits into the review; strategy uses a
  // slug-only shape so we only touch reason when it changed.
  const nextDropped: Array<Record<string, unknown>> = (strategy.pages_considered_dropped ?? []).map(d => {
    const slug = d.slug as string | undefined
    if (!slug) return d
    const match = review.content_migrations.find(m =>
      m.merged_from.some(label => label && label.toLowerCase() === formatSlugAsTitle(slug).toLowerCase()),
    )
    if (!match) return d
    return { ...d, reason: match.rationale || d.reason }
  })

  return {
    ...strategy,
    pages: nextPages,
    nav: {
      ...existingNav,
      ...(rebuiltPrimary   !== undefined ? { primary:   rebuiltPrimary }   : {}),
      ...(rebuiltSecondary !== undefined ? { secondary: rebuiltSecondary } : {}),
      ...(rebuiltSecondaryLabel !== undefined ? { secondary_label: rebuiltSecondaryLabel } : {}),
    },
    pages_considered_dropped: nextDropped,
  }
}

// ── Compose from existing project state ──────────────────────────────

interface ComposeSourceProject {
  id: string
  church_name?: string | null
  personas?: Array<{ id: string; name: string; archetype?: string; description?: string }> | null
  nav_group_definitions?: Array<{ label: string; sort_order?: number }> | null
  roadmap_state?: unknown
  /** Every project column we consider surfacing on the review's footer
   *  block. All optional; missing values render empty (not null).
   *  Analytics-safe: no PII beyond what the partner already published. */
  address?:               string | null
  city_state?:            string | null
  phone?:                 string | null
  email?:                 string | null
  primary_service_time?:  string | null
  all_service_times?:     string | null
  social_facebook_url?:   string | null
  social_instagram_url?:  string | null
  social_youtube_url?:    string | null
  social_tiktok_url?:     string | null
  social_twitter_url?:    string | null
  social_linkedin_url?:   string | null
}

interface ComposeSourceWebPage {
  id: string
  slug: string
  name: string | null
  phase?: string | null
  sort_order?: number | null
  nav_group_label?: string | null
  user_journey_step?: number | null
}

/** The grouped shape cowork's plan-site-strategy step writes for
 *  the footer region as of 2026-07. See the `footer?` field on
 *  SiteStrategyBlob.nav for full docs on when this vs the flat array
 *  arrives. */
interface CoworkGroupedFooter {
  primary_links?: Array<string | { slug?: string; label?: string }>
  explore?:       Array<string | { slug?: string; label?: string }>
  legal?:         Array<string | { slug?: string; label?: string }>
  social?:        string[]
  parked?:        Array<{ label?: string; reason?: string }>
  contact_block?: boolean
  service_times?: boolean
}

/** Type guard: is this footer value the new grouped-object shape
 *  (not an array)? Cowork emits the grouped shape for new projects;
 *  older projects (or the Doxology legacy write) may still emit an
 *  array. Both routes converge in extractCoworkFooterGroups(). */
function isGroupedFooter(v: unknown): v is CoworkGroupedFooter {
  return !!v
    && typeof v === 'object'
    && !Array.isArray(v)
}

/** Extract footer link groups from cowork's `nav.footer` in whichever
 *  shape it arrived. Returns:
 *   - `groups`: array of {heading, links} suitable for feeding into
 *     `footer_info.footer_link_groups`. Empty when cowork wrote no
 *     footer data or every group had zero resolvable links.
 *   - `flat`: same links squashed into one array, matching the shape
 *     `buildNavLayoutFromStrategy` already expects, so
 *     `nav_layout.footer_sections` and `buildNavPositionMap` keep
 *     working for grouped inputs too.
 *
 *  Default group headings ("Take a next step", "Explore", "Fine
 *  print") are partner-facing. The strategist can rename them in the
 *  sitemap review editor after the initial seed. */
function extractCoworkFooterGroups(
  footer: Array<{ slug?: string; label?: string } | string> | CoworkGroupedFooter | null | undefined,
  nameBySlug: Map<string, string>,
): {
  groups: FooterLinkGroup[]
  flat: Array<{ slug?: string; label?: string } | string>
} {
  const flat: Array<{ slug?: string; label?: string } | string> = []
  const groups: FooterLinkGroup[] = []
  if (!footer) return { groups, flat }

  // Helper: resolve a slug-or-object into a {label, url?} with the
  // label falling back to the pages-map name or a title-cased slug.
  // Blank labels are dropped so a stale slug doesn't render as "".
  const resolveEntry = (item: string | { slug?: string; label?: string } | undefined): { label: string; url?: string | null } | null => {
    if (!item) return null
    if (typeof item === 'string') {
      const label = nameBySlug.get(item) ?? formatSlugAsTitle(item)
      if (!label) return null
      return { label, url: `/${item.replace(/^\/+/, '')}` }
    }
    if (typeof item !== 'object') return null
    const slug = item.slug
    const label = item.label ?? (slug ? (nameBySlug.get(slug) ?? formatSlugAsTitle(slug)) : '')
    if (!label) return null
    return { label, url: slug ? `/${slug.replace(/^\/+/, '')}` : null }
  }

  // Flat-array shape: single "Explore" group, matches the pre-2026-07
  // cowork output and the manual-fallback path.
  if (Array.isArray(footer)) {
    const links = footer.map(resolveEntry).filter((l): l is { label: string; url?: string | null } => !!l)
    if (links.length > 0) {
      groups.push({ id: 'grp-explore', heading: 'Explore', links })
    }
    for (const raw of footer) flat.push(raw)
    return { groups, flat }
  }

  // Grouped-object shape: iterate known column keys in the order
  // we want them rendered (highest-intent first).
  if (isGroupedFooter(footer)) {
    const columnOrder: Array<{ key: keyof CoworkGroupedFooter & string; heading: string; groupId: string }> = [
      { key: 'primary_links', heading: 'Take a next step', groupId: 'grp-primary' },
      { key: 'explore',       heading: 'Explore',           groupId: 'grp-explore' },
      { key: 'legal',         heading: 'Fine print',        groupId: 'grp-legal'   },
    ]
    for (const col of columnOrder) {
      const rawList = footer[col.key]
      if (!Array.isArray(rawList)) continue
      const links = rawList.map(resolveEntry).filter((l): l is { label: string; url?: string | null } => !!l)
      if (links.length === 0) continue
      groups.push({ id: col.groupId, heading: col.heading, links })
      for (const raw of rawList) flat.push(raw as string | { slug?: string; label?: string })
    }
    // `social`, `parked`, `contact_block`, `service_times` intentionally
    // ignored here — they don't map to link groups.
  }

  return { groups, flat }
}

/** Shape of `roadmap_state.site_strategy`, the cowork "plan-site-strategy"
 *  step output. Loosely typed because we defensively index; only the
 *  fields we consume are documented here. */
interface SiteStrategyBlob {
  pages?: Array<{
    name?:              string
    slug?:              string
    purpose?:           string
    nav_order?:         number
    nav_strategy?:      string
    primary_audience?:  string
    primary_funnel?:    string
    has_children?:      boolean
    parent_slug?:       string | null
  }>
  nav?: {
    primary?:   Array<{ slug?: string; label?: string; children?: Array<{ slug?: string; label?: string }> } | string>
    /** Secondary region (off-canvas / utility / drawer / etc.).
     *  Same polymorphic shape as primary: entries can be strings
     *  (slugs) or objects with an optional child list. Cowork writes
     *  here when the strategist declares a secondary nav; otherwise
     *  it's absent and compose falls back to inferring from pages
     *  whose nav_strategy is 'secondary'. */
    secondary?: Array<{ slug?: string; label?: string; children?: Array<{ slug?: string; label?: string }> } | string>
    /** Label the cowork step suggested for the secondary region
     *  ("Off-canvas menu", "Utility nav", etc.). */
    secondary_label?: string
    /** Footer region. Cowork emits one of two shapes:
     *   1. FLAT (legacy, older cowork runs): an array of slug-strings
     *      or {slug,label} objects, all rendered under a single
     *      "Explore" column.
     *   2. GROUPED (current cowork output as of 2026-07): an object
     *      with keys `primary_links`, `explore`, `legal`, `social`,
     *      `parked`, `contact_block`, `service_times`. Each of the
     *      link-list keys (`primary_links`, `explore`, `legal`) is
     *      a slug array; the flags (`contact_block`, `service_times`)
     *      are booleans that don't feed the reverse-lookup section.
     *      `parked` holds not-yet-ready items and is excluded from
     *      render. `social` is a list of platform names, resolved
     *      elsewhere against strategy_web_projects.social_* URLs.
     *
     *  Compose translates both shapes into `footer_info.footer_link_groups`
     *  (grouped columns for the partner render) and flattens all link
     *  slugs into `nav_layout.footer_sections` for nav-position tagging. */
    footer?:    Array<{ slug?: string; label?: string } | string> | CoworkGroupedFooter
    cta_only?:  Array<{ slug?: string; label?: string } | string>
  }
  persona_journeys?: Array<{
    persona?:       string
    journey?:       string[]
    entry_points?:  string[]
    drop_off_risk?: { at_slug?: string; reason?: string; mitigation?: string }
  }>
  pages_considered_dropped?: Array<{
    slug?:       string
    from_label?: string
    reason?:     string
    merged_to?:  string
  }>
}

/** Compose a first-draft sitemap review from the current project state.
 *
 *  Prefers `roadmap_state.site_strategy` (the cowork plan-site-strategy
 *  step output) as the source of truth, that has rich per-page context
 *  (purpose, primary audience, funnel stage, nav strategy), curated nav
 *  layout, persona journeys, and pages_considered_dropped rationale.
 *  Falls back to raw `web_pages` + `nav_group_definitions` when
 *  site_strategy hasn't run yet.
 *
 *  Idempotent when re-run against an existing review: preserves fields
 *  the strategist already authored (purpose overrides, posture_summary
 *  edits, added user_journey steps, etc.) and only fills blanks. */
export function composeSitemapReview(args: {
  project:  ComposeSourceProject
  pages:    ComposeSourceWebPage[]
  existing: SitemapReview | null
}): SitemapReview {
  const { project, pages, existing } = args
  const now = new Date().toISOString()

  const rs = (project.roadmap_state ?? {}) as Record<string, unknown>
  const strategy = (rs.site_strategy ?? null) as SiteStrategyBlob | null

  const existingPagesBySlug = new Map<string, ReviewPage>()
  for (const p of existing?.pages ?? []) existingPagesBySlug.set(p.slug, p)

  // Web-pages lookup so we can back-fill web_page_id when the strategist
  // list references a slug that's already committed as a real row.
  const webPageBySlug = new Map<string, ComposeSourceWebPage>()
  for (const p of pages) webPageBySlug.set(p.slug, p)

  // Nav-position labeling, derives a human-readable "where in the nav"
  // from site_strategy.nav (primary / footer / cta_only) so the review
  // renders "Header · primary" instead of leaving nav_position blank.
  const navPositionBySlug = buildNavPositionMap(strategy?.nav)

  // Source-of-truth precedence for pages, watermark-aware:
  //   1. When the underlying site_strategy has been re-run since the
  //      last time this review synced (strategy._meta.generated_at
  //      > review.last_synced_from_strategy_at), STRATEGY WINS for the
  //      page list. This is what makes a cowork sitemap re-run flow
  //      into the partner review automatically. Per-page authored
  //      fields (purpose overrides, sitemap_tag, what_changed,
  //      why_change, strategic_alignment, name overrides) survive
  //      via slug-keyed carry-forward from the existing review.
  //   2. When the review has authored pages and strategy has NOT
  //      moved forward, use the existing pages list as the source.
  //      This prevents accidental churn on every load.
  //   3. Otherwise fall back to strategy.pages (fresh compose).
  //   4. Otherwise fall back to raw web_pages.
  const strategyPages = Array.isArray(strategy?.pages) ? strategy!.pages! : []
  const strategyBySlug = new Map(strategyPages.filter(p => typeof p.slug === 'string' && p.slug !== '_meta').map(p => [p.slug!, p]))
  const strategyGeneratedAt = readStrategyGeneratedAt(strategy)
  const reviewSyncedAt      = existing?.last_synced_from_strategy_at ?? null
  const strategyIsFresher   = !!strategyGeneratedAt && strategyGeneratedAt > (reviewSyncedAt ?? '')

  // Defensive drift detection. The watermark relies on writers (the
  // revise-site-strategy cowork skill, mainly) to bump
  // site_strategy._meta.generated_at every time they edit the
  // strategy. In practice writers sometimes miss the bump, leaving
  // the review stuck on a stale snapshot even though strategy has
  // moved on. When the strategy's slug set differs from what the
  // review last snapshotted, force a resync regardless of what the
  // timestamp claims. Slug-keyed carry-forward still preserves any
  // per-page authored fields on the review side.
  const strategySlugSet = new Set(
    strategyPages
      .filter(p => typeof p.slug === 'string' && p.slug !== '_meta')
      .map(p => p.slug as string),
  )
  const reviewSlugSet = new Set((existing?.pages ?? []).map(p => p.slug))
  const structuralDrift =
    strategySlugSet.size > 0
    && reviewSlugSet.size > 0
    && (
      strategySlugSet.size !== reviewSlugSet.size
      || [...strategySlugSet].some(s => !reviewSlugSet.has(s))
      || [...reviewSlugSet].some(s => !strategySlugSet.has(s))
    )

  // Refresh path fires when strategy is fresher by watermark OR when
  // the two sides drifted structurally (writer failed to bump the
  // watermark). Either way strategy is authoritative for auto-fields.
  const shouldResyncFromStrategy = (strategyIsFresher || structuralDrift) && strategyPages.length > 0
  const useExistingAsSource      = !shouldResyncFromStrategy && (existing?.pages ?? []).length > 0

  // Seed heuristic: strategy pages with `has_children: true` are
  // nav dropdown parents (Teaching → Messages/Blog/Podcast, Life
  // at Woodcreek → Kids/Youth/…). Default them to is_nav_parent_only
  // so they don't get treated as real pages downstream. Strategist
  // can uncheck any that ARE real destinations.
  const inferNavParentOnly = (sp: (typeof strategyPages)[number] | undefined): boolean | undefined => {
    if (!sp || typeof sp !== 'object') return undefined
    const hasChildren = (sp as { has_children?: unknown }).has_children === true
    return hasChildren || undefined
  }

  const composedPages: ReviewPage[] = (useExistingAsSource
    ? (existing!.pages)
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((prior, i) => {
          const sp = strategyBySlug.get(prior.slug)
          return {
            ...prior,
            order: i,
            // Fill absent fields from strategy when the slug exists there,
            // but never overwrite what the strategist has already authored.
            purpose:          prior.purpose && prior.purpose.trim() ? prior.purpose : (sp?.purpose ?? prior.purpose ?? ''),
            nav_position:     prior.nav_position ?? navPositionBySlug.get(prior.slug) ?? (sp?.nav_strategy ? capitalize(sp.nav_strategy) : undefined),
            primary_audience: prior.primary_audience ?? sp?.primary_audience ?? null,
            funnel_stage:     prior.funnel_stage ?? sp?.primary_funnel ?? null,
            nav_strategy:     prior.nav_strategy ?? sp?.nav_strategy ?? null,
            parent_slug:      prior.parent_slug ?? sp?.parent_slug ?? null,
            // Preserve strategist's checkbox state; seed from strategy on first sync.
            is_nav_parent_only: prior.is_nav_parent_only ?? inferNavParentOnly(sp),
          }
        })
    : strategyPages.length > 0
    ? strategyPages
        .filter(p => typeof p.slug === 'string' && p.slug && p.slug !== '_meta')
        .sort((a, b) => (a.nav_order ?? 0) - (b.nav_order ?? 0))
        .map((sp, i) => {
          const slug = sp.slug as string
          const prior = existingPagesBySlug.get(slug)
          const wp = webPageBySlug.get(slug)
          const navPos = navPositionBySlug.get(slug) ?? (sp.nav_strategy ? capitalize(sp.nav_strategy) : undefined)
          return {
            id:                prior?.id ?? cryptoRandomId(),
            web_page_id:       wp?.id ?? prior?.web_page_id,
            slug,
            name:              prior?.name ?? sp.name ?? slug,
            purpose:           prior?.purpose && prior.purpose.trim() ? prior.purpose : (sp.purpose ?? ''),
            nav_position:      prior?.nav_position ?? navPos,
            parent_slug:       prior?.parent_slug ?? sp.parent_slug ?? null,
            order:             i,
            persona_relevance: prior?.persona_relevance ?? [],
            primary_audience:  prior?.primary_audience ?? sp.primary_audience ?? null,
            funnel_stage:      prior?.funnel_stage ?? sp.primary_funnel ?? null,
            nav_strategy:      prior?.nav_strategy ?? sp.nav_strategy ?? null,
            is_nav_parent_only: prior?.is_nav_parent_only ?? inferNavParentOnly(sp),
            // Preserve strategist-authored per-page fields across
            // recompose so tags, migration explanations, and strategy
            // alignment survive a load->save round-trip.
            sitemap_tag:         prior?.sitemap_tag,
            what_changed:        prior?.what_changed,
            why_change:          prior?.why_change,
            strategic_alignment: prior?.strategic_alignment,
          }
        })
    : pages
        .filter(p => p.slug && p.slug !== '_meta')
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map((p, i) => {
          const prior = existingPagesBySlug.get(p.slug)
          return {
            id:                prior?.id ?? cryptoRandomId(),
            web_page_id:       p.id,
            slug:              p.slug,
            name:              prior?.name ?? p.name ?? p.slug,
            purpose:           prior?.purpose ?? '',
            nav_position:      prior?.nav_position ?? (p.nav_group_label ? `Header → ${p.nav_group_label}` : undefined),
            parent_slug:       prior?.parent_slug,
            order:             i,
            persona_relevance: prior?.persona_relevance ?? [],
            primary_audience:  prior?.primary_audience ?? null,
            funnel_stage:      prior?.funnel_stage ?? null,
            nav_strategy:      prior?.nav_strategy ?? null,
            sitemap_tag:         prior?.sitemap_tag,
            what_changed:        prior?.what_changed,
            why_change:          prior?.why_change,
            strategic_alignment: prior?.strategic_alignment,
          }
        })
  )

  // Append any strategist-authored pages that exist in the prior
  // review but aren't produced by site_strategy or web_pages (e.g.
  // Beliefs, Staff, Family Life, and other tier-scaffolding pages
  // the strategist has added via cowork or SQL). Without this,
  // recomposing an existing review would silently drop those pages,
  // breaking any presentation.tiers that reference them.
  const composedSlugs = new Set(composedPages.map(p => p.slug))
  const nextOrderStart = composedPages.length
  const preservedExtras: ReviewPage[] = []
  for (const prior of existing?.pages ?? []) {
    if (!composedSlugs.has(prior.slug)) {
      preservedExtras.push({ ...prior, order: nextOrderStart + preservedExtras.length })
    }
  }
  composedPages.push(...preservedExtras)

  const existingPosturesById = new Map<string, PersonaPosture>()
  for (const pp of existing?.persona_postures ?? []) existingPosturesById.set(pp.persona_id, pp)

  // Persona journeys from site_strategy, keyed by persona NAME
  // (strategy stores lowercase name, personas[] has a name field).
  const journeyByPersonaName = new Map<string, NonNullable<SiteStrategyBlob['persona_journeys']>[number]>()
  for (const j of strategy?.persona_journeys ?? []) {
    if (typeof j.persona === 'string') journeyByPersonaName.set(j.persona.toLowerCase(), j)
  }

  // Persona source resolution.
  //
  // The `personas` column on strategy_web_projects is the intended
  // canonical location, but earlier cowork runs wrote personas to
  // `roadmap_state.stage_1.personas` and never back-filled the
  // column. The column is empty on many older projects even when
  // stage_1 has 4+ personas ready to use.
  //
  // Fall back to stage_1 when the column is empty. The stage_1 shape
  // is `{ name, bio_one_line, desire, barrier, likely_entry_points }`
  // (no id field), so we synthesize a stable id from the name.
  interface Stage1Persona {
    name?: string
    bio_one_line?: string
    desire?: string
    barrier?: string
    description?: string
  }
  const stage1Personas = ((rs as { stage_1?: { personas?: Stage1Persona[] } })?.stage_1?.personas ?? [])
    .filter((p): p is Stage1Persona => !!p && typeof p === 'object' && typeof p.name === 'string')
  const columnPersonas = project.personas ?? []
  const personaSource: Array<{ id: string; name: string; description: string }> =
    columnPersonas.length > 0
      ? columnPersonas.map(p => ({
          id:          p.id,
          name:        p.name,
          description: p.description ?? '',
        }))
      : stage1Personas.map(p => ({
          id:          synthesizePersonaId(p.name!),
          name:        p.name!,
          description: [p.bio_one_line, p.desire && `Wants: ${p.desire}`, p.barrier && `Worries: ${p.barrier}`]
            .filter(Boolean).join(' • '),
        }))

  // Set of currently-valid page slugs. Persona postures reference
  // pages by slug; when strategy renames or drops a page, those refs
  // go stale. Prune stale entries at compose time so the display
  // never shows a false "3/3 selected" count against invalid slugs.
  // Strategist re-picks in the editor to top back up to 3.
  const validPageSlugs = new Set(composedPages.map(p => p.slug))

  const composedPostures: PersonaPosture[] = personaSource.map(persona => {
    const prior = existingPosturesById.get(persona.id)
    const journey = journeyByPersonaName.get(persona.name.toLowerCase())
    // Seed key_page_slugs from the strategy brief's likely_entry_points
    // (top 3 max). No fabricated pages — if the brief lacks entry points,
    // the strategist picks pages in the editor.
    const seededKeyPages = (journey?.entry_points ?? []).slice(0, 3)
    // Prune stale refs against the current pages set.
    const priorKeys = (prior?.key_page_slugs ?? []).filter(s => validPageSlugs.has(s))
    const seededKeys = seededKeyPages.filter(s => validPageSlugs.has(s))
    return {
      persona_id:      persona.id,
      persona_name:    persona.name,
      posture_summary: prior?.posture_summary ?? persona.description ?? '',
      goal:            prior?.goal,
      key_page_slugs:  priorKeys.length > 0 ? priorKeys.slice(0, 3) : seededKeys,
      primary_congregation_id: prior?.primary_congregation_id,
      drop_off_risk:   prior?.drop_off_risk ?? (
        journey?.drop_off_risk?.at_slug && journey?.drop_off_risk?.reason
          ? {
              at_slug:    journey.drop_off_risk.at_slug,
              reason:     journey.drop_off_risk.reason ?? '',
              mitigation: journey.drop_off_risk.mitigation ?? '',
            }
          : undefined
      ),
      // Legacy fields preserved from prior data for older reviews that
      // still reference them, but no longer authored or rendered.
      user_journey:             prior?.user_journey,
      journeys_by_congregation: prior?.journeys_by_congregation,
      entry_points:             prior?.entry_points,
    }
  })

  // Nav layout: same watermark rule as pages. When strategy is fresher
  // rebuild from strategy so nav changes flow into the review. When
  // strategy isn't fresher, keep the existing nav (protects strategist-
  // authored overrides across recompose).
  const rebuiltNavFromStrategy = buildNavLayoutFromStrategy(strategy, composedPages)
  const composedNavPre: NavLayout = shouldResyncFromStrategy && rebuiltNavFromStrategy
    ? rebuiltNavFromStrategy
    : existing?.nav_layout ?? rebuiltNavFromStrategy ?? {
        header: (project.nav_group_definitions ?? [])
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          .map(g => ({ label: g.label })),
        footer_sections: [],
      }
  // Backfill cta_only from strategy on stable loads when the review
  // predates the field. Never overwrites an already-populated
  // cta_only (strategist edits win). Small enough that it's worth
  // doing outside the full watermark refresh so partner previews
  // pick up CTAs on next load without forcing a manual refresh.
  const composedNav: NavLayout = (composedNavPre.cta_only?.length ?? 0) === 0
    && (rebuiltNavFromStrategy?.cta_only?.length ?? 0) > 0
      ? { ...composedNavPre, cta_only: rebuiltNavFromStrategy!.cta_only }
      : composedNavPre

  // Content migrations: seed from pages_considered_dropped. On a
  // watermark refresh, re-seed from the freshest pages_considered_dropped
  // so a cowork re-run that changed which pages are dropping actually
  // updates the "what changed / why" cards on the review. Otherwise
  // keep existing (strategist-authored migrations survive).
  const seededMigrations = (strategy?.pages_considered_dropped ?? [])
    .filter(d => typeof d.slug === 'string' && (d.reason ?? '').trim())
    .map(d => ({
      id:          cryptoRandomId(),
      title:       d.from_label ?? formatSlugAsTitle(d.slug as string),
      merged_from: [d.from_label ?? formatSlugAsTitle(d.slug as string)],
      merged_to:   d.merged_to ?? '(consolidated across the new site)',
      rationale:   d.reason ?? '',
    }))
  const composedMigrations: ContentMigration[] = shouldResyncFromStrategy && seededMigrations.length > 0
    ? seededMigrations
    : (existing?.content_migrations && existing.content_migrations.length > 0
        ? existing.content_migrations
        : seededMigrations)

  // "Show your work" seeding for each page's what_changed /
  // why_change / strategic_alignment. Reads the structural signals we
  // already have (audience, funnel, nav_strategy, persona journeys,
  // migrations pointing at this slug) and composes partner-facing
  // reasoning. Only fills fields the strategist hasn't authored;
  // existing edits always win.
  for (const p of composedPages) {
    const seed = seedShowYourWorkForPage({
      page:       p,
      strategy,
      rs,
      churchName: project.church_name,
      postures:   composedPostures,
      migrations: composedMigrations,
    })
    if (!p.what_changed        && seed.what_changed)        p.what_changed        = seed.what_changed
    if (!p.why_change          && seed.why_change)          p.why_change          = seed.why_change
    if (!p.strategic_alignment && seed.strategic_alignment) p.strategic_alignment = seed.strategic_alignment
    // Auto-derive sitemap_tag from migration lookup + copy signals.
    // Only seeds when strategist hasn't set one explicitly.
    if (!p.sitemap_tag) p.sitemap_tag = deriveSitemapTag(p, composedMigrations)
  }

  // Big-picture strategic framing pulled from strategic_goals when
  // available. Combines the church's own approved vision language
  // with the strategist's x-factor read so the partner opens the
  // review already grounded in the "why" of the whole site, not just
  // the mechanics of the pages.
  const composedExecSummary = existing?.executive_summary
    ?? buildExecutiveSummary({ project, rs, church: project.church_name })

  // Navigation "heart and why" paragraph. Seeded from the sitemap
  // step's handoff_note (which already argues for the nav choices
  // in prose) when available; otherwise a warm generic that the
  // strategist rewrites.
  const composedNavStrategy = existing?.navigation_strategy
    ?? buildNavigationStrategy({ strategy, church: project.church_name })

  // Nav-presentation snapshot — refreshes on watermark drift so a
  // cowork sitemap re-run that emitted new visible_top_level items /
  // megamenu panels flows into the partner view. Existing wins on
  // stable loads.
  //
  // COWORK-SCHEMA NORMALIZATION: cowork's sitemap step sometimes
  // emits nav_presentation in a completely different shape than the
  // one PrimaryNavPreview reads (top-level `header.items[]` /
  // `header.buttons[]` / `megamenus.<label>` instead of
  // `visible_top_level` / `header_ctas` / `megamenu_panels[]`).
  // Doxology's authored strategy uses the cowork shape verbatim.
  // Without normalization, the render code silently discards
  // everything cowork emitted and falls back to nav_layout.header —
  // partner review has been showing the derived-from-nav.primary
  // structure instead of the strategist-approved nav for days.
  // normalizeCoworkNavPresentation translates the cowork shape into
  // the internal shape at compose time so downstream reads work.
  const legacyStage2 = (rs as { stage_2?: { nav_presentation?: unknown } })?.stage_2
  const rawStrategyNp =
    (strategy as { nav_presentation?: unknown } | null)?.nav_presentation
    ?? (legacyStage2?.nav_presentation as unknown | undefined)
    ?? null
  const strategyNavPresentation = normalizeCoworkNavPresentation(rawStrategyNp, existing?.presentation?.congregations)
  const existingNormalized = normalizeCoworkNavPresentation(existing?.nav_presentation, existing?.presentation?.congregations)
  const composedNavPresentation = shouldResyncFromStrategy && strategyNavPresentation
    ? strategyNavPresentation
    : existingNormalized ?? strategyNavPresentation

  // Presentation layer. Preserves any cowork-authored content and
  // seeds Why cards from real strategy signals (church_vision,
  // x_factor, persona count, migration count, page count) when the
  // strategist has not authored them yet. This gets partners past
  // the "same 4 generic cards for everyone" complaint: every review
  // opens with cards keyed to that partner's own approved vision
  // and the actual decisions made in the sitemap.
  const composedPresentation: SitemapReviewPresentation | undefined = (() => {
    const priorPres = existing?.presentation
    const authoredWhy = priorPres?.why_cards
    if (authoredWhy && authoredWhy.length > 0) return priorPres
    const seededWhy = buildWhyCardsFromStrategy({
      rs,
      church:          project.church_name,
      pages:           composedPages,
      migrationCount:  composedMigrations.length,
      personaCount:    composedPostures.length,
    })
    if (!priorPres && !seededWhy) return undefined
    return { ...(priorPres ?? {}), why_cards: seededWhy ?? undefined }
  })()

  // Footer info hydrated from the project's global columns. Every
  // field remains editable so the partner can correct anything that
  // changed since intake.
  const composedFooter: FooterInfo = existing?.footer_info ?? {
    church_name:          project.church_name ?? null,
    address:              project.address ?? null,
    phone:                project.phone ?? null,
    email:                project.email ?? null,
    office_hours:         null,
    service_times:        project.all_service_times ?? project.primary_service_time ?? null,
    newsletter_signup_url: null,
    social_links:         [
      project.social_facebook_url  ? { platform: 'facebook' as const,  url: project.social_facebook_url }  : null,
      project.social_instagram_url ? { platform: 'instagram' as const, url: project.social_instagram_url } : null,
      project.social_youtube_url   ? { platform: 'youtube' as const,   url: project.social_youtube_url }   : null,
      project.social_tiktok_url    ? { platform: 'tiktok' as const,    url: project.social_tiktok_url }    : null,
      project.social_twitter_url   ? { platform: 'twitter' as const,   url: project.social_twitter_url }   : null,
      project.social_linkedin_url  ? { platform: 'linkedin' as const,  url: project.social_linkedin_url }  : null,
    ].filter((s): s is NonNullable<typeof s> => s !== null),
    footer_page_links:    [],
  }

  // Backfill service_times for pre-existing reviews that were created
  // before this field was on FooterInfo. Only fills when the strategist
  // hasn't already authored it (undefined AND null both count as
  // unpopulated). Doesn't clobber an explicit empty string, since a
  // strategist could choose to blank it deliberately.
  if (existing?.footer_info && composedFooter.service_times == null) {
    const seed = project.all_service_times ?? project.primary_service_time ?? null
    if (seed) composedFooter.service_times = seed
  }

  // Seed footer_link_groups from cowork's grouped `nav.footer` output.
  // Cowork writes {primary_links, explore, legal, social, parked,
  // contact_block, service_times}; we translate the link-carrying keys
  // into headed columns.
  //
  // First-time-seed only: once the review has any authored groups,
  // never overwrite them (strategist may have renamed headings or
  // reordered). To reseed from a new cowork run, the strategist
  // clears all groups in the editor and reopens — an empty state
  // triggers a fresh seed on the next compose.
  //
  // extractCoworkFooterGroups also returns a `flat` array so the
  // downstream buildNavLayoutFromStrategy + buildNavPositionMap
  // work for grouped inputs the same as for legacy flat inputs.
  const nameBySlugForFooter = new Map<string, string>()
  for (const p of composedPages) nameBySlugForFooter.set(p.slug, p.name)
  const coworkFooterExtract = extractCoworkFooterGroups(strategy?.nav?.footer, nameBySlugForFooter)
  const existingHasGroups = ((existing?.footer_info?.footer_link_groups ?? []).length > 0)
  if (!existingHasGroups && coworkFooterExtract.groups.length > 0) {
    composedFooter.footer_link_groups = coworkFooterExtract.groups
  }

  return {
    schema_version:     1,
    token:              existing?.token ?? cryptoRandomId(),
    status:             existing?.status ?? 'draft',
    created_at:         existing?.created_at ?? now,
    updated_at:         now,
    published_at:       existing?.published_at ?? null,
    approved_at:        existing?.approved_at ?? null,
    approved_by:        existing?.approved_by ?? null,
    intro:              existing?.intro ?? {
      headline: `${project.church_name ?? 'Your church'} Website Content Strategy`,
      body:     `Here's the proposed structure for your new website: what each page is for, how they fit together, and how the whole site is shaped around the people you're inviting into your church family. Everything on this page is editable. Read through it, share it with your team, and tell us what to refine. This is a working draft we build together.`,
    },
    executive_summary:  composedExecSummary,
    navigation_strategy: composedNavStrategy,
    nav_presentation:   composedNavPresentation,
    presentation:       composedPresentation,
    footer_info:        composedFooter,
    pages:              composedPages,
    persona_postures:   composedPostures,
    nav_layout:         composedNav,
    content_migrations: composedMigrations,
    partner_notes:      existing?.partner_notes,
    edit_history:       existing?.edit_history ?? [],
    // Watermark stamp — moves forward whenever this compose call
    // used strategy as the authoritative source for auto-fields.
    // Stays where it was on stable recomposes so subsequent loads
    // stay in existing-wins mode until the sitemap step runs again.
    last_synced_from_strategy_at: shouldResyncFromStrategy
      ? (strategyGeneratedAt ?? existing?.last_synced_from_strategy_at)
      : existing?.last_synced_from_strategy_at,
  }
}

/** Extract site_strategy._meta.generated_at defensively — strategy is
 *  a loose blob, this key may be absent on legacy shapes. */
function readStrategyGeneratedAt(strategy: SiteStrategyBlob | null): string | null {
  if (!strategy || typeof strategy !== 'object') return null
  const meta = (strategy as { _meta?: { generated_at?: unknown } })._meta
  const at = meta?.generated_at
  return typeof at === 'string' ? at : null
}

/** Normalize the cowork-emitted nav_presentation shape into the
 *  internal shape PrimaryNavPreview reads. Detects the cowork shape
 *  by presence of top-level `header` OR `megamenus` keys and rewrites
 *  the whole blob. Idempotent — passing an already-internal shape
 *  through returns it unchanged.
 *
 *  Cowork shape (what plan-site-strategy actually emits for
 *  Doxology and other multi-campus/megamenu projects):
 *
 *    {
 *      header: {
 *        logo: 'home',
 *        items: [{ type: 'megamenu'|'link', label }],
 *        buttons: ['Visit', 'Watch']
 *      },
 *      megamenus: {
 *        'About Doxology': {
 *          columns: [['about','beliefs','staff','stories','careers']],
 *          feature: { label: 'Kingdom Come', external: true }
 *        },
 *        'Get Connected': {
 *          default: 'southwest',
 *          congregations: ['southwest','alliance','espanol']
 *        }
 *      }
 *    }
 *
 *  Internal shape (SitemapReviewNavPresentation):
 *
 *    {
 *      shell: 'megamenu',
 *      visible_top_level: [{ kind, label, group_label }],
 *      header_ctas: [{ label, style }],
 *      megamenu_panels: [{ triggered_by, columns: [...], featured_tile }]
 *    }
 *
 *  Per-congregation megamenus (Doxology's "Get Connected") produce
 *  megamenu_panels whose column headings match congregation labels.
 *  PrimaryNavPreview's `congRows` detection then renders each column
 *  as a per-congregation card with service time + address. This
 *  requires the review's `presentation.congregations` to be
 *  populated — passed in as `congregations`.
 */
function normalizeCoworkNavPresentation(
  raw: unknown,
  congregations?: NonNullable<SitemapReview['presentation']>['congregations'],
): SitemapReviewNavPresentation | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const np = raw as Record<string, unknown>
  const hasCoworkHeader    = np.header && typeof np.header === 'object' && Array.isArray((np.header as Record<string, unknown>).items)
  const hasCoworkMegamenus = np.megamenus && typeof np.megamenus === 'object'
  const hasInternalKeys    = Array.isArray(np.visible_top_level) || Array.isArray(np.megamenu_panels)
  // Not cowork shape → pass through (may still be internal shape or
  // a shell-only stub that hydrate will fill in downstream).
  if (!hasCoworkHeader && !hasCoworkMegamenus) return raw as SitemapReviewNavPresentation
  // If both shapes coexist (e.g. from a bad merge), prefer internal
  // keys that were already normalized.
  if (hasInternalKeys) return raw as SitemapReviewNavPresentation

  const header    = (np.header    ?? {}) as Record<string, unknown>
  const megamenus = (np.megamenus ?? {}) as Record<string, unknown>
  const headerItems   = Array.isArray(header.items)   ? header.items   as Array<Record<string, unknown>> : []
  const headerButtons = Array.isArray(header.buttons) ? header.buttons as Array<unknown>                 : []

  // Visible top-level: map cowork item types to internal kinds.
  //   type='megamenu' → kind='group' (has caret + panel)
  //   type='link'     → kind='page'  (leaf link)
  //   anything else falls back to 'page' so the label still shows.
  const visible_top_level: NonNullable<SitemapReviewNavPresentation['visible_top_level']> = headerItems.map(it => {
    const label = typeof it.label === 'string' ? it.label : ''
    const type  = typeof it.type  === 'string' ? it.type  : 'link'
    const slug  = typeof it.slug  === 'string' ? it.slug  : undefined
    if (type === 'megamenu' || type === 'group') {
      return { kind: 'group', label, group_label: label, ...(slug ? { slug } : {}) }
    }
    return { kind: 'page', label, ...(slug ? { slug } : {}) }
  }).filter(it => (it.label ?? '').trim().length > 0)

  // Header CTAs: cowork emits a plain string array (`["Visit","Watch"]`).
  // Convention: first entry is primary (deep-plum fill), the rest
  // are secondary (outlined). Give the strategist a style-explicit
  // block so the renderer can honor it without inference.
  const header_ctas: NonNullable<SitemapReviewNavPresentation['header_ctas']> = headerButtons
    .map((b, i) => {
      if (typeof b === 'string') return { label: b, style: i === 0 ? 'pill_primary' as const : 'pill_secondary' as const }
      if (b && typeof b === 'object') {
        const obj = b as { label?: unknown; slug?: unknown; url?: unknown; style?: unknown }
        return {
          label: typeof obj.label === 'string' ? obj.label : '',
          slug:  typeof obj.slug  === 'string' ? obj.slug  : undefined,
          url:   typeof obj.url   === 'string' ? obj.url   : undefined,
          style: (obj.style === 'pill_primary' || obj.style === 'pill_secondary')
            ? obj.style
            : (i === 0 ? 'pill_primary' as const : 'pill_secondary' as const),
        }
      }
      return { label: '', style: 'pill_secondary' as const }
    })
    .filter(b => (b.label ?? '').trim().length > 0)

  // Megamenu panels. Cowork's `megamenus` is keyed by the parent
  // label; each entry either has `columns[][slugs]` or a
  // `congregations[]` list. Translate both:
  //
  //   { columns: [['about','beliefs',...]], feature: {label, external} }
  //   → { triggered_by, columns: [{ heading, links: [{label, slug}] }], featured_tile }
  //
  //   { congregations: ['southwest','alliance','espanol'] }
  //   → columns whose heading matches each congregation's label
  //     (PrimaryNavPreview.congRows detection then picks it up).
  const congLabelById = new Map<string, string>(
    (congregations ?? []).map(c => [c.id, c.label]),
  )
  const megamenu_panels: NonNullable<SitemapReviewNavPresentation['megamenu_panels']> = []
  for (const [label, panelRaw] of Object.entries(megamenus)) {
    if (!panelRaw || typeof panelRaw !== 'object') continue
    const panel = panelRaw as Record<string, unknown>

    if (Array.isArray(panel.congregations)) {
      // Per-congregation megamenu: emit one column per congregation
      // slug. Heading = congregation label from review.presentation.
      // Links stay empty here; the render pulls the per-cong details
      // from presentation.congregations directly.
      const cols = (panel.congregations as unknown[])
        .filter((cid): cid is string => typeof cid === 'string')
        .map(cid => ({ heading: congLabelById.get(cid) ?? cid, links: [] }))
      if (cols.length > 0) megamenu_panels.push({ triggered_by: label, columns: cols })
      continue
    }

    const columns: NonNullable<NonNullable<SitemapReviewNavPresentation['megamenu_panels']>[number]['columns']> = []
    if (Array.isArray(panel.columns)) {
      for (const col of panel.columns as unknown[]) {
        if (!Array.isArray(col)) continue
        const links = (col as unknown[])
          .map(entry => {
            if (typeof entry === 'string') return { label: formatSlugAsTitle(entry), slug: entry }
            if (entry && typeof entry === 'object') {
              const e = entry as { label?: unknown; slug?: unknown; one_line_description?: unknown }
              return {
                label:                 typeof e.label === 'string' ? e.label : (typeof e.slug === 'string' ? formatSlugAsTitle(e.slug) : ''),
                slug:                  typeof e.slug  === 'string' ? e.slug  : undefined,
                one_line_description:  typeof e.one_line_description === 'string' ? e.one_line_description : undefined,
              }
            }
            return null
          })
          .filter((l): l is { label: string; slug?: string; one_line_description?: string } => !!l && (l.label ?? '').trim().length > 0)
        if (links.length > 0) columns.push({ heading: label, links })
      }
    }
    const featured = (panel.feature ?? panel.featured_tile ?? null) as Record<string, unknown> | null
    const featuredHeading = (() => {
      if (typeof featured?.label   === 'string' && featured.label.trim())   return featured.label
      if (typeof featured?.heading === 'string' && featured.heading.trim()) return featured.heading
      return undefined
    })()
    const featuredTile = featured && typeof featured === 'object'
      ? {
          kind:       'image_cta' as const,
          heading:    featuredHeading,
          body:       typeof featured.body === 'string' ? featured.body : undefined,
          link_label: typeof featured.link_label === 'string'
            ? featured.link_label
            : (featured.external ? 'Learn more' : undefined),
          link_slug:  typeof featured.link_slug === 'string' ? featured.link_slug : undefined,
        }
      : undefined
    megamenu_panels.push({
      triggered_by: label,
      ...(columns.length > 0 ? { columns } : {}),
      ...(featuredTile        ? { featured_tile: featuredTile } : {}),
    })
  }

  return {
    shell: 'megamenu',
    visible_top_level,
    header_ctas,
    ...(megamenu_panels.length > 0 ? { megamenu_panels } : {}),
  }
}

/** Compose the executive-summary paragraph from strategic_goals when
 *  available. Prefers the partner's own approved vision language;
 *  falls back to a warm generic when strategic_goals hasn't run yet.
 *  Never uses em-dashes in generated copy (partner-facing tone). */
function buildExecutiveSummary(args: {
  project: ComposeSourceProject
  rs:      Record<string, unknown>
  church:  string | null | undefined
}): string {
  const { rs, church } = args
  const sg = (rs.strategic_goals ?? {}) as Record<string, unknown>
  const gv = (sg.goals_and_vision ?? {}) as Record<string, { value?: string }>
  const s1 = (rs.stage_1 ?? {}) as { x_factor?: string; mission?: string }
  const churchVision = gv.church_vision?.value?.trim() || null
  const xFactor = s1.x_factor?.trim() || null
  const churchName = church ?? 'Your church'

  if (churchVision && xFactor) {
    return `${churchVision}\n\nThe website is built to carry that all the way through. ${churchName}'s heartbeat, "${xFactor}", shows up in the structure, the language, and the way each page invites people forward.`
  }
  if (churchVision) {
    return `${churchVision}\n\nEvery page below is designed to carry that intent all the way through so someone finding you online experiences the same welcome and clarity your team offers in person.`
  }
  return `This website is designed to be a warm, honest, easy-to-navigate front door for ${churchName}. Every page below has been shaped around the people you're inviting into your community and the next steps you want to make easy for them.`
}

/** Compose the navigation "heart and why" paragraph from the cowork
 *  sitemap step's handoff_note when available. The handoff_note
 *  already argues for the nav choices in strategist voice; we extract
 *  the top-line reasoning. */
function buildNavigationStrategy(args: {
  strategy: SiteStrategyBlob | null
  church:   string | null | undefined
}): string {
  const { strategy, church } = args
  const churchName = church ?? 'Your church'
  // The handoff_note isn't part of the typed SiteStrategyBlob (it's
  // deep in _meta) so we don't try to parse it here. Return a
  // strategist-facing default the reviewer can rewrite with the
  // specific navigation rationale.
  void strategy
  const primaryCount = strategy?.nav?.primary?.length ?? 0
  return `The navigation is built to serve two people at once. A first-time visitor who lands on ${churchName}'s site needs to make one clear decision fast, and a returning member needs to reach what they came for without hunting for it. The top-level nav answers "should I visit?" first, then "how do I grow here?" second, and puts everything else one click away without cluttering the header.${primaryCount > 0 ? ` We landed on ${primaryCount} primary items after weighing what belongs where; the reasoning behind each is spelled out in the pages list below.` : ''}`
}

/** Synthesize a stable persona id from a name. Used when the source
 *  data (roadmap_state.stage_1.personas) has no id field. The id is
 *  stable across recomposes because it's a lowercase slug of the name;
 *  same input always yields the same id. */
/** Auto-derive a page's sitemap_tag from migration lookups and copy
 *  signals. Runs at compose time so every partner's page list carries
 *  tags whether or not the strategist has authored them. Order of
 *  precedence:
 *   1. Migration where this page is `merged_to_slug` or its name
 *      matches `merged_to` (case-insensitive)  ->  'consolidated'.
 *   2. `what_changed` copy mentions "share" / "unified" / "one page"
 *      /  "shared"                              ->  'unified'.
 *   3. `what_changed` copy mentions "brand new" / "new to the site"
 *      / "did not exist"                        ->  'new'.
 *   4. Default (page existed before, unchanged) ->  'kept'. */
/** Seed the "Why we shaped it this way" cards from real project
 *  strategy so every partner opens the review with reasoning keyed
 *  to their own approved vision, not generic boilerplate. Reads
 *  strategic_goals.church_vision, stage_1.x_factor, plus counts
 *  the compose already has (personas, migrations, pages). Returns
 *  null when there is not enough signal to say anything meaningful,
 *  in which case the renderer falls back to the static 4 cards. */
function buildWhyCardsFromStrategy(args: {
  rs:              Record<string, unknown>
  church:          string | null | undefined
  pages:           ReviewPage[]
  migrationCount:  number
  personaCount:    number
}): NonNullable<SitemapReviewPresentation['why_cards']> | null {
  const { rs, church, pages, migrationCount, personaCount } = args
  const sg = (rs.strategic_goals ?? {}) as Record<string, unknown>
  const gv = (sg.goals_and_vision ?? {}) as Record<string, { value?: string }>
  const churchVision = gv.church_vision?.value?.trim()  ?? null
  const topGoal      = gv.primary_goals?.value?.trim().split('\n')[0]?.trim() ?? null
  const s1           = (rs.stage_1 ?? {}) as { x_factor?: string; mission?: string }
  const xFactor      = s1.x_factor?.trim() ?? null
  const churchName   = church ?? 'this church'

  // If we have no strategy signals at all, let the renderer show
  // its static defaults instead of pretending we have signal.
  if (!churchVision && !xFactor && !topGoal && personaCount === 0 && migrationCount === 0) {
    return null
  }

  const cards: NonNullable<SitemapReviewPresentation['why_cards']> = []

  if (xFactor) {
    cards.push({
      id:    'x-factor',
      icon:  '◆',
      title: 'Built on what makes you distinct',
      body:  `The whole site keeps ${churchName}'s heartbeat in view: ${xFactor}. Every page is shaped to carry that intent all the way through.`,
    })
  }

  if (personaCount > 0) {
    cards.push({
      id:    'people',
      icon:  '◇',
      title: personaCount === 1 ? 'Written for the person you named' : `Written for the ${personaCount} people you named`,
      body:  `Every page is built around a real person from Discovery, not an org chart. First-time visitors and long-time members each have a clear next step from wherever they land.`,
    })
  }

  if (migrationCount > 0) {
    cards.push({
      id:    'consolidation',
      icon:  '✦',
      title: 'Tidied without losing anything',
      body:  `${migrationCount} pages from your current site fold into clearer homes. Nothing familiar goes missing; the structure just gets easier to move through.`,
    })
  }

  if (churchVision) {
    cards.push({
      id:    'vision',
      icon:  '↗',
      title: 'Aligned with the vision you approved',
      body:  `The whole site is shaped to reflect your own words for what ${churchName} is becoming, not a template borrowed from another church.`,
    })
  } else if (topGoal) {
    cards.push({
      id:    'goal',
      icon:  '↗',
      title: 'Aligned with the goal you named',
      body:  `The structure keeps your top goal from Discovery front and center: ${topGoal.replace(/[.]+$/, '')}.`,
    })
  } else if (pages.length > 0) {
    cards.push({
      id:    'grow',
      icon:  '↗',
      title: 'Built to grow with you',
      body:  `As ${churchName} adds ministries and pages, new content slots into the same structure, no redesign needed.`,
    })
  }

  // Return exactly what we could seed; the renderer shows whatever
  // is here. Empty array (no signals) falls to the static default.
  return cards.length > 0 ? cards : null
}

function deriveSitemapTag(
  _page:       ReviewPage,
  _migrations: ContentMigration[],
): ReviewPage['sitemap_tag'] {
  // Auto-derivation retired. The tag taxonomy switched from migration
  // status (kept/unified/consolidated/new) to page role (hub/ministry/
  // churchwide/foundation). Roles can't be inferred from migration
  // signals alone — a merged page could be a hub, or a ministry, or
  // church-wide info. Strategist assigns the role explicitly in the
  // editor. Returning undefined leaves the pill off until then.
  return undefined
}

function synthesizePersonaId(name: string): string {
  return 'p_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

/** "Show your work" seed for a page's what_changed / why_change /
 *  strategic_alignment fields. Reads the strategist's structural
 *  signals (audience, funnel, nav_strategy, whether the page shows
 *  up in a persona journey, whether it inherited content from
 *  pages_considered_dropped, whether strategic_goals has an approved
 *  church vision) and composes plain-English reasoning the partner
 *  can read as a partnership-focused explanation.
 *
 *  Only seeds when the strategist hasn't filled the field. Existing
 *  values always win. Fields where we can't produce meaningful
 *  content stay empty (rendered as hidden on the partner side per
 *  the empty-section rule). */
function seedShowYourWorkForPage(args: {
  page:       ReviewPage
  strategy:   SiteStrategyBlob | null
  rs:         Record<string, unknown>
  churchName: string | null | undefined
  postures:   PersonaPosture[]
  migrations: ContentMigration[]
}): {
  what_changed?:        string
  why_change?:          string
  strategic_alignment?: string
} {
  const { page, strategy, rs, churchName, postures, migrations } = args
  const audience = (page.primary_audience ?? '').trim()
  const funnel   = (page.funnel_stage    ?? '').trim().toLowerCase()
  const navStrat = (page.nav_strategy    ?? '').trim().toLowerCase()

  const out: { what_changed?: string; why_change?: string; strategic_alignment?: string } = {}

  // WHAT CHANGED
  // Only seeded when we can point to a concrete change: a migration
  // pointing at this page as the merge destination, or the page is
  // in the primary nav but the underlying strategy tagged it new.
  const inboundMigration = migrations.find(m =>
    (m.merged_to_slug && m.merged_to_slug === page.slug) ||
    (m.merged_to && m.merged_to.toLowerCase() === page.name.toLowerCase()),
  )
  if (inboundMigration) {
    const sources = inboundMigration.merged_from.filter(Boolean).join(' and ')
    if (sources) {
      out.what_changed = `This page pulls together content that used to live across ${sources}. Bringing it into one home simplifies the path for the person you're trying to reach and gives your team one place to keep it fresh.`
    }
  }

  // WHY CHANGE
  // Composed from audience + funnel + nav_strategy. Explains the
  // page's purpose in partner language, referencing the specific
  // person the page is built for and where they are in their journey.
  const audienceLine = audienceToPhrase(audience, postures)
  const funnelLine   = funnelToPhrase(funnel)
  const navLine      = navStrategyToPhrase(navStrat)

  if (audienceLine || funnelLine || navLine) {
    const parts: string[] = []
    if (audienceLine && funnelLine) {
      parts.push(`This page is built for ${audienceLine} as they ${funnelLine}.`)
    } else if (audienceLine) {
      parts.push(`This page is built for ${audienceLine}.`)
    } else if (funnelLine) {
      parts.push(`This page meets people as they ${funnelLine}.`)
    }
    if (navLine) parts.push(navLine)
    // Anchor to the page's purpose when the strategist authored one.
    if (page.purpose && page.purpose.trim() && parts.length > 0) {
      parts.push(`It carries that intent all the way through the content on the page itself.`)
    }
    out.why_change = parts.join(' ')
  }

  // STRATEGIC ALIGNMENT
  // Anchored in the partner's own approved vision language from
  // strategic_goals.goals_and_vision. Only seeded when the vision
  // field is present.
  const sg = (rs.strategic_goals ?? {}) as Record<string, unknown>
  const gv = (sg.goals_and_vision ?? {}) as Record<string, { value?: string }>
  const vision = gv.church_vision?.value?.trim() || null
  const goals  = gv.primary_goals?.value?.trim()  || null
  if (vision || goals) {
    const church = churchName ?? 'the church'
    const alignmentBits: string[] = []
    if (vision) {
      alignmentBits.push(`It reflects ${church}'s stated vision for the site: to feel warm, honest, and easy for real people in real life.`)
    }
    if (goals) {
      const firstGoal = goals.split('\n').map(g => g.trim()).filter(Boolean)[0]
      if (firstGoal) alignmentBits.push(`It supports the top goal you named in Discovery: ${firstGoal.replace(/[.]+$/, '').toLowerCase()}.`)
    }
    if (alignmentBits.length > 0) out.strategic_alignment = alignmentBits.join(' ')
  }

  // Persona key-pages mention: if any persona names this slug as a
  // top-3 key page, tag on a "load-bearing for X" note as a coda to
  // why_change so partners see which personas depend on this page.
  const touchesPersonas = postures.filter(p =>
    (p.key_page_slugs ?? []).includes(page.slug),
  )
  if (touchesPersonas.length > 0 && out.why_change) {
    const names = touchesPersonas.map(p => p.persona_name).join(', ')
    out.why_change += ` ${touchesPersonas.length === 1 ? 'This is a load-bearing page for' : 'This is a load-bearing page for'} ${names}.`
  }

  // Peripheral use of `strategy` for future extension (persona
  // entry points, cta_only surface).
  void strategy

  return out
}

function audienceToPhrase(audience: string, postures: PersonaPosture[]): string | null {
  if (!audience) return null
  const lower = audience.toLowerCase()
  if (lower === 'general' || lower === 'anyone' || lower === 'all') {
    return 'anyone landing on your site fresh, from first-time visitors to current members'
  }
  // If the audience string matches a persona name, use it verbatim
  // (feels like a real person to the partner).
  const persona = postures.find(p => p.persona_name.toLowerCase() === lower)
  if (persona) return persona.persona_name
  return audience
}

function funnelToPhrase(funnel: string): string | null {
  if (!funnel) return null
  const map: Record<string, string> = {
    discover:      'arrive at your site fresh and start forming a first impression',
    consider:      'weigh whether to take a next step with you',
    visit:         'prepare to walk in the door for the first time',
    commit:        'take a real next step toward belonging',
    connect:       'move from Sunday attender to connected in community',
    grow:          'grow deeper in faith and life together',
    plan:          'plan their first visit with confidence',
    engage:        'engage with what you are already doing on Sundays',
  }
  return map[funnel] ?? null
}

function navStrategyToPhrase(navStrat: string): string | null {
  if (!navStrat) return null
  const map: Record<string, string> = {
    primary:         'It lives in the primary nav so anyone visiting the site can reach it in one tap.',
    secondary:       "It sits in the secondary menu, one tap from anywhere on the site, so it stays easy to find without competing with the primary nav's guest CTAs.",
    footer:          'It lives in the footer, honored and discoverable for those looking for it, without occupying prime real estate a first-time visitor is scanning.',
    contextual_only: "It's surfaced contextually rather than in the header, so it appears where it's most useful and stays out of the way otherwise.",
  }
  return map[navStrat] ?? null
}

/** site_strategy nav → NavLayout translation. Handles the polymorphic
 *  primary/secondary/footer entries (strings-of-slugs OR objects).
 *  Returns null when strategy has no nav data so the caller can fall
 *  back to nav_group_definitions.
 *
 *  Secondary fallback: when the strategy blob DOESN'T carry an
 *  explicit `nav.secondary` list but SOME pages have
 *  `nav_strategy: 'secondary'`, we synthesize a secondary list from
 *  those pages. This lets older projects that only got page-level
 *  secondary tags still render a secondary region in the review. */
function buildNavLayoutFromStrategy(
  strategy: SiteStrategyBlob | null,
  pages: ReviewPage[],
): NavLayout | null {
  const nav = strategy?.nav
  const secondaryPagesFallback = pages.filter(p => p.nav_strategy === 'secondary')
  // nav.footer can be either the legacy flat array OR the current
  // grouped-object shape; either one counts as "has footer data" for
  // deciding whether to build a nav_layout at all.
  const hasFooterData = nav?.footer != null && (
    Array.isArray(nav.footer) ? nav.footer.length > 0 : isGroupedFooter(nav.footer)
  )
  if (!nav || (!nav.primary && !hasFooterData && !nav.secondary && secondaryPagesFallback.length === 0)) return null

  const nameBySlug = new Map<string, string>()
  for (const p of pages) nameBySlug.set(p.slug, p.name)

  // Shared helper: normalize a polymorphic entry (string slug or object)
  // into a NavItem with a label resolved from the pages list. Used for
  // primary + secondary + footer since they share the same shape.
  const toNavItem = (item: unknown, withChildren: boolean): NavItem => {
    if (typeof item === 'string') {
      return { label: nameBySlug.get(item) ?? formatSlugAsTitle(item), slug: item }
    }
    if (!item || typeof item !== 'object') return { label: '' }
    const it = item as { slug?: string; label?: string; children?: unknown[] }
    const slug = it.slug
    const label = it.label ?? (slug ? (nameBySlug.get(slug) ?? formatSlugAsTitle(slug)) : '')
    if (!withChildren) return { label, ...(slug ? { slug } : {}) }
    const children = (Array.isArray(it.children) ? it.children : [])
      .map(c => toNavItem(c, false))
      .filter(c => c.label)
    return { label, ...(slug ? { slug } : {}), ...(children.length > 0 ? { children } : {}) }
  }

  const asArr = <T,>(v: unknown): T[] => Array.isArray(v) ? (v as T[]) : []
  const primaryItems: NavItem[] = asArr(nav.primary).map(item => toNavItem(item, true)).filter(it => it.label)
  const secondaryFromStrategy: NavItem[] = asArr(nav.secondary).map(item => toNavItem(item, true)).filter(it => it.label)
  const secondaryFromFallback: NavItem[] = secondaryPagesFallback
    .sort((a, b) => a.order - b.order)
    .map(p => ({ label: p.name, slug: p.slug }))
  const secondaryItems = secondaryFromStrategy.length > 0
    ? secondaryFromStrategy
    : secondaryFromFallback

  // Footer: extract via the shared helper so grouped-object and
  // legacy-flat shapes both flow through. `flat` is the union of every
  // link across all grouped columns (primary_links + explore + legal
  // for the grouped shape; the array itself for legacy). Deduped on
  // slug via a Set so a slug appearing in two groups only gets tagged
  // once in nav_layout.
  const footerExtract = extractCoworkFooterGroups(nav.footer, nameBySlug)
  const footerSeen = new Set<string>()
  const footerItems: NavItem[] = footerExtract.flat.map(item => toNavItem(item, false)).filter(it => {
    if (!it.label) return false
    const key = it.slug ?? it.label
    if (footerSeen.has(key)) return false
    footerSeen.add(key)
    return true
  })
  const ctaOnlyItems: NavItem[] = asArr(nav.cta_only).map(item => toNavItem(item, false)).filter(it => it.label)

  return {
    header:           primaryItems,
    ...(secondaryItems.length > 0 ? { secondary: secondaryItems } : {}),
    ...(nav.secondary_label ? { secondary_label: nav.secondary_label } : {}),
    ...(ctaOnlyItems.length > 0 ? { cta_only: ctaOnlyItems } : {}),
    footer_sections:  footerItems.length > 0
      ? [{ label: 'Footer', items: footerItems }]
      : [],
  }
}

/** Map slug → human-readable nav position string ("Header · primary",
 *  "Secondary menu", "Footer", "Sub-nav of /about"). Used to prefill
 *  ReviewPage.nav_position without duplicating the nav_layout tree.
 *  Secondary label falls back to the strategy's `secondary_label` when
 *  set (e.g. "Off-canvas menu"), else the neutral "Secondary menu". */
function buildNavPositionMap(nav: SiteStrategyBlob['nav'] | undefined): Map<string, string> {
  const map = new Map<string, string>()
  if (!nav) return map
  // site_strategy.nav can arrive with non-array values for a given
  // region (Doxology's older sitemap step wrote nav.footer as an
  // object with `items` inside). Guard every iteration so a shape
  // mismatch doesn't crash the entire compose.
  const asArr = <T,>(v: unknown): T[] => Array.isArray(v) ? (v as T[]) : []
  const secondaryLabel = nav.secondary_label ?? 'Secondary menu'
  for (const item of asArr<{ slug?: string; label?: string; children?: unknown[] } | string>(nav.primary)) {
    if (typeof item === 'string') { map.set(item, 'Header · primary'); continue }
    if (item.slug) map.set(item.slug, 'Header · primary')
    for (const c of asArr<{ slug?: string; label?: string } | string>(item.children)) {
      if (typeof c === 'string') map.set(c, `Header · under ${item.label ?? item.slug ?? '(parent)'}`)
      else if ((c as { slug?: string }).slug) map.set((c as { slug: string }).slug, `Header · under ${item.label ?? item.slug ?? '(parent)'}`)
    }
  }
  for (const item of asArr<{ slug?: string; label?: string; children?: unknown[] } | string>(nav.secondary)) {
    if (typeof item === 'string') { map.set(item, secondaryLabel); continue }
    if (item.slug) map.set(item.slug, secondaryLabel)
    for (const c of asArr<{ slug?: string; label?: string } | string>(item.children)) {
      if (typeof c === 'string') map.set(c, `${secondaryLabel} · under ${item.label ?? item.slug ?? '(parent)'}`)
      else if ((c as { slug?: string }).slug) map.set((c as { slug: string }).slug, `${secondaryLabel} · under ${item.label ?? item.slug ?? '(parent)'}`)
    }
  }
  // Footer: consume via the shared extractor so grouped + flat both
  // tag their slugs as 'Footer'. Empty name-map is fine here (we only
  // need slugs, not labels).
  const footerExtract = extractCoworkFooterGroups(nav.footer, new Map())
  for (const item of footerExtract.flat) {
    if (typeof item === 'string') { map.set(item, 'Footer'); continue }
    if (item.slug) map.set(item.slug, 'Footer')
  }
  for (const item of asArr<{ slug?: string } | string>(nav.cta_only)) {
    if (typeof item === 'string') { map.set(item, 'CTA button only'); continue }
    if (item.slug) map.set(item.slug, 'CTA button only')
  }
  return map
}

function formatSlugAsTitle(slug: string): string {
  return slug.split(/[-_/]/).filter(Boolean).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ')
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1)
}

// ── Status transitions ───────────────────────────────────────────────

/** Move the review to `published`, mints the token if missing and
 *  stamps published_at. Idempotent. */
export function publishReview(review: SitemapReview): SitemapReview {
  return {
    ...review,
    status:       'published',
    token:        review.token || cryptoRandomId(),
    published_at: review.published_at ?? new Date().toISOString(),
  }
}

/** Move the review to `approved`, stamps approved_at + approved_by.
 *  Once approved, downstream tools read from this review (see
 *  getApprovedSitemapReview). */
export function approveReview(review: SitemapReview, by: 'staff' | 'partner'): SitemapReview {
  return {
    ...review,
    status:      'approved',
    approved_at: new Date().toISOString(),
    approved_by: by,
  }
}

/** Downstream consumers should ONLY read a review that's been
 *  approved. Draft / published / partner_reviewed states are still in
 *  flux, tools reading from them would render provisional data as
 *  canonical. Returns null when nothing is approved yet, at which
 *  point downstream tools fall back to their pre-existing sources
 *  (web_pages, roadmap_state.stage_2, project.personas, etc.). */
export async function getApprovedSitemapReview(
  sb: SupabaseClient,
  projectId: string,
): Promise<SitemapReview | null> {
  const review = await loadSitemapReview(sb, projectId)
  if (!review) return null
  return review.status === 'approved' ? review : null
}

// ── Public token access (partner portal) ─────────────────────────────

/** Fetch a sitemap review by its public token. Uses the SECURITY
 *  DEFINER RPC so an unauthenticated partner session can read only
 *  the review (not the rest of the project row) via the token as the
 *  credential.
 *
 *  Returns `{ review, church_name, project_id }` on success. Returns
 *  null when the token doesn't match anything published. */
export async function loadSitemapReviewByToken(
  token: string,
  sb: SupabaseClient = defaultSupabase,
): Promise<{ review: SitemapReview; church_name: string | null; project_id: string; partner_portal_token: string | null } | null> {
  const { data, error } = await sb.rpc('get_sitemap_review_by_token', { p_token: token })
  if (error || !data) return null
  const row = data as {
    review:               SitemapReview | null
    church_name:          string | null
    project_id:           string
    project:              ComposeSourceProject | null
    pages:                ComposeSourceWebPage[] | null
    partner_portal_token: string | null
  }
  if (!row.review) return null

  // Live compose from strategy so partners always see the current
  // strategy pages / nav / migrations even when the persisted review
  // snapshot is stale (writer failed to bump the watermark, no
  // strategist opened the editor since strategy edits, etc). The
  // compose is in-memory only — no DB write happens on partner
  // reads. When the strategist next opens the editor, their compose
  // will auto-persist the same fresh state.
  //
  // composeSitemapReview handles drift detection + slug-keyed
  // carry-forward, so strategist-authored per-page fields (purpose
  // overrides, sitemap_tag, what_changed, why_change,
  // strategic_alignment) survive the resync when strategy has moved
  // on. Presentation / postures / footer_info / partner_edit_requests
  // are review-only and pass through unchanged.
  const composed = row.project
    ? composeSitemapReview({
        project:  row.project,
        pages:    row.pages ?? [],
        existing: row.review,
      })
    : row.review

  return {
    review: composed,
    church_name: row.church_name,
    project_id: row.project_id,
    partner_portal_token: row.partner_portal_token ?? null,
  }
}

/** Partner-side save. Sends the full next review through a
 *  token-gated RPC that verifies the token matches, records the
 *  edit history, and merges into roadmap_state.sitemap_review. */
export async function savePartnerSitemapReview(args: {
  token: string
  next:  SitemapReview
  sb?:   SupabaseClient
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = args.sb ?? defaultSupabase
  const { error } = await sb.rpc('save_sitemap_review_by_token', {
    p_token: args.token,
    p_next:  args.next as unknown as Record<string, unknown>,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// ── Edit-log helpers ─────────────────────────────────────────────────

/** Append one entry to a review's edit_history. Caller passes the
 *  actor + field path + old/new values; timestamp is set here. */
export function appendEditLog(review: SitemapReview, entry: Omit<EditLogEntry, 'at'>): SitemapReview {
  return {
    ...review,
    edit_history: [
      ...review.edit_history,
      { ...entry, at: new Date().toISOString() },
    ],
  }
}

// ── Utilities ────────────────────────────────────────────────────────

function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  // Fallback for the rare runtime without randomUUID, timestamp +
  // random suffix. Not cryptographically strong, but the review token
  // is scoped to a single project and rotatable.
  return `sr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}
