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
              decorations.push(
                Decoration.widget(offset + 1, () => {
                  const el = document.createElement('span')
                  el.className = 'brixies-heading-pill'
                  el.setAttribute('data-bx-label', labelForHeading(level))
                  el.setAttribute('data-bx-kind', 'heading')
                  el.contentEditable = 'false'
                  // The ::before pseudo on data-bx-label is what renders
                  // the [label] pill — we just need this anchor element
                  // for the pseudo to attach to.
                  return el
                }, { side: -1, marks: [] }),
              )
            })
            return DecorationSet.create(doc, decorations)
          },
        },
      }),
    ]
  },
})
