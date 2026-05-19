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
import { Image as ImageIcon } from 'lucide-react'
import { renderSectionToHtml, type SnippetMap } from '../../lib/webBrixiesRender'
import type { WebContentTemplate, WebSection } from '../../types/database'

interface Props {
  sections: WebSection[]
  templates: Record<string, WebContentTemplate>
  snippetMap: SnippetMap
  onSelectSection: (id: string) => void
}

const BRIXIES_VIEWPORT_PX = 1512

export function PagePreview({ sections, templates, snippetMap, onSelectSection }: Props) {
  if (sections.length === 0) {
    return (
      <div className="text-center py-16 text-[12px] text-wm-text-muted">
        No sections to preview.
      </div>
    )
  }

  return (
    <div className="max-w-[1280px] mx-auto px-4 pb-12">
      <p className="text-[11px] uppercase tracking-widest font-bold text-wm-text-subtle mb-3 text-center">
        Live preview · Brixies render with current copy
      </p>
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
  template, values, snippetMap,
}: {
  template: WebContentTemplate
  values: Record<string, unknown>
  snippetMap: SnippetMap
}) {
  const html = useMemo(
    () => renderSectionToHtml(template, values, snippetMap),
    [template, values, snippetMap],
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
    const measure = () => {
      try {
        const doc = iframe.contentDocument
        if (!doc) return
        const h = doc.body?.scrollHeight ?? doc.documentElement?.scrollHeight ?? 800
        setIntrinsicHeight(Math.max(h, 200))
      } catch {
        /* sandbox guard */
      }
    }
    iframe.addEventListener('load', measure)
    const t = setTimeout(measure, 250)
    return () => { iframe.removeEventListener('load', measure); clearTimeout(t) }
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
          sandbox=""
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
