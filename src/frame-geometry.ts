const DEFAULT_NODE_WIDTH = 260
const DEFAULT_NODE_HEIGHT = 430
const DEFAULT_FRAME_WIDTH = 900
const DEFAULT_FRAME_HEIGHT = 600

interface Point { x: number; y: number }
interface Insets { left: number; right: number; top: number; bottom: number }
interface Bounds { left: number; top: number; right: number; bottom: number }

interface GeometryNode {
  id: string
  type?: string
  parentNode?: string
  position?: Point
  positionAbsolute?: Point
  width?: number
  height?: number
  dimensions?: { width?: number; height?: number }
  style?: Record<string, any>
  data?: Record<string, any>
  selected?: boolean
  [key: string]: any
}

export function indexNodes(nodes: GeometryNode[]) {
  return new Map(nodes.map((node) => [node.id, node]))
}

export function nodeSize(node: GeometryNode) {
  return {
    width: Number(node.dimensions?.width || node.width || DEFAULT_NODE_WIDTH),
    height: Number(node.dimensions?.height || node.height || DEFAULT_NODE_HEIGHT),
  }
}

// Vue Flow renders a node's size from style.width/height when present (it
// prioritises that over node.width), so read the current size from there first —
// otherwise a stale style.width (e.g. left behind by expandParent) freezes the
// frame and leaves dead space.
export function frameSize(frame: GeometryNode) {
  return {
    width: Number(parseFloat(frame.style?.width) || frame.width || frame.dimensions?.width || DEFAULT_FRAME_WIDTH),
    height: Number(parseFloat(frame.style?.height) || frame.height || frame.dimensions?.height || DEFAULT_FRAME_HEIGHT),
  }
}

export function absoluteNodePosition(node: GeometryNode, nodeMap: Map<string, GeometryNode>): Point {
  if (node.positionAbsolute) return { x: node.positionAbsolute.x, y: node.positionAbsolute.y }
  const position = node.position || { x: 0, y: 0 }
  if (!node.parentNode) return { x: position.x, y: position.y }

  const parent = nodeMap.get(node.parentNode)
  if (!parent) return { x: position.x, y: position.y }
  const parentPosition = absoluteNodePosition(parent, nodeMap)
  return { x: parentPosition.x + position.x, y: parentPosition.y + position.y }
}

function boundsOf(nodes: GeometryNode[]): Bounds {
  return {
    left: Math.min(...nodes.map((node) => node.position.x)),
    top: Math.min(...nodes.map((node) => node.position.y)),
    right: Math.max(...nodes.map((node) => node.position.x + nodeSize(node).width)),
    bottom: Math.max(...nodes.map((node) => node.position.y + nodeSize(node).height)),
  }
}

function framedSize(bounds: Bounds, insets: Insets) {
  return {
    width: bounds.right - bounds.left + insets.left + insets.right,
    height: bounds.bottom - bounds.top + insets.top + insets.bottom,
  }
}

// Resize every auto-sized frame to its children and shift those children so the
// content sits inside the frame's insets. Returns a new node list; `changed` is
// false when every frame already fits, so callers can skip the write.
export function fitFrameNodes(nodes: GeometryNode[], insets: Insets, frameIds?: Set<string>) {
  let changed = false
  const nextNodes = [...nodes]
  const nodeIndexes = new Map(nextNodes.map((node, index) => [node.id, index]))

  for (const frame of nextNodes.filter((node) => node.type === 'frame' && (!frameIds || frameIds.has(node.id)))) {
    if (frame.data?.manualSize) continue
    const children = nextNodes.filter((node) => node.parentNode === frame.id)
    if (!children.length) continue
    const bounds = boundsOf(children)
    const { width, height } = framedSize(bounds, insets)
    const current = frameSize(frame)
    const offset = { x: insets.left - bounds.left, y: insets.top - bounds.top }
    if (Math.abs(current.width - width) < 0.5 && Math.abs(current.height - height) < 0.5 && Math.abs(offset.x) < 0.5 && Math.abs(offset.y) < 0.5) continue

    changed = true
    nextNodes[nodeIndexes.get(frame.id)] = {
      ...frame,
      width,
      height,
      style: { ...frame.style, width: `${width}px`, height: `${height}px` },
    }
    for (const child of children) {
      nextNodes[nodeIndexes.get(child.id)] = {
        ...child,
        position: {
          x: child.position.x + offset.x,
          y: child.position.y + offset.y,
        },
      }
    }
  }

  return { nodes: nextNodes, changed }
}

