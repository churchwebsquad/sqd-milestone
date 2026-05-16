/**
 * Brixies Image node — block-level atom carrying an image URL. Renders
 * with an [IMAGE] pill above and an editable URL input + thumbnail
 * preview inside the editor.
 *
 * Storage: `<div data-bx-image data-src="…">`. The serializer maps
 * each image node to the first image slot in the template.
 */
import { Node } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { Image as ImageIcon } from 'lucide-react'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    brixiesImage: {
      insertBrixiesImage: (args?: { src?: string; alt?: string }) => ReturnType
    }
  }
}

export const BrixiesImageNode = Node.create({
  name: 'brixiesImage',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      src: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-src') ?? '',
        renderHTML: (attrs) => ({ 'data-src': attrs.src ?? '' }),
      },
      alt: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-alt') ?? '',
        renderHTML: (attrs) => ({ 'data-alt': attrs.alt ?? '' }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-bx-image]' }]
  },

  renderHTML({ node }) {
    return [
      'div',
      {
        'data-bx-image': '',
        'data-bx-label': 'IMAGE',
        'data-bx-kind': 'image',
        'data-src': node.attrs.src ?? '',
        'data-alt': node.attrs.alt ?? '',
        class: 'brixies-image',
      },
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView)
  },

  addCommands() {
    return {
      insertBrixiesImage: (args) => ({ chain }) =>
        chain()
          .focus()
          .insertContent({ type: 'brixiesImage', attrs: { src: args?.src ?? '', alt: args?.alt ?? '' } })
          .run(),
    }
  },
})

function ImageNodeView({ node, updateAttributes, selected }: NodeViewProps) {
  const src = (node.attrs.src as string) ?? ''
  return (
    <NodeViewWrapper
      as="div"
      className={[
        'brixies-image',
        selected ? 'ring-2 ring-wm-accent ring-offset-1 ring-offset-wm-bg' : '',
      ].join(' ')}
      data-bx-image=""
      data-bx-label="IMAGE"
      data-bx-kind="image"
    >
      <div className="brixies-image-row">
        {src ? (
          <img src={src} alt="" className="brixies-image-thumb" />
        ) : (
          <div className="brixies-image-placeholder">
            <ImageIcon size={16} />
          </div>
        )}
        <input
          className="brixies-image-url"
          value={src}
          onChange={e => updateAttributes({ src: e.target.value })}
          placeholder="https://…"
        />
      </div>
    </NodeViewWrapper>
  )
}
