import assert from 'node:assert/strict'
import test from 'node:test'
import { executionOrder, planNodes } from './run-plan.ts'

const nodes = [
  { id: 'prompt', type: 'canvas' },
  { id: 'image', type: 'canvas' },
  { id: 'model', type: 'canvas' },
  { id: 'frame-1', type: 'frame' },
]
const edges = [
  { source: 'prompt', target: 'image' },
  { source: 'image', target: 'model' },
]

test('orders nodes from their edges and skips frames', () => {
  assert.deepEqual(executionOrder([...nodes].reverse(), edges).map((node) => node.id), ['prompt', 'image', 'model'])
})

test('falls back to declaration order on a cycle', () => {
  const cyclic = [{ source: 'prompt', target: 'image' }, { source: 'image', target: 'prompt' }]
  assert.deepEqual(executionOrder(nodes, cyclic).map((node) => node.id), ['prompt', 'image', 'model'])
})

test('plans the whole graph, one node, or a node and its downstream', () => {
  assert.deepEqual(planNodes(nodes, edges).map((node) => node.id), ['prompt', 'image', 'model'])
  assert.deepEqual(planNodes(nodes, edges, 'image').map((node) => node.id), ['image'])
  assert.deepEqual(planNodes(nodes, edges, 'image', 'downstream').map((node) => node.id), ['image', 'model'])
  assert.deepEqual(planNodes(nodes, edges, 'missing', 'downstream'), [])
})
