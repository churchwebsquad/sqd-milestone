/**
 * ClickUp rich-text comment segment types and helpers.
 *
 * ClickUp's chat API accepts a `comment` array of typed segments rather than
 * a plain `comment_text` string. This enables actual user @tags (which fire
 * notifications), bold text, and real hyperlinks.
 *
 * Reference shapes:
 *   Text:  { text: string, attributes?: { bold?, italic?, link? } }
 *   Tag:   { type: "tag", user: { id: number } }
 */

export interface ClickUpTextSegment {
  text: string
  attributes?: {
    bold?: true
    italic?: true
    code?: true
    link?: string
  }
}

export interface ClickUpTagSegment {
  type: 'tag'
  user: { id: number }
}

export type ClickUpCommentSegment = ClickUpTextSegment | ClickUpTagSegment

/**
 * A resolved mention: the exact string as it will appear in the rendered
 * message text, mapped to the ClickUp user ID that should replace it.
 */
export interface ClickUpMention {
  /** Exact substring to replace — e.g. "@john.smith" or "Ashley Fox" */
  text: string
  clickupId: number
}

// ── Markdown preprocessing ───────────────────────────────────────────────────

/**
 * Pre-processes raw markdown text into ClickUp-chat-friendly plain text:
 *   - Lines of just `---` (or more dashes) become a horizontal divider line
 *   - `- item` bullet syntax becomes `• item` (bullet character renders as a list)
 *   - `1. item` numbered lists are preserved as-is (already visually list-like)
 */
export function preprocessMarkdown(text: string): string {
  return text
    .split('\n')
    .map(line => {
      const trimmed = line.trim()
      if (/^-{3,}$/.test(trimmed)) return '─'.repeat(30)
      const bullet = line.match(/^(\s*)-\s+(.+)$/)
      if (bullet) return `${bullet[1]}•  ${bullet[2]}`
      return line
    })
    .join('\n')
}

// ── Inline formatting expansion (bold + italic + code) ───────────────────────

interface FormatRule {
  name: 'bold' | 'italic' | 'code'
  re: RegExp
  attr: { bold?: true; italic?: true; code?: true }
}

/**
 * Generic inline-formatting expander. Runs each rule in order on a single
 * text segment, splitting on the match and applying the corresponding
 * attribute to matched groups.
 */
function expandInline(seg: ClickUpTextSegment, rule: FormatRule): ClickUpCommentSegment[] {
  const { text, attributes: existing } = seg
  const segments: ClickUpCommentSegment[] = []
  let last = 0

  for (const match of text.matchAll(rule.re)) {
    const before = text.slice(last, match.index!)
    if (before) {
      segments.push(existing ? { text: before, attributes: existing } : { text: before })
    }
    segments.push({ text: match[1], attributes: { ...existing, ...rule.attr } })
    last = match.index! + match[0].length
  }

  const remaining = text.slice(last)
  if (remaining) {
    segments.push(existing ? { text: remaining, attributes: existing } : { text: remaining })
  }

  return segments.length > 0 ? segments : [seg]
}

function expandBold(seg: ClickUpTextSegment): ClickUpCommentSegment[] {
  return expandInline(seg, { name: 'bold', re: /\*\*(.+?)\*\*/gs, attr: { bold: true } })
}

function expandItalic(seg: ClickUpTextSegment): ClickUpCommentSegment[] {
  // Matches `_italic_` — not adjacent to word characters (avoids matching in URLs)
  return expandInline(seg, { name: 'italic', re: /(?<![A-Za-z0-9/])_([^_\n]+?)_(?![A-Za-z0-9/])/g, attr: { italic: true } })
}

