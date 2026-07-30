import { computed, nextTick, onUnmounted, ref } from 'vue'
import { useEditor } from '@tiptap/vue-3'
import Placeholder from '@tiptap/extension-placeholder'
import StarterKit from '@tiptap/starter-kit'
import { request } from '../api'
import { canContinueSelection, selectedOptionIds } from '../chat-selection'
import { Attachment } from '../editor/attachment'

// The copilot side of the app: the tiptap composer, the SSE agent stream, and the
// in-flight turns (including user-selection follow-ups) attached to a canvas.
export function useAgentChat({ activeCanvas, conversation, busy, error, runToken, toCanvas, syncCanvasSummary, flushPendingSave }) {
  const composerVersion = ref(0)
  const selectedOptions = ref({})
  const continuingTurnId = ref(null)
  const messages = computed(() => conversation.value?.messages || [])
  const composer = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: 'Describe a 3D canvas or ask for a change...' }),
      Attachment,
    ],
    editorProps: {
      attributes: {
        class: 'composer-editor',
        'aria-label': 'Describe a 3D canvas or ask for a change',
      },
      // Enter sends; Shift+Enter is the way to get a newline.
      handleKeyDown(_view, event) {
        if (event.key !== 'Enter' || event.shiftKey) return false
        event.preventDefault()
        sendMessage()
        return true
      },
    },
    onUpdate() {
      composerVersion.value += 1
    },
  })
  const composerHasContent = computed(() => {
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

  function clearComposer() {
    composer.value?.commands.clearContent()
    composerVersion.value += 1
  }

  function addComposerFiles(files) {
    for (const file of files) {
      const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null
      composer.value?.chain().focus().insertAttachment({
        id: crypto.randomUUID(),
        name: file.name,
        type: file.type,
        preview,
      }).insertContent(' ').run()
    }
  }

  async function submitTurn(canvasId, input) {
    const response = await fetch(`/api/canvases/${canvasId}/turns`, {
      method: 'POST',
      headers: { accept: 'text/event-stream', 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || 'Request failed')
    }
    if (!response.body) throw new Error('Agent stream is unavailable')
    return response.body
  }

  async function loadConversation(canvasId) {
    conversation.value = await request(`/api/canvases/${canvasId}/conversation`)
  }

  async function refreshCanvas(canvasId, turnId, structureChanged) {
    const [document, nextConversation] = await Promise.all([
      request(`/api/canvases/${canvasId}`),
      request(`/api/canvases/${canvasId}/conversation`),
    ])
    const pendingMessages = conversation.value?.messages.filter((item) => item.pending && item.turnId !== turnId) || []
    activeCanvas.value = document.canvas
    conversation.value = { ...nextConversation, messages: [...nextConversation.messages, ...pendingMessages] }
    await toCanvas(document.canvas)
    syncCanvasSummary(document.canvas)
    await nextTick()
  }

  function applyAgentEvent(event, pendingAssistantId) {
    const pending = conversation.value?.messages.find((item) => item.id === pendingAssistantId || item.turnId === event.turn_id)
    if (event.type === 'turn-start' && pending) pending.turnId = event.turn_id
    if (event.type === 'progress' && pending) pending.progress = [...(pending.progress || []), { label: event.label, status: event.status }]
    if (event.type === 'text' && pending) {
      pending.streamMessageId = event.id
      pending.content = event.text || ''
    }
    if (event.type === 'request_user_select' && pending) {
      pending.pending = false
      pending.request = event.request
      pending.content = ''
    }
    if (event.type === 'error') throw new Error(event.error || 'Agent turn failed')
    return event.type === 'finish' ? { turnId: event.turn_id } : null
  }

  async function consumeAgentStream(stream, pendingAssistantId, token = runToken.value) {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let completion = null
    while (token === runToken.value) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
      const frames = buffer.split(/\r?\n\r?\n/)
      buffer = frames.pop()
      for (const frame of frames) {
        const protocolType = frame.split(/\r?\n/).find((line) => line.startsWith('event: '))?.slice(7)
        const data = frame.split(/\r?\n/).find((line) => line.startsWith('data: '))?.slice(6)
        if (!data) continue
        const event = JSON.parse(data)
        if (!['message', 'error'].includes(protocolType) || (protocolType === 'error') !== (event.type === 'error')) throw new Error('Invalid SSE event framing')
        const outcome = applyAgentEvent(event, pendingAssistantId)
        if (event.type === 'canvas-updated') await refreshCanvas(event.canvas_id, event.turn_id, event.structure_changed)
        completion = outcome || completion
      }
      if (done) break
    }
    if (completion) {
      const pending = conversation.value?.messages.find((item) => item.turnId === completion.turnId)
      if (pending) pending.pending = false
    }
  }

  async function restoreTurns(canvasId) {
    const turns = await request(`/api/canvases/${encodeURIComponent(canvasId)}/turns?status=queued,running,waiting_for_user`)
    for (const turn of turns) {
      const existing = conversation.value?.messages.some((item) => item.turnId === turn.id)
      if (!existing) {
        conversation.value.messages.push(
          { id: `turn-user-${turn.id}`, role: 'user', content: turn.message, turnId: turn.id, createdAt: turn.createdAt },
          { id: `turn-assistant-${turn.id}`, role: 'assistant', content: '', progress: turn.progress, turnId: turn.id, createdAt: turn.createdAt, pending: turn.status !== 'waiting_for_user', request: turn.status === 'waiting_for_user' ? turn.request : null },
        )
      }
    }
  }

  function toggleSelectedOption(message, optionId) {
    const current = selectedOptionIds(message, selectedOptions.value)
    if (current.includes(optionId)) {
      selectedOptions.value = { ...selectedOptions.value, [message.turnId]: current.filter((id) => id !== optionId) }
    } else if (message.request.max === 1) {
      selectedOptions.value = { ...selectedOptions.value, [message.turnId]: [optionId] }
    } else if (current.length < message.request.max) {
      selectedOptions.value = { ...selectedOptions.value, [message.turnId]: [...current, optionId] }
    }
  }

  async function continueTurn(message) {
    if (!canContinueSelection(message, selectedOptions.value) || continuingTurnId.value) return
    continuingTurnId.value = message.turnId
    error.value = ''
    message.pending = true
    try {
      const response = await fetch(`/api/turns/${message.turnId}/continue`, {
        method: 'POST',
        headers: { accept: 'text/event-stream', 'content-type': 'application/json' },
        body: JSON.stringify({ request_id: message.request.request_id, selected_option_ids: selectedOptionIds(message, selectedOptions.value) }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Request failed')
      }
      if (!response.body) throw new Error('Agent stream is unavailable')
      await consumeAgentStream(response.body, message.id, runToken.value)
      delete selectedOptions.value[message.turnId]
    } catch (caught) {
      message.pending = false
      error.value = caught.message
    } finally {
      continuingTurnId.value = null
    }
  }

  async function sendMessage() {
    const message = composerMessage()
    if (!message) return
    const previousConversation = conversation.value
    const createdAt = new Date().toISOString()
    const pendingAssistantId = `pending-assistant-${Date.now()}`
    busy.value = true
    error.value = ''
    const previousComposer = composer.value?.getJSON()
    clearComposer()
    conversation.value = {
      ...previousConversation,
      messages: [
        ...messages.value,
        { id: `pending-user-${Date.now()}`, role: 'user', content: message, createdAt },
        { id: pendingAssistantId, role: 'assistant', content: '', progress: [], turnId: null, createdAt, pending: true },
      ],
    }
    try {
      await flushPendingSave()
      const canvasId = activeCanvas.value?.id
      busy.value = false
      const stream = await submitTurn(canvasId || 'new', { message })
      await consumeAgentStream(stream, pendingAssistantId, runToken.value)
    } catch (caught) {
      const current = conversation.value?.messages.find((item) => item.id === pendingAssistantId)
      if (current) {
        current.pending = false
        current.failed = true
        current.content = caught.message
      } else {
        conversation.value = previousConversation
        composer.value?.commands.setContent(previousComposer || { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: message }] }] })
      }
      error.value = caught.message
    } finally {
      busy.value = false
    }
  }

  onUnmounted(() => composer.value?.destroy())

  return {
    composer,
    composerHasContent,
    messages,
    selectedOptions,
    continuingTurnId,
    addComposerFiles,
    loadConversation,
    restoreTurns,
    toggleSelectedOption,
    continueTurn,
    sendMessage,
  }
}
