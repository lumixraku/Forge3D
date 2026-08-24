import test from 'node:test'
import assert from 'node:assert/strict'
import { nextTick, ref } from 'vue'
import { useCanvasFrames } from './composables/useCanvasFrames.ts'

globalThis.requestAnimationFrame ||= (callback) => setTimeout(() => callback(0), 0)

// Lets the queued fit run: nextTick, then the rAF it waits on, then nextTick.
async function settle() {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 5))
  await nextTick()
}

function harness() {
  const nodes = ref([
    { id: 'f1', type: 'frame', position: { x: 0, y: 0 }, width: 400, height: 300, style: { width: '400px', height: '300px' }, data: {} },
    { id: 'inside', type: 'canvas', parentNode: 'f1', position: { x: 64, y: 106 }, dimensions: { width: 260, height: 130 } },
    { id: 'outside', type: 'canvas', position: { x: 900, y: 900 }, dimensions: { width: 260, height: 130 } },
  ])
  const calls = { save: 0, layoutSave: 0, measured: 0 }
  const api = useCanvasFrames({
    nodes,
    edges: ref([]),
    screenToFlowCoordinate: (point) => point,
    updateNodeInternals: () => calls.measured++,
    scheduleSave: () => calls.save++,
    scheduleLayoutSave: () => calls.layoutSave++,
    frameableSelectedNodes: ref([]),
    nextNodeId: () => 'f2',
    focusNode: () => {},
  })
  const find = (id) => nodes.value.find((node) => node.id === id)
  const frameSize = () => ({ width: find('f1').width, height: find('f1').height })
  return { nodes, calls, api, find, frameSize }
}

// Vue Flow moves the node itself during the drag and then reports the release.
async function dragTo(api, nodes, id, position) {
  api.onNodeDragStart()
  const dragged = { ...nodes.value.find((node) => node.id === id), position }
  nodes.value = nodes.value.map((node) => (node.id === id ? dragged : node))
  api.onElementsChange([{ type: 'position', id }])
  await api.onNodeDragStop({ nodes: [dragged] })
  await settle()
}

test('dragging a node into a section adopts it and grows the section', async () => {
  const { nodes, calls, api, find, frameSize } = harness()
  const before = frameSize()

  await dragTo(api, nodes, 'outside', { x: 120, y: 140 })

  assert.equal(find('outside').parentNode, 'f1')
  const after = frameSize()
  assert.ok(after.height > before.height, `expected the section to grow, got ${after.height} from ${before.height}`)
  // Vue Flow renders a frame from style.width/height, so a fit that only wrote
  // width/height would leave the rendered box at its old size.
  assert.equal(find('f1').style.height, `${after.height}px`)
  assert.ok(calls.measured > 0, 'the fit has to re-measure or Vue Flow keeps its own frame size')
  assert.equal(calls.save, 1)
})

test('dragging a node out of a section releases it and shrinks the section', async () => {
  const { nodes, calls, api, find, frameSize } = harness()
  await dragTo(api, nodes, 'outside', { x: 120, y: 140 })
  const grown = frameSize()

  await dragTo(api, nodes, 'outside', { x: 1200, y: 1200 })

  assert.equal(find('outside').parentNode, undefined)
  assert.ok(frameSize().height < grown.height, 'expected the section to shrink back')
  assert.equal(calls.save, 2)
})

test('a node re-measuring mid-run leaves its section alone', async () => {
  const { calls, api, frameSize } = harness()
  const before = frameSize()

  // What a run does: the node's own box changes height, nothing moves.
  api.onElementsChange([{ type: 'dimensions', id: 'inside' }])
  await settle()

  assert.deepEqual(frameSize(), before)
  assert.equal(calls.save, 0)
  assert.equal(calls.layoutSave, 0)
})
