/**
 * Wider-than-card drawer that renders a stage's output in a
 * human-readable view, with a toggle to fall back to raw JSON.
 *
 * Stages without a custom renderer fall through to the JSON view.
 */
import { useState } from 'react'
import { X, RotateCw, Check, Loader2 } from 'lucide-react'
import { STAGE_LABELS, type PipelineStage } from '../../../lib/pipelinePromptsCore'
import { SitemapPreview } from './previews/SitemapPreview'
import { OutlinesPreview } from './previews/OutlinesPreview'
import { SitemapCoveragePreview } from './previews/SitemapCoveragePreview'
import { VoicePassPreview } from './previews/VoicePassPreview'

interface ExtraAction {
  label:    string
  title?:   string
  loading?: boolean
  onClick:  () => void
}

interface Props {
  stage:        PipelineStage
  output:       Record<string, unknown>
  onClose:      () => void
  /** When set, drives the Refine button shown in the drawer header.
   *  Returns a promise so the drawer can show in-flight + error. */
  onRefine?:    (feedback: string) => Promise<void> | void
  /** When set, shows an Approve button. Only meaningful for stages
   *  in draft state. */
  onApprove?:   () => Promise<void> | void
  /** Stage-specific extra action (e.g. "Apply rewrites" for voice
   *  pass). Identical to the prop on StageCard so both surfaces can
   *  invoke it. */
  extraAction?: ExtraAction
  /** True while the parent is running this stage. Disables Refine. */
  running?:     boolean
}

// Stage → readable preview component. Add entries here as the other
// stages get their own renderers. Stages not listed fall through to
// JSON-only mode (the toggle is hidden).
const PREVIEWS: Partial<Record<PipelineStage, React.FC<{ output: Record<string, unknown> }>>> = {
  sitemap:          SitemapPreview,
  sitemap_coverage: SitemapCoveragePreview,
  outlines:         OutlinesPreview,
  voice_pass:       VoicePassPreview,
}

type View = 'readable' | 'json'

export function PreviewDrawer({ stage, output, onClose, onRefine, onApprove, extraAction, running }: Props) {
  const Preview = PREVIEWS[stage]
  const [view, setView] = useState<View>(Preview ? 'readable' : 'json')
  const [refineOpen, setRefineOpen] = useState(false)
  const [refineText, setRefineText] = useState('')
  const [refineSubmitting, setRefineSubmitting] = useState(false)
  const [refineError, setRefineError] = useState<string | null>(null)

  const submitRefine = async () => {
    if (!onRefine || !refineText.trim() || refineSubmitting) return
    setRefineSubmitting(true); setRefineError(null)
    try {
      await onRefine(refineText.trim())
      // Success: close the refine panel, but leave the drawer open
      // so the user sees the updated output flow in.
      setRefineOpen(false)
      setRefineText('')
    } catch (e) {
      setRefineError(e instanceof Error ? e.message : 'Refine failed')
    } finally {
      setRefineSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="flex-1 bg-black/40"
      />
      <div className="w-full max-w-4xl bg-wm-bg-elevated border-l border-wm-border overflow-y-auto">
        <div className="sticky top-0 z-20 bg-wm-bg-elevated border-b border-wm-border">
          <div className="px-4 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong">Output</p>
              <p className="text-[14px] font-semibold text-wm-text truncate">{STAGE_LABELS[stage]}</p>
            </div>
            <div className="shrink-0 flex items-center gap-1.5 flex-wrap">
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
              {onRefine && (
                <button
                  type="button"
                  onClick={() => setRefineOpen(o => !o)}
                  disabled={running}
                  title="Refine with targeted feedback — keep everything else identical"
                  className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] font-semibold border border-wm-border bg-wm-bg-elevated hover:bg-wm-bg-hover disabled:opacity-40"
                >
                  <RotateCw size={11} /> Refine
                </button>
              )}
              {extraAction && (
                <button
                  type="button"
                  onClick={extraAction.onClick}
                  title={extraAction.title}
                  disabled={extraAction.loading}
                  className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-semibold border border-wm-accent text-wm-accent-strong bg-wm-bg-elevated hover:bg-wm-accent-tint disabled:opacity-40"
                >
                  {extraAction.loading ? <Loader2 size={11} className="animate-spin" /> : null}
                  {extraAction.label}
                </button>
              )}
              {onApprove && (
                <button
                  type="button"
                  onClick={onApprove}
                  className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-semibold bg-wm-success text-white hover:opacity-90"
                >
                  <Check size={11} /> Approve
                </button>
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

          {/* In-drawer Refine panel — same target as the StageCard
              version, but keeps the user inside the drawer so they
              can see the new output flow in without context-switching. */}
          {refineOpen && onRefine && (
            <div className="border-t border-wm-border bg-wm-bg-hover/40 px-4 py-3">
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">
                Targeted change — keep everything else identical
              </p>
              <p className="text-[11px] text-wm-text-muted mb-2 leading-snug">
                Be specific about what to change. Everything else stays. Examples:
                <span className="block mt-1 ml-3 text-[10px] font-mono text-wm-text-subtle">
                  · &ldquo;Rename Discussion Groups to Conversations everywhere&rdquo;<br/>
                  · &ldquo;Change Contact link to a popup Church Center form, not a standalone page&rdquo;<br/>
                  · &ldquo;Polish the megamenu descriptions — drop em dashes, vary openings&rdquo;<br/>
                  · &ldquo;Switch shell from megamenu to offcanvas&rdquo;
                </span>
              </p>
              <textarea
                value={refineText}
                onChange={e => setRefineText(e.target.value)}
                placeholder="What should change about this stage's output? The model will preserve everything you don't mention."
                rows={4}
                disabled={refineSubmitting}
                className="w-full text-[12px] px-2 py-1.5 rounded-md border border-wm-border bg-wm-bg-elevated focus:border-wm-accent focus:outline-none disabled:opacity-60"
              />
              {refineError && (
                <p className="text-[11px] text-wm-danger mt-1.5">
                  Refine failed: {refineError}
                </p>
              )}
              {refineSubmitting && (
                <p className="text-[11px] text-wm-accent mt-1.5 inline-flex items-center gap-1.5">
                  <Loader2 size={11} className="animate-spin" />
                  Re-running stage with your feedback — keep this drawer open.
                </p>
              )}
              <div className="flex justify-end gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => { setRefineOpen(false); setRefineText(''); setRefineError(null) }}
                  disabled={refineSubmitting}
                  className="text-[11px] text-wm-text-muted hover:text-wm-text px-2 py-1 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void submitRefine()}
                  disabled={!refineText.trim() || refineSubmitting}
                  className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-semibold bg-wm-accent text-white hover:bg-wm-accent-hover disabled:opacity-40"
                >
                  {refineSubmitting
                    ? <Loader2 size={11} className="animate-spin" />
                    : <RotateCw size={11} />}
                  Refine with feedback
                </button>
              </div>
            </div>
          )}
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
