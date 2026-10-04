import assert from 'node:assert/strict'
import test from 'node:test'
import { createApi } from './api-core.js'
import { createMeshyRunner } from './meshy-run.js'

// API-level wiring for the Meshy provider: a real HTTP-ish path from
// POST /api/projects/:id/executions down to the Meshy client, with fetch
// stubbed so no network or key is involved.

const CANVAS = {
  id: 'canvas-1',
  provider: 'meshy',
  revision: 1,
  nodes: [{ id: 'gen', type: 'generate-model', name: 'Gen HD Model', config: { prompt: 'a stylized shark' } }],
  edges: [],
}

function stubMeshy(t) {
  const calls = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    const parsedUrl = new URL(url)
    const path = parsedUrl.pathname
    calls.push(`${options.method || 'GET'} ${path}`)
    if (parsedUrl.hostname === 'assets.meshy.ai') {
      return new Response(new Uint8Array([0x67, 0x6c, 0x54, 0x46]), { headers: { 'content-type': 'model/gltf-binary' } })
    }
    const reply = (body) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
    if (options.method === 'POST') {
      const mode = JSON.parse(options.body).mode
      return reply({ result: mode === 'refine' ? 'task_refine' : 'task_preview' })
    }
    const taskId = path.split('/').pop()
    return reply({
      id: taskId,
      status: 'SUCCEEDED',
      progress: 100,
      consumed_credits: taskId === 'task_refine' ? 10 : 5,
      thumbnail_url: 'https://cdn/preview.png',
      model_urls: { glb: 'https://cdn/model.glb' },
    })
  }
  t.after(() => { globalThis.fetch = originalFetch })
  return calls
}

function createTestApi(t, { withMeshy = true } = {}) {
  const calls = withMeshy ? stubMeshy(t) : null
  const state = {
    canvases: [structuredClone(CANVAS)],
    sessions: [],
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
    config: {
      agentServiceUrl: '',
      deepseek: {},
      createTripoProvider: null,
      createMeshyProvider: withMeshy ? createMeshyRunner({ MESHY_API_KEY: 'test-key', MESHY_BASE_URL: 'https://meshy.test' }) : null,
      getMeshyTask: withMeshy ? async (taskId) => ({ id: taskId, status: 'SUCCEEDED', model_urls: { glb: 'https://assets.meshy.ai/tasks/latest/model.glb?Signature=fresh' } }) : null,
      getTripoTask: null,
      readAsset: null,
      uploadAsset: null,
    },
    waitUntil: (promise) => background.push(promise),
    recoverAgentTurns: false,
  }
  return { handle: createApi({ createContext: () => context }), state, background, calls }
}

const post = (path, body) => new Request(`https://forge.test${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

const patch = (path, body) => new Request(`https://forge.test${path}`, {
  method: 'PATCH',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

test('capabilities report Meshy when its key is configured', async (t) => {
  const { handle } = createTestApi(t)
  const response = await handle(new Request('https://forge.test/api/capabilities'))
  const body = await response.json()
  assert.deepEqual(body.providers, { mock: true, tripo: false, meshy: true })
  // Tripo stays the default when both could be configured; alone, Meshy is it.
  assert.equal(body.defaultProvider, 'meshy')
  assert.deepEqual(body.meshyNodeTypes, ['generate-model', 'export-model'])
})

test('Meshy assets are streamed through the API for the interactive preview', async (t) => {
  const { handle } = createTestApi(t)
  const modelUrl = 'https://assets.meshy.ai/tasks/task-1/output/model.glb?Signature=signed'
  const response = await handle(new Request(`https://forge.test/api/meshy/assets?url=${encodeURIComponent(modelUrl)}`))

  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'model/gltf-binary')
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([0x67, 0x6c, 0x54, 0x46]))
})

test('the Meshy preview proxy rejects non-Meshy URLs', async (t) => {
  const { handle } = createTestApi(t)
  const response = await handle(new Request('https://forge.test/api/meshy/assets?url=https%3A%2F%2Fexample.com%2Fmodel.glb'))

  assert.equal(response.status, 400)
  assert.match((await response.json()).error, /Only Meshy asset URLs/)
})

