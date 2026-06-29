/**
 * URL Redirects — diff crawled (old site) URLs vs new sitemap pages,
 * propose redirects for the dev's WP redirect plugin.
 *
 * Read-only analyzer. Inputs:
 *   - web_project_topics.source_page_urls (raw crawl URLs per topic)
 *   - web_pages.slug + name + nav_group_label (new sitemap)
 *
 * Output is a flat list of redirect candidates the dev can review,
 * tweak, and export as CSV.
 */

export interface CrawlUrlRow {
  /** Full crawled URL as it appeared on the live site. */
  url:           string
  /** Just the path component, normalized (no protocol/host, no
   *  trailing slash unless it's just '/'). */
  path:          string
  /** The crawl topic this URL was filed under. */
  topic_key:     string
  /** Human label of that topic. */
  topic_label:   string
}

export interface SitemapPage {
  id:               string
  name:             string
  slug:             string
  nav_group_label:  string | null
}

export interface RedirectCandidate {
  /** Path on the old site (no domain). */
  from_path:       string
  /** Suggested slug on the new site, or null if no confident match. */
  to_slug:         string | null
  /** Why this target was suggested. */
  reason:          string
  /** 'exact' = old path already matches a new slug (no redirect needed).
   *  'high' = topic_key or slug stem matches a new page.
   *  'medium' = name fuzzy-matched a page.
   *  'low' = no candidate found, manual mapping required. */
  confidence:      'exact' | 'high' | 'medium' | 'low'
  /** The originating crawl topic — useful for the dev to see which
   *  content area this URL belonged to. */
  topic_key:       string
  topic_label:     string
}

/** Extract the path component of a URL. Returns '/' for the bare host. */
export function urlToPath(raw: string): string {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) return ''
  try {
    const u = new URL(trimmed.startsWith('http') ? trimmed : `https://example.com${trimmed.startsWith('/') ? '' : '/'}${trimmed}`)
    let path = u.pathname || '/'
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
    return path
  } catch {
    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  }
}

/** Normalize a slug or path for comparison: lowercase, leading slash,
 *  no trailing slash, kebab-case-ish only. */
export function normalizeForCompare(s: string): string {
  let v = String(s ?? '').trim().toLowerCase()
  if (!v) return ''
  if (!v.startsWith('/')) v = `/${v}`
  if (v.length > 1 && v.endsWith('/')) v = v.slice(0, -1)
  return v
}

/** Last segment of a path, or '' for '/'. */
function tailSegment(path: string): string {
  const norm = normalizeForCompare(path)
  if (norm === '/' || norm === '') return ''
  return norm.split('/').filter(Boolean).pop() ?? ''
}

/** Tokens of a path for fuzzy compare — splits on slashes + hyphens. */
function pathTokens(path: string): Set<string> {
  return new Set(
    normalizeForCompare(path).split(/[/\-_]+/).filter(t => t.length > 1)
  )
}

/** Score the overlap between two token sets (0..1). */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersect = 0
  for (const t of a) if (b.has(t)) intersect++
  return intersect / (a.size + b.size - intersect)
}

