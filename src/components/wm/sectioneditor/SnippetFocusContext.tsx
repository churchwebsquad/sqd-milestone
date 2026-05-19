/**
 * Tracks the currently-focused editable slot inside the details panel
 * so the shared snippet picker can target the right TipTap editor or
 * input element when the strategist clicks a snippet.
 *
 * Each SlotEditor's text / richtext field registers on focus and
 * un-registers on blur. The SnippetMenu reads `focused` and routes via:
 *   - TipTap editor → `editor.commands.insertSnippet({...})`
 *   - HTML input    → splice `{{token}}` at the cursor + fire `input`
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import type { Editor as TipTapEditor } from '@tiptap/react'
import type { WMSnippetOption } from '../RichTextEditor'

export type FocusedTarget =
  | { kind: 'editor'; slotKey: string; editor: TipTapEditor }
  | { kind: 'input';  slotKey: string; input: HTMLInputElement | HTMLTextAreaElement }
  | null

export interface SnippetFocusContextValue {
  focused: FocusedTarget
  registerEditor: (slotKey: string, editor: TipTapEditor) => void
  registerInput:  (slotKey: string, input: HTMLInputElement | HTMLTextAreaElement) => void
  clear:          (slotKey: string) => void
  insertSnippet:  (s: WMSnippetOption) => void
}

const Ctx = createContext<SnippetFocusContextValue | null>(null)

export function SnippetFocusProvider({ children }: { children: React.ReactNode }) {
  const [focused, setFocused] = useState<FocusedTarget>(null)
  const focusedRef = useRef<FocusedTarget>(null)

  const registerEditor = useCallback((slotKey: string, editor: TipTapEditor) => {
    const next: FocusedTarget = { kind: 'editor', slotKey, editor }
    focusedRef.current = next
    setFocused(next)
  }, [])

  const registerInput = useCallback((slotKey: string, input: HTMLInputElement | HTMLTextAreaElement) => {
    const next: FocusedTarget = { kind: 'input', slotKey, input }
    focusedRef.current = next
    setFocused(next)
  }, [])

  const clear = useCallback((slotKey: string) => {
    if (focusedRef.current?.slotKey !== slotKey) return
    focusedRef.current = null
    setFocused(null)
  }, [])

  const insertSnippet = useCallback((s: WMSnippetOption) => {
    const cur = focusedRef.current
    if (!cur) return
    if (cur.kind === 'editor') {
      cur.editor.chain().focus().insertSnippet({
        token: s.token,
        label: s.label,
        resolvedValue: s.resolvedValue,
      }).run()
      return
    }
    const input = cur.input
    const literal = `{{${s.token}}}`
    const start = input.selectionStart ?? input.value.length
    const end = input.selectionEnd ?? input.value.length
    const next = input.value.slice(0, start) + literal + input.value.slice(end)
    const setter = Object.getOwnPropertyDescriptor(
      input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value',
    )?.set
    setter?.call(input, next)
    input.dispatchEvent(new Event('input', { bubbles: true }))
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
    return {
      focused: null,
      registerEditor: () => {},
      registerInput:  () => {},
      clear: () => {},
      insertSnippet: () => {},
    }
  }
  return v
}
