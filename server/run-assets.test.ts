import assert from 'node:assert/strict'
import test from 'node:test'
import { collectRunAssets, executionAssets, runHistory } from './run-assets.js'

function imageRun(id, createdAt, previews) {
  return {
    id,
    canvasId: 'canvas-1',
    canvasRevision: 2,
    status: 'succeeded',
    createdAt,
    completedAt: createdAt,
    nodeRuns: {
      'generate-image': { status: 'succeeded', nodeType: 'generate-image', nodeName: 'Generate Image', durationMs: 650, output: { previews }, error: null },
    },
  }
}

test('keeps every run as its own set of assets', () => {
  const runs = [
    imageRun('run-1', '2026-07-01T00:00:00.000Z', ['/a.png', '/b.png']),
    imageRun('run-2', '2026-07-02T00:00:00.000Z', ['/c.png']),
  ]

  const assets = collectRunAssets(runs, 'canvas-1')

  assert.equal(assets.length, 3)
  assert.deepEqual(assets.map((asset) => asset.runId), ['run-2', 'run-1', 'run-1'])
  assert.deepEqual(assets.map((asset) => asset.src), ['/c.png', '/a.png', '/b.png'])
  assert.deepEqual(assets.map((asset) => asset.id), ['run-2:generate-image:0', 'run-1:generate-image:0', 'run-1:generate-image:1'])
  assert.equal(assets[0].kind, 'image')
  assert.equal(assets[0].label, 'Generate Image')
  assert.equal(assets[0].executionId, 'run-2')
  assert.equal(assets[0].canvasId, 'canvas-1')
  assert.equal(assets[0].producerNodeId, 'generate-image')
})

test('filters structured assets by canvas, producer node, execution, and kind', () => {
  const runs = [
    imageRun('run-1', '2026-07-01T00:00:00.000Z', ['/a.png']),
    { ...imageRun('run-2', '2026-07-02T00:00:00.000Z', ['/b.png']), canvasId: 'canvas-2' },
  ]

  assert.deepEqual(executionAssets(runs, { canvasId: 'canvas-1', nodeId: 'generate-image', executionId: 'run-1', kind: 'image' }).map((asset) => asset.src), ['/a.png'])
  assert.deepEqual(executionAssets(runs, { canvasId: 'canvas-2' }).map((asset) => asset.src), ['/b.png'])
})

test('ignores other canvases and nodes that produced nothing', () => {
  const runs = [
    imageRun('run-1', '2026-07-01T00:00:00.000Z', ['/a.png']),
    { ...imageRun('run-2', '2026-07-02T00:00:00.000Z', ['/b.png']), canvasId: 'canvas-2' },
    {
      id: 'run-3',
      canvasId: 'canvas-1',
      canvasRevision: 2,
      status: 'running',
      createdAt: '2026-07-03T00:00:00.000Z',
      completedAt: null,
      nodeRuns: {
        prompt: { status: 'succeeded', nodeType: 'prompt', nodeName: 'Prompt', output: { message: 'Mock prompt result' }, error: null },
        pending: { status: 'queued', nodeType: 'text-to-3d', nodeName: 'Text to 3D', output: null, error: null },
      },
    },
  ]

  assert.deepEqual(collectRunAssets(runs, 'canvas-1').map((asset) => asset.src), ['/a.png'])
})

test('classifies references, multiview images, and models', () => {
  const runs = [{
    id: 'run-1',
    canvasId: 'canvas-1',
    canvasRevision: 1,
    status: 'succeeded',
    createdAt: '2026-07-01T00:00:00.000Z',
    completedAt: '2026-07-01T00:00:01.000Z',
    nodeRuns: {
      ref: { status: 'succeeded', nodeType: 'reference-image', nodeName: 'Reference', output: { image: '/ref.png', preview: '/ref.png' }, error: null },
      views: { status: 'succeeded', nodeType: 'generate-multiview-images', nodeName: 'Views', output: { viewPreviews: { front: '/front.png', back: '/back.png' } }, error: null },
      model: { status: 'succeeded', nodeType: 'text-to-3d', nodeName: 'Text to 3D', output: { preview: '/model.png' }, error: null },
    },
  }]

  const byKind = {}
  for (const asset of collectRunAssets(runs, 'canvas-1')) (byKind[asset.kind] ||= []).push(asset.src)

  assert.deepEqual(byKind, { reference: ['/ref.png'], image: ['/front.png', '/back.png'], model: ['/model.png'] })
})

test('carries export downloads and survives the node leaving the canvas', () => {
  const runs = [{
    id: 'run-1',
    canvasId: 'canvas-1',
    canvasRevision: 1,
    status: 'succeeded',
    createdAt: '2026-07-01T00:00:00.000Z',
    completedAt: '2026-07-01T00:00:01.000Z',
    nodeRuns: {
      'export-model': {
        status: 'succeeded',
        nodeType: 'export-model',
        nodeName: 'Export Model',
        output: { preview: '/shark-model.png', outputs: [{ downloadUrl: '/models/shark-gardener.glb', filename: 'shark-gardener.glb', format: 'gltf' }] },
        error: null,
      },
    },
  }]

  // The canvas no longer contains the node; the run record still identifies it.
  const [asset] = collectRunAssets(runs, 'canvas-1', { nodes: [] })

  assert.equal(asset.nodeType, 'export-model')
  assert.equal(asset.label, 'Export Model')
  assert.deepEqual(asset.downloads, [{ downloadUrl: '/models/shark-gardener.glb', filename: 'shark-gardener.glb', format: 'gltf' }])
})

test('falls back to the canvas node type for runs recorded without one', () => {
  const runs = [{
    id: 'run-legacy',
    canvasId: 'canvas-1',
    canvasRevision: 1,
    status: 'succeeded',
    createdAt: '2026-07-01T00:00:00.000Z',
    completedAt: '2026-07-01T00:00:01.000Z',
    nodeRuns: { model: { status: 'succeeded', durationMs: 650, output: { preview: '/model.png' }, error: null } },
  }]

  assert.deepEqual(collectRunAssets(runs, 'canvas-1', { nodes: [{ id: 'model', type: 'text-to-3d' }] }).map((asset) => asset.kind), ['model'])
  assert.deepEqual(collectRunAssets(runs, 'canvas-1'), [])
})

test('summarizes run history newest first', () => {
  const runs = [
    imageRun('run-1', '2026-07-01T00:00:00.000Z', ['/a.png']),
    imageRun('run-2', '2026-07-02T00:00:00.000Z', ['/b.png']),
  ]

  assert.deepEqual(runHistory(runs, 'canvas-1'), [
    { id: 'run-2', canvasId: 'canvas-1', canvasRevision: 2, status: 'succeeded', createdAt: '2026-07-02T00:00:00.000Z', completedAt: '2026-07-02T00:00:00.000Z', nodeCount: 1, durationMs: 650 },
    { id: 'run-1', canvasId: 'canvas-1', canvasRevision: 2, status: 'succeeded', createdAt: '2026-07-01T00:00:00.000Z', completedAt: '2026-07-01T00:00:00.000Z', nodeCount: 1, durationMs: 650 },
  ])
})
