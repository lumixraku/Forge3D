// The whole HTTP API, once. Both entry points bind to it:
//   server/index.ts - Node http server, file-backed store, Tripo, local assets
//   worker.ts       - Cloudflare Worker, D1-backed store
//
// Everything here is runtime-agnostic: it speaks Web-standard Request/Response
// and reaches the outside world only through the ports below. Anything a runtime
// cannot do is passed as null and answers with the right status instead of being
// missing from the route table.
//
// Ports:
//   store      { state, persist(names), reload(names), removeCanvas(id) }
//   waitUntil  keeps a background promise alive past the response
//   config     credentials plus the two optional capabilities (Tripo, assets)

import { randomUUID } from './ids.js'
import { latestNodeRuns } from './node-state.js'
import { executionAssets } from './run-assets.js'
import { cancelExecution, canvasExecutions, createExecution, executeExecution, executionById, executionDto, paginateAssets } from './executions.js'
import { createInitialSession, createCanvas, createSession, duplicateCanvas } from './canvases.js'
import { runDeepSeekAgent } from './deepseek.js'
import { cancelAgentViaService, runAgentViaService } from './agent-client.js'
import { tripoNodeTypes } from './tripo-mapping.js'
import { applyAgentCanvas, projectDto, replaceCanvasDocument } from './projects.js'
import { appendAgentTrace, checkpointAgentTrace, createAgentTrace, sanitizeAgentError } from './agent-traces.js'

const AGENT_COLLECTIONS = ['canvases', 'sessions', 'turns', 'agentTraces']

function json(body, status = 200) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

async function parseJson(request) {
  return request.json().catch(() => ({}))
}

// One SSE channel per canvas: a client subscribes when it opens the canvas and
// every event the server pushes for that canvas is multiplexed onto it. Nothing
// is buffered or replayed - a client that reconnects re-reads state over REST.
// The registry is per-process (per-isolate on Workers), so it only reaches
// clients served by the same instance.
function createChannels() {
  const subscribers = new Map()
  const sequences = new Map()

  return {
    subscribe(canvasId, sink) {
      const sinks = subscribers.get(canvasId) || new Set()
      sinks.add(sink)
      subscribers.set(canvasId, sinks)
      return () => {
        sinks.delete(sink)
        if (!sinks.size) subscribers.delete(canvasId)
      }
    },
    event(turn, type, fields = {}) {
      const seq = (sequences.get(turn.canvasId) || 0) + 1
      sequences.set(turn.canvasId, seq)
      return {
        id: `${seq}-0`,
        data: { type, canvas_id: turn.canvasId, session_id: turn.sessionId, turn_id: turn.id, ...fields },
      }
    },
    notification(canvasId, type, fields = {}) {
      const seq = (sequences.get(canvasId) || 0) + 1
      sequences.set(canvasId, seq)
      return { id: `${seq}-0`, data: { type, canvas_id: canvasId, ...fields } }
    },
    broadcast(canvasId, event) {
      const frame = `event: ${event.data.type === 'error' ? 'error' : 'message'}\ndata: ${JSON.stringify(event.data)}\nid: ${event.id}\n\n`
      for (const sink of subscribers.get(canvasId) || []) sink(frame)
    },
  }
}

function sseResponse(canvasId, signal, channels) {
  let unsubscribe = () => {}
  let keepalive = null
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      const send = (text) => {
        try {
          controller.enqueue(encoder.encode(text))
        } catch {
          // The client is gone; the teardown below drops it from the channel.
        }
      }
      // Flush a comment so the client's EventSource opens before the first event,
      // then keep the stream warm; proxies drop an idle one. Comments are ignored.
      send(': subscribed\n\n')
      unsubscribe = channels.subscribe(canvasId, send)
      keepalive = setInterval(() => send(': keepalive\n\n'), 15000)
      signal?.addEventListener('abort', () => {
        clearInterval(keepalive)
        unsubscribe()
        try {
          controller.close()
        } catch {
          // Already closed.
        }
      })
    },
    cancel() {
      clearInterval(keepalive)
      unsubscribe()
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    },
  })
}

