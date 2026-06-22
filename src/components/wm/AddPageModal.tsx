/**
 * Web Manager — Add Page modal.
 *
 * Two modes:
 *   1. Manual — name + slug, creates an empty page (the original flow).
 *   2. From crawl — paste a URL; the import-from-url endpoint scrapes
 *      it via Firecrawl, segments the markdown into cowork-shape
 *      sections (hero + long prose + auto-extracted CTAs), binds each
 *      through the schema-driven binder, and inserts the page + sections
 *      in one shot.
 *
 * Slug derives from the URL's last path segment ("/give/future-fund" →
 * "future-fund") so the new page matches the partner's current site
 * verbatim — the strategist can override before importing if needed.
 */
import { useState } from 'react'
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

type Mode = 'manual' | 'crawl'

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
            ]}
            size="sm"
          />
        </div>
        {mode === 'manual'
          ? <ManualForm projectId={projectId} phase={phase} existingPages={existingPages} onClose={onClose} onCreated={onCreated} />
          : <CrawlForm  projectId={projectId} phase={phase} existingPages={existingPages} onClose={onClose} onCreated={onCreated} />
        }
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
