import { absoluteNodePosition, frameSize } from './frame-geometry'

const DEFAULT_WIDTH = 290
const DEFAULT_HEIGHT = 430
export const FRAME_PADDING = 64
export const FRAME_TITLE_SCREEN_HEIGHT = 42
// LiteGraph draws the title above the node origin, so the box that must not
// overlap is taller than the body stored in `size`.
const NODE_TITLE_BAND = 30
// Neighbouring nodes sit one title bar apart.
const LAYOUT_GAP = NODE_TITLE_BAND
// Nodes outside any section are packed as one block, laid out together.
const LOOSE_BLOCK_ID = '__loose__'
// Each example is its own section. The gutter has to stay obvious at the zoom
// where several sections are on screen; a hairline gap reads as one shared box.
const FRAME_GAP = 200
let elkPromise

interface LayoutNode {
  id: string
  type?: string
  parentNode?: string
  position?: { x: number; y: number }
  selected?: boolean
  width?: number
  height?: number
  dimensions?: { width?: number; height?: number }
  style?: { width?: string; height?: string }
  data?: { inputPorts?: { id: string }[]; outputPorts?: { id: string }[] }
}

interface LayoutEdge {
  id?: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

interface LayoutOptions { originX?: number; originY?: number; columnGap?: number; rowGap?: number; componentGap?: number; entire?: boolean }

function layoutEntity(nodeId: string, parentId: string | undefined, nodeMap: Map<string, LayoutNode>) {
  let node = nodeMap.get(nodeId)
  while (node?.parentNode !== parentId) {
    if (!node?.parentNode) return null
    node = nodeMap.get(node.parentNode)
  }
  return node
}

export function selectedLayoutGroups(nodes: LayoutNode[], edges: LayoutEdge[], { entire = false } = {}) {
  const selected = entire ? [] : nodes.filter((node) => node.selected)
  const nodeMap = new Map(nodes.map((node) => [node.id, node]))
  const selectedIds = new Set(selected.map((node) => node.id))
  const selectedRoots = selected.filter((node) => {
    let parentId = node.parentNode
    while (parentId) {
      if (selectedIds.has(parentId)) return false
      parentId = nodeMap.get(parentId)?.parentNode
    }
    return true
  })
  const singleFrame = selectedRoots.length === 1 && selectedRoots[0].type === 'frame' ? selectedRoots[0] : null
  // Nothing selected: arrange the nodes inside every section. The section box
  // itself is not a graph node, so laying out only parentless nodes leaves the
  // real graph where it was.
  if (!selected.length) {
    const content = nodes.filter((node) => node.type !== 'frame').map((node) => ({
      ...node,
      position: absoluteNodePosition(node, nodeMap),
    }))
    const ids = new Set(content.map((node) => node.id))
    return {
      fitFrameIds: new Set<string>(),
      absolute: true,
      groups: [{
        parentId: undefined,
        nodes: content,
        edges: edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
      }],
    }
  }
  const candidates = singleFrame
    ? nodes.filter((node) => node.parentNode === singleFrame.id)
    : selectedRoots
  const candidateIds = new Set(candidates.map((node) => node.id))
  const groups = new Map<string | undefined, LayoutNode[]>()

  for (const node of candidates) {
    if (node.parentNode && candidateIds.has(node.parentNode)) continue
    const parentId = singleFrame?.id || node.parentNode
    groups.set(parentId, [...(groups.get(parentId) || []), node])
  }

  return {
    fitFrameIds: new Set(singleFrame ? [singleFrame.id] : []),
    absolute: false,
    groups: packGroups(groups, edges, nodeMap),
  }
}

function packGroups(groups: Map<string | undefined, LayoutNode[]>, edges: LayoutEdge[], nodeMap: Map<string, LayoutNode>) {
  return [...groups].map(([parentId, groupNodes]) => {
    const groupIds = new Set(groupNodes.map((node) => node.id))
    const groupEdges = edges.flatMap((edge) => {
      const source = layoutEntity(edge.source, parentId, nodeMap)
      const target = layoutEntity(edge.target, parentId, nodeMap)
      if (!source || !target || source.id === target.id || !groupIds.has(source.id) || !groupIds.has(target.id)) return []
      return [{ ...edge, source: source.id, target: target.id }]
    })
    return { parentId, nodes: groupNodes, edges: groupEdges }
  })
}

export async function layoutSelection(nodes: LayoutNode[], edges: LayoutEdge[], options: LayoutOptions = {}) {
  const plan = selectedLayoutGroups(nodes, edges, { entire: options.entire })
  if (plan.absolute) {
    return { positions: await layoutPackedFrames(nodes, edges, options), fitFrameIds: plan.fitFrameIds, absolute: true }
  }
  const positions = new Map<string, { x: number; y: number }>()
  for (const group of plan.groups) {
    if (!group.nodes.length) continue
    const originX = Math.min(...group.nodes.map((node) => node.position?.x || 0))
    const originY = Math.min(...group.nodes.map((node) => node.position?.y || 0))
    const groupPositions = await layoutCanvas(group.nodes, group.edges, { ...options, originX, originY })
    for (const [id, position] of groupPositions) positions.set(id, position)
  }
  return { positions, fitFrameIds: plan.fitFrameIds, absolute: plan.absolute }
}

// The whole canvas is a hierarchy, and ELK lays out one level at a time.
// Children are arranged inside their section first. Each section then becomes
// one box, and a second ELK pass places those boxes so the sections themselves
// cannot overlap. One flat pass leaves the padding of neighbouring sections on
// top of each other.
async function layoutPackedFrames(nodes: LayoutNode[], edges: LayoutEdge[], options: LayoutOptions) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]))
  const frames = nodes.filter((node) => node.type === 'frame')
  const frameIds = new Set(frames.map((frame) => frame.id))
  const members = new Map<string, LayoutNode[]>()
  const loose: LayoutNode[] = []
  for (const node of nodes) {
    if (node.type === 'frame') continue
    if (node.parentNode && frameIds.has(node.parentNode)) {
      members.set(node.parentNode, [...(members.get(node.parentNode) || []), node])
    } else {
      loose.push(node)
    }
  }

  const insets = frameInsets()
  const blocks: {
    id: string
    width: number
    height: number
    x: number
    y: number
    kind: 'frame' | 'loose'
    local?: Map<string, { x: number; y: number }>
    left?: number
    top?: number
  }[] = []
  const looseIds = new Set(loose.map((node) => node.id))

  for (const frame of frames) {
    const children = members.get(frame.id) || []
    const framePos = absoluteNodePosition(frame, nodeMap)
    const childIds = new Set(children.map((child) => child.id))
    const childEdges = edges.filter((edge) => childIds.has(edge.source) && childIds.has(edge.target))
    const local = children.length
      ? await layoutCanvas(children, childEdges, { originX: 0, originY: 0, columnGap: options.columnGap, rowGap: options.rowGap })
      : null
    let left = Infinity
    let top = Infinity
    let right = -Infinity
    let bottom = -Infinity
    if (local) {
      for (const child of children) {
        const position = local.get(child.id)
        if (!position) continue
        const size = sizeOf(child)
        left = Math.min(left, position.x)
        top = Math.min(top, position.y)
        right = Math.max(right, position.x + size.width)
        bottom = Math.max(bottom, position.y + size.height)
      }
    }
    if (!local || !Number.isFinite(left)) {
      const size = frameSize(frame)
      blocks.push({ id: frame.id, width: size.width, height: size.height, x: framePos.x, y: framePos.y, kind: 'frame' })
      continue
    }
    blocks.push({
      id: frame.id,
      width: right - left + insets.left + insets.right,
      height: bottom - top + insets.top + insets.bottom,
      x: framePos.x,
      y: framePos.y,
      kind: 'frame',
      local,
      left,
      top,
    })
  }

  // One block per loose node spaced them a section gap apart. Lay them out
  // together so they get the normal node spacing.
  if (loose.length) {
    const looseEdges = edges.filter((edge) => looseIds.has(edge.source) && looseIds.has(edge.target))
    const local = await layoutCanvas(loose, looseEdges, { originX: 0, originY: 0, columnGap: options.columnGap, rowGap: options.rowGap })
    let left = Infinity
    let top = Infinity
    let right = -Infinity
    let bottom = -Infinity
    for (const node of loose) {
      const position = local.get(node.id)!
      const size = sizeOf(node)
      left = Math.min(left, position.x)
      top = Math.min(top, position.y - NODE_TITLE_BAND)
      right = Math.max(right, position.x + size.width)
      bottom = Math.max(bottom, position.y + size.height)
    }
    blocks.push({ id: LOOSE_BLOCK_ID, width: right - left, height: bottom - top, x: 0, y: 0, kind: 'loose', local, left, top })
  }

  // Keep the document order. Sorting by current position made each run feed
  // ELK a different order, so pressing Auto layout again moved everything.
  const blockIds = new Set(blocks.map((block) => block.id))
  const ownerOf = (id: string) => {
    const node = nodeMap.get(id)
    if (!node) return null
    if (node.type === 'frame') return node.id
    if (node.parentNode && frameIds.has(node.parentNode)) return node.parentNode
    return looseIds.has(node.id) ? LOOSE_BLOCK_ID : node.id
  }
  const seenEdges = new Set<string>()
  const packEdges: { id: string; sources: string[]; targets: string[] }[] = []
  for (const edge of edges) {
    const source = ownerOf(edge.source)
    const target = ownerOf(edge.target)
    if (!source || !target || source === target || !blockIds.has(source) || !blockIds.has(target)) continue
    const key = `${source}->${target}`
    if (seenEdges.has(key)) continue
    seenEdges.add(key)
    packEdges.push({ id: key, sources: [source], targets: [target] })
  }

  const elk = await getElk()
  const packed = await elk.layout({
    id: 'frames',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': String(FRAME_GAP),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(FRAME_GAP),
      'elk.separateConnectedComponents': 'true',
      'elk.spacing.componentComponent': String(FRAME_GAP),
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.padding': '[top=0,left=0,bottom=0,right=0]',
    },
    children: blocks.map((block) => ({ id: block.id, width: block.width, height: block.height })),
    edges: packEdges,
  })
  const packedBoxes = packed.children.map((child) => {
    const block = blocks.find((item) => item.id === child.id)!
    return { ...block, x: child.x, y: child.y, w: block.width, h: block.height }
  })
  pushBoxesApart(packedBoxes, FRAME_GAP)

  const content = nodes.filter((node) => node.type !== 'frame')
  const originX = content.length ? Math.min(...content.map((node) => absoluteNodePosition(node, nodeMap).x)) : 0
  const originY = content.length ? Math.min(...content.map((node) => absoluteNodePosition(node, nodeMap).y)) : 0
  const placed = new Map<string, { x: number; y: number }>()
  for (const box of packedBoxes) {
    if (box.kind === 'loose') {
      for (const [id, position] of box.local!) {
        placed.set(id, { x: originX + box.x + (position.x - box.left!), y: originY + box.y + (position.y - box.top!) })
      }
      continue
    }
    if (!box.local || box.left === undefined || box.top === undefined) {
      placed.set(box.id, { x: originX + box.x, y: originY + box.y })
      continue
    }
    for (const [id, position] of box.local) {
      placed.set(id, {
        x: originX + box.x + insets.left + (position.x - box.left),
        y: originY + box.y + insets.top + (position.y - box.top),
      })
    }
  }
  // Pin the top-left corner of the content where it was, so the graph does not
  // creep across the canvas a little on every run.
  let placedX = Infinity
  let placedY = Infinity
  for (const node of content) {
    const position = placed.get(node.id)
    if (!position) continue
    const parent = node.parentNode ? placed.get(node.parentNode) : null
    if (parent) continue
    placedX = Math.min(placedX, position.x)
    placedY = Math.min(placedY, position.y)
  }
  if (Number.isFinite(placedX) && Number.isFinite(placedY)) {
    const dx = originX - placedX
    const dy = originY - placedY
    for (const position of placed.values()) {
      position.x += dx
      position.y += dy
    }
  }
  return placed
}