test('a persisted Meshy task serves a fresh model URL after refresh', async (t) => {
  const { handle, state } = createTestApi(t)
  state.runs.push({
    id: 'run-meshy',
    canvasId: 'canvas-1',
    nodeRuns: {
      gen: {
        status: 'succeeded',
        meshyTaskId: 'task-1',
        meshyTaskEndpoint: '/openapi/v2/text-to-3d',
        output: { modelUrl: 'https://assets.meshy.ai/tasks/old/model.glb?Signature=expired' },
      },
    },
  })

  const response = await handle(new Request('https://forge.test/api/executions/run-meshy/nodes/gen/model'))

  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'model/gltf-binary')
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([0x67, 0x6c, 0x54, 0x46]))
})

test('an empty canvas can select any of the three API modes', async (t) => {
  const { handle, state } = createTestApi(t)
  state.canvases[0].nodes = []

  for (const provider of ['mock', 'tripo', 'meshy']) {
    const response = await handle(patch('/api/projects/canvas-1', { provider }))
    assert.equal(response.status, 200)
    assert.equal((await response.json()).provider, provider)
  }
})

test('a non-empty canvas keeps its selected API mode', async (t) => {
  const { handle } = createTestApi(t)

  const response = await handle(patch('/api/projects/canvas-1', { provider: 'mock' }))
  assert.equal(response.status, 409)
  assert.match((await response.json()).error, /cannot be changed after nodes are added/)
})

test('a meshy run executes generate-model end to end, preview then refine', async (t) => {
  const { handle, state, background, calls } = createTestApi(t)

  const created = await handle(post('/api/projects/canvas-1/executions', { entryNodeId: 'gen' }))
  assert.equal(created.status, 202)
  const responseBody = await created.json()
  assert.deepEqual(Object.keys(responseBody).sort(), [
    'canvasId', 'canvasRevision', 'completedAt', 'createdAt', 'durationMs', 'entryNodeId', 'entryNodeName',
    'executedNodeCount', 'id', 'input', 'mode', 'nodeExecutions', 'parameters', 'status',
  ])
  await Promise.all(background)

  // Preview create + poll, then refine create + poll.
  assert.deepEqual(calls, [
    'POST /openapi/v2/text-to-3d',
    'GET /openapi/v2/text-to-3d/task_preview',
    'POST /openapi/v2/text-to-3d',
    'GET /openapi/v2/text-to-3d/task_refine',
  ])

  const run = state.runs[0]
  assert.equal(run.status, 'succeeded')
  const nodeRun = run.nodeRuns.gen
  assert.equal(nodeRun.status, 'succeeded')
  assert.equal(nodeRun.meshyTaskId, 'task_refine')
  assert.equal(nodeRun.progress, 100)
  assert.equal(nodeRun.creditsConsumed, 15)
  assert.equal(nodeRun.output.modelUrl, 'https://cdn/model.glb')
  assert.equal(nodeRun.output.preview, 'https://cdn/preview.png')
})

test('the request body cannot override the canvas execution mode', async (t) => {
  const { handle, background, calls } = createTestApi(t)

  const created = await handle(post('/api/projects/canvas-1/executions', { entryNodeId: 'gen', provider: 'mock' }))
  assert.equal(created.status, 202)
  await Promise.all(background)

  assert.equal(calls.length, 4)
})

test('an unconfigured canvas provider is rejected before any credit moves', async (t) => {
  const { handle, state } = createTestApi(t, { withMeshy: false })

  const meshy = await handle(post('/api/projects/canvas-1/executions', { entryNodeId: 'gen' }))
  assert.equal(meshy.status, 503)
  assert.match((await meshy.json()).error, /Meshy is not configured/)

  assert.equal(state.runs.length, 0)
  assert.equal(state.accounts[0].balance, 1000)
})
