import test from 'node:test'
import assert from 'node:assert/strict'
import { FRAME_PADDING, FRAME_TITLE_SCREEN_HEIGHT, frameComponentGap, frameInsets, layoutCanvas, layoutSelection, selectedLayoutGroups } from './canvas-layout.js'

function overlaps(a, b, positions) {
  const first = positions.get(a.id)
  const second = positions.get(b.id)
  return first.x < second.x + b.width && first.x + a.width > second.x && first.y < second.y + b.height && first.y + a.height > second.y
}

test('lays out a linear canvas from left to right', async () => {
  const nodes = ['a', 'b', 'c'].map((id) => ({ id, width: 290, height: 430 }))
  const positions = await layoutCanvas(nodes, [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'c' },
  ])

  assert.ok(positions.get('a').x < positions.get('b').x)
  assert.ok(positions.get('b').x < positions.get('c').x)
  assert.equal(positions.size, nodes.length)
})

test('top-aligns differently sized nodes in a linear canvas', async () => {
  const nodes = [
    { id: 'a', width: 290, height: 200 },
    { id: 'b', width: 290, height: 430 },
    { id: 'c', width: 290, height: 260 },
  ]
  const positions = await layoutCanvas(nodes, [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'c' },
  ])

  assert.ok(positions.get('a').x < positions.get('b').x)
  assert.ok(positions.get('b').x < positions.get('c').x)
  assert.equal(positions.get('a').y, positions.get('b').y)
  assert.equal(positions.get('b').y, positions.get('c').y)
})

test('top-aligns a downstream chain after inputs merge', async () => {
  const nodes = [
    { id: 'prompt', width: 290, height: 200 },
    { id: 'upload', width: 290, height: 360 },
    { id: 'image', width: 290, height: 430 },
    { id: 'model', width: 290, height: 600 },
    { id: 'export', width: 290, height: 360 },
  ]
  const positions = await layoutCanvas(nodes, [
    { source: 'prompt', target: 'image' },
    { source: 'upload', target: 'image' },
    { source: 'image', target: 'model' },
    { source: 'model', target: 'export' },
  ])

  assert.ok(positions.get('image').x < positions.get('model').x)
  assert.ok(positions.get('model').x < positions.get('export').x)
  assert.equal(positions.get('image').y, positions.get('model').y)
  assert.equal(positions.get('model').y, positions.get('export').y)
})

test('lays out multiple inputs and outputs around a merge and split', async () => {
  const nodes = [
    { id: 'input-a', width: 260, height: 240 },
    { id: 'input-b', width: 260, height: 300 },
    { id: 'merge', width: 300, height: 360 },
    { id: 'process', width: 320, height: 420 },
    { id: 'output-a', width: 250, height: 220 },
    { id: 'output-b', width: 250, height: 280 },
  ]
  const edges = [
    { source: 'input-a', target: 'merge' },
    { source: 'input-b', target: 'merge' },
    { source: 'merge', target: 'process' },
    { source: 'process', target: 'output-a' },
    { source: 'process', target: 'output-b' },
  ]
  const positions = await layoutCanvas(nodes, edges)

  assert.equal(positions.get('input-a').x, positions.get('input-b').x)
  assert.equal(positions.get('output-a').x, positions.get('output-b').x)
  assert.ok(positions.get('input-a').x < positions.get('merge').x)
  assert.ok(positions.get('merge').x < positions.get('process').x)
  assert.ok(positions.get('process').x < positions.get('output-a').x)
  for (let index = 0; index < nodes.length; index += 1) {
    for (let other = index + 1; other < nodes.length; other += 1) assert.equal(overlaps(nodes[index], nodes[other], positions), false)
  }
})

test('separates independent canvas components', async () => {
  const nodes = ['a1', 'a2', 'b1', 'b2'].map((id) => ({ id, width: 290, height: 300 }))
  const positions = await layoutCanvas(nodes, [
    { source: 'a1', target: 'a2' },
    { source: 'b1', target: 'b2' },
  ])

  assert.ok(positions.get('a1').x < positions.get('a2').x)
  assert.ok(positions.get('b1').x < positions.get('b2').x)
  assert.equal(overlaps(nodes[0], nodes[2], positions), false)
})

// Insets feed persisted geometry, so they must not vary with the local viewport:
// collaborators at different zoom levels would each refit to their own answer and
// bounce the canvas back and forth. Callers pass no zoom at all now.
test('reserves frame title space independent of viewport zoom', () => {
  const insets = frameInsets()
  assert.equal(insets.top - FRAME_PADDING, FRAME_TITLE_SCREEN_HEIGHT)
  assert.equal(insets.bottom, FRAME_PADDING)
  assert.equal(frameComponentGap() - insets.top - insets.bottom - 32, FRAME_TITLE_SCREEN_HEIGHT)
  for (const zoom of [0.5, 1, 2]) assert.deepEqual(frameInsets(zoom), insets)
})

