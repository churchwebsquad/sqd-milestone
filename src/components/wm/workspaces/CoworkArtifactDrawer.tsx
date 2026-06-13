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
import { Check, Loader2, X } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { getConverterForOutputKey } from '../../../lib/cowork/artifactsToMarkdown'

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
  const [copiedKind, setCopiedKind] = useState<'md' | 'json' | null>(null)

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

  const handleCopy = (kind: 'md' | 'json') => {
    const text = kind === 'md' ? markdown : jsonString
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
          {!loading && !error && raw != null && markdown && (
            <article className="prose-cowork">
              <MarkdownRender source={markdown} />
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
