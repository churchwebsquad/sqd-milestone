/**
 * Multi-campus detection + persistence helpers (v113).
 *
 * Most projects are single-campus — strategy_web_projects.campuses
 * stays []. The handful that are multi-campus (Doxology Bible Church
 * was the lead use case) need every downstream surface to know which
 * campus a topic / atom / page belongs to. This module is the entry
 * point for that detection.
 *
 * Flow:
 *   1. crawl finishes, partner_topics + crawl_results populated.
 *   2. staff visits CrawlWorkspace → "Detect campuses" runs the
 *      detector here against the crawl_results.
 *   3. The detector returns ranked candidates (clusters of pages
 *      sharing a URL prefix that don't look like content-type
 *      segments).
 *   4. Staff confirms / edits / discards via UI, then `saveCampuses`
 *      writes to strategy_web_projects.campuses.
 *
 * Detection is intentionally conservative + staff-gated. False
 * positives mistag content with the wrong audience; we err on the
 * side of surfacing fewer candidates and letting staff add the rest.
 */
import { supabase } from './supabase'
import type { StrategyWebProject } from '../types/database'
import { urlToCampusSlug as urlToCampusSlugShared, topicCampusForUrls as topicCampusForUrlsShared, type CampusLike } from '../../supabase/functions/_shared/campusMatching'

// Re-export the pure matching helpers so the rest of the codebase
// can keep importing from this module. Single source of truth lives
// in supabase/functions/_shared/campusMatching.ts (so the Deno edge
// functions can import the exact same logic — no drift).
export { urlToCampusSlugShared as urlToCampusSlug, topicCampusForUrlsShared as topicCampusForUrls }
export type { CampusLike }

export interface CampusDefinition {
  slug:       string
  label:      string
  primary:    boolean
  sort_order: number
  crawl_url:  string | null
}

export interface CampusCandidate {
  /** URL slug derived from the path segment. Lowercase, hyphen-joined. */
  slug:       string
  /** Suggested human label (initcap of slug, hyphens → spaces). */
  label:      string
  /** Sample URL we'd use to re-crawl this campus. May be NULL if
   *  detection only saw the prefix but no canonical landing page. */
  crawl_url:  string | null
  /** Pages we observed under this prefix. Surfaced so staff can sanity-
   *  check the candidate before confirming. */
  page_count: number
  /** Signals that triggered this candidate, e.g. "url_prefix(>=3)",
   *  "landing_title_mentions". */
  signals:    string[]
  /** First ~5 sample URLs for the staff preview. */
  sample_urls: string[]
}

export interface CampusDetectionResult {
  candidates:           CampusCandidate[]
  /** True when the root crawl URL's title contained a campus-selector
   *  cue ("select a location", "find a campus", etc.). Staff sees
   *  this as a hint that the site is multi-campus by design. */
  has_campus_selector_landing: boolean
  total_pages_examined: number
}

/** Content-type path segments we explicitly exclude from campus
 *  detection. These show up under /seg/<slug> across most sites and
 *  are NOT campus indicators. Match is case-insensitive. */
const CONTENT_TYPE_SEGMENTS = new Set([
  // Content / blog
  'blog', 'posts', 'news', 'stories', 'articles', 'press',
  // Sermons / messages / podcasts
  'sermons', 'sermon', 'sermon-series', 'sermon-video', 'messages',
  'message', 'media', 'podcast', 'podcasts', 'audio', 'video',
  'videos', 'watch',
  // Events / calendar
  'events', 'event', 'calendar', 'schedule',
  // Resources / info / FAQ
  'info', 'resources', 'family-resources', 'faq', 'faqs', 'docs',
  'documents', 'help', 'support', 'pages',
  // Missions / outreach (often global)
  'missions', 'mission-trips', 'outreach',
  // Forms / signup / give / contact
  'forms', 'form', 'signup', 'register', 'registration', 'give',
  'giving', 'donate', 'contact', 'connect', 'subscribe',
  // E-commerce / cart / store
  'cart', 'shop', 'store', 'products', 'product', 'checkout',
  // Tech / admin / system
  'wp-admin', 'wp-content', 'admin', 'api', 'rss', 'feed', 'sitemap',
  'login', 'account', 'search', 'tag', 'tags', 'category', 'categories',
  // Specific landing pages / one-offs
  'home', 'about', 'leadership', 'team', 'staff', 'kids', 'youth',
  'students', 'student', 'membership', 'baptism', 'easter',
  'christmas', 'lent', 'journey', 'hymnal', 'picnic',
])

