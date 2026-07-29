import { Node, mergeAttributes } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import ComposerAttachment from '../components/ComposerAttachment.vue'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    attachment: {
      insertAttachment: (attributes: AttachmentAttributes) => ReturnType
    }
  }
}

export interface AttachmentAttributes {
  id: string
  name: string
  type: string
  preview: string | null
}

export const Attachment = Node.create({
  name: 'attachment',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      id: { default: null },
      name: { default: 'Untitled file' },
      type: { default: 'application/octet-stream' },
      preview: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-composer-attachment]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-composer-attachment': '' }), HTMLAttributes.name]
  },

  addCommands() {
    return {
      insertAttachment: (attributes: AttachmentAttributes) => ({ commands }) => commands.insertContent({ type: this.name, attrs: attributes }),
    }
  },

  addNodeView() {
    return VueNodeViewRenderer(ComposerAttachment)
  },
})
