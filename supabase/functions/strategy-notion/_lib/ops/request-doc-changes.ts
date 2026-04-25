import { cacheInvalidate } from '../cache.ts'
import { appendBlockChildren, postPageComment } from '../notion.ts'
import { requestChangesBlock } from '../writers.ts'

/** Post review feedback to a Notion doc.
 *
 *  Primary path: a real Notion page comment via the `/v1/comments`
 *  endpoint. Comments live in Notion's discussion panel — exactly where
 *  the doc author looks for review notes — and appear inline next to the
 *  page header in the Notion UI.
 *
 *  Fallback path: if the integration doesn't have the "Insert comments"
 *  capability, we drop back to appending a yellow callout block so the
 *  feedback is still preserved on the page. Status stays at Needs
 *  Verification either way. */
export async function requestDocChanges(
  docId: string,
  reviewerName: string,
  comments: string,
): Promise<{ ok: true }> {
  const today = new Date().toISOString().slice(0, 10)
  const text = `Request Changes from ${reviewerName} on ${today}: ${comments}`
  try {
    await postPageComment(docId, text)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Restricted-resource → fall back to a callout block so feedback
    // is still recorded somewhere visible.
    if (msg.includes('restricted_resource') || msg.toLowerCase().includes('write-capability')) {
      await appendBlockChildren(docId, [requestChangesBlock(reviewerName, comments)])
    } else {
      throw err
    }
  }
  cacheInvalidate('docs:')
  return { ok: true }
}
