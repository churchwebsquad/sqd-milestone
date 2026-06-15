/**
 * Side drawer for inspecting a cowork artifact.
 *
 * Opens when the strategist clicks "View details" on a completed
 * step card. Loads `roadmap_state.<output_key>` from Supabase,
 * dispatches to the matching markdown converter, and renders the
 * markdown prose. Tier 2 artifacts (no converter yet) fall back to
 * a JSON `<pre>` block.
 *
 * Inline markdown renderer below — handles headings, paragraphs,
 * lists, blockquotes, inline bold / italic / code. Sufficient for
 * the artifact converters' output shapes (which deliberately avoid
 * tables in favor of definition-style lists).
 *
 * Copy as markdown + Copy as JSON give the strategist an export path
 * in either format.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Check, Loader2, Pencil, X } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { getConverterForOutputKey } from '../../../lib/cowork/artifactsToMarkdown'
import { expandCoworkTokens } from '../../../lib/cowork/coworkPromptContext'
import { NavPresentationPanel, type NavPresentation } from '../NavPresentationPanel'

interface Props {
  /** roadmap_state key. Supports nested via dot (`page_critiques.<slug>`). */
  outputKey:    string
  /** strategist-language title for the drawer header. */
  title:        string
  projectId:    string
  onClose:      () => void
}

