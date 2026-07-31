import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createStore } from './store.js'
import { latestNodeRuns } from './node-state.js'
import { executionAssets } from './run-assets.js'
import { createExecution, executeExecution, executionById, executionDto, findNode, paginateAssets } from './executions.js'
import { createInitialConversation, createCanvas, emptyConversation } from './canvases.js'
import { runDeepSeekAgent } from './deepseek.js'
import { cancelAgentViaService, runAgentViaService } from './agent-client.js'
import { createTripoRunner } from './tripo-run.js'
import { readAsset } from './tripo-assets.js'
import { tripoNodeTypes } from './tripo-mapping.js'

const port = Number(process.env.PORT || 8787)
// Null when TRIPO_API_KEY is unset, which keeps every node on the simulated
// producer so the demo runs without credentials.
const createTripoProvider = createTripoRunner()
const { state, persist, removeCanvas } = await createStore()
const canvasTurnQueues = new Map()
// How many agent runs are currently streaming per canvas. A new turn
// for a canvas with an active run is dispatched immediately (bypassing the
// serial queue) so the agent service can steer it into the running run.
const activeRuns = new Map()
const activeTurnCancels = new Map()
// One SSE channel per canvas: a client subscribes when it opens the canvas and
// every event the server pushes for that canvas is multiplexed onto it. Nothing
// is buffered or replayed - a client that reconnects re-reads state over REST.
const canvasChannels = new Map()
const canvasEventSeqs = new Map()

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

const canvasSubscribeWaiters = new Map()

function subscribeCanvas(canvasId, response) {
  const subscribers = canvasChannels.get(canvasId) || new Set()
  subscribers.add(response)
  canvasChannels.set(canvasId, subscribers)
  for (const resolve of canvasSubscribeWaiters.get(canvasId) || []) resolve()
  canvasSubscribeWaiters.delete(canvasId)
  return () => {
    subscribers.delete(response)
    if (!subscribers.size) canvasChannels.delete(canvasId)
  }
}

// A turn that creates its own canvas has no subscriber yet: the client only
// learns the canvas id from the 202. Wait for it to subscribe before running, or
// the whole first turn would be pushed into an empty channel.
function whenSubscribed(canvasId, timeout = 5000) {
  if (canvasChannels.get(canvasId)?.size) return Promise.resolve()
  return new Promise((resolve) => {
    const waiters = canvasSubscribeWaiters.get(canvasId) || new Set()
    waiters.add(resolve)
    canvasSubscribeWaiters.set(canvasId, waiters)
    setTimeout(resolve, timeout).unref()
  })
}

function turnEvent(turn, type, fields = {}) {
  const seq = (canvasEventSeqs.get(turn.canvasId) || 0) + 1
  canvasEventSeqs.set(turn.canvasId, seq)
  return {
    id: `${seq}-0`,
    data: { type, canvas_id: turn.canvasId, conversation_id: turn.conversationId, turn_id: turn.id, ...fields },
  }
}

function writeSse(response, event) {
  response.write(`event: ${event.data.type === 'error' ? 'error' : 'message'}\ndata: ${JSON.stringify(event.data)}\nid: ${event.id}\n\n`)
}

