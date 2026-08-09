import test from 'node:test'
import assert from 'node:assert/strict'
import { toCanvasGraph, toDomainCanvas } from './canvas-graph.js'

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
