import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createStore } from './store.js'
import { latestNodeRuns } from './node-state.js'
import { executionAssets } from './run-assets.js'
import { createExecution, executeExecution, executionById, executionDto, findNode, paginateAssets } from './executions.js'
import { createInitialConversation, createCanvas, emptyConversation } from './canvases.js'
import { runDeepSeekAgent } from './deepseek.js'
import { runAgentViaService } from './agent-client.js'

const port = Number(process.env.PORT || 8787)
const { state, persist } = await createStore()
const canvasTaskQueues = new Map()
// How many agent runs are currently streaming per canvas. A new chat message
// for a canvas with an active run is dispatched immediately (bypassing the
// serial queue) so the agent service can steer it into the running run.
const activeRuns = new Map()

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

function openSse(response) {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
}

function taskEvent(task, type, fields = {}) {
  task.eventId = (task.eventId || 0) + 1
  return {
    id: `${task.eventId}-0`,
    data: { type, thread_id: task.threadId, turn_id: task.id, ...fields },
  }
}

function writeSse(response, event) {
  response.write(`event: ${event.data.type === 'error' ? 'error' : 'message'}\ndata: ${JSON.stringify(event.data)}\nid: ${event.id}\n\n`)
}

async function body(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
}

function route(request) {
  return new URL(request.url, `http://${request.headers.host}`).pathname.split('/').filter(Boolean)
}

function canvasById(id) {
  return state.canvases.find((canvas) => canvas.id === id)
}

function conversationFor(canvasId) {
  return state.conversations.find((conversation) => conversation.canvasId === canvasId)
}

function taskById(id) {
  return state.tasks.find((task) => task.id === id)
}

