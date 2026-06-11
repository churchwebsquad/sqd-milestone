/**
 * Render verbatim transcript citations beneath each generated option.
 *
 * The coach uses these to verify the AI isn't fabricating quotes — if
 * the citation isn't actually in the transcript, the option is suspect.
 *
 * Lifted from srp-generator-main's visual pattern: italic muted text
 * with a left border, prefixed "Source:".
 */

export function CitationsList({ items }: { items?: string | string[] | null }) {
  const list = Array.isArray(items)
    ? items.filter(Boolean)
    : items ? [items] : []
  if (list.length === 0) return null

  return (
    <ul className="space-y-1">
      {list.map((c, i) => (
        <li
          key={i}
          className="text-[11px] italic text-[var(--color-purple-gray)] border-l-2 border-[var(--color-lavender)] pl-2 leading-snug"
        >
          Source: &ldquo;{c}&rdquo;
        </li>
      ))}
    </ul>
  )
}
