import { derived, state } from '../store'
import { Editor } from '@tiptap/core'
import Placeholder from '@tiptap/extension-placeholder'
import StarterKit from '@tiptap/starter-kit'
import { request } from '../api'
import { bizClass } from '../class-prefix'
import { Attachment } from '../editor/attachment'

/**
 * The tiptap composer — the only place in the app that pulls in the editor
 * stack.
 *
 * It lives behind its own composable so a build that has no copilot (the
 * DeepSeek Harness plugin) can resolve this module to a stub and leave tiptap,
 * ProseMirror and the attachment node view out of the bundle entirely.
 *
 * @param {{ onEnter?: () => void }} options — Enter sends.
 */
export function createComposer({ onEnter } = {}) {
  const composerVersion = state(0)
  // A class instance, so the store keeps it as-is instead of proxying it.
  const composer = state(new Editor({
    // EditorContent moves the view into its own node; it needs one to move.
    element: document.createElement('div'),
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: 'Describe a 3D canvas or ask for a change...' }),
      Attachment,
    ],
    editorProps: {
      attributes: {
        class: bizClass('composer-editor'),
        'aria-label': 'Describe a 3D canvas or ask for a change',
      },
      // Enter sends; Shift+Enter is the way to get a newline.
      handleKeyDown(_view, event) {
        if (event.key !== 'Enter' || event.shiftKey) return false
        event.preventDefault()
        onEnter?.()
        return true
      },
    },
    onUpdate() {
      composerVersion.value += 1
    },
  }))
  const composerHasContent = derived(() => {
    composerVersion.value
    const document = composer.value?.getJSON()
    return Boolean(composer.value?.getText().trim() || document?.content?.some((block) => block.content?.some((node) => node.type === 'attachment')))
  })

  function composerMessage() {
    return (composer.value?.getJSON().content || []).map((block) => (block.content || []).map((node) => {
      if (node.type === 'text') return node.text
      if (node.type === 'attachment') return `[Attachment: ${node.attrs.name}]`
      // Shift+Enter inserts a hardBreak; keep it, or the two lines run together.
      if (node.type === 'hardBreak') return '\n'
      return ''
    }).join('')).join('\n').trim()
  }

  function composerAttachments() {
    return (composer.value?.getJSON().content || []).flatMap((block) => (block.content || [])
      .filter((node) => node.type === 'attachment')
      .map((node) => ({ id: node.attrs.id, name: node.attrs.name, type: node.attrs.type, preview: node.attrs.preview })))
  }

  function clearComposer() {
    composer.value?.commands.clearContent()
    composerVersion.value += 1
  }

  async function uploadAttachment(file) {
    const uploaded = await request('/api/assets', {
      method: 'POST',
      headers: {
        'content-type': file.type || 'application/octet-stream',
        'x-file-name': encodeURIComponent(file.name),
      },
      body: await file.arrayBuffer(),
    })
    return uploaded.url
  }

  async function addComposerFiles(files) {
    for (const file of files) {
      const preview = await uploadAttachment(file)
      composer.value?.chain().focus().insertAttachment({
        id: crypto.randomUUID(),
        name: file.name,
        type: file.type,
        preview,
      }).insertContent(' ').run()
    }
  }

  return { composer, composerHasContent, composerMessage, composerAttachments, clearComposer, addComposerFiles }
}