/** Build the redirect diff. Pure function — no DB calls. */
export function buildRedirectDiff(
  crawlUrls: CrawlUrlRow[],
  pages:     SitemapPage[],
): RedirectCandidate[] {
  if (crawlUrls.length === 0) return []

  // De-dup crawl paths up front — many topics share the same
  // source URL ("/about" appears under leadership AND mission topics).
  const byPath = new Map<string, CrawlUrlRow>()
  for (const row of crawlUrls) {
    if (!row.path || row.path === '/') continue  // skip the homepage
    if (!byPath.has(row.path)) byPath.set(row.path, row)
  }

  const slugIndex = new Map<string, SitemapPage>()
  for (const p of pages) slugIndex.set(normalizeForCompare(p.slug), p)
  const slugTails = new Map<string, SitemapPage>()
  for (const p of pages) {
    const tail = tailSegment(p.slug)
    if (tail && !slugTails.has(tail)) slugTails.set(tail, p)
  }

  const out: RedirectCandidate[] = []
  for (const row of byPath.values()) {
    const fromNorm = normalizeForCompare(row.path)
    const fromTail = tailSegment(row.path)
    const fromTokens = pathTokens(row.path)

    // Tier 1 — exact slug match. No redirect needed but keep it visible
    // so the dev can confirm it's intentional.
    const exact = slugIndex.get(fromNorm)
    if (exact) {
      out.push({
        from_path:    row.path,
        to_slug:      exact.slug,
        reason:       'Exact match — no redirect needed',
        confidence:   'exact',
        topic_key:    row.topic_key,
        topic_label:  row.topic_label,
      })
      continue
    }

    // Tier 2 — topic_key matches a new slug (or its tail).
    if (row.topic_key) {
      const tk = normalizeForCompare(row.topic_key.replace(/_/g, '-'))
      const tkTail = tailSegment(tk)
      const byTopicSlug = slugIndex.get(tk) || (tkTail ? slugTails.get(tkTail) : null)
      if (byTopicSlug) {
        out.push({
          from_path:    row.path,
          to_slug:      byTopicSlug.slug,
          reason:       `Topic key "${row.topic_key}" maps to /${byTopicSlug.slug}`,
          confidence:   'high',
          topic_key:    row.topic_key,
          topic_label:  row.topic_label,
        })
        continue
      }
    }

    // Tier 3 — tail-segment match (/kids-ministry → /kids if /kids exists).
    if (fromTail) {
      const byTail = slugTails.get(fromTail)
      if (byTail) {
        out.push({
          from_path:    row.path,
          to_slug:      byTail.slug,
          reason:       `Path tail "${fromTail}" matches new page /${byTail.slug}`,
          confidence:   'high',
          topic_key:    row.topic_key,
          topic_label:  row.topic_label,
        })
        continue
      }
    }

    // Tier 4 — token overlap. Pick the highest-scoring page above a
    // floor; require ≥2 shared tokens OR a single >5-char token match.
    let bestScore = 0
    let bestPage: SitemapPage | null = null
    let bestShared = 0
    for (const p of pages) {
      const pTokens = pathTokens(p.slug)
      const score = jaccard(fromTokens, pTokens)
      let shared = 0
      for (const t of fromTokens) if (pTokens.has(t)) shared++
      if (score > bestScore && (shared >= 2 || (shared === 1 && Array.from(fromTokens).some(t => pTokens.has(t) && t.length > 5)))) {
        bestScore = score
        bestPage = p
        bestShared = shared
      }
    }
    if (bestPage && bestScore >= 0.25) {
      out.push({
        from_path:    row.path,
        to_slug:      bestPage.slug,
        reason:       `Fuzzy match (${bestShared} shared token${bestShared === 1 ? '' : 's'}, score ${bestScore.toFixed(2)})`,
        confidence:   'medium',
        topic_key:    row.topic_key,
        topic_label:  row.topic_label,
      })
      continue
    }

    // Tier 5 — no confident target. Dev decides.
    out.push({
      from_path:    row.path,
      to_slug:      null,
      reason:       'No confident match — needs manual mapping',
      confidence:   'low',
      topic_key:    row.topic_key,
      topic_label:  row.topic_label,
    })
  }

  // Sort: exact first, then high → medium → low. Within each, alpha.
  const order: Record<RedirectCandidate['confidence'], number> = {
    exact: 0, high: 1, medium: 2, low: 3,
  }
  out.sort((a, b) =>
    (order[a.confidence] - order[b.confidence]) ||
    a.from_path.localeCompare(b.from_path),
  )
  return out
}

/** Render the candidate list as a CSV for the dev's WP redirect plugin
 *  (Redirection, Rank Math, Yoast Premium all accept "from,to" CSV).
 *  Includes a "needs manual mapping" placeholder for low-confidence
 *  rows so the dev sees them in the import and fills them in. */
export function redirectsToCsv(candidates: RedirectCandidate[]): string {
  const rows = ['source,target,confidence,topic,reason']
  for (const c of candidates) {
    // 'exact' rows aren't redirects — the URL is unchanged. Skip them
    // from the CSV but keep them in the UI for confirmation.
    if (c.confidence === 'exact') continue
    const target = c.to_slug ? `/${c.to_slug}` : '/<TODO_FILL_ME_IN>'
    const reason = c.reason.replace(/"/g, '""')
    const topic  = c.topic_label.replace(/"/g, '""')
    rows.push(`"${c.from_path}","${target}",${c.confidence},"${topic}","${reason}"`)
  }
  return rows.join('\n')
}
