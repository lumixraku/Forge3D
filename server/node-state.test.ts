import assert from 'node:assert/strict'
import test from 'node:test'
import { latestNodeRuns } from './node-state.js'

const canvas = {
  id: 'canvas-test',
  revision: 2,
  nodes: [{ id: 'text-to-3d' }, { id: 'retopology' }],
}

test('restores the latest persisted state for every canvas node', () => {
  const textTo3d = { status: 'succeeded', durationMs: 650, output: { preview: '/model.png' }, error: null }
  const retopology = { status: 'succeeded', durationMs: 650, output: { preview: '/retopo.png' }, error: null }
  const runs = [
    { canvasId: 'canvas-test', canvasRevision: 2, nodeRuns: { 'text-to-3d': textTo3d } },
    { canvasId: 'canvas-test', canvasRevision: 2, nodeRuns: { retopology } },
  ]

  assert.deepEqual(latestNodeRuns(canvas, runs), { 'text-to-3d': textTo3d, retopology })
})

test('keeps only the newest state for a node', () => {
  const runs = [
    { canvasId: 'canvas-test', canvasRevision: 2, nodeRuns: { retopology: { status: 'succeeded', output: { preview: '/old.png' } } } },
    { canvasId: 'canvas-test', canvasRevision: 2, nodeRuns: { retopology: { status: 'failed', output: null, error: 'failed' } } },
  ]

  assert.deepEqual(latestNodeRuns(canvas, runs).retopology, { status: 'failed', output: null, error: 'failed' })
})

test('ignores other canvases, revisions, and deleted nodes', () => {
  const runs = [
    { canvasId: 'other', canvasRevision: 2, nodeRuns: { retopology: { status: 'failed' } } },
    { canvasId: 'canvas-test', canvasRevision: 1, nodeRuns: { retopology: { status: 'failed' } } },
    { canvasId: 'canvas-test', canvasRevision: 2, nodeRuns: { deleted: { status: 'succeeded' } } },
  ]

  assert.deepEqual(latestNodeRuns(canvas, runs), {})
})