/** Title cues that indicate a campus-selector landing page. */
const CAMPUS_SELECTOR_CUES = [
  'select a location',
  'select a campus',
  'select a congregation',
  'find a campus',
  'find a location',
  'choose a campus',
  'choose a location',
  'our locations',
  'our campuses',
  'our congregations',
]

/** Minimum page count under a prefix to consider it a campus
 *  candidate. Tuned conservatively — campuses on real sites carry
 *  most of the per-campus navigation (kids, give, contact, etc.) so
 *  3+ pages is a sane floor. */
const MIN_PAGES_PER_CAMPUS = 3

interface CrawlResultPage {
  url?:      string
  title?:    string
  metadata?: { sourceURL?: string }
}

/** Run the detector against a project's crawl_results. Returns ranked
 *  candidates without writing anything to the DB. */
export function detectCampusCandidates(
  crawlResults: CrawlResultPage[] | null | undefined,
): CampusDetectionResult {
  const empty: CampusDetectionResult = {
    candidates: [],
    has_campus_selector_landing: false,
    total_pages_examined: 0,
  }
  if (!Array.isArray(crawlResults) || crawlResults.length === 0) return empty

  // Cluster URLs by first path segment. Dedupe by URL — crawl_results
  // sometimes carries the same URL twice (expand-mode merge can leave
  // duplicates when source URLs differ in canonicalization).
  const clusters = new Map<string, { urls: Set<string>; titles: string[] }>()
  const seenUrls = new Set<string>()
  let landingTitle: string | null = null

  for (const p of crawlResults) {
    const rawUrl = (p?.url || p?.metadata?.sourceURL || '').trim()
    if (!rawUrl) continue
    if (seenUrls.has(rawUrl)) continue
    seenUrls.add(rawUrl)
    let pathname: string
    try {
      pathname = new URL(rawUrl).pathname
    } catch {
      continue
    }
    // Capture the root-page title for landing-cue detection.
    if (pathname === '/' || pathname === '') {
      if (typeof p.title === 'string' && p.title.length > 0) landingTitle = p.title
      continue
    }
    const firstSeg = pathname.split('/').filter(Boolean)[0]
    if (!firstSeg) continue
    const segLower = firstSeg.toLowerCase()
    if (CONTENT_TYPE_SEGMENTS.has(segLower)) continue

    let cluster = clusters.get(segLower)
    if (!cluster) {
      cluster = { urls: new Set(), titles: [] }
      clusters.set(segLower, cluster)
    }
    cluster.urls.add(rawUrl)
    if (typeof p.title === 'string') cluster.titles.push(p.title)
  }

  const hasSelectorCue = !!landingTitle && CAMPUS_SELECTOR_CUES.some(
    cue => landingTitle!.toLowerCase().includes(cue),
  )

  const candidates: CampusCandidate[] = []
  for (const [segment, cluster] of clusters.entries()) {
    if (cluster.urls.size < MIN_PAGES_PER_CAMPUS) continue
    const signals: string[] = [`url_prefix(${cluster.urls.size} pages)`]
    if (hasSelectorCue) signals.push('campus_selector_landing')
    // Prefer the URL whose path looks like a home / index page if we
    // can find one (.../seg, .../seg/, .../seg/home).
    const sortedUrls = [...cluster.urls].sort((a, b) => {
      const score = (u: string) => {
        try {
          const path = new URL(u).pathname.replace(/\/$/, '')
          if (path.endsWith(`/${segment}`)) return 0
          if (path.endsWith(`/${segment}/home`)) return 1
          if (path.endsWith(`/${segment}/index`)) return 2
          return 10
        } catch { return 99 }
      }
      return score(a) - score(b)
    })
    candidates.push({
      slug:       segment,
      label:      humanizeSlug(segment),
      crawl_url:  sortedUrls[0] ?? null,
      page_count: cluster.urls.size,
      signals,
      sample_urls: sortedUrls.slice(0, 5),
    })
  }

  // Rank by page_count desc — more populated clusters are stronger
  // candidates. Selector-landing cue is a tiebreaker via signal count.
  candidates.sort((a, b) => b.page_count - a.page_count)

  return {
    candidates,
    has_campus_selector_landing: hasSelectorCue,
    total_pages_examined: crawlResults.length,
  }
}

/** Capitalize each hyphen-separated word: "south-west" → "South West". */
export function humanizeSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/** Persist confirmed campuses to strategy_web_projects.campuses.
 *  Returns the saved project on success.
 *
 *  v115 — when a completed crawl already exists for this project,
 *  fires crawl-categorize automatically so the existing topics
 *  re-partition into per-campus rows. Without this, staff would have
 *  to manually trigger a re-categorize after every campus confirmation
 *  (the "Doxology backfill" pattern). The trigger is fire-and-forget
 *  to keep the UI snappy; result is reflected on the inventory's next
 *  load. */