function getElk() {
  elkPromise ||= import('elkjs/lib/elk.bundled.js').then(({ default: ELK }) => new ELK())
  return elkPromise
}

function sizeOf(node: LayoutNode) {
  return {
    width: node.dimensions?.width || node.width || DEFAULT_WIDTH,
    height: node.dimensions?.height || node.height || DEFAULT_HEIGHT,
  }
}

function linearComponents(nodes: LayoutNode[], edges: LayoutEdge[]) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]))
  const incoming = new Map(nodes.map((node) => [node.id, new Set<string>()]))
  const outgoing = new Map(nodes.map((node) => [node.id, new Set<string>()]))
  for (const edge of edges) {
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target) || edge.source === edge.target) continue
    outgoing.get(edge.source)!.add(edge.target)
    incoming.get(edge.target)!.add(edge.source)
  }

  const visited = new Set<string>()
  const components: LayoutNode[][] = []
  for (const node of nodes) {
    if (visited.has(node.id)) continue
    const component: LayoutNode[] = []
    const pending = [node.id]
    while (pending.length) {
      const id = pending.pop()!
      if (visited.has(id)) continue
      visited.add(id)
      component.push(nodeMap.get(id)!)
      pending.push(...incoming.get(id)!, ...outgoing.get(id)!)
    }

    const edgeCount = component.reduce((count, item) => count + outgoing.get(item.id)!.size, 0)
    const isLinear = edgeCount === component.length - 1 && component.every((item) =>
      incoming.get(item.id)!.size <= 1 && outgoing.get(item.id)!.size <= 1
    )
    if (isLinear) components.push(component)
  }
  return components
}

