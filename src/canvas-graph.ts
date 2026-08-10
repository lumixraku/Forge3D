import { canConnectNodeTypes, canConnectPorts, nodeCatalog, nodeDefinition, nodeDisplayName, nodeInputPorts, nodeOutputPorts } from './canvas-nodes'
import { normalizeNodeConfig } from './canvas-schema'

export const edgeDefaults = { selectable: true, type: 'execution' }
export const nodePresentation = Object.fromEntries(nodeCatalog.map((node) => [node.type, [node.presentation.kind, node.presentation.detail, node.presentation.tone]]))

// Turn a stored canvas document into the { nodes, edges } pair Vue Flow renders.
export function toCanvasGraph(canvas) {
  const canvasNodes = new Map(canvas.nodes.map((node) => [node.id, node]))
  // Child positions are persisted in the parent's local coordinate space.
  const positions = new Map(canvas.nodes.map((node) => [node.id, node.ui.position || { x: 0, y: 0 }]))
  // VueFlow requires a parent node to be present before its children.
  const nodes = [...canvas.nodes].sort((left, right) => (left.type === 'frame' ? -1 : 0) - (right.type === 'frame' ? -1 : 0)).map((node) => {
    if (node.type === 'frame') {
      return {
        id: node.id,
        type: 'frame',
        position: positions.get(node.id),
        width: node.ui.size?.width || 900,
        height: node.ui.size?.height || 600,
        // Let the frame body pass clicks through to the edges/child nodes beneath
        // it; the header (see FrameNode.vue) re-enables pointer events as the handle.
        style: { pointerEvents: 'none' },
        data: { label: node.name, description: node.config?.description || '', manualSize: Boolean(node.config?.manualSize) },
      }
    }
    const type = node.type === 'split' ? 'segments' : node.type
    const [kind, detail, tone] = nodePresentation[type] || ['STEP', type, 'cyan']
    return {
      id: node.id,
      type: 'canvas',
      position: positions.get(node.id),
      parentNode: node.ui.parentFrameId,
      // No extent/expandParent: those let Vue Flow lock children inside the frame
      // and live-resize it mid-drag. The frame is only refit on drag stop (fitFrames).
      data: {
        kind,
        label: nodeDisplayName(type, node.name),
        detail,
        tone,
        status: 'ready',
        canvasType: type,
        config: normalizeNodeConfig(type, node.config),
        inputTypes: nodeDefinition(type)?.inputTypes || [],
        outputType: nodeDefinition(type)?.outputType || null,
        inputPorts: nodeInputPorts(type),
        outputPorts: nodeOutputPorts(type),
      },
    }
  })
  // The canvas has one visual Input/Output connection per node pair. Logical
  // ports remain attached as edge data and are restored when the canvas saves.
  const seenEdges = new Set()
  const edges = canvas.edges
    .map((edge) => {
      const sourceType = canvasNodes.get(edge.source.nodeId)?.type
      const targetType = canvasNodes.get(edge.target.nodeId)?.type
      const key = `${edge.source.nodeId}->${edge.target.nodeId}`
      if (!sourceType || !targetType || !canConnectNodeTypes(sourceType, targetType) || seenEdges.has(key)) return null
      seenEdges.add(key)
      const logicalConnections = canvas.edges
        .filter((candidate) => candidate.source.nodeId === edge.source.nodeId && candidate.target.nodeId === edge.target.nodeId)
        .map((candidate) => ({ sourcePort: candidate.source.port, targetPort: candidate.target.port }))
      return {
        id: edge.id,
        source: edge.source.nodeId,
        target: edge.target.nodeId,
        sourceHandle: 'output',
        targetHandle: 'input',
        data: { logicalConnections },
        ...edgeDefaults,
      }
    })
    .filter(Boolean)

  return { nodes, edges }
}

export function reconcileCanvasGraph(currentNodes, currentEdges, nextGraph) {
  const currentNodeById = new Map(currentNodes.map((node) => [node.id, node]))
  const currentEdgeById = new Map(currentEdges.map((edge) => [edge.id, edge]))
  const nodes = nextGraph.nodes.map((next) => {
    const current = currentNodeById.get(next.id)
    if (!current || current.type !== next.type) return next
    current.position = next.position
    current.parentNode = next.parentNode
    current.width = next.width
    current.height = next.height
    current.style = next.style
    current.data = next.data
    return current
  })
  const edges = nextGraph.edges.map((next) => {
    const current = currentEdgeById.get(next.id)
    if (!current) return next
    current.source = next.source
    current.target = next.target
    current.sourceHandle = next.sourceHandle
    current.targetHandle = next.targetHandle
    current.data = next.data
    return current
  })
  return { nodes, edges }
}

// Fold the canvas back into the stored canvas document, keeping the fields the
// canvas does not own (ids, timestamps, agent metadata) from the loaded copy.
export function toDomainCanvas(activeCanvas, nodes, edges) {
  if (!activeCanvas) return null
  const nodeMap = new Map(activeCanvas.nodes.map((node) => [node.id, node]))
  return {
    ...activeCanvas,
    nodes: nodes.map((node) => node.type === 'frame'
      ? { ...nodeMap.get(node.id), id: node.id, type: 'frame', name: node.data.label, config: { ...nodeMap.get(node.id)?.config, description: node.data.description || '', manualSize: Boolean(node.data.manualSize) }, ui: { position: node.position, size: { width: Number(node.dimensions?.width || node.width || 900), height: Number(node.dimensions?.height || node.height || 600) } } }
      : { ...nodeMap.get(node.id), id: node.id, name: node.data.label, type: node.data.canvasType, config: node.data.config, ui: { position: node.position, parentFrameId: node.parentNode } }),
    edges: edges.flatMap((edge) => {
      const sourceType = nodes.find((node) => node.id === edge.source)?.data?.canvasType
      const targetType = nodes.find((node) => node.id === edge.target)?.data?.canvasType
      const preserved = edge.data?.logicalConnections?.filter(({ sourcePort, targetPort }) => canConnectPorts(sourceType, sourcePort, targetType, targetPort)) || []
      const inferred = preserved.length ? preserved : inferLogicalConnections(sourceType, targetType)
      return inferred.map(({ sourcePort, targetPort }, index) => ({
        id: inferred.length === 1 ? edge.id : `${edge.id}-${index + 1}`,
        source: { nodeId: edge.source, port: sourcePort },
        target: { nodeId: edge.target, port: targetPort },
      }))
    }),
  }
}

function inferLogicalConnections(sourceType, targetType) {
  const outputs = nodeOutputPorts(sourceType)
  const inputs = nodeInputPorts(targetType)
  const named = outputs.flatMap((output) => {
    const input = inputs.find((candidate) => candidate.id === output.id && canConnectPorts(sourceType, output.id, targetType, candidate.id))
    return input ? [{ sourcePort: output.id, targetPort: input.id }] : []
  })
  if (named.length) return named
  for (const output of outputs) {
    const input = inputs.find((candidate) => canConnectPorts(sourceType, output.id, targetType, candidate.id))
    if (input) return [{ sourcePort: output.id, targetPort: input.id }]
  }
  return []
}
