import assert from 'node:assert/strict'
import test from 'node:test'
import { createInitialSession, createCanvas, createSession, duplicateCanvas } from './canvases.js'

const node = (id, x = 0) => ({ id, type: 'generate-image', name: id, config: {}, ui: { position: { x, y: 0 } } })

test('creates a canvas and initial session with server-owned fields', () => {
  const canvas = createCanvas({
    id: 'caller-id',
    revision: 99,
    createdAt: '2000-01-01T00:00:00.000Z',
    updatedAt: '2000-01-01T00:00:00.000Z',
    name: ' Selected canvas ',
    nodes: [node('a'), node('b', 300)],
    edges: [{ id: 'a-b', source: { nodeId: 'a', port: 'image' }, target: { nodeId: 'b', port: 'image' } }],
  })
  const session = createInitialSession(canvas)

  assert.match(canvas.id, /^canvas-/)
  assert.notEqual(canvas.id, 'caller-id')
  assert.equal(canvas.name, 'Selected canvas')
  assert.equal(canvas.revision, 1)
  assert.notEqual(canvas.createdAt, '2000-01-01T00:00:00.000Z')
  assert.equal(canvas.updatedAt, canvas.createdAt)
  assert.equal(session.canvasId, canvas.id)
  assert.match(session.id, /^session-/)
  assert.equal(session.messages.length, 1)
})

test('creates an empty session for an existing canvas', () => {
  const canvas = createCanvas({ name: 'Canvas', nodes: [], edges: [] })
  const session = createSession(canvas)

  assert.match(session.id, /^session-/)
  assert.equal(session.canvasId, canvas.id)
  assert.equal(session.createdAt, session.updatedAt)
  assert.deepEqual(session.messages, [])
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
    edges: [{ id: 'a-b', source: { nodeId: 'a', port: 'image' }, target: { nodeId: 'b', port: 'image' } }],
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

test('duplicates a canvas with fresh graph IDs', () => {
  const source = createCanvas({
    name: 'Source',
    nodes: [node('frame'), { ...node('child', 300), ui: { position: { x: 300, y: 0 }, parentFrameId: 'frame' } }],
    edges: [{ id: 'frame-child', source: { nodeId: 'frame', port: 'image' }, target: { nodeId: 'child', port: 'image' } }],
  })
  const copy = duplicateCanvas(source)

  assert.notEqual(copy.id, source.id)
  assert.equal(copy.name, 'Source Copy')
  assert.equal(copy.revision, 1)
  assert.ok(copy.nodes.every((copied, index) => copied.id !== source.nodes[index].id))
  assert.equal(copy.nodes[1].ui.parentFrameId, copy.nodes[0].id)
  assert.notEqual(copy.edges[0].id, source.edges[0].id)
  assert.equal(copy.edges[0].source.nodeId, copy.nodes[0].id)
  assert.equal(copy.edges[0].target.nodeId, copy.nodes[1].id)
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