async function executeAgentTask(task, emit = async () => {}) {
  try {
    task.status = 'running'
    task.startedAt = new Date().toISOString()
    await persist('tasks')
    await emit(taskEvent(task, 'task-start', { canvas_id: task.canvasId }))
    const canvas = canvasById(task.canvasId)
    if (!canvas) throw new Error('Canvas not found')
    const conversation = conversationFor(task.canvasId)
    // Local dev defaults to the Pi agent service. Set AGENT_SERVICE_URL=direct
    // to use the built-in DeepSeek loop instead.
    const serviceUrl = process.env.AGENT_SERVICE_URL === 'direct' ? '' : (process.env.AGENT_SERVICE_URL || 'http://127.0.0.1:8788/agent')
    const runAgent = serviceUrl ? runAgentViaService : runDeepSeekAgent
    activeRuns.set(task.canvasId, (activeRuns.get(task.canvasId) || 0) + 1)
    let plan
    try {
      plan = await runAgent({
        serviceUrl,
        apiKey: process.env.DEEPSEEK_API_KEY,
        baseUrl: process.env.DEEPSEEK_BASE_URL,
        model: process.env.DEEPSEEK_MODEL,
        message: task.selection ? `${task.message}\n\nThe user selected: ${task.selection.selected_option_ids.map((optionId) => task.request.options.find((option) => option.id === optionId)?.label || optionId).join(', ')}. Continue the task using this selection.` : task.message,
        canvas,
        history: conversation?.messages || [],
        onProgress: async (event) => {
          task.progress.push(event)
          task.updatedAt = new Date().toISOString()
          await persist('tasks')
          await emit(taskEvent(task, 'progress', { step_id: `progress-${task.progress.length}`, ...event }))
        },
      })
    } finally {
      const remaining = (activeRuns.get(task.canvasId) || 1) - 1
      if (remaining > 0) activeRuns.set(task.canvasId, remaining)
      else activeRuns.delete(task.canvasId)
    }
    // The message was steered into a still-running run; it produces no diff of
    // its own. Acknowledge it in the conversation and finish.
    if (plan.steered) {
      let steerConversation = conversationFor(task.canvasId)
      if (!steerConversation) {
        steerConversation = { id: task.threadId, canvasId: task.canvasId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: [] }
        state.conversations.push(steerConversation)
      }
      const steerNow = new Date().toISOString()
      const steerReply = '🔀 Pi steering · Added your message to the running task.'
      const steerAssistantId = `msg-${randomUUID()}`
      steerConversation.messages.push({ id: `msg-${randomUUID()}`, role: 'user', content: task.message, createdAt: steerNow })
      steerConversation.messages.push({ id: steerAssistantId, role: 'assistant', content: steerReply, progress: task.progress, createdAt: steerNow })
      steerConversation.updatedAt = steerNow
      task.status = 'succeeded'
      task.completedAt = steerNow
      task.updatedAt = steerNow
      await Promise.all([persist('conversations'), persist('tasks')])
      await emit(taskEvent(task, 'text', { step_id: 'final-response', id: steerAssistantId, text: steerReply }))
      await emit(taskEvent(task, 'finish', { finish_reason: 'stop' }))
      return
    }
    if (plan.userSelectionRequest) {
      task.status = 'waiting_for_user'
      delete task.selection
      task.request = { request_id: `request-${randomUUID()}`, ...plan.userSelectionRequest }
      const now = new Date().toISOString()
      const conversationIndex = state.conversations.findIndex((item) => item.canvasId === task.canvasId)
      const nextConversation = conversationIndex < 0
        ? { id: task.threadId, canvasId: task.canvasId, messages: [], createdAt: now }
        : structuredClone(state.conversations[conversationIndex])
      if (!nextConversation.messages.some((message) => message.taskId === task.id && message.role === 'user')) {
        nextConversation.messages.push({ id: `msg-${randomUUID()}`, role: 'user', content: task.message, taskId: task.id, createdAt: now })
      }
      const requestMessage = { id: `msg-${randomUUID()}`, role: 'assistant', content: '', taskId: task.id, request: task.request, progress: task.progress, createdAt: now }
      nextConversation.messages.push(requestMessage)
      nextConversation.updatedAt = now
      task.requestMessageId = requestMessage.id
      task.updatedAt = new Date().toISOString()
      if (conversationIndex < 0) state.conversations.push(nextConversation)
      else state.conversations[conversationIndex] = nextConversation
      await Promise.all([persist('conversations'), persist('tasks')])
      await emit(taskEvent(task, 'request_user_select', { request: task.request }))
      return
    }
    const canvasIndex = state.canvases.findIndex((item) => item.id === plan.canvas.id)
    if (canvasIndex < 0) state.canvases.push(plan.canvas)
    else state.canvases[canvasIndex] = plan.canvas

    let nextConversation = conversationFor(plan.canvas.id)
    if (!nextConversation) {
      nextConversation = { id: `conv-${randomUUID()}`, canvasId: plan.canvas.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: [] }
      state.conversations.push(nextConversation)
    }
    const now = new Date().toISOString()
    const assistantMessageId = `msg-${randomUUID()}`
    if (!task.requestMessageId) nextConversation.messages.push({ id: `msg-${randomUUID()}`, role: 'user', content: task.message, createdAt: now })
    nextConversation.messages.push({ id: assistantMessageId, role: 'assistant', content: plan.reply, progress: task.progress, createdAt: now })
    nextConversation.updatedAt = now
    task.status = 'succeeded'
    task.result = structuredClone({ ...plan, conversation: nextConversation })
    task.completedAt = new Date().toISOString()
    task.updatedAt = task.completedAt
    await Promise.all([persist('canvases'), persist('conversations'), persist('tasks')])
    await emit(taskEvent(task, 'text', { step_id: 'final-response', id: assistantMessageId, text: plan.reply }))
    await emit(taskEvent(task, 'canvas-updated', { canvas_id: task.canvasId, changed_node_ids: plan.changedNodeIds, structure_changed: plan.structureChanged }))
    await emit(taskEvent(task, 'finish', { finish_reason: 'stop' }))
  } catch (error) {
    task.status = 'failed'
    task.error = error.message
    task.completedAt = new Date().toISOString()
    task.updatedAt = task.completedAt
    try {
      await persist('tasks')
    } catch {
      // Keep the terminal status in memory if persistence itself fails.
    }
    await emit(taskEvent(task, 'error', { error: task.error }))
  }
}

function enqueueAgentTask(task, emit) {
  const previous = canvasTaskQueues.get(task.canvasId) || Promise.resolve()
  const current = previous
    .catch(() => {})
    .then(() => executeAgentTask(task, emit))
    .finally(() => {
      if (canvasTaskQueues.get(task.canvasId) === current) canvasTaskQueues.delete(task.canvasId)
    })
  canvasTaskQueues.set(task.canvasId, current)
  return current
}