// A drag snapshot carries its own measured size; fall back to the stored node.
function draggedSize(draggedNode: GeometryNode, node: GeometryNode) {
  return {
    width: Number(draggedNode.dimensions?.width || draggedNode.width || node.dimensions?.width || node.width || DEFAULT_NODE_WIDTH),
    height: Number(draggedNode.dimensions?.height || draggedNode.height || node.dimensions?.height || node.height || DEFAULT_NODE_HEIGHT),
  }
}

function overlapArea(position: Point, size: { width: number; height: number }, framePosition: Point, frameBox: { width: number; height: number }) {
  return Math.max(0, Math.min(position.x + size.width, framePosition.x + frameBox.width) - Math.max(position.x, framePosition.x))
    * Math.max(0, Math.min(position.y + size.height, framePosition.y + frameBox.height) - Math.max(position.y, framePosition.y))
}

// Re-parent dropped nodes to whichever frame they overlap most, converting the
// position into that frame's local space (or back to global when dropped out).
export function reparentDraggedNodes(nodes: GeometryNode[], draggedNodes: GeometryNode[] = []) {
  const nextNodes = [...nodes]
  const nodeMap = indexNodes(nextNodes)
  const frames = nextNodes.filter((node) => node.type === 'frame')
  if (!draggedNodes.length) return { nodes: nextNodes, changed: false }

  let changed = false
  for (const draggedNode of draggedNodes) {
    const node = nodeMap.get(draggedNode.id)
    if (!node || node.type === 'frame') continue

    const position = absoluteNodePosition(draggedNode, nodeMap)
    const size = draggedSize(draggedNode, node)
    const oldParent = node.parentNode
    const containingFrames = frames
      .filter((frame) => frame.id !== node.id)
      .map((frame) => {
        const framePosition = absoluteNodePosition(frame, nodeMap)
        const frameBox = frameSize(frame)
        const overlap = overlapArea(position, size, framePosition, frameBox)
        return { frame, framePosition, overlap }
      })
      .filter(({ overlap }) => overlap > 0)
      .sort((left, right) => right.overlap - left.overlap)
    const nextParent = containingFrames[0]?.frame || null

    if (nextParent?.id === oldParent) continue
    const nextParentPosition = nextParent ? containingFrames[0].framePosition : { x: 0, y: 0 }
    const nodeIndex = nextNodes.findIndex((item) => item.id === node.id)
    const updatedNode = {
      ...node,
      parentNode: nextParent?.id,
      position: {
        x: position.x - nextParentPosition.x,
        y: position.y - nextParentPosition.y,
      },
    }
    nextNodes[nodeIndex] = updatedNode
    nodeMap.set(node.id, updatedNode)
    changed = true
  }

  return { nodes: nextNodes, changed }
}

// Moving a frame over root nodes has the same ownership semantics as moving
// those nodes into the frame. Existing children already ride with their parent.
export function adoptNodesCoveredByDraggedFrames(nodes: GeometryNode[], draggedNodes: GeometryNode[] = []) {
  const nextNodes = [...nodes]
  const nodeMap = indexNodes(nextNodes)
  const draggedFrames = draggedNodes
    .map((dragged) => ({ dragged, frame: nodeMap.get(dragged.id) }))
    .filter(({ frame }) => frame?.type === 'frame')
  if (!draggedFrames.length) return { nodes: nextNodes, changed: false }

  let changed = false
  for (const node of nextNodes) {
    if (node.type === 'frame' || node.parentNode) continue
    const position = absoluteNodePosition(node, nodeMap)
    const size = nodeSize(node)
    const coveringFrames = draggedFrames
      .map(({ dragged, frame }) => {
        const framePosition = absoluteNodePosition(dragged, nodeMap)
        const overlap = overlapArea(position, size, framePosition, frameSize(frame))
        return { frame, framePosition, overlap }
      })
      .filter(({ overlap }) => overlap > 0)
      .sort((left, right) => right.overlap - left.overlap)
    const owner = coveringFrames[0]
    if (!owner) continue

    const nodeIndex = nextNodes.findIndex((item) => item.id === node.id)
    const updatedNode = {
      ...node,
      parentNode: owner.frame.id,
      position: {
        x: position.x - owner.framePosition.x,
        y: position.y - owner.framePosition.y,
      },
    }
    nextNodes[nodeIndex] = updatedNode
    nodeMap.set(node.id, updatedNode)
    changed = true
  }

  return { nodes: nextNodes, changed }
}

