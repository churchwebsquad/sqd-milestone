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
  ArrowUp, ArrowDown, MessageSquare,
} from 'lucide-react'
import { renderSectionToHtml, type SnippetMap } from '../../../lib/webBrixiesRender'
import type { WebContentTemplate, WebSection } from '../../../types/database'

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
}

export function SectionPreviewCard({
  section, template, index, total, selected, snippetMap, cardTemplates, bindQuality,
  reviewCounts,
  onSelect, onMoveUp, onMoveDown, onChangeVariant, onUnbind, onRemove,
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
}) {
  const [actionsOpen, setActionsOpen] = useState(false)

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
              <div className="fixed inset-0 z-10" onClick={() => setActionsOpen(false)} />
              <div className="absolute right-0 mt-1 w-48 rounded-md border border-wm-border bg-wm-bg-elevated shadow-lg z-20 py-1">
                <ActionMenuItem onClick={() => { setActionsOpen(false); onChangeVariant() }} icon={<RotateCw size={11} />}>
                  Change variant…
                </ActionMenuItem>
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
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; font-family: Inter, system-ui, -apple-system, sans-serif; color: #1a1a2e; background: #fff; }
  body { width: 1512px; }
  img { max-width: 100%; height: auto; }
  a { color: inherit; text-decoration: none; }
</style>
</head>
<body>${html}</body>
</html>`
}

// ── Freehand fallback preview ───────────────────────────────────────

function FreehandPreview({ section }: { section: WebSection }) {
  const values = (section.field_values ?? {}) as Record<string, unknown>
  const body = typeof values.body === 'string' ? values.body : ''
  const text = useMemo(() => {
    if (typeof document === 'undefined') return ''
    const d = document.createElement('div')
    d.innerHTML = body
    return (d.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 260)
  }, [body])
  return (
    <div className="bg-wm-warning-bg/30 border-l-4 border-wm-warning px-6 py-8">
      <p className="text-[10px] uppercase tracking-widest font-bold text-wm-warning mb-2">
        Freehand section — bind to a template to render
      </p>
      <p className="text-[13px] text-wm-text line-clamp-4">{text || '(empty)'}</p>
    </div>
  )
}
