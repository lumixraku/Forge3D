import assert from 'node:assert/strict'
import test from 'node:test'
import { createInitialConversation, createCanvas } from './canvases.js'

const node = (id, x = 0) => ({ id, type: 'prompt', name: id, config: {}, ui: { position: { x, y: 0 } } })

test('creates a canvas and initial conversation with server-owned fields', () => {
  const canvas = createCanvas({
    id: 'caller-id',
    revision: 99,
    createdAt: '2000-01-01T00:00:00.000Z',
    updatedAt: '2000-01-01T00:00:00.000Z',
    name: ' Selected canvas ',
    nodes: [node('a'), node('b', 300)],
    edges: [{ id: 'a-b', source: { nodeId: 'a', port: 'text' }, target: { nodeId: 'b', port: 'input' } }],
  })
  const conversation = createInitialConversation(canvas)

  assert.match(canvas.id, /^canvas-/)
  assert.notEqual(canvas.id, 'caller-id')
  assert.equal(canvas.name, 'Selected canvas')
  assert.equal(canvas.revision, 1)
  assert.notEqual(canvas.createdAt, '2000-01-01T00:00:00.000Z')
  assert.equal(canvas.updatedAt, canvas.createdAt)
  assert.equal(conversation.canvasId, canvas.id)
  assert.equal(conversation.messages.length, 1)
})

test('imports an exported canvas as a new canvas', () => {
  const exported = {
    schemaVersion: '1.0',
    id: 'canvas-exported',
    name: ' Exported canvas ',
    description: 'Portable canvas',
    revision: 9,
    createdAt: '2000-01-01T00:00:00.000Z',
    updatedAt: '2000-01-01T00:00:00.000Z',
    nodes: [node('a'), node('b', 300)],
    edges: [{ id: 'a-b', source: { nodeId: 'a', port: 'text' }, target: { nodeId: 'b', port: 'input' } }],
    viewport: { x: 80, y: 160, zoom: 0.72 },
  }
  const imported = createCanvas(exported)

  assert.notEqual(imported.id, exported.id)
  assert.equal(imported.name, 'Exported canvas')
  assert.equal(imported.description, exported.description)
  assert.equal(imported.revision, 1)
  assert.deepEqual(imported.nodes, exported.nodes)
  assert.deepEqual(imported.edges, exported.edges)
  assert.deepEqual(imported.viewport, exported.viewport)
})

test('requires a name and accepts an empty canvas', () => {
  assert.throws(() => createCanvas({ name: ' ', nodes: [node('a')] }), /name is required/)
  const canvas = createCanvas({ name: 'Empty', nodes: [], edges: [] })
  assert.deepEqual(canvas.nodes, [])
  assert.deepEqual(canvas.edges, [])
})

test('rejects duplicate node IDs and dangling edges', () => {
  assert.throws(() => createCanvas({ name: 'Duplicate', nodes: [node('a'), node('a')] }), /must be unique/)
  assert.throws(() => createCanvas({
    name: 'Dangling',
    nodes: [node('a')],
    edges: [{ id: 'a-missing', source: { nodeId: 'a', port: 'text' }, target: { nodeId: 'missing', port: 'input' } }],
  }), /inside the canvas/)
})
