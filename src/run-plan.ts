// Input nodes and frames provide data or layout; only processing and export
// nodes enter the execution plan. Which is which comes from the node schema's
// `executable` flag rather than a list repeated here.
import { isExecutableNodeType, isResultNodeType } from '@forge3d/canvas-core'

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
  const executable = nodes.filter((node) => isExecutableNodeType(node.data?.canvasType || node.type || ''))
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
  // Result slots are transparent: `stage -> slot -> next` has to reach `next`, or
  // Run downstream would stop at the stage it was started on.
  const stageOf = (nodeId: string) => {
    const node = nodes.find((candidate) => candidate.id === nodeId)
    const type = node?.data?.canvasType || node?.type || ''
    if (!isResultNodeType(type)) return nodeId
    return (node?.data as { generatedAssets?: { resultOf?: { sourceId?: string } } } | undefined)?.generatedAssets?.resultOf?.sourceId || null
  }
  const flattened = edges.flatMap((edge) => {
    const source = stageOf(edge.source)
    const target = stageOf(edge.target)
    return source && target && source !== target ? [{ source, target }] : []
  })
  const ordered = executionOrder(nodes, flattened)
  if (!targetNodeId) return ordered
  const target = ordered.find((node) => node.id === targetNodeId)
  if (!target) return []
  if (scope !== 'downstream') return [target]

  const reachable = new Set([targetNodeId])
  // Ordered traversal means a node's sources are visited before it.
  for (const node of ordered) {
    if (flattened.some((edge) => edge.target === node.id && reachable.has(edge.source))) reachable.add(node.id)
  }
  return ordered.filter((node) => reachable.has(node.id))
}
