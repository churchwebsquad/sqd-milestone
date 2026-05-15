/**
 * Page Brief Import Modal — paste a cowork-produced JSON brief,
 * preview validation + coverage, commit to web_pages + web_sections.
 *
 * MVP behavior:
 *  - Validation pass surfaces snippet gaps, [NEEDS INPUT:] placeholders,
 *    and content_assignments coverage orphans
 *  - Import creates the page if missing, updates if exists, replaces
 *    all sections with freehand TipTap blocks from the brief
 *  - Step 2 (later) will add Brixies template fitting + overflow panel
 */

import { useState } from 'react'
import { ArrowRight, AlertCircle, CheckCircle2, FileText, Sparkles } from 'lucide-react'
import { WMButton } from './Button'
import {
  validateBrief,
  importBrief,
  type PageBrief,
  type BriefValidationReport,
  type ImportResult,
} from '../../lib/webPageBrief'
import type { StrategyWebProject } from '../../types/database'

interface Props {
  project: StrategyWebProject
  open: boolean
  onClose: () => void
  onImported: (result: ImportResult) => void | Promise<void>
}

/**
 * Strip // line comments and /* block comments * / from a JSON-ish string,
 * plus any trailing commas before }/]. Respects string boundaries so
 * comment-shaped substrings inside string values are preserved.
 *
 * Cowork's brief output is annotated with // headers and inline
 * commentary; this lets the strategist paste verbatim.
 */
function stripJsonComments(input: string): string {
  let out = ''
  let i = 0
  let inString = false
  let stringQuote: string | null = null

  while (i < input.length) {
    const ch = input[i]
    const next = input[i + 1]

    // Inside a string — pass through, handle escapes
    if (inString) {
      out += ch
      if (ch === '\\' && next != null) {
        out += next
        i += 2
        continue
      }
      if (ch === stringQuote) {
        inString = false
        stringQuote = null
      }
      i++
      continue
    }

    // Entering a string
    if (ch === '"' || ch === "'") {
      inString = true
      stringQuote = ch
      out += ch
      i++
      continue
    }

    // Line comment: //... until newline
    if (ch === '/' && next === '/') {
      i += 2
      while (i < input.length && input[i] !== '\n') i++
      continue  // leave the newline to be emitted on next iteration
    }

    // Block comment: /* ... */
    if (ch === '/' && next === '*') {
      i += 2
      while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i++
      i += 2  // skip closing */
      continue
    }

    out += ch
    i++
  }

  // Strip trailing commas before } or ]
  return out.replace(/,(\s*[}\]])/g, '$1')
}

const PLACEHOLDER = `Paste a cowork-produced page brief JSON here. Example shape:

{
  "page_slug": "sundays",
  "page_title": "Sundays",
  "phase": "1",
  "page_purpose": "...",
  "content_assignments": [...],
  "hero": { "tagline": "...", "h1": "...", "body": "...", "primary_cta": {...} },
  "sections": [
    {
      "section_id": "service-times-location",
      "suggested_template_family": "Feature Section",
      "content_items": [...],
      "fields": { "h": "...", "d": "...", "cta": {...} }
    }
  ],
  "snippets_proposed_new": [...],
  "cs_flags": {...}
}`

