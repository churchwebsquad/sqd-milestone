/**
 * Web Manager — Crawl workspace.
 *
 * Surfaces the Firecrawl results for this project: trigger source
 * (discovery vs AM handoff), URL, status, page count, and per-page
 * preview. Data lives in:
 *   web_crawl_intent   — fire records (one per project, idempotent)
 *   web-hub.crawl_jobs — actual results from the fire-crawl-trigger
 *                        edge function (existing table; untouched)
 *
 * No trigger UI here — the auto-trigger logic lives in v43_crawl_triggers
 * and the toggles live on the Settings tab. This tab is read-only
 * status + content viewer.
 */
import { useEffect, useState } from 'react'
import { Globe, Loader2, AlertTriangle, CheckCircle2, Play, FlaskConical, ExternalLink, Ban, RefreshCw } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { CrawlPageDetail, type CrawlPagePayload } from './CrawlPageDetail'
import type { StrategyWebProject } from '../../../types/database'

interface CrawlIntent {
  id:           string
  triggered_by: 'discovery' | 'am_handoff' | 'manual'
  trigger_value: string | null
  target_url:   string
  triggered_at: string
  fired_at:     string | null
}

interface CrawlJob {
  id:             string
  target_url:     string
  status:         string
  pages_crawled:  number
  pages_found:    number | null
  started_at:     string | null
  completed_at:   string | null
  duration_seconds: number | null
  error_message:  string | null
  crawl_results:  Array<{ url: string; title?: string; content?: string }> | null
}

interface Props {
  project: StrategyWebProject
}

