import { latestNodeRuns } from './server/node-state.js'
import { executionAssets } from './server/run-assets.js'
import { createExecution, executeExecution, executionById, executionDto, findNode, paginateAssets } from './server/executions.js'
import { createInitialConversation, createCanvas, emptyConversation } from './server/canvases.js'
import { runDeepSeekAgent } from './server/deepseek.js'
import { runAgentViaService } from './server/agent-client.js'

const collections = ['canvases', 'conversations', 'runs', 'turns']
const terminalStatuses = new Set(['succeeded', 'failed'])

function id() {
  return crypto.randomUUID()
}

function clone(value) {
  return structuredClone(value)
}

async function readCollection(env, collection) {
  const value = await env.DB.prepare('SELECT value FROM app_state WHERE collection = ?1').bind(collection).first('value')
  return value ? JSON.parse(value) : []
}

async function writeCollections(env, state, names = collections) {
  const statements = names.map((name) => env.DB.prepare('INSERT INTO app_state (collection, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(collection) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').bind(name, JSON.stringify(state[name]), new Date().toISOString()))
  await env.DB.batch(statements)
}

async function loadState(env) {
  const values = await Promise.all(collections.map((name) => readCollection(env, name)))
  return Object.fromEntries(collections.map((name, index) => [name, values[index]]))
}

function response(body, status = 200) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

function sseResponse(body) {
  return new Response(body, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    },
  })
}

function turnEvent(turn, type, fields = {}) {
  turn.eventId = (turn.eventId || 0) + 1
  return {
    id: `${turn.eventId}-0`,
    data: { type, conversation_id: turn.conversationId, turn_id: turn.id, ...fields },
  }
}

async function writeSse(writer, event) {
  await writer.write(`event: ${event.data.type === 'error' ? 'error' : 'message'}\ndata: ${JSON.stringify(event.data)}\nid: ${event.id}\n\n`)
}

function canvasById(state, canvasId) {
  return state.canvases.find((canvas) => canvas.id === canvasId)
}

function conversationFor(state, canvasId) {
  return state.conversations.find((conversation) => conversation.canvasId === canvasId)
}

function turnById(state, turnId) {
  return state.turns.find((turn) => turn.id === turnId)
}

