/**
 * Web Manager — Add Page modal.
 *
 * Three modes:
 *   1. Manual — name + slug, creates an empty page (the original flow).
 *   2. From crawl — paste a URL; the import-from-url endpoint scrapes
 *      it via Firecrawl, segments the markdown into cowork-shape
 *      sections (hero + long prose + auto-extracted CTAs), binds each
 *      through the schema-driven binder, and inserts the page + sections
 *      in one shot.
 *   3. From cowork — pick from page drafts the cowork pipeline has
 *      written (roadmap_state.page_drafts). Calls page-bind to
 *      materialize one draft into web_pages + web_sections. Lets the
 *      strategist add a page the cowork pipeline already wrote without
 *      committing the entire pipeline.
 *
 * Slug derives from the URL's last path segment ("/give/future-fund" →
 * "future-fund") so the new page matches the partner's current site
 * verbatim — the strategist can override before importing if needed.
 */
import { useEffect, useMemo, useState } from 'react'
import { Loader2, Search, FileText } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { WMButton } from './Button'
import { WMSegmentedToggle } from './SegmentedToggle'
import type { WebPage } from '../../types/database'

interface Props {
  projectId: string
  phase: string
  existingPages: WebPage[]
  onClose: () => void
  onCreated: () => Promise<void>
}

type Mode = 'manual' | 'crawl' | 'cowork'

export function AddPageModal({ projectId, phase, existingPages, onClose, onCreated }: Props) {
  const [mode, setMode] = useState<Mode>('manual')

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-wm-text/30 backdrop-blur-[1px] animate-wm-fade-in"
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-wm-bg-elevated rounded-lg border border-wm-border shadow-2xl w-full max-w-lg p-5 animate-wm-slide-in-up"
      >
        <h3 className="text-[15px] font-semibold text-wm-text mb-1">Add page</h3>
        <p className="text-[12px] text-wm-text-muted mb-3">
          Phase: <span className="font-semibold text-wm-text">{phase}</span>
        </p>
        <div className="mb-4">
          <WMSegmentedToggle<Mode>
            active={mode}
            onChange={setMode}
            options={[
              { key: 'manual', label: 'Manual' },
              { key: 'crawl',  label: 'From crawl' },
              { key: 'cowork', label: 'From cowork' },
            ]}
            size="sm"
          />
        </div>
        {mode === 'manual' && <ManualForm projectId={projectId} phase={phase} existingPages={existingPages} onClose={onClose} onCreated={onCreated} />}
        {mode === 'crawl'  && <CrawlForm  projectId={projectId} phase={phase} existingPages={existingPages} onClose={onClose} onCreated={onCreated} />}
        {mode === 'cowork' && <CoworkForm projectId={projectId} phase={phase} existingPages={existingPages} onClose={onClose} onCreated={onCreated} />}
      </div>
    </div>
  )
}

// ── Manual mode (original behavior) ────────────────────────────────────

