import test from 'node:test'
import assert from 'node:assert/strict'
import { reconcileCanvasGraph, toCanvasGraph, toDomainCanvas } from './canvas-graph.js'

const node = (id, type) => ({ id, type, name: id, config: {}, ui: { position: { x: 0, y: 0 } } })

test('renders logical ports as one untyped Input/Output connection', () => {
  const canvas = {
    id: 'canvas',
    name: 'Canvas',
    nodes: [node('image', 'reference-image'), node('model', 'generate-model')],
    edges: [{ id: 'edge', source: { nodeId: 'image', port: 'image' }, target: { nodeId: 'model', port: 'image' } }],
  }

  const graph = toCanvasGraph(canvas)

  assert.equal(graph.edges.length, 1)
  assert.equal(graph.edges[0].sourceHandle, 'output')
  assert.equal(graph.edges[0].targetHandle, 'input')
  assert.deepEqual(graph.edges[0].data.logicalConnections, [{ sourcePort: 'image', targetPort: 'image' }])
})

test('maps a simple visual image connection to typed data ports when saving', () => {
  const activeCanvas = {
    id: 'canvas',
    name: 'Canvas',
    nodes: [node('image', 'reference-image'), node('model', 'generate-model')],
    edges: [],
  }
  const graph = toCanvasGraph(activeCanvas)
  const edges = [{ id: 'edge', source: 'image', target: 'model', sourceHandle: 'output', targetHandle: 'input' }]

  const saved = toDomainCanvas(activeCanvas, graph.nodes, edges)

  assert.deepEqual(saved.edges, [{ id: 'edge', source: { nodeId: 'image', port: 'image' }, target: { nodeId: 'model', port: 'image' } }])
})

test('collapses and restores multi-view logical edges behind one visual connection', () => {
  const views = ['front', 'back', 'left', 'right']
  const canvas = {
    id: 'canvas',
    name: 'Canvas',
    nodes: [node('views', 'generate-multiview-images'), node('model', 'multiview-to-3d')],
    edges: views.map((view) => ({ id: `edge-${view}`, source: { nodeId: 'views', port: view }, target: { nodeId: 'model', port: view } })),
  }

  const graph = toCanvasGraph(canvas)
  const saved = toDomainCanvas(canvas, graph.nodes, graph.edges)

  assert.equal(graph.edges.length, 1)
  assert.deepEqual(saved.edges.map((edge) => [edge.source.port, edge.target.port]), views.map((view) => [view, view]))
})

test('does not render connections from a terminal node', () => {
  const canvas = {
    id: 'canvas',
    name: 'Canvas',
    nodes: [node('export', 'export-model'), node('model', 'generate-model')],
    edges: [{ id: 'edge', source: { nodeId: 'export', port: 'model' }, target: { nodeId: 'model', port: 'image' } }],
  }

  assert.deepEqual(toCanvasGraph(canvas).edges, [])
})

test('patches parameter-only updates without replacing positioned graph objects', () => {
  const canvas = {
    id: 'canvas',
    name: 'Canvas',
    nodes: [
      { ...node('frame', 'frame'), config: { description: 'before' }, ui: { position: { x: 10, y: 20 }, size: { width: 900, height: 600 } } },
      { ...node('model', 'generate-model'), config: { texture: true }, ui: { position: { x: 30, y: 40 }, parentFrameId: 'frame' } },
    ],
    edges: [],
  }
  const graph = toCanvasGraph(canvas)
  const frame = graph.nodes[0]
  const model = graph.nodes[1]
  frame.dimensions = { width: 900, height: 600 }
  const updated = structuredClone(canvas)
  updated.nodes[1].config.texture = false

  const reconciled = reconcileCanvasGraph(graph.nodes, graph.edges, toCanvasGraph(updated))
  assert.equal(reconciled.nodes[0], frame)
  assert.equal(reconciled.nodes[1], model)
  assert.equal(model.data.config.texture, false)
  assert.deepEqual(model.position, { x: 30, y: 40 })
})

test('reconciles additions and moves without replacing existing nodes', () => {
  const canvas = { id: 'canvas', name: 'Canvas', nodes: [node('model', 'generate-model')], edges: [] }
  const graph = toCanvasGraph(canvas)
  const model = graph.nodes[0]
  model.dimensions = { width: 320, height: 240 }
  const updated = structuredClone(canvas)
  updated.nodes[0].ui.position.x = 10
  updated.nodes.push(node('export', 'export-model'))

  const reconciled = reconcileCanvasGraph(graph.nodes, graph.edges, toCanvasGraph(updated))

  assert.equal(reconciled.nodes[0], model)
  assert.deepEqual(model.position, { x: 10, y: 0 })
  assert.deepEqual(model.dimensions, { width: 320, height: 240 })
  assert.equal(reconciled.nodes[1].id, 'export')
})

