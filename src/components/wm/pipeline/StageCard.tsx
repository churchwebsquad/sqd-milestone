/**
 * One stage in the copywriting pipeline. Renders title + status pill
 * + Run/Redo/Edit-prompt/Gate controls. The output preview is a
 * collapsible block under the controls.
 */
import { useState } from 'react'
import { Loader2, Play, RotateCw, Check, ChevronDown, ChevronRight, Settings2 } from 'lucide-react'
import { WMStatusPill } from '../StatusPill'
import {
  STAGE_LABELS,
  STAGE_NUMBER,
  STAGE_DESCRIPTIONS,
  type PipelineStage,
} from '../../../lib/pipelinePromptsCore'

export type StageState =
  | 'locked'        // prerequisites not approved
  | 'ready'         // can be run
  | 'running'       // call in flight
  | 'draft'         // output written, awaiting gate
  | 'approved'      // gated

interface Props {
  stage:        PipelineStage
  state:        StageState
  output:       Record<string, unknown> | null
  redoCount:    number
  promptSource: 'db' | 'fallback' | null
  hasAddendum:  boolean
  onRun:        (feedback?: string) => void
  onApprove?:   () => void
  onEditPrompt: () => void
  /** Render a stage-specific output preview. Hidden until the user
   *  expands the card. */
  renderPreview?: (output: Record<string, unknown>) => React.ReactNode
}

export function StageCard({
  stage, state, output, redoCount, promptSource, hasAddendum,
  onRun, onApprove, onEditPrompt, renderPreview,
}: Props) {
  const [expanded, setExpanded] = useState(state === 'draft')
  const [redoText, setRedoText] = useState('')
  const [redoOpen, setRedoOpen] = useState(false)

  const num = STAGE_NUMBER[stage]
  const label = STAGE_LABELS[stage]
  const desc  = STAGE_DESCRIPTIONS[stage]

  const tone = state === 'approved' ? 'success'
    : state === 'draft'    ? 'warning'
    : state === 'running'  ? 'info'
    : state === 'locked'   ? 'neutral'
    : 'neutral'
  const stateLabel = state === 'approved' ? 'Approved'
    : state === 'draft'   ? 'Draft · Review'
    : state === 'running' ? 'Running…'
    : state === 'locked'  ? 'Locked'
    : 'Ready'

  return (
    <div className={[
      'rounded-lg border bg-wm-bg-elevated transition-colors',
      state === 'locked'   ? 'border-wm-border opacity-60'
        : state === 'draft' ? 'border-wm-warning/50'
        : state === 'approved' ? 'border-wm-success/40'
        : 'border-wm-border',
    ].join(' ')}>
      {/* Header */}
      <div className="flex items-start gap-3 p-3">
        <div className="shrink-0 h-7 w-7 rounded-md bg-wm-accent-tint text-wm-accent-strong flex items-center justify-center text-[11px] font-bold font-mono">
          {num}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[13px] font-semibold text-wm-text">{label}</p>
            <WMStatusPill tone={tone} size="sm">{stateLabel}</WMStatusPill>
            {hasAddendum && (
              <span className="text-[10px] text-wm-accent-strong" title="This project has an addendum on top of the global prompt">
                · project addendum
              </span>
            )}
            {promptSource === 'fallback' && (
              <span className="text-[10px] text-wm-text-subtle" title="Using built-in fallback prompt. Update the global in Settings to refine.">
                · using fallback
              </span>
            )}
            {redoCount > 0 && (
              <span className="text-[10px] text-wm-text-subtle">· redo #{redoCount}</span>
            )}
          </div>
          <p className="text-[11px] text-wm-text-muted mt-0.5">{desc}</p>
        </div>
        <div className="shrink-0 flex items-center gap-1.5">
          {state === 'ready' && (
            <button
              type="button"
              onClick={() => onRun()}
              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-semibold bg-wm-accent text-white hover:bg-wm-accent-hover"
            >
              <Play size={11} /> Run
            </button>
          )}
          {state === 'running' && (
            <span className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-semibold bg-wm-bg-hover text-wm-text-muted">
              <Loader2 size={11} className="animate-spin" /> Running
            </span>
          )}
          {(state === 'draft' || state === 'approved') && (
            <>
              <button
                type="button"
                onClick={() => setRedoOpen(o => !o)}
                title="Redo with feedback"
                className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] font-semibold border border-wm-border bg-wm-bg-elevated hover:bg-wm-bg-hover"
              >
                <RotateCw size={11} /> Redo
              </button>
              {state === 'draft' && onApprove && (
                <button
                  type="button"
                  onClick={onApprove}
                  className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-semibold bg-wm-success text-white hover:opacity-90"
                >
                  <Check size={11} /> Approve
                </button>
              )}
            </>
          )}
          <button
            type="button"
            onClick={onEditPrompt}
            title="Edit prompt"
            className="inline-flex items-center justify-center h-7 w-7 rounded-md text-wm-text-muted hover:text-wm-text hover:bg-wm-bg-hover"
          >
            <Settings2 size={12} />
          </button>
        </div>
      </div>

      {/* Redo feedback drawer */}
      {redoOpen && (
        <div className="border-t border-wm-border bg-wm-bg-hover/40 px-3 py-2">
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">
            What should change?
          </p>
          <textarea
            value={redoText}
            onChange={e => setRedoText(e.target.value)}
            placeholder="Be specific. E.g. 'Combine About + History into one page. Bump Sermons to nav-only.'"
            rows={3}
            className="w-full text-[12px] px-2 py-1.5 rounded-md border border-wm-border bg-wm-bg-elevated focus:border-wm-accent focus:outline-none"
          />
          <div className="flex justify-end gap-2 mt-2">
            <button
              type="button"
              onClick={() => { setRedoOpen(false); setRedoText('') }}
              className="text-[11px] text-wm-text-muted hover:text-wm-text px-2 py-1"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                if (!redoText.trim()) return
                onRun(redoText.trim())
                setRedoOpen(false)
                setRedoText('')
              }}
              disabled={!redoText.trim()}
              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-semibold bg-wm-accent text-white hover:bg-wm-accent-hover disabled:opacity-40"
            >
              <RotateCw size={11} /> Redo with feedback
            </button>
          </div>
        </div>
      )}

      {/* Output preview */}
      {output && (
        <div className="border-t border-wm-border">
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-wm-text-muted hover:bg-wm-bg-hover"
          >
            {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            {expanded ? 'Hide' : 'Show'} output
          </button>
          {expanded && (
            <div className="px-3 py-2 border-t border-wm-border bg-wm-bg/40">
              {renderPreview ? renderPreview(output) : (
                <pre className="text-[10px] font-mono text-wm-text-muted whitespace-pre-wrap max-h-96 overflow-auto">
                  {JSON.stringify(output, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