test('ignores missing endpoints and handles cycles deterministically', async () => {
  const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'isolated' }]
  const edges = [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'a' },
    { source: 'missing', target: 'a' },
  ]

  const first = await layoutCanvas(nodes, edges)
  const second = await layoutCanvas(nodes, edges)

  assert.deepEqual([...first], [...second])
  assert.equal(first.size, nodes.length)
  assert.ok([...first.values()].every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)))
})

test('lays out only selected root nodes and treats a selected section as one node', async () => {
  const nodes = [
    { id: 'section', type: 'frame', selected: true, position: { x: 100, y: 100 }, width: 700, height: 500 },
    { id: 'child-a', parentNode: 'section', position: { x: 40, y: 70 } },
    { id: 'child-b', parentNode: 'section', position: { x: 360, y: 90 } },
    { id: 'outside', selected: true, position: { x: 1000, y: 180 } },
    { id: 'untouched', position: { x: 1500, y: 800 } },
  ]
  const plan = selectedLayoutGroups(nodes, [{ source: 'child-b', target: 'outside' }])
  const result = await layoutSelection(nodes, [{ source: 'child-b', target: 'outside' }])

  assert.deepEqual(plan.groups.map((group) => group.nodes.map((node) => node.id)), [['section', 'outside']])
  assert.deepEqual(plan.groups[0].edges.map(({ source, target }) => ({ source, target })), [{ source: 'section', target: 'outside' }])
  assert.deepEqual([...result.positions.keys()], ['section', 'outside'])
  assert.equal(result.positions.has('child-a'), false)
  assert.equal(result.positions.has('child-b'), false)
  assert.equal(result.positions.has('untouched'), false)
})

test('selecting only a section lays out its contents without moving the section', async () => {
  const nodes = [
    { id: 'section', type: 'frame', selected: true, position: { x: 500, y: 300 } },
    { id: 'child-a', parentNode: 'section', position: { x: 80, y: 120 } },
    { id: 'child-b', parentNode: 'section', position: { x: 420, y: 160 } },
    { id: 'outside', position: { x: 1200, y: 200 } },
  ]
  const result = await layoutSelection(nodes, [{ source: 'child-a', target: 'child-b' }])

  assert.deepEqual([...result.positions.keys()], ['child-a', 'child-b'])
  assert.ok(result.positions.get('child-a').x < result.positions.get('child-b').x)
  assert.equal(result.positions.has('section'), false)
  assert.equal(result.positions.has('outside'), false)
  assert.deepEqual([...result.fitFrameIds], ['section'])
})

test('treats selected descendants as part of their selected section', async () => {
  const nodes = [
    { id: 'section', type: 'frame', selected: true, position: { x: 500, y: 300 } },
    { id: 'child-a', parentNode: 'section', selected: true, position: { x: 80, y: 120 } },
    { id: 'child-b', parentNode: 'section', selected: true, position: { x: 420, y: 160 } },
    { id: 'outside', position: { x: 1200, y: 200 } },
  ]
  const result = await layoutSelection(nodes, [{ source: 'child-a', target: 'child-b' }])

  assert.deepEqual([...result.positions.keys()], ['child-a', 'child-b'])
  assert.equal(result.positions.has('section'), false)
  assert.equal(result.positions.has('outside'), false)
  assert.deepEqual([...result.fitFrameIds], ['section'])
})

test('lays out selected nodes inside their section and leaves siblings untouched', async () => {
  const nodes = [
    { id: 'section', type: 'frame', position: { x: 500, y: 300 } },
    { id: 'child-a', parentNode: 'section', selected: true, position: { x: 80, y: 120 } },
    { id: 'child-b', parentNode: 'section', selected: true, position: { x: 420, y: 160 } },
    { id: 'sibling', parentNode: 'section', position: { x: 760, y: 200 } },
  ]
  const result = await layoutSelection(nodes, [{ source: 'child-a', target: 'child-b' }, { source: 'child-b', target: 'sibling' }])

  assert.deepEqual([...result.positions.keys()], ['child-a', 'child-b'])
  assert.equal(result.positions.has('section'), false)
  assert.equal(result.positions.has('sibling'), false)
  assert.equal(result.fitFrameIds.size, 0)
})

test('lays out root nodes globally only when nothing is selected', async () => {
  const nodes = [
    { id: 'section', type: 'frame', position: { x: 100, y: 100 }, width: 700, height: 500 },
    { id: 'child', parentNode: 'section', position: { x: 80, y: 120 } },
    { id: 'outside', position: { x: 1000, y: 180 } },
  ]
  const result = await layoutSelection(nodes, [{ source: 'child', target: 'outside' }])

  assert.deepEqual([...result.positions.keys()], ['section', 'outside'])
  assert.equal(result.positions.has('child'), false)
})
