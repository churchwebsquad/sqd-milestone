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
  /** Full crawl URL for this campus. When set, this is the canonical
   *  match — every URL whose `scheme://host/path` is at-or-under this
   *  prefix belongs to this campus. Required for subdomain campuses
   *  (alliance.doxology.church/) or campuses on completely separate
   *  domains (doxologyespanol.com/) where pathname-prefix matching on
   *  the slug doesn't apply. */
  crawl_url?: string | null
}

/** Strip a URL to a normalized prefix string suitable for `startsWith`
 *  comparison. Lowercase scheme + host + path with the trailing slash
 *  removed. Returns null when the URL fails to parse. */
function normalizePrefix(rawUrl: string | null | undefined): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null
  try {
    const u = new URL(rawUrl)
    let path = u.pathname
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
    return `${u.protocol}//${u.host.toLowerCase()}${path.toLowerCase()}`
  } catch {
    return null
  }
}

/** Match a URL against a campus registry. Returns the campus slug
 *  that owns this URL, or null when no campus matches.
 *
 *  Two match paths, tried in order:
 *
 *  1. **crawl_url prefix** (preferred when set). Any URL whose
 *     normalized prefix is at-or-under the campus's normalized
 *     crawl_url belongs to that campus. Handles subdomain campuses
 *     (alliance.doxology.church/) and cross-domain campuses
 *     (doxologyespanol.com/) which pathname-only matching can't model.
 *
 *  2. **pathname slug prefix** (fallback). Used when a campus has no
 *     crawl_url set (the lightweight pre-flag path where staff
 *     register slugs first and worry about URLs later). Matches when
 *     the URL's pathname is exactly `/<slug>` or starts with
 *     `/<slug>/`. The case where pathname might match many campuses
 *     is unlikely — slug naming is partner-supplied and not
 *     overlapping in practice.
 *
 *  Case-insensitive on hosts and paths. URL parsing failure → null.
 */
export function urlToCampusSlug(
  url: string | null | undefined,
  campuses: CampusLike[],
): string | null {
  const urlPrefix = normalizePrefix(url)
  if (!urlPrefix) return null
  // Pass 1 — crawl_url match. Longer prefixes win when multiple
  // campuses claim overlapping subtrees, so sort by descending length.
  const withCrawlUrl = campuses
    .map(c => ({ c, prefix: normalizePrefix(c?.crawl_url) }))
    .filter((x): x is { c: CampusLike; prefix: string } => !!x.prefix && !!x.c?.slug)
    .sort((a, b) => b.prefix.length - a.prefix.length)
  for (const { c, prefix } of withCrawlUrl) {
    if (urlPrefix === prefix || urlPrefix.startsWith(prefix + '/')) return c.slug
  }
  // Pass 2 — pathname slug fallback.
  let pathname: string
  try {
    pathname = new URL(url!).pathname.toLowerCase()
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
