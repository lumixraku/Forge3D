import { randomUUID } from './ids.js'

function invalid(message) {
  const error = new Error(message)
  error.statusCode = 400
  throw error
}

export function createCanvas(input) {
  if (!input.name?.trim()) invalid('Canvas name is required')
  if (!Array.isArray(input.nodes)) invalid('Canvas nodes are invalid')
  if (!input.nodes.every((node) =>
    typeof node.id === 'string' && node.id &&
    typeof node.type === 'string' && node.type &&
    typeof node.name === 'string' && node.name &&
    node.config && typeof node.config === 'object' && !Array.isArray(node.config) &&
    Number.isFinite(node.ui?.position?.x) && Number.isFinite(node.ui?.position?.y)
  )) invalid('Canvas nodes are invalid')

  const nodeIds = new Set(input.nodes.map((node) => node.id))
  if (nodeIds.size !== input.nodes.length) invalid('Canvas node IDs must be unique')
  if (input.edges && !Array.isArray(input.edges)) invalid('Canvas edges are invalid')
  if ((input.edges || []).some((edge) =>
    typeof edge.id !== 'string' || !edge.id ||
    !nodeIds.has(edge.source?.nodeId) || !nodeIds.has(edge.target?.nodeId) ||
    typeof edge.source?.port !== 'string' || typeof edge.target?.port !== 'string'
  )) invalid('Canvas edges must connect nodes inside the canvas')

  const now = new Date().toISOString()
  return {
    schemaVersion: '1.0',
    id: `canvas-${randomUUID()}`,
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

// A readable stand-in for a canvas whose session row is missing, so opening the
// canvas still succeeds. It is not persisted.
export function emptySession(canvas) {
  return {
    id: `session-${randomUUID()}`,
    canvasId: canvas.id,
    createdAt: canvas.createdAt,
    updatedAt: canvas.updatedAt || canvas.createdAt,
    messages: [],
  }
}

export function createSession(canvas) {
  const now = new Date().toISOString()
  return {
    id: `session-${randomUUID()}`,
    canvasId: canvas.id,
    createdAt: now,
    updatedAt: now,
    messages: [],
  }
}

export function createInitialSession(canvas) {
  const now = canvas.createdAt
  return {
    id: `session-${randomUUID()}`,
    canvasId: canvas.id,
    createdAt: now,
    updatedAt: now,
    messages: [{
      id: `msg-${randomUUID()}`,
      role: 'assistant',
      content: 'This project is ready. Describe what you want to create or edit on its canvas.',
      createdAt: now,
    }],
  }
}
