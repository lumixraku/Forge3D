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
  assert.deepEqual(migrated.nodes, [{ id: 'split', type: 'segments', name: 'Segments', config: { detailLevel: 'low', preview: '/shark-model.png' } }])
  assert.equal(migrated.revision, 2)
  assert.equal(migrated.updatedAt, 'after')
  assert.equal(migrateWorkflow(migrated), migrated)
})

test('migrates legacy model options and fills new defaults once', () => {
  const workflow = {
    revision: 1,
    updatedAt: 'before',
    nodes: [{ id: 'model', type: 'generate-model', name: 'Gen HD Model', config: { modelVersion: 'Smart Mesh', geometryQuality: 'detailed', faceType: 'Quad', faceCount: 30000 } }],
    edges: [],
  }

  const migrated = migrateWorkflow(workflow, () => 'after')
  assert.equal(migrated.nodes[0].config.modelVersion, 'v3.1-20260211')
  assert.equal(migrated.nodes[0].config.geometryQuality, true)
  assert.equal(migrated.nodes[0].config.aiComplete, false)
  assert.equal(migrated.nodes[0].config.textureQuality, 'extreme')
  assert.equal(migrated.nodes[0].config.topology, 'quad')
  assert.equal(migrated.revision, 2)
  assert.equal(migrated.updatedAt, 'after')
  assert.equal(migrateWorkflow(migrated), migrated)
})
