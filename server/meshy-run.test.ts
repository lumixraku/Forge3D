import assert from 'node:assert/strict'
import test from 'node:test'
import { createMeshyRunner } from './meshy-run.js'

test('no provider is built without a key', () => {
  assert.equal(createMeshyRunner({}), null)
  assert.equal(createMeshyRunner({ MESHY_API_KEY: '' }), null)
})

test('a run through Meshy records the task id and progress on the node run', async () => {
  const responses = [
    { result: 'task-1' },
    { id: 'task-1', status: 'IN_PROGRESS', progress: 40 },
    {
      id: 'task-1',
      status: 'SUCCEEDED',
      progress: 100,
      consumed_credits: 30,
      thumbnail_url: 'https://cdn/preview.png',
      model_urls: { glb: 'https://cdn/model.glb' },
    },
  ]
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify(responses.shift()), {
    headers: { 'content-type': 'application/json' },
  })
  try {
    const createProvider = createMeshyRunner({ MESHY_API_KEY: 'test-key' })
    const run = { nodeRuns: { model: { status: 'running' } } }
    const provider = createProvider({ context: new Map(), run, onUpdate: async () => {} })
    const node = { id: 'model', type: 'generate-model', name: 'Model', config: { prompt: 'shark', texture: false } }

    const result = await provider(node, { nodes: [node], edges: [] })

    assert.equal(result.status, 'succeeded')
    assert.equal(result.meshyTaskId, 'task-1')
    assert.equal(result.output.modelUrl, 'https://cdn/model.glb')
    // The live progress landed on the node run while the task was mid-flight.
    assert.equal(run.nodeRuns.model.meshyTaskId, 'task-1')
    assert.equal(run.nodeRuns.model.progress, 100)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('a node Meshy does not back returns null and reports nothing', async () => {
  const createProvider = createMeshyRunner({ MESHY_API_KEY: 'test-key' })
  const run = { nodeRuns: { review: { status: 'running' } } }
  const provider = createProvider({ context: new Map(), run, onUpdate: async () => {} })
  const node = { id: 'review', type: 'review', name: 'Check', config: {} }

  assert.equal(await provider(node, { nodes: [node], edges: [] }), null)
  assert.deepEqual(run.nodeRuns.review, { status: 'running' })
})
