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

/** The tightest bend a wire may take on its way through a tie, in graph units. */
export const MIN_BEND_RADIUS = 48

/** How far a tied wire runs straight either side of its tie, in graph units. */
export const LANE_LEAD = 12

/** A point a wire passes through; a tie's lane also fixes the wire's heading there. */
export interface Pin {
  point: Point
  heading?: Point
  // Distance of this wire's lane from the tie's centre line, across the heading.
  offset?: number
}

/**
 * Lay out a tie: the heading its wires share, and a lane for each wire, side by
 * side across that heading, LANE_GAP apart. Lanes are ordered by where the
 * wires come from and go to, so wires do not cross on their way in or out.
 */
export function tieLanes(point: Point, ends: Map<string, { from: Point; to: Point }>, gap = LANE_GAP) {
  let hx = 0
  let hy = 0
  for (const { from, to } of ends.values()) {
    const a = unit(point[0] - from[0], point[1] - from[1])
    const b = unit(to[0] - point[0], to[1] - point[1])
    hx += a[0] + b[0]
    hy += a[1] + b[1]
  }
  const heading: Point = Math.hypot(hx, hy) > 1e-6 ? unit(hx, hy) : [1, 0]
  const normal: Point = [-heading[1], heading[0]]
  const side = (p: Point) => (p[0] - point[0]) * normal[0] + (p[1] - point[1]) * normal[1]
  const members = [...ends.keys()].sort((a, b) => {
    const ea = ends.get(a)!
    const eb = ends.get(b)!
    return side(ea.from) + side(ea.to) - side(eb.from) - side(eb.to) || (a < b ? -1 : 1)
  })
  const offsets = new Map<string, number>()
  members.forEach((member, i) => offsets.set(member, (i - (members.length - 1) / 2) * gap))
  return { heading, offsets }
}

export interface WirePlan {
  points: Point[]
  // Index ranges into points where the bend is still tighter than the
  // minimum: the tie is where it is, and there was no room to go wider.
  tight: number[][]
}

/** A wire through its pins. With no pins this returns exactly the stock wire. */
export function routeWire(from: Point, to: Point, pins: Point[]): Point[] {
  return planWire(from, to, pins).points
}

/**
 * Route a wire through its pins. The pins are fixed: the wire always passes
 * through every one of them. Within that, the bend radius is kept at or above
 * `minRadius` where it can be:
 *   1. the heading the wire takes through each pin is turned, a little at a
 *      time, towards whichever lets it bend gentlest;
 *   2. each stretch then widens its curve, going round in a larger arc;
 *   3. a bend that is still too tight is kept, and reported in `tight`.
 * The wire leaves its output and enters its input heading right, like every wire.
 */
export function planWire(from: Point, to: Point, pins: (Point | Pin)[], minRadius = MIN_BEND_RADIUS): WirePlan {
  if (!pins.length) return { points: stockWire(from, to), tight: [] }
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const span = dx * dx + dy * dy || 1
  const along = (point: Point) => ((point[0] - from[0]) * dx + (point[1] - from[1]) * dy) / span
  const ordered = pins.map((pin) => (Array.isArray(pin) ? { point: pin } : pin)).sort((a, b) => along(a.point) - along(b.point))
  // A pin with a heading is a lane of a tie: the wire runs straight along the
  // tie's heading for a short way either side, parallel to its neighbours.
  // Every wire of a tie is planned along the tie's centre line, and then moved
  // sideways onto its own lane. Wires that share a port and a tie share that
  // centre line, so they run side by side, parallel, all the way in.
  const points: Point[] = [from]
  const fixed: (Point | null)[] = [[1, 0]]
  const lanes: number[] = [0]
  for (const pin of ordered) {
    if (!pin.heading) {
      points.push(pin.point)
      fixed.push(null)
      lanes.push(0)
      continue
    }
    const [hx, hy] = pin.heading
    points.push([pin.point[0] - hx * LANE_LEAD, pin.point[1] - hy * LANE_LEAD], [pin.point[0] + hx * LANE_LEAD, pin.point[1] + hy * LANE_LEAD])
    fixed.push(pin.heading, pin.heading)
    lanes.push(pin.offset || 0, pin.offset || 0)
  }
  points.push(to)
  fixed.push([1, 0])
  lanes.push(0)
  // Start from the heading between the points either side of each pin.
  const tangents = points.map((point, i) => fixed[i] || unit(points[i + 1][0] - points[i - 1][0], points[i + 1][1] - points[i - 1][1]))
  for (let i = 1; i < points.length - 1; i += 1) {
    if (fixed[i]) continue
    const score = (trial: Point[]) => Math.min(widestStretch(points, trial, i - 1, minRadius).radius, widestStretch(points, trial, i, minRadius).radius)
    if (score(tangents) >= minRadius) continue
    const base = Math.atan2(tangents[i][1], tangents[i][0])
    let best = tangents[i]
    let bestScore = score(tangents)
    for (const turn of PIN_TURNS) {
      const trial = tangents.slice()
      trial[i] = [Math.cos(base + turn), Math.sin(base + turn)]
      const value = score(trial)
      if (value > bestScore + 1e-6) {
        best = trial[i]
        bestScore = value
      }
      if (bestScore >= minRadius) break
    }
    tangents[i] = best
  }
  const out: Point[] = []
  const tight: number[][] = []
  for (let i = 0; i < points.length - 1; i += 1) {
    const stretch = widestStretch(points, tangents, i, minRadius)
    const lane = toLane(stretch.points, lanes[i], lanes[i + 1])
    const offset = out.length ? out.length - 1 : 0
    out.push(...(out.length ? lane.slice(1) : lane))
    for (const [a, b] of stretch.tight) tight.push([a + offset, b + offset])
  }
  return { points: out, tight }
}

