import test from 'node:test'
import assert from 'node:assert/strict'
import { adoptNodesCoveredByDraggedFrames, applyLayoutPositions, buildDrawnFrame, buildSelectionFrame, fitFrameNodes, pointInAnyFrame, reparentDraggedNodes } from './frame-geometry.js'
import { frameInsets } from './canvas-layout.js'

const insets = { left: 10, right: 20, top: 30, bottom: 40 }

function frame(id, position, width, height, data = {}) {
  return { id, type: 'frame', position, style: { width: `${width}px`, height: `${height}px` }, data }
}

function node(id, position, size = {}, extra = {}) {
  return { id, type: 'canvas', position, width: size.width || 260, height: size.height || 430, ...extra }
}

test('fits a frame to its children and shifts them into the insets', () => {
  const nodes = [frame('f', { x: 0, y: 0 }, 900, 600), node('a', { x: 100, y: 200 }, {}, { parentNode: 'f' })]

  const { nodes: fitted, changed } = fitFrameNodes(nodes, insets)

  assert.equal(changed, true)
  assert.deepEqual(fitted[0].position, { x: 0, y: 0 })
  assert.equal(fitted[0].width, 290)
  assert.equal(fitted[0].height, 500)
  assert.equal(fitted[0].style.width, '290px')
  // The child ends up exactly one inset in from the frame's top-left.
  assert.deepEqual(fitted[1].position, { x: insets.left, y: insets.top })
})

test('leaves a manually resized frame and an already fitting frame untouched', () => {
  const manual = [frame('f', { x: 0, y: 0 }, 900, 600, { manualSize: true }), node('a', { x: 100, y: 200 }, {}, { parentNode: 'f' })]
  assert.equal(fitFrameNodes(manual, insets).changed, false)

  const fitting = [frame('f', { x: 0, y: 0 }, 290, 500), node('a', { x: insets.left, y: insets.top }, {}, { parentNode: 'f' })]
  assert.equal(fitFrameNodes(fitting, insets).changed, false)
})

test('re-parents a dragged node to the frame it overlaps most', () => {
  const nodes = [
    frame('a', { x: 0, y: 0 }, 400, 400),
    frame('b', { x: 300, y: 0 }, 400, 400),
    node('n', { x: 250, y: 50 }, { width: 100, height: 100 }),
  ]

  const intoA = reparentDraggedNodes(nodes, [nodes[2]])
  assert.equal(intoA.changed, true)
  assert.equal(intoA.nodes[2].parentNode, 'a')
  assert.deepEqual(intoA.nodes[2].position, { x: 250, y: 50 })

  // Nudged right, the node overlaps b more than a, so b takes it over.
  const dragged = { ...nodes[2], position: { x: 320, y: 50 } }
  const intoB = reparentDraggedNodes([nodes[0], nodes[1], dragged], [dragged])
  assert.equal(intoB.nodes[2].parentNode, 'b')
  assert.deepEqual(intoB.nodes[2].position, { x: 20, y: 50 })
})

test('drops a node out of its frame back into global coordinates', () => {
  const child = node('n', { x: 10, y: 10 }, { width: 100, height: 100 }, { parentNode: 'a' })
  const nodes = [frame('a', { x: 0, y: 0 }, 400, 400), child]

  const { nodes: next, changed } = reparentDraggedNodes(nodes, [{ ...child, positionAbsolute: { x: 900, y: 900 } }])

  assert.equal(changed, true)
  assert.equal(next[1].parentNode, undefined)
  assert.deepEqual(next[1].position, { x: 900, y: 900 })
})

test('moving a frame over a root node adopts it in local coordinates', () => {
  const nodes = [frame('f', { x: 0, y: 0 }, 400, 400), node('n', { x: 550, y: 150 }, { width: 100, height: 100 })]
  const movedFrame = { ...nodes[0], position: { x: 500, y: 100 } }

  const { nodes: next, changed } = adoptNodesCoveredByDraggedFrames([movedFrame, nodes[1]], [movedFrame])

  assert.equal(changed, true)
  assert.equal(next[1].parentNode, 'f')
  assert.deepEqual(next[1].position, { x: 50, y: 50 })
})

test('moving a frame keeps its existing children in their local positions', () => {
  const child = node('child', { x: 40, y: 60 }, { width: 100, height: 100 }, { parentNode: 'f' })
  const movedFrame = frame('f', { x: 500, y: 100 }, 400, 400)

  const { nodes: next, changed } = adoptNodesCoveredByDraggedFrames([movedFrame, child], [movedFrame])

  assert.equal(changed, false)
  assert.deepEqual(next[1].position, { x: 40, y: 60 })
})

test('reports whether a point falls inside any frame, including nested ones', () => {
  const nodes = [
    frame('outer', { x: 0, y: 0 }, 400, 400),
    { ...frame('inner', { x: 100, y: 100 }, 100, 100), parentNode: 'outer' },
    node('n', { x: 1000, y: 1000 }),
  ]

  assert.equal(pointInAnyFrame({ x: 150, y: 150 }, nodes), true)
  assert.equal(pointInAnyFrame({ x: 399, y: 399 }, nodes), true)
  assert.equal(pointInAnyFrame({ x: 1050, y: 1050 }, nodes), false)
})

