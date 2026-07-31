import assert from 'node:assert/strict'
import test from 'node:test'
import { recordNodeExecution } from './run-log.js'

const canvas = {
  id: 'canvas-1',
  revision: 3,
  nodes: [
    { id: 'generate-image', type: 'generate-image', name: 'Generate Image' },
    { id: 'model', type: 'text-to-3d', name: 'Text to 3D' },
  ],
}

const succeeded = { status: 'succeeded', durationMs: 650, output: { preview: '/model.png' } }

test('appends every node of one pass to a single run record', () => {
  const runs = []
  const first = recordNodeExecution(runs, { runId: null, canvas, node: canvas.nodes[0], result: succeeded, now: () => 'a' })
  recordNodeExecution(runs, { runId: first.id, canvas, node: canvas.nodes[1], result: succeeded, now: () => 'b' })

  assert.equal(runs.length, 1)
  assert.deepEqual(Object.keys(runs[0].nodeRuns), ['generate-image', 'model'])
  assert.equal(runs[0].canvasRevision, 3)
  assert.equal(runs[0].createdAt, 'a')
  assert.equal(runs[0].completedAt, 'b')
  assert.equal(runs[0].entryNodeId, 'generate-image')
  assert.equal(runs[0].entryNodeName, 'Generate Image')
})

test('keeps the requested entry node when downstream nodes are appended', () => {
  const runs = []
  const first = recordNodeExecution(runs, { runId: null, canvas, node: canvas.nodes[0], entryNode: canvas.nodes[0], mode: 'downstream', result: succeeded })
  recordNodeExecution(runs, { runId: first.id, canvas, node: canvas.nodes[1], entryNode: canvas.nodes[0], mode: 'downstream', result: succeeded })

  assert.equal(runs[0].entryNodeId, 'generate-image')
  assert.equal(runs[0].mode, 'downstream')
})

test('a pass without a run id starts its own record, so runs accumulate', () => {
  const runs = []
  recordNodeExecution(runs, { runId: null, canvas, node: canvas.nodes[0], result: succeeded, now: () => 'a' })
  recordNodeExecution(runs, { runId: null, canvas, node: canvas.nodes[0], result: succeeded, now: () => 'b' })

  assert.equal(runs.length, 2)
  assert.notEqual(runs[0].id, runs[1].id)
})

test('stores node identity and failures', () => {
  const runs = []
  recordNodeExecution(runs, { runId: null, canvas, node: canvas.nodes[1], result: { status: 'failed', durationMs: null, output: null, error: 'boom' }, now: () => 'a' })

  assert.deepEqual(runs[0].nodeRuns.model, { status: 'failed', nodeType: 'text-to-3d', nodeName: 'Text to 3D', durationMs: null, output: null, error: 'boom' })
  assert.equal(runs[0].status, 'failed')
})

test('a run stays running until every node has left the queue', () => {
  // The whole subgraph is queued up front, so recording the first node must not
  // report the run as finished: a client polling for a terminal status would stop
  // while the rest of the chain was still executing.
  const runs = [{
    id: 'run-1',
    canvasId: 'canvas-1',
    canvasRevision: 3,
    status: 'running',
    nodeRuns: {
      'generate-image': { status: 'queued' },
      model: { status: 'queued' },
    },
  }]

  recordNodeExecution(runs, { runId: 'run-1', canvas, node: canvas.nodes[0], result: succeeded })
  assert.equal(runs[0].status, 'running')

  recordNodeExecution(runs, { runId: 'run-1', canvas, node: canvas.nodes[1], result: succeeded })
  assert.equal(runs[0].status, 'succeeded')
})

test('a failure anywhere fails the run, even after a later node succeeds', () => {
  const runs = []
  const run = recordNodeExecution(runs, { runId: null, canvas, node: canvas.nodes[0], result: { status: 'failed', durationMs: null, output: null, error: 'boom' } })
  assert.equal(run.status, 'failed')

  recordNodeExecution(runs, { runId: run.id, canvas, node: canvas.nodes[1], result: succeeded })
  assert.equal(runs[0].status, 'failed')
})

test('a review checkpoint holds the run instead of completing it', () => {
  const runs = []
  const run = recordNodeExecution(runs, { runId: null, canvas, node: canvas.nodes[0], result: { status: 'waiting_review', durationMs: 10, output: null } })

  assert.equal(run.status, 'waiting_review')
})

test('re-running a node inside the same pass overwrites its entry', () => {
  const runs = []
  const run = recordNodeExecution(runs, { runId: null, canvas, node: canvas.nodes[0], result: { ...succeeded, output: { preview: '/old.png' } }, now: () => 'a' })
  recordNodeExecution(runs, { runId: run.id, canvas, node: canvas.nodes[0], result: { ...succeeded, output: { preview: '/new.png' } }, now: () => 'b' })

  assert.equal(runs.length, 1)
  assert.deepEqual(runs[0].nodeRuns['generate-image'].output, { preview: '/new.png' })
})
