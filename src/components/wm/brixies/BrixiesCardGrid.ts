/**
 * Brixies Card Grid + Card nodes — container + item pattern for the
 * card-shaped groups in Brixies templates (Cards, Items, Features,
 * Tiers, Pillars, Programs, Members, etc).
 *
 *   CardGrid
 *   ├── Card
 *   │   ├── heading (text via Heading node, level 3)
 *   │   ├── paragraph(s)
 *   │   └── BrixiesCtaNode (optional)
 *   ├── Card
 *   │   …
 *
 * The container renders with a [CARD GRID] pill at the top. Each card
 * gets its own [CARD · N] pill and a left-border accent so the user
 * can see they're inside a grouping.
 *
 * On serialize, each Card maps to one item in the template's first
 * card-shaped group; heading text → heading slot, paragraphs → body
 * slot, CTA → cta slot.
 */
import { Node } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    brixiesCardGrid: {
      insertCardGrid: (args?: { count?: number }) => ReturnType
    }
  }
}

export const BrixiesCardGrid = Node.create({
  name: 'brixiesCardGrid',
  group: 'block',
  content: 'brixiesCard+',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-bx-card-grid]' }]
  },

  renderHTML() {
    return [
      'div',
      {
        'data-bx-card-grid': '',
        'data-bx-label': 'CARD GRID',
        'data-bx-kind': 'group',
        class: 'brixies-card-grid',
      },
      0,
    ]
  },

  addCommands() {
    return {
      insertCardGrid: (args) => ({ chain }) => {
        const count = Math.max(2, Math.min(args?.count ?? 3, 6))
        const cards = Array.from({ length: count }).map((_, i) => ({
          type: 'brixiesCard',
          content: [
            { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: `Card ${i + 1}` }] },
            { type: 'paragraph', content: [{ type: 'text', text: 'Body copy.' }] },
          ],
        }))
        return chain()
          .focus()
          .insertContent({ type: 'brixiesCardGrid', content: cards })
          .run()
      },
    }
  },
})

export const BrixiesCard = Node.create({
  name: 'brixiesCard',
  group: 'block',
  // Cards hold any block content the editor knows about — heading,
  // paragraph, lists, CTAs, images. Lets the card act as a mini
  // section editor.
  content: '(heading | paragraph | bulletList | orderedList | brixiesCta | brixiesImage)+',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-bx-card]' }]
  },

  renderHTML() {
    return [
      'div',
      {
        'data-bx-card': '',
        'data-bx-label': 'CARD',
        'data-bx-kind': 'group',
        class: 'brixies-card',
      },
      0,
    ]
  },
})