export function pointInAnyFrame(point: Point, nodes: GeometryNode[]) {
  const nodeMap = indexNodes(nodes)
  return nodes.some((node) => {
    if (node.type !== 'frame') return false
    const position = absoluteNodePosition(node, nodeMap)
    const { width, height } = frameSize(node)
    return point.x >= position.x && point.x <= position.x + width && point.y >= position.y && point.y <= position.y + height
  })
}

// Wrap the selected nodes in a new frame. The frame is placed at the selection's
// padded top-left, and the selected nodes become children in its local space.
export function buildSelectionFrame(nodes: GeometryNode[], selected: GeometryNode[], { insets, frameId }: { insets: Insets; frameId: string }) {
  const bounds = boundsOf(selected)
  const { width, height } = framedSize(bounds, insets)
  const framePosition = { x: bounds.left - insets.left, y: bounds.top - insets.top }
  const selectedIds = new Set(selected.map((node) => node.id))
  const frame = {
    id: frameId,
    type: 'frame',
    position: framePosition,
    width,
    height,
    selected: true,
    style: { pointerEvents: 'none' },
    data: { label: 'Canvas section', description: '' },
  }
  const children = nodes.map((node) => selectedIds.has(node.id)
    ? {
        ...node,
        parentNode: frameId,
        position: { x: node.position.x - framePosition.x, y: node.position.y - framePosition.y },
        selected: false,
      }
    : { ...node, selected: false })

  return [frame, ...children]
}

// The auto layout works in a single global space, but a framed child's position
// is stored relative to its frame's origin. Anchor each frame to the top-left of
// its (padded) children, then convert children back into that local space.
export function applyLayoutPositions(nodes: GeometryNode[], positions: Map<string, Point>, insets: Insets) {
  const frameBounds = new Map<string, Bounds>()
  for (const node of nodes) {
    if (node.type === 'frame' || !node.parentNode) continue
    const position = positions.get(node.id)
    if (!position) continue
    const size = nodeSize(node)
    const bounds = frameBounds.get(node.parentNode) || { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }
    bounds.left = Math.min(bounds.left, position.x)
    bounds.top = Math.min(bounds.top, position.y)
    bounds.right = Math.max(bounds.right, position.x + size.width)
    bounds.bottom = Math.max(bounds.bottom, position.y + size.height)
    frameBounds.set(node.parentNode, bounds)
  }
  const frameOrigins = new Map<string, Point>()
  for (const [frameId, bounds] of frameBounds) {
    frameOrigins.set(frameId, { x: bounds.left - insets.left, y: bounds.top - insets.top })
  }

  return nodes.map((node) => {
    if (node.type === 'frame') {
      const bounds = frameBounds.get(node.id)
      if (!bounds) return node
      const origin = frameOrigins.get(node.id)
      const { width, height } = framedSize(bounds, insets)
      return { ...node, position: origin, width, height, style: { ...node.style, width: `${width}px`, height: `${height}px` } }
    }
    const position = positions.get(node.id)
    if (!position) return node
    const origin = node.parentNode ? frameOrigins.get(node.parentNode) : null
    return { ...node, position: origin ? { x: position.x - origin.x, y: position.y - origin.y } : position }
  })
}
