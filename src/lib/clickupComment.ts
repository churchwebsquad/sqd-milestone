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

// ── Bold expansion ────────────────────────────────────────────────────────────

/**
 * Splits a single text segment on `**...**` markers, returning one or more
 * segments. Bold segments gain `attributes: { bold: true }`. Any existing
 * attributes on the input segment are preserved alongside bold.
 */
function expandBold(seg: ClickUpTextSegment): ClickUpCommentSegment[] {
  const { text, attributes: existing } = seg
  const boldRe = /\*\*(.+?)\*\*/gs  // non-greedy; s flag lets . match \n

  const segments: ClickUpCommentSegment[] = []
  let last = 0

  for (const match of text.matchAll(boldRe)) {
    const before = text.slice(last, match.index!)
    if (before) {
      segments.push(existing ? { text: before, attributes: existing } : { text: before })
    }
    segments.push({ text: match[1], attributes: { ...existing, bold: true } })
    last = match.index! + match[0].length
  }

  const remaining = text.slice(last)
  if (remaining) {
    segments.push(existing ? { text: remaining, attributes: existing } : { text: remaining })
  }

  return segments.length > 0 ? segments : [seg]
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
  // ── Pass 1: split by @mentions ────────────────────────────────────────────
  const valid = mentions.filter(
    m => m.text.trim() !== '' && Number.isInteger(m.clickupId) && m.clickupId > 0,
  )

  let pass1: ClickUpCommentSegment[]

  if (valid.length === 0) {
    pass1 = text ? [{ text }] : []
  } else {
    // Longest match first so "@john.smith.junior" beats "@john.smith"
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const sorted = [...valid].sort((a, b) => b.text.length - a.text.length)
    const pattern = sorted.map(m => escape(m.text)).join('|')
    const re = new RegExp(`(${pattern})`, 'g')
    const idByText = new Map(valid.map(m => [m.text, m.clickupId]))

    pass1 = []
    let lastIndex = 0

    for (const match of text.matchAll(re)) {
      const before = text.slice(lastIndex, match.index!)
      if (before) pass1.push({ text: before })

      const clickupId = idByText.get(match[0])!
      pass1.push({ type: 'tag', user: { id: clickupId } })

      lastIndex = match.index! + match[0].length
    }

    const remaining = text.slice(lastIndex)
    if (remaining) pass1.push({ text: remaining })
  }

  // ── Pass 2: expand **bold** within each text segment ─────────────────────
  const result: ClickUpCommentSegment[] = []
  for (const seg of pass1) {
    if ('type' in seg) {
      result.push(seg)   // tag segments pass through unchanged
    } else {
      result.push(...expandBold(seg))
    }
  }

  return result
}
