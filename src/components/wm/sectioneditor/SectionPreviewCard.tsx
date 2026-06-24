/**
 * One section's visual surface in the editor's center canvas.
 *
 * Renders the Brixies HTML for the section inside a sandboxed iframe
 * at the native 1512px viewport, scaled via CSS transform to fit the
 * canvas column. Above the iframe sits a thin strip with the section
 * number, family + variant name, bind-quality dot, drag handle, and
 * a hover-revealed actions menu.
 *
 * The card itself is click-to-select — clicking anywhere (iframe body
 * or strip) selects this section and opens the right details panel.
 *
 * Read-only — no edits happen here. All copy editing is in the panel.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  GripVertical, MoreHorizontal, Trash2, RotateCw, Archive,
  ArrowUp, ArrowDown, MessageSquare, Copy, ChevronRight,
} from 'lucide-react'
import { renderSectionToHtml, type SnippetMap } from '../../../lib/webBrixiesRender'
import type { WebContentTemplate, WebSection } from '../../../types/database'

/** Minimal page reference for the "Duplicate to page" submenu. */
export interface DuplicateTargetPage {
  id:   string
  name: string
  slug: string
}

const BRIXIES_VIEWPORT_PX = 1512

interface Props {
  section: WebSection
  template: WebContentTemplate | null
  index: number
  total: number
  selected: boolean
  snippetMap: SnippetMap
  /** Card-family templates keyed by id — passed down for palette-
   *  referenced groups (Feature 82/106/22 et al). */
  cardTemplates?: Record<string, WebContentTemplate>
  bindQuality: 'good' | 'partial' | 'attention'
  /** Counts of open review comments by kind. Drives the section-strip
   *  badges + the gold left-edge accent on the card. */
  reviewCounts?: {
    open_total:     number
    open_comments:  number
    open_suggested: number
    open_requested: number
  }
  onSelect: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onChangeVariant: () => void
  onUnbind: () => void
  onRemove: () => void
  /** Duplicate this section directly below itself on the SAME page. */
  onDuplicateHere?: () => void
  /** Duplicate this section to ANOTHER page in the project (appended at
   *  the end of that page). Only renders the menu submenu when both the
   *  callback AND `availablePages` are provided. */
  onDuplicateToPage?: (targetPageId: string) => void
  /** Other pages in the project (excluding the current page). When
   *  provided, the "Duplicate to page…" menu submenu shows them. */
  availablePages?: ReadonlyArray<DuplicateTargetPage>
  /** Snapshot this section's content to the project clipboard so it
   *  can be pasted as an item into another section's group. */
  onCopyToClipboard?: () => void
}

export function SectionPreviewCard({
  section, template, index, total, selected, snippetMap, cardTemplates, bindQuality,
  reviewCounts,
  onSelect, onMoveUp, onMoveDown, onChangeVariant, onUnbind, onRemove,
  onDuplicateHere, onDuplicateToPage, availablePages, onCopyToClipboard,
}: Props) {
  const html = useMemo(() => {
    if (!template) return null
    return renderSectionToHtml(
      template,
      (section.field_values ?? {}) as Record<string, unknown>,
      snippetMap,
      cardTemplates,
    )
  }, [template, section.field_values, snippetMap, cardTemplates])

  const hasOpenReview = (reviewCounts?.open_total ?? 0) > 0

  return (
    <div
      id={`section-${section.id}`}
      onClick={onSelect}
      className={[
        'group/section cursor-pointer overflow-hidden rounded-xl border-2 transition-all relative',
        selected
          ? 'border-wm-accent shadow-lg shadow-wm-accent/10'
          : hasOpenReview
            ? 'border-amber-300/70 hover:border-amber-400 hover:shadow-md'
            : 'border-wm-border/60 hover:border-wm-accent/40 hover:shadow-md',
        'bg-wm-bg-elevated',
      ].join(' ')}
    >
      {/* Left-edge accent strip when this section has open review feedback. */}
      {hasOpenReview && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-400" aria-hidden />
      )}
      <SectionStrip
        section={section}
        template={template}
        index={index}
        total={total}
        bindQuality={bindQuality}
        selected={selected}
        reviewCounts={reviewCounts}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        onChangeVariant={onChangeVariant}
        onUnbind={onUnbind}
        onRemove={onRemove}
        onDuplicateHere={onDuplicateHere}
        onDuplicateToPage={onDuplicateToPage}
        availablePages={availablePages}
        onCopyToClipboard={onCopyToClipboard}
      />
      {template && html ? (
        <ScaledIframe html={html} title={template.layer_name} />
      ) : (
        <FreehandPreview section={section} />
      )}
    </div>
  )
}

