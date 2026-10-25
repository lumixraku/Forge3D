// Wire ties: a tie pins a point on a few wires, so they run through it.
//
// A tie changes nothing about a wire except where the wire goes: the wire is
// still the same record (its source port and target port), it just has to pass
// through the pinned point now. A wire with no pins is drawn exactly as
// LiteGraph draws it.

export interface WireTie {
  id: string
  // The pin every wire of this tie passes through.
  point: number[]
  // The wires it pins, each named by what a wire already is: its source node
  // and port, and its target node and port.
  members: string[]
}

type Point = number[]

/** Space between the wires a tie holds, in graph units. */
export const LANE_GAP = 7

/** The name of one wire: source node, source port, target node, target port. */
export function wireKey(source: string, sourcePort: string, target: string, targetPort: string) {
  return `${source}:${sourcePort}->${target}:${targetPort}`
}

// LiteGraph samples its wires at this many steps; matching it keeps a pinned
// wire's first and last stretch on the same curve the stock one uses.
const CURVE_STEPS = 16

/** The wire LiteGraph draws between two slot positions, as points. */
export function stockWire(from: Point, to: Point): Point[] {
  const distance = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1
  const points: Point[] = []
  cubic(from[0], from[1], from[0] + distance * 0.25, from[1], to[0] - distance * 0.25, to[1], to[0], to[1], points)
  return points
}

function cubic(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, out: Point[], begin = false, steps = CURVE_STEPS) {
  for (let step = begin || !out.length ? 0 : 1; step <= steps; step += 1) {
    const t = step / steps
    const u = 1 - t
    out.push([
      u ** 3 * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t ** 3 * x3,
      u ** 3 * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t ** 3 * y3,
    ])
  }
}

/**
 * A wire through its pins. With no pins this returns exactly the stock wire.
 * With pins, the stretch from the output to the first pin and the stretch from
 * the last pin to the input stay on the stock bezier, so the wire leaves its
 * port and enters its port at the same angle as before; only the middle runs
 * through the pins.
 */
export function routeWire(from: Point, to: Point, pins: Point[]): Point[] {
  if (!pins.length) return stockWire(from, to)
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const span = dx * dx + dy * dy || 1
  const along = (point: Point) => ((point[0] - from[0]) * dx + (point[1] - from[1]) * dy) / span
  const ordered = [...pins].sort((a, b) => along(a) - along(b))
  // The wire leaves its output heading right and enters its input heading
  // right, like every wire. At a pin it heads from the point before towards
  // the point after, so it passes through smoothly from whichever side it
  // comes: no corner, whatever side of the pin the ports are on.
  const points = [from, ...ordered, to]
  const tangents = points.map((point, i) => {
    if (i === 0 || i === points.length - 1) return [1, 0]
    const tx = points[i + 1][0] - points[i - 1][0]
    const ty = points[i + 1][1] - points[i - 1][1]
    const length = Math.hypot(tx, ty) || 1
    return [tx / length, ty / length]
  })
  const chain = new Stretches()
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]
    const b = points[i]
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    // Handles scale with the stretch, capped so a long wire does not swing
    // far out to reach a nearby pin.
    // Wide enough that a wire turning back through a pin bends in a broad
    // curve rather than a hook.
    const k = Math.min(length * 0.4, 600)
    chain.add(tangents[i - 1][0] * k, tangents[i - 1][1] * k, -tangents[i][0] * k, -tangents[i][1] * k, b, a, i === 1)
  }
  return chain.points
}

// Builds one continuous polyline out of cubic segments, each described
// relative to where the previous one ended.
class Stretches {
  points: Point[] = []

  add(handle1X: number, handle1Y: number, handle2X: number, handle2Y: number, end: Point, start?: Point, begin = false) {
    const from = start || this.points[this.points.length - 1]
    // Sample by length: a long stretch drawn with a fixed count of points
    // shows its straight chords as corners.
    const reach = Math.hypot(handle1X, handle1Y) + Math.hypot(end[0] - from[0], end[1] - from[1]) + Math.hypot(handle2X, handle2Y)
    const steps = Math.max(CURVE_STEPS, Math.min(240, Math.ceil(reach / 12)))
    cubic(
      from[0], from[1],
      from[0] + handle1X, from[1] + handle1Y,
      end[0] + handle2X, end[1] + handle2Y,
      end[0], end[1],
      this.points,
      begin,
      steps,
    )
  }
}

/** Where a tie is drawn: a short bar across the wires it pins. *//**
 * Where a tie is drawn: a bar across the wires it holds. The bar is square to
 * the average direction the wires are heading when they meet the pin, so the
 * wires cross it cleanly instead of sliding along it.
 */
/** Half the length of a tie's band, in graph units. */
export function tieRadius(tie: WireTie, gap: number) {
  // The band is a grab handle as much as a marker, so it never gets thinner
  // than a comfortable target however few wires it holds.
  return Math.max(10, (Math.min(tie.members.length, 5) * gap) / 2 + 6)
}

export function tieBar(tie: WireTie, gap: number) {
  const half = tieRadius(tie, gap)
  return [[tie.point[0] - half, tie.point[1]], [tie.point[0] + half, tie.point[1]]]
}

export function distanceToSegment(point: Point, a: Point, b: Point) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const length2 = dx * dx + dy * dy
  if (length2 === 0) return Math.hypot(point[0] - a[0], point[1] - a[1])
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2))
  return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy))
}

export function distanceToPolyline(point: Point, points: Point[]) {
  let best = Infinity
  for (let i = 1; i < points.length; i += 1) best = Math.min(best, distanceToSegment(point, points[i - 1], points[i]))
  return best
}

function cross(a: Point, b: Point, p: Point) {
  return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
}

/** Whether two polylines touch or cross anywhere. */
export function polylinesCross(a: Point[], b: Point[]) {
  for (let i = 1; i < a.length; i += 1) {
    for (let j = 1; j < b.length; j += 1) {
      // Closed intervals, so a wire passing exactly through a sampled point of
      // the cut counts: the cut is a hand-drawn line, not a hairline.
      const d1 = cross(b[j - 1], b[j], a[i - 1])
      const d2 = cross(b[j - 1], b[j], a[i])
      const d3 = cross(a[i - 1], a[i], b[j - 1])
      const d4 = cross(a[i - 1], a[i], b[j])
      if (((d1 >= 0 && d2 <= 0) || (d1 <= 0 && d2 >= 0)) && ((d3 >= 0 && d4 <= 0) || (d3 <= 0 && d4 >= 0))) return true
    }
  }
  return false
}

