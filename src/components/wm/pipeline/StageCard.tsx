/**
 * One stage in the copywriting pipeline. Renders title + status pill
 * + Run/Redo/Edit-prompt/Gate controls. The output preview is a
 * collapsible block under the controls.
 */
import { useState } from 'react'
import { Loader2, Play, RotateCw, Check, Settings2, Eye } from 'lucide-react'
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
  /** Open the wider preview drawer (Readable + JSON toggle). Wired
   *  when the stage has an output to view. */
  onViewOutput?: () => void
  /** Optional stage-specific secondary action — used by voice_pass to
   *  surface "Apply rewrites" alongside the standard Run/Approve.
   *  Renders only when supplied AND the stage is in 'draft' or
   *  'approved' state (i.e. the artifact exists to act on). */
  extraAction?: {
    label:   string
    title?:  string
    loading?: boolean
    onClick: () => void
  }
}

export function StageCard({
  stage, state, output, redoCount, promptSource, hasAddendum,
  onRun, onApprove, onEditPrompt, onViewOutput, extraAction,
}: Props) {
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
              {extraAction && (
                <button
                  type="button"
                  onClick={extraAction.onClick}
                  title={extraAction.title}
                  disabled={extraAction.loading}
                  className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-semibold border border-wm-accent text-wm-accent-strong bg-wm-bg-elevated hover:bg-wm-accent-tint disabled:opacity-40"
                >
                  {extraAction.loading
                    ? <Loader2 size={11} className="animate-spin" />
                    : null}
                  {extraAction.label}
                </button>
              )}
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

      {/* Output preview — opens the wider drawer */}
      {output && onViewOutput && (
        <div className="border-t border-wm-border">
          <button
            type="button"
            onClick={onViewOutput}
            className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-wm-text-muted hover:bg-wm-bg-hover hover:text-wm-text"
          >
            <Eye size={11} />
            View output
            <span className="ml-auto text-[10px] text-wm-text-subtle">
              {summarizeOutput(output)}
            </span>
          </button>
        </div>
      )}
    </div>
  )
}

// One-line summary shown next to "View output" so the strategist
// knows whether it's worth opening. Falls back to key count when
// nothing more specific is recognized.
function summarizeOutput(output: Record<string, unknown>): string {
  const o = output as Record<string, any>
  // Stage 2 sitemap
  if (Array.isArray(o.pages) && Array.isArray(o.header_nav)) {
    return `${o.pages.length} pages · ${o.header_nav.length} nav items`
  }
  // Stage 4 outlines
  if (Array.isArray(o.page_outlines)) {
    const sections = o.page_outlines.reduce(
      (s: number, p: any) => s + (p?.sections?.length ?? 0), 0
    )
    return `${o.page_outlines.length} pages · ${sections} sections`
  }
  // Stage 3 placements
  if (Array.isArray(o.atom_placements)) {
    const orphans = Array.isArray(o.orphans) ? o.orphans.length : 0
    return `${o.atom_placements.length} placements · ${orphans} orphans`
  }
  // Stage 5 bind
  if (Array.isArray(o.page_results)) {
    const sections = o.page_results.reduce(
      (s: number, p: any) => s + (p?.section_results?.length ?? 0), 0
    )
    return `${o.page_results.length} pages · ${sections} sections bound`
  }
  // Stage 6 coverage
  if (Array.isArray(o.landed) || typeof o.total_score === 'number') {
    return typeof o.total_score === 'number'
      ? `${Math.round(o.total_score * 100)}% landed`
      : `${(o.landed ?? []).length} landed`
  }
  // Stage 7 voice pass
  if (Array.isArray(o.rewrites)) {
    return `${o.rewrites.length} rewrites`
  }
  // Stage 8 final qa
  if (Array.isArray(o.findings)) {
    const blockers = (o.findings as any[]).filter(f => f?.severity === 'blocker').length
    return `${o.findings.length} findings · ${blockers} blockers`
  }
  const keys = Object.keys(o).filter(k => k !== '_meta')
  return `${keys.length} fields`
}
