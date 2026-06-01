/**
 * PageTextView — the Text view of the Text / Layout / Preview toggle.
 *
 * Renders each section's `source_markdown` as an editable textarea
 * alongside a coverage gutter derived from `field_provenance`. Source
 * of truth lives next to the section row; the Layout view's
 * `field_values` is just one rendering of it.
 *
 * Save chains through `rebindSectionFromMarkdown` (Slice D):
 *   parse markdown → match node_ids against previous ir_snapshot →
 *   bind to template → preserve any field marked `override` →
 *   persist to web_sections in one update.
 *
 * Empty-state handling: sections imported before the markdown
 * pipeline existed have `source_markdown === null`. The textarea is
 * empty and the gutter explains; pasting markdown + Save populates
 * `source_markdown` + `ir_snapshot` and (if the section has a
 * template) re-runs the binder.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { FileText, CheckCircle2, AlertCircle, Pin, Loader2, AlertTriangle, ClipboardPaste, ChevronDown, ChevronUp, Braces, Bold, Italic, Heading1, Heading2, List, ListOrdered, Link as LinkIcon, Tag, Search, RotateCcw } from 'lucide-react'
import { summarizeCoverage, isWriterContributableField } from '../../../lib/webFieldProvenance'
import {
  rebindSectionFromMarkdown, ingestPageMarkdown, resetSectionFieldToText,
  type RebindResult, type PageMarkdownIngestResult, type FieldResetResult,
} from '../../../lib/webRebind'
import type { WMSnippetOption } from '../RichTextEditor'
import type {
  WebSection, WebContentTemplate, FieldProvenanceMap,
  FieldProvenance, WebFieldDef,
} from '../../../types/database'

interface Props {
  pageId:             string
  sections:           WebSection[]
  templates:          Record<string, WebContentTemplate>
  snippets?:          WMSnippetOption[]
  pageContext?:       { page_slug?: string; page_title?: string }
  onSectionsChanged?: () => void
}

export function PageTextView({ pageId, sections, templates, snippets, pageContext, onSectionsChanged }: Props) {
  return (
    <div className="space-y-4">
      <WholePageIngest
        pageId={pageId}
        sections={sections}
        pageContext={pageContext}
        onIngested={onSectionsChanged}
      />

      {sections.length === 0 ? (
        <div className="py-16 text-center text-wm-text-muted">
          <FileText size={32} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">No sections yet. Paste markdown above, or add one in the Layout view.</p>
        </div>
      ) : (
        sections.map(section => (
          <SectionTextCard
            key={section.id}
            section={section}
            template={section.content_template_id ? templates[section.content_template_id] : undefined}
            snippets={snippets}
            pageContext={pageContext}
            onSaved={onSectionsChanged}
          />
        ))
      )}
    </div>
  )
}

function WholePageIngest({
  pageId, sections, pageContext, onIngested,
}: {
  pageId:        string
  sections:      WebSection[]
  pageContext?:  { page_slug?: string; page_title?: string }
  onIngested?:   () => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<PageMarkdownIngestResult | null>(null)

  const run = async () => {
    if (!draft.trim() || running) return
    setRunning(true)
    setResult(null)
    const r = await ingestPageMarkdown({
      pageId,
      pageMarkdown:     draft,
      context:          pageContext,
      existingSections: sections.map(s => ({
        id:          s.id,
        sort_order:  s.sort_order,
        ir_snapshot: s.ir_snapshot,
      })),
    })
    setRunning(false)
    setResult(r)
    if (r.ok && onIngested) onIngested()
  }

  const reset = () => { setDraft(''); setResult(null) }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-2 py-3 border border-dashed border-wm-border rounded-xl text-[12px] font-semibold text-wm-text-muted hover:text-wm-text hover:border-wm-text-muted hover:bg-wm-bg-hover/40 transition"
      >
        <ClipboardPaste size={13} />
        Paste a whole page&rsquo;s markdown
        <ChevronDown size={13} />
      </button>
    )
  }

  return (
    <div className="border border-wm-border rounded-xl bg-wm-bg-elevated overflow-hidden">
      <header className="px-4 py-2.5 border-b border-wm-border bg-wm-bg-hover/40 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[11px] font-semibold text-wm-text-muted uppercase tracking-widest">
          <ClipboardPaste size={12} />
          Paste whole page markdown
        </div>
        <button type="button" onClick={() => { setOpen(false); reset() }} className="text-wm-text-muted hover:text-wm-text">
          <ChevronUp size={14} />
        </button>
      </header>
      <div className="px-4 py-3">
        <p className="text-[11px] text-wm-text-muted mb-2 leading-relaxed">
          Paste cowork&rsquo;s full markdown file (e.g. <code className="font-mono">02-plan-your-visit.md</code>).
          Each <code className="font-mono">### SECTION</code> heading becomes one section row. Existing sections at the
          same positions update through the rebind orchestrator (preserves your Layout overrides); positions beyond
          the current count get fresh freehand rows you can bind to a template after.
        </p>
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Paste markdown here…"
          rows={Math.max(8, Math.min(30, (draft.match(/\n/g)?.length ?? 0) + 2))}
          className="w-full text-[12px] text-wm-text font-mono leading-relaxed bg-wm-bg border border-wm-border rounded-md p-3 focus:outline-none focus:border-wm-border-focus focus:ring-1 focus:ring-wm-border-focus resize-y"
          spellCheck={false}
        />

        {result && <IngestSummary result={result} />}

        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={run}
            disabled={!draft.trim() || running}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold bg-wm-accent text-white px-3 py-1.5 rounded-full hover:bg-wm-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            {running ? <Loader2 size={11} className="animate-spin" /> : null}
            Ingest markdown
          </button>
          {draft && !running && (
            <button
              type="button"
              onClick={reset}
              className="text-[11px] font-semibold text-wm-text-muted hover:text-wm-text px-2 py-1"
            >
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function IngestSummary({ result }: { result: PageMarkdownIngestResult }) {
  const updated = result.entries.filter(e => e.action === 'updated' && e.ok)
  const created = result.entries.filter(e => e.action === 'created' && e.ok)
  const failed  = result.entries.filter(e => !e.ok)
  return (
    <div className="mt-3 space-y-1.5 text-[11px]">
      {updated.length > 0 && (
        <p className="text-emerald-700 flex items-center gap-1.5">
          <CheckCircle2 size={11} />
          {updated.length} section{updated.length === 1 ? '' : 's'} updated
          {(() => {
            const pinned = updated.reduce((n, e) => n + e.preserved_overrides.length, 0)
            return pinned > 0 ? ` · ${pinned} pinned field${pinned === 1 ? '' : 's'} preserved` : ''
          })()}
        </p>
      )}
      {created.length > 0 && (
        <p className="text-wm-accent flex items-center gap-1.5">
          <FileText size={11} />
          {created.length} new section{created.length === 1 ? '' : 's'} created (freehand — bind a template in Layout view)
        </p>
      )}
      {failed.length > 0 && failed.map((e, i) => (
        <p key={i} className="text-red-600 flex items-start gap-1.5">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" />
          <span>Position {e.position}: {e.error ?? 'unknown failure'}</span>
        </p>
      ))}
      {result.untouched.length > 0 && (
        <p className="text-wm-text-subtle italic">
          {result.untouched.length} existing section{result.untouched.length === 1 ? '' : 's'} preserved at position{result.untouched.length === 1 ? '' : 's'} {result.untouched.map(s => s.sort_order).join(', ')}
        </p>
      )}
    </div>
  )
}

/** Tokenize the textarea draft for the ghost-overlay pre — wraps every
 *  `{{token}}` match in a `.wm-snippet-token` span so writers see merge
 *  fields in distinct purple anywhere they appear in the markdown
 *  source. Appends a zero-width space so the overlay matches the
 *  textarea's visible line count when text ends in a newline (browsers
 *  collapse trailing `\n` in `<pre>` otherwise). */
