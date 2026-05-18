/**
 * Inline-editable slot renderers for the Brixies live-assembly editor.
 *
 * One small component per slot type:
 *
 *   - text / url / email / phone — borderless input that inherits the
 *     wrapper's typography (so an editable H1 reads as an H1).
 *   - richtext — small TipTap editor with bold / italic / link / list /
 *     snippet, no headings (those are their own slots).
 *   - cta — single-line "label → /route" with both fields inline-edit.
 *   - image — non-editable grey placeholder; section-header chip
 *     surfaces the count expectation.
 *   - form-input — non-editable "[Search input]" / "[Email input]"
 *     pill placeholder.
 *
 * Each component renders INSIDE the original Brixies element (passed
 * through as `wrapper`), so layout positioning + Brixies inline styles
 * stay intact. The wrapper's text content is replaced; everything else
 * (padding, flex, colors) is preserved.
 */
import { useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { SnippetNode } from '../SnippetNode'
import type { WebSlotDef } from '../../../types/database'
import type { WMSnippetOption } from '../RichTextEditor'
import { ImageIcon, Trash2 } from 'lucide-react'

interface CommonProps {
  slot: WebSlotDef
  value: unknown
  onChange: (v: unknown) => void
  /** When true, render a small × delete affordance (used for group
   *  items — cards, buttons — so the user can drop them in place). */
  onRemoveItem?: () => void
  snippets?: readonly WMSnippetOption[]
}

export function EditableSlot(props: CommonProps) {
  const { slot } = props
  switch (slot.type) {
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
    case 'datetime':
      return <TextSlot {...props} />
    case 'richtext':
      return <RichTextSlot {...props} />
    case 'cta':
      return <CtaSlot {...props} />
    case 'image':
      return <ImageSlot {...props} />
    case 'form-input':
      return <FormInputSlot {...props} />
    case 'boolean':
      return <BooleanSlot {...props} />
    default:
      return <TextSlot {...props} />
  }
}

/** Inline text input that visually inherits the wrapper's typography. */
function TextSlot({ slot, value, onChange }: CommonProps) {
  const text = typeof value === 'string' ? value : ''
  const inputType = slot.type === 'url' ? 'url'
    : slot.type === 'email' ? 'email'
    : slot.type === 'phone' ? 'tel'
    : slot.type === 'datetime' ? 'datetime-local'
    : 'text'
  return (
    <input
      type={inputType}
      value={text}
      maxLength={slot.max_chars}
      onChange={e => onChange(e.target.value)}
      placeholder={slot.description ?? slot.label ?? slot.key.replace(/_/g, ' ')}
      className="bx-slot bx-slot-text"
      data-bx-slot-key={slot.key}
    />
  )
}

/** Inline TipTap for richtext slots — body / description. */
function RichTextSlot({ slot, value, onChange, snippets }: CommonProps) {
  const html = typeof value === 'string' ? value : ''
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,           // headings are their own slots
        blockquote: false,
        horizontalRule: false,
        strike: false,
        dropcursor: false,
        link: false,
      }),
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder: slot.description ?? 'Write…' }),
      SnippetNode,
    ],
    content: html,
    onUpdate: ({ editor: ed }) => onChange(ed.getHTML()),
    editorProps: { attributes: { class: 'bx-slot bx-slot-richtext' } },
  })

  // External value updates (rebind, AI rewrite) need to push into the
  // editor without echoing back via onUpdate.
  useEffect(() => {
    if (!editor) return
    const current = editor.getHTML()
    if (current === html) return
    editor.commands.setContent(html, { emitUpdate: false })
  }, [editor, html])

  // Track snippets so the chip auto-resolve stays current — handled by
  // a separate refresh pass at editor mount.
  void snippets

  return <EditorContent editor={editor} />
}

/** Single-line "label → /route" with both inline-editable. */
function CtaSlot({ slot, value, onChange, onRemoveItem }: CommonProps) {
  const cta = (typeof value === 'object' && value !== null)
    ? value as { label?: string; url?: string }
    : { label: '', url: '' }
  return (
    <span className="bx-slot bx-slot-cta" data-bx-slot-key={slot.key}>
      <input
        type="text"
        value={cta.label ?? ''}
        onChange={e => onChange({ ...cta, label: e.target.value })}
        placeholder="Button label"
        className="bx-cta-label"
      />
      <span className="bx-cta-arrow">→</span>
      <input
        type="url"
        value={cta.url ?? ''}
        onChange={e => onChange({ ...cta, url: e.target.value })}
        placeholder="/route"
        className="bx-cta-url"
      />
      {onRemoveItem && (
        <button
          type="button"
          onClick={onRemoveItem}
          className="bx-item-remove"
          title="Remove"
        ><Trash2 size={10} /></button>
      )}
    </span>
  )
}

/** Non-editable grey placeholder. Image presence is template-driven —
 *  authoring/upload happens in a separate Assets step. */
function ImageSlot({ slot }: CommonProps) {
  return (
    <span className="bx-slot bx-slot-image" data-bx-slot-key={slot.key} title={`${slot.label ?? slot.key} (image)`}>
      <ImageIcon size={14} />
    </span>
  )
}

/** Pill placeholder — "Search input" / "Email input" — not editable. */
function FormInputSlot({ slot }: CommonProps) {
  return (
    <span className="bx-slot bx-slot-forminput" data-bx-slot-key={slot.key}>
      [{slot.label ?? slot.key}]
    </span>
  )
}

/** Small toggle for boolean slots. */
function BooleanSlot({ slot, value, onChange }: CommonProps) {
  const [draft, setDraft] = useState<boolean>(value === true)
  // Reflect external changes.
  const lastValueRef = useRef<unknown>(value)
  if (lastValueRef.current !== value) {
    lastValueRef.current = value
    if ((value === true) !== draft) setDraft(value === true)
  }
  return (
    <label className="bx-slot bx-slot-boolean" data-bx-slot-key={slot.key}>
      <input
        type="checkbox"
        checked={draft}
        onChange={e => { setDraft(e.target.checked); onChange(e.target.checked) }}
      />
      <span>{slot.description ?? slot.label ?? slot.key}</span>
    </label>
  )
}
