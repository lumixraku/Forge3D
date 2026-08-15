import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { createApi } from './api-core.js'

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve(`http://127.0.0.1:${address.port}`)
    })
  })
}

test('persists trace callbacks before the terminal turn status', async (t) => {
  const service = createServer(async (request, response) => {
    if (request.url === '/coordinator') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ tasks: [{ title: 'Research', message: 'Research GLB', kind: 'general' }] }))
      return
    }
    if (request.url === '/agent') {
      response.writeHead(200, { 'content-type': 'application/x-ndjson' })
      response.write(`${JSON.stringify({ type: 'trace', event: { type: 'model_response_received', payload: { status: 200 } } })}\n`)
      response.write(`${JSON.stringify({ type: 'checkpoint', checkpoint: { phase: 'tool_complete', round: 1 } })}\n`)
      response.end(`${JSON.stringify({ type: 'result', plan: { reply: 'GLB result', changedNodeIds: [], structureChanged: false } })}\n`)
      return
    }
    if (request.url === '/coordinator/summarize') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ reply: 'Summary' }))
      return
    }
    response.writeHead(404).end()
  })
  const serviceUrl = await listen(service)
  t.after(() => service.close())

  const state = {
    canvases: [{ id: 'canvas-1', revision: 1, nodes: [], edges: [] }],
    sessions: [{ id: 'session-1', canvasId: 'canvas-1', messages: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
    turns: [],
    agentTraces: [],
    runs: [],
    accounts: [{ id: 'demo-user', name: 'Demo User', balance: 1000 }],
    creditLedger: [],
  }
  let persisted = structuredClone(state)
  const background = []
  const context = {
    store: {
      state,
      persist: async (collections) => {
        for (const collection of collections) persisted[collection] = structuredClone(state[collection])
      },
      reload: async (collections) => {
        for (const collection of collections) state[collection] = structuredClone(persisted[collection])
      },
      removeCanvas: async () => {},
    },
    config: {
      agentServiceUrl: `${serviceUrl}/agent`,
      deepseek: { apiKey: 'test-key', model: 'deepseek-chat' },
      createTripoProvider: null,
      getTripoTask: null,
      readAsset: null,
      uploadAsset: null,
    },
    waitUntil: (promise) => background.push(promise),
    recoverAgentTurns: false,
  }
  const handle = createApi({ createContext: () => context })

  const response = await handle(new Request('https://forge.test/api/sessions/session-1/turns', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'Research GLB' }),
  }))
  assert.equal(response.status, 202)
  await Promise.all(background)

  const worker = persisted.turns.find((turn) => turn.kind === 'general')
  const coordinator = persisted.turns.find((turn) => turn.kind === 'coordinator')
  const trace = persisted.agentTraces.find((item) => item.turnId === worker.id)
  assert.equal(worker.status, 'succeeded')
  assert.equal(coordinator.status, 'succeeded')
  assert.equal(trace.status, 'succeeded')
  assert.equal(trace.checkpoint.phase, 'tool_complete')
  assert.deepEqual(trace.events.map((event) => event.type), [
    'turn_created',
    'turn_queued',
    'turn_started',
    'model_response_received',
    'turn_succeeded',
  ])
})

test('recovers a waiting coordinator after its workers have completed', async (t) => {
  const service = createServer(async (request, response) => {
    if (request.url === '/coordinator/summarize') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ reply: 'Recovered summary' }))
      return
    }
    response.writeHead(404).end()
  })
  const serviceUrl = await listen(service)
  t.after(() => service.close())

  const worker = {
    id: 'turn-worker', groupId: 'group-1', title: 'Research', kind: 'general', sessionId: 'session-1', canvasId: 'canvas-1',
    message: 'Research GLB', originalMessage: 'Research GLB', status: 'succeeded', progress: [], result: { reply: 'Worker result' },
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:01.000Z',
  }
  const coordinator = {
    id: 'turn-coordinator', groupId: 'group-1', title: 'Coordinator summary', kind: 'coordinator', sessionId: 'session-1', canvasId: 'canvas-1',
    message: 'Research GLB', originalMessage: 'Research GLB', status: 'waiting', progress: [], dependencies: [worker.id],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }
  const state = {
    canvases: [{ id: 'canvas-1', revision: 1, nodes: [], edges: [] }],
    sessions: [{ id: 'session-1', canvasId: 'canvas-1', messages: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
    turns: [worker, coordinator], agentTraces: [], runs: [], accounts: [], creditLedger: [],
  }
  const background = []
  const context = {
    store: { state, persist: async () => {}, reload: async () => {}, removeCanvas: async () => {} },
    config: { agentServiceUrl: `${serviceUrl}/agent`, deepseek: { apiKey: 'test-key' } },
    waitUntil: (promise) => background.push(promise),
    recoverAgentTurns: true,
  }
  const handle = createApi({ createContext: () => context })

  const response = await handle(new Request('https://forge.test/api/capabilities'))
  assert.equal(response.status, 200)
  await Promise.all(background)

  assert.equal(coordinator.status, 'succeeded')
  assert.equal(coordinator.result.reply, 'Recovered summary')
  assert.equal(state.sessions[0].messages.at(-1).content, 'Recovered summary')
})