function renderHighlightedDraft(text: string): ReactNode {
  if (!text) return null
  const parts: ReactNode[] = []
  const re = /\{\{[^{}\n]+\}\}/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    parts.push(<span key={key++} className="wm-snippet-token">{match[0]}</span>)
    lastIndex = re.lastIndex
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return <>{parts}{'​'}</>
}

function SectionTextCard({
  section, template, snippets, pageContext, onSaved,
}: {
  section:     WebSection
  template?:   WebContentTemplate
  snippets?:   WMSnippetOption[]
  pageContext?:  { page_slug?: string; page_title?: string }
  onSaved?:    () => void
}) {
  const provenance = section.field_provenance as FieldProvenanceMap | null
  const coverage   = summarizeCoverage(provenance, template)
  const sectionLabel = template?.layer_name ?? template?.family ?? `Section ${section.sort_order + 1}`

  const persisted = section.source_markdown ?? ''
  const [draft, setDraft] = useState(persisted)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<RebindResult | null>(null)
  // Default the bind-detail panel OPEN whenever the template has slots
  // the writer hasn't filled yet — that's the case where the inspector
  // is the most useful at-a-glance signal. Freehand sections (no
  // template) default closed.
  const [inspectorOpen, setInspectorOpen] = useState(() => {
    const cov = summarizeCoverage(section.field_provenance as FieldProvenanceMap | null, template)
    return cov.declared > 0 && (cov.empty > 0 || cov.unbound > 0)
  })
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const overlayRef  = useRef<HTMLPreElement | null>(null)

  // Reset draft when the underlying section reloads (e.g. parent fetched
  // fresh data after save). Prevents stale-draft over fresh-server.
  useEffect(() => { setDraft(persisted) }, [persisted])

  const dirty = draft !== persisted

  const handleSave = async () => {
    if (!dirty || saving) return
    setSaving(true)
    const r = await rebindSectionFromMarkdown(section.id, draft, { context: pageContext })
    setSaving(false)
    setResult(r)
    if (r.ok && onSaved) onSaved()
  }

  const handleReset = () => {
    setDraft(persisted)
    setResult(null)
  }

  /** Per-field "Reset to text" — revert one override back to whatever
   *  the binder would derive from the section's current IR. Used from
   *  the bind inspector's override rows. Re-fetches sections after a
   *  successful reset so the inspector reflects the new state. */
  const handleResetField = async (fieldKey: string) => {
    const r = await resetSectionFieldToText(section.id, fieldKey)
    if (r.ok && onSaved) onSaved()
    return r
  }

  /** Splice text at the current selection or append at end. */
  const spliceAtCursor = (text: string, opts: { selectInsert?: boolean } = {}) => {
    const ta = textareaRef.current
    if (!ta) { setDraft(draft + text); return }
    const start = ta.selectionStart ?? draft.length
    const end   = ta.selectionEnd   ?? draft.length
    const next  = draft.slice(0, start) + text + draft.slice(end)
    setDraft(next)
    queueMicrotask(() => {
      ta.focus()
      const caretStart = start
      const caretEnd   = start + text.length
      ta.setSelectionRange(opts.selectInsert ? caretStart : caretEnd, caretEnd)
    })
  }

  /** Wrap the current selection with `before` + `after`. If nothing
   *  selected, insert both markers and place caret between them. */
  const wrapSelection = (before: string, after: string) => {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart ?? draft.length
    const end   = ta.selectionEnd   ?? draft.length
    const selected = draft.slice(start, end)
    const next = draft.slice(0, start) + before + selected + after + draft.slice(end)
    setDraft(next)
    queueMicrotask(() => {
      ta.focus()
      if (selected) {
        // Keep selection wrapping the (now-formatted) original
        ta.setSelectionRange(start + before.length, start + before.length + selected.length)
      } else {
        // Caret between markers
        const caret = start + before.length
        ta.setSelectionRange(caret, caret)
      }
    })
  }

  /** Toggle a line-start prefix (e.g. `# `, `- `, `1. `). Operates on
   *  every line touched by the current selection. */
  const toggleLinePrefix = (prefix: string) => {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart ?? 0
    const end   = ta.selectionEnd   ?? 0
    // Expand to whole lines
    const lineStart = draft.lastIndexOf('\n', start - 1) + 1
    const lineEnd   = draft.indexOf('\n', end)
    const sliceEnd  = lineEnd === -1 ? draft.length : lineEnd
    const block     = draft.slice(lineStart, sliceEnd)
    const lines     = block.split('\n')
    const allPrefixed = lines.every(l => l.startsWith(prefix))
    const transformed = lines.map(l => allPrefixed ? l.replace(prefix, '') : prefix + l).join('\n')
    const next = draft.slice(0, lineStart) + transformed + draft.slice(sliceEnd)
    setDraft(next)
    queueMicrotask(() => {
      ta.focus()
      ta.setSelectionRange(lineStart, lineStart + transformed.length)
    })
  }

  const insertSnippet = (token: string) => spliceAtCursor(`{{${token}}}`)

  return (
    <article className="border border-wm-border rounded-xl bg-wm-bg-elevated overflow-hidden">
      <header className="px-4 py-2.5 border-b border-wm-border bg-wm-bg-hover/40 flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-muted">
            {sectionLabel}
          </p>
          {template?.layer_name && template.family && template.layer_name !== template.family && (
            <p className="text-[11px] text-wm-text-subtle mt-0.5">{template.family}</p>
          )}
        </div>
        <CoverageGutter coverage={coverage} onClick={() => setInspectorOpen(o => !o)} />
      </header>

      <div className="px-4 py-3">
        <div className="space-y-1.5 mb-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <MarkdownToolbar
              onBold={() => wrapSelection('**', '**')}
              onItalic={() => wrapSelection('*', '*')}
              onH1={() => toggleLinePrefix('# ')}
              onH2={() => toggleLinePrefix('## ')}
              onBullet={() => toggleLinePrefix('- ')}
              onNumbered={() => toggleLinePrefix('1. ')}
              onLink={() => wrapSelection('[', '](https://)')}
            />
            {snippets && snippets.length > 0 && (
              <SnippetInserter snippets={snippets} onPick={insertSnippet} />
            )}
          </div>
          <FieldMarkerRow onPick={(tag) => spliceAtCursor(`**${tag}:** `, { selectInsert: false })} />
        </div>

        {/*
          Token-highlight ghost overlay: a `pre` underlay renders the
          same text as the textarea but wraps `{{token}}` matches in a
          purple-text span. The textarea's own text is transparent (caret
          color is forced to wm-text so the cursor stays visible). Result:
          writers see literal merge tokens in a distinct purple anywhere
          they appear in the markdown source.

          Alignment depends on the pre + textarea sharing font, size,
          leading, padding, and border. Word-wrap is browser-defined for
          both elements; with the same monospace font + whitespace-pre-wrap
          the wrapping matches across major engines. If the user scrolls
          the textarea (it grew past `rows`), onScroll syncs the pre.
        */}
        <div className="relative w-full">
          {/* Order matters: pre paints first (background + visible
              text), textarea sits on top with `bg-transparent` so the
              pre shows through. Previously the textarea had bg-wm-bg
              which completely obscured the pre — making all typed
              text invisible. Textarea text-color is transparent so
              the pre's text reads as the visible glyph; caret stays
              visible via the explicit `caretColor`. */}
          <pre
            ref={overlayRef}
            aria-hidden
            className="absolute inset-0 m-0 p-3 text-[12px] font-mono leading-relaxed whitespace-pre-wrap break-words text-wm-text bg-wm-bg overflow-hidden pointer-events-none rounded-md"
            style={{ border: '1px solid transparent', boxSizing: 'border-box' }}
          >
            {renderHighlightedDraft(draft)}
          </pre>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onScroll={() => {
              const ta = textareaRef.current
              const ov = overlayRef.current
              if (!ta || !ov) return
              ov.scrollTop  = ta.scrollTop
              ov.scrollLeft = ta.scrollLeft
            }}
            placeholder={
              persisted
                ? 'Markdown source for this section.'
                : `Paste the writer's markdown for this section. Save will parse it, run the binder, and preserve any field you've already overridden in Layout.`
            }
            rows={Math.max(8, Math.min(40, (draft.match(/\n/g)?.length ?? 0) + 2))}
            className="relative w-full text-[12px] font-mono leading-relaxed bg-transparent border border-wm-border rounded-md p-3 focus:outline-none focus:border-wm-border-focus focus:ring-1 focus:ring-wm-border-focus resize-y placeholder:text-wm-text-subtle"
            style={{ color: 'transparent', caretColor: 'var(--color-wm-text)' }}
            spellCheck={false}
          />
        </div>

        {result?.warnings && result.warnings.length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {result.warnings.map((w, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[11px] text-amber-700">
                <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                <span>{w}</span>
              </li>
            ))}
          </ul>
        )}

        {result?.ok && result.preserved_overrides.length > 0 && (
          <p className="mt-2 text-[11px] text-amber-700 flex items-center gap-1.5">
            <Pin size={11} />
            {result.preserved_overrides.length} manually-edited field{result.preserved_overrides.length === 1 ? '' : 's'} preserved from your Layout edits: {result.preserved_overrides.join(', ')}
          </p>
        )}

        {result?.ok && !result.preserved_overrides.length && result.warnings.length === 0 && (
          <p className="mt-2 text-[11px] text-emerald-700 flex items-center gap-1.5">
            <CheckCircle2 size={11} /> Saved · {result.coverage.auto} field{result.coverage.auto === 1 ? '' : 's'} bound from text
          </p>
        )}

        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || saving}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold bg-wm-accent text-white px-3 py-1.5 rounded-full hover:bg-wm-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            {saving ? <Loader2 size={11} className="animate-spin" /> : null}
            Save text
          </button>
          {dirty && !saving && (
            <button
              type="button"
              onClick={handleReset}
              className="text-[11px] font-semibold text-wm-text-muted hover:text-wm-text px-2 py-1"
            >
              Reset
            </button>
          )}
          {dirty && !saving && (
            <span className="text-[11px] text-wm-text-subtle italic">Unsaved changes</span>
          )}
          <button
            type="button"
            onClick={() => setInspectorOpen(o => !o)}
            className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-wm-text-muted hover:text-wm-text px-2 py-1"
          >
            <Search size={11} />
            {inspectorOpen ? 'Hide bind details' : 'Show bind details'}
            {inspectorOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
        </div>

        {inspectorOpen && (
          <BindInspector
            section={section}
            template={template}
            provenance={provenance}
            onResetField={handleResetField}
          />
        )}
      </div>
    </article>
  )
}