test('wraps a selection in a frame and converts children to local coordinates', () => {
  const nodes = [node('a', { x: 100, y: 100 }), node('b', { x: 500, y: 200 }), node('c', { x: 2000, y: 0 })]

  const [created, ...rest] = buildSelectionFrame(nodes, [nodes[0], nodes[1]], { insets, frameId: 'frame-2' })

  assert.deepEqual(created.position, { x: 90, y: 70 })
  assert.equal(created.width, 690)
  assert.equal(created.height, 600)
  assert.equal(created.selected, true)
  assert.deepEqual(rest.map((item) => item.parentNode), ['frame-2', 'frame-2', undefined])
  assert.deepEqual(rest[0].position, { x: 10, y: 30 })
  assert.deepEqual(rest[1].position, { x: 410, y: 130 })
  assert.equal(rest.some((item) => item.selected), false)
})

test('builds a drawn frame at the drawn rectangle and adopts what it overlaps', () => {
  const nodes = [node('a', { x: 100, y: 100 }), node('b', { x: 2000, y: 0 })]

  const [created, ...rest] = buildDrawnFrame(nodes, { left: 50, top: 40, right: 950, bottom: 640 }, { frameId: 'frame-2' })

  assert.deepEqual(created.position, { x: 50, y: 40 })
  assert.equal(created.width, 900)
  assert.equal(created.height, 600)
  assert.equal(created.selected, true)
  assert.equal(created.data.manualSize, true)
  assert.equal(created.data.label, 'New canvas section')
  assert.deepEqual(rest.map((item) => item.parentNode), ['frame-2', undefined])
  assert.deepEqual(rest[0].position, { x: 50, y: 60 })
  assert.equal(rest.some((item) => item.selected), false)
})

test('a drawn frame adopts a one pixel overlap but not an edge touch', () => {
  const nodes = [node('overlap', { x: 899, y: 100 }), node('touching', { x: 900, y: 300 })]

  const [, overlapping, touching] = buildDrawnFrame(nodes, { left: 0, top: 0, right: 900, bottom: 900 }, { frameId: 'f' })

  assert.equal(overlapping.parentNode, 'f')
  assert.equal(touching.parentNode, undefined)
})

test('a drawn frame never nests frames or steals another frame owned child', () => {
  const nodes = [frame('existing', { x: 0, y: 0 }, 900, 600), node('owned', { x: 10, y: 10 }, {}, { parentNode: 'existing' }), node('root', { x: 20, y: 20 })]

  const [created, ...rest] = buildDrawnFrame(nodes, { left: 0, top: 0, right: 900, bottom: 600 }, { frameId: 'f' })

  assert.equal(created.id, 'f')
  assert.deepEqual(rest.map((item) => item.parentNode), [undefined, 'existing', 'f'])
  assert.deepEqual(rest[1].position, { x: 10, y: 10 })
})

test('a drawn frame normalizes an inverted rectangle and clamps a tiny one', () => {
  const [created] = buildDrawnFrame([], { left: 400, top: 300, right: 390, bottom: 295 }, { frameId: 'f' })

  assert.deepEqual(created.position, { x: 390, y: 295 })
  assert.equal(created.width, 260)
  assert.equal(created.height, 180)
})

test('anchors frames to their laid out children and keeps children local', () => {
  const nodes = [frame('f', { x: 0, y: 0 }, 900, 600), node('child', { x: 0, y: 0 }, {}, { parentNode: 'f' }), node('root', { x: 0, y: 0 })]
  const positions = new Map([['child', { x: 1000, y: 500 }], ['root', { x: 40, y: 60 }]])

  const [laidOutFrame, child, root] = applyLayoutPositions(nodes, positions, insets)

  assert.deepEqual(laidOutFrame.position, { x: 990, y: 470 })
  assert.equal(laidOutFrame.width, 290)
  assert.equal(laidOutFrame.height, 500)
  assert.equal(laidOutFrame.style.width, '290px')
  assert.deepEqual(child.position, { x: 10, y: 30 })
  assert.deepEqual(root.position, { x: 40, y: 60 })
})

// A client that receives another client's canvas refits it locally. That refit
// must agree with what arrived, or `changed` is true, the receiver saves, the
// sender refits and saves back, and the canvas ping-pongs forever. Insets are
// zoom-independent (see canvas-layout) precisely so this holds.
test('refitting geometry another client already fitted reports no change', () => {
  const sent = fitFrameNodes(
    [frame('f', { x: 0, y: 0 }, 900, 600), node('child', { x: 100, y: 100 }, {}, { parentNode: 'f' })],
    frameInsets(),
  )
  assert.equal(sent.changed, true)

  const received = fitFrameNodes(structuredClone(sent.nodes), frameInsets())

  assert.equal(received.changed, false)
  assert.deepEqual(received.nodes[1].position, sent.nodes[1].position)
})
