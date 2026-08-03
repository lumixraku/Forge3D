// Input nodes and frames provide data or layout; only processing and export
// nodes enter the execution plan.
interface PlanNode {
  id: string
  type?: string
  parentNode?: string
  data?: { canvasType?: string }
}

interface PlanEdge {
  source: string
  target: string
}

export function executionOrder(nodes: PlanNode[], edges: PlanEdge[]) {
  const executable = nodes.filter((node) => !['frame', 'reference-image', 'prompt', 'generated-image'].includes(node.data?.canvasType || node.type || ''))
  const byId = new Map(executable.map((node) => [node.id, node]))
  const outgoing = new Map(executable.map((node) => [node.id, [] as string[]]))
  const indegree = new Map(executable.map((node) => [node.id, 0]))

  const seen = new Set<string>()
  for (const edge of edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target) || seen.has(`${edge.source}:${edge.target}`)) continue
    seen.add(`${edge.source}:${edge.target}`)
    outgoing.get(edge.source)!.push(edge.target)
    indegree.set(edge.target, indegree.get(edge.target)! + 1)
  }

  const queued = executable.filter((node) => indegree.get(node.id) === 0)
  const ordered: PlanNode[] = []
  while (queued.length) {
    const node = queued.shift()!
    ordered.push(node)
    for (const target of outgoing.get(node.id)!) {
      indegree.set(target, indegree.get(target)! - 1)
      if (indegree.get(target) === 0) queued.push(byId.get(target)!)
    }
  }

  // A cycle leaves nodes unordered; fall back to declaration order.
  return ordered.length === executable.length ? ordered : executable
}

// `node` runs the target alone, `downstream` also runs everything reachable from
// it, and no target runs the whole graph.
export function planNodes(nodes: PlanNode[], edges: PlanEdge[], targetNodeId?: string, scope = 'node') {
  const ordered = executionOrder(nodes, edges)
  if (!targetNodeId) return ordered
  const target = ordered.find((node) => node.id === targetNodeId)
  if (!target) return []
  if (scope !== 'downstream') return [target]

  const reachable = new Set([targetNodeId])
  // Ordered traversal means a node's sources are visited before it.
  for (const node of ordered) {
    if (edges.some((edge) => edge.target === node.id && reachable.has(edge.source))) reachable.add(node.id)
  }
  return ordered.filter((node) => reachable.has(node.id))
}
