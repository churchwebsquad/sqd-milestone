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

import { useEffect, useState } from 'react'
import { ArrowRight, AlertCircle, CheckCircle2, FileText, Sparkles, RotateCw, LayoutGrid } from 'lucide-react'
import { WMButton } from './Button'
import { WMCatalogSidePanel } from './CatalogSidePanel'
import { supabase } from '../../lib/supabase'
import {
  fieldValuesToDocHtml, docHtmlToFieldValues, reconcileFieldValuesAcrossTemplates,
  valuesToDocHtmlByShape, computeUnmappedValues, mergeFieldValuesPreferNonEmpty,
} from '../../lib/webBrixiesDoc'
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
  isCopywriterPageBundle,
  normalizeCopywriterPageOutput,
  validateCopywriterPageOutput,
  importCopywriterPageOutput,
  friendlyScanMessage,
  normalizeFieldValuesForTemplate,
  analyzeBundleFit,
  pairBundleTemplates,
  type CopywriterPageOutput,
  type CopywriterValidationReport,
  type SectionFitDiagnostic,
} from '../../lib/webCopywriterOutput'
import type { SectionPairResult } from '../../lib/webBrixiesPairer'
import { importSnippets, isSnippetsImportPayload, type SnippetsImportPayload } from '../../lib/webSnippetsImport'
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

/** Glanceable health dot next to each section in the bundle list.
 *  Green  = the bound template will accept every leaf of source.
 *  Amber  = some source content lands in __unmapped or drops entirely
 *           — still importable but worth swapping if the user cares.
 *  Red    = the template lookup itself is broken (no `fields` resolved);
 *           takes precedence over fit. */
function FitChip({
  fit, broken,
}: {
  fit: SectionFitDiagnostic | undefined
  broken: boolean
}) {
  if (broken) {
    return (
      <span title="Template not in catalog" className="shrink-0 inline-flex items-center justify-center w-2 h-2 rounded-full bg-wm-danger" />
    )
  }
  if (!fit) {
    return <span className="shrink-0 inline-flex items-center justify-center w-2 h-2 rounded-full bg-wm-border-strong/40" />
  }
  const { health, unmapped_source_keys, dropped_paths } = fit
  const tooltip = health === 'clean'
    ? 'Clean fit — all source content will land in the bound template.'
    : health === 'attention'
      ? 'Likely wrong template — most source content will not render. Consider swapping.'
      : `${unmapped_source_keys.length} unmapped key${unmapped_source_keys.length === 1 ? '' : 's'}, ${dropped_paths.length} dropped path${dropped_paths.length === 1 ? '' : 's'}.`
  const cls = health === 'clean'
    ? 'bg-wm-success'
    : health === 'attention'
      ? 'bg-wm-danger'
      : 'bg-wm-warning'
  return (
    <span title={tooltip} className={`shrink-0 inline-flex items-center justify-center w-2 h-2 rounded-full ${cls}`} />
  )
}

/** Inline expansion of a non-clean fit: lists the source keys that
 *  would fall into __unmapped and the deep paths that wouldn't be
 *  represented anywhere in the bound payload. Compact — meant to be
 *  scannable rather than exhaustive. */
