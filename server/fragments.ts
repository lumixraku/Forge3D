import { randomUUID } from './ids.js'

export function createFragment(input) {
  if (input.schemaVersion && input.schemaVersion !== '1.0') throw new Error('Unsupported fragment schema version')
  if (input.kind && input.kind !== 'workflow-fragment') throw new Error('Invalid fragment kind')
  if (!input.name?.trim()) throw new Error('Fragment name is required')
  if (!Array.isArray(input.nodes) || !input.nodes.length) throw new Error('A fragment requires at least one node')
  if (!input.nodes.every((node) =>
    typeof node.id === 'string' && node.id &&
    typeof node.type === 'string' && node.type &&
    typeof node.name === 'string' && node.name &&
    node.config && typeof node.config === 'object' && !Array.isArray(node.config) &&
    Number.isFinite(node.ui?.position?.x) && Number.isFinite(node.ui?.position?.y)
  )) throw new Error('Fragment nodes are invalid')

  const nodeIds = new Set(input.nodes.map((node) => node.id))
  if (nodeIds.size !== input.nodes.length) throw new Error('Fragment node IDs must be unique')
  if (input.edges && !Array.isArray(input.edges)) throw new Error('Fragment edges are invalid')
  if ((input.edges || []).some((edge) =>
    typeof edge.id !== 'string' || !edge.id ||
    !nodeIds.has(edge.source?.nodeId) || !nodeIds.has(edge.target?.nodeId) ||
    typeof edge.source?.port !== 'string' || typeof edge.target?.port !== 'string'
  )) {
    throw new Error('Fragment edges must connect nodes inside the fragment')
  }

  const fragmentInterface = input.interface || { inputs: [], outputs: [] }
  const validInterface = ['inputs', 'outputs'].every((key) =>
    Array.isArray(fragmentInterface[key]) && fragmentInterface[key].every((entry) =>
      nodeIds.has(entry?.nodeId) && typeof entry.port === 'string'
    )
  )
  if (!validInterface) throw new Error('Fragment interface is invalid')

  const now = new Date().toISOString()
  return {
    schemaVersion: '1.0',
    kind: 'workflow-fragment',
    id: `frag-${randomUUID()}`,
    shareId: randomUUID().replaceAll('-', '').slice(0, 16),
    name: input.name.trim(),
    description: input.description?.trim() || '',
    source: input.source || null,
    nodes: structuredClone(input.nodes),
    edges: structuredClone(input.edges || []),
    interface: structuredClone(fragmentInterface),
    createdAt: now,
    updatedAt: now,
  }
}

export function fragmentSummary(fragment) {
  const { nodes, edges, ...summary } = fragment
  return { ...summary, nodeCount: nodes.length, edgeCount: edges.length }
}
