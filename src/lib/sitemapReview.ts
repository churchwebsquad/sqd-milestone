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
  /** Client-facing "what this page is for" note. Editable throughout —
   *  strategist drafts, partner refines, both writes flow into the
   *  edit_history. */
  purpose: string
  /** Human label of where this page lives in the nav — e.g. "Header
   *  → About → Team" or "Footer → Get Help". Purely descriptive; the
   *  actual nav tree lives in nav_layout. */
  nav_position?: string
  parent_slug?: string | null
  order: number
  /** Persona ids this page is primarily for. Cross-referenced against
   *  persona_postures[].persona_id. */
  persona_relevance?: string[]
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

export interface SitemapReview {
  schema_version: 1
  token: string
  status: SitemapReviewStatus
  created_at: string
  updated_at: string
  published_at: string | null
  approved_at:  string | null
  approved_by:  'staff' | 'partner' | null

  /** Intro block shown at the top of the partner-facing review — sets
   *  the tone. Editable; strategist authors, partner can rewrite. */
  intro?: {
    headline: string
    body:     string
  }

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
 *  keys are preserved. `updated_at` is stamped automatically. */
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

// ── Compose from existing project state ──────────────────────────────

interface ComposeSourceProject {
  id: string
  church_name?: string | null
  personas?: Array<{ id: string; name: string; archetype?: string; description?: string }> | null
  nav_group_definitions?: Array<{ label: string; sort_order?: number }> | null
  roadmap_state?: unknown
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

/** Compose a first-draft sitemap review from the current project state
 *  — pages, personas, nav groups, existing strategist proposal. Fills
 *  in reasonable defaults for every field; the strategist edits from
 *  there. Idempotent when re-run against an existing review: preserves
 *  fields the strategist already authored (purpose, posture_summary,
 *  etc.) and only fills in blanks. */
export function composeSitemapReview(args: {
  project:  ComposeSourceProject
  pages:    ComposeSourceWebPage[]
  existing: SitemapReview | null
}): SitemapReview {
  const { project, pages, existing } = args
  const now = new Date().toISOString()

  const existingPagesBySlug = new Map<string, ReviewPage>()
  for (const p of existing?.pages ?? []) existingPagesBySlug.set(p.slug, p)

  const composedPages: ReviewPage[] = pages
    .filter(p => p.slug && p.slug !== '_meta')
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((p, i) => {
      const prior = existingPagesBySlug.get(p.slug)
      return {
        id:             prior?.id ?? cryptoRandomId(),
        web_page_id:    p.id,
        slug:           p.slug,
        name:           p.name ?? p.slug,
        purpose:        prior?.purpose ?? '',
        nav_position:   prior?.nav_position ?? (p.nav_group_label ? `Header → ${p.nav_group_label}` : undefined),
        parent_slug:    prior?.parent_slug,
        order:          i,
        persona_relevance: prior?.persona_relevance ?? [],
      }
    })

  const existingPosturesById = new Map<string, PersonaPosture>()
  for (const pp of existing?.persona_postures ?? []) existingPosturesById.set(pp.persona_id, pp)

  const composedPostures: PersonaPosture[] = (project.personas ?? []).map(persona => {
    const prior = existingPosturesById.get(persona.id)
    return {
      persona_id:      persona.id,
      persona_name:    persona.name,
      posture_summary: prior?.posture_summary ?? '',
      user_journey:    prior?.user_journey ?? [],
      key_page_slugs:  prior?.key_page_slugs ?? [],
    }
  })

  // Nav layout: seed from existing or from nav_group_definitions.
  const composedNav: NavLayout = existing?.nav_layout ?? {
    header: (project.nav_group_definitions ?? [])
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map(g => ({ label: g.label })),
    footer_sections: [],
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
      headline: `${project.church_name ?? 'Your church'} — sitemap and navigation review`,
      body:     'Here\'s the proposed structure for your new site — what each page is for, how they connect, and how each fits the people you\'re trying to reach. Everything on this page is editable; let us know what to adjust.',
    },
    pages:              composedPages,
    persona_postures:   composedPostures,
    nav_layout:         composedNav,
    content_migrations: existing?.content_migrations ?? [],
    partner_notes:      existing?.partner_notes,
    edit_history:       existing?.edit_history ?? [],
  }
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
