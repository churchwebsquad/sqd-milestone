/**
 * Shared layout for every SRP generator. Each generator owns its own
 * input controls + onGenerate callback; this shell renders the header,
 * the generate button, the elapsed-time signal, and the output area
 * with an editable textarea + save flow.
 */

import { useEffect, useState } from 'react'
import { Loader2, RefreshCw, Save, Sparkles } from 'lucide-react'

export function GeneratorShell({
  title, description, value, onSave, onGenerate, busy, error, lastTook,
  extraControls, outputRenderer,
}: {
  title: string
  description: string
  value: string                                  // current saved output
  onSave: (next: string) => Promise<void>
  onGenerate: () => Promise<void>
  busy: boolean
  error: string | null
  lastTook?: number | null                       // seconds the last generation took
  extraControls?: React.ReactNode                // pre-generate inputs (e.g. recap_type)
  outputRenderer?: (val: string) => React.ReactNode  // optional richer renderer beside the textarea
}) {
  const [draft, setDraft] = useState(value)
  const [savingEdit, setSavingEdit] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  // Keep the textarea in sync if the upstream value changes (e.g. after
  // a successful generation).
  useEffect(() => { setDraft(value) }, [value])

  const dirty = draft !== value
  const empty = !value

  return (
    <div className="rounded-lg border border-wm-border bg-wm-bg-elevated">
      <header className="px-4 py-3 border-b border-wm-border">
        <h3 className="text-[14px] font-semibold text-wm-text">{title}</h3>
        <p className="text-[11px] text-wm-text-muted mt-0.5">{description}</p>
      </header>

      <div className="p-4 space-y-3">
        {extraControls}

        <div className="flex items-center gap-3">
          <button
            onClick={() => void onGenerate()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-full bg-wm-accent px-4 py-1.5 text-[12px] text-white font-semibold disabled:opacity-50"
          >
            {busy
              ? <><Loader2 size={12} className="animate-spin" /> Generating…</>
              : empty
                ? <><Sparkles size={12} /> Generate</>
                : <><RefreshCw size={12} /> Regenerate</>}
          </button>
          {lastTook != null && !busy && (
            <span className="text-[11px] text-wm-text-subtle">Last run: {lastTook}s</span>
          )}
          {error && (
            <span className="text-[11px] text-wm-danger">{error}</span>
          )}
        </div>

        {empty && !busy && (
          <p className="text-[12px] text-wm-text-muted italic">No output yet. Click Generate to start.</p>
        )}

        {(value || draft) && (
          <div className="space-y-2">
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              rows={Math.min(20, Math.max(6, (draft ?? '').split('\n').length + 1))}
              className="w-full rounded-md border border-wm-border bg-wm-bg px-3 py-2 text-[13px] focus:outline-none focus:border-wm-accent whitespace-pre-wrap"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-wm-text-subtle">
                {draft.length.toLocaleString()} characters
              </span>
              <div className="flex items-center gap-2">
                {savedAt && !dirty && (
                  <span className="text-[11px] text-wm-text-subtle inline-flex items-center gap-1">
                    <Save size={11} /> Saved {new Date(savedAt).toLocaleTimeString()}
                  </span>
                )}
                {dirty && (
                  <button
                    onClick={async () => {
                      setSavingEdit(true)
                      try {
                        await onSave(draft)
                        setSavedAt(new Date().toISOString())
                      } finally { setSavingEdit(false) }
                    }}
                    disabled={savingEdit}
                    className="inline-flex items-center gap-1.5 rounded-full bg-wm-accent px-3 py-1 text-[11px] text-white disabled:opacity-50"
                  >
                    {savingEdit ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                    Save edit
                  </button>
                )}
              </div>
            </div>
            {outputRenderer && !dirty && (
              <div className="pt-2 border-t border-wm-border">
                {outputRenderer(value)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
