import assert from 'node:assert/strict'
import test from 'node:test'
import { latestNodeRuns } from './node-state.js'

const workflow = {
  id: 'wf-test',
  revision: 2,
  nodes: [{ id: 'text-to-3d' }, { id: 'retopology' }],
}

test('restores the latest persisted state for every workflow node', () => {
  const textTo3d = { status: 'succeeded', durationMs: 650, output: { preview: '/model.png' }, error: null }
  const retopology = { status: 'succeeded', durationMs: 650, output: { preview: '/retopo.png' }, error: null }
  const runs = [
    { workflowId: 'wf-test', workflowRevision: 2, nodeRuns: { 'text-to-3d': textTo3d } },
    { workflowId: 'wf-test', workflowRevision: 2, nodeRuns: { retopology } },
  ]

  assert.deepEqual(latestNodeRuns(workflow, runs), { 'text-to-3d': textTo3d, retopology })
})

test('keeps only the newest state for a node', () => {
  const runs = [
    { workflowId: 'wf-test', workflowRevision: 2, nodeRuns: { retopology: { status: 'succeeded', output: { preview: '/old.png' } } } },
    { workflowId: 'wf-test', workflowRevision: 2, nodeRuns: { retopology: { status: 'failed', output: null, error: 'failed' } } },
  ]

  assert.deepEqual(latestNodeRuns(workflow, runs).retopology, { status: 'failed', output: null, error: 'failed' })
})

test('ignores other workflows, revisions, and deleted nodes', () => {
  const runs = [
    { workflowId: 'other', workflowRevision: 2, nodeRuns: { retopology: { status: 'failed' } } },
    { workflowId: 'wf-test', workflowRevision: 1, nodeRuns: { retopology: { status: 'failed' } } },
    { workflowId: 'wf-test', workflowRevision: 2, nodeRuns: { deleted: { status: 'succeeded' } } },
  ]

  assert.deepEqual(latestNodeRuns(workflow, runs), {})
})