function broadcast(canvasId, event) {
  for (const response of canvasChannels.get(canvasId) || []) writeSse(response, event)
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

function turnById(id) {
  return state.turns.find((turn) => turn.id === id)
}

async function executeAgentTurn(turn) {
  // Everything this turn produces goes out on the canvas's channel, so a client
  // that is not the one which posted the turn still sees it.
  const emit = (type, fields) => broadcast(turn.canvasId, turnEvent(turn, type, fields))
  try {
    await whenSubscribed(turn.canvasId)
    if (turn.status === 'cancelled' || turn.status === 'cancelling') return
    turn.status = 'running'
    turn.startedAt = new Date().toISOString()
    await persist('turns')
    emit('turn-start')
    const canvas = canvasById(turn.canvasId)
    if (!canvas) throw new Error('Canvas not found')
    const conversation = conversationFor(turn.canvasId)
    // Local dev defaults to the Pi agent service. Set AGENT_SERVICE_URL=direct
    // to use the built-in DeepSeek loop instead.
    const serviceUrl = process.env.AGENT_SERVICE_URL === 'direct' ? '' : (process.env.AGENT_SERVICE_URL || 'http://127.0.0.1:8788/agent')
    const runAgent = serviceUrl ? runAgentViaService : runDeepSeekAgent
    activeRuns.set(turn.canvasId, (activeRuns.get(turn.canvasId) || 0) + 1)
    let plan
    const controller = new AbortController()
    const cancel = async () => {
      if (serviceUrl) await cancelAgentViaService(serviceUrl, turn.id)
      controller.abort()
    }
    activeTurnCancels.set(turn.id, cancel)
    try {
      plan = await runAgent({
        serviceUrl,
        turnId: turn.id,
        signal: controller.signal,
        apiKey: process.env.DEEPSEEK_API_KEY,
        baseUrl: process.env.DEEPSEEK_BASE_URL,
        model: process.env.DEEPSEEK_MODEL,
        message: turn.selection ? `${turn.message}\n\nThe user selected: ${turn.selection.selected_option_ids.map((optionId) => turn.request.options.find((option) => option.id === optionId)?.label || optionId).join(', ')}. Continue the turn using this selection.` : turn.message,
        canvas,
        history: conversation?.messages || [],
        onProgress: async (event) => {
          turn.progress.push(event)
          turn.updatedAt = new Date().toISOString()
          await persist('turns')
          emit('progress', { step_id: `progress-${turn.progress.length}`, ...event })
        },
      })
    } finally {
      if (activeTurnCancels.get(turn.id) === cancel) activeTurnCancels.delete(turn.id)
      const remaining = (activeRuns.get(turn.canvasId) || 1) - 1
      if (remaining > 0) activeRuns.set(turn.canvasId, remaining)
      else activeRuns.delete(turn.canvasId)
    }
    if (turn.status === 'cancelled' || turn.status === 'cancelling') return
    // The message was steered into a still-running run; it produces no diff of
    // its own. Acknowledge it in the conversation and finish.
    if (plan.steered) {
      let steerConversation = conversationFor(turn.canvasId)
      if (!steerConversation) {
        steerConversation = { id: turn.conversationId, canvasId: turn.canvasId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: [] }
        state.conversations.push(steerConversation)
      }
      const steerNow = new Date().toISOString()
      const steerReply = '🔀 Pi steering · Added your message to the running turn.'
      const steerAssistantId = `msg-${randomUUID()}`
      steerConversation.messages.push({ id: `msg-${randomUUID()}`, role: 'user', content: turn.message, createdAt: steerNow })
      steerConversation.messages.push({ id: steerAssistantId, role: 'assistant', content: steerReply, progress: turn.progress, createdAt: steerNow })
      steerConversation.updatedAt = steerNow
      turn.status = 'succeeded'
      turn.completedAt = steerNow
      turn.updatedAt = steerNow
      await Promise.all([persist('conversations'), persist('turns')])
      emit('text', { step_id: 'final-response', id: steerAssistantId, text: steerReply })
      emit('finish', { finish_reason: 'stop' })
      return
    }
    if (plan.userSelectionRequest) {
      turn.status = 'waiting_for_user'
      delete turn.selection
      turn.request = { request_id: `request-${randomUUID()}`, ...plan.userSelectionRequest }
      const now = new Date().toISOString()
      const conversationIndex = state.conversations.findIndex((item) => item.canvasId === turn.canvasId)
      const nextConversation = conversationIndex < 0
        ? { id: turn.conversationId, canvasId: turn.canvasId, messages: [], createdAt: now }
        : structuredClone(state.conversations[conversationIndex])
      if (!nextConversation.messages.some((message) => message.turnId === turn.id && message.role === 'user')) {
        nextConversation.messages.push({ id: `msg-${randomUUID()}`, role: 'user', content: turn.message, turnId: turn.id, createdAt: now })
      }
      const requestMessage = { id: `msg-${randomUUID()}`, role: 'assistant', content: '', turnId: turn.id, request: turn.request, progress: turn.progress, createdAt: now }
      nextConversation.messages.push(requestMessage)
      nextConversation.updatedAt = now
      turn.requestMessageId = requestMessage.id
      turn.updatedAt = new Date().toISOString()
      if (conversationIndex < 0) state.conversations.push(nextConversation)
      else state.conversations[conversationIndex] = nextConversation
      await Promise.all([persist('conversations'), persist('turns')])
      emit('request_user_select', { request: turn.request })
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
    if (!turn.requestMessageId) nextConversation.messages.push({ id: `msg-${randomUUID()}`, role: 'user', content: turn.message, createdAt: now })
    nextConversation.messages.push({ id: assistantMessageId, role: 'assistant', content: plan.reply, progress: turn.progress, createdAt: now })
    nextConversation.updatedAt = now
    turn.status = 'succeeded'
    turn.result = structuredClone({ ...plan, conversation: nextConversation })
    turn.completedAt = new Date().toISOString()
    turn.updatedAt = turn.completedAt
    await Promise.all([persist('canvases'), persist('conversations'), persist('turns')])
    emit('text', { step_id: 'final-response', id: assistantMessageId, text: plan.reply })
    emit('canvas-updated', { changed_node_ids: plan.changedNodeIds, structure_changed: plan.structureChanged })
    emit('finish', { finish_reason: 'stop' })
  } catch (error) {
    if (turn.status === 'cancelled' || turn.status === 'cancelling' || error?.name === 'AbortError') {
      turn.status = 'cancelled'
      turn.completedAt ||= new Date().toISOString()
      turn.updatedAt = turn.completedAt
      try {
        await persist('turns')
      } catch {}
      return
    }
    turn.status = 'failed'
    turn.error = error.message
    turn.completedAt = new Date().toISOString()
    turn.updatedAt = turn.completedAt
    try {
      await persist('turns')
    } catch {
      // Keep the terminal status in memory if persistence itself fails.
    }
    emit('error', { error: turn.error })
  }
}

function enqueueAgentTurn(turn) {
  const previous = canvasTurnQueues.get(turn.canvasId) || Promise.resolve()
  const current = previous
    .catch(() => {})
    .then(() => executeAgentTurn(turn))
    .finally(() => {
      if (canvasTurnQueues.get(turn.canvasId) === current) canvasTurnQueues.delete(turn.canvasId)
    })
  canvasTurnQueues.set(turn.canvasId, current)
  return current
}

const server = createServer(async (request, response) => {
  try {
    const parts = route(request)
    if (parts[0] !== 'api') return json(response, 404, { error: 'Not found' })

    // What this server can actually do, so the debug panel can disable a
    // provider it has no credentials for instead of failing on execution.
    if (request.method === 'GET' && parts[1] === 'capabilities' && parts.length === 2) {
      return json(response, 200, {
        providers: { mock: true, tripo: Boolean(createTripoProvider) },
        defaultProvider: createTripoProvider ? 'tripo' : 'mock',
        tripoNodeTypes: [...tripoNodeTypes],
      })
    }

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
      await removeCanvas(parts[2])
      await Promise.all([persist('canvases'), persist('conversations'), persist('runs')])
      return json(response, 204, null)
    }

    // The canvas's event channel. One long-lived SSE per open canvas carries
    // every server-pushed event for it, so posting a turn is a plain 202 and a
    // second client watching the same canvas sees the same stream.
    if (request.method === 'GET' && parts[1] === 'canvases' && parts[2] && parts[3] === 'events' && parts.length === 4) {
      const canvas = canvasById(parts[2])
      if (!canvas) return json(response, 404, { error: 'Canvas not found' })
      openSse(response)
      // Flush the headers so the client's EventSource opens before the first event.
      response.write(': subscribed\n\n')
      const unsubscribe = subscribeCanvas(canvas.id, response)
      // Proxies drop an idle stream; a comment line keeps it warm and is ignored.
      const keepalive = setInterval(() => response.write(': keepalive\n\n'), 15000)
      request.on('close', () => {
        clearInterval(keepalive)
        unsubscribe()
      })
      return
    }

    // Turns in progress for a canvas. The conversation holds the messages that
    // already landed; this holds the ones still running, so a reload can pick
    // an interrupted turn back up.
    if (request.method === 'GET' && parts[1] === 'canvases' && parts[2] && parts[3] === 'turns' && parts.length === 4) {
      const canvas = canvasById(parts[2])
      if (!canvas) return json(response, 404, { error: 'Canvas not found' })
      const url = new URL(request.url, `http://${request.headers.host}`)
      const statuses = new Set((url.searchParams.get('status') || '').split(',').filter(Boolean))
      const turns = state.turns.filter((turn) => turn.canvasId === canvas.id && (!statuses.size || statuses.has(turn.status)))
      return json(response, 200, turns)
    }

    if (request.method === 'POST' && parts[1] === 'turns' && parts[3] === 'continue' && parts.length === 4) {
      const turn = turnById(parts[2])
      if (!turn) return json(response, 404, { error: 'Turn not found' })
      const input = await body(request)
      const selectedOptionIds = input.selected_option_ids
      const existingSelection = turn.selection
      if (existingSelection) {
        if (input.request_id === existingSelection.request_id && Array.isArray(selectedOptionIds) && selectedOptionIds.length === existingSelection.selected_option_ids.length && selectedOptionIds.every((optionId, index) => optionId === existingSelection.selected_option_ids[index])) {
          return json(response, 200, turn)
        }
        return json(response, 409, { error: 'This selection was already submitted' })
      }
      if (turn.status !== 'waiting_for_user' || !turn.request || input.request_id !== turn.request.request_id) return json(response, 409, { error: 'Turn is not waiting for this selection' })
      if (!Array.isArray(selectedOptionIds) || selectedOptionIds.some((optionId) => typeof optionId !== 'string') || new Set(selectedOptionIds).size !== selectedOptionIds.length || selectedOptionIds.length < turn.request.min || selectedOptionIds.length > turn.request.max || selectedOptionIds.some((optionId) => !turn.request.options.some((option) => option.id === optionId))) {
        return json(response, 400, { error: 'Selected options are invalid' })
      }
      turn.selection = { request_id: turn.request.request_id, selected_option_ids: selectedOptionIds }
      const conversation = state.conversations.find((item) => item.canvasId === turn.canvasId)
      const requestMessage = conversation?.messages.find((message) => message.id === turn.requestMessageId)
      const selectedLabels = selectedOptionIds.map((optionId) => turn.request.options.find((option) => option.id === optionId).label)
      if (conversation && requestMessage) {
        requestMessage.selection = turn.selection
        conversation.messages.push({ id: `msg-${randomUUID()}`, role: 'user', content: selectedLabels.join(', '), turnId: turn.id, selection: turn.selection, createdAt: new Date().toISOString() })
        conversation.updatedAt = new Date().toISOString()
      }
      turn.status = 'queued'
      turn.updatedAt = new Date().toISOString()
      await Promise.all([persist('conversations'), persist('turns')])
      void enqueueAgentTurn(turn)
      return json(response, 202, turn)
    }

    if (request.method === 'POST' && parts[1] === 'turns' && parts[3] === 'cancel' && parts.length === 4) {
      const turn = turnById(parts[2])
      if (!turn) return json(response, 404, { error: 'Turn not found' })
      if (['succeeded', 'failed', 'cancelled'].includes(turn.status)) return json(response, 200, turn)
      const previousStatus = turn.status
      turn.status = 'cancelling'
      turn.updatedAt = new Date().toISOString()
      await persist('turns')
      try {
        await activeTurnCancels.get(turn.id)?.()
      } catch (error) {
        turn.status = previousStatus
        turn.updatedAt = new Date().toISOString()
        await persist('turns')
        throw error
      }
      turn.status = 'cancelled'
      turn.completedAt = new Date().toISOString()
      turn.updatedAt = turn.completedAt
      await persist('turns')
      broadcast(turn.canvasId, turnEvent(turn, 'finish', { finish_reason: 'cancelled' }))
      return json(response, 200, turn)
    }

    // Start a turn. `canvasId` may be `new`, which creates the canvas this turn
    // will build, so the first message does not need a canvas up front.
    if (request.method === 'POST' && parts[1] === 'canvases' && parts[2] && parts[3] === 'turns' && parts.length === 4) {
      const input = await body(request)
      if (typeof input.message !== 'string' || !input.message.trim()) return json(response, 400, { error: 'message is required' })
      if (!process.env.DEEPSEEK_API_KEY) {
        const error = new Error('DeepSeek is not configured. Set DEEPSEEK_API_KEY and restart the API server.')
        error.statusCode = 503
        throw error
      }
      const isNew = parts[2] === 'new'
      const canvas = isNew ? createCanvas({ name: 'New canvas', nodes: [], edges: [] }) : canvasById(parts[2])
      if (!canvas) {
        const error = new Error('Canvas not found')
        error.statusCode = 404
        throw error
      }
      if (isNew) {
        state.canvases.push(canvas)
        state.conversations.push(createInitialConversation(canvas))
      }
      const now = new Date().toISOString()
      const conversation = conversationFor(canvas.id)
      const turn = {
        id: `turn-${randomUUID()}`,
        conversationId: conversation?.id || `conv-${randomUUID()}`,
        canvasId: canvas.id,
        message: input.message,
        status: 'queued',
        progress: [],
        createdAt: now,
        updatedAt: now,
      }
      state.turns.push(turn)
      await Promise.all([persist('canvases'), persist('conversations'), persist('turns')])
      // A run for this canvas is already streaming -> dispatch now (bypassing
      // the serial queue) so the agent service steers this message into it.
      // Otherwise queue it as the canvas's next run.
      const dispatch = (activeRuns.get(canvas.id) || 0) > 0 ? executeAgentTurn : enqueueAgentTurn
      void dispatch(turn)
      return json(response, 202, turn)
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

    // Files copied off Tripo before their URLs expired. Only hashed names
    // resolve, so this cannot read anything else under the data directory.
    if (request.method === 'GET' && parts[1] === 'assets' && parts.length === 3) {
      const asset = await readAsset(parts[2])
      if (!asset) return json(response, 404, { error: 'Asset not found' })
      response.writeHead(200, {
        'content-type': asset.contentType,
        // The name is a content hash, so the bytes can never change.
        'cache-control': 'public, max-age=31536000, immutable',
      })
      return response.end(asset.bytes)
    }

    if (request.method === 'GET' && parts[1] === 'executions' && parts.length === 3) {
      const execution = executionById(state.runs, parts[2])
      return execution ? json(response, 200, executionDto(execution)) : json(response, 404, { error: 'Execution not found' })
    }

    if (request.method === 'POST' && parts[1] === 'nodes' && parts[2] && parts[3] === 'executions' && parts.length === 4) {
      const match = findNode(state.canvases, parts[2])
      if (!match) return json(response, 404, { error: 'Node not found' })
      const { mode = 'downstream', provider: requestedProvider } = await body(request)
      if (requestedProvider && !['mock', 'tripo'].includes(requestedProvider)) {
        return json(response, 400, { error: 'provider must be "mock" or "tripo"' })
      }
      if (requestedProvider === 'tripo' && !createTripoProvider) {
        return json(response, 503, { error: 'Tripo is not configured. Set TRIPO_API_KEY and restart the API server.' })
      }
      // Default to Tripo whenever it is configured; the debug panel sends an
      // explicit provider to force one side or the other.
      const useTripo = requestedProvider ? requestedProvider === 'tripo' : Boolean(createTripoProvider)
      const pending = createExecution(state.runs, match.canvas, match.node, mode)
      await persist('runs')
      void executeExecution(state.runs, pending.run, match.canvas, pending.executionCanvas, pending.nodes, match.node, () => persist('runs'), { createProvider: useTripo ? createTripoProvider : null }).catch(console.error)
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
