/**
 * Edit-prompt slide-out for a single stage. Shows the resolved
 * system prompt (read-only), the global source indicator, and a
 * textarea for the project addendum. Saving writes to
 * web_pipeline_prompts (scope='project') via upsertProjectAddendum.
 */
import { useEffect, useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import { STAGE_LABELS, type PipelineStage } from '../../../lib/pipelinePromptsCore'
import {
  resolvePrompt,
  getProjectAddendum,
  upsertProjectAddendum,
  clearProjectAddendum,
} from '../../../lib/pipelinePrompts'

interface Props {
  stage:     PipelineStage
  projectId: string
  onClose:   () => void
  onSaved:   () => void
}

export function PromptDrawer({ stage, projectId, onClose, onSaved }: Props) {
  const [loading, setLoading] = useState(true)
  const [resolvedText, setResolvedText] = useState('')
  const [globalSource, setGlobalSource] = useState<'db'|'fallback'>('fallback')
  const [addendum, setAddendum] = useState('')
  const [originalAddendum, setOriginalAddendum] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      const [res, pa] = await Promise.all([
        resolvePrompt(stage, projectId),
        getProjectAddendum(stage, projectId),
      ])
      if (cancelled) return
      setResolvedText(res.systemPrompt)
      setGlobalSource(res.globalSource)
      setAddendum(pa ?? '')
      setOriginalAddendum(pa ?? '')
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [stage, projectId])

  const dirty = addendum.trim() !== originalAddendum.trim()

  const save = async () => {
    setSaving(true); setError(null)
    try {
      const trimmed = addendum.trim()
      if (trimmed === '') {
        const r = await clearProjectAddendum(stage, projectId)
        if (r.error) throw new Error(r.error)
      } else {
        const r = await upsertProjectAddendum(stage, projectId, trimmed)
        if (r.error) throw new Error(r.error)
      }
      setOriginalAddendum(addendum)
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
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
      <div className="w-full max-w-2xl bg-wm-bg-elevated border-l border-wm-border overflow-y-auto">
        <div className="sticky top-0 z-10 bg-wm-bg-elevated border-b border-wm-border px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong">Edit prompt</p>
            <p className="text-[14px] font-semibold text-wm-text">{STAGE_LABELS[stage]}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-7 w-7 rounded-md hover:bg-wm-bg-hover flex items-center justify-center text-wm-text-muted"
          >
            <X size={14} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {loading ? (
            <p className="flex items-center gap-2 text-[12px] text-wm-text-muted">
              <Loader2 size={12} className="animate-spin" /> Loading…
            </p>
          ) : (
            <>
              <section>
                <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">
                  Resolved system prompt
                  {globalSource === 'fallback' && (
                    <span className="ml-2 text-wm-text-muted normal-case tracking-normal text-[10px]">
                      · using built-in fallback (global has placeholder)
                    </span>
                  )}
                </p>
                <pre className="text-[10px] font-mono text-wm-text-muted whitespace-pre-wrap bg-wm-bg p-3 rounded border border-wm-border max-h-80 overflow-auto">
                  {resolvedText}
                </pre>
                <p className="text-[10px] text-wm-text-subtle mt-1">
                  Globals are edited from Settings → Pipeline prompts.
                  Per-project changes use the addendum below.
                </p>
              </section>

              <section>
                <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">
                  Project addendum
                </p>
                <p className="text-[11px] text-wm-text-muted mb-2">
                  Appended to the global. Use this for project-specific guidance
                  (denominational tone, layout preferences, naming conventions).
                  Leave blank to use the pure global default.
                </p>
                <textarea
                  value={addendum}
                  onChange={e => setAddendum(e.target.value)}
                  rows={10}
                  placeholder="e.g. Riverwood prefers split-column treatments for ministry pages. Use 'gatherings' instead of 'services' throughout."
                  className="w-full text-[12px] font-mono px-3 py-2 rounded-md border border-wm-border bg-wm-bg focus:border-wm-accent focus:outline-none"
                />
              </section>

              {error && (
                <p className="text-[12px] text-wm-danger">{error}</p>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-wm-border">
                <p className="text-[10px] text-wm-text-subtle">
                  {originalAddendum
                    ? 'A project addendum is set. Clearing the textarea + saving removes it.'
                    : 'No project addendum yet.'}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="h-7 px-3 text-[11px] text-wm-text-muted hover:text-wm-text"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={save}
                    disabled={!dirty || saving}
                    className="inline-flex items-center gap-1 h-7 px-3 rounded-md text-[11px] font-semibold bg-wm-accent text-white hover:bg-wm-accent-hover disabled:opacity-40"
                  >
                    {saving ? <Loader2 size={11} className="animate-spin" /> : null}
                    Save
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
