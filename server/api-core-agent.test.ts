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

async function createAgentApi(t, plans, canvas = { id: 'canvas-1', revision: 1, nodes: [], edges: [] }) {
  let calls = 0
  const service = createServer(async (request, response) => {
    if (request.url !== '/agent') return response.writeHead(404).end()
    const plan = plans[calls++]
    response.writeHead(200, { 'content-type': 'application/x-ndjson' })
    response.end(`${JSON.stringify({ type: 'result', plan })}\n`)
  })
  const serviceUrl = await listen(service)
  t.after(() => service.close())
  const state = {
    canvases: [canvas],
    sessions: [{ id: 'session-1', canvasId: canvas.id, messages: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
    turns: [], agentTraces: [], runs: [],
    accounts: [{ id: 'demo-user', name: 'Demo User', balance: 1000 }], creditLedger: [],
  }
  let persisted = structuredClone(state)
  const background = []
  const context = {
    store: {
      state,
      persist: async (collections) => { for (const collection of collections) persisted[collection] = structuredClone(state[collection]) },
      reload: async (collections) => { for (const collection of collections) state[collection] = structuredClone(persisted[collection]) },
      removeCanvas: async () => {},
    },
    config: { agentServiceUrl: `${serviceUrl}/agent`, deepseek: { apiKey: 'test-key', model: 'deepseek-chat' }, createTripoProvider: null, getTripoTask: null, readAsset: null, uploadAsset: null },
    waitUntil: (promise) => background.push(promise), recoverAgentTurns: false,
  }
  return { handle: createApi({ createContext: () => context }), state, persisted: () => persisted, background, calls: () => calls }
}

test('persists trace callbacks before the terminal turn status', async (t) => {
  const service = createServer(async (request, response) => {
    if (request.url === '/agent') {
      response.writeHead(200, { 'content-type': 'application/x-ndjson' })
      response.write(`${JSON.stringify({ type: 'trace', event: { type: 'model_response_received', payload: { status: 200 } } })}\n`)
      response.write(`${JSON.stringify({ type: 'checkpoint', checkpoint: { phase: 'tool_complete', round: 1 } })}\n`)
      response.end(`${JSON.stringify({ type: 'result', plan: { reply: 'GLB result', changedNodeIds: [], structureChanged: false } })}\n`)
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

  const turn = persisted.turns[0]
  const trace = persisted.agentTraces.find((item) => item.turnId === turn.id)
  assert.equal(turn.status, 'succeeded')
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

test('runs one agent turn and persists its generated canvas without coordinator metadata', async (t) => {
  const canvas = { id: 'canvas-1', revision: 1, nodes: [], edges: [] }
  const generated = {
    ...canvas,
    revision: 2,
    nodes: [{ id: 'prompt', type: 'prompt', name: 'Text Prompt', position: { x: 0, y: 0 }, config: { prompt: 'orange robot' } }],
    edges: [],
  }
  const api = await createAgentApi(t, [{ canvas: generated, reply: 'Created the workflow.', changedNodeIds: ['prompt'], structureChanged: true }], canvas)
  const response = await api.handle(new Request('https://forge.test/api/sessions/session-1/turns', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Create an orange robot workflow' }) }))
  assert.equal(response.status, 202)
  const created = await response.json()
  assert.equal(created.status, 'queued')
  assert.equal(created.kind, undefined)
  await Promise.all(api.background)

  const persisted = api.persisted()
  assert.equal(api.calls(), 1)
  assert.equal(persisted.turns.length, 1)
  assert.equal(persisted.turns[0].status, 'succeeded')
  assert.equal(persisted.canvases[0].nodes[0].config.prompt, 'orange robot')
  assert.equal(persisted.sessions[0].messages.at(-1).content, 'Created the workflow.')
})

test('parks and resumes one turn after a user selection', async (t) => {
  const canvas = { id: 'canvas-1', revision: 1, nodes: [], edges: [] }
  const api = await createAgentApi(t, [
    { canvas, reply: '', changedNodeIds: [], structureChanged: false, userSelectionRequest: { prompt: 'Choose a format', options: [{ id: 'glb', label: 'GLB' }], min: 1, max: 1 } },
    { canvas: { ...canvas, revision: 2 }, reply: 'Configured GLB export.', changedNodeIds: [], structureChanged: false },
  ], canvas)
  await api.handle(new Request('https://forge.test/api/sessions/session-1/turns', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Create an export workflow' }) }))
  await Promise.all(api.background.splice(0))
  const parked = api.persisted().turns[0]
  assert.equal(parked.status, 'running')
  assert.equal(parked.request.options[0].id, 'glb')

  const response = await api.handle(new Request(`https://forge.test/api/turns/${parked.id}/continue`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ request_id: parked.request.request_id, selected_option_ids: ['glb'] }) }))
  assert.equal(response.status, 202)
  await Promise.all(api.background.splice(0))
  const persisted = api.persisted()
  assert.equal(api.calls(), 2)
  assert.equal(persisted.turns[0].status, 'succeeded')
  assert.equal(persisted.sessions[0].messages.at(-1).content, 'Configured GLB export.')
})
