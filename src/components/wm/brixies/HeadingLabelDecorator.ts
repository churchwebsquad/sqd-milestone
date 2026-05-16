/**
 * Brixies heading label decorator — adds inline pill labels above each
 * heading node in the TipTap doc:
 *
 *   [H1 HEADLINE]
 *   Get ready for Sunday.
 *
 *   [H2 SUB-HEADLINE]
 *   What to expect on your first Sunday
 *
 * Implemented as a ProseMirror decoration plugin so the labels are pure
 * presentational widgets (not real nodes) — they can't be selected,
 * deleted, or messed with. Backspace at the start of the heading line
 * collapses the heading back to a paragraph as expected; the label
 * comes/goes with the heading level.
 */
import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

function labelForHeading(level: number): string {
  if (level === 1) return 'H1 HEADLINE'
  if (level === 2) return 'H2 SUB-HEADLINE'
  return `H${level} HEADING`
}

export const HeadingLabelDecorator = Extension.create({
  name: 'headingLabelDecorator',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations(state) {
            const decorations: Decoration[] = []
            const { doc } = state
            doc.forEach((node, offset) => {
              if (node.type.name !== 'heading') return
              const level = (node.attrs.level as number | undefined) ?? 1
              // Apply data attrs directly to the heading element so the
              // CSS `[data-bx-label]::before` pseudo renders the pill
              // above the heading text. Using Decoration.node (not
              // .widget) keeps the cursor + click target on the
              // heading content itself — clicking the line lands on
              // the heading, not on a sibling widget element.
              decorations.push(
                Decoration.node(offset, offset + node.nodeSize, {
                  'data-bx-label': labelForHeading(level),
                  'data-bx-kind': 'heading',
                  class: 'brixies-heading-pill',
                }),
              )
            })
            return DecorationSet.create(doc, decorations)
          },
        },
      }),
    ]
  },
})
