import { latestNodeRuns } from './server/node-state.js'
import { executionAssets } from './server/run-assets.js'
import { createExecution, executeExecution, executionById, executionDto, findNode, paginateAssets } from './server/executions.js'
import { createInitialSession, createCanvas, createSession, emptySession } from './server/canvases.js'
import { runDeepSeekAgent } from './server/deepseek.js'
import { cancelAgentViaService, runAgentViaService } from './server/agent-client.js'
import { applyAgentCanvas, projectDto, replaceCanvasDocument } from './server/projects.js'

const collections = ['canvases', 'sessions', 'runs', 'turns']
const activeTurnIds = new Set()
const activeTurnControllers = new Map()

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

async function collectionExists(env, collection) {
  return Boolean(await env.DB.prepare('SELECT 1 AS present FROM app_state WHERE collection = ?1').bind(collection).first('present'))
}

async function writeCollections(env, state, names = collections) {
  const statements = names.map((name) => env.DB.prepare('INSERT INTO app_state (collection, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(collection) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').bind(name, JSON.stringify(state[name]), new Date().toISOString()))
  await env.DB.batch(statements)
}

async function loadState(env) {
  const [values, hasSessions, hasThreads] = await Promise.all([
    Promise.all(collections.map((name) => readCollection(env, name))),
    collectionExists(env, 'sessions'),
    collectionExists(env, 'threads'),
  ])
  const state = Object.fromEntries(collections.map((name, index) => [name, values[index]]))
  if (!hasSessions) {
    const legacy = hasThreads ? await readCollection(env, 'threads') : await readCollection(env, 'conversations')
    if (legacy.length) {
      state.sessions = legacy
      await writeCollections(env, state, ['sessions'])
    }
  }
  const migratedTurns = state.turns.map((turn) => {
    if (!turn.conversationId && !turn.threadId && !turn.result?.conversation && !turn.result?.thread && (turn.sessionId || !turn.result?.session?.id)) return turn
    const migrated = structuredClone(turn)
    if (!migrated.sessionId) migrated.sessionId = migrated.threadId || migrated.conversationId
    delete migrated.threadId
    delete migrated.conversationId
    if (migrated.result) {
      if (!migrated.result.session) migrated.result.session = migrated.result.thread || migrated.result.conversation
      delete migrated.result.thread
      delete migrated.result.conversation
    }
    if (!migrated.sessionId && migrated.result?.session?.id) migrated.sessionId = migrated.result.session.id
    return migrated
  })
  if (migratedTurns.some((turn, index) => turn !== state.turns[index])) {
    state.turns = migratedTurns
    await writeCollections(env, state, ['turns'])
  }
  return state
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

// One SSE channel per canvas, subscribed when a client opens the canvas. Nothing
// is buffered or replayed - a client that reconnects re-reads state over REST.
// Isolate-local, so this only holds for clients served by the same isolate.
const canvasChannels = new Map()
const canvasEventSeqs = new Map()
const encoder = new TextEncoder()

function subscribeCanvas(canvasId, writer) {
  const subscribers = canvasChannels.get(canvasId) || new Set()
  subscribers.add(writer)
  canvasChannels.set(canvasId, subscribers)
  return () => {
    subscribers.delete(writer)
    if (!subscribers.size) canvasChannels.delete(canvasId)
  }
}

function turnEvent(turn, type, fields = {}) {
  const seq = (canvasEventSeqs.get(turn.canvasId) || 0) + 1
  canvasEventSeqs.set(turn.canvasId, seq)
  return {
    id: `${seq}-0`,
    data: { type, canvas_id: turn.canvasId, session_id: turn.sessionId, turn_id: turn.id, ...fields },
  }
}

async function broadcast(canvasId, event) {
  const frame = encoder.encode(`event: ${event.data.type === 'error' ? 'error' : 'message'}\ndata: ${JSON.stringify(event.data)}\nid: ${event.id}\n\n`)
  await Promise.all([...(canvasChannels.get(canvasId) || [])].map((writer) => writer.write(frame).catch(() => {})))
}

function canvasById(state, canvasId) {
  return state.canvases.find((canvas) => canvas.id === canvasId)
}

function sessionById(state, sessionId) {
  return state.sessions.find((session) => session.id === sessionId)
}

function turnById(state, turnId) {
  return state.turns.find((turn) => turn.id === turnId)
}

async function reloadAgentCollections(env, state) {
  const [canvases, sessions, turns] = await Promise.all([
    readCollection(env, 'canvases'),
    readCollection(env, 'sessions'),
    readCollection(env, 'turns'),
  ])
  state.canvases = canvases
  state.sessions = sessions
  state.turns = turns
}

async function executeAgentTurn(env, state, turn) {
  // Everything this turn produces goes out on the canvas's channel, so a client
  // that is not the one which posted the turn still sees it.
  const emit = (type, fields) => broadcast(turn.canvasId, turnEvent(turn, type, fields))
  try {
    await reloadAgentCollections(env, state)
    const startingTurn = turnById(state, turn.id)
    if (!startingTurn || !canvasById(state, turn.canvasId) || !sessionById(state, turn.sessionId)) throw new Error('Project, session, or turn was deleted before this turn started')
    if (startingTurn.status === 'cancelled' || startingTurn.status === 'cancelling') return
    Object.assign(startingTurn, turn)
    turn = startingTurn
    turn.status = 'running'
    turn.startedAt = new Date().toISOString()
    await writeCollections(env, state, ['turns'])
    await emit('turn-start')
    const canvas = canvasById(state, turn.canvasId)
    if (!canvas) throw new Error('Canvas not found')
    const session = sessionById(state, turn.sessionId)
    const runAgent = env.AGENT_SERVICE_URL ? runAgentViaService : runDeepSeekAgent
    const controller = new AbortController()
    activeTurnControllers.set(turn.id, controller)
    let plan
    try {
      plan = await runAgent({
        serviceUrl: env.AGENT_SERVICE_URL,
        turnId: turn.id,
        signal: controller.signal,
        apiKey: env.DEEPSEEK_API_KEY,
        baseUrl: env.DEEPSEEK_BASE_URL,
        model: env.DEEPSEEK_MODEL,
        message: turn.selection ? `${turn.message}\n\nThe user selected: ${turn.selection.selected_option_ids.map((optionId) => turn.request.options.find((option) => option.id === optionId)?.label || optionId).join(', ')}. Continue the turn using this selection.` : turn.message,
        canvas,
        history: session?.messages || [],
        onProgress: async (event) => {
          await reloadAgentCollections(env, state)
          const currentTurn = turnById(state, turn.id)
          if (!currentTurn || !canvasById(state, turn.canvasId) || !sessionById(state, turn.sessionId)) throw new Error('Project, session, or turn was deleted while this turn was running')
          Object.assign(currentTurn, turn)
          turn = currentTurn
          turn.progress.push(event)
          turn.updatedAt = new Date().toISOString()
          await writeCollections(env, state, ['turns'])
          await emit('progress', { step_id: `progress-${turn.progress.length}`, ...event })
        },
      })
    } finally {
      if (activeTurnControllers.get(turn.id) === controller) activeTurnControllers.delete(turn.id)
    }
    await reloadAgentCollections(env, state)
    turn = turnById(state, turn.id)
    if (!turn || !canvasById(state, turn.canvasId) || !sessionById(state, turn.sessionId)) throw new Error('Project, session, or turn was deleted while this turn was running')
    if (turn.status === 'cancelled' || turn.status === 'cancelling') return
    if (plan.canvas && plan.canvas.id !== turn.canvasId) throw new Error('Agent returned a canvas outside this project')
    if (plan.userSelectionRequest) {
      turn.status = 'waiting_for_user'
      delete turn.selection
      turn.request = { request_id: `request-${id()}`, ...plan.userSelectionRequest }
      const now = new Date().toISOString()
      const sessionIndex = state.sessions.findIndex((item) => item.id === turn.sessionId)
      if (sessionIndex < 0) throw new Error('Session not found')
      const nextSession = structuredClone(state.sessions[sessionIndex])
      if (!nextSession.messages.some((message) => message.turnId === turn.id && message.role === 'user')) {
        nextSession.messages.push({ id: `msg-${id()}`, role: 'user', content: turn.message, turnId: turn.id, createdAt: now })
      }
      const requestMessage = { id: `msg-${id()}`, role: 'assistant', content: '', turnId: turn.id, request: turn.request, progress: turn.progress, createdAt: now }
      nextSession.messages.push(requestMessage)
      nextSession.updatedAt = now
      turn.requestMessageId = requestMessage.id
      turn.updatedAt = new Date().toISOString()
      state.sessions[sessionIndex] = nextSession
      await writeCollections(env, state, ['sessions', 'turns'])
      await emit('request_user_select', { request: turn.request })
      return
    }
    const index = state.canvases.findIndex((item) => item.id === turn.canvasId)
    if (index < 0) throw new Error('Project was deleted while this turn was running')
    const project = state.canvases[index]
    state.canvases[index] = applyAgentCanvas(project, plan.canvas)
    const nextSession = sessionById(state, turn.sessionId)
    if (!nextSession) throw new Error('Session not found')
    const now = new Date().toISOString()
    const assistantMessageId = `msg-${id()}`
    if (!turn.requestMessageId) nextSession.messages.push({ id: `msg-${id()}`, role: 'user', content: turn.message, createdAt: now })
    nextSession.messages.push({ id: assistantMessageId, role: 'assistant', content: plan.reply, progress: turn.progress, createdAt: now })
    nextSession.updatedAt = now
    turn.status = 'succeeded'
    turn.result = clone({ ...plan, session: nextSession })
    turn.completedAt = new Date().toISOString()
    turn.updatedAt = turn.completedAt
    await writeCollections(env, state, ['canvases', 'sessions', 'turns'])
    await emit('text', { step_id: 'final-response', id: assistantMessageId, text: plan.reply })
    await emit('canvas-updated', { changed_node_ids: plan.changedNodeIds, structure_changed: plan.structureChanged })
    await emit('finish', { finish_reason: 'stop' })
  } catch (error) {
    await reloadAgentCollections(env, state).catch(() => {})
    const latestTurn = turnById(state, turn.id)
    if (latestTurn?.status === 'cancelled' || latestTurn?.status === 'cancelling' || error?.name === 'AbortError') {
      if (latestTurn) {
        latestTurn.status = 'cancelled'
        latestTurn.completedAt ||= new Date().toISOString()
        latestTurn.updatedAt = latestTurn.completedAt
        await writeCollections(env, state, ['turns']).catch(() => {})
      }
      return
    }
    turn.status = 'failed'
    turn.error = error.message
    turn.completedAt = new Date().toISOString()
    turn.updatedAt = turn.completedAt
    const [canvases, sessions, turns] = await Promise.all([readCollection(env, 'canvases'), readCollection(env, 'sessions'), readCollection(env, 'turns')])
    if (canvases.some((canvas) => canvas.id === turn.canvasId) && sessions.some((session) => session.id === turn.sessionId)) {
      const index = turns.findIndex((item) => item.id === turn.id)
      if (index >= 0) {
        turns[index] = turn
        await writeCollections(env, { turns }, ['turns'])
      }
    }
    await emit('error', { error: turn.error })
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

  if (request.method === 'GET' && parts[1] === 'projects' && parts.length === 2) {
    return response(state.canvases.map(projectDto))
  }
  if (request.method === 'POST' && parts[1] === 'projects' && parts.length === 2) {
    const canvas = createCanvas(await parseJson(request))
    state.canvases.push(canvas)
    state.sessions.push(createInitialSession(canvas))
    await writeCollections(env, state, ['canvases', 'sessions'])
    return response(projectDto(canvas), 201)
  }
  if (request.method === 'GET' && parts[1] === 'projects' && parts.length === 3) {
    const canvas = canvasById(state, parts[2])
    if (!canvas) return response({ error: 'Project not found' }, 404)
    return response(projectDto(canvas))
  }
  if (request.method === 'PATCH' && parts[1] === 'projects' && parts.length === 3) {
    const index = state.canvases.findIndex((canvas) => canvas.id === parts[2])
    if (index < 0) return response({ error: 'Project not found' }, 404)
    const input = await parseJson(request)
    if (typeof input.name === 'string' && !input.name.trim()) return response({ error: 'Project name is required' }, 400)
    if (typeof input.name === 'string') state.canvases[index].name = input.name.trim()
    if (typeof input.description === 'string') state.canvases[index].description = input.description.trim()
    state.canvases[index].updatedAt = new Date().toISOString()
    await writeCollections(env, state, ['canvases'])
    return response(projectDto(state.canvases[index]))
  }
  if (request.method === 'GET' && parts[1] === 'canvases' && parts.length === 3) {
    const canvas = canvasById(state, parts[2])
    return canvas ? response({ canvas, nodeRuns: latestNodeRuns(canvas, state.runs) }) : response({ error: 'Canvas not found' }, 404)
  }
  if (request.method === 'GET' && parts[1] === 'canvases' && parts[2] && parts[3] === 'sessions' && parts.length === 4) {
    const canvas = canvasById(state, parts[2])
    if (!canvas) return response({ error: 'Canvas not found' }, 404)
    const sessions = state.sessions.filter((session) => session.canvasId === canvas.id)
    return response(sessions.length ? sessions : [emptySession(canvas)])
  }
  if (request.method === 'POST' && parts[1] === 'canvases' && parts[2] && parts[3] === 'sessions' && parts.length === 4) {
    const canvas = canvasById(state, parts[2])
    if (!canvas) return response({ error: 'Canvas not found' }, 404)
    const session = createSession(canvas)
    state.sessions.push(session)
    await writeCollections(env, state, ['sessions'])
    return response(session, 201)
  }
  if (request.method === 'GET' && parts[1] === 'sessions' && parts[2] && parts[3] === 'chat-history' && parts.length === 4) {
    const session = sessionById(state, parts[2])
    return session ? response(session) : response({ error: 'Session not found' }, 404)
  }
  if (request.method === 'PUT' && parts[1] === 'canvases' && parts.length === 3) {
    const index = state.canvases.findIndex((canvas) => canvas.id === parts[2])
    if (index < 0) return response({ error: 'Canvas not found' }, 404)
    const project = state.canvases[index]
    state.canvases[index] = replaceCanvasDocument(project, await parseJson(request), parts[2], new Date().toISOString())
    await writeCollections(env, state, ['canvases'])
    return response(state.canvases[index])
  }
  if (request.method === 'DELETE' && parts[1] === 'projects' && parts.length === 3) {
    const index = state.canvases.findIndex((canvas) => canvas.id === parts[2])
    if (index < 0) return response({ error: 'Project not found' }, 404)
    state.canvases.splice(index, 1)
    state.sessions = state.sessions.filter((session) => session.canvasId !== parts[2])
    state.runs = state.runs.filter((run) => run.canvasId !== parts[2])
    state.turns = state.turns.filter((turn) => turn.canvasId !== parts[2])
    await writeCollections(env, state, ['canvases', 'sessions', 'runs', 'turns'])
    return response(null, 204)
  }
  if (request.method === 'POST' && parts[1] === 'projects' && parts[3] === 'duplicate' && parts.length === 4) {
    const source = canvasById(state, parts[2])
    if (!source) return response({ error: 'Project not found' }, 404)
    const now = new Date().toISOString()
    const canvas = { ...clone(source), id: `canvas-${id()}`, name: `${source.name} Copy`, revision: 1, createdAt: now, updatedAt: now }
    state.canvases.push(canvas)
    state.sessions.push({ id: `session-${id()}`, canvasId: canvas.id, createdAt: now, updatedAt: now, messages: [{ id: `msg-${id()}`, role: 'assistant', content: 'This canvas was duplicated and can now evolve independently.', createdAt: now }] })
    await writeCollections(env, state, ['canvases', 'sessions'])
    return response(projectDto(canvas), 201)
  }
  // The canvas's event channel. One long-lived SSE per open canvas carries every
  // server-pushed event for it, so posting a turn is a plain 202 and a second
  // client watching the same canvas sees the same stream.
  if (request.method === 'GET' && parts[1] === 'canvases' && parts[2] && parts[3] === 'events' && parts.length === 4) {
    const canvas = canvasById(state, parts[2])
    if (!canvas) return response({ error: 'Canvas not found' }, 404)
    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()
    const unsubscribe = subscribeCanvas(canvas.id, writer)
    // Flush the headers so the client's EventSource opens before the first event,
    // then keep the stream warm; proxies drop an idle one. Comment lines are ignored.
    await writer.write(encoder.encode(': subscribed\n\n'))
    ctx.waitUntil((async () => {
      try {
        for (;;) {
          await scheduler.wait(15000)
          await writer.write(encoder.encode(': keepalive\n\n'))
        }
      } catch {
        // The client went away; drop it from the channel.
      } finally {
        unsubscribe()
      }
    })())
    return sseResponse(readable)
  }

  if (request.method === 'GET' && parts[1] === 'sessions' && parts[2] && parts[3] === 'turns' && parts.length === 4) {
    const session = sessionById(state, parts[2])
    if (!session) return response({ error: 'Session not found' }, 404)
    const statuses = new Set((url.searchParams.get('status') || '').split(',').filter(Boolean))
    return response(state.turns.filter((turn) => turn.sessionId === session.id
      && (!statuses.size || statuses.has(turn.status))
      && (turn.status === 'waiting_for_user' || !['queued', 'running'].includes(turn.status) || activeTurnIds.has(turn.id))))
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
    await reloadAgentCollections(env, state)
    const currentTurn = turnById(state, parts[2])
    const session = currentTurn && sessionById(state, currentTurn.sessionId)
    if (!currentTurn || !session || !canvasById(state, currentTurn.canvasId)) return response({ error: 'Turn not found' }, 404)
    if (currentTurn.status !== 'waiting_for_user' || !currentTurn.request || input.request_id !== currentTurn.request.request_id) return response({ error: 'Turn is not waiting for this selection' }, 409)
    currentTurn.selection = { request_id: currentTurn.request.request_id, selected_option_ids: selectedOptionIds }
    const requestMessage = session.messages.find((message) => message.id === currentTurn.requestMessageId)
    const selectedLabels = selectedOptionIds.map((optionId) => currentTurn.request.options.find((option) => option.id === optionId).label)
    if (requestMessage) {
      requestMessage.selection = currentTurn.selection
      session.messages.push({ id: `msg-${id()}`, role: 'user', content: selectedLabels.join(', '), turnId: currentTurn.id, selection: currentTurn.selection, createdAt: new Date().toISOString() })
      session.updatedAt = new Date().toISOString()
    }
    currentTurn.status = 'queued'
    currentTurn.updatedAt = new Date().toISOString()
    await writeCollections(env, state, ['sessions', 'turns'])
    activeTurnIds.add(currentTurn.id)
    ctx.waitUntil(executeAgentTurn(env, state, currentTurn).finally(() => activeTurnIds.delete(currentTurn.id)))
    return response(currentTurn, 202)
  }
  if (request.method === 'POST' && parts[1] === 'turns' && parts[3] === 'cancel' && parts.length === 4) {
    await reloadAgentCollections(env, state)
    const turn = turnById(state, parts[2])
    if (!turn || !canvasById(state, turn.canvasId)) return response({ error: 'Turn not found' }, 404)
    if (['succeeded', 'failed', 'cancelled'].includes(turn.status)) return response(turn)
    turn.status = 'cancelling'
    turn.updatedAt = new Date().toISOString()
    await writeCollections(env, state, ['turns'])
    if (env.AGENT_SERVICE_URL) await cancelAgentViaService(env.AGENT_SERVICE_URL, turn.id)
    activeTurnControllers.get(turn.id)?.abort()
    turn.status = 'cancelled'
    turn.completedAt = new Date().toISOString()
    turn.updatedAt = turn.completedAt
    await writeCollections(env, state, ['turns'])
    await broadcast(turn.canvasId, turnEvent(turn, 'finish', { finish_reason: 'cancelled' }))
    return response(turn)
  }
  if (request.method === 'POST' && parts[1] === 'sessions' && parts[2] && parts[3] === 'turns' && parts.length === 4) {
    const input = await parseJson(request)
    if (typeof input.message !== 'string' || !input.message.trim()) return response({ error: 'message is required' }, 400)
    if (!env.DEEPSEEK_API_KEY) return response({ error: 'DeepSeek is not configured.' }, 503)
    const session = sessionById(state, parts[2])
    if (!session) return response({ error: 'Session not found' }, 404)
    const canvas = canvasById(state, session.canvasId)
    if (!canvas) return response({ error: 'Canvas not found' }, 404)
    const now = new Date().toISOString()
    const turn = { id: `turn-${id()}`, sessionId: session.id, canvasId: canvas.id, message: input.message, status: 'queued', progress: [], createdAt: now, updatedAt: now }
    state.turns.push(turn)
    await writeCollections(env, state, ['turns'])
    activeTurnIds.add(turn.id)
    ctx.waitUntil(executeAgentTurn(env, state, turn).finally(() => activeTurnIds.delete(turn.id)))
    return response(turn, 202)
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
