/**
 * Sitemap Review — the partner-facing snapshot of a project's page
 * structure, persona postures, navigation layout, and content-
 * consolidation rationale.
 *
 * Distinct from `roadmap_state.stage_2` (the strategist's proposal —
 * includes strategist-only info like scoring, considered alternatives,
 * cowork provenance). The review is the client-safe view: a curated
 * summary the partner reads and can edit, then approves as the
 * official path forward that downstream tools consume.
 *
 * Storage: `strategy_web_projects.roadmap_state.sitemap_review` — a
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
  | 'approved'          // locked as canonical — downstream tools read from here

/** Ordered step in a persona's journey — either an anchor to one of
 *  the site's pages (via `page_slug`) or a free-text milestone
 *  (e.g. "Watches a service online" without a specific page). */
export interface JourneyStep {
  step_label: string
  page_slug?: string
  note?: string
}

/** How the site is postured toward one persona. Composed by the
 *  strategist from the project's `personas[]` — one posture per
 *  persona the site is meant to serve. */
export interface PersonaPosture {
  persona_id: string
  persona_name: string
  /** One-paragraph "here's how the site is angled to this person" —
   *  what they see first, how the message lands, what tone. */
  posture_summary: string
  user_journey: JourneyStep[]
  /** Slugs of the pages most critical to this persona's success on
   *  the site. Used to highlight "these are your pages" per persona. */
  key_page_slugs: string[]
  /** Pages this persona is likely to LAND on first. Pulled from the
   *  cowork sitemap step's `persona_journeys[].entry_points`. Empty
   *  when unknown. */
  entry_points?: string[]
  /** Where the strategist predicts this persona might bail. Pulled
   *  from `persona_journeys[].drop_off_risk`. Optional. */
  drop_off_risk?: {
    at_slug:    string
    reason:     string
    mitigation: string
  }
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
}

export interface NavItem {
  label: string
  slug?: string   // internal — points at ReviewPage.slug
  url?: string    // external
  children?: NavItem[]
}

export interface FooterSection {
  label: string
  items: NavItem[]
}

export interface NavLayout {
  header: NavItem[]
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

/** "Where content went" — captures the strategist's consolidation
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
  newsletter_signup_url?: string | null
  social_links?: Array<{
    platform: 'facebook' | 'instagram' | 'youtube' | 'tiktok' | 'twitter' | 'linkedin' | 'other'
    url:      string
    label?:   string
  }>
  /** Additional footer page links (Weekday Preschool, Careers,
   *  Contact, Memorial Garden, etc.). Strategist adds these as they
   *  emerge from cowork; partner confirms or edits. */
  footer_page_links?: Array<{ label: string; url: string }>
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

  edit_history: EditLogEntry[]
}

// ── Read / write ─────────────────────────────────────────────────────

