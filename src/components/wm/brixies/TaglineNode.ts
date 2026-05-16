/**
 * Brixies Tagline node — block-level node for the section's tagline /
 * eyebrow / kicker. Renders with a `[TAGLINE]` pill above the content
 * via the data-bx-label / data-bx-kind attributes (styled in index.css).
 *
 * Storage: `<div data-bx-tagline data-bx-label="TAGLINE" data-bx-kind="tagline" class="brixies-tagline">…</div>`
 *
 * Serializer in webBindTemplate maps this node's text content to the
 * template's tagline slot.
 */
import { Node } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    brixiesTagline: {
      insertTagline: () => ReturnType
    }
  }
}

export const TaglineNode = Node.create({
  name: 'brixiesTagline',
  group: 'block',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-bx-tagline]' }]
  },

  renderHTML() {
    return [
      'div',
      {
        'data-bx-tagline': '',
        'data-bx-label': 'TAGLINE',
        'data-bx-kind': 'tagline',
        class: 'brixies-tagline',
      },
      0,
    ]
  },

  addCommands() {
    return {
      insertTagline: () => ({ chain }) =>
        chain()
          .focus()
          .insertContent({ type: 'brixiesTagline', content: [{ type: 'text', text: 'Tagline' }] })
          .run(),
    }
  },
})
