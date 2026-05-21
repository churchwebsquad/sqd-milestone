/**
 * Snippets bulk-import modal — paste a JSON payload that carries the
 * project's global merge fields + a full list of custom snippets.
 * The import wipes every existing custom snippet on the project
 * before inserting; the strategist confirms the wipe count on the
 * preview screen.
 */
import { useState } from 'react'
import { Tag, AlertCircle, AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react'
import { WMButton } from './Button'
import {
  isSnippetsImportPayload,
  validateSnippetsImport,
  importSnippets,
  type SnippetsImportPayload,
  type SnippetsImportPlan,
} from '../../lib/webSnippetsImport'
import type { StrategyWebProject } from '../../types/database'

interface Props {
  project: StrategyWebProject
  open:    boolean
  onClose: () => void
  /** Fires after a successful import so the parent (SnippetsWorkspace
   *  + the rail's snippet count badge) can reload. */
  onImported: () => Promise<void>
}

const PLACEHOLDER = `Paste a snippets JSON payload. Example:

{
  "globals": {
    "church_name": "Riverwood Chapel",
    "church_short_name": "Riverwood",
    "address": "1234 Main St",
    "city_state": "Kent, OH",
    "phone": "(330) 555-0101",
    "email": "hello@riverwoodchapel.org",
    "primary_service_time": "Sundays 9, 10:15, 11:30am",
    "social_facebook_url": "https://facebook.com/..."
  },
  "snippets": [
    {
      "token": "kids_check_in_url",
      "label": "Kids check-in link",
      "expansion": "https://riverwoodchapel.churchcenter.com/registrations",
      "description": "Used in Kids Wing pre-register CTAs",
      "tags": ["cta", "kids"]
    },
    {
      "token": "current_sermon_series",
      "label": "Current sermon series",
      "expansion": "The Way of Wisdom"
    }
  ]
}`

export function SnippetsImportModal({ project, open, onClose, onImported }: Props) {
  const [jsonText, setJsonText] = useState('')
  const [parseError, setParseError] = useState<string | null>(null)
  const [payload, setPayload] = useState<SnippetsImportPayload | null>(null)
  const [plan, setPlan] = useState<SnippetsImportPlan | null>(null)
  const [validating, setValidating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const [confirmWipe, setConfirmWipe] = useState(false)

  if (!open) return null

  const reset = () => {
    setJsonText('')
    setParseError(null)
    setPayload(null)
    setPlan(null)
    setImportMsg(null)
    setConfirmWipe(false)
  }

  const handleValidate = async () => {
    setParseError(null)
    setPayload(null)
    setPlan(null)
    setConfirmWipe(false)
    let parsed: unknown
    try {
      parsed = JSON.parse(jsonText)
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Invalid JSON')
      return
    }
    if (!isSnippetsImportPayload(parsed)) {
      setParseError('JSON must have a "globals" object and/or a "snippets" array.')
      return
    }
    const p = parsed as SnippetsImportPayload
    setPayload(p)
    setValidating(true)
    try {
      setPlan(await validateSnippetsImport(p, project))
    } finally {
      setValidating(false)
    }
  }

  const handleImport = async () => {
    if (!payload || !plan) return
    setImporting(true)
    setImportMsg(null)
    try {
      const { result, error } = await importSnippets(payload, project)
      if (error) {
        setImportMsg(`Error: ${error}`)
        return
      }
      if (result) {
        await onImported()
        setImportMsg(
          `Imported · ${result.snippetsInserted} new snippet${result.snippetsInserted === 1 ? '' : 's'}, ` +
          `${result.globalsUpdated} global${result.globalsUpdated === 1 ? '' : 's'} updated, ` +
          `${result.snippetsArchived} previous snippet${result.snippetsArchived === 1 ? '' : 's'} archived.`,
        )
      }
    } finally {
      setImporting(false)
    }
  }

  const wipeCount = plan?.snippetsToWipe.length ?? 0
  const canImport = plan?.valid && (wipeCount === 0 || confirmWipe) && !importing

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-wm-text/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl rounded-lg bg-wm-bg-elevated border border-wm-border shadow-xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 p-5 border-b border-wm-border shrink-0">
          <div>
            <div className="flex items-center gap-2 mb-1 text-wm-accent-strong">
              <Tag size={11} />
              <p className="text-[10px] font-bold uppercase tracking-widest">Import snippets</p>
            </div>
            <h2 className="text-[18px] font-semibold text-wm-text">Bulk-load globals + custom snippets</h2>
            <p className="text-[12px] text-wm-text-muted mt-1 max-w-xl">
              Paste a JSON payload. <span className="font-semibold text-wm-warn">The import wipes every
              existing custom snippet on this project</span> and replaces it with what's in the JSON.
              Globals are upserted column-by-column.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { reset(); onClose() }}
            disabled={importing}
            className="text-wm-text-subtle hover:text-wm-text transition-colors text-[20px] leading-none p-1"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {/* JSON paste */}
          <div>
            <label className="text-[11px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1.5 block">
              Snippets JSON
            </label>
            <textarea
              value={jsonText}
              onChange={e => setJsonText(e.target.value)}
              placeholder={PLACEHOLDER}
              disabled={importing}
              className="w-full min-h-[220px] font-mono rounded-md bg-wm-bg border border-wm-border px-3 py-2.5 text-[11px] text-wm-text placeholder-wm-text-subtle outline-none focus:border-wm-border-focus focus:ring-2 focus:ring-wm-border-focus/20 leading-relaxed"
              spellCheck={false}
            />
            <div className="flex items-center justify-between mt-2">
              <p className="text-[11px] text-wm-text-subtle">{jsonText.length} characters</p>
              <WMButton
                variant="secondary"
                size="sm"
                onClick={handleValidate}
                disabled={!jsonText.trim() || validating || importing}
                loading={validating}
              >
                {plan ? 'Re-validate' : 'Validate'}
              </WMButton>
            </div>
          </div>

          {parseError && (
            <div className="rounded-md border border-wm-danger/30 bg-wm-danger-bg p-3">
              <p className="text-[11px] uppercase tracking-widest font-bold text-wm-danger mb-1">JSON parse error</p>
              <p className="text-[12px] text-wm-text font-mono">{parseError}</p>
            </div>
          )}

          {/* Plan preview */}
          {plan && (
            <div className="space-y-3">
              {/* Status pill */}
              {!plan.valid ? (
                <div className="rounded-md border border-wm-danger/30 bg-wm-danger-bg p-3 flex items-center gap-2">
                  <AlertCircle size={14} className="text-wm-danger shrink-0" />
                  <p className="text-[13px] font-semibold text-wm-danger">
                    Can't import — {plan.issues.filter(i => i.severity === 'error').length} error(s) must be resolved
                  </p>
                </div>
              ) : (
                <div className="rounded-md border border-wm-success/30 bg-wm-success-bg p-3 flex items-start gap-2">
                  <CheckCircle2 size={14} className="text-wm-success shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-wm-success">
                      Ready to import — {plan.snippetsToInsert.length} new snippet
                      {plan.snippetsToInsert.length === 1 ? '' : 's'}
                      , {plan.globalsToUpdate.length} global
                      {plan.globalsToUpdate.length === 1 ? '' : 's'} to update
                    </p>
                  </div>
                </div>
              )}

              {/* Wipe warning — explicit + checkbox-gated when non-zero */}
              {wipeCount > 0 && (
                <div className="rounded-md border-2 border-wm-warn/40 bg-wm-warn-bg p-3">
                  <div className="flex items-start gap-2 mb-2">
                    <AlertTriangle size={14} className="text-wm-warn shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-wm-text">
                        This will archive {wipeCount} existing custom snippet
                        {wipeCount === 1 ? '' : 's'} on this project.
                      </p>
                      <p className="text-[11px] text-wm-text-muted mt-0.5 leading-snug">
                        Wipe-on-import semantics: the JSON IS the new state. Anything currently on
                        the project that isn't in this payload will be soft-deleted (archived).
                        Pages already using those tokens will render as literal <code>{'{{token}}'}</code>
                        until you re-add them or update the copy.
                      </p>
                      <details className="mt-2">
                        <summary className="text-[11px] font-semibold text-wm-text cursor-pointer hover:text-wm-accent-strong">
                          Show the {wipeCount} that will be archived
                        </summary>
                        <ul className="mt-1.5 space-y-0.5 max-h-32 overflow-y-auto text-[11px] text-wm-text">
                          {plan.snippetsToWipe.map(s => (
                            <li key={s.id}>
                              <code className="text-wm-text-subtle">{`{{${s.token}}}`}</code>
                              <span className="ml-2">{s.label}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                      <label className="flex items-center gap-2 mt-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={confirmWipe}
                          onChange={e => setConfirmWipe(e.target.checked)}
                          disabled={importing}
                          className="accent-wm-accent"
                        />
                        <span className="text-[12px] font-semibold text-wm-text">
                          I understand — wipe the existing snippets and replace them with this payload.
                        </span>
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {/* Plan tables */}
              {plan.globalsToUpdate.length > 0 && (
                <div className="rounded-md border border-wm-border bg-wm-bg-elevated p-3">
                  <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-2">
                    Globals to update · {plan.globalsToUpdate.length}
                  </p>
                  <ul className="space-y-1 text-[12px] text-wm-text">
                    {plan.globalsToUpdate.map(g => (
                      <li key={g.key} className="flex items-center gap-2 flex-wrap">
                        <code className="text-wm-accent-strong">{`{{${g.key}}}`}</code>
                        <span className="text-wm-text-subtle line-through">{g.from || '(empty)'}</span>
                        <ArrowRight size={10} className="text-wm-text-subtle" />
                        <span className="font-semibold">{g.to || '(clear)'}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {plan.snippetsToInsert.length > 0 && (
                <div className="rounded-md border border-wm-border bg-wm-bg-elevated p-3">
                  <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-2">
                    New snippets · {plan.snippetsToInsert.length}
                  </p>
                  <ul className="space-y-1 text-[12px] text-wm-text">
                    {plan.snippetsToInsert.map(s => (
                      <li key={s.token} className="flex items-start gap-2">
                        <code className="text-wm-accent-strong shrink-0">{`{{${s.token}}}`}</code>
                        <span className="text-wm-text-subtle truncate">{s.expansion}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Issues */}
              {plan.issues.length > 0 && (
                <div className="rounded-md border border-wm-border bg-wm-bg-elevated p-3">
                  <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-2">
                    Notes ({plan.issues.length})
                  </p>
                  <ul className="space-y-1.5">
                    {plan.issues.map((issue, i) => (
                      <li key={i} className="text-[12px] flex items-start gap-2">
                        <span className={[
                          'shrink-0 text-[10px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded',
                          issue.severity === 'error'   ? 'bg-wm-danger text-white' :
                          issue.severity === 'warning' ? 'bg-wm-warn text-white' :
                                                          'bg-wm-bg-hover text-wm-text-subtle',
                        ].join(' ')}>{issue.severity}</span>
                        <span className="text-wm-text">
                          <code className="text-wm-text-subtle">{issue.scope}</code> · {issue.message}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {importMsg && (
            <div className={[
              'rounded-md border p-3',
              importMsg.startsWith('Error') ? 'border-wm-danger/30 bg-wm-danger-bg' : 'border-wm-success/30 bg-wm-success-bg',
            ].join(' ')}>
              <p className="text-[13px] text-wm-text whitespace-pre-wrap">{importMsg}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-5 border-t border-wm-border shrink-0">
          <WMButton variant="ghost" size="sm" onClick={() => { reset(); onClose() }} disabled={importing}>
            Close
          </WMButton>
          {plan && (
            <WMButton
              variant="primary"
              size="sm"
              iconRight={<ArrowRight size={11} />}
              disabled={!canImport}
              loading={importing}
              onClick={handleImport}
            >
              Import snippets
            </WMButton>
          )}
        </div>
      </div>
    </div>
  )
}
