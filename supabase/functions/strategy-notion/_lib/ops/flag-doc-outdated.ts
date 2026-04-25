import { cacheInvalidate } from '../cache.ts'
import { appendBlockChildren, fetchPage, patchPage, postPageComment } from '../notion.ts'
import { pageToDoc } from '../parsers.ts'
import { docPatch } from '../writers.ts'
import type { DocHubEntry } from '../types.ts'

/** Flag a doc as outdated. Any user (not just directors) can do this —
 *  the goal is to surface drift quickly. Two effects:
 *
 *  1. A Notion page comment posts in the discussion panel:
 *     "Flagged as outdated by {flaggerName} on {date}: {reason}"
 *     (falls back to a yellow callout block if the integration lacks
 *     "Insert comments" capability — same fallback as request-doc-changes)
 *  2. Verification Status flips to "Outdated" so the doc surfaces with
 *     a distinct badge — different from `Needs Verification` which is
 *     the initial state for new docs. Directors triage outdated rows
 *     in the same Doc Manager bucket as needs-verification, but they
 *     see at a glance which ones are regressions vs greenfield.
 *
 *  Resilience: the comment write and the status patch run independently.
 *  Either failing alone is logged but does not block the other. If the
 *  Notion DB doesn't have an "Outdated" Status option (Notion's API can't
 *  add Status options programmatically — they have to be added by hand),
 *  we fall back to "Needs Verification" so the flag is at least registered
 *  and the comment carries the framing. We only throw if BOTH operations
 *  fail — that's a real backend problem the user needs to see.
 *
 *  The doc *isn't* archived or unlinked — readers can still open and use
 *  it; they just see the lowered verification badge until a director
 *  confirms the changes. */
export async function flagDocOutdated(
  docId: string,
  flaggerName: string,
  reason: string,
): Promise<DocHubEntry> {
  const today = new Date().toISOString().slice(0, 10)
  const text = `Flagged as outdated by ${flaggerName} on ${today}: ${reason}`

  let commentOk = false
  let commentErr: unknown = null
  let statusOk = false
  let statusErr: unknown = null

  // Step 1: post comment (with callout fallback when comments capability
  // is missing). We swallow non-capability errors here so a comment
  // outage doesn't block the status flip — the user's main intent is
  // surfacing the doc as outdated.
  try {
    await postPageComment(docId, text)
    commentOk = true
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('restricted_resource') || msg.toLowerCase().includes('write-capability')) {
      try {
        await appendBlockChildren(docId, [{
          object: 'block',
          type: 'callout',
          callout: {
            rich_text: [{ type: 'text', text: { content: text } }],
            icon: { type: 'emoji', emoji: '⚠️' },
            color: 'orange_background',
          },
        }])
        commentOk = true
      } catch (fallbackErr) {
        commentErr = fallbackErr
        console.error('[flag-doc-outdated] comment + callout fallback both failed:', fallbackErr)
      }
    } else {
      commentErr = err
      console.error('[flag-doc-outdated] comment post failed:', msg)
    }
  }

  // Step 2: flip Verification Status to Outdated. Fall back to
  // needs-verification if the Outdated option doesn't yet exist on the
  // Notion DB — that has to be added manually in Notion's property
  // editor (the API rejects unknown status names with a 400). We try
  // outdated first because it carries the right semantic, but if it's
  // not configured we still want to lower the badge.
  try {
    await patchPage(docId, docPatch({
      verificationStatus: 'outdated',
      verifiedBy: null,
      verifiedOn: null,
    }))
    statusOk = true
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[flag-doc-outdated] outdated status patch failed, retrying with needs-verification:', msg)
    try {
      await patchPage(docId, docPatch({
        verificationStatus: 'needs-verification',
        verifiedBy: null,
        verifiedOn: null,
      }))
      statusOk = true
    } catch (fallbackErr) {
      statusErr = fallbackErr
      console.error('[flag-doc-outdated] needs-verification fallback also failed:', fallbackErr)
    }
  }

  // Both halves failed → surface the underlying error so the user knows
  // nothing happened. A single half failing is acceptable degraded
  // behavior (the comment alone, or the status alone, still
  // communicates the flag).
  if (!commentOk && !statusOk) {
    throw statusErr ?? commentErr ?? new Error('Flag outdated: both comment and status updates failed')
  }

  cacheInvalidate('docs:')
  cacheInvalidate(`doc-content:${docId}`)

  return pageToDoc(await fetchPage(docId))
}
