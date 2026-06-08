/**
 * SRP Prompt Settings — admin editor for the 12 named prompts that
 * drive the SRP text generators.
 *
 * Reads/writes public.sms_prompt_settings (RLS-policied; auth required).
 * Empty rows mean "use the baked-in default from src/lib/srpPrompts.ts".
 * Save = upsert; Reset = delete the row.
 *
 * Access gated by isPromptAdmin (ashley + amber). Non-admins see a
 * read-only view so they can audit what's running but can't edit.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ChevronDown, ChevronRight, Loader2, RotateCcw, Save, Sparkles } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { isPromptAdmin } from '../lib/admin'
import {
  PROMPT_DEFAULTS, listPromptKeys, type PromptKey,
} from '../lib/srpPrompts'

interface PromptRow {
  text: string
  isCustomized: boolean
  draft: string
  dirty: boolean
  saving: boolean
  resetting: boolean
}

export default function SrpPromptSettingsPage() {
  const { user } = useAuth()
  const userEmail = user?.email ?? null
  const canEdit = isPromptAdmin(userEmail)

  const [rows, setRows] = useState<Record<string, PromptRow>>({})
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error: err } = await supabase
        .from('sms_prompt_settings')
        .select('prompt_key, prompt_text')
      if (err) throw err
      const overrides = new Map<string, string>(
        (data ?? []).map(r => [String(r.prompt_key), String(r.prompt_text ?? '')]),
      )
      const next: Record<string, PromptRow> = {}
      for (const k of listPromptKeys()) {
        const override = overrides.get(k)?.trim()
        const isCustomized = !!override && override !== PROMPT_DEFAULTS[k].defaultText
        const text = override && override.length > 0 ? override : PROMPT_DEFAULTS[k].defaultText
        next[k] = { text, isCustomized, draft: text, dirty: false, saving: false, resetting: false }
      }
      setRows(next)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load prompts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const onChangeDraft = useCallback((key: PromptKey, value: string) => {
    setRows(r => ({
      ...r,
      [key]: { ...r[key], draft: value, dirty: value !== r[key].text },
    }))
  }, [])

  const onSave = useCallback(async (key: PromptKey) => {
    setRows(r => ({ ...r, [key]: { ...r[key], saving: true } }))
    try {
      const draft = rows[key]?.draft ?? ''
      const { error: err } = await supabase
        .from('sms_prompt_settings')
        .upsert(
          { prompt_key: key, prompt_text: draft, updated_at: new Date().toISOString(), updated_by: userEmail },
          { onConflict: 'prompt_key' },
        )
      if (err) throw err
      setSavedAt(new Date().toISOString())
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
      setRows(r => ({ ...r, [key]: { ...r[key], saving: false } }))
    }
  }, [rows, refresh, userEmail])

  const onReset = useCallback(async (key: PromptKey) => {
    const ok = window.confirm(`Reset "${PROMPT_DEFAULTS[key].label}" to default? The current override will be deleted.`)
    if (!ok) return
    setRows(r => ({ ...r, [key]: { ...r[key], resetting: true } }))
    try {
      const { error: err } = await supabase
        .from('sms_prompt_settings')
        .delete()
        .eq('prompt_key', key)
      if (err) throw err
      setSavedAt(new Date().toISOString())
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reset failed')
      setRows(r => ({ ...r, [key]: { ...r[key], resetting: false } }))
    }
  }, [refresh])

  const counts = useMemo(() => {
    const total = listPromptKeys().length
    const customized = Object.values(rows).filter(r => r.isCustomized).length
    return { total, customized }
  }, [rows])

  return (
    <div className="min-h-full bg-wm-bg py-6 px-4 md:px-6">
      <div className="max-w-4xl mx-auto">
        <Link to="/social/srp" className="inline-flex items-center gap-1 text-[12px] text-wm-text-muted hover:text-wm-text mb-3">
          <ArrowLeft size={12} /> SRP dashboard
        </Link>

        <header className="flex items-baseline justify-between gap-3 mb-5">
          <div>
            <h1 className="text-[22px] font-semibold text-wm-text">SRP Prompt Settings</h1>
            <p className="text-[13px] text-wm-text-muted mt-1">
              {counts.customized} of {counts.total} prompts customized. Empty edits revert to the baked-in default.
            </p>
          </div>
          {savedAt && (
            <span className="text-[11px] text-wm-text-subtle inline-flex items-center gap-1">
              <Save size={11} /> Saved {new Date(savedAt).toLocaleTimeString()}
            </span>
          )}
        </header>

        {!canEdit && (
          <div className="rounded-md border border-wm-warning/30 bg-wm-warning-bg px-3 py-2 text-[12px] text-wm-warning mb-3">
            Read-only mode. Editing prompt settings is restricted to the team owners (ashley + amber). You can review what's running below.
          </div>
        )}

        {error && (
          <div className="rounded-md border border-wm-danger/30 bg-wm-danger-bg px-3 py-2 text-[12px] text-wm-danger mb-3">{error}</div>
        )}

        {loading ? (
          <div className="p-8 text-center text-[12px] text-wm-text-muted">
            <Loader2 size={16} className="animate-spin inline mr-2" /> Loading prompts…
          </div>
        ) : (
          <div className="space-y-2">
            {listPromptKeys().map(key => {
              const row = rows[key]
              if (!row) return null
              const isOpen = open[key] ?? false
              return (
                <div key={key} className="rounded-lg border border-wm-border bg-wm-bg-elevated">
                  <button
                    onClick={() => setOpen(o => ({ ...o, [key]: !isOpen }))}
                    className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-wm-accent/5"
                  >
                    {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <span className="flex-1">
                      <span className="text-[13px] font-semibold text-wm-text">{PROMPT_DEFAULTS[key].label}</span>
                      <span className="text-[10px] font-mono text-wm-text-subtle ml-2">{key}</span>
                    </span>
                    {row.isCustomized && (
                      <span className="text-[10px] uppercase tracking-wider font-bold bg-wm-accent/10 text-wm-accent-strong px-2 py-0.5 rounded">
                        Customized
                      </span>
                    )}
                    {row.dirty && (
                      <span className="text-[10px] uppercase tracking-wider font-bold bg-wm-warning/10 text-wm-warning px-2 py-0.5 rounded">
                        Unsaved
                      </span>
                    )}
                  </button>
                  {isOpen && (
                    <div className="border-t border-wm-border p-4 space-y-3">
                      <textarea
                        value={row.draft}
                        onChange={e => onChangeDraft(key, e.target.value)}
                        disabled={!canEdit}
                        rows={Math.min(24, Math.max(8, row.draft.split('\n').length + 1))}
                        className="w-full rounded-md border border-wm-border bg-wm-bg px-3 py-2 text-[13px] font-mono focus:outline-none focus:border-wm-accent disabled:opacity-60 whitespace-pre-wrap"
                      />
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[10px] text-wm-text-subtle">
                          {row.draft.length.toLocaleString()} characters
                        </p>
                        <div className="flex items-center gap-2">
                          {canEdit && row.isCustomized && (
                            <button
                              onClick={() => void onReset(key)}
                              disabled={row.resetting || row.saving}
                              className="inline-flex items-center gap-1.5 text-[11px] text-wm-text-muted hover:text-wm-text px-3 py-1 disabled:opacity-50"
                            >
                              {row.resetting ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
                              Reset to default
                            </button>
                          )}
                          {canEdit && (
                            <button
                              onClick={() => void onSave(key)}
                              disabled={!row.dirty || row.saving}
                              className="inline-flex items-center gap-1.5 rounded-full bg-wm-accent px-4 py-1.5 text-[12px] text-white font-semibold disabled:opacity-50"
                            >
                              {row.saving ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                              Save
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