export function createApi({ createContext }) {
  const channels = createChannels()
  const canvasLeases = new Map()
  const leaseExpiryTimers = new Map()
  const LEASE_DURATION_MS = 30000

  function currentLease(canvasId) {
    const lease = canvasLeases.get(canvasId)
    if (lease && lease.expiresAt > Date.now()) return lease
    if (lease) {
      canvasLeases.delete(canvasId)
      clearTimeout(leaseExpiryTimers.get(canvasId))
      leaseExpiryTimers.delete(canvasId)
    }
    return null
  }

  function broadcastLease(canvasId) {
    channels.broadcast(canvasId, channels.notification(canvasId, 'presence', { lease: currentLease(canvasId) }))
  }

  function scheduleLeaseExpiry(canvasId, lease) {
    clearTimeout(leaseExpiryTimers.get(canvasId))
    leaseExpiryTimers.set(canvasId, setTimeout(() => {
      if (canvasLeases.get(canvasId) !== lease) return
      canvasLeases.delete(canvasId)
      leaseExpiryTimers.delete(canvasId)
      broadcastLease(canvasId)
    }, LEASE_DURATION_MS + 10))
  }
  // In-flight bookkeeping, deliberately outside the per-request context so it
  // survives for the life of the process (or isolate).
  const canvasTurnQueues = new Map()
  const activeTurnIds = new Set()
  // How many agent runs are currently streaming per canvas. A new turn for a
  // canvas with an active run is dispatched immediately (bypassing the serial
  // queue) so the agent service can steer it into the running run.
  const activeRuns = new Map()
  const activeTurnCancels = new Map()
  let recovered = false

  async function executeAgentTurn(context, turn) {
    const { store, config } = context
    const { state } = store
    const canvasById = (id) => state.canvases.find((canvas) => canvas.id === id)
    const sessionById = (id) => state.sessions.find((session) => session.id === id)
    const turnById = (id) => state.turns.find((item) => item.id === id)
    const traceByTurnId = (id) => state.agentTraces.find((trace) => trace.turnId === id)
    const reloadAgentCollections = () => store.reload(AGENT_COLLECTIONS)
    // Everything this turn produces goes out on the canvas's channel, so a client
    // that is not the one which posted the turn still sees it.
    const emit = (type, fields) => channels.broadcast(turn.canvasId, channels.event(turn, type, fields))
    let trace
    const recordTrace = async (type, payload = {}, updates = {}) => {
      await store.reload(['agentTraces'])
      trace = traceByTurnId(turn.id) || trace
      if (!trace) return
      Object.assign(trace, updates)
      appendAgentTrace(trace, type, payload)
      await store.persist(['agentTraces'])
    }
    const saveCheckpoint = async (checkpoint) => {
      await store.reload(['agentTraces'])
      trace = traceByTurnId(turn.id) || trace
      if (!trace) return
      checkpointAgentTrace(trace, checkpoint)
      await store.persist(['agentTraces'])
    }

    try {
      await reloadAgentCollections()
      const startingTurn = turnById(turn.id)
      if (!startingTurn) throw new Error('Turn was deleted before it started')
      if (startingTurn.status === 'cancelled' || startingTurn.status === 'cancelling') return
      Object.assign(startingTurn, turn)
      turn = startingTurn
      trace = traceByTurnId(turn.id)
      turn.attempt = (turn.attempt || 0) + 1
      turn.status = 'running'
      turn.startedAt = new Date().toISOString()
      await store.persist(['turns'])
      if (trace) {
        await recordTrace(turn.attempt > 1 ? 'turn_resumed' : 'turn_started', { attempt: turn.attempt }, { status: 'running', attempt: turn.attempt })
      }
      emit('turn-start')
      const canvas = canvasById(turn.canvasId)
      if (!canvas) throw new Error('Canvas not found')
      const session = sessionById(turn.sessionId)
      if (!session) throw new Error('Session not found')
      const serviceUrl = config.agentServiceUrl
      const runAgent = serviceUrl ? runAgentViaService : runDeepSeekAgent
      const controller = new AbortController()
      const cancel = async () => {
        if (serviceUrl) await cancelAgentViaService(serviceUrl, turn.id)
        controller.abort()
      }
      activeTurnCancels.set(turn.id, cancel)
      activeRuns.set(turn.canvasId, (activeRuns.get(turn.canvasId) || 0) + 1)
      let plan
      try {
        plan = await runAgent({
          serviceUrl,
          turnId: turn.id,
          signal: controller.signal,
          apiKey: config.deepseek.apiKey,
          baseUrl: config.deepseek.baseUrl,
          model: config.deepseek.model,
          message: turn.selection ? `${turn.message}\n\nThe user selected: ${turn.selection.selected_option_ids.map((optionId) => turn.request.options.find((option) => option.id === optionId)?.label || optionId).join(', ')}. Continue the turn using this selection.` : turn.message,
          canvas,
          history: session.messages || [],
          checkpoint: ['tool_complete', 'waiting_for_user'].includes(trace?.checkpoint?.phase) ? trace.checkpoint : undefined,
          onTrace: (event) => recordTrace(event.type, event.payload),
          onCheckpoint: saveCheckpoint,
          onProgress: async (event) => {
            turn.progress.push(event)
            turn.updatedAt = new Date().toISOString()
            await reloadAgentCollections()
            const currentTurn = turnById(turn.id)
            if (!currentTurn || !canvasById(turn.canvasId)) throw new Error('Project or turn was deleted while this turn was running')
            Object.assign(currentTurn, turn)
            turn = currentTurn
            await store.persist(['turns'])
            emit('progress', { step_id: `progress-${turn.progress.length}`, ...event })
          },
        })
      } finally {
        if (activeTurnCancels.get(turn.id) === cancel) activeTurnCancels.delete(turn.id)
        const remaining = (activeRuns.get(turn.canvasId) || 1) - 1
        if (remaining > 0) activeRuns.set(turn.canvasId, remaining)
        else activeRuns.delete(turn.canvasId)
      }
      await reloadAgentCollections()
      const currentTurn = turnById(turn.id)
      if (!canvasById(turn.canvasId) || !sessionById(turn.sessionId) || !currentTurn) throw new Error('Project, session, or turn was deleted while this turn was running')
      if (currentTurn.status === 'cancelled' || currentTurn.status === 'cancelling') return
      turn = currentTurn
      if (plan.canvas && plan.canvas.id !== turn.canvasId) throw new Error('Agent returned a canvas outside this project')
      // The message was steered into a still-running run; it produces no diff of
      // its own. Acknowledge it in the session and finish.
      if (plan.steered) {
        const steerSession = sessionById(turn.sessionId)
        if (!steerSession) throw new Error('Session was deleted while this turn was running')
        const steerNow = new Date().toISOString()
        const steerReply = '🔀 Pi steering · Added your message to the running turn.'
        const steerAssistantId = `msg-${randomUUID()}`
        steerSession.messages.push({ id: `msg-${randomUUID()}`, role: 'user', content: turn.message, createdAt: steerNow })
        steerSession.messages.push({ id: steerAssistantId, role: 'assistant', content: steerReply, progress: turn.progress, createdAt: steerNow })
        steerSession.updatedAt = steerNow
        turn.status = 'succeeded'
        turn.completedAt = steerNow
        turn.updatedAt = steerNow
        await store.persist(['sessions', 'turns'])
        if (trace) {
          await recordTrace('turn_steered', {}, { status: 'succeeded', completedAt: steerNow })
        }
        emit('text', { step_id: 'final-response', id: steerAssistantId, text: steerReply })
        emit('finish', { finish_reason: 'stop' })
        return
      }
      if (plan.userSelectionRequest) {
        delete turn.selection
        turn.request = { request_id: `request-${randomUUID()}`, ...plan.userSelectionRequest }
        const now = new Date().toISOString()
        const sessionIndex = state.sessions.findIndex((item) => item.id === turn.sessionId)
        if (sessionIndex < 0 || !turnById(turn.id)) throw new Error('Session or turn was deleted while this turn was running')
        const nextSession = structuredClone(state.sessions[sessionIndex])
        if (!nextSession.messages.some((message) => message.turnId === turn.id && message.role === 'user')) {
          nextSession.messages.push({ id: `msg-${randomUUID()}`, role: 'user', content: turn.message, attachments: turn.attachments || [], turnId: turn.id, createdAt: now })
        }
        const requestMessage = { id: `msg-${randomUUID()}`, role: 'assistant', content: '', turnId: turn.id, request: turn.request, progress: turn.progress, createdAt: now }
        nextSession.messages.push(requestMessage)
        nextSession.updatedAt = now
        turn.requestMessageId = requestMessage.id
        turn.updatedAt = new Date().toISOString()
        state.sessions[sessionIndex] = nextSession
        await store.persist(['sessions', 'turns'])
        if (trace) {
          await recordTrace('turn_waiting_for_user', { request: turn.request }, { status: 'waiting_for_user' })
        }
        emit('request_user_select', { request: turn.request })
        return
      }
      const canvasIndex = state.canvases.findIndex((item) => item.id === turn.canvasId)
      if (canvasIndex < 0) throw new Error('Project was deleted while this turn was running')
      state.canvases[canvasIndex] = applyAgentCanvas(state.canvases[canvasIndex], plan.canvas)

      const nextSession = sessionById(turn.sessionId)
      if (!nextSession || !turnById(turn.id)) throw new Error('Session or turn was deleted while this turn was running')
      const now = new Date().toISOString()
      const assistantMessageId = `msg-${randomUUID()}`
      nextSession.messages.push({ id: assistantMessageId, role: 'assistant', content: plan.reply, progress: turn.progress, createdAt: now })
      nextSession.updatedAt = now
      turn.status = 'succeeded'
      turn.result = structuredClone({ ...plan, session: nextSession })
      turn.completedAt = new Date().toISOString()
      turn.updatedAt = turn.completedAt
      await store.persist(['canvases', 'sessions', 'turns'])
      if (trace) {
        await recordTrace('turn_succeeded', { changedNodeIds: plan.changedNodeIds, structureChanged: plan.structureChanged }, { status: 'succeeded', completedAt: turn.completedAt })
      }
      emit('text', { step_id: 'final-response', id: assistantMessageId, text: plan.reply })
      emit('canvas-updated', { changed_node_ids: plan.changedNodeIds, structure_changed: plan.structureChanged })
      emit('finish', { finish_reason: 'stop' })
    } catch (error) {
      await store.reload(['turns']).catch(() => {})
      const latestTurn = turnById(turn.id)
      if (latestTurn?.status === 'cancelled' || latestTurn?.status === 'cancelling' || error?.name === 'AbortError') {
        if (latestTurn) {
          latestTurn.status = 'cancelled'
          latestTurn.completedAt ||= new Date().toISOString()
          latestTurn.updatedAt = latestTurn.completedAt
          await store.persist(['turns']).catch(() => {})
          await recordTrace('turn_cancelled').catch(() => {})
        }
        return
      }
      turn.status = 'failed'
      turn.error = error.message
      turn.completedAt = new Date().toISOString()
      turn.updatedAt = turn.completedAt
      try {
        await reloadAgentCollections()
        const currentTurn = turnById(turn.id)
        if (currentTurn && canvasById(turn.canvasId)) {
          Object.assign(currentTurn, turn)
          await store.persist(['turns'])
        }
      } catch {
        // Keep the terminal status in memory if persistence itself fails.
      }
      if (trace) {
        await recordTrace('turn_failed', { error: sanitizeAgentError(error) }, { status: 'failed', completedAt: turn.completedAt }).catch(() => {})
      }
      emit('error', { error: turn.error })
    }
  }

  // Turns for one canvas run one after another, so two of them cannot write the
  // same canvas at once.
  function enqueueAgentTurn(context, turn) {
    activeTurnIds.add(turn.id)
    const previous = canvasTurnQueues.get(turn.canvasId) || Promise.resolve()
    const current = previous
      .catch(() => {})
      .then(() => executeAgentTurn(context, turn))
      .finally(() => {
        activeTurnIds.delete(turn.id)
        if (canvasTurnQueues.get(turn.canvasId) === current) canvasTurnQueues.delete(turn.canvasId)
      })
    canvasTurnQueues.set(turn.canvasId, current)
    return current
  }

  function startAgentTurn(context, turn) {
    // A run for this canvas is already streaming -> dispatch now (bypassing the
    // serial queue) so the agent service steers this message into it. Otherwise
    // queue it as the canvas's next run.
    if ((activeRuns.get(turn.canvasId) || 0) > 0) {
      activeTurnIds.add(turn.id)
      return executeAgentTurn(context, turn).finally(() => activeTurnIds.delete(turn.id))
    }
    return enqueueAgentTurn(context, turn)
  }

  async function recoverAgentTurns(context) {
    if (recovered || !context.recoverAgentTurns) return
    recovered = true
    await context.store.reload(AGENT_COLLECTIONS)
    const { state } = context.store
    const recoverable = state.turns.filter((turn) => !turn.request && ['queued', 'running'].includes(turn.status))
    if (!recoverable.length) return
    const now = new Date().toISOString()
    for (const turn of recoverable) {
      if (turn.status === 'running') {
        turn.status = 'queued'
        turn.interruptedAt = now
        turn.resumeCount = (turn.resumeCount || 0) + 1
        const trace = state.agentTraces.find((item) => item.turnId === turn.id)
        if (trace) {
          trace.resumeCount = turn.resumeCount
          appendAgentTrace(trace, 'turn_recovered', { previousStatus: 'running', resumeCount: turn.resumeCount }, now)
        }
      }
      turn.updatedAt = now
    }
    await context.store.persist(['turns', 'agentTraces'])
    for (const turn of recoverable) context.waitUntil(enqueueAgentTurn(context, turn))
  }

  async function route(request, context) {
    const { store, config, waitUntil } = context
    const { state } = store
    const url = new URL(request.url)
    const parts = url.pathname.split('/').filter(Boolean)
    const method = request.method
    const canvasById = (id) => state.canvases.find((canvas) => canvas.id === id)
    const sessionById = (id) => state.sessions.find((session) => session.id === id)
    const turnById = (id) => state.turns.find((turn) => turn.id === id)

    if (parts[0] !== 'api') return json({ error: 'Not found' }, 404)

    if (method === 'GET' && parts[1] === 'turns' && parts[3] === 'trace' && parts.length === 4) {
      const turn = turnById(parts[2])
      if (!turn) return json({ error: 'Turn not found' }, 404)
      const trace = state.agentTraces.find((item) => item.turnId === turn.id)
      if (!trace) return json({ error: 'Agent trace not found' }, 404)
      const afterValue = url.searchParams.get('after') || '0'
      if (!/^\d+$/.test(afterValue)) return json({ error: 'after must be a non-negative integer' }, 400)
      const after = Number(afterValue)
      return json({ ...trace, events: trace.events.filter((event) => event.seq > after) })
    }

    // What this deployment can actually do, so the debug panel can disable a
    // provider it has no credentials for instead of failing on execution.
    if (method === 'GET' && parts[1] === 'capabilities' && parts.length === 2) {
      return json({
        providers: { mock: true, tripo: Boolean(config.createTripoProvider) },
        defaultProvider: config.createTripoProvider ? 'tripo' : 'mock',
        tripoNodeTypes: [...tripoNodeTypes],
      })
    }

    if (method === 'GET' && parts[1] === 'projects' && parts.length === 2) {
      return json(state.canvases.map(projectDto))
    }

    if (method === 'POST' && parts[1] === 'projects' && parts.length === 2) {
      const canvas = createCanvas(await parseJson(request))
      state.canvases.push(canvas)
      state.sessions.push(createInitialSession(canvas))
      await store.persist(['canvases', 'sessions'])
      return json(projectDto(canvas), 201)
    }

    if (method === 'GET' && parts[1] === 'projects' && parts.length === 3) {
      const canvas = canvasById(parts[2])
      if (!canvas) return json({ error: 'Project not found' }, 404)
      return json(projectDto(canvas))
    }

    if (method === 'PATCH' && parts[1] === 'projects' && parts.length === 3) {
      const index = state.canvases.findIndex((canvas) => canvas.id === parts[2])
      if (index < 0) return json({ error: 'Project not found' }, 404)
      const input = await parseJson(request)
      if (typeof input.name === 'string' && !input.name.trim()) return json({ error: 'Project name is required' }, 400)
      if (typeof input.name === 'string') state.canvases[index].name = input.name.trim()
      if (typeof input.description === 'string') state.canvases[index].description = input.description.trim()
      state.canvases[index].updatedAt = new Date().toISOString()
      await store.persist(['canvases'])
      return json(projectDto(state.canvases[index]))
    }

    if (method === 'DELETE' && parts[1] === 'projects' && parts.length === 3) {
      const index = state.canvases.findIndex((canvas) => canvas.id === parts[2])
      if (index < 0) return json({ error: 'Project not found' }, 404)
      state.canvases.splice(index, 1)
      state.sessions = state.sessions.filter((session) => session.canvasId !== parts[2])
      state.runs = state.runs.filter((run) => run.canvasId !== parts[2])
      state.turns = state.turns.filter((turn) => turn.canvasId !== parts[2])
      state.agentTraces = state.agentTraces.filter((trace) => trace.canvasId !== parts[2])
      await store.removeCanvas(parts[2])
      await store.persist(['canvases', 'sessions', 'runs', 'turns', 'agentTraces'])
      return json(null, 204)
    }

    if (method === 'POST' && parts[1] === 'projects' && parts[3] === 'duplicate' && parts.length === 4) {
      const source = canvasById(parts[2])
      if (!source) return json({ error: 'Project not found' }, 404)
      const canvas = duplicateCanvas(source)
      const now = canvas.createdAt
      state.canvases.push(canvas)
      state.sessions.push({ id: `session-${randomUUID()}`, canvasId: canvas.id, createdAt: now, updatedAt: now, messages: [{ id: `msg-${randomUUID()}`, role: 'assistant', content: 'This canvas was duplicated and can now evolve independently.', createdAt: now }] })
      await store.persist(['canvases', 'sessions'])
      return json(projectDto(canvas), 201)
    }

    if (method === 'GET' && parts[1] === 'canvases' && parts.length === 3) {
      const canvas = canvasById(parts[2])
      if (!canvas) return json({ error: 'Canvas not found' }, 404)
      return json({ canvas, nodeRuns: latestNodeRuns(canvas, state.runs) })
    }

    if (method === 'PUT' && parts[1] === 'canvases' && parts.length === 3) {
      const index = state.canvases.findIndex((canvas) => canvas.id === parts[2])
      if (index < 0) return json({ error: 'Canvas not found' }, 404)
      const input = await parseJson(request)
      if (!Number.isInteger(input.baseRevision)) return json({ error: 'baseRevision is required' }, 400)
      if (!input.canvas || typeof input.canvas !== 'object') return json({ error: 'canvas is required' }, 400)
      if (input.baseRevision !== state.canvases[index].revision) {
        return json({ error: 'Canvas was updated elsewhere', canvas: state.canvases[index] }, 409)
      }
      state.canvases[index] = replaceCanvasDocument(state.canvases[index], input.canvas, parts[2], new Date().toISOString())
      await store.persist(['canvases'])
      channels.broadcast(parts[2], channels.notification(parts[2], 'canvas-updated', {
        revision: state.canvases[index].revision,
        source_client_id: input.clientId,
      }))
      return json(state.canvases[index])
    }

    if (method === 'GET' && parts[1] === 'canvases' && parts[2] && parts[3] === 'presence' && parts.length === 4) {
      if (!canvasById(parts[2])) return json({ error: 'Canvas not found' }, 404)
      return json({ lease: currentLease(parts[2]) })
    }

    if (method === 'POST' && parts[1] === 'canvases' && parts[2] && parts[3] === 'presence' && parts.length === 4) {
      if (!canvasById(parts[2])) return json({ error: 'Canvas not found' }, 404)
      const input = await parseJson(request)
      if (typeof input.clientId !== 'string' || !input.clientId) return json({ error: 'clientId is required' }, 400)
      const lease = currentLease(parts[2])
      if (lease && lease.clientId !== input.clientId) return json({ error: `${lease.displayName} is editing this canvas`, lease }, 423)
      const nextLease = {
        clientId: input.clientId,
        displayName: typeof input.displayName === 'string' && input.displayName.trim() ? input.displayName.trim() : 'Another user',
        expiresAt: Date.now() + LEASE_DURATION_MS,
      }
      canvasLeases.set(parts[2], nextLease)
      scheduleLeaseExpiry(parts[2], nextLease)
      broadcastLease(parts[2])
      return json({ lease: nextLease })
    }

    if (method === 'DELETE' && parts[1] === 'canvases' && parts[2] && parts[3] === 'presence' && parts.length === 4) {
      const clientId = url.searchParams.get('clientId')
      if (currentLease(parts[2])?.clientId === clientId) {
        canvasLeases.delete(parts[2])
        clearTimeout(leaseExpiryTimers.get(parts[2]))
        leaseExpiryTimers.delete(parts[2])
        broadcastLease(parts[2])
      }
      return json(null, 204)
    }

    if (method === 'GET' && parts[1] === 'canvases' && parts[2] && parts[3] === 'sessions' && parts.length === 4) {
      const canvas = canvasById(parts[2])
      if (!canvas) return json({ error: 'Canvas not found' }, 404)
      let sessions = state.sessions.filter((session) => session.canvasId === canvas.id)
      if (!sessions.length) {
        const session = createInitialSession(canvas)
        state.sessions.push(session)
        await store.persist(['sessions'])
        sessions = [session]
      }
      return json(sessions)
    }

    if (method === 'POST' && parts[1] === 'canvases' && parts[2] && parts[3] === 'sessions' && parts.length === 4) {
      const canvas = canvasById(parts[2])
      if (!canvas) return json({ error: 'Canvas not found' }, 404)
      const session = createSession(canvas)
      state.sessions.push(session)
      await store.persist(['sessions'])
      return json(session, 201)
    }

    // The canvas's event channel. One long-lived SSE per open canvas carries
    // every server-pushed event for it, so posting a turn is a plain 202 and a
    // second client watching the same canvas sees the same stream.
    if (method === 'GET' && parts[1] === 'canvases' && parts[2] && parts[3] === 'events' && parts.length === 4) {
      const canvas = canvasById(parts[2])
      if (!canvas) return json({ error: 'Canvas not found' }, 404)
      return sseResponse(canvas.id, request.signal, channels)
    }

    if (method === 'GET' && parts[1] === 'canvases' && parts[2] && parts[3] === 'assets' && parts.length === 4) {
      const canvas = canvasById(parts[2])
      if (!canvas) return json({ error: 'Canvas not found' }, 404)
      const entryNodeId = url.searchParams.get('entryNodeId')
      const assets = executionAssets(state.runs, {
        canvasId: canvas.id,
        executionId: url.searchParams.get('executionId'),
        nodeId: url.searchParams.get('producerNodeId'),
        kind: url.searchParams.get('kind'),
      }).filter((asset) => !entryNodeId || asset.entryNodeId === entryNodeId)
      return json(paginateAssets(assets, url))
    }

    if (method === 'GET' && parts[1] === 'sessions' && parts[2] && parts[3] === 'chat-history' && parts.length === 4) {
      const session = sessionById(parts[2])
      return session ? json(session) : json({ error: 'Session not found' }, 404)
    }

    if (method === 'GET' && parts[1] === 'sessions' && parts[2] && parts[3] === 'turns' && parts.length === 4) {
      const session = sessionById(parts[2])
      if (!session) return json({ error: 'Session not found' }, 404)
      const statuses = new Set((url.searchParams.get('status') || '').split(',').filter(Boolean))
      return json(state.turns.filter((turn) => turn.sessionId === session.id
        && (!statuses.size || statuses.has(turn.status))
        && (!['succeeded', 'failed', 'cancelled', 'cancelling'].includes(turn.status))
        && (activeTurnIds.has(turn.id) || turn.request)))
    }

    if (method === 'POST' && parts[1] === 'sessions' && parts[2] && parts[3] === 'turns' && parts.length === 4) {
      const input = await parseJson(request)
      if (typeof input.message !== 'string' || !input.message.trim()) return json({ error: 'message is required' }, 400)
      if (!config.deepseek.apiKey) {
        const error = new Error('DeepSeek is not configured. Set DEEPSEEK_API_KEY and restart the API server.')
        error.statusCode = 503
        throw error
      }
      const session = sessionById(parts[2])
      if (!session) return json({ error: 'Session not found' }, 404)
      const canvas = canvasById(session.canvasId)
      if (!canvas) {
        const error = new Error('Canvas not found')
        error.statusCode = 404
        throw error
      }
      const now = new Date().toISOString()
      const turn = {
        id: `turn-${randomUUID()}`,
        sessionId: session.id,
        canvasId: canvas.id,
        message: input.message,
        attachments: Array.isArray(input.attachments) ? input.attachments : [],
        status: 'queued',
        progress: [],
        createdAt: now,
        updatedAt: now,
      }
      const trace = createAgentTrace(turn, { model: config.deepseek.model, runtime: config.agentServiceUrl ? 'pi-service' : 'direct' }, now)
      turn.traceId = trace.id
      appendAgentTrace(trace, 'turn_created', { message: turn.message }, now)
      appendAgentTrace(trace, 'turn_queued', {}, now)
      state.turns.push(turn)
      state.agentTraces.push(trace)
      await store.persist(['turns', 'agentTraces'])
      waitUntil(startAgentTurn(context, turn))
      return json(turn, 202)
    }

    if (method === 'POST' && parts[1] === 'turns' && parts[3] === 'continue' && parts.length === 4) {
      const turn = turnById(parts[2])
      if (!turn) return json({ error: 'Turn not found' }, 404)
      const input = await parseJson(request)
      // The conversation message is the durable user-facing record. If a crash
      // persisted that message but not the turn's copy, use it to resume rather
      // than making the user start the conversation over.
      if (!turn.request) {
        const session = sessionById(turn.sessionId)
        const requestMessage = session?.messages.find((message) => message.turnId === turn.id && message.request && !message.selection)
        if (requestMessage) {
          turn.request = structuredClone(requestMessage.request)
          turn.requestMessageId = requestMessage.id
        }
      }
      const selectedOptionIds = input.selected_option_ids
      const existingSelection = turn.selection
      if (existingSelection) {
        if (input.request_id === existingSelection.request_id && Array.isArray(selectedOptionIds) && selectedOptionIds.length === existingSelection.selected_option_ids.length && selectedOptionIds.every((optionId, index) => optionId === existingSelection.selected_option_ids[index])) {
          return json(turn)
        }
        return json({ error: 'This selection was already submitted' }, 409)
      }
      if (!turn.request || input.request_id !== turn.request.request_id || ['succeeded', 'failed', 'cancelled', 'cancelling'].includes(turn.status)) return json({ error: 'Turn is not waiting for this selection' }, 409)
      if (!Array.isArray(selectedOptionIds) || selectedOptionIds.some((optionId) => typeof optionId !== 'string') || new Set(selectedOptionIds).size !== selectedOptionIds.length || selectedOptionIds.length < turn.request.min || selectedOptionIds.length > turn.request.max || selectedOptionIds.some((optionId) => !turn.request.options.some((option) => option.id === optionId))) {
        return json({ error: 'Selected options are invalid' }, 400)
      }
      await store.reload(AGENT_COLLECTIONS)
      const currentTurn = turnById(parts[2])
      const session = currentTurn && sessionById(currentTurn.sessionId)
      if (!currentTurn || !session || !canvasById(currentTurn.canvasId)) return json({ error: 'Turn not found' }, 404)
      // Re-checked after the reload: the turn on disk may have moved on since the
      // validation above, and its request may no longer be the one answered here.
      if (!currentTurn.request || input.request_id !== currentTurn.request.request_id || ['succeeded', 'failed', 'cancelled', 'cancelling'].includes(currentTurn.status)) return json({ error: 'Turn is not waiting for this selection' }, 409)
      currentTurn.selection = { request_id: currentTurn.request.request_id, selected_option_ids: selectedOptionIds }
      const trace = state.agentTraces.find((item) => item.turnId === currentTurn.id)
      if (trace) appendAgentTrace(trace, 'user_selection_received', currentTurn.selection)
      const requestMessage = session.messages.find((message) => message.id === currentTurn.requestMessageId)
      const selectedLabels = selectedOptionIds.map((optionId) => currentTurn.request.options.find((option) => option.id === optionId)?.label || optionId)
      if (requestMessage) {
        requestMessage.selection = currentTurn.selection
        session.messages.push({ id: `msg-${randomUUID()}`, role: 'user', content: selectedLabels.join(', '), turnId: currentTurn.id, selection: currentTurn.selection, createdAt: new Date().toISOString() })
        session.updatedAt = new Date().toISOString()
      }
      currentTurn.status = 'queued'
      currentTurn.updatedAt = new Date().toISOString()
      await store.persist(['sessions', 'turns', 'agentTraces'])
      waitUntil(enqueueAgentTurn(context, currentTurn))
      return json(currentTurn, 202)
    }

    if (method === 'POST' && parts[1] === 'turns' && parts[3] === 'cancel' && parts.length === 4) {
      await store.reload(['turns'])
      const turn = turnById(parts[2])
      if (!turn || !canvasById(turn.canvasId)) return json({ error: 'Turn not found' }, 404)
      if (['succeeded', 'failed', 'cancelled'].includes(turn.status)) return json(turn)
      turn.status = 'cancelling'
      turn.updatedAt = new Date().toISOString()
      const trace = state.agentTraces.find((item) => item.turnId === turn.id)
      if (trace) appendAgentTrace(trace, 'turn_cancel_requested')
      await store.persist(['turns', 'agentTraces'])
      try {
        await activeTurnCancels.get(turn.id)?.()
      } catch (error) {
        turn.status = 'running'
        turn.updatedAt = new Date().toISOString()
        await store.persist(['turns'])
        throw error
      }
      turn.status = 'cancelled'
      turn.completedAt = new Date().toISOString()
      turn.updatedAt = turn.completedAt
      if (trace) {
        trace.status = 'cancelled'
        trace.completedAt = turn.completedAt
        appendAgentTrace(trace, 'turn_cancelled')
      }
      await store.persist(['turns', 'agentTraces'])
      channels.broadcast(turn.canvasId, channels.event(turn, 'finish', { finish_reason: 'cancelled' }))
      return json(turn)
    }

    if (method === 'GET' && parts[1] === 'executions' && parts.length === 3) {
      const execution = executionById(state.runs, parts[2])
      return execution ? json(executionDto(execution)) : json({ error: 'Execution not found' }, 404)
    }

    if (method === 'GET' && parts[1] === 'canvases' && parts[2] && parts[3] === 'executions' && parts.length === 4) {
      const canvas = canvasById(parts[2])
      return canvas ? json(canvasExecutions(state.runs, canvas.id)) : json({ error: 'Canvas not found' }, 404)
    }

    if (method === 'GET' && parts[1] === 'tripo' && parts[2] === 'tasks' && parts[3] && parts[4] === 'download' && parts.length === 5) {
      if (!config.getTripoTask) return json({ error: 'Tripo is not configured.' }, 503)
      const taskId = parts[3]
      const ownsTask = state.runs.some((run) => Object.values(run.nodeRuns || {}).some((nodeRun) => nodeRun.tripoTaskId === taskId || nodeRun.output?.tripoTaskId === taskId))
      if (!ownsTask) return json({ error: 'Tripo task not found' }, 404)
      const task = await config.getTripoTask(taskId)
      const downloadUrl = task?.output?.model_url
      return downloadUrl
        ? new Response(null, { status: 302, headers: { location: downloadUrl, 'cache-control': 'no-store' } })
        : json({ error: 'Tripo task has no downloadable model' }, 404)
    }

    if (method === 'POST' && parts[1] === 'executions' && parts[2] && parts[3] === 'cancel' && parts.length === 4) {
      const execution = executionById(state.runs, parts[2])
      if (!execution) return json({ error: 'Execution not found' }, 404)
      cancelExecution(execution)
      await store.persist(['runs'])
      return json(executionDto(execution), 202)
    }

    if (method === 'POST' && parts[1] === 'canvases' && parts[2] && parts[3] === 'nodes' && parts[4] && parts[5] === 'executions' && parts.length === 6) {
      const canvas = canvasById(parts[2])
      if (!canvas) return json({ error: 'Canvas not found' }, 404)
      const node = canvas.nodes.find((candidate) => candidate.id === parts[4])
      if (!node) return json({ error: 'Node not found' }, 404)
      const { mode = 'downstream', provider: requestedProvider } = await parseJson(request)
      if (requestedProvider && !['mock', 'tripo'].includes(requestedProvider)) {
        return json({ error: 'provider must be "mock" or "tripo"' }, 400)
      }
      if (requestedProvider === 'tripo' && !config.createTripoProvider) {
        return json({ error: 'Tripo is not configured. Set TRIPO_API_KEY and restart the API server.' }, 503)
      }
      // Default to Tripo whenever it is configured; the debug panel sends an
      // explicit provider to force one side or the other.
      const useTripo = requestedProvider ? requestedProvider === 'tripo' : Boolean(config.createTripoProvider)
      const pending = createExecution(state.runs, canvas, node, mode)
      await store.persist(['runs'])
      waitUntil(executeExecution(
        state.runs,
        pending.run,
        canvas,
        pending.executionCanvas,
        pending.nodes,
        node,
        () => store.persist(['runs']),
        { createProvider: useTripo ? config.createTripoProvider : null },
      ).catch(console.error))
      return json(executionDto(pending.run), 202)
    }

    // Legacy assets from runs created before downloads switched to refreshed
    // Tripo task URLs remain readable, but new runs never write local files.
    if (method === 'POST' && parts[1] === 'assets' && parts.length === 2) {
      if (!config.uploadAsset) return json({ error: 'Asset uploads are unavailable' }, 503)
      const contentType = request.headers.get('content-type') || 'application/octet-stream'
      const bytes = new Uint8Array(await request.arrayBuffer())
      if (!bytes.length) return json({ error: 'Asset file is empty' }, 400)
      const url = await config.uploadAsset(bytes, contentType, request.headers.get('x-file-name') || '')
      return json({ url, contentType })
    }
    if (method === 'GET' && parts[1] === 'assets' && parts.length === 3) {
      const asset = config.readAsset ? await config.readAsset(parts[2]) : null
      if (!asset) return json({ error: 'Asset not found' }, 404)
      return new Response(asset.bytes, {
        headers: {
          'content-type': asset.contentType,
          'cache-control': 'public, max-age=31536000, immutable',
        },
      })
    }

    return json({ error: 'Not found' }, 404)
  }

  return async function handle(request, runtime = {}) {
    try {
      const context = await createContext(request, runtime)
      await recoverAgentTurns(context)
      return await route(request, context)
    } catch (error) {
      if (!error.statusCode) console.error(error)
      return json({ error: error.message }, error.statusCode || 500)
    }
  }
}
