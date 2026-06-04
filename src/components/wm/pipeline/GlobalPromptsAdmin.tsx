/**
 * Global pipeline-prompts admin panel.
 *
 * Lists all 8 stages with their current global system prompt.
 * Editable inline; saves to web_pipeline_prompts (scope='global').
 * When a row still has the placeholder marker, surfaces the built-in
 * FALLBACK prompt so the admin can pick it up + refine.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Edit3, Check, RotateCcw, AlertCircle } from 'lucide-react'
import {
  PIPELINE_STAGES,
  STAGE_LABELS,
  STAGE_NUMBER,
  STAGE_DESCRIPTIONS,
  FALLBACK_PROMPTS,
  type PipelineStage,
} from '../../../lib/pipelinePromptsCore'
import { listGlobalPrompts, updateGlobalPrompt } from '../../../lib/pipelinePrompts'

interface Row {
  stage:          PipelineStage
  system_prompt:  string
  notes:          string | null
  updated_at:     string
  is_placeholder: boolean
}

export function GlobalPromptsAdmin() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<PipelineStage | null>(null)
  const [draft, setDraft] = useState<string>('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const data = await listGlobalPrompts()
      setRows(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const rowByStage = useMemo(() => {
    const m = new Map<PipelineStage, Row>()
    for (const r of rows) m.set(r.stage, r)
    return m
  }, [rows])

  const startEdit = (stage: PipelineStage) => {
    const r = rowByStage.get(stage)
    // If still placeholder, prefill with the built-in fallback so the
    // admin can edit FROM the canonical baseline rather than from blank.
    const initial = r && !r.is_placeholder ? r.system_prompt : FALLBACK_PROMPTS[stage]
    setDraft(initial)
    setEditing(stage)
  }

  const save = async () => {
    if (!editing) return
    setSaving(true); setError(null)
    try {
      const r = await updateGlobalPrompt(editing, draft)
      if (r.error) throw new Error(r.error)
      await load()
      setEditing(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-[200px] grid place-items-center text-wm-text-muted">
        <Loader2 className="animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <header>
        <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong">Pipeline prompts</p>
        <h2 className="text-lg font-semibold text-wm-text mt-0.5">Global stage prompts</h2>
        <p className="text-[12px] text-wm-text-muted mt-1">
          One canonical system prompt per stage of the in-app copywriting
          pipeline. Changes propagate to every project unless that project
          has a per-project addendum overriding it. Use the built-in
          fallbacks as your starting point — they encode the rules each
          stage needs.
        </p>
      </header>

      {error && (
        <div className="rounded-md border border-wm-danger/30 bg-wm-danger-bg px-3 py-2 flex items-start gap-2">
          <AlertCircle size={14} className="text-wm-danger shrink-0 mt-0.5" />
          <p className="text-[12px] text-wm-danger">{error}</p>
        </div>
      )}

      {PIPELINE_STAGES.map(stage => {
        const r = rowByStage.get(stage)
        const isPlaceholder = !r || r.is_placeholder
        const isEditing = editing === stage
        return (
          <div key={stage} className="rounded-lg border border-wm-border bg-wm-bg-elevated">
            <div className="flex items-start gap-3 p-3">
              <div className="shrink-0 h-7 w-7 rounded-md bg-wm-accent-tint text-wm-accent-strong flex items-center justify-center text-[11px] font-bold font-mono">
                {STAGE_NUMBER[stage]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-wm-text">
                  {STAGE_LABELS[stage]}
                  {isPlaceholder && (
                    <span className="ml-2 text-[10px] font-normal text-wm-warning">
                      · using built-in fallback
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-wm-text-muted mt-0.5">
                  {STAGE_DESCRIPTIONS[stage]}
                </p>
                {!isEditing && r && !r.is_placeholder && (
                  <p className="text-[10px] text-wm-text-subtle mt-1">
                    Updated {new Date(r.updated_at).toLocaleDateString()}
                  </p>
                )}
              </div>
              {!isEditing && (
                <button
                  type="button"
                  onClick={() => startEdit(stage)}
                  className="shrink-0 inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-semibold border border-wm-border bg-wm-bg-elevated hover:bg-wm-bg-hover"
                >
                  <Edit3 size={11} /> Edit
                </button>
              )}
            </div>
            {isEditing ? (
              <div className="border-t border-wm-border bg-wm-bg-hover/30 p-3 space-y-2">
                <textarea
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  rows={18}
                  className="w-full text-[11px] font-mono px-3 py-2 rounded-md border border-wm-border bg-wm-bg-elevated focus:border-wm-accent focus:outline-none"
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => { setDraft(FALLBACK_PROMPTS[stage]) }}
                    title="Reset textarea to the built-in fallback"
                    className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] text-wm-text-muted hover:text-wm-text"
                  >
                    <RotateCcw size={11} /> Reset to fallback
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    className="h-7 px-3 text-[11px] text-wm-text-muted hover:text-wm-text"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={save}
                    disabled={saving}
                    className="inline-flex items-center gap-1 h-7 px-3 rounded-md text-[11px] font-semibold bg-wm-accent text-white hover:bg-wm-accent-hover disabled:opacity-40"
                  >
                    {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Save
                  </button>
                </div>
              </div>
            ) : (
              <details className="border-t border-wm-border">
                <summary className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle px-3 py-1.5 cursor-pointer hover:bg-wm-bg-hover">
                  View current
                </summary>
                <pre className="text-[10px] font-mono text-wm-text-muted whitespace-pre-wrap px-3 py-2 bg-wm-bg/40 max-h-72 overflow-auto">
                  {r && !r.is_placeholder ? r.system_prompt : FALLBACK_PROMPTS[stage]}
                </pre>
              </details>
            )}
          </div>
        )
      })}
    </div>
  )
}
