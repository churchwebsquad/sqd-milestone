/**
 * Brixies-aware section editor.
 *
 * One TipTap document per section. The document is composed of Brixies
 * primitives:
 *
 *   - Heading nodes (H1/H2/H3 — StarterKit) decorated with [H1 HEADLINE]
 *     style pills via HeadingLabelDecorator.
 *   - Paragraphs + lists for body content.
 *   - TaglineNode for the section's tagline/eyebrow line.
 *   - BrixiesCtaNode for editable label + URL CTAs.
 *   - SnippetNode for inline merge-field chips.
 *
 * Two toolbar rows:
 *   1. Standard formatting (bold / italic / link / list / heading menu).
 *   2. Brixies blocks (Tagline, CTA, Snippet) — the shared building-
 *      block language used both for freehand authoring AND for editing
 *      template-bound sections.
 *
 * The document HTML is the source of truth from the editor's POV. The
 * caller serializes/deserializes between this HTML and the section's
 * field_values via webBindTemplate.docHtmlToFieldValues /
 * fieldValuesToDocHtml (next file).
 */
import { useEffect } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import type { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import {
  Bold, Italic, Link as LinkIcon, List, ListOrdered, Heading1, Heading2, Heading3,
  Type, Braces, MousePointerClick, Tag, LayoutGrid, Image as ImageIcon,
} from 'lucide-react'
import { SnippetNode } from '../SnippetNode'
import { TaglineNode } from './TaglineNode'
import { BrixiesCtaNode } from './BrixiesCtaNode'
import { BrixiesImageNode } from './BrixiesImageNode'
import { BrixiesCardGrid, BrixiesCard } from './BrixiesCardGrid'
import { HeadingLabelDecorator } from './HeadingLabelDecorator'
import type { WMSnippetOption } from '../RichTextEditor'

interface Props {
  /** Section's current doc HTML — what's stored under field_values._doc */
  value: string
  onChange: (html: string) => void
  snippets?: readonly WMSnippetOption[]
  placeholder?: string
  /** Hide the second (Brixies) toolbar row — for places where only
   *  basic formatting is wanted (legacy or richtext slots). */
  hideBrixiesToolbar?: boolean
}

export function BrixiesEditor({
  value, onChange, snippets, placeholder = 'Start writing…',
  hideBrixiesToolbar = false,
}: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        blockquote: false,
        horizontalRule: false,
        strike: false,
        dropcursor: false,
        link: false,
      }),
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder }),
      SnippetNode,
      TaglineNode,
      BrixiesCtaNode,
      BrixiesImageNode,
      BrixiesCardGrid,
      BrixiesCard,
      HeadingLabelDecorator,
    ],
    content: value,
    onUpdate: ({ editor: ed }) => onChange(ed.getHTML()),
    editorProps: { attributes: { class: 'ProseMirror outline-none' } },
  })

  // Externally-driven value updates (e.g. snippet auto-refresh) need to
  // push into the editor without echoing the same HTML back via onUpdate.
  useEffect(() => {
    if (!editor) return
    const current = editor.getHTML()
    if (current === value) return
    editor.commands.setContent(value, { emitUpdate: false })
  }, [editor, value])

  if (!editor) {
    return (
      <div className="rounded-md border border-wm-border bg-wm-bg p-3 text-[12px] text-wm-text-subtle italic">
        Loading editor…
      </div>
    )
  }

  return (
    <div className="brixies-editor-root rounded-md border border-wm-border bg-wm-bg-elevated">
      <Toolbar editor={editor} snippets={snippets} hideBrixiesToolbar={hideBrixiesToolbar} />
      <div className="px-3 pb-3 pt-2 wm-theme">
        <EditorContent editor={editor} />
      </div>
      <BubbleMenu editor={editor} options={{ placement: 'top' }}>
        <div className="flex items-center gap-0.5 rounded-md border border-wm-border bg-wm-bg-elevated shadow-lg px-1 py-1">
          <ToolbarBtn editor={editor} active={editor.isActive('bold')} cmd={() => editor.chain().focus().toggleBold().run()} icon={<Bold size={12} />} label="Bold" />
          <ToolbarBtn editor={editor} active={editor.isActive('italic')} cmd={() => editor.chain().focus().toggleItalic().run()} icon={<Italic size={12} />} label="Italic" />
          <ToolbarBtn
            editor={editor}
            active={editor.isActive('link')}
            cmd={() => {
              const prev = editor.getAttributes('link').href as string | undefined
              const url = window.prompt('URL', prev ?? '')
              if (url == null) return
              if (url === '') editor.chain().focus().unsetLink().run()
              else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
            }}
            icon={<LinkIcon size={12} />}
            label="Link"
          />
        </div>
      </BubbleMenu>
    </div>
  )
}

