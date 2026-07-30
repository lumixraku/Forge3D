import test from 'node:test'
import assert from 'node:assert/strict'
import { FRAME_PADDING, FRAME_TITLE_SCREEN_HEIGHT, frameComponentGap, frameInsets, layoutCanvas } from './canvas-layout.js'

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

test('keeps frame title space constant across viewport zoom levels', () => {
  for (const zoom of [0.5, 1, 2]) {
    const insets = frameInsets(zoom)
    assert.equal((insets.top - FRAME_PADDING) * zoom, FRAME_TITLE_SCREEN_HEIGHT)
    assert.equal(insets.bottom, FRAME_PADDING)
    assert.equal((frameComponentGap(zoom) - insets.top - insets.bottom - 32) * zoom, FRAME_TITLE_SCREEN_HEIGHT)
  }
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
