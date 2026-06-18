/**
 * Project-scoped section clipboard.
 *
 * "Copy content" on a section snapshots its bound field_values + template
 * binding into this context. Any group editor on the SAME PAGE then
 * surfaces a "Paste from clipboard" affordance next to its "+ Add item"
 * button — strategist clicks it and the section's content is shape-mapped
 * into a new item in the target group. Useful when a standalone CTA
 * section should really be a tab/card under a richer parent section
 * (Brainstorm 2026-06: Second Saturday → Feature 66's tabs).
 *
 * Scope: project-level state (lives above the PageEditor) so the
 * clipboard survives page navigation. Paste UI is gated by same-page
 * check inside the consumer.
 *
 * Lifecycle: one-shot. After a successful paste OR an explicit clear,
 * the clipboard empties. No multi-paste / persistent clipboard across
 * sessions — strategists can always re-copy.
 */
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import type { WebContentTemplate, WebSection } from '../../../types/database'

export interface SectionClipboardPayload {
  sourceSectionId:   string
  sourcePageId:      string
  sourceTemplateId:  string | null
  sourceLayerName:   string                          // for the toast / archive prompt
  sourceFieldValues: Record<string, unknown>
  /** Template fields snapshot for shape-mapping. The full template
   *  rows can disappear from the editor's `templates` map if the user
   *  navigates pages, so we keep what we need on the clipboard itself. */
  sourceTemplateFields: WebContentTemplate['fields'] | null
  copiedAt:          number
}

/** Set on the context after a successful paste — drives the
 *  "Also archive source?" confirm modal at the workspace level.
 *  Consumed by PagesWorkspace's PageEditor and cleared via
 *  acknowledgePaste(archive: boolean). */
export interface PasteOffer {
  sourceSectionId: string
  sourceLayerName: string
  targetSummary:   string
}

interface ClipboardCtx {
  clipboard: SectionClipboardPayload | null
  copy:      (section: WebSection, template: WebContentTemplate | null) => void
  clear:     () => void
  notePaste: (offer: PasteOffer) => void
  pasteOffer: PasteOffer | null
  acknowledgePaste: () => void
}

const Ctx = createContext<ClipboardCtx | null>(null)

export function SectionClipboardProvider({ children }: { children: ReactNode }) {
  const [clipboard, setClipboard] = useState<SectionClipboardPayload | null>(null)
  const [pasteOffer, setPasteOffer] = useState<PasteOffer | null>(null)

  const copy = useCallback((section: WebSection, template: WebContentTemplate | null) => {
    setClipboard({
      sourceSectionId:      section.id,
      sourcePageId:         section.web_page_id,
      sourceTemplateId:     section.content_template_id ?? null,
      sourceLayerName:      template?.layer_name ?? 'Freehand section',
      sourceFieldValues:    (section.field_values ?? {}) as Record<string, unknown>,
      sourceTemplateFields: template?.fields ?? null,
      copiedAt:             Date.now(),
    })
  }, [])

  const clear = useCallback(() => setClipboard(null), [])

  const notePaste = useCallback((offer: PasteOffer) => {
    setPasteOffer(offer)
    setClipboard(null)
  }, [])

  const acknowledgePaste = useCallback(() => setPasteOffer(null), [])

  return (
    <Ctx.Provider value={{ clipboard, copy, clear, notePaste, pasteOffer, acknowledgePaste }}>
      {children}
    </Ctx.Provider>
  )
}

/** No-op fallback for when GroupEditor (or other consumers) render
 *  outside a SectionClipboardProvider — e.g. catalog previews,
 *  freehand sandboxes. Returns an empty clipboard + no-op mutators
 *  so the consumer's `canPaste` check naturally evaluates false and
 *  the paste UI stays hidden. Without this fallback the hook threw
 *  on every catalog render. */
const NOOP_CTX: ClipboardCtx = {
  clipboard:        null,
  copy:             () => {},
  clear:            () => {},
  notePaste:        () => {},
  pasteOffer:       null,
  acknowledgePaste: () => {},
}

export function useSectionClipboard(): ClipboardCtx {
  return useContext(Ctx) ?? NOOP_CTX
}