// ── Section strip (thin chrome above iframe) ────────────────────────

function SectionStrip({
  section: _section, template, index, total, bindQuality, selected, reviewCounts,
  onMoveUp, onMoveDown, onChangeVariant, onUnbind, onRemove,
  onDuplicateHere, onDuplicateToPage, availablePages, onCopyToClipboard,
}: {
  section: WebSection
  template: WebContentTemplate | null
  index: number
  total: number
  bindQuality: 'good' | 'partial' | 'attention'
  selected: boolean
  reviewCounts?: {
    open_total:     number
    open_comments:  number
    open_suggested: number
    open_requested: number
  }
  onMoveUp: () => void
  onMoveDown: () => void
  onChangeVariant: () => void
  onUnbind: () => void
  onRemove: () => void
  onDuplicateHere?: () => void
  onDuplicateToPage?: (targetPageId: string) => void
  availablePages?: ReadonlyArray<DuplicateTargetPage>
  onCopyToClipboard?: () => void
}) {
  const [actionsOpen, setActionsOpen] = useState(false)
  const [pagesSubmenuOpen, setPagesSubmenuOpen] = useState(false)

  return (
    <div
      className={[
        'flex items-center gap-2 px-3 py-1.5 border-b transition-colors',
        selected
          ? 'bg-wm-accent-tint border-wm-accent/30'
          : 'bg-wm-bg-elevated border-wm-border/60 group-hover/section:bg-wm-bg-hover',
      ].join(' ')}
    >
      <GripVertical
        size={12}
        className="text-wm-text-subtle cursor-grab opacity-40 group-hover/section:opacity-100 transition-opacity shrink-0"
      />
      <span
        className={[
          'shrink-0 w-1.5 h-1.5 rounded-full',
          bindQuality === 'good' ? 'bg-wm-success'
          : bindQuality === 'partial' ? 'bg-wm-warning'
          : 'bg-wm-text-subtle',
        ].join(' ')}
        title={
          bindQuality === 'good' ? 'Bound cleanly'
          : bindQuality === 'partial' ? 'Bound with overflow or missing slots'
          : 'Freehand — bind to a template'
        }
      />
      <span className="text-[10px] font-mono text-wm-text-subtle tabular-nums shrink-0">
        {String(index + 1).padStart(2, '0')}
      </span>
      <span className="text-[12px] font-semibold text-wm-text truncate min-w-0">
        {template?.layer_name ?? 'Freehand section'}
      </span>
      {template?.family && (
        <span className="text-[10px] text-wm-text-subtle italic truncate shrink-0">
          {template.family}
        </span>
      )}
      {reviewCounts && reviewCounts.open_total > 0 && (
        <span
          className="ml-2 inline-flex items-center gap-1 shrink-0 rounded-full bg-amber-100 border border-amber-300 text-amber-800 text-[10px] font-bold px-2 py-0.5"
          title={[
            reviewCounts.open_requested > 0 && `${reviewCounts.open_requested} requested`,
            reviewCounts.open_suggested > 0 && `${reviewCounts.open_suggested} suggested`,
            reviewCounts.open_comments  > 0 && `${reviewCounts.open_comments} comment${reviewCounts.open_comments === 1 ? '' : 's'}`,
          ].filter(Boolean).join(' · ')}
        >
          <MessageSquare size={9} />
          {reviewCounts.open_total}
        </span>
      )}
      <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover/section:opacity-100 transition-opacity">
        <ActionButton title="Move up" onClick={onMoveUp} disabled={index === 0}>
          <ArrowUp size={11} />
        </ActionButton>
        <ActionButton title="Move down" onClick={onMoveDown} disabled={index === total - 1}>
          <ArrowDown size={11} />
        </ActionButton>
        <div className="relative">
          <ActionButton title="More" onClick={() => setActionsOpen(o => !o)}>
            <MoreHorizontal size={11} />
          </ActionButton>
          {actionsOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => { setActionsOpen(false); setPagesSubmenuOpen(false) }} />
              <div className="absolute right-0 mt-1 w-56 rounded-md border border-wm-border bg-wm-bg-elevated shadow-lg z-20 py-1">
                <ActionMenuItem onClick={() => { setActionsOpen(false); onChangeVariant() }} icon={<RotateCw size={11} />}>
                  Change variant…
                </ActionMenuItem>
                {onDuplicateHere && (
                  <ActionMenuItem onClick={() => { setActionsOpen(false); onDuplicateHere() }} icon={<Copy size={11} />}>
                    Duplicate here
                  </ActionMenuItem>
                )}
                {onDuplicateToPage && availablePages && availablePages.length > 0 && (
                  <div
                    className="relative"
                    onMouseEnter={() => setPagesSubmenuOpen(true)}
                    onMouseLeave={() => setPagesSubmenuOpen(false)}
                  >
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setPagesSubmenuOpen(o => !o) }}
                      className="w-full text-left px-3 py-1.5 text-[12px] inline-flex items-center gap-2 text-wm-text hover:bg-wm-bg-hover transition-colors"
                    >
                      <Copy size={11} />
                      <span className="flex-1">Duplicate to page…</span>
                      <ChevronRight size={11} className="text-wm-text-subtle" />
                    </button>
                    {pagesSubmenuOpen && (
                      <div className="absolute top-0 right-full mr-1 w-56 max-h-64 overflow-y-auto rounded-md border border-wm-border bg-wm-bg-elevated shadow-lg py-1">
                        {availablePages.map(p => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setActionsOpen(false); setPagesSubmenuOpen(false); onDuplicateToPage(p.id) }}
                            className="w-full text-left px-3 py-1.5 text-[12px] hover:bg-wm-bg-hover transition-colors block"
                          >
                            <p className="font-semibold text-wm-text truncate">{p.name}</p>
                            <p className="text-[10px] text-wm-text-subtle font-mono truncate">/{p.slug}</p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {onCopyToClipboard && (
                  <ActionMenuItem
                    onClick={() => { setActionsOpen(false); onCopyToClipboard() }}
                    icon={<Copy size={11} />}
                  >
                    Copy content
                  </ActionMenuItem>
                )}
                {template && (
                  <ActionMenuItem onClick={() => { setActionsOpen(false); onUnbind() }} icon={<Archive size={11} />}>
                    Unbind to freehand
                  </ActionMenuItem>
                )}
                <ActionMenuItem destructive onClick={() => { setActionsOpen(false); onRemove() }} icon={<Trash2 size={11} />}>
                  Remove section
                </ActionMenuItem>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ActionButton({
  children, title, onClick, disabled,
}: {
  children: React.ReactNode
  title: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick() }}
      title={title}
      disabled={disabled}
      className="h-6 w-6 grid place-items-center rounded text-wm-text-subtle hover:bg-wm-bg-elevated hover:text-wm-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
    >
      {children}
    </button>
  )
}

function ActionMenuItem({
  children, icon, onClick, destructive,
}: {
  children: React.ReactNode
  icon: React.ReactNode
  onClick: () => void
  destructive?: boolean
}) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick() }}
      className={[
        'w-full text-left px-3 py-1.5 text-[12px] inline-flex items-center gap-2 transition-colors',
        destructive
          ? 'text-wm-danger hover:bg-wm-danger-bg'
          : 'text-wm-text hover:bg-wm-bg-hover',
      ].join(' ')}
    >
      {icon}
      {children}
    </button>
  )
}