// Insets are persisted through the frame's size and its children's positions, so
// they must not depend on zoom: two clients at different zoom levels would each
// refit the frame to their own answer, re-save it, and bounce it back forever.
// The title renders outside the frame at a screen-constant scale; the clearance
// it needs is reserved here as a fixed flow-space amount.

function downstreamChains(nodes: LayoutNode[], edges: LayoutEdge[]) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]))
  const incoming = new Map(nodes.map((node) => [node.id, new Set<string>()]))
  const outgoing = new Map(nodes.map((node) => [node.id, new Set<string>()]))
  for (const edge of edges) {
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target) || edge.source === edge.target) continue
    outgoing.get(edge.source)!.add(edge.target)
    incoming.get(edge.target)!.add(edge.source)
  }

  const chains: LayoutNode[][] = []
  for (const node of nodes) {
    if (incoming.get(node.id)!.size < 2 || outgoing.get(node.id)!.size > 1) continue
    const chain = [node]
    let current = node
    while (outgoing.get(current.id)!.size === 1) {
      const next = nodeMap.get([...outgoing.get(current.id)!][0])!
      if (incoming.get(next.id)!.size > 1) break
      chain.push(next)
      current = next
    }
    if (chain.length > 1) chains.push(chain)
  }
  return chains
}

export function frameInsets() {
  return {
    left: FRAME_PADDING,
    right: FRAME_PADDING,
    top: FRAME_PADDING + FRAME_TITLE_SCREEN_HEIGHT,
    bottom: FRAME_PADDING,
  }
}

