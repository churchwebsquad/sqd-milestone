/**
 * Tracks the currently-focused editable slot so the section-level
 * snippet picker (and other contextual affordances) can target the
 * right TipTap editor or input element.
 *
 * Each EditableSlot registers itself on focus / unregisters on blur.
 * The section's snippet picker reads `focused` and inserts via:
 *   - TipTap editor → `editor.commands.insertSnippet({...})`
 *   - HTML input → splice `{{token}}` at the cursor + fire input event
 *
 * The popup bar also reads this context to know which slot to render
 * controls for.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import type { Editor as TipTapEditor } from '@tiptap/react'
import type { WMSnippetOption } from '../RichTextEditor'

export type FocusedTarget =
  | { kind: 'editor'; slotKey: string; editor: TipTapEditor; element: HTMLElement | null }
  | { kind: 'input'; slotKey: string; input: HTMLInputElement | HTMLTextAreaElement }
  | null

export interface SnippetFocusContextValue {
  focused: FocusedTarget
  registerEditor: (slotKey: string, editor: TipTapEditor, element: HTMLElement | null) => void
  registerInput: (slotKey: string, input: HTMLInputElement | HTMLTextAreaElement) => void
  clear: (slotKey: string) => void
  /** Helper: insert the snippet into the currently-focused target. */
  insertSnippet: (s: WMSnippetOption) => void
}

const Ctx = createContext<SnippetFocusContextValue | null>(null)

export function SnippetFocusProvider({ children }: { children: React.ReactNode }) {
  // Use a ref + state pair so consumers re-render on focus changes
  // (e.g. the popup bar must reposition when focus moves) while
  // imperative writes (register / clear) don't double-buffer through
  // React state.
  const [focused, setFocused] = useState<FocusedTarget>(null)
  const focusedRef = useRef<FocusedTarget>(null)

  const registerEditor = useCallback(
    (slotKey: string, editor: TipTapEditor, element: HTMLElement | null) => {
      const next: FocusedTarget = { kind: 'editor', slotKey, editor, element }
      focusedRef.current = next
      setFocused(next)
    },
    [],
  )
  const registerInput = useCallback(
    (slotKey: string, input: HTMLInputElement | HTMLTextAreaElement) => {
      const next: FocusedTarget = { kind: 'input', slotKey, input }
      focusedRef.current = next
      setFocused(next)
    },
    [],
  )
  const clear = useCallback((slotKey: string) => {
    if (focusedRef.current?.slotKey !== slotKey) return
    focusedRef.current = null
    setFocused(null)
  }, [])

  const insertSnippet = useCallback((s: WMSnippetOption) => {
    const cur = focusedRef.current
    if (!cur) return
    if (cur.kind === 'editor') {
      cur.editor
        .chain()
        .focus()
        .insertSnippet({
          token: s.token,
          label: s.label,
          resolvedValue: s.resolvedValue,
        })
        .run()
      return
    }
    // Text input: splice literal at the cursor.
    const input = cur.input
    const literal = `{{${s.token}}}`
    const start = input.selectionStart ?? input.value.length
    const end = input.selectionEnd ?? input.value.length
    const next = input.value.slice(0, start) + literal + input.value.slice(end)
    // React-controlled inputs need a native setter to trigger onChange.
    const setter = Object.getOwnPropertyDescriptor(
      input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value',
    )?.set
    setter?.call(input, next)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    // Move cursor to just after the inserted snippet.
    requestAnimationFrame(() => {
      const pos = start + literal.length
      input.setSelectionRange(pos, pos)
      input.focus()
    })
  }, [])

  const value = useMemo<SnippetFocusContextValue>(
    () => ({ focused, registerEditor, registerInput, clear, insertSnippet }),
    [focused, registerEditor, registerInput, clear, insertSnippet],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSnippetFocus(): SnippetFocusContextValue {
  const v = useContext(Ctx)
  if (!v) {
    // Allow rendering outside a provider (e.g. older paths or freehand
    // editor) — return a no-op value so consumers don't crash.
    return {
      focused: null,
      registerEditor: () => {},
      registerInput: () => {},
      clear: () => {},
      insertSnippet: () => {},
    }
  }
  return v
}
