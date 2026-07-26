import { randomUUID } from './ids.js'

function invalid(message) {
  const error = new Error(message)
  error.statusCode = 400
  throw error
}

export function createWorkflow(input) {
  if (!input.name?.trim()) invalid('Workflow name is required')
  if (!Array.isArray(input.nodes)) invalid('Workflow nodes are invalid')
  if (!input.nodes.every((node) =>
    typeof node.id === 'string' && node.id &&
    typeof node.type === 'string' && node.type &&
    typeof node.name === 'string' && node.name &&
    node.config && typeof node.config === 'object' && !Array.isArray(node.config) &&
    Number.isFinite(node.ui?.position?.x) && Number.isFinite(node.ui?.position?.y)
  )) invalid('Workflow nodes are invalid')

  const nodeIds = new Set(input.nodes.map((node) => node.id))
  if (nodeIds.size !== input.nodes.length) invalid('Workflow node IDs must be unique')
  if (input.edges && !Array.isArray(input.edges)) invalid('Workflow edges are invalid')
  if ((input.edges || []).some((edge) =>
    typeof edge.id !== 'string' || !edge.id ||
    !nodeIds.has(edge.source?.nodeId) || !nodeIds.has(edge.target?.nodeId) ||
    typeof edge.source?.port !== 'string' || typeof edge.target?.port !== 'string'
  )) invalid('Workflow edges must connect nodes inside the workflow')

  const now = new Date().toISOString()
  return {
    schemaVersion: '1.0',
    id: `wf-${randomUUID()}`,
    name: input.name.trim(),
    description: input.description?.trim() || '',
    revision: 1,
    createdAt: now,
    updatedAt: now,
    nodes: structuredClone(input.nodes),
    edges: structuredClone(input.edges || []),
    viewport: input.viewport && typeof input.viewport === 'object' ? structuredClone(input.viewport) : { x: 0, y: 0, zoom: 1 },
  }
}

export function createInitialConversation(workflow) {
  const now = workflow.createdAt
  return {
    id: `conv-${randomUUID()}`,
    workflowId: workflow.id,
    createdAt: now,
    updatedAt: now,
    messages: [{
      id: `msg-${randomUUID()}`,
      role: 'assistant',
      content: 'This workflow was created from a canvas selection and can now evolve independently.',
      createdAt: now,
    }],
  }
}
