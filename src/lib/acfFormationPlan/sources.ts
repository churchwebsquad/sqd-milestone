// Content-Model Formation Plan — input readers.
//
// Pulls all 10 inputs from Supabase once and shapes them into
// `FormationInputs` so the analyzer doesn't re-query inside each rule.
//
// All readers are read-only. Failure mode for any sub-source: return
// the partial data with a `loadErrors` field describing what couldn't
// be fetched, so the analyzer can still produce a (potentially
// degraded) plan and surface the failures as open questions.

import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase as defaultSupabase } from '../supabase'
import { getApprovedSlugs } from '../pageApprovals'
import type {
  SectionRole,
  WebContentTemplate,
  WebPage,
  WebSection,
} from '../../types/database'

// ── Shape of what `loadProjectInputs` returns ────────────────────────

export interface CampusTerm {
  /** "Campus" by default, "Congregation" / "Location" / "Site" when
   *  the project overrode it. */
  singular: string
  /** "Campuses" by default. */
  plural: string
}

export interface DisplayPreferences {
  events:  string | null
  sermons: string | null
  groups:  string | null
}

export interface FormationInputs {
  webProjectId: string
  /** Raw project row — analyzer reads globals (church_name, etc.) and
   *  multi-campus flags from here. Loose-typed because the table has
   *  ~60 columns and we only touch ~25 of them. */
  project: ProjectRow
  /** Multi-campus flag — derived from project.campuses.length > 0. */
  isMultiCampus: boolean
  /** Resolved per-project campus term (defaults applied). */
  campusTerm: CampusTerm
  /** Approved pages only. Sorted by sort_order. */
  approvedPages: WebPage[]
  /** Sections per approved page id, in sort_order. */
  sectionsByPage: Map<string, WebSection[]>
  /** Templates referenced by any section in the approved pages. */
  templatesById: Map<string, WebContentTemplate>
  /** Latest open content-collection session for the partner, or null. */
  contentCollection: ContentCollectionRow | null
  /** Display preferences for events / sermons / groups (lifted off
   *  the content-collection row for convenience; null when the partner
   *  never opened a session). */
  displayPreferences: DisplayPreferences
  /** Project snippets — used to resolve {{token}} references in
   *  field_values back to a global. */
  snippets: SnippetRow[]
  /** Cross-page reuse counter — how many approved pages have a section
   *  with this section_role. */
  sectionRoleCounts: Map<SectionRole, number>
  /** Per-source load errors. Non-fatal — analyzer continues with
   *  whatever loaded. */
  loadErrors: LoadError[]
}

export interface LoadError {
  source: string
  message: string
}

interface ProjectRow {
  id: string
  member: number | null
  campuses: Array<{ slug: string; label: string; primary: boolean; sort_order: number }> | null
  campus_label_singular: string | null
  campus_label_plural:   string | null
  roadmap_state: unknown
  // Globals seeded into Options page — analyzer reads selectively.
  church_name:           string | null
  address:               string | null
  city_state:            string | null
  phone:                 string | null
  email:                 string | null
  primary_service_time:  string | null
  all_service_times:     string | null
  denomination:          string | null
  pastor_name:           string | null
  social_facebook_url:   string | null
  social_instagram_url:  string | null
  social_youtube_url:    string | null
  social_tiktok_url:     string | null
  social_twitter_url:    string | null
  social_linkedin_url:   string | null
  // Other columns exist but the analyzer ignores them.
  [k: string]: unknown
}

interface ContentCollectionRow {
  id: string
  member: number
  events_display_preference:  string | null
  sermons_display_preference: string | null
  groups_display_preference:  string | null
  status: string
  submitted_at: string | null
}

interface SnippetRow {
  token: string
  expansion: string
  tags: string[] | null
  archived: boolean
}

// ── Public entry ──────────────────────────────────────────────────────

/** Loads everything the analyzer needs in one pass. The web project's
 *  approved page set is the iteration root; all other sources hang
 *  off that. */
