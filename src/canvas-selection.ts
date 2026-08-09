export function removeSelectedElements(nodes, edges, { preserveFrameChildren = false } = {}) {
  const selectedFrameIds = new Set(nodes
    .filter((node) => node.selected && node.type === 'frame')
    .map((node) => node.id))
  const removedNodeIds = new Set(nodes
    .filter((node) => node.selected && (
      node.type === 'frame'
      || !preserveFrameChildren
      || !selectedFrameIds.has(node.parentNode)
    ))
    .map((node) => node.id))

  if (!preserveFrameChildren) {
    let addedDescendant = true
    while (addedDescendant) {
      addedDescendant = false
      for (const node of nodes) {
        if (node.parentNode && removedNodeIds.has(node.parentNode) && !removedNodeIds.has(node.id)) {
          removedNodeIds.add(node.id)
          addedDescendant = true
        }
      }
    }
  }

  const removedFrames = new Map(nodes
    .filter((node) => selectedFrameIds.has(node.id))
    .map((node) => [node.id, node]))
  const nextNodes = nodes
    .filter((node) => !removedNodeIds.has(node.id))
    .map((node) => {
      if (!preserveFrameChildren) return node
      const frame = removedFrames.get(node.parentNode)
      if (!frame) return node
      return {
        ...node,
        parentNode: frame.parentNode,
        extent: undefined,
        expandParent: false,
        position: { x: frame.position.x + node.position.x, y: frame.position.y + node.position.y },
      }
    })
  const selectedEdgeIds = new Set(edges.filter((edge) => edge.selected).map((edge) => edge.id))
  const nextEdges = edges.filter((edge) => (
    !selectedEdgeIds.has(edge.id)
    && !removedNodeIds.has(edge.source)
    && !removedNodeIds.has(edge.target)
  ))

  return { nodes: nextNodes, edges: nextEdges }
}
