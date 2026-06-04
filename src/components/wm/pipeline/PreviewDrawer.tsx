/**
 * Wider-than-card drawer that renders a stage's output in a
 * human-readable view, with a toggle to fall back to raw JSON.
 *
 * Stages without a custom renderer fall through to the JSON view.
 */
import { useState } from 'react'
import { X } from 'lucide-react'
import { STAGE_LABELS, type PipelineStage } from '../../../lib/pipelinePromptsCore'
import { SitemapPreview } from './previews/SitemapPreview'
import { OutlinesPreview } from './previews/OutlinesPreview'
import { SitemapCoveragePreview } from './previews/SitemapCoveragePreview'

interface Props {
  stage:   PipelineStage
  output:  Record<string, unknown>
  onClose: () => void
}

// Stage → readable preview component. Add entries here as the other
// stages get their own renderers. Stages not listed fall through to
// JSON-only mode (the toggle is hidden).
const PREVIEWS: Partial<Record<PipelineStage, React.FC<{ output: Record<string, unknown> }>>> = {
  sitemap:          SitemapPreview,
  sitemap_coverage: SitemapCoveragePreview,
  outlines:         OutlinesPreview,
}

type View = 'readable' | 'json'

export function PreviewDrawer({ stage, output, onClose }: Props) {
  const Preview = PREVIEWS[stage]
  const [view, setView] = useState<View>(Preview ? 'readable' : 'json')

  return (
    <div className="fixed inset-0 z-50 flex">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="flex-1 bg-black/40"
      />
      <div className="w-full max-w-4xl bg-wm-bg-elevated border-l border-wm-border overflow-y-auto">
        <div className="sticky top-0 z-20 bg-wm-bg-elevated border-b border-wm-border px-4 py-3 flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong">Output</p>
            <p className="text-[14px] font-semibold text-wm-text truncate">{STAGE_LABELS[stage]}</p>
          </div>
          <div className="shrink-0 flex items-center gap-1.5">
            {Preview && (
              <div className="inline-flex rounded-md border border-wm-border bg-wm-bg p-0.5 text-[11px] font-semibold">
                <button
                  type="button"
                  onClick={() => setView('readable')}
                  className={[
                    'px-2 py-1 rounded',
                    view === 'readable' ? 'bg-wm-accent text-white' : 'text-wm-text-muted hover:text-wm-text',
                  ].join(' ')}
                >
                  Readable
                </button>
                <button
                  type="button"
                  onClick={() => setView('json')}
                  className={[
                    'px-2 py-1 rounded',
                    view === 'json' ? 'bg-wm-accent text-white' : 'text-wm-text-muted hover:text-wm-text',
                  ].join(' ')}
                >
                  JSON
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              className="h-7 w-7 rounded-md hover:bg-wm-bg-hover flex items-center justify-center text-wm-text-muted"
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="p-4">
          {view === 'readable' && Preview
            ? <Preview output={output} />
            : (
              <pre className="text-[10px] font-mono text-wm-text-muted whitespace-pre-wrap bg-wm-bg p-3 rounded border border-wm-border overflow-auto">
                {JSON.stringify(output, null, 2)}
              </pre>
            )}
        </div>
      </div>
    </div>
  )
}
