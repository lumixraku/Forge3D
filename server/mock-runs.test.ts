import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { downstreamCanvas, executeNode, executionNodes } from './mock-runs.js'

const canvas = {
  id: 'canvas-test',
  revision: 3,
  nodes: [
    { id: 'prompt', type: 'prompt', name: 'Text Prompt', config: {} },
    { id: 'model', type: 'text-to-3d', name: 'Text to 3D', config: { preview: '/model.png' } },
  ],
  edges: [
    { source: { nodeId: 'prompt' }, target: { nodeId: 'model' } },
  ],
}

const immediate = { wait: async () => {} }

test('executes one node and returns its runtime preview output', async () => {
  const result = await executeNode(canvas.nodes[1], canvas, immediate)

  assert.equal(result.nodeId, 'model')
  assert.equal(result.status, 'succeeded')
  assert.equal(typeof result.durationMs, 'number')
  assert.deepEqual(result.output, { message: 'Text to 3D generated', preview: '/model.png', modelUrl: '/models/shark-gardener.glb' })
})

test('derives execution order from canvas edges', () => {
  const reversed = { ...canvas, nodes: [...canvas.nodes].reverse() }
  assert.deepEqual(executionNodes(reversed).map((node) => node.id), ['model'])
})

test('treats four view connections as one execution dependency', () => {
  const multiviewCanvas = {
    ...canvas,
    nodes: [
      { id: 'views', type: 'generate-multiview-images', name: 'Views', config: {} },
      { id: 'model', type: 'multiview-to-3d', name: 'Model', config: {} },
    ],
    edges: ['front', 'back', 'left', 'right'].map((view) => ({ source: { nodeId: 'views', port: view }, target: { nodeId: 'model', port: view } })),
  }

  assert.deepEqual(executionNodes(multiviewCanvas).map((node) => node.id), ['views', 'model'])
})

test('emits four named views from a multiview generation', async () => {
  const multiviewCanvas = {
    ...canvas,
    nodes: [{
      id: 'views',
      type: 'generate-multiview-images',
      name: 'Generate Multi-view Images',
      config: { viewPreviews: { front: '/front.png', back: '/back.png', left: '/left.png', right: '/right.png' } },
    }],
    edges: [],
  }
  const result = await executeNode(multiviewCanvas.nodes[0], multiviewCanvas, immediate)

  assert.deepEqual(result.output.viewPreviews, {
    front: '/front.png', back: '/back.png', left: '/left.png', right: '/right.png',
  })
})

test('Gen HD Model automatically detects multiple upstream images', async () => {
  const multiviewCanvas = {
    ...canvas,
    nodes: [
      { id: 'views', type: 'generate-multiview-images', name: 'Views', config: { viewPreviews: { front: '/front.png', back: '/back.png', left: '/left.png', right: '/right.png' } } },
      { id: 'model', type: 'generate-model', name: 'Gen HD Model', config: { preview: '/model.png' } },
    ],
    edges: [{ source: { nodeId: 'views' }, target: { nodeId: 'model' } }],
  }
  const result = await executeNode(multiviewCanvas.nodes[1], multiviewCanvas, immediate)

  assert.equal(result.output.inputMode, 'multi-image')
  assert.deepEqual(result.output.inputImages, ['/front.png', '/back.png', '/left.png', '/right.png'])
  assert.equal(result.output.message, 'Gen HD Model generated from 4 images')
})

test('flows the selected candidate image downstream to a review node', async () => {
  const selectionCanvas = {
    ...canvas,
    nodes: [
      { id: 'concepts', type: 'generate-image', name: 'Image to Image', config: { previews: ['/a.png', '/b.png', '/c.png', '/d.png'], selectedPreview: '/c.png' } },
      { id: 'review', type: 'review', name: 'Human Review', config: { preview: '/fallback.png', approved: true } },
    ],
    edges: [{ source: { nodeId: 'concepts', port: 'image' }, target: { nodeId: 'review', port: 'image' } }],
  }

  const concepts = await executeNode(selectionCanvas.nodes[0], selectionCanvas, immediate)
  const review = await executeNode(selectionCanvas.nodes[1], selectionCanvas, immediate)

  assert.equal(concepts.output.image, '/c.png')
  assert.equal(review.output.preview, '/c.png')
})

test('holds at an unapproved review node without failing it', async () => {
  const pending = { ...canvas, nodes: [{ id: 'review', type: 'review', name: 'Human Review', config: { preview: '/a.png' } }], edges: [] }
  const result = await executeNode(pending.nodes[0], pending, immediate)

  assert.equal(result.status, 'waiting_review')
  assert.equal(result.output.message, 'Awaiting image approval')
})

test('executes every node of the seeded production pipeline', async () => {
  const [seedCanvas] = JSON.parse(await readFile(new URL('./seed/canvases.json', import.meta.url), 'utf8'))
  const order = executionNodes(seedCanvas)

  assert.deepEqual(order.map((node) => node.id), ['text-to-3d', 'retopology', 'texture', 'preview'])
  const results = []
  for (const node of order) results.push(await executeNode(node, seedCanvas, immediate))
  assert.ok(results.every((result) => result.status === 'succeeded'))
  assert.ok(results.every((result) => typeof result.durationMs === 'number'))
})

test('restricts a downstream run to the target and everything reachable from it', () => {
  const branchedCanvas = {
    ...canvas,
    nodes: [
      { id: 'preview', type: 'model-preview', name: 'Preview', config: {} },
      { id: 'texture', type: 'texture', name: 'Texture', config: {} },
      { id: 'model', type: 'text-to-3d', name: 'Text to 3D', config: {} },
      { id: 'prompt', type: 'prompt', name: 'Prompt', config: {} },
      { id: 'alternate', type: 'generate-image', name: 'Alternate', config: {} },
    ],
    edges: [
      { source: { nodeId: 'prompt' }, target: { nodeId: 'model' } },
      { source: { nodeId: 'model' }, target: { nodeId: 'texture' } },
      { source: { nodeId: 'texture' }, target: { nodeId: 'preview' } },
      { source: { nodeId: 'prompt' }, target: { nodeId: 'alternate' } },
    ],
  }

  assert.deepEqual(executionNodes(downstreamCanvas(branchedCanvas, 'model')).map((node) => node.id), ['model', 'texture', 'preview'])
})

test('throws a deterministic mocked node failure', async () => {
  const failingCanvas = structuredClone(canvas)
  failingCanvas.nodes[1].config.mockFailure = true

  await assert.rejects(() => executeNode(failingCanvas.nodes[1], failingCanvas, immediate), /execution failed/)
})
