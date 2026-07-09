/**
 * Full-page Brixies preview — read-only render of every section in the
 * page via the actual Brixies HTML with current field_values + snippet
 * tokens substituted in.
 *
 * Each section renders in its own iframe at the native 1512px viewport,
 * scaled via CSS transform to fit the preview pane. Click a section to
 * pop back into Edit mode scrolled to it.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, Image as ImageIcon, Layout, ExternalLink } from 'lucide-react'
import { renderSectionToHtml, type SnippetMap } from '../../lib/webBrixiesRender'
import { composeSectionName } from '../../lib/webSectionRoles'
import { normalizeCtaValue, CTA_KIND_LABELS } from '../../lib/cta'
import type { CtaValue, WebContentTemplate, WebFieldDef, WebPage, WebSection } from '../../types/database'

interface Props {
  sections: WebSection[]
  templates: Record<string, WebContentTemplate>
  /** Card-family templates keyed by id — required so palette-referenced
   *  groups (Feature 2 / 22 / 82 / 106, etc.) can render their picked
   *  card variant. Missing this map = empty card grids in preview. */
  cardTemplates?: Record<string, WebContentTemplate>
  snippetMap: SnippetMap
  onSelectSection: (id: string) => void
  /** The page these sections belong to. Used to compose the role-based
   *  section label ("Section 3 · Innerpage hero"). Optional so existing
   *  call sites that don't have the page handy still render — the label
   *  degrades gracefully. */
  page?: Pick<WebPage, 'name'> | null
}

const BRIXIES_VIEWPORT_PX = 1512