async function executeAgentTurn(env, state, turn, emit = async () => {}) {
  try {
    turn.status = 'running'
    turn.startedAt = new Date().toISOString()
    await writeCollections(env, state, ['turns'])
    await emit(turnEvent(turn, 'turn-start', { canvas_id: turn.canvasId }))
    const canvas = canvasById(state, turn.canvasId)
    if (!canvas) throw new Error('Canvas not found')
    const conversation = conversationFor(state, turn.canvasId)
    const runAgent = env.AGENT_SERVICE_URL ? runAgentViaService : runDeepSeekAgent
    const plan = await runAgent({
      serviceUrl: env.AGENT_SERVICE_URL,
      apiKey: env.DEEPSEEK_API_KEY,
      baseUrl: env.DEEPSEEK_BASE_URL,
      model: env.DEEPSEEK_MODEL,
      message: turn.selection ? `${turn.message}\n\nThe user selected: ${turn.selection.selected_option_ids.map((optionId) => turn.request.options.find((option) => option.id === optionId)?.label || optionId).join(', ')}. Continue the turn using this selection.` : turn.message,
      canvas,
      history: conversation?.messages || [],
      onProgress: async (event) => {
        turn.progress.push(event)
        turn.updatedAt = new Date().toISOString()
        await writeCollections(env, state, ['turns'])
        await emit(turnEvent(turn, 'progress', { step_id: `progress-${turn.progress.length}`, ...event }))
      },
    })
    if (plan.userSelectionRequest) {
      turn.status = 'waiting_for_user'
      delete turn.selection
      turn.request = { request_id: `request-${id()}`, ...plan.userSelectionRequest }
      const now = new Date().toISOString()
      const conversationIndex = state.conversations.findIndex((item) => item.canvasId === turn.canvasId)
      const nextConversation = conversationIndex < 0
        ? { id: turn.conversationId, canvasId: turn.canvasId, messages: [], createdAt: now }
        : structuredClone(state.conversations[conversationIndex])
      if (!nextConversation.messages.some((message) => message.turnId === turn.id && message.role === 'user')) {
        nextConversation.messages.push({ id: `msg-${id()}`, role: 'user', content: turn.message, turnId: turn.id, createdAt: now })
      }
      const requestMessage = { id: `msg-${id()}`, role: 'assistant', content: '', turnId: turn.id, request: turn.request, progress: turn.progress, createdAt: now }
      nextConversation.messages.push(requestMessage)
      nextConversation.updatedAt = now
      turn.requestMessageId = requestMessage.id
      turn.updatedAt = new Date().toISOString()
      if (conversationIndex < 0) state.conversations.push(nextConversation)
      else state.conversations[conversationIndex] = nextConversation
      await writeCollections(env, state, ['conversations', 'turns'])
      await emit(turnEvent(turn, 'request_user_select', { request: turn.request }))
      return
    }
    const index = state.canvases.findIndex((item) => item.id === plan.canvas.id)
    if (index < 0) state.canvases.push(plan.canvas)
    else state.canvases[index] = plan.canvas
    let nextConversation = conversationFor(state, plan.canvas.id)
    if (!nextConversation) {
      nextConversation = { id: `conv-${id()}`, canvasId: plan.canvas.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: [] }
      state.conversations.push(nextConversation)
    }
    const now = new Date().toISOString()
    const assistantMessageId = `msg-${id()}`
    if (!turn.requestMessageId) nextConversation.messages.push({ id: `msg-${id()}`, role: 'user', content: turn.message, createdAt: now })
    nextConversation.messages.push({ id: assistantMessageId, role: 'assistant', content: plan.reply, progress: turn.progress, createdAt: now })
    nextConversation.updatedAt = now
    turn.status = 'succeeded'
    turn.result = clone({ ...plan, conversation: nextConversation })
    turn.completedAt = new Date().toISOString()
    turn.updatedAt = turn.completedAt
    await writeCollections(env, state, ['canvases', 'conversations', 'turns'])
    await emit(turnEvent(turn, 'text', { step_id: 'final-response', id: assistantMessageId, text: plan.reply }))
    await emit(turnEvent(turn, 'canvas-updated', { canvas_id: turn.canvasId, changed_node_ids: plan.changedNodeIds, structure_changed: plan.structureChanged }))
    await emit(turnEvent(turn, 'finish', { finish_reason: 'stop' }))
  } catch (error) {
    turn.status = 'failed'
    turn.error = error.message
    turn.completedAt = new Date().toISOString()
    turn.updatedAt = turn.completedAt
    await writeCollections(env, state, ['turns'])
    await emit(turnEvent(turn, 'error', { error: turn.error }))
  }
}

async function parseJson(request) {
  return request.json().catch(() => ({}))
}

