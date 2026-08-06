import assert from 'node:assert/strict'
import test from 'node:test'
import { cancelExecution, canvasExecutions, createExecution, executeExecution, executionDto, paginateAssets } from './executions.js'

const canvas = {
  id: 'canvas-1',
  revision: 4,
  nodes: [
    { id: 'entry', type: 'generate-image', name: 'Generate', config: { previews: ['/a.png'] } },
    { id: 'model', type: 'generate-model', name: 'Model', config: { preview: '/model.png' } },
    { id: 'other', type: 'generate-model', name: 'Other', config: {} },
  ],
  edges: [{ source: { nodeId: 'entry' }, target: { nodeId: 'model' } }],
}

test('creates one structured execution for an entry node and its downstream graph', async () => {
  const runs = []
  const pending = createExecution(runs, canvas, canvas.nodes[0], 'downstream')
  const queued = executionDto(pending.run)

  assert.equal(runs.length, 1)
  assert.equal(queued.status, 'queued')
  assert.equal(queued.entryNodeId, 'entry')
  assert.equal(queued.canvasId, 'canvas-1')
  assert.equal(queued.canvasRevision, 4)
  assert.equal(queued.mode, 'downstream')
  assert.deepEqual(Object.keys(queued.nodeExecutions), ['entry', 'model'])
  assert.equal(runs[0].entryNodeName, 'Generate')

  const execution = await executeExecution(runs, pending.run, canvas, pending.executionCanvas, pending.nodes, canvas.nodes[0])
  assert.equal(execution.status, 'succeeded')
  assert.equal(execution.executedNodeCount, 2)
})

test('execution dto exposes the canvas that produced the execution', () => {
  const run = { id: 'exec-1', canvasId: 'canvas-1', canvasRevision: 1, entryNodeId: 'entry', status: 'succeeded', createdAt: 'a', completedAt: 'a', nodeRuns: { entry: {} } }

  assert.equal(executionDto(run).canvasId, 'canvas-1')
})

test('lists a canvas execution history with the newest run first', () => {
  const runs = [
    { id: 'older', canvasId: 'canvas-1', status: 'succeeded', createdAt: '2026-08-05T10:00:00.000Z', nodeRuns: {} },
    { id: 'other-canvas', canvasId: 'canvas-2', status: 'succeeded', createdAt: '2026-08-06T10:00:00.000Z', nodeRuns: {} },
    { id: 'newer', canvasId: 'canvas-1', status: 'succeeded', createdAt: '2026-08-06T11:00:00.000Z', nodeRuns: {} },
  ]

  assert.deepEqual(canvasExecutions(runs, 'canvas-1').map((run) => run.id), ['newer', 'older'])
})

test('stopping an execution lets its current step finish and skips later steps', async () => {
  const runs = []
  const pending = createExecution(runs, canvas, canvas.nodes[0], 'downstream')
  const execution = await executeExecution(runs, pending.run, canvas, pending.executionCanvas, pending.nodes, canvas.nodes[0], async () => {
    if (pending.run.nodeRuns.entry.status === 'running') cancelExecution(pending.run)
  })

  assert.equal(execution.status, 'cancelled')
  assert.equal(execution.nodeExecutions.entry.status, 'succeeded')
  assert.equal(execution.nodeExecutions.model.status, 'skipped')
})

test('paginates assets with stable cursors', () => {
  const assets = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const first = paginateAssets(assets, new URL('https://example.com?limit=2'))
  const second = paginateAssets(assets, new URL(`https://example.com?limit=2&cursor=${first.nextCursor}`))

  assert.deepEqual(first, { items: assets.slice(0, 2), nextCursor: 'b', hasMore: true })
  assert.deepEqual(second, { items: assets.slice(2), nextCursor: null, hasMore: false })
})

test('re-running one node sees what an earlier run produced upstream', async () => {
  // A real backend reads upstream results from the run context, not the canvas.
  // Without seeding it from earlier runs, exporting a finished chain fails with
  // "needs an upstream 3D model".
  const runs = []
  const first = createExecution(runs, canvas, canvas.nodes[0], 'downstream')
  await executeExecution(runs, first.run, canvas, first.executionCanvas, first.nodes, canvas.nodes[0])
  runs[0].nodeRuns.model.output = { modelUrl: '/api/assets/aa.glb', preview: '/api/assets/bb.webp' }

  const seen = []
  const second = createExecution(runs, canvas, canvas.nodes[1], 'node')
  await executeExecution(runs, second.run, canvas, second.executionCanvas, second.nodes, canvas.nodes[1], async () => {}, {
    createProvider: ({ context }) => {
      seen.push(context.get('model'))
      return async () => null
    },
  })

  assert.deepEqual(seen[0], { tripoTaskId: null, modelUrl: '/api/assets/aa.glb', preview: '/api/assets/bb.webp' })
})

test('keeps a submitted Tripo task traceable on the recorded failure', async () => {
  const runs = []
  const pending = createExecution(runs, canvas, canvas.nodes[0], 'node')

  const execution = await executeExecution(runs, pending.run, canvas, pending.executionCanvas, pending.nodes, canvas.nodes[0], async () => {}, {
    createProvider: ({ run }) => async (node) => {
      run.nodeRuns[node.id].tripoTaskId = 'task_abc'
      run.nodeRuns[node.id].progress = 40
      throw new Error('Tripo task failed (task task_abc).')
    },
  })

  assert.equal(execution.status, 'failed')
  assert.equal(execution.nodeExecutions.entry.status, 'failed')
  assert.equal(execution.nodeExecutions.entry.tripoTaskId, 'task_abc')
  assert.equal(execution.nodeExecutions.entry.progress, 40)
})