// ── Bind inspector ────────────────────────────────────────────────────
//
// Surfaces how the section's bind actually mapped content. For each
// declared template slot: the current value, the provenance (auto /
// override / default / unbound), and whether the template requires it.
// Answers "I typed `**H1:** Welcome` — which slot did it land in?"
// without making the writer dig through the Layout view.

function BindInspector({
  section, template, provenance, onResetField,
}: {
  section:      WebSection
  template?:    WebContentTemplate
  provenance:   FieldProvenanceMap | null
  /** Called when staff confirms "Reset to text" on an override row.
   *  Returns the mutator's result so the row can surface errors. */
  onResetField?: (fieldKey: string) => Promise<FieldResetResult>
}) {
  if (!template) {
    return (
      <div className="mt-3 px-3 py-3 bg-wm-bg-hover/40 border border-wm-border rounded-md text-[11px] text-wm-text-muted italic">
        No template bound to this section yet. The Layout view&rsquo;s template picker assigns one — once bound, this panel shows what content each slot received.
      </div>
    )
  }

  const fieldValues = (section.field_values ?? {}) as Record<string, unknown>
  // Drop image / map slots — the writer can't contribute these from the
  // Text view, so listing them as "empty" misleads. Brixies starter
  // images stay the default and are managed in the Layout view.
  const slots = ((template.fields ?? []) as WebFieldDef[]).filter(isWriterContributableField)

  const rows: BindRow[] = []
  for (const f of slots) {
    const key = (f as { key: string }).key
    rows.push({
      key,
      label:    fieldLabelOf(f),
      kind:     f.kind,
      required: f.kind === 'slot' ? Boolean(f.required) : false,
      value:    fieldValues[key],
      provenance: provenance?.[key] ?? null,
    })
  }

  if (rows.length === 0) {
    return (
      <div className="mt-3 px-3 py-3 bg-wm-bg-hover/40 border border-wm-border rounded-md text-[11px] text-wm-text-muted italic">
        Template has no declared slots.
      </div>
    )
  }

  return (
    <div className="mt-3 border border-wm-border rounded-md bg-wm-bg-hover/40 overflow-hidden">
      <header className="px-3 py-1.5 border-b border-wm-border flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-muted">
          Bind details · {template.layer_name ?? template.family ?? template.id}
        </p>
        <p className="text-[10px] text-wm-text-subtle">
          {rows.length} slot{rows.length === 1 ? '' : 's'}
        </p>
      </header>
      <div className="divide-y divide-wm-border">
        {rows.map(row => <BindRow key={row.key} row={row} onResetField={onResetField} />)}
      </div>
    </div>
  )
}

