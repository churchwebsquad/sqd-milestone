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
import { ArrowRight, AlertCircle, CheckCircle2, FileText, Sparkles, RotateCw, LayoutGrid } from 'lucide-react'
import { WMButton } from './Button'
import { WMCatalogSidePanel } from './CatalogSidePanel'
import { supabase } from '../../lib/supabase'
import { fieldValuesToDocHtml, docHtmlToFieldValues } from '../../lib/webBrixiesDoc'
import type { WebContentTemplate, WebTemplateKind } from '../../types/database'
import {
  validateBrief,
  importBrief,
  importBundle,
  isPageBriefBundle,
  type PageBriefBundle,
  type PageBrief,
  type BriefValidationReport,
  type ImportResult,
} from '../../lib/webPageBrief'
import {
  isCopywriterPageOutput,
  validateCopywriterPageOutput,
  importCopywriterPageOutput,
  friendlyScanMessage,
  normalizeFieldValuesForTemplate,
  type CopywriterPageOutput,
  type CopywriterValidationReport,
} from '../../lib/webCopywriterOutput'
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
  const [bundle, setBundle] = useState<PageBriefBundle | null>(null)
  const [report, setReport] = useState<BriefValidationReport | null>(null)
  // New copywriter output path runs in parallel — same modal, same
  // textarea, different parse/validate/import functions when the JSON
  // looks like a copywriter output instead of a legacy brief.
  const [copyOutput, setCopyOutput] = useState<CopywriterPageOutput | null>(null)
  const [copyReport, setCopyReport] = useState<CopywriterValidationReport | null>(null)
  // Per-section template override: sort_order → replacement template_id.
  const [templateOverrides, setTemplateOverrides] = useState<Record<number, string>>({})
  // Per-section field_values override: sort_order → values already
  // shaped for the override template. Populated by the variant-swap
  // doc round-trip so cross-family swaps don't drop copy.
  const [fieldValuesOverrides, setFieldValuesOverrides] = useState<Record<number, Record<string, unknown>>>({})
  // When set, opens the catalog picker for a specific section so the
  // user can pick any template (cross-family) and we'll remap the
  // field_values to its schema.
  const [variantSwapForSort, setVariantSwapForSort] = useState<number | null>(null)
  const [variantSwapping, setVariantSwapping] = useState(false)
  const [validating, setValidating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [addSnippets, setAddSnippets] = useState(true)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  // Multi-page progress — current page index / total / current title.
  const [bundleProgress, setBundleProgress] = useState<{ done: number; total: number; current: string } | null>(null)

  if (!open) return null

  const reset = () => {
    setJsonText('')
    setParseError(null)
    setBrief(null)
    setBundle(null)
    setReport(null)
    setCopyOutput(null)
    setCopyReport(null)
    setTemplateOverrides({})
    setFieldValuesOverrides({})
    setVariantSwapForSort(null)
    setImportMsg(null)
    setBundleProgress(null)
  }

  /** Swap the bound template for a section and remap its field_values
   *  via the Brixies doc round-trip so copy carries across families.
   *  When the new template id matches the copywriter's original pick
   *  we treat that as "revert" — both overrides clear. */
  const applyTemplateSwap = async (sortOrder: number, newTemplateId: string) => {
    if (!copyOutput) return
    const section = copyOutput.sections.find(s => s.sort_order === sortOrder)
    if (!section) return

    // Revert path — same as copywriter's original pick.
    if (newTemplateId === section.template_id) {
      setTemplateOverrides(prev => {
        const next = { ...prev }
        delete next[sortOrder]
        return next
      })
      setFieldValuesOverrides(prev => {
        const next = { ...prev }
        delete next[sortOrder]
        return next
      })
      return
    }

    setVariantSwapping(true)
    try {
      const { data: tpls, error } = await supabase
        .from('web_content_templates')
        .select('*')
        .in('id', [section.template_id, newTemplateId])
      if (error) throw new Error(error.message)
      const rows = (tpls ?? []) as WebContentTemplate[]
      const oldTpl = rows.find(t => t.id === section.template_id) ?? null
      const newTpl = rows.find(t => t.id === newTemplateId)
      if (!newTpl) throw new Error('Selected template not found in catalog.')

      // 1. Normalize copywriter shape into canonical field_values.
      // 2. Doc round-trip via the OLD template to a Brixies doc, then
      //    parse back into the NEW template's slots. This is the same
      //    pipeline PagesWorkspace.bindSection uses for change-variant
      //    — preserves headings / body / CTAs / etc. across families.
      // 3. Pass the normalized values as existingGroupValues so any
      //    group keys that overlap between schemas survive (otherwise
      //    docHtmlToFieldValues only repopulates leaf slots).
      const normalized = normalizeFieldValuesForTemplate(oldTpl, section.field_values ?? {})
      let remapped = normalized
      if (oldTpl) {
        const docHtml = fieldValuesToDocHtml(normalized, oldTpl)
        const { field_values } = docHtmlToFieldValues(docHtml, newTpl, normalized)
        remapped = field_values
      }

      setTemplateOverrides(prev => ({ ...prev, [sortOrder]: newTemplateId }))
      setFieldValuesOverrides(prev => ({ ...prev, [sortOrder]: remapped }))
    } finally {
      setVariantSwapping(false)
    }
  }

  const handleValidate = async () => {
    setParseError(null)
    setReport(null)
    setBrief(null)
    setBundle(null)
    setCopyOutput(null)
    setCopyReport(null)
    let parsed: unknown
    try {
      // Cowork includes // line and /* block */ comments as human-readable
      // annotations in the brief output. Standard JSON.parse rejects those.
      // Strip comments + trailing commas before parsing so the strategist
      // can paste the brief verbatim without manual cleanup.
      parsed = JSON.parse(stripJsonComments(jsonText))
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Invalid JSON')
      return
    }
    // Detection order: copywriter output → bundle → legacy brief.
    // Copywriter output has strategic_setup + sections with
    // template_id + field_values; it's the most specific shape so
    // sniff for it first.
    if (isCopywriterPageOutput(parsed)) {
      const out = parsed as CopywriterPageOutput
      setCopyOutput(out)
      setValidating(true)
      try {
        setCopyReport(await validateCopywriterPageOutput(out, project))
      } finally {
        setValidating(false)
      }
      return
    }
    // Multi-page bundle? Skip validation (heavy for N pages) and route
    // straight to bulk import.
    if (isPageBriefBundle(parsed)) {
      setBundle(parsed)
      return
    }
    const single = parsed as PageBrief
    setBrief(single)
    setValidating(true)
    try {
      const r = await validateBrief(single, project)
      setReport(r)
    } finally {
      setValidating(false)
    }
  }

  const handleImportCopywriter = async () => {
    if (!copyOutput) return
    setImporting(true)
    setImportMsg(null)
    try {
      const { result, error } = await importCopywriterPageOutput(copyOutput, project, {
        templateOverrides,
        fieldValuesOverrides,
      })
      if (error) {
        setImportMsg(`Error: ${error}`)
        return
      }
      if (result) {
        // Re-use the existing onImported callback by synthesizing an
        // ImportResult-shaped payload (no auto_bind step — every
        // section is already bound to its template_id).
        await onImported({
          page_id:          result.page_id,
          created:          result.created,
          sections_created: result.sections_created,
          sections_replaced: result.sections_replaced,
          snippets_added:   0,
          auto_bind:        null,
        })
        setImportMsg(
          `${result.created ? 'Created' : 'Updated'} "${copyOutput.page_title}" · ` +
          `${result.sections_created} section${result.sections_created === 1 ? '' : 's'}` +
          `${result.sections_replaced ? ` (replaced ${result.sections_replaced})` : ''}` +
          `${result.seo_written ? ' · SEO written' : ''}.`,
        )
      }
    } finally {
      setImporting(false)
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
        const bindParts: string[] = []
        if (result.auto_bind) {
          const { curated_used, catalog_used, unbound } = result.auto_bind
          if (curated_used > 0) bindParts.push(`${curated_used} from site library`)
          if (catalog_used > 0) bindParts.push(`${catalog_used} from catalog`)
          if (unbound > 0) bindParts.push(`${unbound} stayed freehand`)
        }
        const bindSummary = bindParts.length > 0 ? ` · auto-bind: ${bindParts.join(', ')}` : ''
        setImportMsg(
          `${result.created ? 'Created' : 'Updated'} "${brief.page_title}" · ${result.sections_created} section${result.sections_created === 1 ? '' : 's'}${result.sections_replaced ? ` (replaced ${result.sections_replaced})` : ''}${result.snippets_added ? ` · added ${result.snippets_added} snippet${result.snippets_added === 1 ? '' : 's'}` : ''}${bindSummary}.`,
        )
      }
    } finally {
      setImporting(false)
    }
  }

  /** Bulk-import every page in a multi-page bundle. Progress streams via
   *  bundleProgress; final message aggregates per-page outcomes. */
  const handleBundleImport = async () => {
    if (!bundle) return
    setImporting(true)
    setImportMsg(null)
    setBundleProgress({ done: 0, total: bundle.pages.length, current: '' })
    try {
      const bundleResult = await importBundle(
        bundle, project,
        { addProposedSnippets: addSnippets },
        (done, total, current) => setBundleProgress({ done, total, current }),
      )
      // Surface the LAST successful page back to the host so the editor
      // navigates to something useful when the modal closes.
      const lastOk = [...bundleResult.results].reverse().find(r => r.result)
      if (lastOk?.result) await onImported(lastOk.result)
      const totals = bundleResult.results.reduce(
        (acc, r) => {
          if (r.result?.auto_bind) {
            acc.curated += r.result.auto_bind.curated_used
            acc.catalog += r.result.auto_bind.catalog_used
            acc.unbound += r.result.auto_bind.unbound
          }
          if (r.result) acc.sections += r.result.sections_created
          if (r.result) acc.snippets += r.result.snippets_added
          return acc
        },
        { curated: 0, catalog: 0, unbound: 0, sections: 0, snippets: 0 },
      )
      const failedList = bundleResult.results
        .filter(r => r.error)
        .map(r => `${r.page_title || r.page_slug}: ${r.error}`)
        .join(' · ')
      setImportMsg(
        `${bundleResult.succeeded}/${bundleResult.total} pages imported · ${totals.sections} sections · ${totals.snippets} snippets · ` +
        `auto-bind: ${totals.curated} site, ${totals.catalog} catalog, ${totals.unbound} freehand.` +
        (failedList ? `\nFailed: ${failedList}` : ''),
      )
    } finally {
      setImporting(false)
      setBundleProgress(null)
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
              Paste a page brief or copywriter page output. The modal auto-detects
              which shape it received. Briefs run the snippet + coverage validation
              before commit; copywriter output ships ready-bound sections and SEO
              metadata that get written directly.
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

          {/* Copywriter-output validation report */}
          {copyReport && copyOutput && (
            <div className="space-y-3">
              {(() => {
                const errCount  = copyReport.issues.filter(i => i.severity === 'error').length
                const warnCount = copyReport.issues.filter(i => i.severity === 'warning').length
                const infoCount = copyReport.issues.filter(i => i.severity === 'info').length
                if (!copyReport.valid) {
                  return (
                    <div className="rounded-md border border-wm-danger/30 bg-wm-danger-bg p-3 flex items-center gap-2">
                      <AlertCircle size={14} className="text-wm-danger shrink-0" />
                      <p className="text-[13px] font-semibold text-wm-danger">
                        Copywriter output — {errCount} error(s) must be resolved before import
                      </p>
                    </div>
                  )
                }
                return (
                  <div className="rounded-md border border-wm-success/30 bg-wm-success-bg p-3 flex items-start gap-2">
                    <CheckCircle2 size={14} className="text-wm-success shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-wm-success">
                        Copywriter output ready — "{copyOutput.page_title}" (/{copyOutput.page_slug}) ·
                        {' '}{copyOutput.sections.length} section{copyOutput.sections.length === 1 ? '' : 's'}
                      </p>
                      <p className="text-[11px] text-wm-text-muted mt-0.5">
                        {warnCount > 0 && `${warnCount} warning${warnCount === 1 ? '' : 's'} · `}
                        {infoCount > 0 && `${infoCount} note${infoCount === 1 ? '' : 's'} · `}
                        Every section ships ready-to-write field values, so no auto-bind step runs.
                      </p>
                    </div>
                  </div>
                )
              })()}

              {/* Section + template summary with inline template swap */}
              <div className="rounded-md border border-wm-border bg-wm-bg-elevated p-3">
                <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-2">
                  Sections to import · {copyOutput.sections.length}
                </p>
                <p className="text-[11px] text-wm-text-muted mb-2 leading-snug">
                  Swap the bound template for any section if the copywriter's pick is missing a
                  slot you need (e.g. a banner without a CTA).
                </p>
                <ul className="space-y-1.5">
                  {copyOutput.sections
                    .slice()
                    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                    .map(s => {
                      // Apply any user-picked override first.
                      const effectiveId   = templateOverrides[s.sort_order] ?? s.template_id
                      const broken        = copyReport.unresolved_template_ids.includes(effectiveId)
                      const overridden    = !!templateOverrides[s.sort_order]
                      const tplName       = copyReport.resolved_templates[effectiveId]
                        ?? `${effectiveId} (not in catalog)`
                      // Issues from mechanical_scan_log scoped to this
                      // section — surface inline so the strategist knows
                      // why they might want to swap.
                      const sectionIssues = (copyOutput.mechanical_scan_log ?? [])
                        .filter(m => m.section_sort === s.sort_order)

                      return (
                        <li
                          key={`${s.sort_order}-${s.template_id}`}
                          className="text-[12px] text-wm-text"
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-wm-text-subtle font-mono text-[10px] w-6 text-right shrink-0">
                              {String(s.sort_order ?? 0).padStart(2, '0')}
                            </span>
                            {/* Single swap affordance: the current template
                                renders as a button that opens the catalog
                                picker. Same flow as PagesWorkspace's
                                change-variant. */}
                            <button
                              type="button"
                              onClick={() => setVariantSwapForSort(s.sort_order)}
                              disabled={importing || variantSwapping}
                              className={[
                                'min-w-0 flex-1 inline-flex items-center justify-between gap-2 h-7 px-2.5 rounded border bg-wm-bg-elevated text-[12px] hover:border-wm-accent transition-colors disabled:opacity-50',
                                broken      ? 'border-wm-danger text-wm-danger' :
                                overridden  ? 'border-wm-accent text-wm-accent-strong' :
                                              'border-wm-border text-wm-text',
                              ].join(' ')}
                              title="Click to browse the full template catalog. Copy is remapped to the new template's schema, so cross-family swaps don't lose data."
                            >
                              <span className="truncate">{tplName}</span>
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-wm-text-subtle shrink-0">
                                <LayoutGrid size={10} /> Change
                              </span>
                            </button>
                            {overridden && (
                              <button
                                type="button"
                                onClick={() => void applyTemplateSwap(s.sort_order, s.template_id)}
                                className="inline-flex items-center gap-0.5 text-[10px] text-wm-text-subtle hover:text-wm-accent-strong shrink-0"
                                title={`Revert to the copywriter's pick (${copyReport.resolved_templates[s.template_id] ?? s.template_id})`}
                              >
                                <RotateCw size={9} /> Revert
                              </button>
                            )}
                            {s.concept_id && (
                              <span className="text-[10px] text-wm-text-subtle font-mono shrink-0">· {s.concept_id}</span>
                            )}
                          </div>
                          {/* Mechanical-fit warnings scoped to this section,
                              rewritten in plain-language so the user knows what
                              to actually DO (verify after import vs swap template). */}
                          {sectionIssues.length > 0 && (
                            <ul className="mt-1.5 ml-8 space-y-1.5">
                              {sectionIssues.map((m, i) => {
                                const f = friendlyScanMessage(m)
                                return (
                                  <li
                                    key={i}
                                    className={[
                                      'rounded-md border px-2 py-1.5 text-[10px] leading-snug',
                                      f.severity === 'action'
                                        ? 'border-wm-warning/40 bg-wm-warning-bg text-wm-text'
                                        : 'border-wm-border bg-wm-bg text-wm-text-muted',
                                    ].join(' ')}
                                  >
                                    <p className="font-semibold text-wm-text">{f.headline}</p>
                                    <p className="mt-0.5">{f.advice}</p>
                                    <details className="mt-1">
                                      <summary className="cursor-pointer text-[9px] uppercase tracking-widest font-semibold text-wm-text-subtle hover:text-wm-text">
                                        Technical detail
                                      </summary>
                                      <p className="mt-1 font-mono text-[10px] text-wm-text-subtle whitespace-pre-wrap">
                                        {f.technical}
                                      </p>
                                    </details>
                                  </li>
                                )
                              })}
                            </ul>
                          )}
                        </li>
                      )
                    })}
                </ul>
              </div>

              {/* SEO preview */}
              {copyOutput.strategic_setup && (
                <div className="rounded-md border border-wm-border bg-wm-bg-elevated p-3">
                  <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-2">
                    SEO / AEO to write
                  </p>
                  <dl className="text-[11px] space-y-1">
                    {copyOutput.strategic_setup.metadata_title && (
                      <div className="flex gap-2"><dt className="text-wm-text-subtle">Title:</dt><dd className="text-wm-text">{copyOutput.strategic_setup.metadata_title}</dd></div>
                    )}
                    {copyOutput.strategic_setup.metadata_description && (
                      <div className="flex gap-2"><dt className="text-wm-text-subtle">Meta:</dt><dd className="text-wm-text">{copyOutput.strategic_setup.metadata_description}</dd></div>
                    )}
                    {copyOutput.strategic_setup.aeo_smart_snippet && (
                      <div className="flex gap-2"><dt className="text-wm-text-subtle">AEO:</dt><dd className="text-wm-text">{copyOutput.strategic_setup.aeo_smart_snippet}</dd></div>
                    )}
                  </dl>
                </div>
              )}

              {/* Issues list — mechanical scan + gaps + kickbacks */}
              {copyReport.issues.length > 0 && (
                <div className="rounded-md border border-wm-border bg-wm-bg-elevated p-3">
                  <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-2">
                    Notes from the copywriter ({copyReport.issues.length})
                  </p>
                  <ul className="space-y-1.5">
                    {copyReport.issues.map((issue, i) => (
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
              <p className="text-[13px] text-wm-text whitespace-pre-wrap">{importMsg}</p>
            </div>
          )}

          {/* Bundle preview — multi-page payload, list the pages so the
              strategist can confirm before bulk-importing. */}
          {bundle && (
            <div className="mt-4 rounded-md border border-wm-accent/30 bg-wm-accent-tint p-3">
              <p className="text-[11px] uppercase tracking-widest font-bold text-wm-accent-strong mb-2">
                Multi-page bundle · {bundle.pages.length} page{bundle.pages.length === 1 ? '' : 's'}
              </p>
              <ul className="space-y-0.5 text-[12px] text-wm-text max-h-56 overflow-auto">
                {bundle.pages.map((p, i) => (
                  <li key={i} className="flex items-baseline gap-2">
                    <span className="text-wm-text-subtle font-mono text-[10px]">/{p.page_slug ?? ''}</span>
                    <span className="font-semibold">{p.page_title ?? `(untitled page ${i + 1})`}</span>
                    {p.sections && (
                      <span className="text-wm-text-subtle text-[11px]">
                        · {(p.sections as unknown[]).length} sections
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-wm-text-muted mt-2">
                Importing the bundle runs auto-bind on every section, page by page. Existing pages with
                matching slugs will be updated (sections replaced); new slugs create new pages.
              </p>
            </div>
          )}

          {/* Bundle progress bar — visible while bulk import is in flight. */}
          {bundleProgress && (
            <div className="mt-4 rounded-md border border-wm-border bg-wm-bg-elevated p-3">
              <div className="flex items-center justify-between mb-2 text-[12px]">
                <span className="text-wm-text">
                  Importing page {bundleProgress.done} of {bundleProgress.total}
                  {bundleProgress.current && ` · ${bundleProgress.current}`}
                </span>
                <span className="text-wm-text-subtle text-[11px]">
                  {Math.round((bundleProgress.done / Math.max(bundleProgress.total, 1)) * 100)}%
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-wm-bg-hover overflow-hidden">
                <div
                  className="h-full bg-wm-accent transition-all"
                  style={{ width: `${(bundleProgress.done / Math.max(bundleProgress.total, 1)) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-2 p-5 border-t border-wm-border shrink-0">
          <WMButton variant="ghost" size="sm" onClick={() => { reset(); onClose() }} disabled={importing}>
            Close
          </WMButton>
          {copyReport && (
            <WMButton
              variant="primary"
              size="sm"
              iconLeft={<Sparkles size={11} />}
              iconRight={<ArrowRight size={11} />}
              disabled={!copyReport.valid || importing}
              loading={importing}
              onClick={handleImportCopywriter}
            >
              Import copywriter output
            </WMButton>
          )}
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
          {bundle && (
            <WMButton
              variant="primary"
              size="sm"
              iconLeft={<Sparkles size={11} />}
              iconRight={<ArrowRight size={11} />}
              disabled={importing}
              loading={importing}
              onClick={handleBundleImport}
            >
              Import {bundle.pages.length} page{bundle.pages.length === 1 ? '' : 's'}
            </WMButton>
          )}
        </div>
      </div>

      {/* Catalog picker — opens when the user clicks "Browse" next
          to a section's template dropdown. Filtered to content/media/
          post_template kinds (same gate Pages uses for change-variant).
          On select, the doc round-trip remap runs so copy survives
          even when the new template is in a different family. */}
      {copyOutput && variantSwapForSort != null && (
        <WMCatalogSidePanel
          open={true}
          onClose={() => setVariantSwapForSort(null)}
          title="Pick a different template"
          subtitle={`Section ${variantSwapForSort}`}
          kindFilter={['content', 'media', 'post_template'] as readonly WebTemplateKind[]}
          mode="single"
          selectedIds={(() => {
            const s = copyOutput.sections.find(x => x.sort_order === variantSwapForSort)
            const tid = s ? (templateOverrides[s.sort_order] ?? s.template_id) : null
            return tid ? [tid] : []
          })()}
          onSelect={async (ids) => {
            if (ids[0] && variantSwapForSort != null) {
              await applyTemplateSwap(variantSwapForSort, ids[0])
            }
            setVariantSwapForSort(null)
          }}
        />
      )}
    </div>
  )
}