async function route(request, env, ctx) {
  const url = new URL(request.url)
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts[0] !== 'api') return env.ASSETS.fetch(request)
  const state = await loadState(env)

  if (request.method === 'GET' && parts[1] === 'canvases' && parts.length === 2) {
    return response(state.canvases.map(({ nodes, edges, ...canvas }) => ({ ...canvas, nodeCount: nodes.length, edgeCount: edges.length })))
  }
  if (request.method === 'GET' && parts[1] === 'canvases' && parts.length === 3) {
    const canvas = canvasById(state, parts[2])
    return canvas ? response({ canvas, nodeRuns: latestNodeRuns(canvas, state.runs) }) : response({ error: 'Canvas not found' }, 404)
  }
  // The Agent conversation is its own resource; it is not part of the canvas document.
  if (request.method === 'GET' && parts[1] === 'canvases' && parts[2] && parts[3] === 'conversation' && parts.length === 4) {
    const canvas = canvasById(state, parts[2])
    if (!canvas) return response({ error: 'Canvas not found' }, 404)
    // Every canvas is created with a conversation; an empty one keeps a canvas
    // whose row is missing loadable instead of failing the whole canvas open.
    return response(conversationFor(state, canvas.id) || emptyConversation(canvas))
  }
  if (request.method === 'POST' && parts[1] === 'canvases' && parts.length === 2) {
    const canvas = createCanvas(await parseJson(request))
    state.canvases.push(canvas)
    state.conversations.push(createInitialConversation(canvas))
    await writeCollections(env, state, ['canvases', 'conversations'])
    return response(canvas, 201)
  }
  if (request.method === 'PUT' && parts[1] === 'canvases' && parts.length === 3) {
    const index = state.canvases.findIndex((canvas) => canvas.id === parts[2])
    if (index < 0) return response({ error: 'Canvas not found' }, 404)
    state.canvases[index] = { ...(await parseJson(request)), id: parts[2], updatedAt: new Date().toISOString() }
    await writeCollections(env, state, ['canvases'])
    return response(state.canvases[index])
  }
  if (request.method === 'DELETE' && parts[1] === 'canvases' && parts.length === 3) {
    const index = state.canvases.findIndex((canvas) => canvas.id === parts[2])
    if (index < 0) return response({ error: 'Canvas not found' }, 404)
    state.canvases.splice(index, 1)
    state.conversations = state.conversations.filter((conversation) => conversation.canvasId !== parts[2])
    state.runs = state.runs.filter((run) => run.canvasId !== parts[2])
    state.turns = state.turns.filter((turn) => turn.canvasId !== parts[2] || terminalStatuses.has(turn.status))
    await writeCollections(env, state, ['canvases', 'conversations', 'runs', 'turns'])
    return response(null, 204)
  }
  if (request.method === 'POST' && parts[1] === 'canvases' && parts[3] === 'duplicate') {
    const source = canvasById(state, parts[2])
    if (!source) return response({ error: 'Canvas not found' }, 404)
    const now = new Date().toISOString()
    const canvas = { ...clone(source), id: `canvas-${id()}`, name: `${source.name} Copy`, revision: 1, createdAt: now, updatedAt: now }
    state.canvases.push(canvas)
    state.conversations.push({ id: `conv-${id()}`, canvasId: canvas.id, createdAt: now, updatedAt: now, messages: [{ id: `msg-${id()}`, role: 'assistant', content: 'This canvas was duplicated and can now evolve independently.', createdAt: now }] })
    await writeCollections(env, state, ['canvases', 'conversations'])
    return response(canvas, 201)
  }
  // Turns in progress for a canvas. The conversation holds the messages that
  // already landed; this holds the ones still running, so a reload can pick an
  // interrupted turn back up.
  if (request.method === 'GET' && parts[1] === 'canvases' && parts[2] && parts[3] === 'turns' && parts.length === 4) {
    const canvas = canvasById(state, parts[2])
    if (!canvas) return response({ error: 'Canvas not found' }, 404)
    const statuses = new Set((url.searchParams.get('status') || '').split(',').filter(Boolean))
    return response(state.turns.filter((turn) => turn.canvasId === canvas.id && (!statuses.size || statuses.has(turn.status))))
  }
  if (request.method === 'POST' && parts[1] === 'turns' && parts[3] === 'continue' && parts.length === 4) {
    const turn = turnById(state, parts[2])
    if (!turn) return response({ error: 'Turn not found' }, 404)
    const input = await parseJson(request)
    const selectedOptionIds = input.selected_option_ids
    const existingSelection = turn.selection
    if (existingSelection) {
      if (input.request_id === existingSelection.request_id && Array.isArray(selectedOptionIds) && selectedOptionIds.length === existingSelection.selected_option_ids.length && selectedOptionIds.every((optionId, index) => optionId === existingSelection.selected_option_ids[index])) return response(turn)
      return response({ error: 'This selection was already submitted' }, 409)
    }
    if (turn.status !== 'waiting_for_user' || !turn.request || input.request_id !== turn.request.request_id) return response({ error: 'Turn is not waiting for this selection' }, 409)
    if (!Array.isArray(selectedOptionIds) || selectedOptionIds.some((optionId) => typeof optionId !== 'string') || new Set(selectedOptionIds).size !== selectedOptionIds.length || selectedOptionIds.length < turn.request.min || selectedOptionIds.length > turn.request.max || selectedOptionIds.some((optionId) => !turn.request.options.some((option) => option.id === optionId))) return response({ error: 'Selected options are invalid' }, 400)
    turn.selection = { request_id: turn.request.request_id, selected_option_ids: selectedOptionIds }
    const conversation = state.conversations.find((item) => item.canvasId === turn.canvasId)
    const requestMessage = conversation?.messages.find((message) => message.id === turn.requestMessageId)
    const selectedLabels = selectedOptionIds.map((optionId) => turn.request.options.find((option) => option.id === optionId).label)
    if (conversation && requestMessage) {
      requestMessage.selection = turn.selection
      conversation.messages.push({ id: `msg-${id()}`, role: 'user', content: selectedLabels.join(', '), turnId: turn.id, selection: turn.selection, createdAt: new Date().toISOString() })
      conversation.updatedAt = new Date().toISOString()
    }
    turn.status = 'queued'
    turn.updatedAt = new Date().toISOString()
    await writeCollections(env, state, ['conversations', 'turns'])
    if (!request.headers.get('accept')?.includes('text/event-stream')) {
      ctx.waitUntil(executeAgentTurn(env, state, turn))
      return response(turn, 202)
    }
    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()
    const execution = executeAgentTurn(env, state, turn, (event) => writeSse(writer, event))
      .catch(() => {})
      .finally(() => writer.close())
    ctx.waitUntil(execution)
    return sseResponse(readable)
  }
  // Start a turn. `canvasId` may be `new`, which creates the canvas this turn
  // will build, so the first message does not need a canvas up front.
  if (request.method === 'POST' && parts[1] === 'canvases' && parts[2] && parts[3] === 'turns' && parts.length === 4) {
    const input = await parseJson(request)
    if (typeof input.message !== 'string' || !input.message.trim()) return response({ error: 'message is required' }, 400)
    if (!env.DEEPSEEK_API_KEY) return response({ error: 'DeepSeek is not configured.' }, 503)
    const isNew = parts[2] === 'new'
    const canvas = isNew ? createCanvas({ name: 'New canvas', nodes: [], edges: [] }) : canvasById(state, parts[2])
    if (!canvas) return response({ error: 'Canvas not found' }, 404)
    if (isNew) {
      state.canvases.push(canvas)
      state.conversations.push(createInitialConversation(canvas))
    }
    const now = new Date().toISOString()
    const conversation = conversationFor(state, canvas.id)
    const turn = { id: `turn-${id()}`, conversationId: conversation?.id || `conv-${id()}`, canvasId: canvas.id, message: input.message, status: 'queued', progress: [], eventId: 0, createdAt: now, updatedAt: now }
    state.turns.push(turn)
    await writeCollections(env, state, ['canvases', 'conversations', 'turns'])
    if (!request.headers.get('accept')?.includes('text/event-stream')) {
      ctx.waitUntil(executeAgentTurn(env, state, turn))
      return response(turn, 202)
    }
    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()
    const execution = executeAgentTurn(env, state, turn, (event) => writeSse(writer, event))
      .catch(() => {})
      .finally(() => writer.close())
    ctx.waitUntil(execution)
    return sseResponse(readable)
  }
  if (request.method === 'GET' && parts[1] === 'canvases' && parts[2] && parts[3] === 'assets' && parts.length === 4) {
    const canvas = canvasById(state, parts[2])
    if (!canvas) return response({ error: 'Canvas not found' }, 404)
    const assets = executionAssets(state.runs, {
      canvasId: canvas.id,
      executionId: url.searchParams.get('executionId'),
      nodeId: url.searchParams.get('producerNodeId'),
      kind: url.searchParams.get('kind'),
    }).filter((asset) => !url.searchParams.get('entryNodeId') || asset.entryNodeId === url.searchParams.get('entryNodeId'))
    return response(paginateAssets(assets, url))
  }
  if (request.method === 'GET' && parts[1] === 'executions' && parts.length === 3) {
    const execution = executionById(state.runs, parts[2])
    return execution ? response(executionDto(execution)) : response({ error: 'Execution not found' }, 404)
  }
  if (request.method === 'POST' && parts[1] === 'nodes' && parts[2] && parts[3] === 'executions' && parts.length === 4) {
    const match = findNode(state.canvases, parts[2])
    if (!match) return response({ error: 'Node not found' }, 404)
    const { mode = 'downstream' } = await parseJson(request)
    const pending = createExecution(state.runs, match.canvas, match.node, mode)
    await writeCollections(env, state, ['runs'])
    ctx.waitUntil(executeExecution(state.runs, pending.run, match.canvas, pending.executionCanvas, pending.nodes, match.node, () => writeCollections(env, state, ['runs'])))
    return response(executionDto(pending.run), 202)
  }
  return response({ error: 'Not found' }, 404)
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await route(request, env, ctx)
    } catch (error) {
      return response({ error: error.message }, error.statusCode || 500)
    }
  },
}