interface BindRow {
  key:        string
  label:      string
  kind:       'slot' | 'group'
  required:   boolean
  value:      unknown
  provenance: FieldProvenance | null
}

function BindRow({
  row, onResetField,
}: {
  row: BindRow
  onResetField?: (fieldKey: string) => Promise<FieldResetResult>
}) {
  const status = statusOfRow(row)
  const [confirming, setConfirming] = useState(false)
  const [resetting, setResetting]   = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)

  const canReset = status === 'override' && Boolean(onResetField)

  const doReset = async () => {
    if (!onResetField) return
    setResetting(true)
    setResetError(null)
    const r = await onResetField(row.key)
    setResetting(false)
    setConfirming(false)
    if (!r.ok) setResetError(r.error ?? 'reset failed')
  }

  return (
    <div className="px-3 py-1.5 flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <code className="text-[11px] font-mono font-semibold text-wm-text">{row.key}</code>
          {row.kind === 'group' && (
            <span className="text-[9px] uppercase tracking-wider text-wm-text-subtle">group</span>
          )}
          {row.required && (
            <span className="text-[9px] uppercase tracking-wider text-wm-text-subtle">required</span>
          )}
        </div>
        {row.label && row.label !== row.key && (
          <p className="text-[10px] text-wm-text-subtle mt-0.5">{row.label}</p>
        )}
        <ValuePreview value={row.value} />
        <SourceTrace provenance={row.provenance} />
        {canReset && confirming && (
          <div className="mt-1.5 px-2 py-1.5 bg-amber-50 border border-amber-200 rounded text-[10px] text-amber-900 flex items-center gap-2 flex-wrap">
            <span>Drop your Layout edit and use the text-derived value?</span>
            <button
              type="button"
              onClick={doReset}
              disabled={resetting}
              className="inline-flex items-center gap-1 font-semibold text-amber-900 hover:text-amber-950 disabled:opacity-50"
            >
              {resetting ? <Loader2 size={10} className="animate-spin" /> : null}
              Confirm reset
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={resetting}
              className="text-amber-800 hover:text-amber-950 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        )}
        {resetError && (
          <p className="mt-1 text-[10px] text-red-700 flex items-center gap-1">
            <AlertCircle size={10} /> {resetError}
          </p>
        )}
      </div>
      <div className="shrink-0 flex flex-col items-end gap-1">
        <StatusBadge status={status} />
        {canReset && !confirming && (
          <button
            type="button"
            onClick={() => { setResetError(null); setConfirming(true) }}
            className="inline-flex items-center gap-1 text-[10px] font-semibold text-wm-text-muted hover:text-wm-text"
            title="Replace this override with the text-derived value"
          >
            <RotateCcw size={10} />
            Reset to text
          </button>
        )}
      </div>
    </div>
  )
}

/** Shows "from: heading · 'Where Faith Starts Young'" under a slot's
 *  value preview when the binder traced an IR block to this field. Only
 *  renders for `auto` (or `override` carrying a residual ir_path) — the
 *  source trace is meaningless for `default` / `unbound` / `empty`. */
function SourceTrace({ provenance }: { provenance: FieldProvenance | null }) {
  if (!provenance) return null
  if (provenance.source !== 'auto' && provenance.source !== 'override') return null
  const kind    = provenance.ir_kind
  const snippet = provenance.ir_text_snippet
  if (!kind && !snippet) return null
  return (
    <p
      className="text-[10px] text-wm-text-subtle mt-0.5 italic truncate"
      title={snippet || undefined}
    >
      from
      {kind && <> · <span className="font-mono not-italic">{kind}</span></>}
      {snippet && <> · &ldquo;{snippet}&rdquo;</>}
    </p>
  )
}

type RowStatus = 'auto' | 'override' | 'default' | 'unbound' | 'empty'

function statusOfRow(row: BindRow): RowStatus {
  if (row.provenance?.source) return row.provenance.source as RowStatus
  return isPopulated(row.value) ? 'auto' : (row.required ? 'unbound' : 'empty')
}

function StatusBadge({ status }: { status: RowStatus }) {
  // Plain-English labels — internal source name on the LEFT (the
  // taxonomy in webFieldProvenance), partner-readable label on the
  // RIGHT. Previously these surfaced as "auto" / "pinned" which
  // forced staff to memorize the taxonomy. Tooltip carries the
  // longer "what happens on rebind" explanation.
  const map: Record<RowStatus, { label: string; tip: string; cls: string; icon: typeof Pin }> = {
    auto: {
      label: 'From text',
      tip:   'Value came from the writer\'s markdown. Re-derived from text on every rebind.',
      cls:   'text-emerald-700 bg-emerald-50 border-emerald-200',
      icon:  CheckCircle2,
    },
    override: {
      label: 'Manually edited',
      tip:   'Staff edited this in Layout view. Preserved on rebind so writer markdown edits don\'t clobber it.',
      cls:   'text-amber-700 bg-amber-50 border-amber-200',
      icon:  Pin,
    },
    default: {
      label: 'Template default',
      tip:   'No value bound — the template\'s placeholder is filling in.',
      cls:   'text-wm-text-muted bg-wm-bg-elevated border-wm-border',
      icon:  Tag,
    },
    unbound: {
      label: 'Missing',
      tip:   'Template requires a value and nothing is bound. Needs content.',
      cls:   'text-red-700 bg-red-50 border-red-200',
      icon:  AlertCircle,
    },
    empty: {
      label: 'Optional',
      tip:   'Template allows this slot to be empty. No content required.',
      cls:   'text-wm-text-subtle bg-wm-bg-elevated border-wm-border',
      icon:  Tag,
    },
  }
  const cfg = map[status]
  const Icon = cfg.icon
  return (
    <span
      className={`shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold border rounded-full px-1.5 py-0.5 ${cfg.cls}`}
      title={cfg.tip}
    >
      <Icon size={10} />
      {cfg.label}
    </span>
  )
}

function ValuePreview({ value }: { value: unknown }) {
  const preview = summarizeValue(value)
  if (!preview) return null
  return (
    <p className="text-[11px] text-wm-text-muted mt-0.5 font-mono truncate" title={typeof value === 'string' ? value : undefined}>
      {preview}
    </p>
  )
}

function fieldLabelOf(f: WebFieldDef): string {
  if (f.kind === 'slot') return f.label ?? f.layer_name ?? f.key
  return f.layer_name ?? f.key
}

function isPopulated(v: unknown): boolean {
  if (v == null) return false
  if (typeof v === 'string') return v.trim() !== ''
  if (Array.isArray(v))      return v.length > 0
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if ('label' in o || 'url' in o) return Boolean(o.label || o.url)
    if ('items' in o)               return Array.isArray(o.items) && o.items.length > 0
    return Object.keys(o).length > 0
  }
  return Boolean(v)
}

