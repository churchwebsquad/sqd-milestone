/**
 * Web Manager — TipTap inline atom node for snippet chips.
 *
 * Storage: `<span data-snippet="phone">586-773-6568</span>` — the
 * `data-snippet` attribute carries the token, the text content is the
 * resolved value baked in at insert time. Atom + selectable means
 * backspace removes the whole chip; cursor never lands inside.
 *
 * Visually styled via `.wm-snippet` CSS class (defined in index.css)
 * — inline-code-style background + accent-tinted text — so the
 * strategist can see at a glance that "586-773-6568" is a live link
 * to {{phone}}, not free-typed text.
 *
 * Export path: when serializing the body to send to AI or to
 * WordPress, walk the HTML and rewrite each `<span data-snippet="X">`
 * back to the literal `{{X}}` token so downstream tools resolve
 * against the project's current values. The chip's text content is
 * only for in-editor preview.
 */

import { Node } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    snippet: {
      insertSnippet: (args: { token: string; label?: string; resolvedValue: string }) => ReturnType
    }
  }
}

export const SnippetNode = Node.create({
  name: 'snippet',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      token: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-snippet'),
        renderHTML: () => ({}),
      },
      label: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-snippet-label'),
        renderHTML: () => ({}),
      },
      resolved: {
        default: null,
        parseHTML: (el) => el.textContent ?? '',
        renderHTML: () => ({}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-snippet]' }]
  },

  renderHTML({ node }) {
    const text = node.attrs.resolved || `{{${node.attrs.token}}}`
    const attrs: Record<string, string> = {
      'data-snippet': node.attrs.token,
      'class': 'wm-snippet',
      'title': `Snippet: {{${node.attrs.token}}}${node.attrs.label ? ` (${node.attrs.label})` : ''}`,
    }
    if (node.attrs.label) attrs['data-snippet-label'] = node.attrs.label
    return ['span', attrs, text]
  },

  addCommands() {
    return {
      insertSnippet: ({ token, label, resolvedValue }) => ({ chain }) =>
        chain()
          .focus()
          .insertContent({
            type: 'snippet',
            attrs: { token, label, resolved: resolvedValue },
          })
          .insertContent(' ')
          .run(),
    }
  },
})