function ManualForm({ projectId, phase, existingPages, onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleNameChange = (v: string) => {
    setName(v)
    if (!slug || slug === toSlug(name)) setSlug(toSlug(v))
  }

  const save = async () => {
    setError(null)
    if (!name.trim() || !slug.trim()) { setError('Name and slug are required.'); return }
    if (existingPages.some(p => p.slug === slug.trim())) {
      setError(`Slug "${slug}" is already in use on this project.`); return
    }
    setSaving(true)
    const maxOrder = existingPages.filter(p => p.phase === phase).reduce((m, p) => Math.max(m, p.sort_order), 0)
    const { error: insertErr } = await supabase.from('web_pages').insert({
      web_project_id: projectId,
      name: name.trim(),
      slug: slug.trim(),
      phase,
      sort_order: maxOrder + 1,
    })
    setSaving(false)
    if (insertErr) { setError(insertErr.message); return }
    await onCreated()
  }

  return (
    <>
      <div className="space-y-3">
        <div>
          <label className="block text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">Page name</label>
          <input
            type="text"
            value={name}
            onChange={e => handleNameChange(e.target.value)}
            autoFocus
            placeholder="e.g. Plan a Visit"
            className="w-full h-9 rounded-md bg-wm-bg border border-wm-border px-3 text-sm text-wm-text outline-none focus:border-wm-border-focus focus:ring-2 focus:ring-wm-border-focus/20"
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">Slug</label>
          <div className="flex items-center gap-1">
            <span className="text-sm text-wm-text-subtle">/</span>
            <input
              type="text"
              value={slug}
              onChange={e => setSlug(toSlug(e.target.value))}
              placeholder="plan-a-visit"
              className="flex-1 h-9 rounded-md bg-wm-bg border border-wm-border px-3 text-sm text-wm-text outline-none focus:border-wm-border-focus focus:ring-2 focus:ring-wm-border-focus/20"
            />
          </div>
        </div>
        {error && <p className="text-[12px] text-wm-danger">{error}</p>}
      </div>
      <div className="mt-5 flex items-center justify-end gap-2">
        <WMButton variant="ghost" size="sm" onClick={onClose}>Cancel</WMButton>
        <WMButton variant="primary" size="sm" loading={saving} onClick={save}>Create page</WMButton>
      </div>
    </>
  )
}

// ── Crawl mode ─────────────────────────────────────────────────────────

interface CrawlResult {
  ok: true
  page_id: string
  slug: string
  name: string
  sections: Array<{ sort_order: number; content_template_id: string; bind_quality: 'perfect' | 'partial'; gaps_count: number }>
}

function CrawlForm({ projectId, phase, existingPages, onClose, onCreated }: Props) {
  const [url, setUrl] = useState('')
  const [slugOverride, setSlugOverride] = useState('')
  const [nameOverride, setNameOverride] = useState('')
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CrawlResult | null>(null)

  const derivedSlug = url ? slugFromUrl(url) : ''
  const effectiveSlug = slugOverride.trim() || derivedSlug
  const slugCollision = effectiveSlug && existingPages.some(p => p.slug === effectiveSlug)

  const runImport = async () => {
    setError(null)
    if (!url.trim()) { setError('URL is required.'); return }
    if (!/^https?:\/\//i.test(url.trim())) { setError('URL must start with http:// or https://'); return }
    if (slugCollision) { setError(`Slug "${effectiveSlug}" is already in use on this project.`); return }

    setImporting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) { setError('Not authenticated.'); setImporting(false); return }

      const res = await fetch('/api/web/pages/import-from-url', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          project_id: projectId,
          url:        url.trim(),
          phase,
          slug:       slugOverride.trim() || undefined,
          name:       nameOverride.trim() || undefined,
        }),
      })
      const body = await res.json()
      if (!res.ok || !body.ok) {
        setError(body.error ? `${body.error}${body.detail ? ': ' + body.detail : ''}` : 'Import failed.')
        setImporting(false)
        return
      }
      setResult(body as CrawlResult)
      setImporting(false)
      await onCreated()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      setImporting(false)
    }
  }

  if (result) {
    const perfect = result.sections.filter(s => s.bind_quality === 'perfect').length
    return (
      <>
        <div className="space-y-2">
          <p className="text-[13px] text-wm-text">
            <span className="font-semibold">{result.name}</span> imported as
            <code className="ml-1 px-1.5 py-0.5 rounded bg-wm-bg text-wm-text-muted">/{result.slug}</code>
          </p>
          <p className="text-[12px] text-wm-text-muted">
            {result.sections.length} section{result.sections.length === 1 ? '' : 's'} created —
            {' '}{perfect} perfect bind, {result.sections.length - perfect} partial.
          </p>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <WMButton variant="primary" size="sm" onClick={onClose}>Done</WMButton>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="space-y-3">
        <div>
          <label className="block text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">URL to import</label>
          <input
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            autoFocus
            placeholder="https://arvadavineyard.org/future-fund"
            className="w-full h-9 rounded-md bg-wm-bg border border-wm-border px-3 text-sm text-wm-text outline-none focus:border-wm-border-focus focus:ring-2 focus:ring-wm-border-focus/20"
          />
          <p className="mt-1 text-[11px] text-wm-text-muted">
            Firecrawl will scrape the page; we segment + bind it into a Brixies page with the original copy preserved verbatim. Images are skipped.
          </p>
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">Slug</label>
          <div className="flex items-center gap-1">
            <span className="text-sm text-wm-text-subtle">/</span>
            <input
              type="text"
              value={slugOverride}
              onChange={e => setSlugOverride(toSlug(e.target.value))}
              placeholder={derivedSlug || 'derived-from-url'}
              className="flex-1 h-9 rounded-md bg-wm-bg border border-wm-border px-3 text-sm text-wm-text outline-none focus:border-wm-border-focus focus:ring-2 focus:ring-wm-border-focus/20"
            />
          </div>
          {derivedSlug && !slugOverride && (
            <p className="mt-1 text-[11px] text-wm-text-muted">
              Defaults to <code className="text-wm-text">/{derivedSlug}</code> (URL's last path segment).
            </p>
          )}
          {slugCollision && (
            <p className="mt-1 text-[12px] text-wm-danger">
              Slug "{effectiveSlug}" already in use on this project.
            </p>
          )}
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">Page name (optional)</label>
          <input
            type="text"
            value={nameOverride}
            onChange={e => setNameOverride(e.target.value)}
            placeholder="Defaults to the page's H1"
            className="w-full h-9 rounded-md bg-wm-bg border border-wm-border px-3 text-sm text-wm-text outline-none focus:border-wm-border-focus focus:ring-2 focus:ring-wm-border-focus/20"
          />
        </div>
        {error && <p className="text-[12px] text-wm-danger">{error}</p>}
      </div>
      <div className="mt-5 flex items-center justify-end gap-2">
        <WMButton variant="ghost" size="sm" onClick={onClose}>Cancel</WMButton>
        <WMButton variant="primary" size="sm" loading={importing} onClick={runImport}>
          {importing ? 'Crawling…' : 'Import page'}
        </WMButton>
      </div>
    </>
  )
}

// ── Cowork mode ────────────────────────────────────────────────────────

interface CoworkDraft {
  slug:         string
  /** Friendly display name. Pulled from the draft's hero section first
   *  (Cowork outlines write the page H1 there), then from the sitemap
   *  page entry, then from the slug as a last resort. */
  name:         string
  sectionCount: number
  /** ISO timestamp of the most recent draft-related _meta entry on
   *  this slug. Used to sort newest-first. */
  updatedAt:    string | null
  /** Short preview pulled from the first text-ish slot in the first
   *  body section. Helps the strategist confirm "yes, this is the
   *  page I'm looking for" without opening it. */
  preview:      string
}

function CoworkForm({ projectId, phase, existingPages, onClose, onCreated }: Props) {
  const [loading,  setLoading]  = useState(true)
  const [drafts,   setDrafts]   = useState<CoworkDraft[]>([])
  const [query,    setQuery]    = useState('')
  const [binding,  setBinding]  = useState<string | null>(null)
  const [error,    setError]    = useState<string | null>(null)
  const [result,   setResult]   = useState<{ slug: string; name: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      const { data, error: err } = await supabase
        .from('strategy_web_projects')
        .select('roadmap_state')
        .eq('id', projectId)
        .maybeSingle()
      if (cancelled) return
      if (err) { setError(err.message); setLoading(false); return }
      const state = (data?.roadmap_state ?? {}) as Record<string, unknown>
      const pageDrafts = (state.page_drafts ?? {}) as Record<string, unknown>
      const stage2     = (state.stage_2     ?? {}) as Record<string, unknown>
      const sitemap    = (stage2.sitemap as Record<string, unknown> | undefined)
        ?? (stage2 as Record<string, unknown>)
      const sitemapPages = Array.isArray((sitemap as { pages?: unknown[] })?.pages)
        ? ((sitemap as { pages?: unknown[] }).pages as Array<{ slug?: string; name?: string; label?: string }>)
        : []
      const sitemapBySlug = new Map<string, { name?: string; label?: string }>()
      for (const p of sitemapPages) if (p?.slug) sitemapBySlug.set(p.slug, p)

      const existingSlugs = new Set(existingPages.map(p => p.slug))
      const out: CoworkDraft[] = []
      for (const [slug, raw] of Object.entries(pageDrafts)) {
        if (slug === '_meta') continue
        if (existingSlugs.has(slug)) continue
        const draft     = raw as Record<string, unknown>
        const sections  = Array.isArray(draft.sections) ? (draft.sections as Array<Record<string, unknown>>) : []
        const sitemapInfo = sitemapBySlug.get(slug)
        const name = pickName(draft, sitemapInfo, slug)
        const preview = pickPreview(sections)
        const meta = (draft._meta as { generated_at?: string } | undefined) ?? undefined
        out.push({
          slug,
          name,
          sectionCount: sections.length,
          updatedAt:    meta?.generated_at ?? null,
          preview,
        })
      }
      out.sort((a, b) => {
        // Newest drafts first; unknown timestamps to the bottom.
        if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt)
        if (a.updatedAt) return -1
        if (b.updatedAt) return 1
        return a.name.localeCompare(b.name)
      })
      setDrafts(out)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [projectId, existingPages])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return drafts
    return drafts.filter(d =>
      d.name.toLowerCase().includes(q)
      || d.slug.toLowerCase().includes(q)
      || d.preview.toLowerCase().includes(q),
    )
  }, [drafts, query])

  const bindOne = async (slug: string, name: string) => {
    setBinding(slug); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) { setError('Not authenticated.'); setBinding(null); return }

      // Ensure the slug is in stage_2.sitemap.pages BEFORE calling
      // page-bind. The bind agent refuses unknown slugs — its
      // expectation is that every bind has a sitemap entry to draw
      // title + phase from. Adding from cowork is an implicit approval
      // of this page; we append the sitemap entry on the strategist's
      // behalf so they don't have to pre-edit the sitemap.
      const { data: projRow, error: readErr } = await supabase
        .from('strategy_web_projects')
        .select('roadmap_state')
        .eq('id', projectId)
        .maybeSingle()
      if (readErr) { setError(`Could not read project state: ${readErr.message}`); setBinding(null); return }
      const roadmap = ((projRow?.roadmap_state ?? {}) as Record<string, unknown>)
      const stage2  = ((roadmap.stage_2 ?? {}) as Record<string, unknown>)
      // stage_2 has two historical shapes — { sitemap: { pages: [...] } }
      // and { pages: [...] } directly. Update whichever exists; if
      // neither, create the modern shape.
      const sitemap = (stage2.sitemap as Record<string, unknown> | undefined)
      const nestedPages = Array.isArray((sitemap as { pages?: unknown[] })?.pages)
        ? ((sitemap as { pages?: unknown[] }).pages as Array<Record<string, unknown>>)
        : null
      const flatPages = Array.isArray((stage2 as { pages?: unknown[] }).pages)
        ? ((stage2 as { pages?: unknown[] }).pages as Array<Record<string, unknown>>)
        : null
      const currentPages = nestedPages ?? flatPages ?? []
      const alreadyInSitemap = currentPages.some(p => typeof p?.slug === 'string' && p.slug === slug)
      if (!alreadyInSitemap) {
        const newEntry: Record<string, unknown> = {
          slug,
          name,
          title: name,
          phase,
          rationale: 'Added from cowork via the Pages tab.',
          source: 'cowork_import',
        }
        const nextPages = [...currentPages, newEntry]
        const nextStage2: Record<string, unknown> = nestedPages
          ? { ...stage2, sitemap: { ...(sitemap ?? {}), pages: nextPages } }
          : flatPages
            ? { ...stage2, pages: nextPages }
            : { ...stage2, sitemap: { pages: nextPages } }
        const { error: updErr } = await supabase
          .from('strategy_web_projects')
          .update({ roadmap_state: { ...roadmap, stage_2: nextStage2 } })
          .eq('id', projectId)
        if (updErr) { setError(`Could not append to sitemap: ${updErr.message}`); setBinding(null); return }
      }

      const res = await fetch('/api/web/agents/page-bind', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ projectId, pageSlug: slug }),
      })
      const body = await res.json().catch(() => ({} as Record<string, unknown>))
      if (!res.ok) {
        const detail = typeof body.error === 'string' ? body.error
                     : typeof body.detail === 'string' ? body.detail
                     : `HTTP ${res.status}`
        setError(`Bind failed: ${detail}`); setBinding(null); return
      }
      // page-bind writes the row into web_pages + web_sections; but the
      // new page may have come in under a different `phase` than the
      // current modal phase. Make sure it lands in this phase so the
      // strategist sees it where they clicked Add.
      await supabase.from('web_pages').update({ phase }).eq('web_project_id', projectId).eq('slug', slug)
      setResult({ slug, name })
      setBinding(null)
      await onCreated()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBinding(null)
    }
  }

  if (result) {
    return (
      <>
        <div className="space-y-2">
          <p className="text-[13px] text-wm-text">
            <span className="font-semibold">{result.name}</span> bound from cowork as
            <code className="ml-1 px-1.5 py-0.5 rounded bg-wm-bg text-wm-text-muted">/{result.slug}</code>
          </p>
          <p className="text-[12px] text-wm-text-muted">
            Sections written from the cowork draft. Open the page to review + edit.
          </p>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <WMButton variant="primary" size="sm" onClick={onClose}>Done</WMButton>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="space-y-3">
        <p className="text-[12px] text-wm-text-muted">
          Pick a page the cowork pipeline already wrote. Only drafts that aren't already on this project show up here.
        </p>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-wm-text-subtle pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
            placeholder="Search by page title, slug, or preview…"
            className="w-full h-9 rounded-md bg-wm-bg border border-wm-border pl-8 pr-3 text-sm text-wm-text outline-none focus:border-wm-border-focus focus:ring-2 focus:ring-wm-border-focus/20"
          />
        </div>

        {loading && (
          <div className="py-6 grid place-items-center text-wm-text-muted">
            <Loader2 size={16} className="animate-spin" />
          </div>
        )}

        {!loading && drafts.length === 0 && (
          <div className="rounded-md border border-dashed border-wm-border bg-wm-bg p-5 text-center">
            <p className="text-[13px] font-semibold text-wm-text">No cowork drafts available</p>
            <p className="text-[11.5px] text-wm-text-muted mt-1">
              Run the cowork pipeline (Content Engine tab) to draft pages. They'll show up here for one-off import.
            </p>
          </div>
        )}

        {!loading && drafts.length > 0 && filtered.length === 0 && (
          <p className="text-[11.5px] text-wm-text-muted italic px-1">No drafts match "{query}".</p>
        )}

        {!loading && filtered.length > 0 && (
          <ul className="max-h-72 overflow-y-auto -mx-1 rounded-md border border-wm-border bg-wm-bg-elevated">
            {filtered.map(d => (
              <li key={d.slug} className="border-b border-wm-border last:border-b-0">
                <button
                  type="button"
                  disabled={!!binding}
                  onClick={() => void bindOne(d.slug, d.name)}
                  className="w-full text-left px-3 py-2 hover:bg-wm-bg-hover transition-colors disabled:opacity-50"
                >
                  <div className="flex items-start gap-2.5">
                    <FileText size={13} className="text-wm-text-muted shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-3 flex-wrap">
                        <p className="text-[13px] font-semibold text-wm-text truncate">{d.name}</p>
                        <code className="text-[11px] font-mono text-wm-text-muted shrink-0">/{d.slug}</code>
                      </div>
                      <p className="text-[11px] text-wm-text-muted mt-0.5">
                        {d.sectionCount} section{d.sectionCount === 1 ? '' : 's'}
                        {d.updatedAt && <> · drafted {new Date(d.updatedAt).toLocaleDateString()}</>}
                      </p>
                      {d.preview && (
                        <p className="text-[11.5px] text-wm-text/85 mt-1 line-clamp-2 italic">
                          "{d.preview}"
                        </p>
                      )}
                    </div>
                    {binding === d.slug && (
                      <Loader2 size={12} className="animate-spin text-wm-accent shrink-0 mt-0.5" />
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}

        {error && <p className="text-[12px] text-wm-danger">{error}</p>}
      </div>
      <div className="mt-5 flex items-center justify-end gap-2">
        <WMButton variant="ghost" size="sm" onClick={onClose}>Cancel</WMButton>
      </div>
    </>
  )
}

/** Pick the best display name for a cowork draft. Priority:
 *  1. First section's `heading` slot value (cowork outline-page writes
 *     the page H1 there).
 *  2. Sitemap entry's `name` / `label`.
 *  3. The slug itself, prettified ("plan-a-visit" → "Plan A Visit"). */
function pickName(
  draft: Record<string, unknown>,
  sitemapInfo: { name?: string; label?: string } | undefined,
  slug: string,
): string {
  const sections = Array.isArray(draft.sections) ? (draft.sections as Array<Record<string, unknown>>) : []
  for (const sec of sections) {
    const values = (sec.values as Record<string, unknown> | undefined) ?? {}
    const heading = typeof values.heading === 'string' ? values.heading.trim() : ''
    if (heading) return heading
  }
  if (sitemapInfo?.name)  return sitemapInfo.name
  if (sitemapInfo?.label) return sitemapInfo.label
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

/** First non-heading text we can find — typically the hero
 *  description or first body paragraph. Capped at ~140 chars. */
function pickPreview(sections: Array<Record<string, unknown>>): string {
  const NON_HEADING_SLOTS = ['description', 'eyebrow', 'body', 'tagline', 'paragraph']
  for (const sec of sections) {
    const values = (sec.values as Record<string, unknown> | undefined) ?? {}
    for (const slot of NON_HEADING_SLOTS) {
      const v = values[slot]
      if (typeof v === 'string' && v.trim()) {
        const t = v.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        if (t.length > 0) return t.length > 140 ? `${t.slice(0, 140)}…` : t
      }
    }
  }
  return ''
}

// ── Helpers ────────────────────────────────────────────────────────────

function toSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
}

function slugFromUrl(url: string): string {
  try {
    const u = new URL(url)
    const parts = u.pathname.split('/').filter(Boolean)
    const last  = parts[parts.length - 1] ?? ''
    return last.toLowerCase().replace(/\.[a-z]+$/, '').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  } catch {
    return ''
  }
}
