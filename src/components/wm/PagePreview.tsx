/**
 * Page preview — v1 low-fi wireframe.
 *
 * Stacks each section's bound Brixies template JPG (preview_image_url)
 * in order to give the strategist a visual read of the page flow before
 * any HTML rendering. Freehand sections render as a labeled placeholder.
 * Click any section thumbnail to jump back into the editor for it.
 *
 * v2 (future): swap the JPG for the template's source_html with live
 * field_values substituted, rendered in an iframe to isolate styles.
 */
import { Image as ImageIcon, FileText } from 'lucide-react'
import type { WebContentTemplate, WebSection } from '../../types/database'

interface Props {
  sections: WebSection[]
  templates: Record<string, WebContentTemplate>
  onSelectSection: (sectionId: string) => void
}

export function PagePreview({ sections, templates, onSelectSection }: Props) {
  if (sections.length === 0) {
    return (
      <div className="text-center py-16 text-[12px] text-wm-text-muted">
        No sections to preview.
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 pb-12">
      <p className="text-[11px] uppercase tracking-widest font-bold text-wm-text-subtle mb-3 text-center">
        Low-fi wireframe · stacked template thumbnails
      </p>
      <div className="space-y-1 rounded-lg overflow-hidden border border-wm-border bg-wm-bg-elevated shadow-sm">
        {sections.map((section, idx) => {
          const isFreehand = section.content_template_id == null
          const template = section.content_template_id ? templates[section.content_template_id] : null
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => onSelectSection(section.id)}
              className="block w-full text-left relative group overflow-hidden hover:ring-2 hover:ring-wm-accent hover:ring-offset-1 hover:ring-offset-wm-bg transition-shadow"
            >
              {/* Section order badge — fixed top-left, visible on hover. */}
              <span className="absolute top-2 left-2 z-10 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded bg-wm-text/80 text-wm-bg-elevated text-[10px] font-bold opacity-0 group-hover:opacity-100 transition-opacity">
                {idx + 1}
              </span>
              {/* Template label — bottom strip on hover. */}
              <span className="absolute bottom-0 left-0 right-0 z-10 px-3 py-1.5 bg-wm-text/80 text-wm-bg-elevated text-[11px] font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
                {isFreehand ? 'Freehand section' : (template?.layer_name ?? 'Unknown template')}
                {!isFreehand && template?.family && (
                  <span className="ml-2 font-normal opacity-80">{template.family}</span>
                )}
              </span>

              {isFreehand ? (
                <FreehandPlaceholder section={section} />
              ) : template?.preview_image_url ? (
                <img
                  src={template.preview_image_url}
                  alt={template.layer_name}
                  className="block w-full"
                  loading="lazy"
                />
              ) : (
                <NoPreviewPlaceholder template={template} />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function FreehandPlaceholder({ section }: { section: WebSection }) {
  const values = (section.field_values ?? {}) as Record<string, unknown>
  const body = typeof values.body === 'string' ? values.body : ''
  // Strip HTML for a one-line preview.
  const div = typeof document !== 'undefined' ? document.createElement('div') : null
  if (div) div.innerHTML = body
  const text = (div?.textContent ?? '').replace(/\s+/g, ' ').trim()
  const preview = text.slice(0, 140)
  return (
    <div className="bg-wm-warning-bg/40 border-l-4 border-wm-warning px-6 py-8">
      <div className="flex items-center gap-2 mb-2 text-wm-warning">
        <FileText size={13} />
        <span className="text-[11px] uppercase tracking-widest font-bold">Freehand</span>
      </div>
      <p className="text-[13px] text-wm-text line-clamp-3">
        {preview || '(empty)'}
        {text.length > 140 && '…'}
      </p>
    </div>
  )
}

function NoPreviewPlaceholder({ template }: { template: WebContentTemplate | null | undefined }) {
  return (
    <div className="bg-wm-bg-hover px-6 py-10 text-center">
      <ImageIcon size={20} className="text-wm-text-subtle mx-auto mb-1.5" />
      <p className="text-[12px] text-wm-text-muted">
        No preview image for <span className="font-semibold text-wm-text">{template?.layer_name ?? 'this template'}</span>
      </p>
    </div>
  )
}
