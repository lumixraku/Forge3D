import test from 'node:test'
import assert from 'node:assert/strict'
import { createFragment } from './fragments.js'

test('creates a portable workflow fragment', () => {
  const fragment = createFragment({
    name: 'Model finishing',
    nodes: [
      { id: 'mesh', type: 'retopology', name: 'Retopology', config: {}, ui: { position: { x: 0, y: 0 } } },
      { id: 'material', type: 'texture', name: 'Texture', config: {}, ui: { position: { x: 310, y: 0 } } },
    ],
    edges: [{ id: 'mesh-material', source: { nodeId: 'mesh', port: 'model' }, target: { nodeId: 'material', port: 'model' } }],
    interface: { inputs: [{ nodeId: 'mesh', port: 'model' }], outputs: [{ nodeId: 'material', port: 'model' }] },
  })
  assert.equal(fragment.kind, 'workflow-fragment')
  assert.equal(fragment.schemaVersion, '1.0')
  assert.equal(fragment.nodes.length, 2)
  assert.equal(fragment.shareId.length, 16)
})

test('rejects edges that leave a fragment', () => {
  assert.throws(() => createFragment({
    name: 'Invalid',
    nodes: [{ id: 'inside', type: 'prompt', name: 'Prompt', config: {}, ui: { position: { x: 0, y: 0 } } }],
    edges: [{ id: 'outside', source: { nodeId: 'inside', port: 'prompt' }, target: { nodeId: 'outside', port: 'prompt' } }],
  }), /inside the fragment/)
})

test('rejects malformed and incompatible fragments', () => {
  assert.throws(() => createFragment({
    schemaVersion: '2.0',
    name: 'Future fragment',
    nodes: [{ id: 'prompt', type: 'prompt', name: 'Prompt', config: {}, ui: { position: { x: 0, y: 0 } } }],
  }), /schema version/)
  assert.throws(() => createFragment({ name: 'Broken', nodes: [{ id: 'prompt' }] }), /nodes are invalid/)
  assert.throws(() => createFragment({
    name: 'Broken interface',
    nodes: [{ id: 'prompt', type: 'prompt', name: 'Prompt', config: {}, ui: { position: { x: 0, y: 0 } } }],
    interface: { inputs: [{ nodeId: 'missing', port: 'prompt' }], outputs: [] },
  }), /interface is invalid/)
})

test('always generates server-owned identifiers', () => {
  const fragment = createFragment({
    id: 'caller-id',
    shareId: 'caller-share-id',
    createdAt: '2000-01-01T00:00:00.000Z',
    name: 'Portable fragment',
    nodes: [{ id: 'prompt', type: 'prompt', name: 'Prompt', config: {}, ui: { position: { x: 0, y: 0 } } }],
  })
  assert.notEqual(fragment.id, 'caller-id')
  assert.notEqual(fragment.shareId, 'caller-share-id')
  assert.notEqual(fragment.createdAt, '2000-01-01T00:00:00.000Z')
})
