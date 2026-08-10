const DEFAULT_WIDTH = 290
const DEFAULT_HEIGHT = 430
export const FRAME_PADDING = 64
export const FRAME_TITLE_SCREEN_HEIGHT = 42
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
  data?: { inputPorts?: { id: string }[]; outputPorts?: { id: string }[] }
}

interface LayoutEdge {
  id?: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

interface LayoutOptions { originX?: number; originY?: number; columnGap?: number; rowGap?: number; componentGap?: number }

function layoutEntity(nodeId: string, parentId: string | undefined, nodeMap: Map<string, LayoutNode>) {
  let node = nodeMap.get(nodeId)
  while (node?.parentNode !== parentId) {
    if (!node?.parentNode) return null
    node = nodeMap.get(node.parentNode)
  }
  return node
}

export function selectedLayoutGroups(nodes: LayoutNode[], edges: LayoutEdge[]) {
  const selected = nodes.filter((node) => node.selected)
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
  const candidates = singleFrame
    ? nodes.filter((node) => node.parentNode === singleFrame.id)
    : (selectedRoots.length ? selectedRoots : nodes.filter((node) => !node.parentNode))
  const candidateIds = new Set(candidates.map((node) => node.id))
  const groups = new Map<string | undefined, LayoutNode[]>()

  for (const node of candidates) {
    if (node.parentNode && candidateIds.has(node.parentNode)) continue
    const parentId = singleFrame?.id || node.parentNode
    groups.set(parentId, [...(groups.get(parentId) || []), node])
  }

  return {
    fitFrameIds: new Set(singleFrame ? [singleFrame.id] : []),
    groups: [...groups].map(([parentId, groupNodes]) => {
      const groupIds = new Set(groupNodes.map((node) => node.id))
      const groupEdges = edges.flatMap((edge) => {
        const source = layoutEntity(edge.source, parentId, nodeMap)
        const target = layoutEntity(edge.target, parentId, nodeMap)
        if (!source || !target || source.id === target.id || !groupIds.has(source.id) || !groupIds.has(target.id)) return []
        return [{ ...edge, source: source.id, target: target.id }]
      })
      return { parentId, nodes: groupNodes, edges: groupEdges }
    }),
  }
}

export async function layoutSelection(nodes: LayoutNode[], edges: LayoutEdge[], options: LayoutOptions = {}) {
  const plan = selectedLayoutGroups(nodes, edges)
  const positions = new Map<string, { x: number; y: number }>()
  for (const group of plan.groups) {
    if (!group.nodes.length) continue
    const originX = Math.min(...group.nodes.map((node) => node.position?.x || 0))
    const originY = Math.min(...group.nodes.map((node) => node.position?.y || 0))
    const groupPositions = await layoutCanvas(group.nodes, group.edges, { ...options, originX, originY })
    for (const [id, position] of groupPositions) positions.set(id, position)
  }
  return { positions, fitFrameIds: plan.fitFrameIds }
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

export async function layoutCanvas(nodes: LayoutNode[], edges: LayoutEdge[], { originX = 0, originY = 120, columnGap = 100, rowGap = 80, componentGap = rowGap * 1.5 }: LayoutOptions = {}) {
  if (!nodes.length) return new Map()

  const nodeIds = new Set(nodes.map((node) => node.id))
  // When a node declares its ports, pin their order so ELK aligns fan-out/fan-in
  // by port (e.g. front/back/left/right) instead of by incoming data order — this
  // is what keeps the generated views stacked in the same order as the ports they
  // connect, with no crossing lines.
  const portIds = new Set()
  const children = nodes.map((node) => {
    const child = { id: node.id, ...sizeOf(node) }
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
  const positions = new Map(result.children.map((node) => [node.id, { x: originX + node.x, y: originY + node.y }]))
  for (const component of linearComponents(nodes, edges)) {
    const tallest = component.reduce((current, node) => sizeOf(node).height > sizeOf(current).height ? node : current)
    const rowY = positions.get(tallest.id)!.y
    for (const node of component) positions.get(node.id)!.y = rowY
  }
  return positions
}
