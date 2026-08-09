import test from 'node:test'
import assert from 'node:assert/strict'
import { removeSelectedElements } from './canvas-selection.js'

function node(id, { type = 'prompt', parentNode, selected = false, x = 0, y = 0 } = {}) {
  return { id, type, parentNode, selected, position: { x, y } }
}

test('deleting a section recursively removes its descendants and connected edges', () => {
  const nodes = [
    node('section', { type: 'frame', selected: true }),
    node('child', { parentNode: 'section' }),
    node('nested-section', { type: 'frame', parentNode: 'section' }),
    node('nested-child', { parentNode: 'nested-section' }),
    node('outside'),
  ]
  const edges = [
    { id: 'inside', source: 'child', target: 'nested-child' },
    { id: 'crossing', source: 'nested-child', target: 'outside' },
    { id: 'outside', source: 'outside', target: 'outside' },
  ]

  const result = removeSelectedElements(nodes, edges)

  assert.deepEqual(result.nodes.map((item) => item.id), ['outside'])
  assert.deepEqual(result.edges.map((item) => item.id), ['outside'])
})

test('dissolving a section preserves its children in the section parent coordinate space', () => {
  const nodes = [
    node('outer', { type: 'frame', x: 100, y: 100 }),
    node('section', { type: 'frame', parentNode: 'outer', selected: true, x: 20, y: 30 }),
    node('child', { parentNode: 'section', selected: true, x: 5, y: 7 }),
  ]
  const edges = [{ id: 'edge', source: 'child', target: 'outer' }]

  const result = removeSelectedElements(nodes, edges, { preserveFrameChildren: true })

  assert.deepEqual(result.nodes.map((item) => item.id), ['outer', 'child'])
  assert.equal(result.nodes[1].parentNode, 'outer')
  assert.deepEqual(result.nodes[1].position, { x: 25, y: 37 })
  assert.deepEqual(result.edges, edges)
})
