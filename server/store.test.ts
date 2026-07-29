import assert from 'node:assert/strict'
import test from 'node:test'
import { migrateWorkflow } from './store.js'

test('migrates split nodes to segments once', () => {
  const workflow = {
    revision: 1,
    updatedAt: 'before',
    nodes: [{ id: 'split', type: 'split', name: 'Split', config: {} }],
    edges: [],
  }

  const migrated = migrateWorkflow(workflow, () => 'after')
  assert.deepEqual(migrated.nodes, [{ id: 'split', type: 'segments', name: 'Segments', config: {} }])
  assert.equal(migrated.revision, 2)
  assert.equal(migrated.updatedAt, 'after')
  assert.equal(migrateWorkflow(migrated), migrated)
})