export function CoworkArtifactDrawer({ outputKey, title, projectId, onClose }: Props) {
  const [raw, setRaw]         = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [copiedKind, setCopiedKind] = useState<'md' | 'json' | 'edit' | null>(null)

  // Load the artifact on mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    void (async () => {
      setLoading(true)
      setError(null)
      const { data, error: err } = await supabase
        .from('strategy_web_projects')
        .select('roadmap_state')
        .eq('id', projectId)
        .maybeSingle()
      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }
      const roadmap = ((data as any)?.roadmap_state ?? {}) as Record<string, any>
      // Walk dotted output_key (e.g., 'page_critiques.<slug>').
      const parts = outputKey.split('.')
      let cursor: any = roadmap
      for (const p of parts) {
        cursor = cursor?.[p]
        if (cursor == null) break
      }

      // Legacy fallback: when viewing site_strategy and the new
      // cowork artifact doesn't yet carry nav_presentation (the
      // plan-site-strategy SKILL doesn't emit it yet), splice in the
      // legacy stage_2.nav_presentation so the strategist sees the
      // rich shell + megamenu panels rendering instead of just the
      // pages list. Drops out once plan-site-strategy emits its own.
      if (outputKey === 'site_strategy' && cursor && typeof cursor === 'object' && !(cursor as any).nav_presentation) {
        const legacyNp = roadmap.stage_2?.nav_presentation
        if (legacyNp && typeof legacyNp === 'object') {
          cursor = { ...cursor, nav_presentation: legacyNp, _nav_presentation_source: 'legacy_stage_2' }
        }
      }

      setRaw(cursor ?? null)
      setLoading(false)
    })()
  }, [outputKey, projectId])

  const markdown = useMemo(() => {
    if (raw == null) return ''
    const converter = getConverterForOutputKey(outputKey)
    return converter ? converter(raw) : ''
  }, [raw, outputKey])

  const jsonString = useMemo(() => {
    if (raw == null) return ''
    return JSON.stringify(raw, null, 2)
  }, [raw])

  /** Site-strategy carries a nav_presentation block (either emitted
   *  natively by cowork plan-site-strategy or spliced in from the
   *  legacy stage_2.nav_presentation by the loader above). Render it
   *  as a real JSX panel — boxed shell card + visible-header bar +
   *  per-shell columns + featured persona callout — instead of trying
   *  to fake the layout with markdown bullets. */
  const navPresentation = useMemo<NavPresentation | null>(() => {
    if (outputKey !== 'site_strategy') return null
    const np = (raw as { nav_presentation?: NavPresentation } | null)?.nav_presentation
    return np && typeof np === 'object' ? np : null
  }, [raw, outputKey])

  /** Handoff note — ≤1-screen summary the model emits as the final
   *  substep of every pipeline step. Lands at _meta.handoff_note on
   *  every artifact (TOOL_SCHEMA for web_ui endpoints + SKILL contract
   *  for cowork sessions). Rendered as a prominent card at the top
   *  of the drawer so the strategist sees orientation + gotchas
   *  before they read the full artifact. Paste-ready via Copy button. */
  const handoffNote = useMemo<string | null>(() => {
    const meta = (raw as { _meta?: { handoff_note?: string } } | null)?._meta
    const note = meta?.handoff_note
    return typeof note === 'string' && note.trim() ? note : null
  }, [raw])
  const [handoffCopied, setHandoffCopied] = useState(false)
  const copyHandoff = () => {
    if (!handoffNote) return
    navigator.clipboard.writeText(handoffNote).then(() => {
      setHandoffCopied(true)
      setTimeout(() => setHandoffCopied(false), 2000)
    })
  }

  /** Edit-in-cowork prompt template. Currently scoped to site_strategy
   *  — strategist copies this, pastes into cowork, types their edits
   *  between the angle-bracket markers, and the revise-site-strategy
   *  SKILL walks them through each change. The SKILL.md handles the
   *  conversational back-and-forth + persists via roadmap_state_set.
   *
   *  Returns null for artifact types that don't yet have an
   *  edit-in-place SKILL — button stays hidden in that case. */
  const editPrompt = useMemo<string | null>(() => {
    if (outputKey !== 'site_strategy') return null
    // Tokens (`{{project_id}}`, `{{supabase_project}}`) get expanded
    // by expandCoworkTokens at copy-time — keeps the substitution
    // logic + Supabase preamble in one place across every cowork
    // prompt.
    return [
      `Use the **revise-site-strategy** skill for project_id \`{{project_id}}\`.`,
      ``,
      `Read:`,
      `- \`roadmap_state.site_strategy\` (the current sitemap + nav)`,
      `- \`roadmap_state.strategic_goals\` (filter to status='approved')`,
      `- \`roadmap_state.stage_1\` (personas + voice context)`,
      `- \`roadmap_state.ministry_model\` (template-choice context)`,
      ``,
      `The strategist wants the following changes:`,
      ``,
      `> <paste edits here — e.g. "Re-add the baptism page but merge it`,
      `> with /discover and rename to 'Take your first steps' — it`,
      `> should be a discipleship pathway page">`,
      ``,
      `Walk me through each change one at a time. For each one:`,
      `1. Restate the intent in your own words.`,
      `2. Propose the structural impact (pages[], nav.*, persona_journeys[], pages_considered_dropped[]).`,
      `3. Show me the before→after diff for the affected slice.`,
      `4. Wait for my OK before persisting.`,
      ``,
      `Sync \`nav_presentation\` for any edit that changes nav placement —`,
      `add/remove chips, update megamenu columns, keep visible header + sitemap in lockstep.`,
      ``,
      `When I say "save", write the revised site_strategy back via the \`roadmap_state_set\` RPC`,
      `(path: \`['site_strategy']\`). Bump \`_meta.generated_at\` and stamp \`_meta.revision_of\``,
      `with the prior generated_at so the audit trail survives.`,
    ].join('\n')
  }, [outputKey])

  const handleCopy = (kind: 'md' | 'json' | 'edit') => {
    const text = kind === 'md'
      ? markdown
      : kind === 'json'
        ? jsonString
        : editPrompt
          ? expandCoworkTokens(editPrompt, projectId)
          : ''
    if (!text) return
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKind(kind)
      setTimeout(() => setCopiedKind(null), 2000)
    })
  }

  return (
    <div className="fixed inset-0 z-40 flex" role="dialog" aria-modal="true">
      {/* Scrim */}
      <div className="flex-1 bg-black/30" onClick={onClose} />

      {/* Drawer */}
      <div className="w-full max-w-[640px] h-full bg-wm-bg-elevated border-l border-wm-border shadow-xl flex flex-col">
        {/* Header */}
        <header className="px-4 py-3 border-b border-wm-border flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Step output</p>
            <h2 className="text-[14px] font-semibold text-wm-text truncate">{title}</h2>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {editPrompt && (
              <button
                type="button"
                onClick={() => handleCopy('edit')}
                className="text-[11px] font-medium px-2.5 py-1 rounded-md bg-wm-accent text-wm-text-on-accent hover:bg-wm-accent-hover"
                title="Copy a prompt that lets you edit this artifact in cowork. Paste into Claude Desktop, type your changes, the model walks you through each one and saves back."
              >
                <span className="flex items-center gap-1">
                  {copiedKind === 'edit' ? <Check size={11} /> : <Pencil size={11} />}
                  {copiedKind === 'edit' ? 'Copied — paste in cowork' : 'Edit in cowork'}
                </span>
              </button>
            )}
            {markdown && (
              <button
                type="button"
                onClick={() => handleCopy('md')}
                className="text-[11px] font-medium px-2.5 py-1 rounded-md border border-wm-border text-wm-text-muted hover:bg-wm-bg-hover"
              >
                <span className="flex items-center gap-1">
                  {copiedKind === 'md' ? <Check size={11} /> : null}
                  {copiedKind === 'md' ? 'Copied' : 'Copy markdown'}
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={() => handleCopy('json')}
              disabled={!jsonString}
              className="text-[11px] font-medium px-2.5 py-1 rounded-md border border-wm-border text-wm-text-muted hover:bg-wm-bg-hover disabled:opacity-50"
            >
              <span className="flex items-center gap-1">
                {copiedKind === 'json' ? <Check size={11} /> : null}
                {copiedKind === 'json' ? 'Copied' : 'Copy JSON'}
              </span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-wm-text-muted hover:text-wm-text p-1 rounded-md hover:bg-wm-bg-hover"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-auto px-5 py-5">
          {loading && (
            <div className="grid place-items-center py-12 text-wm-text-muted">
              <Loader2 className="animate-spin" />
            </div>
          )}
          {!loading && error && (
            <div className="rounded-md border border-wm-danger bg-wm-danger-bg px-3 py-2 text-[12px] text-wm-danger">
              {error}
            </div>
          )}
          {!loading && !error && raw == null && (
            <div className="rounded-md border border-dashed border-wm-border bg-wm-bg p-5 text-center text-[12px] text-wm-text-muted">
              This step hasn't been run yet — nothing to show.
            </div>
          )}
          {/* Handoff note — orientation card at the very top of the
              body. Shown for ANY artifact whose _meta carries one
              (cowork-session OR web_ui). Lets the strategist read
              the model's own summary + gotchas before scanning the
              full artifact. Paste-ready for piping into the next
              cowork session. */}
          {!loading && !error && handoffNote && (
            <div className="mb-5 rounded-xl border border-wm-accent/30 bg-wm-accent-tint/20 px-4 py-3.5">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong">Handoff note</p>
                  <p className="text-[11px] text-wm-text-muted mt-0.5">From this step's session — paste into the next cowork session for context.</p>
                </div>
                <button
                  type="button"
                  onClick={copyHandoff}
                  className="text-[11px] font-medium px-2.5 py-1 rounded-md border border-wm-border bg-wm-bg-elevated text-wm-text-muted hover:bg-wm-bg-hover hover:text-wm-text shrink-0"
                >
                  <span className="flex items-center gap-1">
                    {handoffCopied ? <Check size={11} /> : null}
                    {handoffCopied ? 'Copied' : 'Copy note'}
                  </span>
                </button>
              </div>
              <article className="prose-cowork text-[12.5px] leading-relaxed">
                <MarkdownRender source={handoffNote} />
              </article>
            </div>
          )}

          {!loading && !error && raw != null && markdown && (
            <article className="prose-cowork">
              <MarkdownRender source={markdown} />
              {navPresentation && (
                <div className="mt-6">
                  <NavPresentationPanel presentation={navPresentation} />
                </div>
              )}
            </article>
          )}
          {!loading && !error && raw != null && !markdown && (
            <pre className="text-[11px] font-mono text-wm-text leading-snug whitespace-pre-wrap break-words bg-wm-bg rounded-md border border-wm-border px-3 py-3 overflow-auto">
              {jsonString}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────
// Inline markdown renderer
//
// Handles the subset our converters emit:
//   - Headings: `#`, `##`, `###`
//   - Paragraphs (blank-line separated)
//   - Unordered lists: lines starting with `- `; nested via 2-space
//     indent (`  - `).
//   - Blockquotes: lines starting with `> `
//   - Inline: **bold**, *italic*, `inline code`
//   - Divider: `---` on its own line
//
// Deliberately small. Edge cases (tables, ordered lists, nested
// quoting, images) are out of scope because the converters don't
// emit them.
// ────────────────────────────────────────────────────────────────────

function MarkdownRender({ source }: { source: string }) {
  const blocks = useMemo(() => parseBlocks(source), [source])
  return <>{blocks.map((b, i) => renderBlock(b, i))}</>
}

interface MdBlock {
  kind:    'h1' | 'h2' | 'h3' | 'p' | 'ul' | 'quote' | 'hr'
  /** For h1-h3, p, quote: the raw text (inline markdown applied at
   *  render time). For ul: array of list-item raw text (also with
   *  inline markdown applied at render). */
  content: string | string[]
}

function parseBlocks(source: string): MdBlock[] {
  const lines = source.split('\n')
  const blocks: MdBlock[] = []

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    if (trimmed.length === 0) { i++; continue }

    // Divider
    if (trimmed === '---') {
      blocks.push({ kind: 'hr', content: '' })
      i++
      continue
    }

    // Headings
    if (trimmed.startsWith('### ')) { blocks.push({ kind: 'h3', content: trimmed.slice(4) }); i++; continue }
    if (trimmed.startsWith('## '))  { blocks.push({ kind: 'h2', content: trimmed.slice(3) }); i++; continue }
    if (trimmed.startsWith('# '))   { blocks.push({ kind: 'h1', content: trimmed.slice(2) }); i++; continue }

    // Blockquote — consume consecutive `> ` lines
    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        // Strip leading "> " (with optional space)
        const stripped = lines[i].replace(/^\s*>\s?/, '')
        quoteLines.push(stripped)
        i++
      }
      blocks.push({ kind: 'quote', content: quoteLines.join('\n') })
      continue
    }

    // Unordered list — consume consecutive `- ` lines
    if (/^\s*[-*]\s/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''))
        i++
      }
      blocks.push({ kind: 'ul', content: items })
      continue
    }

    // Paragraph — consume consecutive non-empty, non-special lines
    const paraLines: string[] = []
    while (i < lines.length) {
      const ln = lines[i]
      const t  = ln.trim()
      if (t.length === 0) break
      if (t === '---') break
      if (t.startsWith('#'))  break
      if (t.startsWith('>'))  break
      if (/^\s*[-*]\s/.test(ln)) break
      paraLines.push(ln)
      i++
    }
    if (paraLines.length > 0) {
      blocks.push({ kind: 'p', content: paraLines.join('\n') })
    }
  }

  return blocks
}

