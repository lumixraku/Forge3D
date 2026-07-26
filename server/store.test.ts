import assert from 'node:assert/strict'
import test from 'node:test'
import { migrateWorkflow } from './store.js'

test('migrates retired delivery nodes and preview background once', () => {
  const workflow = {
    revision: 3,
    updatedAt: 'before',
    description: 'Generate, optimize, texture, review, save, and export a production-ready 3D asset.',
    nodes: [
      { id: 'texture', type: 'texture', config: {} },
      { id: 'preview', type: 'model-preview', config: { environment: 'Studio', background: '#521cf2' } },
      { id: 'save', type: 'save-asset', config: {} },
      { id: 'export', type: 'export-model', config: {} },
    ],
    edges: [
      { source: { nodeId: 'texture' }, target: { nodeId: 'preview' } },
      { source: { nodeId: 'preview' }, target: { nodeId: 'save' } },
      { source: { nodeId: 'save' }, target: { nodeId: 'export' } },
    ],
  }

  const migrated = migrateWorkflow(workflow, () => 'after')
  assert.deepEqual(migrated.nodes.map((node) => node.id), ['texture', 'preview', 'export'])
  assert.equal(migrated.nodes[1].type, 'export-model')
  assert.deepEqual(migrated.nodes[1].config, { format: 'GLB' })
  assert.equal(migrated.edges.length, 1)
  assert.equal(migrated.description, 'Generate, optimize, texture, and review a production-ready 3D asset.')
  assert.equal(migrated.revision, 4)
  assert.equal(migrated.updatedAt, 'after')
  assert.equal(migrateWorkflow(migrated), migrated)
})
