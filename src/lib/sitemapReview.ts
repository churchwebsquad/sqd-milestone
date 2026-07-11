/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Sitemap Review, the partner-facing snapshot of a project's page
 * structure, persona postures, navigation layout, and content-
 * consolidation rationale.
 *
 * Distinct from `roadmap_state.stage_2` (the strategist's proposal).
 * The review is the client-safe view: a curated summary the partner
 * reads and can edit, then approves as the official path forward
 * that downstream tools consume.
 *
 * As of the 2026-07 refactor, `roadmap_state.site_strategy` is the
 * SINGLE SOURCE OF TRUTH for the page list, nav, and per-page facts
 * (name, purpose, primary_audience, primary_funnel, nav_strategy,
 * parent_slug, nav_order). `sitemap_review` holds only:
 *
 *   - Review-owned per-page annotations (sitemap_tag, is_nav_parent_only,
 *     what_changed, why_change, strategic_alignment, persona_relevance)
 *     keyed by slug on `page_annotations`.
 *   - Explainer paragraphs (intro, executive_summary, navigation_strategy).
 *   - footer_info.
 *   - presentation (tiers, congregations, cards, hero em, inspiration_image).
 *   - nav_presentation (authored shell + dropdowns/megamenu + header CTAs).
 *   - persona_postures[].
 *   - content_migrations[].
 *   - Partner feedback (partner_notes, partner_edit_requests, partner_reviewed_at/by).
 *   - Status/lifecycle (token, status, published_at, approved_at, approved_by, edit_history).
 *
 * The review never duplicates pages / nav from site_strategy; it
 * annotates them. Renderers (staff preview + partner portal) merge
 * `site_strategy.pages` with `review.page_annotations` at read time.
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
 *  persona the site is meant to serve. */
export interface PersonaPosture {
  persona_id: string
  persona_name: string
  posture_summary: string
  goal?: string
  key_page_slugs: string[]
  primary_congregation_id?: string
  drop_off_risk?: {
    at_slug:    string
    reason:     string
    mitigation: string
  }
  /** @deprecated legacy carry-only fields. */
  user_journey?: JourneyStep[]
  /** @deprecated legacy carry-only fields. */
  journeys_by_congregation?: Record<string, JourneyStep[]>
  /** @deprecated legacy carry-only fields. */
  entry_points?: string[]
}

/** Per-page review annotation. Everything on this shape is review-
 *  owned and does not duplicate site_strategy. Keyed by slug on
 *  `SitemapReview.page_annotations`.
 *
 *  `sitemap_tag`, `is_nav_parent_only`, `what_changed`, `why_change`,
 *  `strategic_alignment`, and `persona_relevance` were previously
 *  fields on `ReviewPage`; they now live here and the rest of the
 *  page (name, purpose, audience, funnel, nav_strategy, parent_slug,
 *  nav_order) is read from site_strategy at render time. */
export interface ReviewPageAnnotation {
  /** Role tag rendered as a colored pill on the partner-facing Full
   *  Page List. See legacy docs on `ReviewPage.sitemap_tag`. */
  sitemap_tag?: 'hub' | 'ministry' | 'churchwide' | 'foundation'
             | 'kept' | 'unified' | 'consolidated' | 'new'
  /** True when this row is a nav dropdown label, NOT a real page.
   *  Hidden from partner Full Page List and skipped by downstream
   *  page creation. Strategist ticks the checkbox in the editor. */
  is_nav_parent_only?: boolean
  what_changed?:        string
  why_change?:          string
  strategic_alignment?: string
  /** Persona ids this page is primarily for. Cross-referenced against
   *  persona_postures[].persona_id. Rare — most partners rely on
   *  key_page_slugs on postures. */
  persona_relevance?: string[]
}

/** @deprecated Retained as a type so legacy rows can typecheck.
 *  The refactor stopped populating this on sitemap_review; the
 *  data migration strips it from existing rows. Kept for any
 *  ambient references still in the codebase. */
export interface ReviewPage {
  id: string
  web_page_id?: string
  slug: string
  name: string
  purpose: string
  nav_position?: string
  parent_slug?: string | null
  order: number
  persona_relevance?: string[]
  primary_audience?: string | null
  funnel_stage?: string | null
  nav_strategy?: string | null
  what_changed?:        string
  why_change?:          string
  strategic_alignment?: string
  sitemap_tag?: 'hub' | 'ministry' | 'churchwide' | 'foundation'
             | 'kept' | 'unified' | 'consolidated' | 'new'
  is_nav_parent_only?: boolean
}

export interface NavItem {
  label: string
  slug?: string   // internal, points at site_strategy page slug
  url?: string    // external
  children?: NavItem[]
}

export interface FooterSection {
  label: string
  items: NavItem[]
}

/** @deprecated Nav is now read from site_strategy.nav directly.
 *  Kept as a type only so legacy references still compile. */
export interface NavLayout {
  header: NavItem[]
  cta_only?: NavItem[]
  secondary?: NavItem[]
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
  at: string
  by: 'staff' | 'partner'
  field_path: string
  old_value: unknown
  new_value: unknown
  note?: string
}

/** Site-wide footer information the partner reviews for accuracy. */
export interface FooterInfo {
  church_name?:         string | null
  address?:             string | null
  phone?:               string | null
  email?:               string | null
  office_hours?:        string | null
  service_times?:       string | null
  newsletter_signup_url?: string | null
  social_links?: Array<{
    platform: 'facebook' | 'instagram' | 'youtube' | 'tiktok' | 'twitter' | 'linkedin' | 'other'
    url:      string
    label?:   string
  }>
  footer_page_links?: Array<{ label: string; url: string }>
  footer_link_groups?: Array<FooterLinkGroup>
}

/** One grouped column of footer links. */
export interface FooterLinkGroup {
  id: string
  heading: string
  links: Array<{ label: string; url?: string | null }>
}

/** Announcement strip above the primary nav. */
export interface AnnouncementBanner {
  text: string
  cta_url?: string | null
  cta_label?: string | null
  tone?: 'warning' | 'info' | 'neutral'
}

/** One partner-requested edit pinned to a specific section of the
 *  review. Section ids are kebab-case: `nav-primary`, `nav-secondary`,
 *  `hubs`, `footer`, `page-<slug>`, `what-changed`, `why`. */
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

/** Authored "presentation" layer. */
export interface SitemapReviewPresentation {
  hero_em_phrase?: string
  announcement_banner?: AnnouncementBanner
  congregations?: Array<{
    id:            string
    label:         string
    service_time?: string
    address?:      string
    is_primary?:   boolean
    links_left?:   Array<{ label: string; slug?: string; is_shared?: boolean; is_dropdown?: boolean; kids?: string }>
    links_right?:  Array<{ label: string; slug?: string; is_shared?: boolean; is_dropdown?: boolean; kids?: string }>
    visit_slug?:   string
    note?:         string
  }>
  featured_highlight?: {
    label:        string
    description:  string
    url?:         string
    cta_label?:   string
    secondary_cta_label?: string
  }
  tiers?: Array<{
    id:         string
    letter?:    string
    title:      string
    meta?:      string
    page_slugs?: string[]
    page_entries?: Array<{
      slug:        string
      is_child?:   boolean
      description_override?: string
    }>
  }>
  whats_changing_cards?: Array<{
    id:    string
    tag?:  'kept' | 'unified' | 'consolidated' | 'new'
    title: string
    body:  string
  }>
  why_cards?: Array<{
    id:    string
    icon?: string
    title: string
    body:  string
  }>
  your_turn_prompts?: string[]
  shared_hubs_headline?: string
  shared_hubs_body?:     string
  inspiration_image?: {
    url:      string
    alt?:     string
    caption?: string
  }
}

/** Snapshot of the cowork sitemap step's nav_presentation. */
export interface SitemapReviewNavPresentation {
  shell?:                  'standard_dropdowns' | 'megamenu' | 'offcanvas'
  presentation_rationale?: string
  header_ctas?: Array<{
    label?:        string
    slug?:         string
    url?:          string
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

/** Snapshot of a completed round, captured when the strategist
 *  clicks "Start next round" on a partner_reviewed review. Holds
 *  what the partner saw + what they submitted, so future rounds can
 *  reference prior feedback without losing it. Kept lean — we
 *  intentionally do not copy the full pages/nav (those live on
 *  site_strategy at the round's frozen shape via _meta.generated_at). */
export interface SitemapReviewRoundSnapshot {
  round_number:         number
  published_at:         string | null
  closed_at:            string          // when the strategist started the next round
  partner_reviewed_at:  string | null
  partner_reviewed_by:  string | null
  partner_notes?:       string
  partner_edit_requests: PartnerEditRequest[]
  round_change_summary?: string
  /** Cowork-generation stamp on site_strategy at the moment this
   *  round closed. Lets us show partners which strategy revision
   *  they were reviewing when they gave feedback. */
  site_strategy_generated_at?: string
}

export interface SitemapReview {
  /** 1 = legacy shape with pages[] + nav_layout duplicated from
   *  site_strategy. 2 = post-2026-07 refactor: pages/nav_layout
   *  removed, per-page facts read live from site_strategy at render
   *  time, and this blob only holds review-owned annotations +
   *  explainers + presentation + status. */
  schema_version: 1 | 2
  token: string
  status: SitemapReviewStatus
  created_at: string
  updated_at: string
  published_at: string | null
  approved_at:  string | null
  approved_by:  'staff' | 'partner' | null
  partner_reviewed_at?: string | null
  partner_reviewed_by?: string | null

  /** 1-indexed. New reviews start at 1. "Start next round" bumps
   *  the number and archives the prior state into round_history. */
  round_number: number
  /** Prior rounds, oldest first. Empty (or absent) on a first
   *  round. Preserves partner feedback so nothing gets lost when
   *  the strategist reopens for revision. */
  round_history?: SitemapReviewRoundSnapshot[]
  /** Strategist-authored note the partner reads at the top of a
   *  Round 2+ review — "here's what we changed since last time." */
  round_change_summary?: string

  /** @deprecated Legacy watermark from the pages-duplication era.
   *  Retained on the type so pre-migration rows still typecheck; the
   *  data migration strips it from existing rows and compose no
   *  longer writes it. */
  last_synced_from_strategy_at?: string

  nav_presentation?: SitemapReviewNavPresentation
  presentation?: SitemapReviewPresentation

  intro?: {
    headline: string
    body:     string
  }

  executive_summary?: string
  navigation_strategy?: string

  footer_info?: FooterInfo

  /** Per-page review annotations, keyed by slug. Page-level facts
   *  (name, purpose, primary_audience, primary_funnel, nav_strategy,
   *  parent_slug) are NOT stored here — the renderer reads those from
   *  site_strategy.pages and merges these annotations on top. */
  page_annotations?: Record<string, ReviewPageAnnotation>

  /** @deprecated Replaced by `page_annotations` and site_strategy.
   *  Present on pre-schema_version-2 rows; the data migration
   *  extracts the annotations into `page_annotations` and drops
   *  this field. */
  pages?: ReviewPage[]

  persona_postures:  PersonaPosture[]

  /** @deprecated Nav lives on site_strategy.nav. Present on pre-
   *  schema_version-2 rows; the data migration drops this field. */
  nav_layout?: NavLayout

  content_migrations: ContentMigration[]

  partner_notes?: string
  partner_edit_requests?: PartnerEditRequest[]
  edit_history: EditLogEntry[]
}

// ── site_strategy shape ──────────────────────────────────────────────
//
// Shape of `roadmap_state.site_strategy`, the cowork "plan-site-strategy"
// step output. Loosely typed because we defensively index; only the
// fields we consume are documented here. Promoted from a private
// interface to an exported type so components (partner view, feedback
// page, portal) can accept it as a prop.

export interface SiteStrategyBlob {
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
    secondary?: Array<{ slug?: string; label?: string; children?: Array<{ slug?: string; label?: string }> } | string>
    secondary_label?: string
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
  _meta?: {
    generated_at?: string
    skill_name?:   string
    skill_version?: string
    revision_of?:  string
    [k: string]:   unknown
  }
  [k: string]: unknown
}

/** The grouped shape cowork's plan-site-strategy step writes for
 *  the footer region as of 2026-07. */
interface CoworkGroupedFooter {
  primary_links?: Array<string | { slug?: string; label?: string }>
  explore?:       Array<string | { slug?: string; label?: string }>
  legal?:         Array<string | { slug?: string; label?: string }>
  /** Optional per-column heading overrides. When absent the extractor
   *  falls back to the built-in defaults ("Take a next step" /
   *  "Explore" / "Fine print"). Woodcreek Round 3 wants "Next Steps"
   *  / "Explore" / "About" — authored per-partner via this map so
   *  the default naming can differ from the visible heading. */
  column_headings?: {
    primary_links?: string
    explore?:       string
    legal?:         string
  }
  social?:        string[]
  parked?:        Array<{ label?: string; reason?: string }>
  contact_block?: boolean
  service_times?: boolean
}

function isGroupedFooter(v: unknown): v is CoworkGroupedFooter {
  return !!v && typeof v === 'object' && !Array.isArray(v)
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

/** Read `roadmap_state.site_strategy` for a project. Returns null
 *  when the cowork sitemap step hasn't run yet. Staff context. */
export async function loadSiteStrategy(
  sb: SupabaseClient,
  projectId: string,
): Promise<SiteStrategyBlob | null> {
  const { data } = await sb
    .from('strategy_web_projects')
    .select('roadmap_state')
    .eq('id', projectId)
    .maybeSingle()
  const rs = (data as { roadmap_state?: Record<string, unknown> } | null)?.roadmap_state ?? {}
  const raw = (rs as { site_strategy?: unknown }).site_strategy
  if (!raw || typeof raw !== 'object') return null
  return raw as SiteStrategyBlob
}

/** Write the sitemap review back. Read-merge-write so other roadmap_state
 *  keys are preserved. `updated_at` is stamped automatically.
 *
 *  Post-refactor: this ONLY writes `sitemap_review`. It does not sync
 *  anything back into `site_strategy` — site_strategy is edited via
 *  cowork or the strategist JSON edit affordance, not derived from
 *  the review. */
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
  const merged = { ...rs, sitemap_review: stamped }
  const { error: writeErr } = await sb
    .from('strategy_web_projects')
    .update({ roadmap_state: merged } as never)
    .eq('id', projectId)
  if (writeErr) return { ok: false, error: writeErr.message }
  return { ok: true, review: stamped }
}

/** Write a fresh `site_strategy` blob into roadmap_state. Used by
 *  the strategist "Edit site_strategy JSON" affordance in the review
 *  editor to iterate on the sitemap when a cowork run isn't
 *  practical. Validates that `parsed.pages` and `parsed.nav` are
 *  present (rejects unstructured writes) and bumps `_meta` so
 *  downstream tools see a fresh revision. */
export async function saveSiteStrategy(
  sb: SupabaseClient,
  projectId: string,
  parsed: SiteStrategyBlob,
): Promise<{ ok: true; strategy: SiteStrategyBlob } | { ok: false; error: string }> {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'site_strategy must be a JSON object' }
  }
  if (!Array.isArray(parsed.pages)) {
    return { ok: false, error: 'site_strategy must have a `pages` array' }
  }
  if (!parsed.nav || typeof parsed.nav !== 'object' || Array.isArray(parsed.nav)) {
    return { ok: false, error: 'site_strategy must have a `nav` object' }
  }
  const { data: row, error: readErr } = await sb
    .from('strategy_web_projects')
    .select('roadmap_state')
    .eq('id', projectId)
    .maybeSingle()
  if (readErr) return { ok: false, error: readErr.message }
  const rs = ((row as { roadmap_state?: Record<string, unknown> } | null)?.roadmap_state) ?? {}
  const priorStrategy = (rs as { site_strategy?: SiteStrategyBlob }).site_strategy
  const priorGeneratedAt = priorStrategy?._meta?.generated_at
  const nextMeta = {
    ...(parsed._meta ?? {}),
    skill_name:    'strategist-json-edit',
    skill_version: (parsed._meta?.skill_version as string | undefined) ?? '1.0.0',
    generated_at:  new Date().toISOString(),
    ...(priorGeneratedAt ? { revision_of: priorGeneratedAt } : {}),
  }
  const nextStrategy: SiteStrategyBlob = { ...parsed, _meta: nextMeta }
  const merged = { ...rs, site_strategy: nextStrategy }
  const { error: writeErr } = await sb
    .from('strategy_web_projects')
    .update({ roadmap_state: merged } as never)
    .eq('id', projectId)
  if (writeErr) return { ok: false, error: writeErr.message }
  return { ok: true, strategy: nextStrategy }
}

// ── Site-strategy footer helpers (shared by compose + render) ───────

/** Extract footer link groups from cowork's `nav.footer` in whichever
 *  shape it arrived. Used by compose to seed footer_link_groups and
 *  by nav-position labeling. Exported so the partner render can read
 *  from site_strategy.nav.footer at render time. */
export function extractCoworkFooterGroups(
  footer: Array<{ slug?: string; label?: string } | string> | CoworkGroupedFooter | null | undefined,
  nameBySlug: Map<string, string>,
): {
  groups: FooterLinkGroup[]
  flat: Array<{ slug?: string; label?: string } | string>
} {
  const flat: Array<{ slug?: string; label?: string } | string> = []
  const groups: FooterLinkGroup[] = []
  if (!footer) return { groups, flat }

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

  if (Array.isArray(footer)) {
    const links = footer.map(resolveEntry).filter((l): l is { label: string; url?: string | null } => !!l)
    if (links.length > 0) {
      groups.push({ id: 'grp-explore', heading: 'Explore', links })
    }
    for (const raw of footer) flat.push(raw)
    return { groups, flat }
  }

  if (isGroupedFooter(footer)) {
    // Per-column heading overrides (footer.column_headings.<key>) let
    // partners rename the visible heading without changing the
    // canonical CoworkGroupedFooter key. Woodcreek Round 3: partner
    // requested "Next Steps" / "Explore" / "About" instead of the
    // default "Take a next step" / "Explore" / "Fine print".
    const overrides = footer.column_headings ?? {}
    const columnOrder: Array<{ key: keyof CoworkGroupedFooter & string; heading: string; groupId: string }> = [
      { key: 'primary_links', heading: overrides.primary_links?.trim() || 'Take a next step', groupId: 'grp-primary' },
      { key: 'explore',       heading: overrides.explore?.trim()       || 'Explore',           groupId: 'grp-explore' },
      { key: 'legal',         heading: overrides.legal?.trim()         || 'Fine print',        groupId: 'grp-legal'   },
    ]
    for (const col of columnOrder) {
      const rawList = footer[col.key]
      if (!Array.isArray(rawList)) continue
      const links = rawList.map(resolveEntry).filter((l): l is { label: string; url?: string | null } => !!l)
      if (links.length === 0) continue
      groups.push({ id: col.groupId, heading: col.heading, links })
      for (const raw of rawList) flat.push(raw as string | { slug?: string; label?: string })
    }
  }

  return { groups, flat }
}

/** Translate the polymorphic site_strategy `nav` entry (string slug
 *  or object) into a NavItem. Exported so the partner render can
 *  build primary / secondary / footer NavItem[] on the fly from
 *  site_strategy.nav.* without a compose step. */
export function siteStrategyNavToItems(
  raw: Array<unknown> | undefined,
  nameBySlug: Map<string, string>,
  withChildren = true,
): NavItem[] {
  const toItem = (item: unknown): NavItem => {
    if (typeof item === 'string') {
      return { label: nameBySlug.get(item) ?? formatSlugAsTitle(item), slug: item }
    }
    if (!item || typeof item !== 'object') return { label: '' }
    const it = item as { slug?: string; label?: string; children?: unknown[] }
    const slug = it.slug
    const label = it.label ?? (slug ? (nameBySlug.get(slug) ?? formatSlugAsTitle(slug)) : '')
    if (!withChildren) return { label, ...(slug ? { slug } : {}) }
    const children = (Array.isArray(it.children) ? it.children : [])
      .map(c => toItem(c))
      .filter(c => c.label)
    return { label, ...(slug ? { slug } : {}), ...(children.length > 0 ? { children } : {}) }
  }
  return (raw ?? []).map(toItem).filter(it => it.label)
}

// ── Compose from existing project state ──────────────────────────────

interface ComposeSourceProject {
  id: string
  church_name?: string | null
  personas?: Array<{ id: string; name: string; archetype?: string; description?: string }> | null
  nav_group_definitions?: Array<{ label: string; sort_order?: number }> | null
  roadmap_state?: unknown
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

/** Compose a first-draft sitemap review from the current project
 *  state. Post-refactor, this NO LONGER composes a duplicate page
 *  list or nav layout — those live on site_strategy and are read
 *  live by the partner view. Compose only:
 *
 *    - Extracts per-page annotations from any legacy `existing.pages[]`
 *      (schema_version 1 rows) into `page_annotations` so review-only
 *      strategist edits (sitemap_tag, what_changed, etc.) carry
 *      forward.
 *    - Seeds explainer paragraphs (intro, executive_summary,
 *      navigation_strategy).
 *    - Seeds persona postures from strategy_brief personas.
 *    - Seeds content migrations from strategy.pages_considered_dropped.
 *    - Seeds footer_info from project columns.
 *    - Seeds footer_link_groups from cowork's grouped nav.footer.
 *    - Normalizes cowork's nav_presentation shape into the internal
 *      shape the partner view reads. */
export function composeSitemapReview(args: {
  project:  ComposeSourceProject
  existing: SitemapReview | null
}): SitemapReview {
  const { project, existing } = args
  const now = new Date().toISOString()

  const rs = (project.roadmap_state ?? {}) as Record<string, unknown>
  const strategy = (rs.site_strategy ?? null) as SiteStrategyBlob | null

  // ── Page annotations ────────────────────────────────────────────
  // Carry over any existing page_annotations verbatim. Also extract
  // annotations from legacy `existing.pages[]` (schema_version 1) if
  // present, so a project mid-migration still keeps its per-page
  // review edits until the row is upgraded to schema_version 2.
  const composedAnnotations: Record<string, ReviewPageAnnotation> = {
    ...(existing?.page_annotations ?? {}),
  }
  for (const p of existing?.pages ?? []) {
    if (!p.slug) continue
    if (composedAnnotations[p.slug]) continue
    const ann = extractAnnotationFromLegacyPage(p)
    if (ann) composedAnnotations[p.slug] = ann
  }

  // ── Persona postures ────────────────────────────────────────────
  const strategyPages = Array.isArray(strategy?.pages) ? strategy!.pages! : []
  const validPageSlugs = new Set(
    strategyPages
      .filter(p => typeof p.slug === 'string' && p.slug !== '_meta')
      .map(p => p.slug as string),
  )

  const existingPosturesById = new Map<string, PersonaPosture>()
  for (const pp of existing?.persona_postures ?? []) existingPosturesById.set(pp.persona_id, pp)

  const journeyByPersonaName = new Map<string, NonNullable<SiteStrategyBlob['persona_journeys']>[number]>()
  for (const j of strategy?.persona_journeys ?? []) {
    if (typeof j.persona === 'string') journeyByPersonaName.set(j.persona.toLowerCase(), j)
  }

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

  const composedPostures: PersonaPosture[] = personaSource.map(persona => {
    const prior = existingPosturesById.get(persona.id)
    const journey = journeyByPersonaName.get(persona.name.toLowerCase())
    const seededKeyPages = (journey?.entry_points ?? []).slice(0, 3)
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
      user_journey:             prior?.user_journey,
      journeys_by_congregation: prior?.journeys_by_congregation,
      entry_points:             prior?.entry_points,
    }
  })

  // ── Content migrations ──────────────────────────────────────────
  const seededMigrations = (strategy?.pages_considered_dropped ?? [])
    .filter(d => typeof d.slug === 'string' && (d.reason ?? '').trim())
    .map(d => ({
      id:          cryptoRandomId(),
      title:       d.from_label ?? formatSlugAsTitle(d.slug as string),
      merged_from: [d.from_label ?? formatSlugAsTitle(d.slug as string)],
      merged_to:   d.merged_to ?? '(consolidated across the new site)',
      rationale:   d.reason ?? '',
    }))
  const composedMigrations: ContentMigration[] =
    existing?.content_migrations && existing.content_migrations.length > 0
      ? existing.content_migrations
      : seededMigrations

  // ── Explainers ──────────────────────────────────────────────────
  const composedExecSummary = existing?.executive_summary
    ?? buildExecutiveSummary({ rs, church: project.church_name })

  const composedNavStrategy = existing?.navigation_strategy
    ?? buildNavigationStrategy({ strategy, church: project.church_name })

  // ── Nav presentation ────────────────────────────────────────────
  // Normalize cowork's shape into the internal shape at compose time
  // so downstream reads work.
  const legacyStage2 = (rs as { stage_2?: { nav_presentation?: unknown } })?.stage_2
  const rawStrategyNp =
    (strategy as { nav_presentation?: unknown } | null)?.nav_presentation
    ?? (legacyStage2?.nav_presentation as unknown | undefined)
    ?? null
  const strategyNavPresentation = normalizeCoworkNavPresentation(rawStrategyNp, existing?.presentation?.congregations)
  const existingNormalized = normalizeCoworkNavPresentation(existing?.nav_presentation, existing?.presentation?.congregations)
  const composedNavPresentation = existingNormalized ?? strategyNavPresentation

  // ── Presentation ────────────────────────────────────────────────
  const composedPresentation: SitemapReviewPresentation | undefined = (() => {
    const priorPres = existing?.presentation
    const authoredWhy = priorPres?.why_cards
    if (authoredWhy && authoredWhy.length > 0) return priorPres
    const seededWhy = buildWhyCardsFromStrategy({
      rs,
      church:          project.church_name,
      pageCount:       validPageSlugs.size,
      migrationCount:  composedMigrations.length,
      personaCount:    composedPostures.length,
    })
    if (!priorPres && !seededWhy) return undefined
    return { ...(priorPres ?? {}), why_cards: seededWhy ?? undefined }
  })()

  // ── Footer info ─────────────────────────────────────────────────
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

  if (existing?.footer_info && composedFooter.service_times == null) {
    const seed = project.all_service_times ?? project.primary_service_time ?? null
    if (seed) composedFooter.service_times = seed
  }

  // Seed footer_link_groups from cowork's grouped nav.footer. Names
  // resolved against site_strategy pages so labels match.
  const nameBySlugForFooter = new Map<string, string>()
  for (const sp of strategyPages) {
    if (sp.slug && sp.name) nameBySlugForFooter.set(sp.slug, sp.name)
  }
  const coworkFooterExtract = extractCoworkFooterGroups(strategy?.nav?.footer, nameBySlugForFooter)
  const existingHasGroups = ((existing?.footer_info?.footer_link_groups ?? []).length > 0)
  if (!existingHasGroups && coworkFooterExtract.groups.length > 0) {
    composedFooter.footer_link_groups = coworkFooterExtract.groups
  }

  return {
    schema_version:     2,
    token:              existing?.token ?? cryptoRandomId(),
    status:             existing?.status ?? 'draft',
    created_at:         existing?.created_at ?? now,
    updated_at:         now,
    published_at:       existing?.published_at ?? null,
    approved_at:        existing?.approved_at ?? null,
    approved_by:        existing?.approved_by ?? null,
    partner_reviewed_at: existing?.partner_reviewed_at ?? null,
    partner_reviewed_by: existing?.partner_reviewed_by ?? null,
    round_number:       existing?.round_number ?? 1,
    round_history:      existing?.round_history,
    round_change_summary: existing?.round_change_summary,
    intro:              existing?.intro ?? {
      headline: `${project.church_name ?? 'Your church'} Website Content Strategy`,
      body:     `Here's the proposed structure for your new website: what each page is for, how they fit together, and how the whole site is shaped around the people you're inviting into your church family. Everything on this page is editable. Read through it, share it with your team, and tell us what to refine. This is a working draft we build together.`,
    },
    executive_summary:  composedExecSummary,
    navigation_strategy: composedNavStrategy,
    nav_presentation:   composedNavPresentation,
    presentation:       composedPresentation,
    footer_info:        composedFooter,
    page_annotations:   composedAnnotations,
    persona_postures:   composedPostures,
    content_migrations: composedMigrations,
    partner_notes:      existing?.partner_notes,
    partner_edit_requests: existing?.partner_edit_requests,
    edit_history:       existing?.edit_history ?? [],
  }
}

/** Extract a ReviewPageAnnotation from a legacy pre-schema_version-2
 *  ReviewPage row. Returns null when no annotation-worthy field is
 *  populated (so a page that carried only site_strategy-derived data
 *  doesn't create an empty annotation entry). */
function extractAnnotationFromLegacyPage(p: ReviewPage): ReviewPageAnnotation | null {
  const ann: ReviewPageAnnotation = {}
  if (p.sitemap_tag) ann.sitemap_tag = p.sitemap_tag
  if (p.is_nav_parent_only) ann.is_nav_parent_only = p.is_nav_parent_only
  if (p.what_changed && p.what_changed.trim()) ann.what_changed = p.what_changed
  if (p.why_change && p.why_change.trim()) ann.why_change = p.why_change
  if (p.strategic_alignment && p.strategic_alignment.trim()) ann.strategic_alignment = p.strategic_alignment
  if (p.persona_relevance && p.persona_relevance.length > 0) ann.persona_relevance = p.persona_relevance
  return Object.keys(ann).length > 0 ? ann : null
}

/** Normalize the cowork-emitted nav_presentation shape into the
 *  internal shape PrimaryNavPreview reads. */
function normalizeCoworkNavPresentation(
  raw: unknown,
  congregations?: NonNullable<SitemapReview['presentation']>['congregations'],
): SitemapReviewNavPresentation | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const np = raw as Record<string, unknown>
  const hasCoworkHeader    = np.header && typeof np.header === 'object' && Array.isArray((np.header as Record<string, unknown>).items)
  const hasCoworkMegamenus = np.megamenus && typeof np.megamenus === 'object'
  const hasInternalKeys    = Array.isArray(np.visible_top_level) || Array.isArray(np.megamenu_panels)
  if (!hasCoworkHeader && !hasCoworkMegamenus) return raw as SitemapReviewNavPresentation
  if (hasInternalKeys) return raw as SitemapReviewNavPresentation

  const header    = (np.header    ?? {}) as Record<string, unknown>
  const megamenus = (np.megamenus ?? {}) as Record<string, unknown>
  const headerItems   = Array.isArray(header.items)   ? header.items   as Array<Record<string, unknown>> : []
  const headerButtons = Array.isArray(header.buttons) ? header.buttons as Array<unknown>                 : []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visible_top_level: NonNullable<SitemapReviewNavPresentation['visible_top_level']> = (headerItems.map(it => {
    const label = typeof it.label === 'string' ? it.label : ''
    const type  = typeof it.type  === 'string' ? it.type  : 'link'
    const slug  = typeof it.slug  === 'string' ? it.slug  : undefined
    if (type === 'megamenu' || type === 'group') {
      return { kind: 'group', label, group_label: label, ...(slug ? { slug } : {}) }
    }
    return { kind: 'page', label, ...(slug ? { slug } : {}) }
  }) as any[]).filter((it: any) => (it.label ?? '').trim().length > 0)

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

  const congLabelById = new Map<string, string>(
    (congregations ?? []).map(c => [c.id, c.label]),
  )
  const megamenu_panels: NonNullable<SitemapReviewNavPresentation['megamenu_panels']> = []
  for (const [label, panelRaw] of Object.entries(megamenus)) {
    if (!panelRaw || typeof panelRaw !== 'object') continue
    const panel = panelRaw as Record<string, unknown>

    if (Array.isArray(panel.congregations)) {
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
          .filter((l: any) => !!l && (l.label ?? '').trim().length > 0) as { label?: string; slug?: string; one_line_description?: string }[]
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

function buildExecutiveSummary(args: {
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

function buildNavigationStrategy(args: {
  strategy: SiteStrategyBlob | null
  church:   string | null | undefined
}): string {
  const { strategy, church } = args
  const churchName = church ?? 'Your church'
  const primaryCount = strategy?.nav?.primary?.length ?? 0
  return `The navigation is built to serve two people at once. A first-time visitor who lands on ${churchName}'s site needs to make one clear decision fast, and a returning member needs to reach what they came for without hunting for it. The top-level nav answers "should I visit?" first, then "how do I grow here?" second, and puts everything else one click away without cluttering the header.${primaryCount > 0 ? ` We landed on ${primaryCount} primary items after weighing what belongs where; the reasoning behind each is spelled out in the pages list below.` : ''}`
}

function synthesizePersonaId(name: string): string {
  return 'p_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function buildWhyCardsFromStrategy(args: {
  rs:              Record<string, unknown>
  church:          string | null | undefined
  pageCount:       number
  migrationCount:  number
  personaCount:    number
}): NonNullable<SitemapReviewPresentation['why_cards']> | null {
  const { rs, church, pageCount, migrationCount, personaCount } = args
  const sg = (rs.strategic_goals ?? {}) as Record<string, unknown>
  const gv = (sg.goals_and_vision ?? {}) as Record<string, { value?: string }>
  const churchVision = gv.church_vision?.value?.trim()  ?? null
  const topGoal      = gv.primary_goals?.value?.trim().split('\n')[0]?.trim() ?? null
  const s1           = (rs.stage_1 ?? {}) as { x_factor?: string; mission?: string }
  const xFactor      = s1.x_factor?.trim() ?? null
  const churchName   = church ?? 'this church'

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
  } else if (pageCount > 0) {
    cards.push({
      id:    'grow',
      icon:  '↗',
      title: 'Built to grow with you',
      body:  `As ${churchName} adds ministries and pages, new content slots into the same structure, no redesign needed.`,
    })
  }

  return cards.length > 0 ? cards : null
}

function formatSlugAsTitle(slug: string): string {
  return slug.split(/[-_/]/).filter(Boolean).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ')
}

// ── Status transitions ───────────────────────────────────────────────

export function publishReview(review: SitemapReview): SitemapReview {
  return {
    ...review,
    status:       'published',
    token:        review.token || cryptoRandomId(),
    published_at: review.published_at ?? new Date().toISOString(),
  }
}

export function approveReview(review: SitemapReview, by: 'staff' | 'partner'): SitemapReview {
  return {
    ...review,
    status:      'approved',
    approved_at: new Date().toISOString(),
    approved_by: by,
  }
}

/** Snapshot the current round into round_history and open a new
 *  round. Used when the partner has given feedback and the strategist
 *  wants to iterate + reshare, versus a bare retract that keeps the
 *  same round. Preserves partner feedback (partner_notes +
 *  partner_edit_requests) inside the snapshot so nothing gets lost,
 *  and clears them off the top-level review so Round N+1 starts
 *  clean. Status resets to `draft` — publish it again to share Round
 *  N+1 with the partner. `siteStrategyGeneratedAt` is the current
 *  site_strategy._meta.generated_at stamp so partners can see which
 *  revision they were reviewing at close time. */
export function startNextRound(
  review: SitemapReview,
  opts: { siteStrategyGeneratedAt?: string } = {},
): SitemapReview {
  const currentRound = review.round_number ?? 1
  const snapshot: SitemapReviewRoundSnapshot = {
    round_number:         currentRound,
    published_at:         review.published_at,
    closed_at:            new Date().toISOString(),
    partner_reviewed_at:  review.partner_reviewed_at ?? null,
    partner_reviewed_by:  review.partner_reviewed_by ?? null,
    partner_notes:        review.partner_notes,
    partner_edit_requests: review.partner_edit_requests ?? [],
    round_change_summary: review.round_change_summary,
    site_strategy_generated_at: opts.siteStrategyGeneratedAt,
  }
  const prior = review.round_history ?? []
  return {
    ...review,
    status:                'draft',
    round_number:          currentRound + 1,
    round_history:         [...prior, snapshot],
    round_change_summary:  undefined,
    published_at:          null,
    partner_reviewed_at:   null,
    partner_reviewed_by:   null,
    partner_notes:         undefined,
    partner_edit_requests: [],
  }
}

export async function getApprovedSitemapReview(
  sb: SupabaseClient,
  projectId: string,
): Promise<SitemapReview | null> {
  const review = await loadSitemapReview(sb, projectId)
  if (!review) return null
  return review.status === 'approved' ? review : null
}

// ── Public token access (partner portal) ─────────────────────────────

/** Fetch a sitemap review by its public token. Returns the review
 *  plus the current site_strategy so the partner view can render
 *  pages and nav live from strategy without a second RPC call. */
export async function loadSitemapReviewByToken(
  token: string,
  sb: SupabaseClient = defaultSupabase,
): Promise<{
  review:               SitemapReview
  site_strategy:        SiteStrategyBlob | null
  church_name:          string | null
  project_id:           string
  partner_portal_token: string | null
} | null> {
  const { data, error } = await sb.rpc('get_sitemap_review_by_token', { p_token: token })
  if (error || !data) return null
  const row = data as {
    review:               SitemapReview | null
    church_name:          string | null
    project_id:           string
    project:              ComposeSourceProject | null
    site_strategy:        SiteStrategyBlob | null
    partner_portal_token: string | null
  }
  if (!row.review) return null

  // Compose in-memory so a project mid-migration (schema_version 1
  // still on the row) picks up its page_annotations from legacy
  // pages[]. No DB write happens on partner reads.
  const composed = row.project
    ? composeSitemapReview({ project: row.project, existing: row.review })
    : row.review

  return {
    review:               composed,
    site_strategy:        row.site_strategy ?? null,
    church_name:          row.church_name,
    project_id:           row.project_id,
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
  const { error } = await (sb as any).rpc('save_sitemap_review_by_token', {
    p_token: args.token,
    p_next:  args.next as unknown as Record<string, unknown>,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// ── Edit-log helpers ─────────────────────────────────────────────────

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
  return `sr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}