function renderBlock(b: MdBlock, key: number): ReactNode | null {
  switch (b.kind) {
    case 'h1': return <h1 key={key} className="text-[20px] font-semibold text-wm-text mt-0 mb-3">{renderInline(b.content as string)}</h1>
    case 'h2': return <h2 key={key} className="text-[15px] font-semibold text-wm-text mt-5 mb-2">{renderInline(b.content as string)}</h2>
    case 'h3': return <h3 key={key} className="text-[13px] font-semibold text-wm-text mt-4 mb-1.5">{renderInline(b.content as string)}</h3>
    case 'p':  return <p key={key} className="text-[12.5px] text-wm-text leading-relaxed mb-3 whitespace-pre-wrap">{renderInline(b.content as string)}</p>
    case 'ul': return (
      <ul key={key} className="text-[12.5px] text-wm-text leading-relaxed mb-3 pl-5 list-disc space-y-1">
        {(b.content as string[]).map((item, i) => (
          <li key={i} className="marker:text-wm-text-subtle">{renderInline(item)}</li>
        ))}
      </ul>
    )
    case 'quote': return (
      <blockquote key={key} className="border-l-3 border-wm-accent pl-3 my-3 text-[12.5px] text-wm-text italic whitespace-pre-wrap bg-wm-bg-selected/40 py-1.5 rounded-r">
        {renderInline(b.content as string)}
      </blockquote>
    )
    case 'hr': return <hr key={key} className="my-4 border-wm-border" />
    default: return null
  }
}

