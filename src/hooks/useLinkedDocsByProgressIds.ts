/**
 * Hook that bulk-loads the linked Library docs for a set of Progress
 * entries. Used by feed surfaces (Initiative Detail, Progress page,
 * Action Item detail, My Dashboard) so each ProgressEntryItem can
 * render its "Read the docs" buttons without a per-entry round-trip.
 *
 * Re-fetches when the set of ids changes. The id list is stringified
 * for the dep array so we don't fire a fresh query on every render
 * just because the array reference changed.
 */

import { useEffect, useState } from 'react'
import { listLinkedDocsByProgressIds } from '../lib/announcements'

export type LinkedDocsMap = Map<string, Array<{ notion_id: string; title: string }>>

export function useLinkedDocsByProgressIds(progressIds: string[]): LinkedDocsMap {
  const [map, setMap] = useState<LinkedDocsMap>(() => new Map())
  const key = progressIds.join('|')
  useEffect(() => {
    if (progressIds.length === 0) {
      setMap(new Map())
      return
    }
    let cancelled = false
    listLinkedDocsByProgressIds(progressIds).then(next => {
      if (!cancelled) setMap(next)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return map
}
