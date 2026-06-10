/**
 * Shared layout for every SRP generator. Each generator owns its own
 * input controls + onGenerate callback; this shell renders the header,
 * the generate button, the elapsed-time signal, and the output area
 * with an editable textarea + save flow.
 *
 * Visual styling matches the new SRP step panels (white card on Cream
 * canvas, Lavender 1px border, Deep Plum text). Buttons go through
 * SrpButton so pill shape + CMS-brand colors stay consistent.
 */

import { useEffect, useState } from 'react'
import { RefreshCw, Save, Sparkles, FileText, AlertCircle } from 'lucide-react'
import { SrpButton } from '../_shared/SrpButton'

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
    <section className="rounded-xl border border-[var(--color-lavender)] bg-white overflow-hidden">
      <header className="px-5 py-4 border-b border-[var(--color-lavender)] bg-white flex items-start gap-3">
        <span className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--color-lavender-tint)] text-[var(--color-primary-purple)]">
          <FileText size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-semibold text-[var(--color-deep-plum)]">{title}</h3>
          <p className="text-[11px] text-[var(--color-purple-gray)] mt-0.5 leading-snug">{description}</p>
        </div>
        {value && !empty && (
          <span className="shrink-0 text-[10px] uppercase tracking-[0.12em] font-bold text-wm-success bg-wm-success-bg px-2 py-1 rounded-full">
            Generated
          </span>
        )}
      </header>

      <div className="p-5 space-y-4">
        {extraControls}

        <div className="flex items-center flex-wrap gap-3">
          <SrpButton
            variant="secondary"
            onClick={() => void onGenerate()}
            busy={busy}
            leadingIcon={empty ? <Sparkles size={14} /> : <RefreshCw size={14} />}
          >
            {busy ? 'Generating…' : empty ? 'Generate' : 'Regenerate'}
          </SrpButton>
          {lastTook != null && !busy && (
            <span className="text-[11px] text-[var(--color-purple-gray)]">Last run: {lastTook}s</span>
          )}
          {error && (
            <span className="inline-flex items-center gap-1 text-[11px] text-wm-danger">
              <AlertCircle size={11} /> {error}
            </span>
          )}
        </div>

        {empty && !busy && (
          <div className="rounded-lg border border-dashed border-[var(--color-lavender)] bg-[var(--color-cream)] px-4 py-6 text-center">
            <Sparkles size={18} className="inline text-[var(--color-primary-purple)] mb-1.5" />
            <p className="text-[12px] text-[var(--color-purple-gray)] italic">
              No output yet — click <span className="font-semibold text-[var(--color-deep-plum)] not-italic">Generate</span> to start.
            </p>
          </div>
        )}

        {(value || draft) && (
          <div className="space-y-2">
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              rows={Math.min(20, Math.max(6, (draft ?? '').split('\n').length + 1))}
              className="w-full rounded-lg border border-[var(--color-lavender)] bg-[var(--color-cream)] px-4 py-3 text-[13px] text-[var(--color-deep-plum)] focus:outline-none focus:border-[var(--color-primary-purple)] focus:ring-2 focus:ring-[var(--color-lavender)] whitespace-pre-wrap leading-relaxed"
            />
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-[10px] text-[var(--color-purple-gray)]">
                {draft.length.toLocaleString()} characters
              </span>
              <div className="flex items-center gap-2">
                {savedAt && !dirty && (
                  <span className="text-[11px] text-[var(--color-purple-gray)] inline-flex items-center gap-1">
                    <Save size={11} /> Saved {new Date(savedAt).toLocaleTimeString()}
                  </span>
                )}
                {dirty && (
                  <SrpButton
                    variant="primary"
                    size="sm"
                    onClick={async () => {
                      setSavingEdit(true)
                      try {
                        await onSave(draft)
                        setSavedAt(new Date().toISOString())
                      } finally { setSavingEdit(false) }
                    }}
                    busy={savingEdit}
                    leadingIcon={<Save size={12} />}
                  >
                    Save edit
                  </SrpButton>
                )}
              </div>
            </div>
            {outputRenderer && !dirty && (
              <div className="pt-3 border-t border-[var(--color-lavender)]">
                {outputRenderer(value)}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