function summarizeValue(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v.trim().slice(0, 140)
  if (Array.isArray(v))      return `${v.length} item${v.length === 1 ? '' : 's'}`
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if ('items' in o && Array.isArray((o as { items: unknown[] }).items)) {
      const items = (o as { items: unknown[] }).items
      return `${items.length} item${items.length === 1 ? '' : 's'}`
    }
    if ('label' in o || 'url' in o) {
      const label = typeof o.label === 'string' ? o.label : ''
      const url   = typeof o.url   === 'string' ? o.url   : ''
      return label && url ? `${label} → ${url}` : (label || url)
    }
    return JSON.stringify(v).slice(0, 140)
  }
  return String(v).slice(0, 140)
}

function MarkdownToolbar({
  onBold, onItalic, onH1, onH2, onBullet, onNumbered, onLink,
}: {
  onBold:     () => void
  onItalic:   () => void
  onH1:       () => void
  onH2:       () => void
  onBullet:   () => void
  onNumbered: () => void
  onLink:     () => void
}) {
  return (
    <div className="inline-flex items-center gap-0.5 border border-wm-border rounded bg-wm-bg-elevated p-0.5">
      <ToolBtn label="Heading 1"  onClick={onH1}>      <Heading1   size={12} /></ToolBtn>
      <ToolBtn label="Heading 2"  onClick={onH2}>      <Heading2   size={12} /></ToolBtn>
      <Divider />
      <ToolBtn label="Bold"       onClick={onBold}>    <Bold       size={12} /></ToolBtn>
      <ToolBtn label="Italic"     onClick={onItalic}>  <Italic     size={12} /></ToolBtn>
      <ToolBtn label="Link"       onClick={onLink}>    <LinkIcon   size={12} /></ToolBtn>
      <Divider />
      <ToolBtn label="Bullets"    onClick={onBullet}>  <List       size={12} /></ToolBtn>
      <ToolBtn label="Numbered"   onClick={onNumbered}><ListOrdered size={12} /></ToolBtn>
    </div>
  )
}