export function PagePreview({ sections, templates, cardTemplates, snippetMap, onSelectSection, page }: Props) {
  // Layout view = the visual iframe render (default). Content view is a
  // clean text extract per section — headings + body + CTAs with label
  // and URL — so the designer / developer can select and copy content
  // and button routes without fighting the sandboxed iframe. Cluttered
  // editor chrome (variant picker, bind-quality pills, reorder handles)
  // is filtered out.
  const [mode, setMode] = useState<'layout' | 'content'>('layout')

  if (sections.length === 0) {
    return (
      <div className="text-center py-16 text-[12px] text-wm-text-muted">
        No sections to preview.
      </div>
    )
  }

  return (
    <div className="max-w-[1280px] mx-auto px-4 pb-12">
      {/* Toggle: Layout view (iframes) vs Content view (text + CTA extract).
         Content view lets the designer / dev copy text and button routes. */}
      <div className="mb-3 flex items-center justify-end">
        <div className="inline-flex rounded-full border border-wm-border bg-wm-bg-elevated p-0.5 text-[11px] font-semibold">
          <button
            type="button"
            onClick={() => setMode('layout')}
            className={
              'inline-flex items-center gap-1.5 px-3 py-1 rounded-full transition-colors ' +
              (mode === 'layout'
                ? 'bg-wm-text text-wm-bg-elevated'
                : 'text-wm-text-muted hover:text-wm-text')
            }
            title="Visual layout preview"
          >
            <Layout size={11} /> Layout
          </button>
          <button
            type="button"
            onClick={() => setMode('content')}
            className={
              'inline-flex items-center gap-1.5 px-3 py-1 rounded-full transition-colors ' +
              (mode === 'content'
                ? 'bg-wm-text text-wm-bg-elevated'
                : 'text-wm-text-muted hover:text-wm-text')
            }
            title="Copy-friendly view of every text field and button route on this page"
          >
            <Copy size={11} /> Copy content
          </button>
        </div>
      </div>

      {mode === 'content' ? (
        <ContentExtractView
          sections={sections}
          templates={templates}
          snippetMap={snippetMap}
          page={page}
          onSelectSection={onSelectSection}
        />
      ) : (
        <div className="space-y-1 rounded-xl overflow-hidden border border-wm-border bg-wm-bg-elevated shadow-sm">
          {sections.map((section, idx) => {
            const template = section.content_template_id
              ? templates[section.content_template_id]
              : null
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => onSelectSection(section.id)}
                className="block w-full text-left relative group/section overflow-hidden hover:ring-2 hover:ring-wm-accent hover:ring-offset-1 hover:ring-offset-wm-bg transition-shadow"
              >
                <span className="absolute top-2 left-2 z-10 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded bg-wm-text/80 text-wm-bg-elevated text-[10px] font-bold opacity-0 group-hover/section:opacity-100 transition-opacity">
                  {idx + 1}
                </span>
                {template ? (
                  <SectionFrame
                    template={template}
                    values={(section.field_values ?? {}) as Record<string, unknown>}
                    snippetMap={snippetMap}
                    cardTemplates={cardTemplates}
                  />
                ) : (
                  <FreehandPreview section={section} />
                )}
                <span className="absolute bottom-0 left-0 right-0 z-10 px-3 py-1.5 bg-wm-text/80 text-wm-bg-elevated text-[11px] font-semibold opacity-0 group-hover/section:opacity-100 transition-opacity flex items-center gap-2">
                  <span>{composeSectionName({ page: page ?? null, section, compact: false })}</span>
                  {template?.layer_name && (
                    <span
                      className="font-mono font-normal opacity-70"
                      title="Wireframe Brixies layout"
                    >
                      {template.layer_name}
                    </span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Content-extract view (Copy content) ─────────────────────────────

/** Copy-friendly text extract per section, driven by the template's
 *  field schema so we know what's a heading vs body vs CTA vs card
 *  item. Every text block is selectable + carries a Copy button; every
 *  CTA shows its label + URL with a Copy URL affordance. */
function ContentExtractView({
  sections, templates, snippetMap, page, onSelectSection,
}: {
  sections: WebSection[]
  templates: Record<string, WebContentTemplate>
  snippetMap: SnippetMap
  page?: Pick<WebPage, 'name'> | null
  onSelectSection: (id: string) => void
}) {
  return (
    <div className="space-y-3">
      {sections.map((section, idx) => {
        const template = section.content_template_id
          ? templates[section.content_template_id]
          : null
        const values = (section.field_values ?? {}) as Record<string, unknown>
        const extract = template
          ? extractSectionContent(template.fields ?? [], values, snippetMap)
          : extractFreehand(values)
        return (
          <section
            key={section.id}
            className="rounded-xl border border-wm-border bg-wm-bg-elevated overflow-hidden"
          >
            <header className="px-4 py-2.5 border-b border-wm-border flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-baseline gap-2 min-w-0">
                <span className="inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 rounded bg-wm-text text-wm-bg-elevated text-[10px] font-bold">
                  {idx + 1}
                </span>
                <p className="text-[12.5px] font-semibold text-wm-text truncate">
                  {composeSectionName({ page: page ?? null, section, compact: false })}
                </p>
                {template?.layer_name && (
                  <span className="text-[10.5px] font-mono text-wm-text-subtle truncate">
                    {template.layer_name}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => onSelectSection(section.id)}
                className="text-[10.5px] font-semibold text-wm-accent-strong hover:underline shrink-0"
              >
                Open in editor →
              </button>
            </header>

            <div className="p-4 space-y-3">
              {extract.texts.length === 0 && extract.ctas.length === 0 && (
                <p className="text-[12px] text-wm-text-muted italic">
                  No copyable content on this section.
                </p>
              )}
              {extract.texts.map((t, i) => (
                <TextBlock key={`t${i}`} label={t.label} content={t.content} />
              ))}
              {extract.ctas.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1.5">
                    Buttons &amp; links
                  </p>
                  <ul className="space-y-1.5">
                    {extract.ctas.map((c, i) => (
                      <CtaRow key={`c${i}`} cta={c} />
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function TextBlock({ label, content }: { label: string; content: string }) {
  const [copied, setCopied] = useState(false)
  const doCopy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* clipboard unavailable — fall back to manual selection */ }
  }
  return (
    <div className="rounded-md border border-wm-border/60 bg-wm-bg p-2.5">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">{label}</span>
        <button
          type="button"
          onClick={() => void doCopy()}
          className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-wm-accent-strong hover:underline"
        >
          {copied ? <Check size={10} /> : <Copy size={10} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="text-[13px] text-wm-text whitespace-pre-wrap leading-snug select-text">{content}</p>
    </div>
  )
}

function CtaRow({ cta }: { cta: ExtractedCta }) {
  const [copied, setCopied] = useState(false)
  const url = cta.url.trim()
  const copyUrl = async () => {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* clipboard unavailable */ }
  }
  const kindLabel = cta.kind ? (CTA_KIND_LABELS[cta.kind] ?? cta.kind) : null
  return (
    <li className="rounded-md border border-wm-border/60 bg-wm-bg px-3 py-2 text-[12.5px] flex items-center gap-2 flex-wrap">
      <span className="font-semibold text-wm-text select-text">{cta.label || <em className="text-wm-text-subtle">(no label)</em>}</span>
      {kindLabel && (
        <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">{kindLabel}</span>
      )}
      <span className="text-[11.5px] font-mono text-wm-text-muted select-text truncate max-w-full flex-1 min-w-[120px]" title={url || '(no url)'}>
        {url || <em className="text-wm-text-subtle">(no url)</em>}
      </span>
      {url && (
        <>
          <button
            type="button"
            onClick={() => void copyUrl()}
            className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-wm-accent-strong hover:underline shrink-0"
          >
            {copied ? <Check size={10} /> : <Copy size={10} />}
            {copied ? 'Copied' : 'Copy URL'}
          </button>
          {(cta.kind === 'external_url' || cta.kind === 'video_link' || url.startsWith('http')) && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-wm-text-subtle hover:text-wm-text shrink-0"
              title="Open link in new tab"
            >
              <ExternalLink size={11} />
            </a>
          )}
        </>
      )}
    </li>
  )
}

interface ExtractedText {
  label:   string
  content: string
}
interface ExtractedCta {
  label: string
  url:   string
  kind:  CtaValue['kind'] | null
}
interface SectionExtract {
  texts: ExtractedText[]
  ctas:  ExtractedCta[]
}

/** Walk the template field schema against the field_values dict and
 *  pull out every copyable text + CTA into a flat list. Groups recurse
 *  per-item so a feature grid contributes one text/cta entry per card.
 *
 *  Text handling:
 *   - `text` / `email` / `phone` / `url` slots: raw string
 *   - `richtext` slots: HTML stripped to plain text with paragraph
 *     breaks preserved as blank lines
 *   - Snippet tokens (`{{primary-service-time}}`) are resolved from the
 *     snippet map so the copy the developer pastes carries real values.
 */
function extractSectionContent(
  fields: ReadonlyArray<WebFieldDef>,
  values: Record<string, unknown>,
  snippetMap: SnippetMap,
): SectionExtract {
  const texts: ExtractedText[] = []
  const ctas:  ExtractedCta[]  = []

  const pushText = (label: string, raw: unknown, isRichText: boolean) => {
    if (raw == null) return
    let content = typeof raw === 'string' ? raw : String(raw)
    content = resolveSnippets(content, snippetMap)
    if (isRichText) content = htmlToPlainText(content)
    content = content.trim()
    if (!content) return
    texts.push({ label, content })
  }

  const pushCta = (label: string, raw: unknown) => {
    const cta = normalizeCtaValue(raw)
    const resolvedLabel = resolveSnippets(cta.label, snippetMap).trim()
    const resolvedUrl   = resolveSnippets(cta.url, snippetMap).trim()
    if (!resolvedLabel && !resolvedUrl) return
    ctas.push({ label: resolvedLabel || label, url: resolvedUrl, kind: cta.kind ?? null })
  }

  const walk = (fs: ReadonlyArray<WebFieldDef>, vals: Record<string, unknown>, prefix?: string) => {
    for (const f of fs) {
      const label = prefix ? `${prefix} · ${f.label ?? f.key}` : (f.label ?? f.key)
      const val = vals[f.key]
      if (f.kind === 'slot') {
        if (f.type === 'cta') {
          pushCta(label, val)
        } else if (f.type === 'text' || f.type === 'richtext' || f.type === 'email' || f.type === 'phone' || f.type === 'url') {
          pushText(label, val, f.type === 'richtext')
        }
        // image / map / boolean / datetime / form-input intentionally
        // skipped — nothing text-copyable comes out of them here.
      } else if (f.kind === 'group') {
        const items = Array.isArray(val) ? val : []
        items.forEach((item, i) => {
          if (item && typeof item === 'object') {
            walk(f.item_schema ?? [], item as Record<string, unknown>, `${label} ${i + 1}`)
          }
        })
      }
    }
  }

  walk(fields, values)
  return { texts, ctas }
}

function extractFreehand(values: Record<string, unknown>): SectionExtract {
  const body = typeof values.body === 'string' ? values.body : ''
  const content = htmlToPlainText(body).trim()
  return {
    texts: content ? [{ label: 'Freehand body', content }] : [],
    ctas:  [],
  }
}

/** Convert an HTML fragment to selectable plain text. Paragraph and
 *  list breaks become blank lines so headings + body read naturally
 *  when pasted into a doc. Uses DOMParser in the browser; falls back
 *  to a regex strip on the server (defensive; this view is
 *  client-only). */
function htmlToPlainText(html: string): string {
  if (typeof document === 'undefined') {
    return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ')
  }
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  // Block elements get a trailing newline so pasted text preserves
  // paragraph structure instead of one long run-on.
  doc.querySelectorAll('p, div, li, h1, h2, h3, h4, h5, h6, br').forEach(el => {
    el.appendChild(doc.createTextNode('\n'))
  })
  const text = doc.body?.textContent ?? ''
  return text.replace(/\n{3,}/g, '\n\n')
}

/** Substitute `{{token}}` occurrences in a string with their snippet
 *  values so the pasted copy carries real content instead of raw
 *  merge fields. Unknown tokens are left as-is. */
function resolveSnippets(input: string, snippetMap: SnippetMap): string {
  if (!input || !input.includes('{{')) return input
  return input.replace(/\{\{\s*([a-z0-9_-]+)\s*\}\}/gi, (match, tokenRaw: string) => {
    const token = tokenRaw.toLowerCase()
    const v = snippetMap[token]
    return typeof v === 'string' && v.trim() ? v : match
  })
}

// ── Per-section iframe ───────────────────────────────────────────────

function SectionFrame({
  template, values, snippetMap, cardTemplates,
}: {
  template: WebContentTemplate
  values: Record<string, unknown>
  snippetMap: SnippetMap
  cardTemplates?: Record<string, WebContentTemplate>
}) {
  const html = useMemo(
    () => renderSectionToHtml(template, values, snippetMap, cardTemplates),
    [template, values, snippetMap, cardTemplates],
  )
  const containerRef = useRef<HTMLDivElement | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [scale, setScale] = useState(0.6)
  const [intrinsicHeight, setIntrinsicHeight] = useState(800)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const compute = () => {
      const w = el.clientWidth
      const s = Math.min(1, w / BRIXIES_VIEWPORT_PX)
      setScale(s)
    }
    compute()
    const obs = new ResizeObserver(compute)
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return
    let bodyObserver: ResizeObserver | null = null
    const measure = () => {
      try {
        const doc = iframe.contentDocument
        if (!doc) return
        const h = doc.body?.scrollHeight ?? doc.documentElement?.scrollHeight ?? 800
        setIntrinsicHeight(Math.max(h, 200))
      } catch { /* cross-origin guard */ }
    }
    const onLoad = () => {
      measure()
      try {
        const doc = iframe.contentDocument
        if (doc?.body) {
          bodyObserver = new ResizeObserver(() => measure())
          bodyObserver.observe(doc.body)
        }
        const imgs = doc?.querySelectorAll('img') ?? []
        imgs.forEach(img => img.addEventListener('load', measure, { once: true }))
      } catch { /* sandboxed */ }
    }
    iframe.addEventListener('load', onLoad)
    const timeouts = [120, 400, 1200, 2500].map(t => setTimeout(measure, t))
    return () => {
      iframe.removeEventListener('load', onLoad)
      bodyObserver?.disconnect()
      timeouts.forEach(clearTimeout)
    }
  }, [html])

  const wrappedHeight = Math.round(intrinsicHeight * scale)

  return (
    <div ref={containerRef} className="page-edit-iframe-wrap relative bg-white">
      <div className="page-edit-iframe-inner" style={{ height: `${wrappedHeight}px` }}>
        <iframe
          ref={iframeRef}
          srcDoc={buildIframeDoc(html)}
          title={template.layer_name}
          className="page-edit-iframe pointer-events-none"
          style={{
            width: `${BRIXIES_VIEWPORT_PX}px`,
            height: `${intrinsicHeight}px`,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            border: 0,
          }}
          sandbox="allow-same-origin"
        />
      </div>
    </div>
  )
}

function buildIframeDoc(html: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; }
  html, body, h1, h2, h3, h4, h5, h6, p, span, div, a, li, td, th, button { font-family: 'DM Sans', system-ui, -apple-system, sans-serif; }
  html, body { margin: 0; padding: 0; color: #1a1a2e; background: #fff; }
  body { width: 1512px; }
  img { max-width: 100%; height: auto; }
  a { color: inherit; text-decoration: none; }
  /* Snippet tokens — resolveSnippetsInTree wraps each substituted
     value in this class so the preview shows merge-field values in
     the brand's vivid indigo. Unresolved tokens (the raw "{{token}}"
     fallback) also wear the class so they stand out as needing fix. */
  .wm-snippet-token { color: #3300FF; font-weight: 600; }
</style>
</head>
<body>${html}</body>
</html>`
}

// ── Freehand section preview placeholder ────────────────────────────

function FreehandPreview({ section }: { section: WebSection }) {
  const values = (section.field_values ?? {}) as Record<string, unknown>
  const body = typeof values.body === 'string' ? values.body : ''
  const text = useMemo(() => {
    if (typeof document === 'undefined') return ''
    const d = document.createElement('div')
    d.innerHTML = body
    return (d.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 140)
  }, [body])
  return (
    <div className="bg-wm-warning-bg/40 border-l-4 border-wm-warning px-6 py-8">
      <div className="flex items-center gap-2 mb-2 text-wm-warning">
        <ImageIcon size={13} />
        <span className="text-[11px] uppercase tracking-widest font-bold">Freehand</span>
      </div>
      <p className="text-[13px] text-wm-text line-clamp-3">{text || '(empty)'}</p>
    </div>
  )
}