export async function loadProjectInputs(
  webProjectId: string,
  sb: SupabaseClient = defaultSupabase,
): Promise<FormationInputs> {
  const loadErrors: LoadError[] = []

  // 1. Project row (globals + multi-campus + roadmap_state).
  const { data: projectRaw, error: projectErr } = await sb
    .from('strategy_web_projects')
    .select('*')
    .eq('id', webProjectId)
    .maybeSingle()
  if (projectErr || !projectRaw) {
    throw new Error(`Project ${webProjectId} not found: ${projectErr?.message ?? 'no row'}`)
  }
  const project = projectRaw as unknown as ProjectRow
  const campuses = Array.isArray(project.campuses) ? project.campuses : []
  const isMultiCampus = campuses.length > 0
  const campusTerm: CampusTerm = {
    singular: project.campus_label_singular ?? 'Campus',
    plural:   project.campus_label_plural   ?? 'Campuses',
  }

  // 2. "Approved" page set — the field name on the type is approvedPages
  //    but in practice we accept any of:
  //      a. roadmap_state.approved_pages[slug].status === 'approved'  (McNeel's lock)
  //      b. web_pages.content_status === 'partner_approved'           (page-level partner sign-off)
  //      c. web_pages.content_status === 'partner_review'             (page is at least in partner hands)
  //    We OR these together because the `approved_pages` JSONB map is
  //    not yet adopted in production (0 entries org-wide), so without
  //    falling through to content_status the analyzer never sees any
  //    pages on a real partner. content_status='partner_review' is
  //    included because that's the most common late-stage status today;
  //    a stricter mode can be added later when partner_approved fills
  //    in across the org.
  const approvedSlugs = new Set(getApprovedSlugs(project.roadmap_state))
  let approvedPages: WebPage[] = []
  const { data: pages, error: pagesErr } = await sb
    .from('web_pages')
    .select('*')
    .eq('web_project_id', webProjectId)
    .or(`content_status.eq.partner_review,content_status.eq.partner_approved`)
    .order('sort_order', { ascending: true })
  if (pagesErr) {
    loadErrors.push({ source: 'web_pages', message: pagesErr.message })
  } else {
    const fromContentStatus = (pages ?? []) as unknown as WebPage[]
    // Union with anything roadmap_state.approved_pages locked in by slug.
    if (approvedSlugs.size > 0) {
      const extraSlugs = [...approvedSlugs].filter(
        slug => !fromContentStatus.some(p => p.slug === slug),
      )
      if (extraSlugs.length > 0) {
        const { data: more } = await sb
          .from('web_pages')
          .select('*')
          .eq('web_project_id', webProjectId)
          .in('slug', extraSlugs)
        approvedPages = [...fromContentStatus, ...((more ?? []) as unknown as WebPage[])]
      } else {
        approvedPages = fromContentStatus
      }
    } else {
      approvedPages = fromContentStatus
    }
  }

  // 4. Sections for those pages.
  const sectionsByPage = new Map<string, WebSection[]>()
  const templateIds = new Set<string>()
  if (approvedPages.length > 0) {
    const pageIds = approvedPages.map(p => p.id)
    const { data: sections, error: sectionsErr } = await sb
      .from('web_sections')
      .select('*')
      .in('web_page_id', pageIds)
      .order('sort_order', { ascending: true })
    if (sectionsErr) {
      loadErrors.push({ source: 'web_sections', message: sectionsErr.message })
    } else {
      for (const s of (sections ?? []) as unknown as WebSection[]) {
        const bucket = sectionsByPage.get(s.web_page_id) ?? []
        bucket.push(s)
        sectionsByPage.set(s.web_page_id, bucket)
        if (s.content_template_id) templateIds.add(s.content_template_id)
      }
    }
  }

  // 5. Templates referenced by any of those sections.
  const templatesById = new Map<string, WebContentTemplate>()
  if (templateIds.size > 0) {
    const { data: templates, error: tmplErr } = await sb
      .from('web_content_templates')
      .select('id, layer_name, family, variant, kind, fields, paired_post_template, paired_url_pattern')
      .in('id', [...templateIds])
    if (tmplErr) {
      loadErrors.push({ source: 'web_content_templates', message: tmplErr.message })
    } else {
      for (const t of (templates ?? []) as unknown as WebContentTemplate[]) {
        templatesById.set(t.id, t)
      }
    }
  }

  // 6. Latest content-collection session for the partner. May not
  //    exist (some partners never open one) — null is fine.
  let contentCollection: ContentCollectionRow | null = null
  const displayPreferences: DisplayPreferences = { events: null, sermons: null, groups: null }
  if (project.member != null) {
    const { data: cc, error: ccErr } = await sb
      .from('strategy_content_collection_sessions')
      .select('id, member, events_display_preference, sermons_display_preference, groups_display_preference, status, submitted_at')
      .eq('member', project.member)
      .order('submitted_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle()
    if (ccErr) {
      loadErrors.push({ source: 'strategy_content_collection_sessions', message: ccErr.message })
    } else if (cc) {
      contentCollection = cc as unknown as ContentCollectionRow
      displayPreferences.events  = contentCollection.events_display_preference
      displayPreferences.sermons = contentCollection.sermons_display_preference
      displayPreferences.groups  = contentCollection.groups_display_preference
    }
  }

  // 7. Project snippets — used to resolve {{token}} → global.
  let snippets: SnippetRow[] = []
  const { data: snippetRows, error: snipErr } = await sb
    .from('web_project_snippets')
    .select('token, expansion, tags, archived')
    .eq('web_project_id', webProjectId)
    .eq('archived', false)
  if (snipErr) {
    loadErrors.push({ source: 'web_project_snippets', message: snipErr.message })
  } else {
    snippets = (snippetRows ?? []) as unknown as SnippetRow[]
  }

  // 8. Section-role cross-page reuse counter. One pass over the
  //    materialized sectionsByPage map.
  const sectionRoleCounts = new Map<SectionRole, number>()
  for (const sections of sectionsByPage.values()) {
    const seenInThisPage = new Set<SectionRole>()
    for (const s of sections) {
      const role = s.section_role
      if (!role) continue
      // Count each page once per role — a page that has 3 cta_banner
      // sections shouldn't read as "cta_banner appears on 3 pages."
      if (seenInThisPage.has(role)) continue
      seenInThisPage.add(role)
      sectionRoleCounts.set(role, (sectionRoleCounts.get(role) ?? 0) + 1)
    }
  }

  return {
    webProjectId,
    project,
    isMultiCampus,
    campusTerm,
    approvedPages,
    sectionsByPage,
    templatesById,
    contentCollection,
    displayPreferences,
    snippets,
    sectionRoleCounts,
    loadErrors,
  }
}

// ── Display-preference → CPT shape resolution ─────────────────────────
//
// Sermons + groups don't have dedicated SectionRoles (the SectionRole
// enum has staff/event/blog/career detail-page roles, but no sermon_*
// or group_*). Their CPT decisions are driven by the partner's
// content-collection answers instead. This helper decodes those
// answers into a CPT shape the analyzer can hand to emit.ts.
//
// `events` follows the same pattern for symmetry — even though the
// enum HAS event_detail, the partner's wordpress|external|embed
// choice still wins.

export type DisplayPrefShape =
  | { kind: 'cpt';      single_template: 'yes' | 'no'; archive: 'yes' | 'no'; headless: boolean; rationale: string }
  | { kind: 'external'; rationale: string }
  | { kind: 'skip';     rationale: string }

export function resolveDisplayPreference(
  contentKind: 'events' | 'sermons' | 'groups',
  value: string | null,
): DisplayPrefShape {
  if (value == null || value === '' || value === 'none') {
    return { kind: 'skip', rationale: `Partner has not answered ${contentKind}_display_preference.` }
  }

  if (contentKind === 'events') {
    switch (value) {
      case 'wordpress':
        return { kind: 'cpt', single_template: 'yes', archive: 'no', headless: false,
                 rationale: 'Partner picked "wordpress" — events live in WP with per-event detail pages, surfaced via a Bricks query loop on /events.' }
      case 'external':
      case 'embed':
        return { kind: 'external', rationale: `Partner picked "${value}" — events are managed in a third-party system (Church Center / CCB / etc.). Site links out or embeds; no CPT needed.` }
      default:
        return { kind: 'skip', rationale: `Unrecognized events_display_preference value: ${value}` }
    }
  }

  if (contentKind === 'sermons') {
    // 5 new values introduced in commit aedc6d3 + a legacy `wordpress`
    // value that some older partners still have on file.
    switch (value) {
      case 'archive_pages':
        return { kind: 'cpt', single_template: 'yes', archive: 'yes', headless: false,
                 rationale: 'Sermon archive with per-sermon on-site pages — full CPT with archive enabled.' }
      case 'latest_series_pages':
        return { kind: 'cpt', single_template: 'yes', archive: 'no', headless: false,
                 rationale: 'Latest series with per-sermon on-site pages — CPT with detail templates, archive disabled (latest-series Bricks query loop on the sermons page handles listing).' }
      case 'archive_youtube':
      case 'latest_series_youtube':
        return { kind: 'cpt', single_template: 'no', archive: 'no', headless: true,
                 rationale: 'Sermon cards link directly to YouTube — CPT still needed to hold the metadata + YT link, but no detail templates and no archive URL.' }
      case 'latest_sermon':
        return { kind: 'cpt', single_template: 'no', archive: 'no', headless: true,
                 rationale: 'Single latest-sermon embed, clicks open YouTube — minimal CPT to hold the featured-sermon record, no detail page, no archive.' }
      case 'wordpress':  // legacy
        return { kind: 'cpt', single_template: 'yes', archive: 'yes', headless: false,
                 rationale: 'Legacy "wordpress" value — treated as the equivalent of archive_pages (CPT + single template + archive).' }
      case 'external':
        return { kind: 'external', rationale: 'Partner picked "external" — sermons stay on a third-party host; no CPT.' }
      default:
        return { kind: 'skip', rationale: `Unrecognized sermons_display_preference value: ${value}` }
    }
  }

  // groups
  switch (value) {
    case 'wordpress':
      return { kind: 'cpt', single_template: 'yes', archive: 'no', headless: false,
               rationale: 'Groups in WP with per-group detail pages, listed via Bricks query loop on /groups.' }
    case 'contact':
      return { kind: 'cpt', single_template: 'no', archive: 'no', headless: true,
               rationale: 'Mailto CTA per group — CPT needed for editable group records, but no detail URL. Headless: disable single + archive + publicly_queryable.' }
    case 'embed':
    case 'external':
      return { kind: 'external', rationale: `Partner picked "${value}" — groups stay in a third-party system (Church Center / CCB). No local CPT.` }
    default:
      return { kind: 'skip', rationale: `Unrecognized groups_display_preference value: ${value}` }
  }
}

// ── Token → globals binding ──────────────────────────────────────────

/** Returns the set of {{tokens}} referenced anywhere in a section's
 *  field_values, recursively walking nested arrays/objects. Used by
 *  the analyzer to detect global references that aren't covered by
 *  the curated CHURCH_WIDE_GLOBAL_COLUMNS list. */
export function extractSnippetTokens(value: unknown, acc: Set<string> = new Set<string>()): Set<string> {
  if (value == null) return acc
  if (typeof value === 'string') {
    const re = /\{\{\s*([a-z0-9_-]+)\s*\}\}/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(value)) !== null) acc.add(m[1])
    return acc
  }
  if (Array.isArray(value)) {
    for (const item of value) extractSnippetTokens(item, acc)
    return acc
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) extractSnippetTokens(v, acc)
    return acc
  }
  return acc
}
