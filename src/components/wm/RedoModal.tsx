/**
 * Redo-with-changes modal — shared between workspaces.
 *
 * Collects strategist feedback that becomes the `redoContext` passed
 * to an agent endpoint. The agent reads the prior stage output from
 * the DB and refines it based on this feedback (rather than
 * rewriting from scratch).
 */

import { useState } from 'react'
import { ArrowRight, RotateCw } from 'lucide-react'
import { WMButton } from './Button'

interface RedoModalProps {
  stageNum: number
  stageTitle: string
  loading: boolean
  onClose: () => void
  onSubmit: (context: string) => void | Promise<void>
  placeholder?: string
}

const DEFAULT_PLACEHOLDER = `Examples of useful feedback:
- Move Events out from under Next Steps — they're current state, not commitment. Put them under Community or top-level.
- Rename the "Next Steps" dropdown to "Grow" so it aligns with the footer section. Use "Grow Tracks" as the actual page label.
- "Listen" contradicts the voice — switch to "Messages".
- Add a Stories page under Community. We need a home for life-change testimonies.

When the feedback is silent on something (e.g. you don't mention Give), the agent will keep that part as-is.`

export function RedoModal({
  stageNum, stageTitle, loading, onClose, onSubmit,
  placeholder = DEFAULT_PLACEHOLDER,
}: RedoModalProps) {
  const [text, setText] = useState('')
  const canSubmit = text.trim().length > 0 && !loading

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-wm-text/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-lg bg-wm-bg-elevated border border-wm-border shadow-xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between gap-3 p-5 border-b border-wm-border shrink-0">
          <div>
            <div className="flex items-center gap-2 mb-1 text-wm-accent-strong">
              <RotateCw size={11} />
              <p className="text-[10px] font-bold uppercase tracking-widest">Redo Stage {stageNum}</p>
            </div>
            <h2 className="text-[18px] font-semibold text-wm-text">Refine the {stageTitle} proposal</h2>
            <p className="text-[12px] text-wm-text-muted mt-1 max-w-lg">
              The agent will read your previous proposal and apply your feedback. It keeps what's working
              and only changes what you call out. Be specific — call out exact labels, groupings, or pages.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="text-wm-text-subtle hover:text-wm-text transition-colors text-[20px] leading-none p-1"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1">
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={placeholder}
            disabled={loading}
            className="w-full min-h-[260px] rounded-md bg-wm-bg border border-wm-border px-3 py-2.5 text-sm text-wm-text placeholder-wm-text-subtle outline-none focus:border-wm-border-focus focus:ring-2 focus:ring-wm-border-focus/20 leading-relaxed"
          />
          <p className="text-[11px] text-wm-text-subtle mt-2">
            {text.trim().length} characters · paste a full critique or short bullet points — both work.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 p-5 border-t border-wm-border shrink-0">
          <WMButton variant="ghost" size="sm" onClick={onClose} disabled={loading}>
            Cancel
          </WMButton>
          <WMButton
            variant="primary"
            size="sm"
            iconRight={<ArrowRight size={11} />}
            disabled={!canSubmit}
            loading={loading}
            onClick={() => { if (canSubmit) void onSubmit(text.trim()) }}
          >
            Submit redo
          </WMButton>
        </div>
      </div>
    </div>
  )
}
