/**
 * Markup.io webhook payloads land in `strategy_milestone_replies.reply_text`
 * as a serialized JSON object (the wrapper with `firstMessage.text`, not the
 * plain comment string). Any UI that shows the reply text should unwrap it
 * so staff see the comment, not the raw thread envelope.
 *
 * Non-JSON inputs (ClickUp replies, empty strings, legacy rows) pass through
 * unchanged. Parse failures also pass through — never throw on a malformed
 * row, just show what we've got.
 */
export function displayReplyText(raw: string | null | undefined): string {
  if (!raw) return ''
  const trimmed = raw.trim()
  if (!trimmed.startsWith('{')) return raw
  try {
    const parsed = JSON.parse(trimmed) as { firstMessage?: { text?: unknown } }
    const text = parsed.firstMessage?.text
    return typeof text === 'string' ? text : raw
  } catch {
    return raw
  }
}