// ── Scaled iframe ───────────────────────────────────────────────────

function ScaledIframe({ html, title }: { html: string; title: string }) {
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
      } catch {
        // cross-origin guard — fall through, keep prior height
      }
    }
    const onLoad = () => {
      measure()
      // Re-measure as images load and as Brixies content settles.
      try {
        const doc = iframe.contentDocument
        if (doc?.body) {
          bodyObserver?.disconnect()
          bodyObserver = new ResizeObserver(() => measure())
          bodyObserver.observe(doc.body)
        }
        // Also listen to image load events — placeholder swaps don't
        // always trigger ResizeObserver on the body.
        const imgs = doc?.querySelectorAll('img') ?? []
        imgs.forEach(img => img.addEventListener('load', measure, { once: true }))
      } catch { /* sandboxed — fall back to timeouts */ }
    }
    iframe.addEventListener('load', onLoad)
    // Belt-and-braces: re-measure at a few intervals to catch late changes.
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
          title={title}
          className="page-edit-iframe pointer-events-none"
          style={{
            width: `${BRIXIES_VIEWPORT_PX}px`,
            height: `${intrinsicHeight}px`,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            border: 0,
          }}
          // allow-same-origin so we can measure body height as content
          // settles. Scripts stay disabled — content is our own trusted
          // Brixies HTML with strategist copy substituted in.
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

  /* ── Per-template layout overrides ──────────────────────────────
     Brixies source_html ships inline flex styles tuned for the
     desktop canvas at exactly 6 cards across or N slides side-by-
     side. When the bound section has more content than the
     template's default layout assumed, the row squeezes copy to
     unreadable widths or overflows the viewport. We override inline
     flex behavior with !important so containers wrap and each
     card/slide keeps a readable minimum width. */

  /* Feature 14 — cards row wraps; each card holds at least ~280px. */
  [data-layer="Feature section 14"] [data-layer="Container cards"] {
    flex-wrap: wrap !important;
    gap: 30px !important;
  }
  [data-layer="Feature section 14"] [data-layer="Card"] {
    flex: 1 1 280px !important;
    min-width: 280px !important;
    max-width: 100% !important;
  }

  /* Timeline 16 — slides wrap to a second row, each slide stays at
     least ~280px so its card content is legible. */
  [data-layer="Timeline Section 16"] [data-layer="Slider"] {
    flex-wrap: wrap !important;
    gap: 24px !important;
  }
  [data-layer="Timeline Section 16"] [data-layer="Slide"] {
    flex: 1 1 280px !important;
    min-width: 280px !important;
    max-width: 100% !important;
  }