export function frameComponentGap(spacing = 32) {
  const insets = frameInsets()
  return insets.bottom + insets.top + FRAME_TITLE_SCREEN_HEIGHT + spacing
}

export async function layoutCanvas(nodes: LayoutNode[], edges: LayoutEdge[], { originX = 0, originY = 120, columnGap = 100, rowGap = LAYOUT_GAP, componentGap = rowGap * 1.5 }: LayoutOptions = {}) {
  if (!nodes.length) return new Map()

  const nodeIds = new Set(nodes.map((node) => node.id))
  // When a node declares its ports, pin their order so ELK aligns fan-out/fan-in
  // by port (e.g. front/back/left/right) instead of by incoming data order — this
  // is what keeps the generated views stacked in the same order as the ports they
  // connect, with no crossing lines.
  const portIds = new Set()
  const children = nodes.map((node) => {
    const size = sizeOf(node)
    const child = { id: node.id, width: size.width, height: size.height + NODE_TITLE_BAND }
    const inputs = node.data?.inputPorts || []
    const outputs = node.data?.outputPorts || []
    if (!inputs.length && !outputs.length) return child
    child.layoutOptions = { 'elk.portConstraints': 'FIXED_ORDER' }
    child.ports = [
      // West side is numbered bottom→top, so reverse to keep list order top→bottom.
      ...inputs.map((port, index) => {
        const id = `${node.id}::in::${port.id}`
        portIds.add(id)
        return { id, layoutOptions: { 'elk.port.side': 'WEST', 'elk.port.index': String(inputs.length - 1 - index) } }
      }),
      // East side is numbered top→bottom, matching list order.
      ...outputs.map((port, index) => {
        const id = `${node.id}::out::${port.id}`
        portIds.add(id)
        return { id, layoutOptions: { 'elk.port.side': 'EAST', 'elk.port.index': String(index) } }
      }),
    ]
    return child
  })
  const graph = {
    id: 'canvas',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'SPLINES',
      'elk.spacing.nodeNode': String(rowGap),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(columnGap),
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.separateConnectedComponents': 'true',
      'elk.spacing.componentComponent': String(componentGap),
      'elk.padding': '[top=0,left=0,bottom=0,right=0]',
    },
    children,
    edges: edges
      .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target) && edge.source !== edge.target)
      .map((edge, index) => {
        const source = `${edge.source}::out::${edge.sourceHandle}`
        const target = `${edge.target}::in::${edge.targetHandle}`
        return {
          id: edge.id || `layout-edge-${index}-${edge.source}-${edge.target}`,
          sources: [portIds.has(source) ? source : edge.source],
          targets: [portIds.has(target) ? target : edge.target],
        }
      }),
  }

  const elk = await getElk()
  const result = await elk.layout(graph)
  const positions = new Map(result.children.map((node) => [node.id, { x: originX + node.x, y: originY + node.y + NODE_TITLE_BAND }]))
  for (const component of linearComponents(nodes, edges)) {
    const tallest = component.reduce((current, node) => sizeOf(node).height > sizeOf(current).height ? node : current)
    const rowY = positions.get(tallest.id)!.y
    for (const node of component) positions.get(node.id)!.y = rowY
  }
  for (const chain of downstreamChains(nodes, edges)) {
    const tallest = chain.reduce((current, node) => sizeOf(node).height > sizeOf(current).height ? node : current)
    const rowY = positions.get(tallest.id)!.y
    for (const node of chain) positions.get(node.id)!.y = rowY
  }
  separateBoxes(nodes, positions)
  return positions
}