test('lifts results out of an older config on the way in, and writes them back alongside it', () => {
  // A canvas saved before parameters and results split apart keeps both in config.
  const canvas = {
    id: 'canvas',
    name: 'Canvas',
    nodes: [{
      id: 'concepts',
      type: 'generate-image',
      name: 'concepts',
      config: { amount: 4, previews: ['/a.png', '/b.png'], selectedPreview: '/b.png' },
      ui: { position: { x: 0, y: 0 } },
    }],
    edges: [],
  }

  const graph = toCanvasGraph(canvas)

  assert.equal(graph.nodes[0].data.config.amount, 4)
  assert.equal(graph.nodes[0].data.config.previews, undefined)
  assert.equal(graph.nodes[0].data.config.selectedPreview, undefined)
  assert.deepEqual(graph.nodes[0].data.generatedAssets, { previews: ['/a.png', '/b.png'], selectedPreview: '/b.png' })

  // Saving puts them back as their own tree, and the stale copy inside config goes.
  const saved = toDomainCanvas(canvas, graph.nodes, graph.edges).nodes[0]
  assert.equal(saved.config.previews, undefined)
  assert.deepEqual(saved.generatedAssets, { previews: ['/a.png', '/b.png'], selectedPreview: '/b.png' })
})

test('a node with no results stores no field, so opening a canvas does not dirty it', () => {
  const canvas = { id: 'canvas', name: 'Canvas', nodes: [node('model', 'generate-model')], edges: [] }
  const graph = toCanvasGraph(canvas)

  const saved = toDomainCanvas(canvas, graph.nodes, graph.edges).nodes[0]

  assert.equal(Object.hasOwn(saved, 'uploadAssets'), false)
  assert.equal(Object.hasOwn(saved, 'generatedAssets'), false)
})

test('reads a stored outputResult tree and writes it back under the current name', () => {
  const canvas = {
    id: 'canvas',
    name: 'Canvas',
    nodes: [{
      id: 'concepts',
      type: 'generate-image',
      name: 'concepts',
      config: { amount: 2 },
      outputResult: { previews: ['/a.png', '/b.png'], selectedPreview: '/b.png' },
      ui: { position: { x: 0, y: 0 } },
    }],
    edges: [],
  }

  const graph = toCanvasGraph(canvas)
  assert.deepEqual(graph.nodes[0].data.generatedAssets, { previews: ['/a.png', '/b.png'], selectedPreview: '/b.png' })

  // The old key does not survive the round trip, and its content is not lost with it.
  const saved = toDomainCanvas(canvas, graph.nodes, graph.edges).nodes[0]
  assert.equal(Object.hasOwn(saved, 'outputResult'), false)
  assert.deepEqual(saved.generatedAssets, { previews: ['/a.png', '/b.png'], selectedPreview: '/b.png' })
})

test('lifts an upload out of an older config into its own tree', () => {
  // The upload used to live in config too. It moves to uploadAssets, which sits
  // alongside config rather than inside it, and never into generatedAssets: it is
  // the user's own input, so a copied node keeps it.
  const canvas = {
    id: 'canvas',
    name: 'Canvas',
    nodes: [{
      id: 'ref',
      type: 'reference-image',
      name: 'ref',
      config: { reference: 'shark.glb', assetType: 'model', assetUrl: '/a.glb', modelUrl: '/a.glb', thumbnailUrl: '/a.png' },
      ui: { position: { x: 0, y: 0 } },
    }],
    edges: [],
  }

  const graph = toCanvasGraph(canvas)

  assert.deepEqual(graph.nodes[0].data.config, {})
  assert.deepEqual(graph.nodes[0].data.uploadAssets, { reference: 'shark.glb', assetType: 'model', assetUrl: '/a.glb', modelUrl: '/a.glb', thumbnailUrl: '/a.png' })
  assert.deepEqual(graph.nodes[0].data.generatedAssets, {})

  const saved = toDomainCanvas(canvas, graph.nodes, graph.edges).nodes[0]
  assert.deepEqual(saved.config, {})
  assert.deepEqual(saved.uploadAssets, { reference: 'shark.glb', assetType: 'model', assetUrl: '/a.glb', modelUrl: '/a.glb', thumbnailUrl: '/a.png' })
  assert.equal(Object.hasOwn(saved, 'generatedAssets'), false)
})