export async function saveCampuses(
  webProjectId: string,
  campuses: CampusDefinition[],
): Promise<{ ok: true; recategorize_triggered: boolean } | { ok: false; error: string }> {
  // Light validation: at most one primary; slugs unique; non-empty labels.
  const primaryCount = campuses.filter(c => c.primary).length
  if (primaryCount > 1) return { ok: false, error: 'Only one campus can be marked primary.' }
  const slugs = new Set<string>()
  for (const c of campuses) {
    if (!c.slug || !c.slug.trim()) return { ok: false, error: 'Every campus needs a slug.' }
    if (!c.label || !c.label.trim()) return { ok: false, error: 'Every campus needs a label.' }
    if (slugs.has(c.slug)) return { ok: false, error: `Duplicate slug "${c.slug}".` }
    slugs.add(c.slug)
  }
  // If no primary picked but there's at least one campus, default
  // the first one to primary so downstream gates don't see ambiguity.
  let finalCampuses = campuses
  if (campuses.length > 0 && primaryCount === 0) {
    finalCampuses = campuses.map((c, i) => ({ ...c, primary: i === 0 }))
  }
  const { error } = await supabase
    .from('strategy_web_projects')
    .update({ campuses: finalCampuses } as never)
    .eq('id', webProjectId)
  if (error) return { ok: false, error: error.message }

  // Auto-recategorize. If a completed crawl already exists, fire
  // crawl-categorize so its topics re-partition by campus. New crawls
  // (none yet completed) skip — the next crawl's normal pipeline will
  // pick up the new registry on its own.
  const recategorizeTriggered = await triggerRecategorizeIfCrawlExists(webProjectId)
  return { ok: true, recategorize_triggered: recategorizeTriggered }
}

/** Trigger the crawl-categorize edge function against the latest
 *  completed crawl for this project, if any. Returns true when a
 *  request was sent (regardless of edge-fn outcome). Fire-and-forget —
 *  errors are logged, never thrown. */
async function triggerRecategorizeIfCrawlExists(webProjectId: string): Promise<boolean> {
  try {
    const { data: job } = await supabase
      // @ts-expect-error — generic schema typing in this repo loses the 'web-hub' schema name
      .schema('web-hub')
      .from('crawl_jobs')
      .select('id, status, completed_at')
      .eq('project_id', webProjectId)
      .eq('status', 'complete')
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const jobId = (job as { id?: string } | null)?.id
    if (!jobId) return false
    const { data: sess } = await supabase.auth.getSession()
    const accessToken = sess?.session?.access_token
    const supabaseUrl = (import.meta as unknown as { env: { VITE_SUPABASE_URL: string } }).env.VITE_SUPABASE_URL
    if (!accessToken || !supabaseUrl) return false
    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type':  'application/json',
    }
    // Don't await — UI snaps closed; edge fns finish in background,
    // staff sees fresh partitions on next inventory load. Fire both
    // in parallel since they touch different tables.
    void fetch(`${supabaseUrl}/functions/v1/crawl-categorize`, {
      method:  'POST',
      headers,
      body: JSON.stringify({ project_id: webProjectId, crawl_job_id: jobId }),
    }).catch(err => console.warn('[saveCampuses] auto-recategorize fetch failed:', err))
    // Atomize also re-tags every atom's metadata.campus_slug from the
    // URL prefix, so the cowork pipeline can route per-campus atoms
    // without staff having to remember to re-run anything.
    void fetch(`${supabaseUrl}/functions/v1/atomize-crawl-into-atoms`, {
      method:  'POST',
      headers,
      body: JSON.stringify({ project_id: webProjectId }),
    }).catch(err => console.warn('[saveCampuses] auto-atomize fetch failed:', err))
    return true
  } catch (err) {
    console.warn('[saveCampuses] auto-recategorize lookup failed:', err)
    return false
  }
}

/** Update only the display-label customization fields. */
export async function saveCampusLabels(
  webProjectId: string,
  singular: string | null,
  plural: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase
    .from('strategy_web_projects')
    .update({
      campus_label_singular: singular?.trim() || null,
      campus_label_plural:   plural?.trim() || null,
    } as never)
    .eq('id', webProjectId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/** Convenience: read the project's display label or default to "Campus"
 *  / "Campuses". */
export function campusLabels(project: Pick<StrategyWebProject, 'campus_label_singular' | 'campus_label_plural'>): {
  singular: string
  plural:   string
} {
  return {
    singular: project.campus_label_singular || 'Campus',
    plural:   project.campus_label_plural   || 'Campuses',
  }
}

