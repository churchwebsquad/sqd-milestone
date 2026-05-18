/**
 * Inline-editable slot renderers for the Brixies layout canvas.
 *
 * v3 changes from v2:
 *   - RichTextSlot fully restored — Bold / Italic / Link / Bullet
 *     list / Ordered list available via TipTap's BubbleMenu (text
 *     selection) AND via the section-level popup bar (slot focus).
 *   - All slots register with SnippetFocusContext on focus so the
 *     section's Snippet picker knows where to insert.
 *   - TextSlot inherits typography from its wrapper so an H1 input
 *     reads as an H1.
 *
 * Each slot type is its own component, dispatched by `slot.type` /
 * `slot.heading_level` from the public `<EditableSlot>` entry.
 */
import { useEffect, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import {
  Bold, Italic, Link as LinkIcon, List, ListOrdered, Image as ImageIcon, Trash2,
} from 'lucide-react'
import { SnippetNode } from '../SnippetNode'
import { useSnippetFocus } from './SnippetFocusContext'
import type { WebSlotDef } from '../../../types/database'

interface CommonProps {
  slot: WebSlotDef
  value: unknown
  onChange: (v: unknown) => void
  /** When the slot lives inside a group item, this remove handler
   *  lets the popup bar / corner control drop the item. */
  onRemoveItem?: () => void
}

export function EditableSlot(props: CommonProps) {
  const { slot } = props
  switch (slot.type) {
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
    case 'datetime':
    case 'url':
    case 'email':
    case 'phone':
    case 'text':
    default:
      return <TextSlot {...props} />
  }
}

// ── Text slot ───────────────────────────────────────────────────────

function TextSlot({ slot, value, onChange }: CommonProps) {
  const text = typeof value === 'string' ? value : ''
  const focus = useSnippetFocus()
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
      onFocus={e => focus.registerInput(slot.key, e.target)}
      onBlur={() => focus.clear(slot.key)}
      placeholder={slot.description ?? slot.label ?? slot.key.replace(/_/g, ' ')}
      className="bx-slot bx-slot-text"
      data-bx-slot-key={slot.key}
    />
  )
}

// ── Rich text slot ──────────────────────────────────────────────────

function RichTextSlot({ slot, value, onChange }: CommonProps) {
  const html = typeof value === 'string' ? value : ''
  const focus = useSnippetFocus()
  const rootRef = useRef<HTMLDivElement | null>(null)

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
    onFocus: ({ editor: ed }) => focus.registerEditor(slot.key, ed, rootRef.current),
    onBlur: () => focus.clear(slot.key),
    editorProps: { attributes: { class: 'bx-slot bx-slot-richtext' } },
  })

  // External value updates need to land without echoing back through
  // onUpdate.
  useEffect(() => {
    if (!editor) return
    const current = editor.getHTML()
    if (current === html) return
    editor.commands.setContent(html, { emitUpdate: false })
  }, [editor, html])

  return (
    <div ref={rootRef} className="bx-richtext-host" data-bx-slot-key={slot.key}>
      <EditorContent editor={editor} />
      {editor && (
        <BubbleMenu editor={editor} options={{ placement: 'top' }}>
          <div className="bx-bubble">
            <BubbleBtn
              active={editor.isActive('bold')}
              onClick={() => editor.chain().focus().toggleBold().run()}
              icon={<Bold size={12} />}
              label="Bold"
            />
            <BubbleBtn
              active={editor.isActive('italic')}
              onClick={() => editor.chain().focus().toggleItalic().run()}
              icon={<Italic size={12} />}
              label="Italic"
            />
            <BubbleBtn
              active={editor.isActive('link')}
              onClick={() => {
                const prev = editor.getAttributes('link').href as string | undefined
                const url = window.prompt('URL', prev ?? '')
                if (url == null) return
                if (url === '') editor.chain().focus().unsetLink().run()
                else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
              }}
              icon={<LinkIcon size={12} />}
              label="Link"
            />
            <span className="bx-bubble-divider" />
            <BubbleBtn
              active={editor.isActive('bulletList')}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              icon={<List size={12} />}
              label="Bullet list"
            />
            <BubbleBtn
              active={editor.isActive('orderedList')}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              icon={<ListOrdered size={12} />}
              label="Numbered list"
            />
          </div>
        </BubbleMenu>
      )}
    </div>
  )
}

function BubbleBtn({
  active, onClick, icon, label,
}: {
  active?: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onMouseDown={e => { e.preventDefault(); onClick() }}
      title={label}
      className={[
        'inline-flex items-center justify-center w-7 h-7 rounded transition-colors',
        active
          ? 'bg-wm-accent text-white'
          : 'text-wm-text-muted hover:bg-wm-bg-hover hover:text-wm-text',
      ].join(' ')}
    >{icon}</button>
  )
}

// ── CTA slot ────────────────────────────────────────────────────────

function CtaSlot({ slot, value, onChange, onRemoveItem }: CommonProps) {
  const cta = (typeof value === 'object' && value !== null)
    ? value as { label?: string; url?: string }
    : { label: '', url: '' }
  const focus = useSnippetFocus()
  return (
    <span className="bx-slot bx-slot-cta" data-bx-slot-key={slot.key}>
      <input
        type="text"
        value={cta.label ?? ''}
        onChange={e => onChange({ ...cta, label: e.target.value })}
        onFocus={e => focus.registerInput(slot.key, e.target)}
        onBlur={() => focus.clear(slot.key)}
        placeholder="Button label"
        className="bx-cta-label"
      />
      <span className="bx-cta-arrow">→</span>
      <input
        type="url"
        value={cta.url ?? ''}
        onChange={e => onChange({ ...cta, url: e.target.value })}
        onFocus={e => focus.registerInput(`${slot.key}__url`, e.target)}
        onBlur={() => focus.clear(`${slot.key}__url`)}
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

// ── Image slot ──────────────────────────────────────────────────────

function ImageSlot({ slot }: CommonProps) {
  return (
    <span
      className="bx-slot bx-slot-image"
      data-bx-slot-key={slot.key}
      title={`${slot.label ?? slot.key} (image placeholder)`}
    >
      <ImageIcon size={14} />
      <span className="bx-slot-image-label">{slot.label ?? slot.key}</span>
    </span>
  )
}

// ── Form-input slot ─────────────────────────────────────────────────

function FormInputSlot({ slot }: CommonProps) {
  return (
    <span className="bx-slot bx-slot-forminput" data-bx-slot-key={slot.key}>
      [{slot.label ?? slot.key}]
    </span>
  )
}

// ── Boolean slot ────────────────────────────────────────────────────

function BooleanSlot({ slot, value, onChange }: CommonProps) {
  return (
    <label className="bx-slot bx-slot-boolean" data-bx-slot-key={slot.key}>
      <input
        type="checkbox"
        checked={value === true}
        onChange={e => onChange(e.target.checked)}
      />
      <span>{slot.description ?? slot.label ?? slot.key}</span>
    </label>
  )
}
