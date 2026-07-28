const DEFAULT_WIDTH = 290
const DEFAULT_HEIGHT = 430
export const FRAME_PADDING = 64
export const FRAME_TITLE_SCREEN_HEIGHT = 42
let elkPromise

function getElk() {
  elkPromise ||= import('elkjs/lib/elk.bundled.js').then(({ default: ELK }) => new ELK())
  return elkPromise
}

function sizeOf(node) {
  return {
    width: node.dimensions?.width || node.width || DEFAULT_WIDTH,
    height: node.dimensions?.height || node.height || DEFAULT_HEIGHT,
  }
}

export function frameInsets(zoom = 1) {
  const safeZoom = Math.max(Number(zoom) || 1, 0.01)
  return {
    left: FRAME_PADDING,
    right: FRAME_PADDING,
    top: FRAME_PADDING + FRAME_TITLE_SCREEN_HEIGHT / safeZoom,
    bottom: FRAME_PADDING,
  }
}

export function frameComponentGap(zoom = 1, spacing = 32) {
  const insets = frameInsets(zoom)
  return insets.bottom + insets.top + FRAME_TITLE_SCREEN_HEIGHT / Math.max(Number(zoom) || 1, 0.01) + spacing
}

export async function layoutWorkflow(nodes, edges, { originX = 0, originY = 120, columnGap = 100, rowGap = 80, componentGap = rowGap * 1.5 } = {}) {
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
    id: 'workflow',
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
  return new Map(result.children.map((node) => [node.id, { x: originX + node.x, y: originY + node.y }]))
}
