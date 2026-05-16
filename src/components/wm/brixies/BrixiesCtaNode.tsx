/**
 * Brixies CTA node — block-level atom with editable label + URL via a
 * React NodeView. Renders as a single line inside the editor:
 *
 *   [CTA] Plan Your Visit → /visit
 *
 * The pill is the data-bx-label::before pseudo-element (see index.css);
 * the label + URL are real input fields inside the NodeView so the user
 * edits them in place. Atom node means TipTap treats the whole thing as
 * one unit (backspace removes it cleanly).
 *
 * Storage: `<div data-bx-cta data-label="…" data-url="…">…</div>`.
 *
 * The serializer maps each CTA node to either a section-level cta slot
 * or a buttons-group item, in the order the nodes appear in the doc.
 */
import { Node } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    brixiesCta: {
      insertCta: (args?: { label?: string; url?: string }) => ReturnType
    }
  }
}

export const BrixiesCtaNode = Node.create({
  name: 'brixiesCta',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      label: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-label') ?? '',
        renderHTML: (attrs) => ({ 'data-label': attrs.label ?? '' }),
      },
      url: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-url') ?? '',
        renderHTML: (attrs) => ({ 'data-url': attrs.url ?? '' }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-bx-cta]' }]
  },

  renderHTML({ node }) {
    return [
      'div',
      {
        'data-bx-cta': '',
        'data-bx-label': 'CTA',
        'data-bx-kind': 'cta',
        'data-label': node.attrs.label ?? '',
        'data-url': node.attrs.url ?? '',
        class: 'brixies-cta',
      },
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(CtaNodeView)
  },

  addCommands() {
    return {
      insertCta: (args) => ({ chain }) =>
        chain()
          .focus()
          .insertContent({
            type: 'brixiesCta',
            attrs: { label: args?.label ?? 'Button label', url: args?.url ?? '/' },
          })
          .run(),
    }
  },
})

function CtaNodeView({ node, updateAttributes, selected }: NodeViewProps) {
  const label = (node.attrs.label as string) ?? ''
  const url = (node.attrs.url as string) ?? ''
  return (
    <NodeViewWrapper
      as="div"
      className={[
        'brixies-cta',
        selected ? 'ring-2 ring-wm-accent ring-offset-1 ring-offset-wm-bg' : '',
      ].join(' ')}
      data-bx-cta=""
      data-bx-label="CTA"
      data-bx-kind="cta"
    >
      <div className="brixies-cta-fields">
        <input
          className="brixies-cta-label"
          value={label}
          onChange={e => updateAttributes({ label: e.target.value })}
          placeholder="Button label"
        />
        <span className="brixies-cta-arrow">→ link to</span>
        <input
          className="brixies-cta-url"
          value={url}
          onChange={e => updateAttributes({ url: e.target.value })}
          placeholder="/route or https://…"
        />
      </div>
    </NodeViewWrapper>
  )
}