function expandCode(seg: ClickUpTextSegment): ClickUpCommentSegment[] {
  return expandInline(seg, { name: 'code', re: /`([^`\n]+?)`/g, attr: { code: true } })
}

/**
 * Expand markdown links `[text](url)` into text segments with a `link` attribute.
 * Runs before bold/italic/code so inner formatting on the link text still applies.
 * URL cannot contain whitespace or closing paren.
 */
function expandLink(seg: ClickUpTextSegment): ClickUpCommentSegment[] {
  const re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g
  const { text, attributes: existing } = seg
  const segments: ClickUpCommentSegment[] = []
  let last = 0

  for (const match of text.matchAll(re)) {
    const before = text.slice(last, match.index!)
    if (before) segments.push(existing ? { text: before, attributes: existing } : { text: before })
    segments.push({
      text: match[1],
      attributes: { ...existing, link: match[2] },
    })
    last = match.index! + match[0].length
  }

  const remaining = text.slice(last)
  if (remaining) segments.push(existing ? { text: remaining, attributes: existing } : { text: remaining })

  return segments.length > 0 ? segments : [seg]
}

/** Apply a list of expanders in sequence to a single segment. */
function runExpanders(
  seg: ClickUpTextSegment,
  expanders: Array<(s: ClickUpTextSegment) => ClickUpCommentSegment[]>,
): ClickUpCommentSegment[] {
  let current: ClickUpCommentSegment[] = [seg]
  for (const fn of expanders) {
    const next: ClickUpCommentSegment[] = []
    for (const s of current) {
      if ('type' in s) next.push(s)
      else next.push(...fn(s))
    }
    current = next
  }
  return current
}

// ── Main builder ──────────────────────────────────────────────────────────────

/**
 * Converts a plain message string into a ClickUp comment segment array:
 *
 * 1. **Mention pass** — splits `text` at every occurrence of a registered
 *    mention string and replaces it with a `{ type: "tag" }` segment. This
 *    gives real @-tag notifications rather than flat text.
 *
 * 2. **Bold pass** — for every resulting text segment, expands `**...**`
 *    markers into segments with `attributes: { bold: true }`. Markdown-style
 *    `**bold**` in templates and recap headers renders as actual bold in
 *    ClickUp chat.
 *
 * Mention matching wins over bold (bold is applied only within a single
 * un-tagged text span, not across a mention boundary).
 */
export function buildCommentArray(
  text: string,
  mentions: ClickUpMention[],
): ClickUpCommentSegment[] {
  // ── Pass 0: markdown preprocessing (bullets, dividers) ───────────────────
  const processed = preprocessMarkdown(text)

  // ── Pass 1: split by @mentions ────────────────────────────────────────────
  const valid = mentions.filter(
    m => m.text.trim() !== '' && Number.isInteger(m.clickupId) && m.clickupId > 0,
  )

  let pass1: ClickUpCommentSegment[]

  if (valid.length === 0) {
    pass1 = processed ? [{ text: processed }] : []
  } else {
    // Longest match first so "@john.smith.junior" beats "@john.smith"
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const sorted = [...valid].sort((a, b) => b.text.length - a.text.length)
    const pattern = sorted.map(m => escape(m.text)).join('|')
    const re = new RegExp(`(${pattern})`, 'g')
    const idByText = new Map(valid.map(m => [m.text, m.clickupId]))

    pass1 = []
    let lastIndex = 0

    for (const match of processed.matchAll(re)) {
      const before = processed.slice(lastIndex, match.index!)
      if (before) pass1.push({ text: before })

      const clickupId = idByText.get(match[0])!
      pass1.push({ type: 'tag', user: { id: clickupId } })

      lastIndex = match.index! + match[0].length
    }

    const remaining = processed.slice(lastIndex)
    if (remaining) pass1.push({ text: remaining })
  }

  // ── Pass 2: expand inline formatting (bold → italic → code) ──────────────
  const result: ClickUpCommentSegment[] = []
  for (const seg of pass1) {
    if ('type' in seg) {
      result.push(seg)
    } else {
      result.push(...runExpanders(seg, [expandLink, expandBold, expandItalic, expandCode]))
    }
  }

  return result
}
