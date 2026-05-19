/**
 * Cross-component bus for the section editor.
 *
 * The section editing UI is split across two panes that live in
 * different render trees: PagesWorkspace (renders the canvas) and
 * AssistantRail (renders the details panel as one of its tabs).
 *
 * This context lets PagesWorkspace publish the currently-selected
 * section's data + handlers; AssistantRail consumes the published
 * value and renders the section tab. Selection itself flows through
 * URL `?section=<id>` so it survives navigation.
 */
import { createContext, useContext, useState, useMemo } from 'react'
import type { WMSnippetOption } from '../RichTextEditor'
import type { WebContentTemplate, WebSection } from '../../../types/database'

export interface SectionDetail {
  section: WebSection
  template: WebContentTemplate | null
  snippets: readonly WMSnippetOption[]
  onChange:        (patch: Partial<WebSection>) => void
  onChangeVariant: () => void
  onUnbind:        () => void
  onRemove:        () => void
  onClose:         () => void
}

interface ContextValue {
  detail: SectionDetail | null
  publishDetail: (d: SectionDetail | null) => void
}

const Ctx = createContext<ContextValue | null>(null)

export function SectionEditingProvider({ children }: { children: React.ReactNode }) {
  const [detail, publishDetail] = useState<SectionDetail | null>(null)
  const value = useMemo<ContextValue>(() => ({ detail, publishDetail }), [detail])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** Reader hook used by AssistantRail. Returns null outside a provider. */
export function useSectionDetail(): SectionDetail | null {
  return useContext(Ctx)?.detail ?? null
}

/** Writer hook used by PagesWorkspace to publish/clear the active
 *  section's detail bag. */
export function useSectionDetailPublisher(): (d: SectionDetail | null) => void {
  const v = useContext(Ctx)
  return v?.publishDetail ?? (() => {})
}