export function PageBriefImportModal({ project, open, onClose, onImported }: Props) {
  const [jsonText, setJsonText] = useState('')
  const [parseError, setParseError] = useState<string | null>(null)
  const [brief, setBrief] = useState<PageBrief | null>(null)
  const [report, setReport] = useState<BriefValidationReport | null>(null)
  const [validating, setValidating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [addSnippets, setAddSnippets] = useState(true)
  const [importMsg, setImportMsg] = useState<string | null>(null)

  if (!open) return null

  const reset = () => {
    setJsonText('')
    setParseError(null)
    setBrief(null)
    setReport(null)
    setImportMsg(null)
  }

  const handleValidate = async () => {
    setParseError(null)
    setReport(null)
    setBrief(null)
    let parsed: PageBrief
    try {
      // Cowork includes // line and /* block */ comments as human-readable
      // annotations in the brief output. Standard JSON.parse rejects those.
      // Strip comments + trailing commas before parsing so the strategist
      // can paste the brief verbatim without manual cleanup.
      parsed = JSON.parse(stripJsonComments(jsonText)) as PageBrief
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Invalid JSON')
      return
    }
    setBrief(parsed)
    setValidating(true)
    try {
      const r = await validateBrief(parsed, project)
      setReport(r)
    } finally {
      setValidating(false)
    }
  }

  const handleImport = async () => {
    if (!brief) return
    setImporting(true)
    setImportMsg(null)
    try {
      const { result, error } = await importBrief(brief, project, {
        addProposedSnippets: addSnippets,
      })
      if (error) {
        setImportMsg(`Error: ${error}`)
        return
      }
      if (result) {
        await onImported(result)
        setImportMsg(
          `${result.created ? 'Created' : 'Updated'} "${brief.page_title}" · ${result.sections_created} section${result.sections_created === 1 ? '' : 's'}${result.sections_replaced ? ` (replaced ${result.sections_replaced})` : ''}${result.snippets_added ? ` · added ${result.snippets_added} snippet${result.snippets_added === 1 ? '' : 's'}` : ''}.`,
        )
      }
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-wm-text/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl rounded-lg bg-wm-bg-elevated border border-wm-border shadow-xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 p-5 border-b border-wm-border shrink-0">
          <div>
            <div className="flex items-center gap-2 mb-1 text-wm-accent-strong">
              <FileText size={11} />
              <p className="text-[10px] font-bold uppercase tracking-widest">Import page brief</p>
            </div>
            <h2 className="text-[18px] font-semibold text-wm-text">From cowork JSON</h2>
            <p className="text-[12px] text-wm-text-muted mt-1 max-w-xl">
              Paste a page brief. Validation surfaces snippet gaps + needs-input markers + coverage orphans
              before you commit. Import creates the page if missing, replaces sections from the brief.
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
              Page brief JSON
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
              <p className="text-[11px] text-wm-text-subtle">
                {jsonText.length} characters
              </p>
              <WMButton
                variant="secondary"
                size="sm"
                onClick={handleValidate}
                disabled={!jsonText.trim() || validating || importing}
                loading={validating}
              >
                {report ? 'Re-validate' : 'Validate'}
              </WMButton>
            </div>
          </div>

          {/* Parse error */}
          {parseError && (
            <div className="rounded-md border border-wm-danger/30 bg-wm-danger-bg p-3">
              <p className="text-[11px] uppercase tracking-widest font-bold text-wm-danger mb-1">JSON parse error</p>
              <p className="text-[12px] text-wm-text font-mono">{parseError}</p>
            </div>
          )}

          {/* Validation report */}
          {report && brief && (
            <div className="space-y-3">
              {/* Status pill — warnings don't block import; only true errors do */}
              {(() => {
                const warningCount = report.issues.filter(i => i.severity === 'warning').length
                if (!report.valid) {
                  return (
                    <div className="rounded-md border border-wm-danger/30 bg-wm-danger-bg p-3 flex items-center gap-2">
                      <AlertCircle size={14} className="text-wm-danger shrink-0" />
                      <p className="text-[13px] font-semibold text-wm-danger">
                        Cannot import — {report.issues.filter(i => i.severity === 'error').length} error(s) must be resolved
                      </p>
                    </div>
                  )
                }
                if (warningCount > 0) {
                  return (
                    <div className="rounded-md border border-wm-warning/30 bg-wm-warning-bg p-3 flex items-center gap-2">
                      <AlertCircle size={14} className="text-wm-warning shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold text-wm-text">
                          Ready to import with {warningCount} warning{warningCount === 1 ? '' : 's'} — "{brief.page_title}" (/{brief.page_slug})
                        </p>
                        <p className="text-[12px] text-wm-text-muted">
                          Page will import. Warnings stay flagged so they're addressable after — they don't block the import itself.
                        </p>
                      </div>
                    </div>
                  )
                }
                return (
                  <div className="rounded-md border border-wm-success/30 bg-wm-success-bg p-3 flex items-center gap-2">
                    <CheckCircle2 size={14} className="text-wm-success shrink-0" />
                    <p className="text-[13px] font-semibold text-wm-success">
                      Ready to import — "{brief.page_title}" (/{brief.page_slug})
                    </p>
                  </div>
                )
              })()}

              {/* Issues list */}
              {report.issues.length > 0 && (
                <div className="rounded-md border border-wm-border bg-wm-bg-elevated p-3">
                  <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-2">
                    Validation issues ({report.issues.length})
                  </p>
                  <ul className="space-y-1.5">
                    {report.issues.map((issue, i) => (
                      <li key={i} className="text-[12px] flex items-start gap-2">
                        <span className={[
                          'shrink-0 text-[10px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded',
                          issue.severity === 'error'   ? 'bg-wm-danger text-white' :
                          issue.severity === 'warning' ? 'bg-wm-warning text-white' :
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

              {/* Snippets */}
              {(report.snippets_referenced.length > 0 || report.snippets_to_add.length > 0) && (
                <div className="rounded-md border border-wm-border bg-wm-bg-elevated p-3">
                  <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-2">
                    Snippets · {report.snippets_referenced.length} referenced
                    {report.snippets_resolvable_via_proposed.length > 0 && (
                      <span className="text-wm-accent-strong ml-1">· {report.snippets_resolvable_via_proposed.length} will resolve on import</span>
                    )}
                    {report.snippets_unresolved.length > 0 && (
                      <span className="text-wm-warning ml-1">· {report.snippets_unresolved.length} unresolved</span>
                    )}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {report.snippets_referenced.map(t => {
                      const willResolve = report.snippets_resolvable_via_proposed.includes(t)
                      const unresolved = report.snippets_unresolved.includes(t)
                      let cls = 'bg-wm-bg-hover text-wm-text-muted'  // known/in-library default
                      let title = 'Resolves from project snippet library'
                      if (willResolve) {
                        cls = 'bg-wm-ai-bg text-wm-accent-strong border border-wm-ai-border'
                        title = "Cowork proposed this snippet — it'll be added on import (if checkbox is on) and resolve correctly"
                      } else if (unresolved) {
                        cls = 'bg-wm-warning-bg text-wm-warning border border-wm-warning/30'
                        title = 'Not in library and no proposed-new entry — will render as a literal {{token}} until you add the snippet manually'
                      }
                      return (
                        <code
                          key={t}
                          className={['text-[11px] px-1.5 py-0.5 rounded', cls].join(' ')}
                          title={title}
                        >
                          {`{{${t}}}`}
                        </code>
                      )
                    })}
                  </div>
                  {report.snippets_to_add.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-wm-border">
                      <p className="text-[11px] text-wm-text-muted mb-1.5">
                        Cowork proposed {report.snippets_to_add.length} new snippet{report.snippets_to_add.length === 1 ? '' : 's'} to add:
                      </p>
                      <ul className="space-y-1">
                        {report.snippets_to_add.map((s, i) => (
                          <li key={i} className="text-[12px] text-wm-text">
                            <code className="text-wm-accent-strong">{s.key}</code>
                            <span className="text-wm-text-muted"> → "{s.value}"</span>
                            {s.rationale && <span className="text-wm-text-subtle"> · {s.rationale}</span>}
                          </li>
                        ))}
                      </ul>
                      <label className="flex items-center gap-2 mt-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={addSnippets}
                          onChange={e => setAddSnippets(e.target.checked)}
                          className="accent-wm-accent"
                        />
                        <span className="text-[12px] text-wm-text">
                          Add these to the project's snippet library on import
                        </span>
                      </label>
                    </div>
                  )}
                </div>
              )}

              {/* [NEEDS INPUT:] placeholders */}
              {report.needs_input.length > 0 && (
                <div className="rounded-md border border-wm-warning/30 bg-wm-warning-bg p-3">
                  <p className="text-[10px] uppercase tracking-widest font-bold text-wm-warning mb-2">
                    [NEEDS INPUT] · {report.needs_input.length}
                  </p>
                  <ul className="space-y-1">
                    {report.needs_input.map((n, i) => (
                      <li key={i} className="text-[12px] text-wm-text">
                        <code className="text-wm-text-subtle">{n.scope}</code>: {n.label}
                      </li>
                    ))}
                  </ul>
                  <p className="text-[11px] text-wm-text-muted mt-2 italic">
                    Page can be imported, but these must be resolved before the page goes live.
                  </p>
                </div>
              )}

              {/* Coverage orphans */}
              {report.coverage_orphans.length > 0 && (
                <div className="rounded-md border border-wm-warning/30 bg-wm-warning-bg p-3">
                  <p className="text-[10px] uppercase tracking-widest font-bold text-wm-warning mb-2">
                    Coverage orphans · {report.coverage_orphans.length}
                  </p>
                  <p className="text-[11px] text-wm-text-muted mb-1.5">
                    Content_assignments items not claimed by any section's content_items:
                  </p>
                  <ul className="space-y-0.5">
                    {report.coverage_orphans.map((c, i) => (
                      <li key={i} className="text-[12px] text-wm-text">· {c}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Import result */}
          {importMsg && (
            <div className={[
              'rounded-md border p-3',
              importMsg.startsWith('Error') ? 'border-wm-danger/30 bg-wm-danger-bg' : 'border-wm-success/30 bg-wm-success-bg',
            ].join(' ')}>
              <p className="text-[13px] text-wm-text">{importMsg}</p>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-2 p-5 border-t border-wm-border shrink-0">
          <WMButton variant="ghost" size="sm" onClick={() => { reset(); onClose() }} disabled={importing}>
            Close
          </WMButton>
          {report && (
            <WMButton
              variant="primary"
              size="sm"
              iconLeft={<Sparkles size={11} />}
              iconRight={<ArrowRight size={11} />}
              disabled={!report.valid || importing}
              loading={importing}
              onClick={handleImport}
            >
              Import page
            </WMButton>
          )}
        </div>
      </div>
    </div>
  )
}