export function CrawlWorkspace({ project }: Props) {
  const [intent, setIntent] = useState<CrawlIntent | null>(null)
  const [jobs, setJobs] = useState<CrawlJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null)
  const [defaultUrl, setDefaultUrl] = useState<string>('')
  const [manualUrl, setManualUrl] = useState<string>('')
  const [firing, setFiring] = useState(false)
  const [crawlExcluded, setCrawlExcluded] = useState<boolean>(false)
  const [togglingExclusion, setTogglingExclusion] = useState(false)
  // Watching state — set true after a fire so we poll for the
  // resulting crawl_jobs row. fire-crawl-trigger runs async, so the
  // RPC returns immediately but the job row + status updates land
  // seconds-to-minutes later. Auto-stops on terminal status.
  const [watching, setWatching] = useState(false)
  const [lastChecked, setLastChecked] = useState<Date | null>(null)
  // Manual-scrape state — N specific URLs through Firecrawl. Default
  // behavior commits to the project's crawl_jobs row; toggle the
  // "test scrape" checkbox to preview-only without DB writes.
  // crawl_deeper toggle additionally follows internal links from each
  // seed URL to pick up detail pages the seed crawl excluded.
  const [scrapeUrls, setScrapeUrls]               = useState<string>('')
  const [scrapeIsTest, setScrapeIsTest]           = useState<boolean>(false)
  const [scrapeCrawlDeeper, setScrapeCrawlDeeper] = useState<boolean>(false)
  const [scraping, setScraping]                   = useState(false)
  const [scrapeResults, setScrapeResults]         = useState<CrawlPagePayload[]>([])
  const [scrapeError, setScrapeError]             = useState<string | null>(null)
  const [scrapeDuration, setScrapeDuration]       = useState<number | null>(null)
  const [scrapeCommitted, setScrapeCommitted]     = useState<{ rows: number; crawl_job_id: string } | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    const [
      { data: intentRow, error: iErr },
      { data: jobRows, error: jErr },
      { data: progRow },
      { data: projRow },
    ] = await Promise.all([
      supabase.from('web_crawl_intent').select('*').eq('web_project_id', project.id).maybeSingle(),
      supabase.schema('web-hub').from('crawl_jobs').select('*').eq('project_id', project.id)
        .order('started_at', { ascending: false }),
      // Pull the church's site URL so the manual-fire input pre-fills.
      supabase.from('strategy_account_progress')
        .select('church_website').eq('member', project.member).maybeSingle(),
      // Pull the project's current crawl_excluded flag.
      supabase.from('strategy_web_projects')
        .select('crawl_excluded').eq('id', project.id).maybeSingle(),
    ])
    if (iErr) setError(iErr.message)
    if (jErr) setError(prev => prev ?? jErr.message)
    setIntent((intentRow as CrawlIntent | null) ?? null)
    setJobs((jobRows as CrawlJob[] | null) ?? [])
    const url = (progRow as { church_website: string | null } | null)?.church_website ?? ''
    setDefaultUrl(url)
    setManualUrl(prev => prev || url)
    setScrapeUrls(prev => prev || (url ? url : ''))
    setCrawlExcluded(Boolean((projRow as { crawl_excluded?: boolean } | null)?.crawl_excluded))
    setLastChecked(new Date())
    setLoading(false)
  }

  // Auto-poll while watching. Stops when the most recent crawl_jobs
  // row reaches a terminal status, or after a 6-minute timeout
  // (matches fire-crawl-trigger's 5-min poll budget + buffer).
  useEffect(() => {
    if (!watching) return
    const started = Date.now()
    const tick = async () => {
      await load()
    }
    const interval = window.setInterval(() => {
      const elapsed = Date.now() - started
      const latest = jobs[0]
      const terminal = latest?.status === 'complete' || latest?.status === 'failed'
      if (terminal || elapsed > 360000) {
        setWatching(false)
        return
      }
      void tick()
    }, 7000)
    return () => window.clearInterval(interval)
    // We intentionally don't react to `jobs` changes in this dep array
    // — the interval reads the latest closure value via `jobs[0]`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watching])

  // When a watched crawl hits a terminal state, surface the result
  // by running one final load and clearing the watch flag.
  useEffect(() => {
    if (!watching) return
    const latest = jobs[0]
    if (latest && (latest.status === 'complete' || latest.status === 'failed')) {
      setWatching(false)
    }
  }, [jobs, watching])

  const toggleExclusion = async () => {
    setTogglingExclusion(true)
    const next = !crawlExcluded
    const { error: err } = await supabase.rpc('web_crawl_set_excluded', {
      p_web_project_id: project.id,
      p_excluded:       next,
    })
    if (err) setError(err.message)
    else setCrawlExcluded(next)
    setTogglingExclusion(false)
  }

  const runManualScrape = async () => {
    setScraping(true)
    setScrapeError(null)
    setScrapeResults([])
    setScrapeDuration(null)
    setScrapeCommitted(null)
    // Parse one URL per line; ignore blanks + lines that start with `#`
    // so the strategist can paste a list with their own comments.
    const urls = scrapeUrls
      .split('\n')
      .map(s => s.trim())
      .filter(s => s && !s.startsWith('#'))
    if (urls.length === 0) {
      setScrapeError('Enter at least one URL (one per line)')
      setScraping(false)
      return
    }
    try {
      const requestBody: Record<string, unknown> = { urls }
      if (scrapeCrawlDeeper) {
        // Bounded depth so a strategist's "follow links" toggle can't
        // turn into a runaway: depth=1, max 10 pages per seed.
        requestBody.crawl_deeper = { max_depth: 1, max_pages: 10 }
      }
      if (!scrapeIsTest) {
        requestBody.commit = { project_id: project.id }
      }
      const { data, error: err } = await supabase.functions.invoke('manual-scrape', { body: requestBody })
      if (err) throw err
      const body = data as {
        ok?:        boolean
        duration?:  number
        pages?:     CrawlPagePayload[]
        committed?: { rows: number; crawl_job_id: string }
        error?:     string
        details?:   string
      }
      if (!body?.ok) {
        setScrapeError(body?.error || body?.details || 'Scrape failed')
      } else {
        setScrapeResults(Array.isArray(body.pages) ? body.pages : [])
        setScrapeDuration(body.duration ?? null)
        if (body.committed) setScrapeCommitted(body.committed)
        // Refresh the crawl_jobs view so the strategist sees the new
        // row count immediately when they committed.
        if (body.committed) void load()
      }
    } catch (err) {
      setScrapeError(err instanceof Error ? err.message : String(err))
    }
    setScraping(false)
  }

  useEffect(() => { void load() }, [project.id])

  const fireManualCrawl = async () => {
    setFiring(true)
    setError(null)
    const { data, error: err } = await supabase.rpc('web_crawl_fire_manual', {
      p_web_project_id: project.id,
      p_target_url:     manualUrl?.trim() || null,
    })
    if (err) {
      setError(err.message)
    } else if (data && !(data as { ok: boolean }).ok) {
      setError((data as { error: string }).error)
    } else {
      // Crawl is now running async in fire-crawl-trigger. Start
      // watching — the polling loop will refresh until a job row
      // lands and reaches a terminal status.
      await load()
      setWatching(true)
    }
    setFiring(false)
  }

  /** Re-crawl: wipe the current intent + any completion record, then
   *  fire a fresh run. Existing crawl_jobs rows are preserved as
   *  history (they keep their completed_at timestamp). */
  const fireRecrawl = async () => {
    if (!confirm('Re-crawl this site? The existing crawl will stay in history but a fresh run will start now.')) return
    setFiring(true)
    setError(null)
    const { data, error: err } = await supabase.rpc('web_crawl_recrawl', {
      p_web_project_id: project.id,
      p_target_url:     manualUrl?.trim() || null,
    })
    if (err) {
      setError(err.message)
    } else if (data && !(data as { ok: boolean }).ok) {
      setError((data as { error: string }).error)
    } else {
      await load()
      setWatching(true)
    }
    setFiring(false)
  }

  if (loading) {
    return (
      <div className="min-h-[200px] grid place-items-center text-wm-text-muted">
        <Loader2 className="animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
      <header>
        {/* items-center so the toggle vertically centers with the
            heading + description block. Previously items-baseline
            anchored to the H1's text-baseline, which put the toggle
            visually above the description text. */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-wm-text mb-1">Website Crawl</h1>
            <p className="text-[13px] text-wm-text-muted">
              Auto-fired when the discovery questionnaire or AM handoff
              signals a redesign. Toggle which signals fire from the
              Settings tab.
            </p>
          </div>
          <AutoCrawlSwitch
            on={!crawlExcluded}
            disabled={togglingExclusion}
            loading={togglingExclusion}
            onChange={toggleExclusion}
          />
        </div>
      </header>

      {crawlExcluded && (
        <div className="rounded-md border border-wm-warning/30 bg-wm-warning-bg p-3 flex items-start gap-2">
          <Ban size={14} className="text-wm-warning mt-0.5 shrink-0" />
          <div className="text-[12px] text-wm-text leading-snug">
            <p className="font-semibold mb-0.5">Auto-crawl is OFF for this project.</p>
            <p className="text-wm-text-muted">
              All existing churches were opted out by default to avoid burning
              Firecrawl credits on sites already curated manually. You can
              still trigger a one-shot crawl below — that's an explicit
              opt-in for this project only. Or flip the toggle above to
              re-enable auto-firing for future signal changes.
            </p>
          </div>
        </div>
      )}

      {/* Active watch banner — appears right after a fire/recrawl and
          stays until the latest crawl_jobs row reaches terminal
          status. Auto-polls every 7s; manual refresh available. */}
      {watching && (() => {
        const latest = jobs[0]
        const inProgress = latest?.status === 'in_progress' || latest?.status === 'queued'
        const progress = latest && latest.pages_found && latest.pages_found > 0
          ? `${latest.pages_crawled ?? 0}/${latest.pages_found}`
          : null
        return (
          <div className="rounded-xl border border-wm-accent/40 bg-wm-accent-tint/50 p-4 flex items-start gap-3">
            <Loader2 size={16} className="text-wm-accent animate-spin shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-wm-text">
                {inProgress
                  ? <>Crawl in progress…{progress ? <span className="font-mono ml-1">{progress} pages</span> : null}</>
                  : 'Waiting for crawl to start…'}
              </p>
              <p className="text-[11px] text-wm-text-muted leading-snug mt-0.5">
                {inProgress
                  ? 'Firecrawl is fetching pages. This page will refresh automatically every ~7 seconds and update when the run finishes.'
                  : 'Fire-crawl-trigger has been invoked. The crawl_jobs row should appear within a few seconds.'}
                {lastChecked && (
                  <span className="ml-1 text-wm-text-subtle">
                    Last checked {Math.max(0, Math.floor((Date.now() - lastChecked.getTime()) / 1000))}s ago.
                  </span>
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              className="shrink-0 inline-flex items-center gap-1 rounded-md border border-wm-accent/30 bg-wm-bg-elevated text-wm-accent text-[11px] font-semibold px-2.5 py-1 hover:bg-wm-bg-hover"
            >
              <RefreshCw size={11} />
              Refresh now
            </button>
          </div>
        )
      })()}

      {/* Terminal-state banner — surfaces briefly after a watch ends.
          The crawl just completed (or failed) and the UI below shows
          the new result; this gives the user a clear signal of state
          change rather than silent flip. */}
      {!watching && jobs[0] && jobs[0].status === 'complete' && lastChecked
        && Date.now() - lastChecked.getTime() < 15000 && (
        <div className="rounded-md border border-wm-success/20 bg-wm-success-bg p-3 flex items-start gap-2">
          <CheckCircle2 size={14} className="text-wm-success mt-0.5 shrink-0" />
          <p className="text-[12px] text-wm-text">
            <strong className="font-semibold">Crawl complete.</strong>{' '}
            {jobs[0].pages_crawled} pages captured in{' '}
            {jobs[0].duration_seconds != null
              ? jobs[0].duration_seconds < 60
                ? `${jobs[0].duration_seconds}s`
                : `${Math.round(jobs[0].duration_seconds / 60)}m`
              : 'a moment'}.
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-wm-danger/30 bg-wm-danger-bg p-3 flex items-start gap-2">
          <AlertTriangle size={14} className="text-wm-danger mt-0.5 shrink-0" />
          <p className="text-[12px] text-wm-text">{error}</p>
        </div>
      )}

      {/* Manual scrape — N specific URLs through Firecrawl. Default
          commits to crawl_jobs; the "test scrape" checkbox flips to
          preview-only. Use this when the full crawl missed pages and
          you want to add them without re-firing the whole crawl. */}
      <section className="rounded-xl border border-wm-accent/30 bg-wm-accent-tint/30 p-4 space-y-3">
        <div className="flex items-baseline gap-2">
          <FlaskConical size={14} className="text-wm-accent" />
          <div className="flex-1">
            <h2 className="text-[13px] font-bold text-wm-text">Manual scrape</h2>
            <p className="text-[11px] text-wm-text-muted">
              Paste up to 25 URLs (one per line). Pages get appended to this project's crawl results. Use this when the full crawl missed specific pages and you don't want to re-fire the whole thing.
            </p>
          </div>
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1.5">
            URLs (one per line)
          </label>
          <textarea
            value={scrapeUrls}
            onChange={e => setScrapeUrls(e.target.value)}
            rows={Math.min(8, Math.max(3, scrapeUrls.split('\n').length + 1))}
            placeholder={'https://themet.church/parent-path/\nhttps://themet.church/milestone-1\nhttps://themet.church/milestone-2\n# lines starting with # are ignored'}
            className="w-full rounded-md border border-wm-border bg-wm-bg-elevated px-3 py-2 text-[12px] font-mono text-wm-text outline-none focus:border-wm-accent focus:ring-2 focus:ring-wm-accent/15 leading-snug"
          />
        </div>
        <div className="flex flex-col gap-2">
          <label className="flex items-start gap-2 text-[12px] text-wm-text cursor-pointer">
            <input
              type="checkbox"
              checked={scrapeIsTest}
              onChange={e => setScrapeIsTest(e.target.checked)}
              className="mt-0.5 cursor-pointer"
            />
            <span>
              <span className="font-semibold">Make this a test scrape</span>
              <span className="text-wm-text-muted"> — preview the result before committing. Nothing gets written to this project's crawl results.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-[12px] text-wm-text cursor-pointer">
            <input
              type="checkbox"
              checked={scrapeCrawlDeeper}
              onChange={e => setScrapeCrawlDeeper(e.target.checked)}
              className="mt-0.5 cursor-pointer"
            />
            <span>
              <span className="font-semibold">Crawl deeper</span>
              <span className="text-wm-text-muted"> — also follow links found on these pages (depth 1, max 10 pages per seed). Useful when a parent page lists detail-page children the seed crawl excluded.</span>
            </span>
          </label>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={runManualScrape}
            disabled={scraping || scrapeUrls.trim().length === 0}
            className="inline-flex items-center gap-1.5 rounded-md bg-wm-accent text-white text-[12px] font-semibold px-4 py-2 hover:bg-wm-accent-hover transition-colors disabled:opacity-60 disabled:cursor-not-allowed shrink-0"
          >
            {scraping ? <Loader2 size={12} className="animate-spin" /> : <FlaskConical size={12} />}
            {scraping
              ? (scrapeCrawlDeeper ? 'Crawling…' : 'Scraping…')
              : (scrapeIsTest ? 'Preview scrape' : 'Scrape & save')}
          </button>
        </div>

        {scrapeError && (
          <div className="rounded-md border border-wm-danger/30 bg-wm-danger-bg p-2 flex items-start gap-2">
            <AlertTriangle size={11} className="text-wm-danger mt-0.5 shrink-0" />
            <p className="text-[11px] text-wm-text font-mono">{scrapeError}</p>
          </div>
        )}

        {scrapeCommitted && (
          <div className="rounded-md border border-wm-success/30 bg-wm-success-bg p-2 flex items-start gap-2">
            <CheckCircle2 size={11} className="text-wm-success mt-0.5 shrink-0" />
            <p className="text-[11px] text-wm-text">
              Committed {scrapeCommitted.rows} page{scrapeCommitted.rows === 1 ? '' : 's'} to crawl job {scrapeCommitted.crawl_job_id.slice(0, 8)}…
            </p>
          </div>
        )}

        {scrapeResults.length > 0 && (
          <div className="space-y-2">
            {scrapeDuration != null && (
              <p className="text-[10px] text-wm-text-muted">
                {scrapeResults.length} page{scrapeResults.length === 1 ? '' : 's'} in {scrapeDuration < 1000 ? `${scrapeDuration}ms` : `${(scrapeDuration / 1000).toFixed(1)}s`}
                {scrapeIsTest && ' · preview only — nothing saved'}
              </p>
            )}
            <div className="space-y-3">
              {scrapeResults.map((page, i) => (
                <CrawlPageDetail key={`${page.url}-${i}`} page={page} />
              ))}
            </div>
          </div>
        )}
      </section>


      {(!intent || (jobs.length === 0 && intent)) && (
        <div className="rounded-xl border border-wm-border bg-wm-bg-elevated p-5">
          <div className="text-center mb-4">
            {intent && jobs.length === 0 ? (
              <>
                <AlertTriangle className="mx-auto mb-2 text-wm-warning" size={28} />
                <p className="text-[13px] font-semibold text-wm-text mb-1">Stuck intent — no crawl job was created</p>
                <p className="text-[12px] text-wm-text-muted leading-relaxed max-w-md mx-auto">
                  The intent fired at {new Date(intent.triggered_at).toLocaleString()}, but
                  Firecrawl never received the request. This is the
                  pre-v49 auth bug. Click <em>Retry crawl</em> below — it'll
                  clear the stuck record and re-fire with the corrected
                  authentication.
                </p>
              </>
            ) : (
              <>
                <Globe className="mx-auto mb-2 text-wm-text-subtle" size={28} />
                <p className="text-[13px] font-semibold text-wm-text mb-1">No crawl has fired for this project</p>
                <p className="text-[12px] text-wm-text-muted leading-relaxed max-w-md mx-auto">
                  Crawls fire automatically when discovery or AM handoff
                  signals a redesign — or you can crawl now manually
                  (useful for older churches and missing-discovery cases).
                  Once fired, the auto-trigger won't re-fire for this project.
                </p>
              </>
            )}
          </div>
          <div className="max-w-lg mx-auto space-y-2">
            <label className="block text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">
              Target URL
              {defaultUrl && (
                <span className="ml-2 font-normal lowercase tracking-normal text-wm-text-muted">
                  (default pulled from the church record)
                </span>
              )}
            </label>
            <input
              type="url"
              value={manualUrl}
              onChange={e => setManualUrl(e.target.value)}
              placeholder="https://example.org"
              className="w-full rounded-md border border-wm-border bg-wm-bg-elevated px-3 py-2 text-[13px] font-mono text-wm-text outline-none focus:border-wm-accent focus:ring-2 focus:ring-wm-accent/15"
            />
            <button
              type="button"
              onClick={fireManualCrawl}
              disabled={firing || !manualUrl.trim()}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-wm-accent text-white text-[13px] font-semibold px-4 py-2 hover:bg-wm-accent-hover transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {firing
                ? <Loader2 size={13} className="animate-spin" />
                : (intent && jobs.length === 0 ? <RefreshCw size={13} /> : <Play size={13} />)}
              {firing
                ? 'Firing crawl…'
                : (intent && jobs.length === 0 ? 'Retry crawl' : 'Crawl now')}
            </button>
          </div>
        </div>
      )}

      {/* Hide the "Triggered by" success card when the intent is stuck
          (fired_at set but no crawl_job) — the retry card above already
          explains the state. Showing both was misleading. */}
      {intent && jobs.length > 0 && (
        <section className="rounded-xl border border-wm-border bg-wm-bg-elevated">
          <header className="px-4 py-3 border-b border-wm-border flex items-baseline justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Triggered by</p>
              <p className="text-[14px] font-semibold text-wm-text mt-0.5">
                {intent.triggered_by === 'discovery' && 'Discovery questionnaire'}
                {intent.triggered_by === 'am_handoff' && 'AM handoff'}
                {intent.triggered_by === 'manual'     && 'Manual fire'}
                {intent.trigger_value && (
                  <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded bg-wm-accent-tint text-wm-accent text-[10px] font-mono uppercase tracking-wider">
                    {intent.trigger_value.length > 40
                      ? intent.trigger_value.slice(0, 40) + '…'
                      : intent.trigger_value}
                  </span>
                )}
              </p>
            </div>
            <span className="text-[11px] text-wm-text-muted shrink-0">
              {new Date(intent.triggered_at).toLocaleString()}
            </span>
          </header>
          <div className="px-4 py-3 flex items-baseline gap-3 text-[12px]">
            <span className="text-wm-text-subtle uppercase tracking-widest text-[10px] font-bold">Target</span>
            <a
              href={intent.target_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-wm-accent hover:underline font-mono break-all"
            >
              {intent.target_url}
              <ExternalLink size={11} />
            </a>
          </div>
          <div className="px-4 py-2 text-[11px] text-wm-text-muted border-t border-wm-border">
            {intent.fired_at
              ? <>Fired {new Date(intent.fired_at).toLocaleString()}</>
              : <>Queued — call to fire-crawl-trigger has not completed yet.</>}
          </div>
        </section>
      )}

      {jobs.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <h2 className="text-[11px] uppercase tracking-widest font-bold text-wm-text-subtle">
              Crawl runs ({jobs.length})
            </h2>
            <button
              type="button"
              onClick={fireRecrawl}
              disabled={firing}
              className="inline-flex items-center gap-1.5 rounded-md border border-wm-border bg-wm-bg-elevated text-wm-text text-[11px] font-semibold px-2.5 py-1 hover:border-wm-accent hover:text-wm-accent transition-colors disabled:opacity-60"
              title="Wipe the current intent + start a fresh crawl. Existing runs stay in history."
            >
              {firing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
              Re-crawl
            </button>
          </div>
          {jobs.map(job => {
            // Sub-page chip: distinguish partner-triggered crawls
            // (Content Collection blog sub-form) and staff one-off
            // section crawls from the main site crawl. Compare the
            // job's target_url against the project's known site root
            // — when the path is deeper than "/", flag it.
            const sub = subPageLabelFor(job.target_url, defaultUrl)
            return (
            <article key={job.id} className="rounded-xl border border-wm-border bg-wm-bg-elevated overflow-hidden">
              <header className="px-4 py-3 flex items-baseline justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <StatusPill status={job.status} />
                    <span className="text-[12px] font-semibold text-wm-text">
                      {job.pages_crawled}/{job.pages_found ?? '?'} pages
                    </span>
                    {job.duration_seconds != null && (
                      <span className="text-[11px] text-wm-text-muted">
                        · {job.duration_seconds < 60
                            ? `${job.duration_seconds}s`
                            : `${Math.round(job.duration_seconds / 60)}m`}
                      </span>
                    )}
                    {sub && (
                      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold text-wm-accent bg-wm-accent-tint border border-wm-accent/30 rounded-full px-2 py-0.5"
                            title="This crawl targeted a specific path rather than the site root. Likely fired from the partner's Content Collection form (e.g. blog sub-crawl)."
                      >
                        {sub}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-wm-text-muted font-mono mt-0.5 break-all">
                    {job.target_url}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  {job.completed_at
                    ? <p className="text-[11px] text-wm-text-muted">Done {new Date(job.completed_at).toLocaleString()}</p>
                    : job.started_at
                      ? <p className="text-[11px] text-wm-text-muted">Started {new Date(job.started_at).toLocaleString()}</p>
                      : null}
                </div>
              </header>

              {job.error_message && (
                <div className="px-4 py-2 bg-wm-danger-bg border-t border-wm-danger/20 text-[11px] text-wm-danger flex items-start gap-2">
                  <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                  <span className="font-mono">{job.error_message}</span>
                </div>
              )}

              {Array.isArray(job.crawl_results) && job.crawl_results.length > 0 && (
                <CrawlJobPages
                  pages={job.crawl_results as CrawlPagePayload[]}
                  expanded={expandedJobId === job.id}
                  onToggle={() => setExpandedJobId(prev => prev === job.id ? null : job.id)}
                />
              )}
            </article>
            )
          })}
        </section>
      )}
    </div>
  )
}

/** Returns a short label when `targetUrl` points at a sub-page of the
 *  project's main site (path deeper than "/"), or null when it's the
 *  site root. Used by the crawl-jobs list to flag partner-triggered
 *  sub-crawls (notably the Content Collection blog sub-form). */
function subPageLabelFor(targetUrl: string, siteRoot: string): string | null {
  if (!targetUrl) return null
  let path = ''
  try {
    path = new URL(targetUrl).pathname.replace(/\/+$/, '')
  } catch { return null }
  if (!path || path === '/') return null
  // /blog, /blog/, /blog/posts → "Blog sub-crawl"
  if (/\/blog\b/i.test(path)) return 'Blog sub-crawl'
  // Compare against the site root path. If the same root, it's just a
  // section of that site — still flag as sub-page.
  if (siteRoot) {
    try {
      const rootPath = new URL(siteRoot).pathname.replace(/\/+$/, '')
      if (path !== rootPath && path.startsWith(rootPath || '/')) return 'Sub-page crawl'
    } catch { /* fall through */ }
  }
  return 'Sub-page crawl'
}

/** Sidebar-style page picker for a persisted crawl job, plus a
 *  detail panel showing the selected page in full. Mirrors the
 *  Test-scrape view so the rendering experience stays consistent. */
function CrawlJobPages({
  pages, expanded, onToggle,
}: {
  pages:    CrawlPagePayload[]
  expanded: boolean
  onToggle: () => void
}) {
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [filter, setFilter] = useState('')
  const filtered = filter.trim()
    ? pages.filter(p =>
        (p.url ?? '').toLowerCase().includes(filter.toLowerCase()) ||
        (p.title ?? '').toLowerCase().includes(filter.toLowerCase()))
    : pages
  const selected = filtered[selectedIdx] ?? filtered[0]

  return (
    <div className="border-t border-wm-border">
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-4 py-2 text-[12px] text-wm-text font-semibold hover:bg-wm-bg-hover transition-colors text-left"
      >
        {expanded ? '▾ Hide' : '▸ Show'} {pages.length} page{pages.length === 1 ? '' : 's'}
      </button>
      {expanded && (
        <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-3 p-4 bg-wm-bg/30">
          {/* Page list */}
          <aside className="space-y-2">
            <input
              type="search"
              value={filter}
              onChange={e => { setFilter(e.target.value); setSelectedIdx(0) }}
              placeholder={`Filter ${pages.length} page${pages.length === 1 ? '' : 's'}…`}
              className="w-full rounded-md border border-wm-border bg-wm-bg-elevated px-2.5 py-1.5 text-[11px] outline-none focus:border-wm-accent focus:ring-2 focus:ring-wm-accent/15"
            />
            <ul className="max-h-[600px] overflow-y-auto space-y-0.5 pr-1">
              {filtered.map((p, i) => {
                const isSel = i === selectedIdx
                return (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => setSelectedIdx(i)}
                      className={`w-full text-left rounded-md px-2.5 py-1.5 text-[11px] transition-colors ${
                        isSel
                          ? 'bg-wm-accent text-white'
                          : 'text-wm-text hover:bg-wm-bg-hover'
                      }`}
                    >
                      <div className={`font-semibold truncate ${isSel ? '' : 'text-wm-text'}`}>
                        {p.title || '(no title)'}
                      </div>
                      <div className={`text-[10px] font-mono truncate ${isSel ? 'text-white/80' : 'text-wm-text-subtle'}`}>
                        {pathOnly(p.url)}
                      </div>
                    </button>
                  </li>
                )
              })}
              {filtered.length === 0 && (
                <li className="text-[11px] italic text-wm-text-muted px-2 py-2">
                  No pages match "{filter}".
                </li>
              )}
            </ul>
          </aside>

          {/* Detail */}
          <div>
            {selected ? <CrawlPageDetail page={selected} /> : (
              <p className="text-[12px] text-wm-text-muted italic">
                Pick a page from the list.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function pathOnly(url: string): string {
  try {
    const u = new URL(url)
    return u.pathname + (u.search ?? '')
  } catch {
    return url
  }
}

/** Real-looking toggle for the project's `crawl_excluded` flag. A
 *  proper sliding switch is far more obvious than a pill — the
 *  visual state matches what every other on/off control on the web
 *  looks like, so there's no question it's clickable. */
function AutoCrawlSwitch({
  on, disabled, loading, onChange,
}: {
  on:       boolean
  disabled: boolean
  loading:  boolean
  onChange: () => void
}) {
  return (
    <div className="shrink-0 flex items-center gap-2.5">
      <div className="text-right">
        <p className={`text-[11px] font-bold uppercase tracking-widest ${on ? 'text-wm-success' : 'text-wm-text-muted'}`}>
          Auto-crawl {on ? 'on' : 'off'}
        </p>
        <p className="text-[10px] text-wm-text-subtle">
          {on ? 'fires on signal changes' : 'manual only'}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Auto-crawl for this project"
        onClick={onChange}
        disabled={disabled}
        className={`relative inline-flex items-center h-6 w-11 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-wm-accent focus-visible:ring-offset-2 focus-visible:ring-offset-wm-bg ${
          on ? 'bg-wm-success' : 'bg-wm-border'
        }`}
      >
        <span
          className={`inline-block w-5 h-5 rounded-full bg-white shadow-md transform transition-transform ${
            on ? 'translate-x-5' : 'translate-x-0.5'
          } flex items-center justify-center`}
        >
          {loading
            ? <Loader2 size={10} className="animate-spin text-wm-text-subtle" />
            : on ? <CheckCircle2 size={10} className="text-wm-success" />
                 : <Ban size={10} className="text-wm-text-subtle" />}
        </span>
      </button>
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const tone = status === 'complete' || status === 'completed' ? 'bg-wm-success-bg text-wm-success'
             : status === 'failed' ? 'bg-wm-danger-bg text-wm-danger'
             : 'bg-wm-accent-tint text-wm-accent'
  const Icon = status === 'complete' || status === 'completed' ? CheckCircle2
             : status === 'failed' ? AlertTriangle
             : Loader2
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-widest font-bold ${tone}`}>
      <Icon size={10} className={status === 'in_progress' || status === 'running' || status === 'queued' ? 'animate-spin' : ''} />
      {status}
    </span>
  )
}
