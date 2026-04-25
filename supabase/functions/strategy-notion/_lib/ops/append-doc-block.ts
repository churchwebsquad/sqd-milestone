import { cacheInvalidate } from '../cache.ts'
import { appendBlockChildren } from '../notion.ts'
import type { EditableBlockType } from './update-doc-block.ts'

/** Append a single text-bearing block to a doc page. Used by the in-app
 *  body editor for "+ Add paragraph" / "+ Add heading" affordances. */
export async function appendDocBlock(
  docId: string,
  type: EditableBlockType,
  text: string,
): Promise<{ ok: true }> {
  const block: Record<string, unknown> = {
    object: 'block',
    type,
    [type]: { rich_text: [{ type: 'text', text: { content: text } }] },
  }
  await appendBlockChildren(docId, [block])
  cacheInvalidate(`doc-content:${docId}`)
  cacheInvalidate(`action-item:${docId}`)
  // Initiative bodies share the same /blocks/{id} endpoints; clear
  // their caches too so an inline body edit on the Initiative Detail
  // is visible on the next reload.
  cacheInvalidate(`initiative-blocks:${docId}`)
  cacheInvalidate(`initiative:${docId}`)
  cacheInvalidate('docs:')
  cacheInvalidate('milestones:')
  return { ok: true }
}
