/**
 * Pure URL → campus matching logic, shared between the Vite browser
 * bundle (via `src/lib/webCampuses.ts`) and the Deno edge functions
 * (crawl-categorize, atomize-crawl-into-atoms, etc.). No DOM, no
 * Supabase client, no React — just the `URL` constructor and pure
 * string math, so it's portable across both runtimes.
 *
 * Single source of truth. Drift between the two callers would mean
 * the crawler tags a topic differently than the UI reads it, which
 * would silently mistag content with the wrong audience.
 */

export interface CampusLike {
  /** URL slug (lowercase, hyphen-joined). E.g. "southwest", "alliance". */
  slug: string
}

/** Match a URL against a campus registry. Returns the campus slug whose
 *  path prefix owns this URL, or null when no campus matches.
 *
 *  Match rules:
 *    - URL parsing failure → null
 *    - Pathname equals "/<slug>" → matches
 *    - Pathname starts with "/<slug>/" → matches
 *    - Otherwise → null
 *  Case-insensitive on both sides. */
export function urlToCampusSlug(
  url: string | null | undefined,
  campuses: CampusLike[],
): string | null {
  if (!url || typeof url !== 'string') return null
  let pathname: string
  try {
    pathname = new URL(url).pathname.toLowerCase()
  } catch {
    return null
  }
  for (const c of campuses) {
    if (!c?.slug) continue
    const slugLower = String(c.slug).toLowerCase()
    const segExact  = `/${slugLower}`
    const segPrefix = `/${slugLower}/`
    if (pathname === segExact || pathname.startsWith(segPrefix)) return c.slug
  }
  return null
}

/** Decide a topic's campus_slug from its source URLs.
 *
 *  Returns:
 *    - null when the project is single-campus (empty registry)
 *    - null when no source URL matches any campus
 *    - null when source URLs match MULTIPLE campuses (topic is global)
 *    - the slug when every campus-matched URL agrees on one campus
 *
 *  URLs that don't match any campus (e.g. the homepage at "/") are
 *  SKIPPED rather than treated as disqualifying — a kids-ministry
 *  topic with passages from both /southwest/kids and / is still
 *  campus-specific. Only mixed campus signals (e.g. /southwest/kids
 *  AND /alliance/kids both contributing) escalate to NULL/global. */
export function topicCampusForUrls(
  sourceUrls: readonly (string | null | undefined)[] | null | undefined,
  campuses: CampusLike[],
): string | null {
  if (!campuses || campuses.length === 0) return null
  if (!Array.isArray(sourceUrls) || sourceUrls.length === 0) return null
  let chosen: string | null = null
  for (const u of sourceUrls) {
    const c = urlToCampusSlug(u ?? null, campuses)
    if (c === null) continue
    if (chosen === null) chosen = c
    else if (chosen !== c) return null
  }
  return chosen
}