</style>
</head>
<body>${html}</body>
</html>`
}

// ── Freehand fallback preview ───────────────────────────────────────

function FreehandPreview({ section }: { section: WebSection }) {
  const values = (section.field_values ?? {}) as Record<string, unknown>
  const body = typeof values.body === 'string' ? values.body : ''
  // Render the FULL body — markdown if it looks like markdown, plain
  // otherwise. We previously truncated to 260 chars / 4 lines for a
  // compact preview, but freehand sections from cowork imports carry
  // multi-paragraph copy + cards in the body string, and hiding most
  // of it left the strategist unable to read their own content
  // without opening the edit drawer. Show everything so the page
  // serves as a readable proof on first glance, even pre-bind.
  return (
    <div className="bg-wm-warning-bg/30 border-l-4 border-wm-warning px-6 py-8">
      <p className="text-[10px] uppercase tracking-widest font-bold text-wm-warning mb-2">
        Freehand section — bind to a template to render
      </p>
      {body ? (
        <div
          className="prose prose-sm max-w-none text-[13px] text-wm-text [&_h1]:text-[18px] [&_h1]:font-bold [&_h1]:mt-3 [&_h1]:mb-2 [&_h2]:text-[16px] [&_h2]:font-bold [&_h2]:mt-3 [&_h2]:mb-2 [&_h3]:text-[14px] [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_p]:my-2 [&_ul]:list-disc [&_ul]:ml-5 [&_ul]:my-2 [&_ol]:list-decimal [&_ol]:ml-5 [&_ol]:my-2 [&_li]:my-0.5 [&_blockquote]:border-l-2 [&_blockquote]:border-wm-border [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-wm-text-muted [&_code]:font-mono [&_code]:text-[12px] [&_a]:text-wm-accent [&_a]:underline"
          dangerouslySetInnerHTML={{ __html: markdownLikeToHtml(body) }}
        />
      ) : (
        <p className="text-[13px] text-wm-text-muted italic">(empty)</p>
      )}
    </div>
  )
}

/** Minimal markdown → HTML for the freehand preview. The body strings
 *  written by page-bind look like markdown (headings, bullets,
 *  paragraphs, links, blockquotes). We don't import a full markdown
 *  parser here — this is preview-only — but enough patterns to render
 *  cleanly. If the body is already HTML (e.g. <p>, <h2>), it passes
 *  through untouched. */
function markdownLikeToHtml(src: string): string {
  // Pass-through if already HTML (contains a block tag).
  if (/<(p|h[1-6]|ul|ol|li|blockquote|div|section)\b/i.test(src)) return src

  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const lines = src.split(/\r?\n/)
  const out: string[] = []
  let paraBuf: string[] = []
  let listBuf: string[] = []
  let listKind: 'ul' | 'ol' | null = null
  let quoteBuf: string[] = []
  const flushParas = () => {
    if (paraBuf.length === 0) return
    out.push(`<p>${inline(paraBuf.join(' '))}</p>`)
    paraBuf = []
  }
  const flushList = () => {
    if (!listKind || listBuf.length === 0) { listBuf = []; listKind = null; return }
    out.push(`<${listKind}>${listBuf.map(li => `<li>${inline(li)}</li>`).join('')}</${listKind}>`)
    listBuf = []; listKind = null
  }
  const flushQuote = () => {
    if (quoteBuf.length === 0) return
    out.push(`<blockquote>${inline(quoteBuf.join(' '))}</blockquote>`)
    quoteBuf = []
  }
  const flushAll = () => { flushParas(); flushList(); flushQuote() }

  const inline = (s: string) => {
    const e = escape(s)
    return e
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
      .replace(/_([^_]+)_/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
  }

  for (const raw of lines) {
    const line = raw
    const trimmed = line.trim()
    if (!trimmed) { flushAll(); continue }
    const h = trimmed.match(/^(#{1,6})\s+(.+)$/)
    if (h) { flushAll(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue }
    const ul = trimmed.match(/^[-*•]\s+(.+)$/)
    if (ul) { flushParas(); flushQuote(); if (listKind !== 'ul') { flushList(); listKind = 'ul' } listBuf.push(ul[1]); continue }
    const ol = trimmed.match(/^\d+\.\s+(.+)$/)
    if (ol) { flushParas(); flushQuote(); if (listKind !== 'ol') { flushList(); listKind = 'ol' } listBuf.push(ol[1]); continue }
    const bq = trimmed.match(/^>\s?(.*)$/)
    if (bq) { flushParas(); flushList(); quoteBuf.push(bq[1]); continue }
    flushList(); flushQuote()
    paraBuf.push(trimmed)
  }
  flushAll()
  return out.join('\n')
}