function Toolbar({
  editor, snippets, hideBrixiesToolbar,
}: {
  editor: Editor
  snippets?: readonly WMSnippetOption[]
  hideBrixiesToolbar: boolean
}) {
  return (
    <div className="border-b border-wm-border bg-wm-bg px-2 py-1.5">
      {/* Row 1 — standard formatting */}
      <div className="flex items-center gap-0.5 flex-wrap">
        <ToolbarBtn editor={editor} active={editor.isActive('heading', { level: 1 })} cmd={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} icon={<Heading1 size={13} />} label="Heading 1" />
        <ToolbarBtn editor={editor} active={editor.isActive('heading', { level: 2 })} cmd={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} icon={<Heading2 size={13} />} label="Heading 2" />
        <ToolbarBtn editor={editor} active={editor.isActive('heading', { level: 3 })} cmd={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} icon={<Heading3 size={13} />} label="Heading 3" />
        <ToolbarBtn editor={editor} active={editor.isActive('paragraph')} cmd={() => editor.chain().focus().setParagraph().run()} icon={<Type size={13} />} label="Paragraph" />
        <ToolbarDivider />
        <ToolbarBtn editor={editor} active={editor.isActive('bold')} cmd={() => editor.chain().focus().toggleBold().run()} icon={<Bold size={13} />} label="Bold" />
        <ToolbarBtn editor={editor} active={editor.isActive('italic')} cmd={() => editor.chain().focus().toggleItalic().run()} icon={<Italic size={13} />} label="Italic" />
        <ToolbarBtn
          editor={editor}
          active={editor.isActive('link')}
          cmd={() => {
            const prev = editor.getAttributes('link').href as string | undefined
            const url = window.prompt('URL', prev ?? '')
            if (url == null) return
            if (url === '') editor.chain().focus().unsetLink().run()
            else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
          }}
          icon={<LinkIcon size={13} />}
          label="Link"
        />
        <ToolbarBtn editor={editor} active={editor.isActive('bulletList')} cmd={() => editor.chain().focus().toggleBulletList().run()} icon={<List size={13} />} label="Bullet list" />
        <ToolbarBtn editor={editor} active={editor.isActive('orderedList')} cmd={() => editor.chain().focus().toggleOrderedList().run()} icon={<ListOrdered size={13} />} label="Numbered list" />
      </div>

      {/* Row 2 — Brixies-specific blocks */}
      {!hideBrixiesToolbar && (
        <div className="flex items-center gap-0.5 flex-wrap mt-1 pt-1 border-t border-wm-border/50">
          <span className="text-[9px] uppercase tracking-widest font-bold text-wm-text-subtle px-1.5 mr-1">
            Brixies blocks
          </span>
          <ToolbarBtn
            editor={editor}
            cmd={() => editor.chain().focus().insertTagline().run()}
            icon={<Tag size={13} />}
            label="Tagline"
            text="Tagline"
          />
          <ToolbarBtn
            editor={editor}
            cmd={() => editor.chain().focus().insertCta().run()}
            icon={<MousePointerClick size={13} />}
            label="CTA"
            text="CTA"
          />
          <ToolbarBtn
            editor={editor}
            cmd={() => editor.chain().focus().insertCardGrid({ count: 3 }).run()}
            icon={<LayoutGrid size={13} />}
            label="Card Grid"
            text="Card Grid"
          />
          <ToolbarBtn
            editor={editor}
            cmd={() => editor.chain().focus().insertBrixiesImage().run()}
            icon={<ImageIcon size={13} />}
            label="Image"
            text="Image"
          />
          {snippets && snippets.length > 0 && (
            <SnippetMenu editor={editor} snippets={snippets} />
          )}
        </div>
      )}
    </div>
  )
}

function ToolbarBtn({
  editor: _editor, active, cmd, icon, label, text,
}: {
  editor: Editor
  active?: boolean
  cmd: () => void
  icon: React.ReactNode
  label: string
  text?: string
}) {
  void _editor
  return (
    <button
      type="button"
      onClick={cmd}
      title={label}
      className={[
        'inline-flex items-center gap-1 px-1.5 py-1 rounded text-[11px] font-semibold transition-colors',
        active
          ? 'bg-wm-accent text-white'
          : 'text-wm-text-muted hover:bg-wm-bg-hover hover:text-wm-text',
      ].join(' ')}
    >
      {icon}
      {text && <span>{text}</span>}
    </button>
  )
}

function ToolbarDivider() {
  return <span className="mx-1 h-4 w-px bg-wm-border" />
}

function SnippetMenu({ editor, snippets }: { editor: Editor; snippets: readonly WMSnippetOption[] }) {
  return (
    <details className="relative">
      <summary
        className="inline-flex items-center gap-1 px-1.5 py-1 rounded text-[11px] font-semibold text-wm-text-muted hover:bg-wm-bg-hover hover:text-wm-text cursor-pointer list-none"
        title="Insert snippet"
      >
        <Braces size={13} />
        <span>Snippet</span>
      </summary>
      <div className="absolute z-20 mt-1 w-64 max-h-64 overflow-auto rounded-md border border-wm-border bg-wm-bg-elevated shadow-lg py-1">
        {snippets.map(s => (
          <button
            key={s.token}
            type="button"
            onClick={() => {
              editor.chain().focus().insertSnippet({
                token: s.token,
                label: s.label,
                resolvedValue: s.resolvedValue,
              }).run()
              // close the <details>
              const det = (event?.currentTarget as HTMLElement | undefined)?.closest('details')
              if (det) det.open = false
            }}
            className="block w-full text-left px-3 py-1.5 text-[12px] hover:bg-wm-bg-hover"
          >
            <span className="font-mono text-wm-accent-strong">{`{{${s.token}}}`}</span>
            <span className="ml-2 text-wm-text-muted truncate inline-block max-w-[140px] align-middle">
              {s.resolvedValue}
            </span>
          </button>
        ))}
      </div>
    </details>
  )
}