function ToolBtn({
  label, onClick, children,
}: {
  label:    string
  onClick:  () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="inline-flex items-center justify-center w-7 h-6 text-wm-text-muted hover:text-wm-text hover:bg-wm-bg-hover rounded transition"
    >
      {children}
    </button>
  )
}

function Divider() {
  return <span aria-hidden className="inline-block w-px h-4 bg-wm-border mx-0.5" />
}

/** Cowork-style field marker buttons rendered as a visible row, not a
 *  dropdown. Tags map to known parser blocks so the binder lands them
 *  in the right slot (e.g. `**Tagline:**` → kind=tagline, `**CTA:**` →
 *  kind=cta). Each button inserts `**Tag:** ` at the textarea cursor. */
function FieldMarkerRow({ onPick }: { onPick: (tag: string) => void }) {
  const tags: Array<{ tag: string; label: string; hint: string }> = [
    { tag: 'Tagline',       label: 'Tagline',   hint: 'Short label above the heading' },
    { tag: 'H1',            label: 'H1',        hint: 'Primary heading field marker' },
    { tag: 'H2',            label: 'H2',        hint: 'Section heading field marker' },
    { tag: 'Subheading',    label: 'Sub',       hint: 'Secondary heading' },
    { tag: 'Body',          label: 'Body',      hint: 'Long-form paragraph copy' },
    { tag: 'CTA',           label: 'CTA',       hint: 'Call to action — Label → `url`' },
    { tag: 'CTA Primary',   label: 'CTA 1°',    hint: 'First / main CTA' },
    { tag: 'CTA Secondary', label: 'CTA 2°',    hint: 'Second CTA' },
    { tag: 'Quote',         label: 'Quote',     hint: 'Testimonial body' },
    { tag: 'Attribution',   label: 'By',        hint: 'Testimonial attribution' },
  ]
  return (
    <div className="inline-flex items-center gap-1 flex-wrap">
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-wm-text-subtle uppercase tracking-widest pr-1">
        <Tag size={10} />
        Field
      </span>
      {tags.map(t => (
        <button
          key={t.tag}
          type="button"
          onClick={() => onPick(t.tag)}
          title={`Insert **${t.tag}:** — ${t.hint}`}
          className="text-[10px] font-mono text-wm-text-muted hover:text-wm-accent border border-wm-border hover:border-wm-accent/40 rounded px-1.5 py-0.5 bg-wm-bg-elevated transition"
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

function SnippetInserter({
  snippets, onPick,
}: {
  snippets: WMSnippetOption[]
  onPick:   (token: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')

  // Group snippets by source: globals first (church_name, phone…), then customs
  const filtered = snippets.filter(s => {
    if (!filter.trim()) return true
    const q = filter.toLowerCase()
    return s.token.toLowerCase().includes(q)
        || s.label.toLowerCase().includes(q)
        || s.resolvedValue.toLowerCase().includes(q)
  })
  const globals = filtered.filter(s => s.source === 'global')
  const customs = filtered.filter(s => s.source === 'custom')

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target?.closest('[data-snippet-popover]')) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  return (
    <div className="relative" data-snippet-popover>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1 text-[10px] font-semibold text-wm-text-muted hover:text-wm-accent border border-wm-border hover:border-wm-accent/40 rounded-full px-2 py-0.5 bg-wm-bg-elevated transition"
      >
        <Braces size={10} />
        Insert snippet
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-72 z-50 bg-wm-bg-elevated border border-wm-border rounded-lg shadow-lg overflow-hidden">
          <input
            type="text"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter snippets…"
            autoFocus
            className="w-full text-[11px] px-3 py-2 border-b border-wm-border bg-wm-bg focus:outline-none"
          />
          <div className="max-h-64 overflow-y-auto">
            {globals.length > 0 && (
              <SnippetGroup label="Global" items={globals} onPick={(t) => { onPick(t); setOpen(false) }} />
            )}
            {customs.length > 0 && (
              <SnippetGroup label="Custom" items={customs} onPick={(t) => { onPick(t); setOpen(false) }} />
            )}
            {filtered.length === 0 && (
              <p className="px-3 py-3 text-[11px] text-wm-text-muted italic">No snippets match.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function SnippetGroup({
  label, items, onPick,
}: {
  label: string
  items: WMSnippetOption[]
  onPick: (token: string) => void
}) {
  return (
    <div>
      <p className="px-3 pt-2 pb-1 text-[9px] uppercase tracking-widest font-bold text-wm-text-subtle">
        {label}
      </p>
      {items.map(s => (
        <button
          key={s.token}
          type="button"
          onClick={() => onPick(s.token)}
          className="w-full text-left px-3 py-1.5 hover:bg-wm-bg-hover transition flex items-baseline gap-2"
        >
          <code className="text-[10px] font-mono text-wm-accent shrink-0">{`{{${s.token}}}`}</code>
          <span className="text-[11px] text-wm-text-muted truncate">{s.resolvedValue || s.label}</span>
        </button>
      ))}
    </div>
  )
}

function CoverageGutter({
  coverage, onClick,
}: {
  coverage: ReturnType<typeof summarizeCoverage>
  onClick?: () => void
}) {
  const { declared, filled, override, unbound, empty } = coverage
  // No template + no provenance → nothing to summarize
  if (declared === 0 && filled === 0) {
    return <span className="text-[10px] text-wm-text-subtle italic">Freehand · no template bound</span>
  }
  // Color tone of the lead chip — green if all filled, amber if some empties,
  // red if any required slot is unbound.
  const allFilled = declared > 0 && filled === declared
  const leadTone  = unbound > 0
    ? 'text-red-700 bg-red-50 border-red-200'
    : allFilled
      ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
      : 'text-amber-700 bg-amber-50 border-amber-200'

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 text-[10px] font-medium shrink-0 hover:opacity-80 transition"
      title="Click to toggle bind details"
    >
      <span className={`inline-flex items-center gap-1 border rounded-full px-1.5 py-0.5 ${leadTone}`}>
        <CheckCircle2 size={11} /> {filled} of {declared} filled
      </span>
      {empty > 0 && (
        <span className="inline-flex items-center gap-1 text-wm-text-muted" title="Declared slots with no content — the layout expects content here">
          <AlertCircle size={11} /> {empty} empty
        </span>
      )}
      {unbound > 0 && (
        <span className="inline-flex items-center gap-1 text-red-600" title="Required slots with nothing bound — loud failure">
          <AlertCircle size={11} /> {unbound} unbound
        </span>
      )}
      {override > 0 && (
        <span className="inline-flex items-center gap-1 text-amber-700" title="Edited in Layout — preserved on rebind">
          <Pin size={11} /> {override} manually edited
        </span>
      )}
    </button>
  )
}
