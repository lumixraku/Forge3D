import test from 'node:test'
import assert from 'node:assert/strict'
import { distanceToPolyline, polylinesCross, routeWire, stockWire, wireKey } from '@forge3d/canvas-core'

test('a wire is named by its source port and its target port', () => {
  assert.equal(wireKey('image', 'image', 'model', 'front'), 'image:image->model:front')
})

test('a wire with no pins is the stock wire, point for point', () => {
  const from = [0, 0]
  const to = [400, 200]
  assert.deepEqual(routeWire(from, to, []), stockWire(from, to))
})

test('a pinned wire still starts and ends on its ports and passes through every pin', () => {
  const from = [0, 0]
  const to = [400, 200]
  const pins = [[300, 150], [100, 50]]
  const route = routeWire(from, to, pins)
  assert.deepEqual(route[0], from)
  assert.deepEqual(route[route.length - 1], to)
  for (const pin of pins) assert.ok(distanceToPolyline(pin, route) < 0.01)
})

test('a pin only bends the middle: the wire leaves its port the same way', () => {
  const from = [0, 0]
  const to = [400, 0]
  const pins = [[200, 120]]
  const stock = routeWire(from, to, [])
  const pinned = routeWire(from, to, pins)
  // Just off the port the two are still the same wire.
  assert.ok(distanceToPolyline(pinned[1], stock) < 3)
  // At the far end they meet the port again.
  assert.deepEqual(pinned[pinned.length - 1], to)
})

test('two pins put the wire through both, in the order it meets them', () => {
  const from = [0, 0]
  const to = [600, 0]
  const route = routeWire(from, to, [[500, 100], [100, -100]])
  assert.ok(distanceToPolyline([100, -100], route) < 0.01)
  assert.ok(distanceToPolyline([500, 100], route) < 0.01)
  const first = route.findIndex((point) => Math.hypot(point[0] - 100, point[1] + 100) < 2)
  const second = route.findIndex((point) => Math.hypot(point[0] - 500, point[1] - 100) < 2)
  assert.ok(first < second)
})

test('a cut catches the wires it crosses and leaves the others alone', () => {
  // A vertical cut at x=150 through y=-50..50.
  const cut = [[150, -50], [150, 50]]
  // The stock wire from (0,0) to (300,0) runs straight through it.
  assert.ok(polylinesCross(cut, stockWire([0, 0], [300, 0])))
  // A wire far below the cut does not cross it.
  assert.ok(!polylinesCross(cut, stockWire([0, 300], [300, 300])))
})
