import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFragment, parseFragment, remapFragment, serializeFragment } from './canvas-fragment.js'
import { toCanvasGraph } from './canvas-graph.js'

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

test('copying root nodes offsets the roots without changing their relative layout or config', () => {
  const canvas = {
    id: 'canvas',
    revision: 1,
    name: 'Canvas',
    nodes: [
      { ...node('first', 120, 80), config: { prompt: 'shark', quality: 'high' } },
      { ...node('second', 420, 140), config: { strength: 0.8 } },
    ],
    edges: [{ id: 'edge', source: { nodeId: 'first', port: 'output' }, target: { nodeId: 'second', port: 'input' } }],
  }

  const fragment = buildFragment(canvas, new Set(['first', 'second']), 'Nodes')
  const pasted = remapFragment(fragment, { offset: { x: 144, y: 104 }, suffix: 'copy' })

  assert.deepEqual(pasted.nodes.map((item) => item.ui.position), [{ x: 144, y: 104 }, { x: 444, y: 164 }])
  assert.deepEqual(pasted.nodes.map((item) => item.config), canvas.nodes.map((item) => item.config))
  assert.ok(pasted.nodes.every((item, index) => item.id !== canvas.nodes[index].id))
  assert.ok(toCanvasGraph({ ...canvas, nodes: pasted.nodes, edges: pasted.edges }).nodes.every((item) => item.data.status === 'ready'))
  assert.deepEqual(
    { source: pasted.edges[0].source.nodeId, target: pasted.edges[0].target.nodeId },
    { source: pasted.nodes[0].id, target: pasted.nodes[1].id },
  )
})

test('clipboard fragments round-trip through the system clipboard format', () => {
  const canvas = {
    id: 'canvas',
    revision: 1,
    name: 'Canvas',
    nodes: [node('first', 120, 80), node('second', 420, 140)],
    edges: [{ id: 'edge', source: { nodeId: 'first', port: 'output' }, target: { nodeId: 'second', port: 'input' } }],
  }
  const fragment = buildFragment(canvas, new Set(['first', 'second']), 'Nodes')

  assert.deepEqual(parseFragment(serializeFragment(fragment)), fragment)
})

test('clipboard parsing ignores ordinary or invalid clipboard content', () => {
  assert.equal(parseFragment('ordinary text'), null)
  assert.equal(parseFragment('FORGE3D_CANVAS_FRAGMENT/1\n{"kind":"canvas-fragment"}'), null)
})
