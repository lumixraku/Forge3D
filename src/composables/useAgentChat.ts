import { computed, nextTick, onUnmounted, ref } from 'vue'
import { useEditor } from '@tiptap/vue-3'
import Placeholder from '@tiptap/extension-placeholder'
import StarterKit from '@tiptap/starter-kit'
import { request } from '../api'
import { canContinueSelection, selectedOptionIds } from '../chat-selection'
import { Attachment } from '../editor/attachment'

// The copilot side of the app: the tiptap composer, the SSE agent stream, and the
// in-flight turns (including user-selection follow-ups) attached to a canvas.
export function useAgentChat({ activeCanvas, activeSession, busy, error, runToken, toCanvas, syncCanvasSummary, flushPendingSave, onCanvasEvent, onCanvasDocumentEvent, clientId, acquireEditLease, markEditActivity }) {
  const composerVersion = ref(0)
  const selectedOptions = ref({})
  const continuingTurnId = ref(null)
  const stoppingTurnId = ref(null)
  let events = null
  const messages = computed(() => activeSession.value?.messages || [])

  function displayAgentError(message) {
    return typeof message === 'string' && message.trim() ? message : '请求失败，请重试。'
  }
  const runningTurnId = computed(() => messages.value.find((message) => message.role === 'assistant' && message.pending && message.turnId)?.turnId || null)
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

  async function loadSessions(canvasId) {
    const sessions = await request(`/api/canvases/${canvasId}/sessions`)
    const session = sessions[0]
      ? await request(`/api/sessions/${encodeURIComponent(sessions[0].id)}/chat-history`)
      : null
    if (!session || session.canvasId !== canvasId) throw new Error('Project session is unavailable')
    return session
  }

  async function refreshCanvas(canvasId, turnId) {
    const [document, nextSession] = await Promise.all([
      request(`/api/canvases/${canvasId}`),
      request(`/api/sessions/${activeSession.value.id}/chat-history`),
    ])
    const pendingMessages = activeSession.value?.messages.filter((item) => item.pending && item.turnId !== turnId) || []
    activeCanvas.value = document.canvas
    activeSession.value = { ...nextSession, messages: [...nextSession.messages, ...pendingMessages] }
    await toCanvas(document.canvas)
    syncCanvasSummary(document.canvas)
    await nextTick()
  }

  // Events arrive on the canvas channel, not on the response of the POST that
  // started the turn, so a pending bubble is matched by turn id. The one bubble
  // that has no turn id yet is the message we just sent; it adopts the id of the
  // first `turn-start` that has no bubble of its own.
  function pendingMessageFor(event) {
    const byTurn = activeSession.value?.messages.find((item) => item.turnId === event.turn_id)
    if (byTurn) return byTurn
    if (event.type !== 'turn-start') return null
    const unclaimed = activeSession.value?.messages.find((item) => item.pending && !item.turnId && item.role === 'assistant')
    if (unclaimed) unclaimed.turnId = event.turn_id
    return unclaimed
  }

  function placeCompletedMessageAfterLatestUser(message) {
    const items = activeSession.value?.messages
    if (!items) return
    const currentIndex = items.indexOf(message)
    const latestUserIndex = items.findLastIndex((item) => item.role === 'user')
    if (currentIndex < 0 || currentIndex > latestUserIndex) return
    items.splice(currentIndex, 1)
    const nextUserIndex = items.findLastIndex((item) => item.role === 'user')
    items.splice(nextUserIndex + 1, 0, message)
  }

  function applyAgentEvent(event) {
    const pending = pendingMessageFor(event)
    if (event.type === 'progress' && pending) pending.progress = [...(pending.progress || []), { label: event.label, status: event.status }]
    if (event.type === 'text' && pending) {
      pending.streamMessageId = event.id
      pending.content = event.text || ''
    }
    if (event.type === 'request_user_select' && pending) {
      pending.pending = false
      pending.request = event.request
      pending.content = ''
      placeCompletedMessageAfterLatestUser(pending)
    }
    if (event.type === 'error') {
      if (pending) {
        pending.pending = false
        pending.failed = true
        pending.content = displayAgentError(event.error)
      }
      error.value = pending ? '' : displayAgentError(event.error)
    }
    if (event.type === 'finish' && pending) {
      pending.pending = false
      if (event.finish_reason === 'cancelled') {
        pending.stopped = true
        pending.content = 'Stopped'
      }
      if (stoppingTurnId.value === event.turn_id) stoppingTurnId.value = null
    }
  }

  // The canvas's single event channel, opened when the canvas opens and closed
  // when it closes. Nothing is replayed on reconnect: `openCanvas` re-reads the
  // canvas, the session and the in-flight turns over REST instead.
  function subscribeCanvasEvents(canvasId) {
    closeCanvasEvents()
    const token = runToken.value
    const source = new EventSource(`/api/canvases/${encodeURIComponent(canvasId)}/events`)
    events = source
    const handle = async (message) => {
      // EventSource dispatches its own transport failures under the same name as
      // an `event: error` frame; only the frame carries data. EventSource
      // reconnects on its own, so a transport failure needs nothing from us.
      if (!message.data || token !== runToken.value) return
      const event = JSON.parse(message.data)
      onCanvasEvent?.(event)
      if (event.type === 'canvas-updated' && !event.session_id) {
        if (event.source_client_id !== clientId) await onCanvasDocumentEvent?.(event)
        return
      }
      if (event.session_id !== activeSession.value?.id) return
      applyAgentEvent(event)
      if (event.type === 'canvas-updated') await refreshCanvas(event.canvas_id, event.turn_id)
    }
    source.addEventListener('message', handle)
    source.addEventListener('error', handle)
  }

  function closeCanvasEvents() {
    events?.close()
    events = null
  }

  async function restoreTurns() {
    if (!activeSession.value) return
    const turns = await request(`/api/sessions/${encodeURIComponent(activeSession.value.id)}/turns`)
    for (const turn of turns) {
      const existing = activeSession.value?.messages.some((item) => item.turnId === turn.id)
      if (!existing) {
        activeSession.value.messages.push(
          { id: `turn-user-${turn.id}`, role: 'user', content: turn.message, attachments: turn.attachments || [], turnId: turn.id, createdAt: turn.createdAt },
          { id: `turn-assistant-${turn.id}`, role: 'assistant', content: '', progress: turn.progress, turnId: turn.id, createdAt: turn.createdAt, pending: !turn.request, request: turn.request || null },
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
      // The turn resumes on the canvas channel; this only hands over the selection.
      await request(`/api/turns/${message.turnId}/continue`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ request_id: message.request.request_id, selected_option_ids: selectedOptionIds(message, selectedOptions.value) }),
      })
      delete selectedOptions.value[message.turnId]
    } catch (caught) {
      message.pending = false
      error.value = caught.message
    } finally {
      continuingTurnId.value = null
    }
  }

  async function stopTurn(turnId) {
    if (!turnId || stoppingTurnId.value) return
    stoppingTurnId.value = turnId
    error.value = ''
    try {
      await request(`/api/turns/${encodeURIComponent(turnId)}/cancel`, { method: 'POST' })
      const pending = activeSession.value?.messages.find((item) => item.turnId === turnId)
      if (pending) {
        pending.pending = false
        pending.stopped = true
        pending.content = 'Stopped'
      }
    } catch (caught) {
      error.value = caught.message
    } finally {
      stoppingTurnId.value = null
    }
  }

  async function sendMessage(retryOf) {
    const message = retryOf?.content || composerMessage()
    if (!message) return
    acquireEditLease()
    markEditActivity()
    const previousSession = activeSession.value
    const canvasId = activeCanvas.value?.id
    if (!canvasId || !previousSession || previousSession.canvasId !== canvasId) {
      error.value = 'Project session is still loading'
      return
    }
    const sessionId = previousSession.id
    const createdAt = new Date().toISOString()
    const pendingAssistantId = `pending-assistant-${Date.now()}`
    busy.value = true
    error.value = ''
    const previousComposer = retryOf ? null : composer.value?.getJSON()
    const attachments = retryOf?.attachments || composerAttachments()
    if (!retryOf) clearComposer()
    activeSession.value = {
      ...previousSession,
      messages: [
        ...messages.value,
        { id: `pending-user-${Date.now()}`, role: 'user', content: message, attachments, createdAt },
        { id: pendingAssistantId, role: 'assistant', content: '', progress: [], turnId: null, createdAt, pending: true },
      ],
    }
    try {
      await flushPendingSave()
      if (activeCanvas.value?.id !== canvasId || activeSession.value?.id !== sessionId) {
        throw new Error('Project changed before the message was sent')
      }
      busy.value = false
      // 202 with the turn; its events arrive on the project's canvas channel.
      const turn = await request(`/api/sessions/${sessionId}/turns`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId, message, attachments }),
      })
      const current = activeSession.value?.messages.find((item) => item.id === pendingAssistantId)
      if (current) current.turnId = turn.id
    } catch (caught) {
      const current = activeSession.value?.messages.find((item) => item.id === pendingAssistantId)
      if (current) {
        current.pending = false
        current.failed = true
        current.content = displayAgentError(caught?.message)
      } else {
        activeSession.value = previousSession
        composer.value?.commands.setContent(previousComposer || { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: message }] }] })
      }
      error.value = current ? '' : displayAgentError(caught?.message)
    } finally {
      busy.value = false
    }
  }

  function retryMessage(failedMessage) {
    const failedIndex = messages.value.findIndex((message) => message.id === failedMessage.id)
    const userMessage = messages.value.slice(0, failedIndex).reverse().find((message) => message.role === 'user')
    if (userMessage) sendMessage(userMessage)
  }

  onUnmounted(() => {
    closeCanvasEvents()
    composer.value?.destroy()
  })

  return {
    composer,
    composerHasContent,
    messages,
    selectedOptions,
    continuingTurnId,
    runningTurnId,
    stoppingTurnId,
    addComposerFiles,
    loadSessions,
    restoreTurns,
    subscribeCanvasEvents,
    closeCanvasEvents,
    toggleSelectedOption,
    continueTurn,
    stopTurn,
    sendMessage,
    retryMessage,
  }
}