const server = createServer(async (request, response) => {
  try {
    const parts = route(request)
    if (parts[0] !== 'api') return json(response, 404, { error: 'Not found' })

    if (request.method === 'GET' && parts[1] === 'canvases' && parts.length === 2) {
      return json(response, 200, state.canvases.map(({ nodes, edges, ...canvas }) => ({ ...canvas, nodeCount: nodes.length, edgeCount: edges.length })))
    }

    if (request.method === 'POST' && parts[1] === 'canvases' && parts.length === 2) {
      const canvas = createCanvas(await body(request))
      const conversation = createInitialConversation(canvas)
      state.canvases.push(canvas)
      state.conversations.push(conversation)
      await Promise.all([persist('canvases'), persist('conversations')])
      return json(response, 201, canvas)
    }

    if (request.method === 'GET' && parts[1] === 'canvases' && parts.length === 3) {
      const canvas = canvasById(parts[2])
      if (!canvas) return json(response, 404, { error: 'Canvas not found' })
      return json(response, 200, { canvas, nodeRuns: latestNodeRuns(canvas, state.runs) })
    }

    // The Agent conversation is its own resource; it is not part of the canvas document.
    if (request.method === 'GET' && parts[1] === 'canvases' && parts[2] && parts[3] === 'conversation' && parts.length === 4) {
      const canvas = canvasById(parts[2])
      if (!canvas) return json(response, 404, { error: 'Canvas not found' })
      // Every canvas is created with a conversation; an empty one keeps a canvas
      // whose row is missing loadable instead of failing the whole canvas open.
      return json(response, 200, conversationFor(canvas.id) || emptyConversation(canvas))
    }

    if (request.method === 'PUT' && parts[1] === 'canvases' && parts.length === 3) {
      const index = state.canvases.findIndex((canvas) => canvas.id === parts[2])
      if (index < 0) return json(response, 404, { error: 'Canvas not found' })
      const input = await body(request)
      state.canvases[index] = { ...input, id: parts[2], updatedAt: new Date().toISOString() }
      await persist('canvases')
      return json(response, 200, state.canvases[index])
    }

    if (request.method === 'DELETE' && parts[1] === 'canvases' && parts.length === 3) {
      const index = state.canvases.findIndex((canvas) => canvas.id === parts[2])
      if (index < 0) return json(response, 404, { error: 'Canvas not found' })
      state.canvases.splice(index, 1)
      state.conversations = state.conversations.filter((conversation) => conversation.canvasId !== parts[2])
      state.runs = state.runs.filter((run) => run.canvasId !== parts[2])
      await Promise.all([persist('canvases'), persist('conversations'), persist('runs')])
      return json(response, 204, null)
    }

    if (request.method === 'GET' && parts[1] === 'tasks' && parts.length === 2) {
      const url = new URL(request.url, `http://${request.headers.host}`)
      const canvasId = url.searchParams.get('canvasId')
      const statuses = new Set((url.searchParams.get('status') || '').split(',').filter(Boolean))
      const tasks = state.tasks.filter((task) => (!canvasId || task.canvasId === canvasId) && (!statuses.size || statuses.has(task.status)))
      return json(response, 200, tasks)
    }

    if (request.method === 'POST' && parts[1] === 'tasks' && parts[3] === 'continue' && parts.length === 4) {
      const task = taskById(parts[2])
      if (!task) return json(response, 404, { error: 'Task not found' })
      const input = await body(request)
      const selectedOptionIds = input.selected_option_ids
      const existingSelection = task.selection
      if (existingSelection) {
        if (input.request_id === existingSelection.request_id && Array.isArray(selectedOptionIds) && selectedOptionIds.length === existingSelection.selected_option_ids.length && selectedOptionIds.every((optionId, index) => optionId === existingSelection.selected_option_ids[index])) {
          return json(response, 200, task)
        }
        return json(response, 409, { error: 'This selection was already submitted' })
      }
      if (task.status !== 'waiting_for_user' || !task.request || input.request_id !== task.request.request_id) return json(response, 409, { error: 'Task is not waiting for this selection' })
      if (!Array.isArray(selectedOptionIds) || selectedOptionIds.some((optionId) => typeof optionId !== 'string') || new Set(selectedOptionIds).size !== selectedOptionIds.length || selectedOptionIds.length < task.request.min || selectedOptionIds.length > task.request.max || selectedOptionIds.some((optionId) => !task.request.options.some((option) => option.id === optionId))) {
        return json(response, 400, { error: 'Selected options are invalid' })
      }
      task.selection = { request_id: task.request.request_id, selected_option_ids: selectedOptionIds }
      const conversation = state.conversations.find((item) => item.canvasId === task.canvasId)
      const requestMessage = conversation?.messages.find((message) => message.id === task.requestMessageId)
      const selectedLabels = selectedOptionIds.map((optionId) => task.request.options.find((option) => option.id === optionId).label)
      if (conversation && requestMessage) {
        requestMessage.selection = task.selection
        conversation.messages.push({ id: `msg-${randomUUID()}`, role: 'user', content: selectedLabels.join(', '), taskId: task.id, selection: task.selection, createdAt: new Date().toISOString() })
        conversation.updatedAt = new Date().toISOString()
      }
      task.status = 'queued'
      task.updatedAt = new Date().toISOString()
      await Promise.all([persist('conversations'), persist('tasks')])
      if (request.headers.accept?.includes('text/event-stream')) {
        openSse(response)
        enqueueAgentTask(task, (event) => writeSse(response, event))
          .catch(() => {})
          .finally(() => response.end())
        return
      }
      void enqueueAgentTask(task)
      return json(response, 202, task)
    }

    if (request.method === 'POST' && parts[1] === 'chat') {
      const input = await body(request)
      if (typeof input.message !== 'string' || !input.message.trim()) return json(response, 400, { error: 'message is required' })
      if (input.canvasId !== undefined && typeof input.canvasId !== 'string') return json(response, 400, { error: 'canvasId is invalid' })
      if (!process.env.DEEPSEEK_API_KEY) {
        const error = new Error('DeepSeek is not configured. Set DEEPSEEK_API_KEY and restart the API server.')
        error.statusCode = 503
        throw error
      }
      const existing = input.canvasId ? canvasById(input.canvasId) : createCanvas({ name: 'New canvas', nodes: [], edges: [] })
      if (input.canvasId && !existing) {
        const error = new Error('Canvas not found')
        error.statusCode = 404
        throw error
      }
      if (!input.canvasId) {
        state.canvases.push(existing)
        state.conversations.push(createInitialConversation(existing))
      }
      const now = new Date().toISOString()
      const conversation = conversationFor(existing.id)
      const task = {
        id: `task-${randomUUID()}`,
        threadId: conversation?.id || `conv-${randomUUID()}`,
        canvasId: existing.id,
        message: input.message || '',
        status: 'queued',
        progress: [],
        eventId: 0,
        createdAt: now,
        updatedAt: now,
      }
      state.tasks.push(task)
      await Promise.all([persist('canvases'), persist('conversations'), persist('tasks')])
      // A run for this canvas is already streaming -> dispatch now (bypassing
      // the serial queue) so the agent service steers this message into it.
      // Otherwise queue it as the canvas's next run.
      const dispatch = (activeRuns.get(existing.id) || 0) > 0 ? executeAgentTask : enqueueAgentTask
      if (request.headers.accept?.includes('text/event-stream')) {
        openSse(response)
        dispatch(task, (event) => writeSse(response, event))
          .catch(() => {})
          .finally(() => response.end())
        return
      }
      void dispatch(task)
      return json(response, 202, task)
    }

    if (request.method === 'POST' && parts[1] === 'canvases' && parts[3] === 'duplicate') {
      const source = canvasById(parts[2])
      if (!source) return json(response, 404, { error: 'Canvas not found' })
      const now = new Date().toISOString()
      const canvas = { ...structuredClone(source), id: `canvas-${randomUUID()}`, name: `${source.name} Copy`, revision: 1, createdAt: now, updatedAt: now }
      state.canvases.push(canvas)
      state.conversations.push({ id: `conv-${randomUUID()}`, canvasId: canvas.id, createdAt: now, updatedAt: now, messages: [{ id: `msg-${randomUUID()}`, role: 'assistant', content: 'This canvas was duplicated and can now evolve independently.', createdAt: now }] })
      await Promise.all([persist('canvases'), persist('conversations')])
      return json(response, 201, canvas)
    }

    if (request.method === 'GET' && parts[1] === 'canvases' && parts[2] && parts[3] === 'assets' && parts.length === 4) {
      const canvas = canvasById(parts[2])
      if (!canvas) return json(response, 404, { error: 'Canvas not found' })
      const url = new URL(request.url, `http://${request.headers.host}`)
      const assets = executionAssets(state.runs, {
        canvasId: canvas.id,
        executionId: url.searchParams.get('executionId'),
        nodeId: url.searchParams.get('producerNodeId'),
        kind: url.searchParams.get('kind'),
      }).filter((asset) => !url.searchParams.get('entryNodeId') || asset.entryNodeId === url.searchParams.get('entryNodeId'))
      return json(response, 200, paginateAssets(assets, url))
    }

    if (request.method === 'GET' && parts[1] === 'executions' && parts.length === 3) {
      const execution = executionById(state.runs, parts[2])
      return execution ? json(response, 200, executionDto(execution)) : json(response, 404, { error: 'Execution not found' })
    }

    if (request.method === 'POST' && parts[1] === 'nodes' && parts[2] && parts[3] === 'executions' && parts.length === 4) {
      const match = findNode(state.canvases, parts[2])
      if (!match) return json(response, 404, { error: 'Node not found' })
      const { mode = 'downstream' } = await body(request)
      const pending = createExecution(state.runs, match.canvas, match.node, mode)
      await persist('runs')
      void executeExecution(state.runs, pending.run, match.canvas, pending.executionCanvas, pending.nodes, match.node, () => persist('runs')).catch(console.error)
      return json(response, 202, executionDto(pending.run))
    }

    return json(response, 404, { error: 'Not found' })
  } catch (error) {
    if (!error.statusCode) console.error(error)
    return json(response, error.statusCode || 500, { error: error.message })
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`API listening on http://127.0.0.1:${port}`)
})

export { server }

if (process.argv[1] !== fileURLToPath(import.meta.url)) server.close()
