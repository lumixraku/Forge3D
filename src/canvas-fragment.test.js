import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFragment, remapFragment } from './canvas-fragment.js'

function node(id, x, y, parentFrameId) {
  return { id, type: id === 'section' ? 'frame' : 'prompt', ui: { position: { x, y }, ...(parentFrameId ? { parentFrameId } : {}) } }
}

test('copying a section includes its children and preserves their local positions', () => {
  const canvas = {
    id: 'canvas',
    revision: 1,
    name: 'Canvas',
    nodes: [node('section', 500, 300), node('child-a', 40, 80, 'section'), node('child-b', 340, 120, 'section')],
    edges: [{ id: 'edge', source: { nodeId: 'child-a', port: 'output' }, target: { nodeId: 'child-b', port: 'input' } }],
  }

  const fragment = buildFragment(canvas, new Set(['section']), 'Section')
  const pasted = remapFragment(fragment, { offset: { x: 524, y: 324 }, suffix: 'copy' })
  const copiedSection = pasted.nodes.find((item) => item.type === 'frame')
  const copiedChildren = pasted.nodes.filter((item) => item.type !== 'frame')

  assert.equal(fragment.nodes.length, 3)
  assert.deepEqual(copiedSection.ui.position, { x: 524, y: 324 })
  assert.deepEqual(copiedChildren.map((item) => item.ui.position), [{ x: 40, y: 80 }, { x: 340, y: 120 }])
  assert.ok(copiedChildren.every((item) => item.ui.parentFrameId === copiedSection.id))
  assert.equal(pasted.edges.length, 1)
})