/** Read the sitemap review for a project (staff context — uses the
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

/** Shape of `roadmap_state.site_strategy` — the cowork "plan-site-strategy"
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
    footer?:    Array<{ slug?: string; label?: string } | string>
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
 *  step output) as the source of truth — that has rich per-page context
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

  // Nav-position labeling — derives a human-readable "where in the nav"
  // from site_strategy.nav (primary / footer / cta_only) so the review
  // renders "Header · primary" instead of leaving nav_position blank.
  const navPositionBySlug = buildNavPositionMap(strategy?.nav)

  // Prefer site_strategy.pages when present; fall back to raw web_pages.
  const strategyPages = Array.isArray(strategy?.pages) ? strategy!.pages! : []
  const composedPages: ReviewPage[] = (strategyPages.length > 0
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
          }
        })
  )

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

  const composedPostures: PersonaPosture[] = personaSource.map(persona => {
    const prior = existingPosturesById.get(persona.id)
    const journey = journeyByPersonaName.get(persona.name.toLowerCase())
    const seededSteps: JourneyStep[] = journey?.journey
      ? journey.journey.map(slug => ({ step_label: `Visits /${slug}`, page_slug: slug }))
      : []
    return {
      persona_id:      persona.id,
      persona_name:    persona.name,
      posture_summary: prior?.posture_summary ?? persona.description ?? '',
      user_journey:    prior?.user_journey && prior.user_journey.length > 0 ? prior.user_journey : seededSteps,
      key_page_slugs:  prior?.key_page_slugs && prior.key_page_slugs.length > 0
        ? prior.key_page_slugs
        : (journey?.entry_points ?? []),
      entry_points:    prior?.entry_points ?? journey?.entry_points ?? undefined,
      drop_off_risk:   prior?.drop_off_risk ?? (
        journey?.drop_off_risk?.at_slug && journey?.drop_off_risk?.reason
          ? {
              at_slug:    journey.drop_off_risk.at_slug,
              reason:     journey.drop_off_risk.reason ?? '',
              mitigation: journey.drop_off_risk.mitigation ?? '',
            }
          : undefined
      ),
    }
  })

  // Nav layout: prefer site_strategy.nav when present; fall back to
  // existing review or nav_group_definitions.
  const composedNav: NavLayout = existing?.nav_layout ?? buildNavLayoutFromStrategy(strategy, composedPages)
    ?? {
      header: (project.nav_group_definitions ?? [])
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map(g => ({ label: g.label })),
      footer_sections: [],
    }

  // Content migrations: seed from pages_considered_dropped when the
  // strategist hasn't authored any yet. Each dropped-page entry becomes
  // a "This existed on your old site; here's why it doesn't now" card.
  const composedMigrations: ContentMigration[] =
    existing?.content_migrations && existing.content_migrations.length > 0
      ? existing.content_migrations
      : (strategy?.pages_considered_dropped ?? [])
          .filter(d => typeof d.slug === 'string' && (d.reason ?? '').trim())
          .map(d => ({
            id:          cryptoRandomId(),
            title:       d.from_label ?? formatSlugAsTitle(d.slug as string),
            merged_from: [d.from_label ?? formatSlugAsTitle(d.slug as string)],
            merged_to:   d.merged_to ?? '(consolidated across the new site)',
            rationale:   d.reason ?? '',
          }))

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

  // Footer info hydrated from the project's global columns. Every
  // field remains editable so the partner can correct anything that
  // changed since intake.
  const composedFooter: FooterInfo = existing?.footer_info ?? {
    church_name:          project.church_name ?? null,
    address:              project.address ?? null,
    phone:                project.phone ?? null,
    email:                project.email ?? null,
    office_hours:         null,
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
      headline: `${project.church_name ?? 'Your church'} website content strategy`,
      body:     `Here's the proposed structure for your new website: what each page is for, how they fit together, and how the whole site is shaped around the people you're inviting into your church family. Everything on this page is editable. Read through it, share it with your team, and tell us what to refine. This is a working draft we build together.`,
    },
    executive_summary:  composedExecSummary,
    navigation_strategy: composedNavStrategy,
    footer_info:        composedFooter,
    pages:              composedPages,
    persona_postures:   composedPostures,
    nav_layout:         composedNav,
    content_migrations: composedMigrations,
    partner_notes:      existing?.partner_notes,
    edit_history:       existing?.edit_history ?? [],
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
function synthesizePersonaId(name: string): string {
  return 'p_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
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
  if (!nav || (!nav.primary && !nav.footer && !nav.secondary && secondaryPagesFallback.length === 0)) return null

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
    const children = (it.children ?? [])
      .map(c => toNavItem(c, false))
      .filter(c => c.label)
    return { label, ...(slug ? { slug } : {}), ...(children.length > 0 ? { children } : {}) }
  }

  const primaryItems: NavItem[] = (nav.primary ?? []).map(item => toNavItem(item, true)).filter(it => it.label)
  const secondaryFromStrategy: NavItem[] = (nav.secondary ?? []).map(item => toNavItem(item, true)).filter(it => it.label)
  const secondaryFromFallback: NavItem[] = secondaryPagesFallback
    .sort((a, b) => a.order - b.order)
    .map(p => ({ label: p.name, slug: p.slug }))
  const secondaryItems = secondaryFromStrategy.length > 0
    ? secondaryFromStrategy
    : secondaryFromFallback

  const footerItems: NavItem[] = (nav.footer ?? []).map(item => toNavItem(item, false)).filter(it => it.label)

  return {
    header:           primaryItems,
    ...(secondaryItems.length > 0 ? { secondary: secondaryItems } : {}),
    ...(nav.secondary_label ? { secondary_label: nav.secondary_label } : {}),
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
  const secondaryLabel = nav.secondary_label ?? 'Secondary menu'
  for (const item of nav.primary ?? []) {
    if (typeof item === 'string') { map.set(item, 'Header · primary'); continue }
    if (item.slug) map.set(item.slug, 'Header · primary')
    for (const c of item.children ?? []) {
      if (typeof c === 'string') map.set(c, `Header · under ${item.label ?? item.slug ?? '(parent)'}`)
      else if ((c as { slug?: string }).slug) map.set((c as { slug: string }).slug, `Header · under ${item.label ?? item.slug ?? '(parent)'}`)
    }
  }
  for (const item of nav.secondary ?? []) {
    if (typeof item === 'string') { map.set(item, secondaryLabel); continue }
    if (item.slug) map.set(item.slug, secondaryLabel)
    for (const c of item.children ?? []) {
      if (typeof c === 'string') map.set(c, `${secondaryLabel} · under ${item.label ?? item.slug ?? '(parent)'}`)
      else if ((c as { slug?: string }).slug) map.set((c as { slug: string }).slug, `${secondaryLabel} · under ${item.label ?? item.slug ?? '(parent)'}`)
    }
  }
  for (const item of nav.footer ?? []) {
    if (typeof item === 'string') { map.set(item, 'Footer'); continue }
    if (item.slug) map.set(item.slug, 'Footer')
  }
  for (const item of nav.cta_only ?? []) {
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

/** Move the review to `published` — mints the token if missing and
 *  stamps published_at. Idempotent. */
export function publishReview(review: SitemapReview): SitemapReview {
  return {
    ...review,
    status:       'published',
    token:        review.token || cryptoRandomId(),
    published_at: review.published_at ?? new Date().toISOString(),
  }
}

/** Move the review to `approved` — stamps approved_at + approved_by.
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
 *  flux — tools reading from them would render provisional data as
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
): Promise<{ review: SitemapReview; church_name: string | null; project_id: string } | null> {
  const { data, error } = await sb.rpc('get_sitemap_review_by_token', { p_token: token })
  if (error || !data) return null
  const row = data as { review: SitemapReview | null; church_name: string | null; project_id: string }
  if (!row.review) return null
  return { review: row.review, church_name: row.church_name, project_id: row.project_id }
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
  // Fallback for the rare runtime without randomUUID — timestamp +
  // random suffix. Not cryptographically strong, but the review token
  // is scoped to a single project and rotatable.
  return `sr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}
