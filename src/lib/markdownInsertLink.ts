/**
 * Insert a markdown link `[text](url)` into a textarea, preserving selection/caret.
 *
 * Behavior:
 *   - If the textarea has a current selection: uses it as the link text.
 *     Prompts for URL only. On cancel or empty URL: no-op.
 *   - If there's no selection: prompts for link text, then URL. Empty at either
 *     step = no-op.
 *   - Normalizes URLs without a scheme by prefixing `https://`.
 *   - After insertion, the link text portion (what goes between the brackets)
 *     is selected, so the user can immediately rename it by typing.
 */
export function insertMarkdownLink(
  ta: HTMLTextAreaElement,
  currentValue: string,
  onChange: (next: string) => void,
): void {
  const start = ta.selectionStart ?? 0
  const end = ta.selectionEnd ?? 0
  const hasSelection = end > start

  let linkText = hasSelection ? currentValue.slice(start, end) : ''
  if (!hasSelection) {
    const t = window.prompt('Link text:')
    if (t === null) return
    linkText = t.trim()
    if (!linkText) return
  }

  const rawUrl = window.prompt('URL:')
  if (rawUrl === null) return
  const cleanUrl = rawUrl.trim()
  if (!cleanUrl) return

  const normalized = /^https?:\/\//i.test(cleanUrl) ? cleanUrl : `https://${cleanUrl}`
  const snippet = `[${linkText}](${normalized})`
  const next = currentValue.slice(0, start) + snippet + currentValue.slice(end)

  onChange(next)

  // Reselect the link text portion on the next frame so the textarea value has
  // already been committed by React.
  const textStart = start + 1
  const textEnd = textStart + linkText.length
  requestAnimationFrame(() => {
    ta.focus()
    ta.setSelectionRange(textStart, textEnd)
  })
}