// Move a stretch sideways, square to its own direction, easing from one lane
// offset to the next. Constant offsets keep it exactly parallel to the centre.
function toLane(points: Point[], start: number, end: number): Point[] {
  if (!start && !end) return points
  const last = points.length - 1
  return points.map((point, j) => {
    const t = last ? j / last : 0
    const offset = start + (end - start) * t * t * (3 - 2 * t)
    const a = points[Math.max(0, j - 1)]
    const b = points[Math.min(last, j + 1)]
    const [ux, uy] = unit(b[0] - a[0], b[1] - a[1])
    return [point[0] - uy * offset, point[1] + ux * offset]
  })
}

// Headings tried at a pin, nearest first, so the wire turns only as far as it must.
const PIN_TURNS = [15, -15, 30, -30, 45, -45, 60, -60].map((degrees) => (degrees * Math.PI) / 180)
// How far a stretch may widen its curve, as multiples of its natural handles.
const WIDEN = [1, 1.5, 2, 3, 4]

function unit(x: number, y: number): Point {
  const length = Math.hypot(x, y) || 1
  return [x / length, y / length]
}

// One stretch between two consecutive points, as wide as it needs to be.
function widestStretch(points: Point[], tangents: Point[], i: number, minRadius: number) {
  const a = points[i]
  const b = points[i + 1]
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
  const natural = Math.min(length * 0.4, 600)
  let best: { points: Point[]; radius: number } | null = null
  for (const factor of WIDEN) {
    const k = Math.max(natural * factor, Math.min(minRadius * factor, length))
    const sampled: Point[] = []
    sampleCubic(a, [a[0] + tangents[i][0] * k, a[1] + tangents[i][1] * k], [b[0] - tangents[i + 1][0] * k, b[1] - tangents[i + 1][1] * k], b, sampled)
    const radius = tightestBend(sampled)
    if (!best || radius > best.radius) best = { points: sampled, radius }
    if (radius >= minRadius) break
  }
  return { ...best!, tight: tightSpans(best!.points, minRadius) }
}

function sampleCubic(a: Point, h1: Point, h2: Point, b: Point, out: Point[]) {
  const reach = Math.hypot(h1[0] - a[0], h1[1] - a[1]) + Math.hypot(h2[0] - h1[0], h2[1] - h1[1]) + Math.hypot(b[0] - h2[0], b[1] - h2[1])
  const steps = Math.max(CURVE_STEPS, Math.min(240, Math.ceil(reach / 8)))
  cubic(a[0], a[1], h1[0], h1[1], h2[0], h2[1], b[0], b[1], out, true, steps)
}

// Radius of the circle through three consecutive samples.
function bendAt(points: Point[], j: number) {
  const [ax, ay] = points[j - 1]
  const [bx, by] = points[j]
  const [cx, cy] = points[j + 1]
  const area = Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 2
  if (area < 1e-9) return Infinity
  return (Math.hypot(bx - ax, by - ay) * Math.hypot(cx - bx, cy - by) * Math.hypot(cx - ax, cy - ay)) / (4 * area)
}

/** The tightest bend along a polyline. */
export function tightestBend(points: Point[]) {
  let radius = Infinity
  for (let j = 1; j < points.length - 1; j += 1) radius = Math.min(radius, bendAt(points, j))
  return radius
}

function tightSpans(points: Point[], minRadius: number) {
  const spans: number[][] = []
  for (let j = 1; j < points.length - 1; j += 1) {
    // A little slack, so a bend right at the limit is not flagged.
    if (bendAt(points, j) >= minRadius * 0.9) continue
    const last = spans[spans.length - 1]
    if (last && last[1] >= j - 1) last[1] = j + 1
    else spans.push([j - 1, j + 1])
  }
  return spans
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

/** The tie's band, square to the heading its wires run along. */
export function tieBar(tie: WireTie, gap: number, heading: Point = [0, 1]) {
  const half = tieRadius(tie, gap)
  const nx = -heading[1]
  const ny = heading[0]
  return [[tie.point[0] - nx * half, tie.point[1] - ny * half], [tie.point[0] + nx * half, tie.point[1] + ny * half]]
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

