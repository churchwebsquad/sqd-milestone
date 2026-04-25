import { cacheInvalidate } from '../cache.ts'
import { patchBlock, patchPage } from '../notion.ts'
import { docPatch } from '../writers.ts'

/** Block types the in-app body editor can update. Limited to text-bearing
 *  blocks; tables/embeds/images stay read-only and route to Notion. */
export type EditableBlockType =
  | 'paragraph' | 'heading_1' | 'heading_2' | 'heading_3'
  | 'bulleted_list_item' | 'numbered_list_item'
  | 'to_do' | 'toggle' | 'quote' | 'callout'

/** Update a single block's text via PATCH /v1/blocks/{id}. The Notion
 *  payload nests `rich_text` under the block's type key (e.g.
 *  `{ paragraph: { rich_text: [...] } }`), so we have to switch on type to
 *  build the right shape. Plain-text round-trip — formatting collapses
 *  on save, matching the Phase 2 trade-off documented in writers.ts.
 *
 *  Verification flip: when `isDirector` is false, the doc's verification
 *  status drops back to "needs-verification" so a director can re-confirm
 *  the new content. Director edits are trusted and don't trigger the flip. */
export async function updateDocBlock(
  docId: string,
  blockId: string,
  type: EditableBlockType,
  text: string,
  meta?: { checked?: boolean },
  isDirector = false,
): Promise<{ ok: true; flippedToNeedsVerification: boolean }> {
  const richText = [{ type: 'text', text: { content: text } }]
  const inner: Record<string, unknown> = { rich_text: richText }
  if (type === 'to_do' && meta && typeof meta.checked === 'boolean') {
    inner.checked = meta.checked
  }
  await patchBlock(blockId, { [type]: inner })

  let flipped = false
  if (!isDirector) {
    try {
      await patchPage(docId, docPatch({
        verificationStatus: 'needs-verification',
        verifiedBy: null,
        verifiedOn: null,
      }))
      flipped = true
    } catch {
      // Don't fail the whole edit if the verification flip can't write.
      // The block edit succeeded — just no flip.
    }
  }

  // Invalidate both possible content caches — the same Notion block patch
  // serves library docs (doc-content cache) and Action Items (action-item
  // cache). Calling both is cheap and lets a single op support both
  // surfaces without a separate parallel op.
  cacheInvalidate(`doc-content:${docId}`)
  cacheInvalidate(`action-item:${docId}`)
  cacheInvalidate(`initiative-blocks:${docId}`)
  cacheInvalidate(`initiative:${docId}`)
  cacheInvalidate('docs:')
  cacheInvalidate('milestones:')
  return { ok: true, flippedToNeedsVerification: flipped }
}
