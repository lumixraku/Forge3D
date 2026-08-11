import assert from 'node:assert/strict'
import test from 'node:test'
import { createTripoRunner } from './tripo-run.js'

test('does not turn a successful Tripo task into a failure when local caching times out', async () => {
  const responses = [
    { task_id: 'task-1' },
    {
      task_id: 'task-1',
      status: 'success',
      progress: 100,
      output: { model_url: 'https://cdn.tripo3d.ai/model.glb', rendered_image_url: 'https://cdn.tripo3d.ai/preview.webp' },
    },
  ]
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ code: 0, data: responses.shift() }), {
    headers: { 'content-type': 'application/json' },
  })
  try {
    const createProvider = createTripoRunner({ TRIPO_API_KEY: 'test-key' }, {
      persistAsset: async () => { throw new Error('The operation was aborted due to timeout') },
    })
    const run = { nodeRuns: { model: { status: 'running' } } }
    const provider = createProvider({ context: new Map(), run, onUpdate: async () => {} })
    const node = { id: 'model', type: 'generate-model', name: 'Model', config: { prompt: 'shark' } }

    const result = await provider(node, { nodes: [node], edges: [] })

    assert.equal(result.status, 'succeeded')
    assert.equal(result.tripoTaskId, 'task-1')
    assert.equal(result.output.modelUrl, 'https://cdn.tripo3d.ai/model.glb')
  } finally {
    globalThis.fetch = originalFetch
  }
})