// ELK can still leave two boxes crossing when a later alignment pass slides a
// node onto its neighbour. Push the lower or right-hand node until every pair
// has a gap, counting the title band as part of the box.
function separateBoxes(nodes: LayoutNode[], positions: Map<string, { x: number; y: number }>) {
  const boxes = nodes.flatMap((node) => {
    const pos = positions.get(node.id)
    if (!pos) return []
    const size = sizeOf(node)
    return [{ id: node.id, x: pos.x, y: pos.y - NODE_TITLE_BAND, w: size.width, h: size.height + NODE_TITLE_BAND }]
  })
  pushBoxesApart(boxes, LAYOUT_GAP)
  for (const box of boxes) positions.set(box.id, { x: box.x, y: box.y + NODE_TITLE_BAND })
}

// ELK can still leave two boxes crossing. Push the lower or right-hand box
// until every pair has a gap.
function pushBoxesApart(boxes: { x: number; y: number; w: number; h: number }[], gap: number) {
  for (let pass = 0; pass < 16; pass += 1) {
    let moved = false
    boxes.sort((a, b) => a.y - b.y || a.x - b.x)
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]
        const b = boxes[j]
        const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
        const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
        const gapX = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w)
        const gapY = Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h)
        if (overlapX > 0 && overlapY > 0) {
          if (overlapX < overlapY) b.x = a.x + a.w + gap
          else b.y = a.y + a.h + gap
          moved = true
        } else if (overlapX > 0 && gapY >= 0 && gapY < gap) {
          b.y = a.y + a.h + gap
          moved = true
        } else if (overlapY > 0 && gapX >= 0 && gapX < gap) {
          b.x = a.x + a.w + gap
          moved = true
        }
      }
    }
    if (!moved) break
  }
}
