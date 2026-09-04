import test from 'node:test'
import assert from 'node:assert/strict'
import { executeMeshyNode } from './meshy-provider.js'

// A client that records what it was asked to do, so input resolution can be
// asserted without touching the network. Each createTask answers a fresh id and
// awaitTask succeeds immediately.
function stubClient() {
  const calls = { tasks: [] }
  return {
    calls,
    async createTask(endpoint, body) {
      calls.tasks.push({ endpoint, body })
      return `task_${calls.tasks.length}`
    },
    async awaitTask(endpoint, taskId) {
      return { id: taskId, status: 'SUCCEEDED', consumed_credits: 30, thumbnail_url: 'https://cdn/p.png', model_urls: { glb: 'https://cdn/m.glb' } }
    },
  }
}

function canvasOf(nodes, edges) {
  return {
    id: 'canvas-1',
    revision: 1,
    nodes,
    edges: edges.map(([from, to]) => ({ id: `e-${from}-${to}`, source: { nodeId: from, port: 'output' }, target: { nodeId: to, port: 'input' } })),
  }
}

// An uploaded asset is input the user gave, so its URL is a config field.
const REFERENCE = { id: 'ref', type: 'reference-image', name: 'Ref', config: {}, uploadAssets: { assetType: 'image', assetUrl: '/shark-reference.png' } }
const MODEL = { id: 'model', type: 'generate-model', name: 'Model', config: { faceCount: 10000 } }

test('a node type Meshy does not back is left to the mock producer', async () => {
  const canvas = canvasOf([{ id: 'review', type: 'review', name: 'Check', config: {} }], [])
  const client = stubClient()
  assert.equal(await executeMeshyNode(canvas.nodes[0], canvas, { client }), null)
  assert.equal(client.calls.tasks.length, 0)
})

test('generate-model inlines the reference image as a data URI', async () => {
  const canvas = canvasOf([REFERENCE, MODEL], [['ref', 'model']])
  const client = stubClient()

  const result = await executeMeshyNode(MODEL, canvas, { client })

  assert.equal(result.status, 'succeeded')
  assert.equal(client.calls.tasks[0].endpoint, '/openapi/v1/image-to-3d')
  // Meshy has no upload endpoint: the bundled demo file is read off disk and
  // inlined, not handed over as a local path.
  assert.match(client.calls.tasks[0].body.image_url, /^data:image\/png;base64,/)
})

test('a public URL or data URI reference is passed through untouched', async () => {
  const remote = { ...REFERENCE, id: 'remote', uploadAssets: { assetType: 'image', assetUrl: 'https://cdn/remote.png' } }
  const inlined = { ...REFERENCE, id: 'inline', uploadAssets: { assetType: 'image', assetUrl: 'data:image/png;base64,aGVsbG8=' } }
  const modelA = { ...MODEL, id: 'model-a' }
  const modelB = { ...MODEL, id: 'model-b' }
  const canvas = canvasOf([remote, inlined, modelA, modelB], [['remote', 'model-a'], ['inline', 'model-b']])
  const client = stubClient()

  await executeMeshyNode(modelA, canvas, { client })
  await executeMeshyNode(modelB, canvas, { client })

  assert.equal(client.calls.tasks[0].body.image_url, 'https://cdn/remote.png')
  assert.equal(client.calls.tasks[1].body.image_url, 'data:image/png;base64,aGVsbG8=')
})

test('generate-model with labeled views sends an ordered multi-image list, front first', async () => {
  const views = { id: 'views', type: 'generate-multiview-images', name: 'Views', config: {}, generatedAssets: { viewPreviews: { front: 'https://cdn/front.png', back: 'https://cdn/back.png', left: 'https://cdn/left.png', right: 'https://cdn/right.png' } } }
  const model = { id: 'model', type: 'generate-model', name: 'Model', config: {} }
  const canvas = {
    id: 'canvas-1',
    revision: 1,
    nodes: [views, model],
    edges: ['front', 'back', 'left', 'right'].map((view) => ({ id: `e-${view}`, source: { nodeId: 'views', port: view }, target: { nodeId: 'model', port: view } })),
  }
  const client = stubClient()

  await executeMeshyNode(model, canvas, { client })

  assert.equal(client.calls.tasks[0].endpoint, '/openapi/v1/multi-image-to-3d')
  assert.deepEqual(client.calls.tasks[0].body.image_urls, [
    'https://cdn/front.png',
    'https://cdn/back.png',
    'https://cdn/left.png',
    'https://cdn/right.png',
  ])
})