/** Apply inline markdown — **bold**, *italic*, `code` — to a string.
 *  Returns an array of React fragments so the caller can put it in
 *  any element. Robust to nesting (bold then italic) by processing
 *  in passes. */
function renderInline(text: string): ReactNode {
  // Order matters: code (literal) first, then bold (** before *).
  // Use placeholder-and-replace to avoid double-processing.
  const tokens: Array<ReactNode | string> = [text]

  // Code
  const codeSplit = splitWith(tokens, /`([^`]+)`/g, (m) => (
    <code className="text-[11.5px] font-mono bg-wm-bg-selected/60 text-wm-accent-strong px-1 rounded">{m[1]}</code>
  ))
  // Bold (**...**)
  const boldSplit = splitWith(codeSplit, /\*\*([^*]+)\*\*/g, (m) => (
    <strong className="font-semibold text-wm-text">{m[1]}</strong>
  ))
  // Italic (*...*) — NB: don't match standalone *, only paired
  const italicSplit = splitWith(boldSplit, /(?<![*\w])\*([^*]+)\*(?!\w)/g, (m) => (
    <em>{m[1]}</em>
  ))

  return <>{italicSplit.map((node, i) => (typeof node === 'string' ? <span key={i}>{node}</span> : <span key={i}>{node}</span>))}</>
}

/** Splits an array of (string | JSX) tokens by a regex pattern,
 *  replacing matched strings with the JSX result of `make()`. Returns
 *  a new token array. Leaves non-string tokens untouched. */
function splitWith(
  tokens: Array<ReactNode | string>,
  regex:  RegExp,
  make:   (match: RegExpExecArray) => ReactNode,
): Array<ReactNode | string> {
  const out: Array<ReactNode | string> = []
  for (const tok of tokens) {
    if (typeof tok !== 'string') { out.push(tok); continue }
    let last = 0
    let m: RegExpExecArray | null
    // Reset regex state since we're reusing it across tokens
    regex.lastIndex = 0
    while ((m = regex.exec(tok)) !== null) {
      if (m.index > last) out.push(tok.slice(last, m.index))
      out.push(make(m))
      last = m.index + m[0].length
      if (m[0].length === 0) regex.lastIndex++   // safety against zero-length match
    }
    if (last < tok.length) out.push(tok.slice(last))
  }
  return out
}
