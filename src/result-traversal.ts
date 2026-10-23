// Result nodes sit between a stage and whatever reads its media, so the plan has
// to see through them: a stage's dependencies are the stages behind its result
// slots, and its outgoing edges continue at whatever those slots feed.
//
// Without this, "stage -> result -> Export" would look like a chain of one to a
// planner that only counts execution nodes, and Run downstream would stop at the
// stage instead of running the export.

interface TraceNode {
  id: string
  type?: string
  data?: { canvasType?: string }
}

interface TraceEdge {
  source: string
  target: string
}

export function nodeTypeOf(node: TraceNode) {
  return node.data?.canvasType || node.type || ''
}

/**
 * Re-homes every edge that touches a result node onto the stage that owns it:
 * `slot` becomes `stage`, so a graph of `stage -> slot -> next` reads as
 * `stage -> next`. Edges between ordinary nodes pass through unchanged.
 */
export function stagesOnlyEdges<T extends TraceEdge>(nodes: TraceNode[], edges: T[], isResult: (type: string) => boolean, stageOfSlot: (nodeId: string) => string | null): T[] {
  const typeById = new Map(nodes.map((node) => [node.id, nodeTypeOf(node)]))
  // A result node's stage is the node it was created for, read from the canvas.
  const stage = (nodeId: string) => (isResult(typeById.get(nodeId) || '') ? stageOfSlot(nodeId) : nodeId)
  const seen = new Set<string>()
  const resolved: T[] = []
  for (const edge of edges) {
    const source = stage(edge.source)
    const target = stage(edge.target)
    if (!source || !target || source === target) continue
    const key = `${source}->${target}`
    if (seen.has(key)) continue
    seen.add(key)
    resolved.push({ ...edge, source, target })
  }
  return resolved
}
