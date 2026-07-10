/**
 * Post-crawl processing shared between fire-crawl-trigger (legacy
 * polled mode) and firecrawl-webhook (v117 async-callback mode).
 *
 * Three concerns live here:
 *   1. Filter out pages Firecrawl returned but failed to scrape
 *      (statusCode >= 400 OR metadata.error set). Without this the
 *      error string ends up stored as page content and poisons every
 *      downstream consumer that reads markdown.
 *   2. Extract project-level snippets (social URLs, give URL, etc.)
 *      from the page corpus. These prefill strategy_web_projects
 *      columns (when empty) and create web_project_snippets entries
 *      so partner-facing inventory has scannable values.
 *   3. Map crawl-extracted snippet tokens to global columns vs custom
 *      project snippets (GLOBAL_TOKEN_MAP).
 *
 * Pure functions / no Deno-specific globals — both the polled flow
 * and the webhook flow import these unchanged.
 */

/** Token → strategy_web_projects column. Globals get fill-if-empty
 *  semantics; everything else lands in web_project_snippets. */
export const GLOBAL_TOKEN_MAP: Record<string, string> = {
  facebook_url:  'social_facebook_url',
  instagram_url: 'social_instagram_url',
  youtube_url:   'social_youtube_url',
  tiktok_url:    'social_tiktok_url',
}

export interface CrawlPage {
  url?:      string
  title?:    string
  markdown?: string
  content?:  string
  html?:     string
  links?:    string[]
  metadata?: {
    sourceURL?: string
    statusCode?: number
    error?:     string
    title?:     string
    proxyUsed?: string
  } & Record<string, unknown>
}

/** Returns true when Firecrawl marked the page as failed. */
export function isScrapeFailure(r: CrawlPage | null | undefined): boolean {
  const meta = r?.metadata
  if (!meta) return false
  const status = Number(meta.statusCode)
  if (Number.isFinite(status) && status >= 400) return true
  if (meta.error) return true
  return false
}

/** Reshape a raw Firecrawl page object into our canonical storage
 *  shape (url + title + markdown + html + links + metadata). */
export function normalizePage(r: CrawlPage): CrawlPage {
  return {
    url:       r.url || (r.metadata?.sourceURL ?? '') || '',
    title:     r.metadata?.title || '',
    markdown:  r.markdown || '',
    content:   r.markdown || '',
    html:      r.html || (r as { rawHtml?: string }).rawHtml || '',
    links:     Array.isArray(r.links) ? r.links : [],
    metadata:  r.metadata || {},
  }
}

interface SnippetRecord {
  token:       string
  label:       string
  expansion:   string
  description: string
  tags:        string[]
}

/** Extract project-level snippets from the page corpus. URL-pattern
 *  regex over the concatenated markdown + html of every page. First
 *  match wins per token. */
export function extractSnippets(pages: CrawlPage[], originUrl: string): SnippetRecord[] {
  const all = pages.map(p => `${p.markdown ?? ''}\n${p.html ?? ''}`).join('\n')
  const out: SnippetRecord[] = []
  const push = (token: string, label: string, value: string | null | undefined, tag: string) => {
    if (!value || value.length < 2) return
    if (out.some(r => r.token === token)) return
    out.push({ token, label, expansion: value, description: 'Auto-extracted from website crawl.', tags: [tag, 'auto'] })
  }
  const fu = (re: RegExp): string | null => {
    const m = all.match(re)
    return m ? m[0].replace(/[).,;]+$/, '') : null
  }
  push('facebook_url',  'Facebook URL',  fu(/https?:\/\/(?:www\.)?facebook\.com\/[\w\-./]+/i),  'social')
  push('instagram_url', 'Instagram URL', fu(/https?:\/\/(?:www\.)?instagram\.com\/[\w\-./]+/i), 'social')
  push('youtube_url',   'YouTube URL',   fu(/https?:\/\/(?:www\.)?youtube\.com\/(?:@[\w-.]+|channel\/[\w-]+|c\/[\w-]+)/i), 'social')
  push('tiktok_url',    'TikTok URL',    fu(/https?:\/\/(?:www\.)?tiktok\.com\/@[\w\-.]+/i),    'social')
  push('give_url',      'Giving URL',    fu(/https?:\/\/[\w\-./]*(?:give|giving|donate)[\w\-./?=&%#]*/i), 'actions')
  push('directions_url', 'Directions URL', fu(/https?:\/\/(?:www\.)?(?:google\.[a-z.]+\/maps|goo\.gl\/maps|maps\.app\.goo\.gl)\/[\w\-./?=&%#@,+]+/i), 'location')
  push('livestream_url', 'Livestream URL', fu(/https?:\/\/[\w-./]*(?:livestream|watch-live|live-stream|\/live\b)[\w-./?=&%#]*/i), 'actions')
  push('site_url',      'Public site URL', originUrl, 'site')
  return out
}

/** Persist extracted snippets: globals fill the strategy_web_projects
 *  row's matching column (only when currently empty); customs become
 *  web_project_snippets entries (only when the token isn't already
 *  present). */
export async function upsertSnippets(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: { from: (t: string) => any },  // deno-lint-ignore no-explicit-any
  projectId: string,
  snippets: SnippetRecord[],
): Promise<void> {
  const seen = new Set<string>()
  const globalFills: Record<string, string> = {}
  const customQueue: SnippetRecord[] = []
  for (const s of snippets) {
    if (!s?.token || !s?.expansion) continue
    if (seen.has(s.token)) continue
    seen.add(s.token)
    const col = GLOBAL_TOKEN_MAP[s.token]
    if (col) {
      if (!(col in globalFills)) globalFills[col] = s.expansion
    } else {
      customQueue.push(s)
    }
  }
  if (Object.keys(globalFills).length > 0) {
    const cols = Object.keys(globalFills)
    const { data: project } = await supabase
      .from('strategy_web_projects')
      .select(`id,${cols.join(',')}`)
      .eq('id', projectId)
      .maybeSingle()
    if (project) {
      const updates: Record<string, string> = {}
      for (const col of cols) {
        const cur = project[col]
        if (cur === null || cur === undefined || (typeof cur === 'string' && cur.trim() === '')) {
          updates[col] = globalFills[col]
        }
      }
      if (Object.keys(updates).length > 0) {
        await supabase.from('strategy_web_projects').update(updates).eq('id', projectId)
      }
    }
  }
  if (customQueue.length === 0) return
  const tokens = customQueue.map(s => s.token)
  const { data: existing } = await supabase
    .from('web_project_snippets')
    .select('token')
    .eq('web_project_id', projectId)
    .eq('archived', false)
    .in('token', tokens)
  const existingTokens = new Set((existing ?? []).map((r: { token: string }) => r.token))
  const rows = customQueue
    .filter(s => !existingTokens.has(s.token))
    .map(s => ({
      web_project_id: projectId,
      token:          s.token,
      label:          s.label,
      expansion:      s.expansion,
      description:    s.description,
      tags:           s.tags,
      source:         'crawl_prefill',
      archived:       false,
      used_count:     0,
    }))
  if (rows.length === 0) return
  await supabase.from('web_project_snippets').insert(rows)
}
