import { cacheInvalidate } from '../cache.ts'
import { appendBlockChildren, createPage, postPageComment } from '../notion.ts'
import { pageToDoc } from '../parsers.ts'
import { docCreate, vpNoteCalloutBlock } from '../writers.ts'
import type { DocCreate, DocHubEntry } from '../types.ts'

/** Create a new Doc Hub page. Status is forced to "Needs Verification"
 *  server-side — staff can't publish without director sign-off.
 *
 *  VP suggest mode: when `vpNote` is set, the note is posted as a Notion
 *  page comment after the page is created (so it lands in Notion's
 *  discussion panel where the assigned director discusses page content
 *  natively). Falls back to a yellow callout body block if the integration
 *  doesn't have "Insert comments" capability — same fallback shape we use
 *  in `request-doc-changes`. */
export async function createDoc(input: DocCreate): Promise<DocHubEntry> {
  const page = await createPage(docCreate(input))
  if (input.vpNote && input.vpNote.trim()) {
    const note = input.vpNote.trim()
    try {
      await postPageComment(page.id, `Note from VP of Strategy: ${note}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('restricted_resource') || msg.toLowerCase().includes('write-capability')) {
        await appendBlockChildren(page.id, [vpNoteCalloutBlock(note)])
      } else {
        throw err
      }
    }
  }
  cacheInvalidate('docs:')
  return pageToDoc(page)
}