test('a text prompt runs the two-step preview then refine flow', async () => {
  const model = { id: 'model', type: 'generate-model', name: 'Model', config: { prompt: 'a stylized shark' } }
  const canvas = canvasOf([model], [])
  const client = stubClient()

  const result = await executeMeshyNode(model, canvas, { client })

  assert.equal(client.calls.tasks.length, 2)
  assert.deepEqual(client.calls.tasks[0], { endpoint: '/openapi/v2/text-to-3d', body: { mode: 'preview', prompt: 'a stylized shark', ai_model: 'latest', target_formats: ['glb'] } })
  assert.equal(client.calls.tasks[1].endpoint, '/openapi/v2/text-to-3d')
  assert.equal(client.calls.tasks[1].body.mode, 'refine')
  assert.equal(client.calls.tasks[1].body.preview_task_id, 'task_1')
  // The result and the spend come from the refine task plus its preview.
  assert.equal(result.meshyTaskId, 'task_2')
  assert.equal(result.creditsConsumed, 60)
  assert.equal(result.output.modelUrl, 'https://cdn/m.glb')
  assert.equal(result.output.preview, 'https://cdn/p.png')
})

test('a text prompt without texture stops at the preview', async () => {
  const model = { id: 'model', type: 'generate-model', name: 'Model', config: { prompt: 'a stylized shark', texture: false } }
  const canvas = canvasOf([model], [])
  const client = stubClient()

  const result = await executeMeshyNode(model, canvas, { client })

  assert.equal(client.calls.tasks.length, 1)
  assert.equal(result.meshyTaskId, 'task_1')
  assert.equal(result.creditsConsumed, 30)
})

test('the two-step flow reports scaled progress under the refine task id', async () => {
  const model = { id: 'model', type: 'generate-model', name: 'Model', config: { prompt: 'a stylized shark' } }
  const canvas = canvasOf([model], [])
  const seen = []
  const client = {
    ...stubClient(),
    async awaitTask(endpoint, taskId, { onProgress }) {
      await onProgress({ status: 'IN_PROGRESS', progress: 40 })
      return { id: taskId, status: 'SUCCEEDED', consumed_credits: 10, thumbnail_url: 'https://cdn/p.png', model_urls: { glb: 'https://cdn/m.glb' } }
    },
  }

  await executeMeshyNode(model, canvas, { client, onProgress: async (event) => { seen.push(`${event.meshyTaskId}:${event.progress}`) } })

  // Preview progress spans 0-50 under the preview id, refine 50-100 under its own.
  assert.deepEqual(seen, ['task_1:0', 'task_1:20', 'task_2:50', 'task_2:70'])
})

test('a failed Meshy task fails the node run', async () => {
  const canvas = canvasOf([REFERENCE, MODEL], [['ref', 'model']])
  const client = {
    ...stubClient(),
    async awaitTask() { throw new Error('Meshy task FAILED: moderation rejected the image (task task_1).') },
  }

  await assert.rejects(executeMeshyNode(MODEL, canvas, { client }), /moderation rejected/)
})

test('a node with neither an image nor a prompt is refused before spending credits', async () => {
  const model = { id: 'model', type: 'generate-model', name: 'Model', config: { prompt: '' } }
  const canvas = canvasOf([model], [])
  const client = stubClient()

  await assert.rejects(executeMeshyNode(model, canvas, { client }), /needs an upstream image or a text prompt/)
  assert.equal(client.calls.tasks.length, 0)
})