function FitDetail({ fit }: { fit: SectionFitDiagnostic }) {
  const { unmapped_source_keys, dropped_paths, health } = fit
  const cls = health === 'attention'
    ? 'border-wm-danger/40 bg-wm-danger-bg/40'
    : 'border-wm-warning/40 bg-wm-warning-bg/40'
  const lines: string[] = []
  if (unmapped_source_keys.length > 0) {
    lines.push(`Unmapped: ${unmapped_source_keys.slice(0, 6).join(', ')}${unmapped_source_keys.length > 6 ? `, +${unmapped_source_keys.length - 6} more` : ''}`)
  }
  if (dropped_paths.length > 0) {
    lines.push(`Dropped: ${dropped_paths.slice(0, 6).join(', ')}${dropped_paths.length > 6 ? `, +${dropped_paths.length - 6} more` : ''}`)
  }
  if (lines.length === 0) return null
  return (
    <div className={`mt-1.5 ml-8 rounded-md border px-2 py-1.5 text-[10px] leading-snug text-wm-text-muted ${cls}`}>
      {lines.map((l, i) => <p key={i}>{l}</p>)}
      <p className="mt-1 text-wm-text-subtle">
        {health === 'attention'
          ? 'Click the template name above to pick a variant that fits this content shape.'
          : 'You can import as-is or swap to a variant with matching slots.'}
      </p>
    </div>
  )
}

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
  // Multi-page copywriter bundle: { pages: [CopywriterPageOutput, ...] }.
  // Validated per page so each gets its own template-binding wizard.
  const [copyBundle, setCopyBundle] = useState<CopywriterPageOutput[] | null>(null)
  const [copyBundleReports, setCopyBundleReports] = useState<CopywriterValidationReport[] | null>(null)
  // Per-section template override: sort_order → replacement template_id.
  // For copywriter bundles we key by page index too: pageIdx → sort_order → tid.
  const [templateOverrides, setTemplateOverrides] = useState<Record<number, string>>({})
  const [templateOverridesByPage, setTemplateOverridesByPage] = useState<Record<number, Record<number, string>>>({})
  // Per-section field_values override: sort_order → values already
  // shaped for the override template. Populated by the variant-swap
  // doc round-trip so cross-family swaps don't drop copy.
  const [fieldValuesOverrides, setFieldValuesOverrides] = useState<Record<number, Record<string, unknown>>>({})
  const [fieldValuesOverridesByPage, setFieldValuesOverridesByPage] = useState<Record<number, Record<number, Record<string, unknown>>>>({})
  // When set, opens the catalog picker for a specific section so the
  // user can pick any template (cross-family) and we'll remap the
  // field_values to its schema. For bundles, also tracks the page index.
  const [variantSwapForSort, setVariantSwapForSort] = useState<number | null>(null)
  const [variantSwapPageIdx, setVariantSwapPageIdx] = useState<number | null>(null)
  const [variantSwapping, setVariantSwapping] = useState(false)
  const [validating, setValidating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [addSnippets, setAddSnippets] = useState(true)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  // Multi-page progress — current page index / total / current title.
  const [bundleProgress, setBundleProgress] = useState<{ done: number; total: number; current: string } | null>(null)
  // Snippets manifest carried at the top of a copywriter page bundle.
  // Captured at parse time so the bundle import can run snippets first
  // (so {{token}} references in field_values actually resolve at
  // render time after the pages land).
  const [pendingSnippetsManifest, setPendingSnippetsManifest] = useState<SnippetsImportPayload | null>(null)
  // Snippets-only paste — when the strategist pastes `{ globals, snippets }`
  // without any pages, treat it as a project-level snippet hydration
  // instead of erroring out with "page_slug is required". Surfaced as
  // a confirmation card with what would be written + an Import button.
  const [snippetsOnlyPayload, setSnippetsOnlyPayload] = useState<SnippetsImportPayload | null>(null)
  const [snippetsOnlyResult, setSnippetsOnlyResult] = useState<{ globalsUpdated: number; snippetsArchived: number; snippetsInserted: number } | null>(null)
  // Pre-import shape diagnostics — dry-run bind per section so the
  // strategist can see "this template will drop content" BEFORE
  // hitting Import. Keyed by pageIdx → sort_order → fit. Recomputed
  // when the user changes a template override.
  const [bundleFit, setBundleFit] = useState<Record<number, Record<number, SectionFitDiagnostic>> | null>(null)
  const [singleFit, setSingleFit] = useState<Record<number, SectionFitDiagnostic> | null>(null)
  // Master-pairer overrides — every section the pairer re-routed off
  // cowork's pick. Auto-applied to templateOverridesByPage when the
  // bundle loads; the "See what I changed" panel shows each rationale
  // so the strategist can spot-check and manually swap if needed.
  const [pairerResults, setPairerResults] = useState<Record<number, SectionPairResult[]> | null>(null)
  const [pairerCollapsed, setPairerCollapsed] = useState(false)

  // Recompute bundle fit whenever the user picks a different template
  // for any section. Debounced via the rAF tick so a burst of state
  // changes during a single variant-swap doesn't trigger multiple
  // analyses. Single-page output gets the same treatment.
  useEffect(() => {
    if (!copyBundle) return
    let cancelled = false
    const handle = requestAnimationFrame(() => {
      void analyzeBundleFit(copyBundle, templateOverridesByPage).then(fit => {
        if (!cancelled) setBundleFit(fit)
      })
    })
    return () => { cancelled = true; cancelAnimationFrame(handle) }
  }, [copyBundle, templateOverridesByPage])
  useEffect(() => {
    if (!copyOutput) return
    let cancelled = false
    const handle = requestAnimationFrame(() => {
      void analyzeBundleFit([copyOutput], { 0: templateOverrides }).then(fit => {
        if (!cancelled) setSingleFit(fit[0] ?? null)
      })
    })
    return () => { cancelled = true; cancelAnimationFrame(handle) }
  }, [copyOutput, templateOverrides])

  if (!open) return null

  const reset = () => {
    setJsonText('')
    setParseError(null)
    setBrief(null)
    setBundle(null)
    setReport(null)
    setCopyOutput(null)
    setCopyReport(null)
    setCopyBundle(null)
    setCopyBundleReports(null)
    setTemplateOverrides({})
    setTemplateOverridesByPage({})
    setFieldValuesOverrides({})
    setFieldValuesOverridesByPage({})
    setVariantSwapForSort(null)
    setVariantSwapPageIdx(null)
    setImportMsg(null)
    setPairerResults(null)
    setPairerCollapsed(false)
    setBundleProgress(null)
    setPendingSnippetsManifest(null)
    setSnippetsOnlyPayload(null)
    setSnippetsOnlyResult(null)
    setBundleFit(null)
    setSingleFit(null)
  }

  /** Swap the bound template for a section and remap its field_values
   *  via the Brixies doc round-trip so copy carries across families.
   *  When the new template id matches the copywriter's original pick
   *  we treat that as "revert" — both overrides clear. */
  const applyTemplateSwap = async (sortOrder: number, newTemplateId: string, pageIdx: number | null = null) => {
    // Bundle path: when pageIdx is set, look up the section + write
    // overrides under the per-page maps instead of the single-page ones.
    const isBundle = pageIdx != null && copyBundle != null
    const section = isBundle
      ? copyBundle[pageIdx].sections.find(s => s.sort_order === sortOrder)
      : copyOutput?.sections.find(s => s.sort_order === sortOrder)
    if (!section) return
    const ctxOriginalTemplateId = section.template_id

    // Revert path — same as copywriter's original pick.
    if (newTemplateId === ctxOriginalTemplateId) {
      if (isBundle) {
        setTemplateOverridesByPage(prev => {
          const pageMap = { ...(prev[pageIdx] ?? {}) }
          delete pageMap[sortOrder]
          return { ...prev, [pageIdx]: pageMap }
        })
        setFieldValuesOverridesByPage(prev => {
          const pageMap = { ...(prev[pageIdx] ?? {}) }
          delete pageMap[sortOrder]
          return { ...prev, [pageIdx]: pageMap }
        })
      } else {
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
      }
      return
    }

    setVariantSwapping(true)
    try {
      // Fetch the new template (always) + the old one if its id might
      // resolve (concept-style ids from the copywriter won't, so we
      // skip the round-trip and let the value-shape emitter handle it).
      const lookupIds = ctxOriginalTemplateId
        ? [ctxOriginalTemplateId, newTemplateId]
        : [newTemplateId]
      const { data: tpls, error } = await supabase
        .from('web_content_templates')
        .select('*')
        .in('id', lookupIds)
      if (error) throw new Error(error.message)
      const rows = (tpls ?? []) as WebContentTemplate[]
      const oldTpl = rows.find(t => t.id === ctxOriginalTemplateId) ?? null
      const newTpl = rows.find(t => t.id === newTemplateId)
      if (!newTpl) throw new Error('Selected template not found in catalog.')

      // 1. Normalize copywriter shape into canonical field_values.
      // 2. Doc round-trip via the OLD template to a Brixies doc, then
      //    parse back into the NEW template's slots. Same pipeline
      //    PagesWorkspace.bindSection uses for change-variant —
      //    preserves headings / body / CTAs / etc. across families.
      // 3. Pass the normalized values as existingGroupValues so any
      //    group keys that overlap between schemas survive (otherwise
      //    docHtmlToFieldValues only repopulates leaf slots).
      // The round-trip is wrapped because malformed copywriter output
      // (e.g. richtext field that isn't a string) can throw in
      // fieldValuesToDocHtml — when that happens we still want the
      // template swap to commit, just with the raw normalized values
      // instead of a remap.
      // Keep the raw copywriter field_values around — even keys oldTpl
      // doesn't define survive here, so the canonical-key reconcile pass
      // below can fish them back out if newTpl happens to define them.
      // Also merge in any previously-stashed __unmapped entries so a
      // later swap can rehydrate them once a matching slot exists.
      const sectionValues = section.field_values ?? {}
      const priorUnmapped = (sectionValues.__unmapped as Record<string, unknown> | undefined) ?? {}
      const rawValues: Record<string, unknown> = { ...priorUnmapped, ...sectionValues }
      delete rawValues.__unmapped

      // Three-phase bind so nested groups (card[].buttons_card,
      // container_left[], slide[].card[], etc.) survive the swap:
      //   Phase 1 — normalize the raw values against the NEW template's
      //   schema. When the copywriter's source keys already match the
      //   target template, this populates slots directly with all
      //   nested data intact.
      //   Phase 2 — value-shape doc route fills any slots Phase 1
      //   couldn't (e.g. semantic-name mapping when keys diverge).
      //   Phase 3 — canonical-key reconcile for the long tail.
      const normalized = normalizeFieldValuesForTemplate(newTpl, rawValues)
      let shapeFilled: Record<string, unknown> = {}
      try {
        const docHtml = oldTpl
          ? fieldValuesToDocHtml(normalizeFieldValuesForTemplate(oldTpl, rawValues), oldTpl)
            + valuesToDocHtmlByShape(rawValues)
          : valuesToDocHtmlByShape(rawValues)
        shapeFilled = docHtmlToFieldValues(docHtml || '<p></p>', newTpl, rawValues).field_values
      } catch (err) {
        console.warn('[variant-swap] value-shape phase failed, keeping normalize only', err)
      }
      let remapped = mergeFieldValuesPreferNonEmpty(normalized, shapeFilled, newTpl)
      // Canonical-key fallback for any slot still empty.
      remapped = reconcileFieldValuesAcrossTemplates(rawValues, newTpl, remapped)

      // Recompute __unmapped against the new template. Anything that
      // matched a slot is dropped from the stash; the rest stays so
      // the next swap gets another chance.
      const unmapped = computeUnmappedValues(rawValues, remapped, newTpl)
      if (Object.keys(unmapped).length > 0) {
        remapped = { ...remapped, __unmapped: unmapped }
      } else {
        // Drop any prior __unmapped that's now empty.
        const { __unmapped: _drop, ...rest } = remapped as Record<string, unknown>
        void _drop
        remapped = rest
      }

      if (isBundle) {
        setTemplateOverridesByPage(prev => ({
          ...prev,
          [pageIdx]: { ...(prev[pageIdx] ?? {}), [sortOrder]: newTemplateId },
        }))
        setFieldValuesOverridesByPage(prev => ({
          ...prev,
          [pageIdx]: { ...(prev[pageIdx] ?? {}), [sortOrder]: remapped },
        }))
      } else {
        setTemplateOverrides(prev => ({ ...prev, [sortOrder]: newTemplateId }))
        setFieldValuesOverrides(prev => ({ ...prev, [sortOrder]: remapped }))
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setImportMsg(`Couldn't swap template: ${msg}`)
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
    setSnippetsOnlyPayload(null)
    setSnippetsOnlyResult(null)
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
    // Detection order: copywriter bundle (`{pages: [...]}` w/ copywriter
    // shape) → single copywriter output → legacy bundle → legacy brief.
    // Copywriter bundle MUST be checked before `isPageBriefBundle`
    // because the bundle shape overlaps (both have `pages: [...]`) and
    // the legacy importer would treat each page as freehand, losing the
    // structured field_values + template hints.
    if (isCopywriterPageBundle(parsed)) {
      const pages = (parsed as { pages: CopywriterPageOutput[] }).pages
      pages.forEach(normalizeCopywriterPageOutput)
      setCopyBundle(pages)
      // Cowork's web-page-formatter-v2 ships a `snippets_manifest` at
      // the top level — extract it so the bundle import can run
      // snippets first. Pending entries (expansion === null) are
      // dropped because the validator requires a string expansion;
      // they're cowork placeholders, not live snippets.
      const manifest = (parsed as { snippets_manifest?: unknown }).snippets_manifest
      if (manifest && typeof manifest === 'object') {
        const m = manifest as Record<string, unknown>
        const rawSnippets = Array.isArray(m.snippets) ? m.snippets : []
        const usableSnippets = rawSnippets.filter(
          (s: unknown): s is { token: string; expansion: string } => {
            return !!s && typeof s === 'object'
              && typeof (s as { expansion?: unknown }).expansion === 'string'
          },
        )
        setPendingSnippetsManifest({
          globals: (m.globals && typeof m.globals === 'object'
            ? m.globals as SnippetsImportPayload['globals']
            : undefined),
          snippets: usableSnippets as SnippetsImportPayload['snippets'],
        })
      } else {
        setPendingSnippetsManifest(null)
      }
      setValidating(true)
      try {
        // Pair first — site-wide aggressive re-pair across the bundle.
        // The pairer's overrides are auto-applied to
        // templateOverridesByPage; analyzeBundleFit then runs with
        // those overrides folded in so fit diagnostics reflect the
        // final pick (not cowork's original).
        const pair = await pairBundleTemplates(pages, project)
        setPairerResults(pair.resultsByPage)
        setTemplateOverridesByPage(pair.overridesByPage)
        const [reports, fit] = await Promise.all([
          Promise.all(pages.map(p => validateCopywriterPageOutput(p, project))),
          analyzeBundleFit(pages, pair.overridesByPage),
        ])
        setCopyBundleReports(reports)
        setBundleFit(fit)
      } finally {
        setValidating(false)
      }
      return
    }
    // Copywriter output has strategic_setup + sections with
    // template_id + field_values; it's the most specific single-page
    // shape so sniff for it next.
    if (isCopywriterPageOutput(parsed)) {
      const out = normalizeCopywriterPageOutput(parsed as CopywriterPageOutput)
      setCopyOutput(out)
      setValidating(true)
      try {
        // Pair the single page too — same site-wide cohesion path.
        const pair = await pairBundleTemplates([out], project)
        setPairerResults(pair.resultsByPage)
        const singleOverrides = pair.overridesByPage[0] ?? {}
        setTemplateOverrides(singleOverrides)
        const [report, fit] = await Promise.all([
          validateCopywriterPageOutput(out, project),
          analyzeBundleFit([out], { 0: singleOverrides }),
        ])
        setCopyReport(report)
        setSingleFit(fit[0] ?? null)
      } finally {
        setValidating(false)
      }
      return
    }
    // Legacy multi-page bundle? Skip validation (heavy for N pages) and
    // route straight to bulk import.
    if (isPageBriefBundle(parsed)) {
      setBundle(parsed)
      return
    }
    // Snippets-only paste — { globals, snippets } with no pages. Route
    // to the project-level snippet hydration path instead of erroring
    // with "page_slug required". Detection is BELOW the bundle / copy-
    // writer checks because those shapes can also carry a snippets
    // manifest; this branch only fires when there's NOTHING else to
    // import.
    if (isSnippetsImportPayload(parsed)) {
      const p = parsed as Record<string, unknown>
      const hasPages = Array.isArray((p as { pages?: unknown }).pages)
      const hasSections = Array.isArray((p as { sections?: unknown }).sections)
      if (!hasPages && !hasSections) {
        const payload: SnippetsImportPayload = {
          globals:  (p.globals  && typeof p.globals  === 'object')
            ? p.globals  as SnippetsImportPayload['globals']
            : undefined,
          snippets: Array.isArray(p.snippets)
            ? p.snippets as SnippetsImportPayload['snippets']
            : undefined,
        }
        setSnippetsOnlyPayload(payload)
        return
      }
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
        const fallbacks = result.library_fallbacks ?? []
        const fallbackSummary = fallbacks.length > 0
          ? ` · auto-bound ${fallbacks.length} section${fallbacks.length === 1 ? '' : 's'} from ${
              fallbacks.every(f => f.source === 'site_library') ? 'your site library' :
              fallbacks.every(f => f.source === 'catalog')      ? 'the catalog' :
                                                                  'your site library + catalog'
            } (${fallbacks.map(f => `#${f.sort_order} → ${f.fallback_name}`).join(', ')})`
          : ''
        setImportMsg(
          `${result.created ? 'Created' : 'Updated'} "${copyOutput.page_title}" · ` +
          `${result.sections_created} section${result.sections_created === 1 ? '' : 's'}` +
          `${result.sections_replaced ? ` (replaced ${result.sections_replaced})` : ''}` +
          `${result.sections_preserved ? ` · kept ${result.sections_preserved} unchanged (user edits preserved)` : ''}` +
          `${result.seo_written ? ' · SEO written' : ''}` +
          fallbackSummary +
          '.',
        )
      }
    } finally {
      setImporting(false)
    }
  }

  const handleImportCopyBundle = async () => {
    if (!copyBundle) return
    setImporting(true)
    setImportMsg(null)
    setBundleProgress({ done: 0, total: copyBundle.length, current: '' })
    const results: Array<{
      page_title: string
      page_slug:  string
      result?: Awaited<ReturnType<typeof importCopywriterPageOutput>>['result']
      error?:  string
    }> = []
    // Snippet import counts roll up into the final summary message so
    // the user sees globals + snippet rows landed alongside pages.
    let snippetsResult: { globalsUpdated: number; snippetsArchived: number; snippetsInserted: number } | null = null
    let snippetsError: string | null = null
    try {
      // Snippets first — page sections reference `{{token}}` in their
      // field_values, and tokens only resolve if the snippets exist in
      // web_project_snippets by the time the editor renders.
      if (pendingSnippetsManifest && addSnippets) {
        const hasAnything =
          (pendingSnippetsManifest.snippets && pendingSnippetsManifest.snippets.length > 0)
          || (pendingSnippetsManifest.globals && Object.keys(pendingSnippetsManifest.globals).length > 0)
        if (hasAnything) {
          const snipRes = await importSnippets(pendingSnippetsManifest, project)
          if (snipRes.error) {
            snippetsError = snipRes.error
          } else if (snipRes.result) {
            snippetsResult = snipRes.result
          }
        }
      }
      for (let i = 0; i < copyBundle.length; i++) {
        const page = copyBundle[i]
        setBundleProgress({ done: i, total: copyBundle.length, current: page.page_title })
        const pageOverrides = templateOverridesByPage[i] ?? {}
        const pageFieldOverrides = fieldValuesOverridesByPage[i] ?? {}
        const { result, error } = await importCopywriterPageOutput(page, project, {
          templateOverrides:    pageOverrides,
          fieldValuesOverrides: pageFieldOverrides,
        })
        results.push({ page_title: page.page_title, page_slug: page.page_slug, result, error })
      }
      setBundleProgress({ done: copyBundle.length, total: copyBundle.length, current: '' })

      // Aggregate summary: sections imported, fallbacks applied, errors.
      const totals = results.reduce(
        (acc, r) => {
          if (r.result) {
            acc.sections += r.result.sections_created
            acc.fallbacks += r.result.library_fallbacks.length
            acc.replaced += r.result.sections_replaced
            acc.preserved += r.result.sections_preserved ?? 0
          }
          return acc
        },
        { sections: 0, fallbacks: 0, replaced: 0, preserved: 0 },
      )
      const failed = results.filter(r => r.error)
      const ok = results.length - failed.length

      // Navigate to the last successfully imported page so the editor
      // opens to something the strategist can immediately review.
      const lastOk = [...results].reverse().find(r => r.result)
      if (lastOk?.result) {
        await onImported({
          page_id:           lastOk.result.page_id,
          created:           lastOk.result.created,
          sections_created:  lastOk.result.sections_created,
          sections_replaced: lastOk.result.sections_replaced,
          snippets_added:    0,
          auto_bind:         null,
        })
      }

      const failedList = failed.map(f => `${f.page_title}: ${f.error}`).join(' · ')
      const snipParts: string[] = []
      if (snippetsResult) {
        if (snippetsResult.globalsUpdated > 0) snipParts.push(`${snippetsResult.globalsUpdated} global${snippetsResult.globalsUpdated === 1 ? '' : 's'}`)
        if (snippetsResult.snippetsInserted > 0) snipParts.push(`${snippetsResult.snippetsInserted} snippet${snippetsResult.snippetsInserted === 1 ? '' : 's'}`)
        if (snippetsResult.snippetsArchived > 0) snipParts.push(`archived ${snippetsResult.snippetsArchived} prior`)
      }
      setImportMsg(
        `${ok}/${results.length} page${results.length === 1 ? '' : 's'} imported · ` +
        `${totals.sections} section${totals.sections === 1 ? '' : 's'}` +
        `${totals.replaced ? ` (replaced ${totals.replaced})` : ''}` +
        `${totals.preserved ? ` · kept ${totals.preserved} unchanged` : ''}` +
        `${totals.fallbacks ? ` · auto-bound ${totals.fallbacks} section${totals.fallbacks === 1 ? '' : 's'} from your site library` : ''}` +
        `${snipParts.length > 0 ? ` · ${snipParts.join(', ')}` : ''}.` +
        (snippetsError ? `\nSnippet import failed: ${snippetsError}` : '') +
        (failedList ? `\nFailed: ${failedList}` : ''),
      )
    } finally {
      setImporting(false)
      setBundleProgress(null)
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

          {/* Master-pairer summary — surfaces every section the
              importer re-routed off cowork's pick. Auto-applied; the
              strategist can still manually swap any section via the
              variant picker below. */}
          {pairerResults && (() => {
            const overrides: Array<{ pageIdx: number; r: SectionPairResult }> = []
            for (const [pageIdxStr, results] of Object.entries(pairerResults)) {
              const pageIdx = Number(pageIdxStr)
              for (const r of results) {
                if (r.overridden) overrides.push({ pageIdx, r })
              }
            }
            if (overrides.length === 0) return null
            return (
              <div className="rounded-md border border-wm-accent/30 bg-wm-accent-tint p-3">
                <button
                  type="button"
                  onClick={() => setPairerCollapsed(c => !c)}
                  className="w-full flex items-center justify-between gap-3 text-left"
                >
                  <div>
                    <p className="text-[11px] uppercase tracking-widest font-bold text-wm-accent mb-0.5">
                      See what I changed
                    </p>
                    <p className="text-[12px] text-wm-text">
                      {overrides.length} section{overrides.length === 1 ? '' : 's'} re-paired for better shape match + site-wide cohesion.
                    </p>
                  </div>
                  <span className="text-[11px] font-mono text-wm-accent shrink-0">
                    {pairerCollapsed ? '▸ show' : '▾ hide'}
                  </span>
                </button>
                {!pairerCollapsed && (
                  <ul className="mt-3 space-y-2">
                    {overrides.map(({ pageIdx, r }) => {
                      const pageSlug = copyBundle?.[pageIdx]?.page_slug
                                    ?? copyOutput?.page_slug
                                    ?? ''
                      return (
                        <li key={`${pageIdx}-${r.sort_order}`} className="text-[12px] leading-snug">
                          <div className="font-semibold text-wm-text">
                            <span className="font-mono text-[10px] text-wm-text-muted mr-1.5">
                              {pageSlug ? `${pageSlug} · ` : ''}#{r.sort_order}
                            </span>
                            <span className="line-through text-wm-text-subtle mr-1.5">
                              {r.cowork_id || '(unbound)'}
                            </span>
                            <span className="text-wm-accent">→ {r.picked_name}</span>
                            <span className="ml-1.5 text-[10px] font-normal text-wm-text-muted">
                              ({r.picked_family})
                            </span>
                          </div>
                          <p className="mt-0.5 text-wm-text-muted">{r.rationale}</p>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )
          })()}

          {/* Copywriter-bundle validation report — per page, with the
              same picker affordance as single-page. */}
          {copyBundle && copyBundleReports && (() => {
            // Cross-page section count + unbound count.
            let totalSections = 0
            let totalUnbound = 0
            for (let i = 0; i < copyBundle.length; i++) {
              const page = copyBundle[i]
              const rep  = copyBundleReports[i]
              totalSections += page.sections.length
              for (const s of page.sections) {
                const effectiveId = (templateOverridesByPage[i] ?? {})[s.sort_order] ?? s.template_id
                if (!effectiveId || rep.unresolved_template_ids.includes(effectiveId)) totalUnbound++
              }
            }
            const firstUnbound = (() => {
              for (let i = 0; i < copyBundle.length; i++) {
                const page = copyBundle[i]
                const rep  = copyBundleReports[i]
                for (const s of page.sections) {
                  const eff = (templateOverridesByPage[i] ?? {})[s.sort_order] ?? s.template_id
                  if (!eff || rep.unresolved_template_ids.includes(eff)) {
                    return { pageIdx: i, sortOrder: s.sort_order }
                  }
                }
              }
              return null
            })()

            return (
              <div className="space-y-3">
                <div className={[
                  'rounded-md border p-3',
                  totalUnbound > 0 ? 'border-wm-warning/40 bg-wm-warning-bg' : 'border-wm-success/30 bg-wm-success-bg',
                ].join(' ')}>
                  <div className="flex items-start gap-2">
                    {totalUnbound > 0
                      ? <AlertCircle size={14} className="text-wm-warning shrink-0 mt-0.5" />
                      : <CheckCircle2 size={14} className="text-wm-success shrink-0 mt-0.5" />}
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-wm-text">
                        Copywriter bundle — {copyBundle.length} page{copyBundle.length === 1 ? '' : 's'} ·
                        {' '}{totalSections} section{totalSections === 1 ? '' : 's'}
                        {totalUnbound > 0 && ` · ${totalUnbound} need${totalUnbound === 1 ? 's' : ''} a Brixies template`}
                      </p>
                      <p className="text-[11px] text-wm-text-muted mt-1 leading-snug">
                        {totalUnbound > 0
                          ? 'Pick a Brixies template for each section below — your copy carries through to whichever you choose, so nothing gets dropped. We auto-advance through the rest after each pick.'
                          : 'Every section is bound. Ready to import.'}
                      </p>
                      {firstUnbound && (
                        <div className="flex items-center gap-2 mt-2">
                          <WMButton
                            variant="primary"
                            size="sm"
                            iconLeft={<LayoutGrid size={11} />}
                            onClick={() => {
                              setVariantSwapPageIdx(firstUnbound.pageIdx)
                              setVariantSwapForSort(firstUnbound.sortOrder)
                            }}
                            disabled={importing || variantSwapping}
                          >
                            Pick template for #{firstUnbound.sortOrder} ({copyBundle[firstUnbound.pageIdx].page_title})
                          </WMButton>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Per-page section list */}
                {copyBundle.map((page, pageIdx) => {
                  const rep = copyBundleReports[pageIdx]
                  const pageOverrides = templateOverridesByPage[pageIdx] ?? {}
                  return (
                    <div key={`${pageIdx}-${page.page_slug}`} className="rounded-md border border-wm-border bg-wm-bg-elevated p-3">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">
                          {page.page_title} · /{page.page_slug.replace(/^\/+/, '')}
                        </p>
                        <span className="text-[10px] text-wm-text-subtle">
                          {page.sections.length} section{page.sections.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      <ul className="space-y-1.5">
                        {page.sections.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)).map(s => {
                          const effectiveId = pageOverrides[s.sort_order] ?? s.template_id
                          const broken      = !effectiveId || rep.unresolved_template_ids.includes(effectiveId)
                          const overridden  = !!pageOverrides[s.sort_order]
                          const tplName     = rep.resolved_templates[effectiveId]
                            ?? (broken ? `${effectiveId || '(none specified)'} — pick a template` : effectiveId)
                          const fit = bundleFit?.[pageIdx]?.[s.sort_order]
                          return (
                            <li key={`${s.sort_order}-${s.template_id}`} className="text-[12px] text-wm-text">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-wm-text-subtle font-mono text-[10px] w-6 text-right shrink-0">
                                  {String(s.sort_order ?? 0).padStart(2, '0')}
                                </span>
                                <FitChip fit={fit} broken={broken} />
                                <button
                                  type="button"
                                  onClick={() => {
                                    setVariantSwapPageIdx(pageIdx)
                                    setVariantSwapForSort(s.sort_order)
                                  }}
                                  disabled={importing || variantSwapping}
                                  className={[
                                    'min-w-0 flex-1 inline-flex items-center justify-between gap-2 h-7 px-2.5 rounded border bg-wm-bg-elevated text-[12px] hover:border-wm-accent transition-colors disabled:opacity-50',
                                    broken      ? 'border-wm-danger text-wm-danger' :
                                    overridden  ? 'border-wm-accent text-wm-accent-strong' :
                                                  'border-wm-border text-wm-text',
                                  ].join(' ')}
                                  title="Click to browse the Brixies catalog. Copy is remapped to the picked template's schema so nothing drops."
                                >
                                  <span className="truncate">{tplName}</span>
                                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-wm-text-subtle shrink-0">
                                    <LayoutGrid size={10} /> {broken ? 'Pick' : 'Change'}
                                  </span>
                                </button>
                                {s.concept_id && (
                                  <span className="text-[10px] text-wm-text-subtle font-mono shrink-0">· {s.concept_id}</span>
                                )}
                              </div>
                              {fit && fit.health !== 'clean' && !broken && (
                                <FitDetail fit={fit} />
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  )
                })}
              </div>
            )
          })()}

          {/* Copywriter-output validation report */}
          {copyReport && copyOutput && (() => {
            // Per-section binding state, recomputed each render so user
            // picks (templateOverrides) clear the corresponding errors.
            const unboundSorts = copyOutput.sections
              .filter(s => {
                const effectiveId = templateOverrides[s.sort_order] ?? s.template_id
                return !effectiveId || copyReport.unresolved_template_ids.includes(effectiveId)
              })
              .map(s => s.sort_order)
            // Validation errors that aren't about template binding — these
            // we can't auto-resolve via picks, so they still block import.
            const nonTemplateErrors = copyReport.issues.filter(i =>
              i.severity === 'error' && !i.scope.startsWith('section.template_id=')
            ).length
            // Effective valid state: no other errors AND every section
            // has a resolvable template (either originally or via override).
            const effectiveValid = nonTemplateErrors === 0 && unboundSorts.length === 0
            return (
            <div className="space-y-3" data-effective-valid={String(effectiveValid)}>
              {(() => {
                const warnCount = copyReport.issues.filter(i => i.severity === 'warning').length
                const infoCount = copyReport.issues.filter(i => i.severity === 'info').length
                if (unboundSorts.length > 0) {
                  const firstUnbound = unboundSorts[0]
                  return (
                    <div className="rounded-md border border-wm-warning/40 bg-wm-warning-bg p-3">
                      <div className="flex items-start gap-2">
                        <AlertCircle size={14} className="text-wm-warning shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-semibold text-wm-text">
                            {unboundSorts.length} section{unboundSorts.length === 1 ? '' : 's'} need
                            {unboundSorts.length === 1 ? 's' : ''} a Brixies template
                          </p>
                          <p className="text-[11px] text-wm-text-muted mt-1 leading-snug">
                            The copywriter shipped concept names instead of catalog IDs. Pick a
                            Brixies template for each section below — your copy carries through to
                            whichever you choose, so nothing gets dropped.
                          </p>
                          <div className="flex items-center gap-2 mt-2">
                            <WMButton
                              variant="primary"
                              size="sm"
                              iconLeft={<LayoutGrid size={11} />}
                              onClick={() => setVariantSwapForSort(firstUnbound)}
                              disabled={importing || variantSwapping}
                            >
                              Pick template for #{firstUnbound}
                            </WMButton>
                            <span className="text-[10px] text-wm-text-subtle">
                              We'll auto-advance through the rest after each pick.
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                }
                if (!effectiveValid) {
                  return (
                    <div className="rounded-md border border-wm-danger/30 bg-wm-danger-bg p-3 flex items-center gap-2">
                      <AlertCircle size={14} className="text-wm-danger shrink-0" />
                      <p className="text-[13px] font-semibold text-wm-danger">
                        Copywriter output — {nonTemplateErrors} error(s) must be resolved before import
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

                      const fit = singleFit?.[s.sort_order]
                      return (
                        <li
                          key={`${s.sort_order}-${s.template_id}`}
                          className="text-[12px] text-wm-text"
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-wm-text-subtle font-mono text-[10px] w-6 text-right shrink-0">
                              {String(s.sort_order ?? 0).padStart(2, '0')}
                            </span>
                            <FitChip fit={fit} broken={broken} />
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
                          {fit && fit.health !== 'clean' && !broken && (
                            <FitDetail fit={fit} />
                          )}
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
            )
          })()}

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

          {/* Snippets-only paste — confirmation card. The payload
              hydrates project globals + snippet rows without creating
              a page. Reuses the same importSnippets() the copywriter
              bundle uses internally. */}
          {snippetsOnlyPayload && (
            <div className="mt-4 rounded-md border border-wm-accent/30 bg-wm-accent-tint p-3">
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong mb-2">
                Snippets-only import detected
              </p>
              <p className="text-[12px] text-wm-text mb-3">
                This payload carries project-level <strong>globals</strong> and
                <strong> snippets</strong> but no pages. Importing will update the
                project's global merge fields and insert the listed snippets into
                <span className="font-mono"> web_project_snippets</span>.
              </p>

              {snippetsOnlyPayload.globals && Object.keys(snippetsOnlyPayload.globals).length > 0 && (
                <div className="mb-3">
                  <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">
                    Globals ({Object.values(snippetsOnlyPayload.globals).filter(v => v != null && v !== '').length} non-null of {Object.keys(snippetsOnlyPayload.globals).length})
                  </p>
                  <ul className="space-y-0.5 text-[11px]">
                    {Object.entries(snippetsOnlyPayload.globals).slice(0, 12).map(([k, v]) => (
                      <li key={k} className="flex items-baseline gap-2">
                        <span className="font-mono text-wm-text-muted shrink-0">{k}</span>
                        <span className="text-wm-text truncate">
                          {v == null || v === '' ? <em className="text-wm-text-subtle">— null —</em> : v}
                        </span>
                      </li>
                    ))}
                    {Object.keys(snippetsOnlyPayload.globals).length > 12 && (
                      <li className="text-[11px] text-wm-text-subtle italic">
                        +{Object.keys(snippetsOnlyPayload.globals).length - 12} more…
                      </li>
                    )}
                  </ul>
                </div>
              )}

              {snippetsOnlyPayload.snippets && snippetsOnlyPayload.snippets.length > 0 && (
                <div className="mb-3">
                  <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">
                    Snippets ({snippetsOnlyPayload.snippets.length})
                  </p>
                  <ul className="space-y-0.5 text-[11px]">
                    {snippetsOnlyPayload.snippets.slice(0, 12).map((s, i) => (
                      <li key={i} className="flex items-baseline gap-2">
                        <span className="font-mono text-wm-text-muted shrink-0">{s.token}</span>
                        <span className="text-wm-text truncate">{s.expansion}</span>
                      </li>
                    ))}
                    {snippetsOnlyPayload.snippets.length > 12 && (
                      <li className="text-[11px] text-wm-text-subtle italic">
                        +{snippetsOnlyPayload.snippets.length - 12} more…
                      </li>
                    )}
                  </ul>
                </div>
              )}

              {snippetsOnlyResult && (
                <div className="rounded border border-wm-success/30 bg-wm-success-bg px-3 py-2 mb-2">
                  <p className="text-[12px] text-wm-success">
                    Imported {snippetsOnlyResult.globalsUpdated} global{snippetsOnlyResult.globalsUpdated === 1 ? '' : 's'}
                    {' · '}
                    {snippetsOnlyResult.snippetsInserted} snippet{snippetsOnlyResult.snippetsInserted === 1 ? '' : 's'} inserted
                    {snippetsOnlyResult.snippetsArchived > 0 ? ` · ${snippetsOnlyResult.snippetsArchived} archived` : ''}.
                  </p>
                </div>
              )}

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    setImporting(true)
                    setImportMsg(null)
                    try {
                      const r = await importSnippets(snippetsOnlyPayload, project)
                      if (r.error) {
                        setImportMsg(`Error: ${r.error}`)
                      } else {
                        setSnippetsOnlyResult(r.result)
                        setImportMsg(`Snippets imported · ${r.result?.globalsUpdated ?? 0} globals, ${r.result?.snippetsInserted ?? 0} snippets.`)
                        onImported()
                      }
                    } finally {
                      setImporting(false)
                    }
                  }}
                  disabled={importing || !!snippetsOnlyResult}
                  className="inline-flex items-center gap-1.5 h-8 px-4 rounded-full text-[12px] font-semibold bg-wm-accent text-white hover:bg-wm-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {snippetsOnlyResult ? 'Imported' : (importing ? 'Importing…' : 'Import snippets')}
                </button>
              </div>
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
          {copyReport && copyOutput && (() => {
            // Same effective-valid calc as the body callout — overrides
            // resolve template-binding errors, other errors still block.
            const unboundCount = copyOutput.sections.filter(s => {
              const effectiveId = templateOverrides[s.sort_order] ?? s.template_id
              return !effectiveId || copyReport.unresolved_template_ids.includes(effectiveId)
            }).length
            const nonTemplateErrors = copyReport.issues.filter(i =>
              i.severity === 'error' && !i.scope.startsWith('section.template_id=')
            ).length
            const effectiveValid = nonTemplateErrors === 0 && unboundCount === 0
            return (
              <WMButton
                variant="primary"
                size="sm"
                iconLeft={<Sparkles size={11} />}
                iconRight={<ArrowRight size={11} />}
                disabled={!effectiveValid || importing}
                loading={importing}
                onClick={handleImportCopywriter}
              >
                Import copywriter output
              </WMButton>
            )
          })()}
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
          {copyBundle && copyBundleReports && (() => {
            // Importable when every section across every page has a
            // resolvable template (either originally or via override).
            // Sections that remain unbound when the user hits import
            // fall through to the library/catalog fallback inside
            // importCopywriterPageOutput — but the button still
            // enables so the strategist isn't trapped if they decide
            // to trust the fallback for the rest.
            let nonTemplateErrors = 0
            for (const r of copyBundleReports) {
              nonTemplateErrors += r.issues.filter(i =>
                i.severity === 'error' && !i.scope.startsWith('section.template_id=')
              ).length
            }
            return (
              <WMButton
                variant="primary"
                size="sm"
                iconLeft={<Sparkles size={11} />}
                iconRight={<ArrowRight size={11} />}
                disabled={nonTemplateErrors > 0 || importing}
                loading={importing}
                onClick={handleImportCopyBundle}
              >
                Import {copyBundle.length} page{copyBundle.length === 1 ? '' : 's'}
              </WMButton>
            )
          })()}
        </div>
      </div>

      {/* Catalog picker — opens when the user clicks the template pill
          on a section. Filtered to content/media/post_template kinds.
          Handles both single-page (copyOutput) and bundle (copyBundle)
          cases; pageIdx is null for single-page. */}
      {variantSwapForSort != null && (copyOutput || (copyBundle && variantSwapPageIdx != null)) && (() => {
        const isBundle = variantSwapPageIdx != null && copyBundle != null
        const section  = isBundle
          ? copyBundle[variantSwapPageIdx].sections.find(s => s.sort_order === variantSwapForSort)
          : copyOutput?.sections.find(s => s.sort_order === variantSwapForSort)
        const pageTitle = isBundle ? copyBundle[variantSwapPageIdx].page_title : (copyOutput?.page_title ?? '')
        const currentOverride = isBundle
          ? (templateOverridesByPage[variantSwapPageIdx] ?? {})[variantSwapForSort]
          : templateOverrides[variantSwapForSort]
        const currentTid = currentOverride ?? section?.template_id
        return (
          <WMCatalogSidePanel
            open={true}
            onClose={() => {
              setVariantSwapForSort(null)
              setVariantSwapPageIdx(null)
            }}
            title="Pick a Brixies template"
            subtitle={`${pageTitle} · Section ${variantSwapForSort}${section?.concept_id ? ` (${section.concept_id})` : ''}`}
            kindFilter={['content', 'media', 'post_template'] as readonly WebTemplateKind[]}
            mode="single"
            selectedIds={currentTid ? [currentTid] : []}
            onSelect={async (ids) => {
              const picked = ids[0]
              const justPickedFor = variantSwapForSort
              const justPickedPageIdx = variantSwapPageIdx
              try {
                if (picked && justPickedFor != null) {
                  await applyTemplateSwap(justPickedFor, picked, justPickedPageIdx)
                }
              } finally {
                // Auto-advance through the remaining unbound sections.
                // For bundles we walk pages → sections; for single-page
                // we just walk the single page's sections.
                let advanced = false
                if (picked && justPickedFor != null) {
                  if (isBundle && copyBundle && copyBundleReports && justPickedPageIdx != null) {
                    outer: for (let i = 0; i < copyBundle.length; i++) {
                      const page = copyBundle[i]
                      const rep  = copyBundleReports[i]
                      const pageMap = templateOverridesByPage[i] ?? {}
                      for (const s of page.sections) {
                        if (i === justPickedPageIdx && s.sort_order === justPickedFor) continue
                        const override = pageMap[s.sort_order]
                        const effectiveId = override ?? s.template_id
                        if (!effectiveId || rep.unresolved_template_ids.includes(effectiveId)) {
                          setVariantSwapPageIdx(i)
                          setVariantSwapForSort(s.sort_order)
                          advanced = true
                          break outer
                        }
                      }
                    }
                  } else if (copyOutput && copyReport) {
                    const nextUnbound = copyOutput.sections.find(s => {
                      if (s.sort_order === justPickedFor) return false
                      const override = templateOverrides[s.sort_order]
                      const effectiveId = override ?? s.template_id
                      return !effectiveId || copyReport.unresolved_template_ids.includes(effectiveId)
                    })
                    if (nextUnbound) {
                      setVariantSwapForSort(nextUnbound.sort_order)
                      advanced = true
                    }
                  }
                }
                if (!advanced) {
                  setVariantSwapForSort(null)
                  setVariantSwapPageIdx(null)
                }
              }
            }}
          />
        )
      })()}
    </div>
  )
}
