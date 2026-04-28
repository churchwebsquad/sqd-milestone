/**
 * Render a markdown-flavored progress / announcement body to React.
 *
 * Matches exactly the syntax the MarkdownToolbar emits — no more, no
 * less. We deliberately don't reach for `react-markdown` so the
 * dependency surface stays light and the supported set is a single
 * source of truth between author + reader.
 *
 * Supported (block-level):
 *   - paragraphs (double-newline-separated)
 *   - bulleted list   `- item`
 *   - numbered list   `1. item`
 *   - divider          `---` on its own line
 *
 * Supported (inline, applied within paragraph + list-item text):
 *   - **bold**
 *   - _italic_
 *   - `inline code`
 *   - [link text](url)
 *
 * Anything else is rendered as plain text — including markdown
 * constructs we don't formally support (headings, tables, images).
 * This is the same trade-off the milestone-message renderer takes
 * via clickupComment.ts.
 *
 * Body strings come from Notion's Progress entry, which the parser
 * already converts to this markdown shape via `richTextToMarkdown`.
 * Authors who type markdown into the form see it round-trip cleanly.
 */

import type { ReactNode } from 'react'

interface MarkdownBodyProps {
  text: string
  /** Tailwind class to apply to the wrapping container. Lets the
   *  caller match the surrounding type scale (small text in feed
   *  rows, base text in popups, etc.). */
  className?: string
}

export function MarkdownBody({ text, className }: MarkdownBodyProps) {
  const blocks = parseBlocks(text)
  if (blocks.length === 0) return null
  return (
    <div className={className ?? 'text-sm text-deep-plum leading-relaxed space-y-2'}>
      {blocks.map((b, i) => renderBlock(b, i))}
    </div>
  )
}

// ── Block parsing ─────────────────────────────────────────────────────────

type Block =
  | { kind: 'paragraph'; text: string }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'numbered'; items: string[] }
  | { kind: 'divider' }

function parseBlocks(text: string): Block[] {
  const lines = (text ?? '').split('\n')
  const out: Block[] = []
  let buf: string[] = []
  let runKind: 'bullets' | 'numbered' | null = null
  let runItems: string[] = []

  const flushParagraph = () => {
    const joined = buf.join('\n').trim()
    if (joined) out.push({ kind: 'paragraph', text: joined })
    buf = []
  }
  const flushList = () => {
    if (runKind && runItems.length > 0) {
      out.push({ kind: runKind, items: runItems })
    }
    runKind = null
    runItems = []
  }

  for (const raw of lines) {
    const line = raw
    // Divider — three or more dashes on a line of their own
    if (/^-{3,}\s*$/.test(line.trim())) {
      flushParagraph()
      flushList()
      out.push({ kind: 'divider' })
      continue
    }
    // Bullet
    const bm = line.match(/^\s*-\s+(.*)$/)
    if (bm) {
      flushParagraph()
      if (runKind !== 'bullets') flushList()
      runKind = 'bullets'
      runItems.push(bm[1])
      continue
    }
    // Numbered
    const nm = line.match(/^\s*\d+\.\s+(.*)$/)
    if (nm) {
      flushParagraph()
      if (runKind !== 'numbered') flushList()
      runKind = 'numbered'
      runItems.push(nm[1])
      continue
    }
    // Blank — paragraph + list break
    if (line.trim() === '') {
      flushParagraph()
      flushList()
      continue
    }
    // Otherwise, paragraph line
    flushList()
    buf.push(line)
  }
  flushParagraph()
  flushList()
  return out
}

function renderBlock(block: Block, key: number): ReactNode {
  switch (block.kind) {
    case 'paragraph':
      return <p key={key}>{renderInline(block.text)}</p>
    case 'bullets':
      return (
        <ul key={key} className="list-disc pl-5 space-y-1">
          {block.items.map((it, i) => <li key={i}>{renderInline(it)}</li>)}
        </ul>
      )
    case 'numbered':
      return (
        <ol key={key} className="list-decimal pl-5 space-y-1">
          {block.items.map((it, i) => <li key={i}>{renderInline(it)}</li>)}
        </ol>
      )
    case 'divider':
      return <hr key={key} className="border-t border-lavender my-2" />
  }
}

// ── Inline parsing ────────────────────────────────────────────────────────

/** Order of operations matters. Matches longest first so `**` wins
 *  over `*` (we don't support single-asterisk bold but the regex set
 *  is built defensively) and link wins over emphasis at the same
 *  index. Each match returns a span of nodes; the recursive walker
 *  fills in plain text on either side. */
function renderInline(text: string): ReactNode[] {
  return inlineWalk(text, 0)
}

interface InlineToken {
  start: number
  end: number
  node: ReactNode
}

function inlineWalk(text: string, baseKey: number): ReactNode[] {
  const tokens: InlineToken[] = []

  // Links — [text](url)
  for (const m of text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)) {
    if (m.index === undefined) continue
    const [full, label, url] = m
    tokens.push({
      start: m.index,
      end: m.index + full.length,
      node: <a key={`${baseKey}-l${m.index}`} href={url} target="_blank" rel="noopener noreferrer" className="text-primary-purple underline hover:text-deep-plum">{label}</a>,
    })
  }
  // Code spans — `code`
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    if (m.index === undefined) continue
    if (overlaps(m.index, m.index + m[0].length, tokens)) continue
    tokens.push({
      start: m.index,
      end: m.index + m[0].length,
      node: <code key={`${baseKey}-c${m.index}`} className="font-mono text-[0.92em] bg-lavender-tint/60 rounded px-1 py-0.5 text-deep-plum">{m[1]}</code>,
    })
  }
  // Bold — **text**
  for (const m of text.matchAll(/\*\*([^*\n]+?)\*\*/g)) {
    if (m.index === undefined) continue
    if (overlaps(m.index, m.index + m[0].length, tokens)) continue
    tokens.push({
      start: m.index,
      end: m.index + m[0].length,
      node: <strong key={`${baseKey}-b${m.index}`}>{m[1]}</strong>,
    })
  }
  // Italic — _text_, with word-boundary guards so snake_case_words
  // don't trigger. Matches the rule the milestone formatter uses.
  for (const m of text.matchAll(/(^|[\s(.,;:!?'"])_([^_\n]+)_(?=$|[\s).,;:!?'"])/g)) {
    if (m.index === undefined) continue
    const offset = m[1].length // the leading boundary char isn't part of the match we replace
    const start = m.index + offset
    const end = m.index + m[0].length
    if (overlaps(start, end, tokens)) continue
    tokens.push({
      start,
      end,
      node: <em key={`${baseKey}-i${start}`}>{m[2]}</em>,
    })
  }

  // Sort by start so we can stitch the output linearly.
  tokens.sort((a, b) => a.start - b.start)

  const out: ReactNode[] = []
  let cursor = 0
  for (const t of tokens) {
    if (t.start > cursor) out.push(text.slice(cursor, t.start))
    out.push(t.node)
    cursor = t.end
  }
  if (cursor < text.length) out.push(text.slice(cursor))
  return out
}

function overlaps(start: number, end: number, tokens: InlineToken[]): boolean {
  for (const t of tokens) {
    if (start < t.end && end > t.start) return true
  }
  return false
}
