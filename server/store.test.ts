import assert from 'node:assert/strict'
import test from 'node:test'
import { migrateCanvas } from './store.js'

test('migrates split nodes to segments once', () => {
  const canvas = {
    revision: 1,
    updatedAt: 'before',
    nodes: [{ id: 'split', type: 'split', name: 'Split', config: {} }],
    edges: [],
  }

  const migrated = migrateCanvas(canvas, () => 'after')
  assert.deepEqual(migrated.nodes, [{ id: 'split', type: 'segments', name: 'Segments', config: { detailLevel: 'low', preview: '/shark-model.png' } }])
  assert.equal(migrated.revision, 2)
  assert.equal(migrated.updatedAt, 'after')
  assert.equal(migrateCanvas(migrated), migrated)
})

test('migrates legacy model options and fills new defaults once', () => {
  const canvas = {
    revision: 1,
    updatedAt: 'before',
    nodes: [{ id: 'model', type: 'generate-model', name: 'Gen HD Model', config: { modelVersion: 'Smart Mesh', geometryQuality: 'detailed', faceType: 'Quad', faceCount: 30000 } }],
    edges: [],
  }

  const migrated = migrateCanvas(canvas, () => 'after')
  assert.equal(migrated.nodes[0].config.modelVersion, 'v3.1-20260211')
  assert.equal(migrated.nodes[0].config.geometryQuality, true)
  assert.equal(migrated.nodes[0].config.aiComplete, false)
  assert.equal(migrated.nodes[0].config.textureQuality, 'extreme')
  assert.equal(migrated.nodes[0].config.topology, 'quad')
  assert.equal(migrated.revision, 2)
  assert.equal(migrated.updatedAt, 'after')
  assert.equal(migrateCanvas(migrated), migrated)
})
