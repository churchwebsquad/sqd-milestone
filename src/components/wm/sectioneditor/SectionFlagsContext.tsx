/**
 * Section-scoped field-flag context.
 *
 * Provided at the section-editor level (SectionDetailsPanel). Every
 * SlotEditor / GroupEditor descendant can consume via useSectionFlags()
 * to check whether a given fieldPath is flagged + trigger flag create /
 * update / dismiss. When no provider is present (partner portal preview,
 * embedded staff previews, etc.), the hook returns null and the
 * FlagButton renders nothing — flags are additive, never required.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { WebSectionFieldFlag } from '../../../types/database'
import {
  flagField as flagFieldLib,
  dismissFlag as dismissFlagLib,
  loadFlagsForSection,
  findOpenFlag,
} from '../../../lib/webSectionFieldFlags'

interface SectionFlagsValue {
  /** The current section's flags (all statuses). */
  flags:            WebSectionFieldFlag[]
  /** Convenience finder — returns the open flag on this field, or null. */
  openFlagFor:      (fieldPath: string) => WebSectionFieldFlag | null
  /** Create or refresh an open flag on this field. */
  flag:             (fieldPath: string, prompt: string) => Promise<{ ok: true; flag: WebSectionFieldFlag } | { ok: false; error: string }>
  /** Close an open flag as dismissed (staff cancels the ask). */
  dismiss:          (flagId: string) => Promise<boolean>
  /** Force a re-fetch (usually not needed — mutators refetch themselves). */
  refresh:          () => Promise<void>
  /** Whether flagging is available. False when required IDs are missing
   *  (e.g. the section hasn't been persisted yet). */
  enabled:          boolean
}

const Ctx = createContext<SectionFlagsValue | null>(null)

export function SectionFlagsProvider({
  webProjectId, webPageId, webSectionId, children,
}: {
  webProjectId: string | null | undefined
  webPageId:    string | null | undefined
  webSectionId: string | null | undefined
  children:     ReactNode
}) {
  const enabled = !!(webProjectId && webPageId && webSectionId)
  const [flags, setFlags] = useState<WebSectionFieldFlag[]>([])

  const refresh = useCallback(async () => {
    if (!enabled) { setFlags([]); return }
    const next = await loadFlagsForSection(webSectionId as string)
    setFlags(next)
  }, [enabled, webSectionId])

  // Fetch flags for the section on mount / when the section changes.
  // The setState inside refresh() is a sync-from-external-source
  // pattern (mirror DB state into local state), which is exactly the
  // effect-body use React docs sanction.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- sync-from-external, guarded by section id change
  useEffect(() => { void refresh() }, [refresh])

  const openFlagFor = useCallback(
    (fieldPath: string) => findOpenFlag(flags, fieldPath),
    [flags],
  )

  const flag = useCallback(async (fieldPath: string, prompt: string) => {
    if (!enabled) return { ok: false as const, error: 'Section not persisted yet.' }
    const res = await flagFieldLib({
      webProjectId: webProjectId as string,
      webPageId:    webPageId as string,
      webSectionId: webSectionId as string,
      fieldKey:     fieldPath,
      prompt,
    })
    if (res.ok) await refresh()
    return res
  }, [enabled, webProjectId, webPageId, webSectionId, refresh])

  const dismiss = useCallback(async (flagId: string) => {
    const ok = await dismissFlagLib(flagId)
    if (ok) await refresh()
    return ok
  }, [refresh])

  return (
    <Ctx.Provider value={{ flags, openFlagFor, flag, dismiss, refresh, enabled }}>
      {children}
    </Ctx.Provider>
  )
}

/** Returns the flag context, or null when no provider is present.
 *  Consumers should check for null and skip rendering flag UI when
 *  outside a provider (partner-preview mode, etc.). */
// eslint-disable-next-line react-refresh/only-export-components -- hook + provider share this file (standard context module pattern); Fast Refresh will still hot-reload the provider component
export function useSectionFlags(): SectionFlagsValue | null {
  return useContext(Ctx)
}
