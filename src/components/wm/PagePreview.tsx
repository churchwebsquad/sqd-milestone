/**
 * Page preview — live Brixies render with current copy.
 *
 * v3 restoration. Previous v1 of PagePreview was a stack of static
 * preview JPGs of each bound template. v2 deleted it entirely. v3
 * brings back a real preview: for each section, render the bound
 * template's `source_html` with the strategist's current
 * `field_values` substituted in, inside an isolated iframe at the
 * native 1512px Brixies viewport, scaled via CSS transform to fit
 * the editor pane.
 *
 * Read-only. Click any section in the preview → switch back to Edit
 * mode and scroll to that section.
 *
 * Why an iframe: Brixies HTML carries Brixies-specific styling and a
 * lot of inline pixel widths. Isolating in an iframe prevents Brixies
 * styles from bleeding into the app shell and lets us set the iframe
 * to its design width (1512px) and then scale-down externally.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Image as ImageIcon } from 'lucide-react'
import { renderSectionToHtml } from '../../lib/webBrixiesRender'
import type { WebContentTemplate, WebSection } from '../../types/database'

interface Props {
  sections: WebSection[]
  templates: Record<string, WebContentTemplate>
  onSelectSection: (id: string) => void
}

const BRIXIES_VIEWPORT_PX = 1512

export function PagePreview({ sections, templates, onSelectSection }: Props) {
  if (sections.length === 0) {
    return (
      <div className="text-center py-16 text-[12px] text-wm-text-muted">
        No sections to preview.
      </div>
    )
  }

  return (
    <div className="max-w-[1200px] mx-auto px-4 pb-12">
      <p className="text-[11px] uppercase tracking-widest font-bold text-wm-text-subtle mb-3 text-center">
        Live preview · Brixies render with current copy
      </p>
      <div className="space-y-1 rounded-lg overflow-hidden border border-wm-border bg-wm-bg-elevated shadow-sm">
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
                />
              ) : (
                <FreehandPreview section={section} />
              )}
              <span className="absolute bottom-0 left-0 right-0 z-10 px-3 py-1.5 bg-wm-text/80 text-wm-bg-elevated text-[11px] font-semibold opacity-0 group-hover/section:opacity-100 transition-opacity">
                {template?.layer_name ?? 'Freehand section'}
                {template?.family && <span className="ml-2 font-normal opacity-80">{template.family}</span>}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Per-section iframe ───────────────────────────────────────────────

function SectionFrame({
  template, values,
}: {
  template: WebContentTemplate
  values: Record<string, unknown>
}) {
  const html = useMemo(() => renderSectionToHtml(template, values), [template, values])
  const containerRef = useRef<HTMLDivElement | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [scale, setScale] = useState(0.6)
  const [intrinsicHeight, setIntrinsicHeight] = useState(800)

  // Recompute the scale whenever the container's width changes so the
  // 1512px iframe shrinks to fit.
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

  // Once the iframe has loaded its content, measure the intrinsic
  // height so we can size the wrapper to match the scaled render.
  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return
    const measure = () => {
      try {
        const doc = iframe.contentDocument
        if (!doc) return
        const h = doc.body?.scrollHeight ?? doc.documentElement?.scrollHeight ?? 800
        setIntrinsicHeight(Math.max(h, 200))
      } catch {
        // cross-origin guard — sandboxed iframes from srcdoc are same-origin
        // by spec, but be defensive.
      }
    }
    iframe.addEventListener('load', measure)
    // Re-measure after a short delay too — content may include images
    // that load async and grow the document.
    const t = setTimeout(measure, 250)
    return () => { iframe.removeEventListener('load', measure); clearTimeout(t) }
  }, [html])

  // The iframe is sized to 1512 × intrinsicHeight; the wrapper is sized
  // to (1512 * scale) × (intrinsicHeight * scale) so the section's
  // outer container takes the right space in the page flow.
  const wrappedHeight = Math.round(intrinsicHeight * scale)

  return (
    <div ref={containerRef} className="bx-preview-section-wrap">
      <div className="bx-preview-section-inner" style={{ height: `${wrappedHeight}px` }}>
        <iframe
          ref={iframeRef}
          srcDoc={buildIframeDoc(html)}
          title={template.layer_name}
          className="bx-preview-iframe"
          style={{
            width: `${BRIXIES_VIEWPORT_PX}px`,
            height: `${intrinsicHeight}px`,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
          // The iframe content is built from our own trusted catalog
          // source_html — but sandbox anyway to block any script /
          // navigation that might have slipped through.
          sandbox=""
        />
      </div>
    </div>
  )
}

/** Wrap the section's substituted HTML in a minimal iframe document
 *  with base styles for typography defaults + image fallback. */
function buildIframeDoc(html: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; font-family: Inter, system-ui, -apple-system, sans-serif; }
  body { width: 1512px; }
  img { max-width: 100%; height: auto; }
  a { color: inherit; text-decoration: none; }
</style>
</head>
<body>${html}</body>
</html>`
}

// ── Freehand section preview placeholder ────────────────────────────

function FreehandPreview({ section }: { section: WebSection }) {
  const values = (section.field_values ?? {}) as Record<string, unknown>
  const body = typeof values.body === 'string' ? values.body : ''
  // Strip HTML for a single-line preview.
  const div = typeof document !== 'undefined' ? document.createElement('div') : null
  if (div) div.innerHTML = body
  const text = (div?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 140)
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
