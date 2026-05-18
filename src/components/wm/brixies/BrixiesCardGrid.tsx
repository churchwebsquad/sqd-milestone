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
 * Both nodes render via React NodeViews so they can offer affordances:
 *   - CardGrid: "+ Add card" button at the bottom, card count badge.
 *   - Card: hover-revealed delete (×) button + a card index badge.
 *
 * On serialize, each Card maps to one item in the template's first
 * card-shaped group; heading text → heading slot, paragraphs → body
 * slot, CTA → cta slot.
 */
import { Node } from '@tiptap/core'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { Plus, Trash2 } from 'lucide-react'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    brixiesCardGrid: {
      insertCardGrid: (args?: { count?: number }) => ReturnType
    }
  }
}

function newCardContent(index: number) {
  return {
    type: 'brixiesCard',
    content: [
      { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: `Card ${index + 1}` }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Body copy.' }] },
    ],
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

  addNodeView() {
    return ReactNodeViewRenderer(CardGridNodeView)
  },

  addCommands() {
    return {
      insertCardGrid: (args) => ({ chain }) => {
        const count = Math.max(2, Math.min(args?.count ?? 3, 6))
        const cards = Array.from({ length: count }).map((_, i) => newCardContent(i))
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

  addNodeView() {
    return ReactNodeViewRenderer(CardNodeView)
  },
})

// ── React NodeViews ─────────────────────────────────────────────────

function CardGridNodeView({ editor, getPos, node }: NodeViewProps) {
  const cardCount = node.childCount
  const handleAddCard = () => {
    // Insert at the end of the grid — getPos() + node.nodeSize - 1 is
    // the position just inside the closing tag.
    const pos = (typeof getPos === 'function' ? getPos() : 0) + node.nodeSize - 1
    editor.chain().focus().insertContentAt(pos, newCardContent(cardCount)).run()
  }

  return (
    <NodeViewWrapper
      as="div"
      className="brixies-card-grid"
      data-bx-card-grid=""
      data-bx-label={`CARD GRID · ${cardCount} CARD${cardCount === 1 ? '' : 'S'}`}
      data-bx-kind="group"
    >
      <NodeViewContent />
      <button
        type="button"
        onClick={handleAddCard}
        className="brixies-card-grid-add"
        contentEditable={false}
      >
        <Plus size={11} /> Add card
      </button>
    </NodeViewWrapper>
  )
}

function CardNodeView({ editor, getPos, node }: NodeViewProps) {
  const handleDelete = () => {
    const from = typeof getPos === 'function' ? getPos() : 0
    const to = from + node.nodeSize
    editor.chain().focus().deleteRange({ from, to }).run()
  }
  return (
    <NodeViewWrapper
      as="div"
      className="brixies-card"
      data-bx-card=""
      data-bx-label="CARD"
      data-bx-kind="group"
    >
      <button
        type="button"
        onClick={handleDelete}
        className="brixies-card-delete"
        title="Remove card"
        contentEditable={false}
      >
        <Trash2 size={11} />
      </button>
      <NodeViewContent />
    </NodeViewWrapper>
  )
}
