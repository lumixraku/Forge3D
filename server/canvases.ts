import { randomUUID } from './ids.js'
import { validateCanvasGraph } from '../src/canvas-nodes.js'
import { defaultCanvasProvider } from '../src/canvas-schema.js'

function invalid(message) {
  const error = new Error(message)
  error.statusCode = 400
  throw error
}

// Wire ties name wires by their source and target ports; ties on wires that
// are not in the canvas are dropped.
function liveWireTies(input) {
  if (!Array.isArray(input.wireTies)) return []
  const wires = new Set((input.edges || []).map((edge) => `${edge.source?.nodeId}:${edge.source?.port}->${edge.target?.nodeId}:${edge.target?.port}`))
  return input.wireTies
    .filter((tie) => typeof tie?.id === 'string' && Array.isArray(tie.point) && tie.point.length === 2 && Array.isArray(tie.members))
    .map((tie) => ({ id: tie.id, point: structuredClone(tie.point), members: tie.members.filter((member) => wires.has(member)) }))
    .filter((tie) => tie.members.length)
}

export function createCanvas(input) {
  if (!input.name?.trim()) invalid('Canvas name is required')
  const provider = input.provider ?? defaultCanvasProvider
  if (!['mock', 'tripo', 'meshy'].includes(provider)) invalid('Canvas provider must be "mock", "tripo", or "meshy"')
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
  const graphIssues = validateCanvasGraph(input.nodes, input.edges || [])
  if (graphIssues.length) invalid(graphIssues[0].message)

  const now = new Date().toISOString()
  return {
    schemaVersion: '1.0',
    id: `canvas-${randomUUID()}`,
    name: input.name.trim(),
    description: input.description?.trim() || '',
    provider,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    nodes: structuredClone(input.nodes),
    edges: structuredClone(input.edges || []),
    ...(liveWireTies(input).length ? { wireTies: liveWireTies(input) } : {}),
    viewport: input.viewport && typeof input.viewport === 'object' ? structuredClone(input.viewport) : { x: 0, y: 0, zoom: 1 },
    ...(input.ownerId ? { ownerId: input.ownerId } : {}),
  }
}

export function duplicateCanvas(source) {
  const nodeIds = new Map(source.nodes.map((node) => [node.id, `${node.id}-${randomUUID()}`]))
  return createCanvas({
    ...source,
    name: `${source.name} Copy`,
    nodes: source.nodes.map((node) => ({
      ...structuredClone(node),
      id: nodeIds.get(node.id),
      ui: {
        ...structuredClone(node.ui),
        ...(node.ui.parentFrameId ? { parentFrameId: nodeIds.get(node.ui.parentFrameId) } : {}),
      },
    })),
    edges: source.edges.map((edge) => ({
      ...structuredClone(edge),
      id: `${edge.id || 'edge'}-${randomUUID()}`,
      source: { ...edge.source, nodeId: nodeIds.get(edge.source.nodeId) },
      target: { ...edge.target, nodeId: nodeIds.get(edge.target.nodeId) },
    })),
    // A wire's name carries node ids, so a duplicate rewrites them.
    wireTies: (source.wireTies || []).map((tie) => ({
      ...structuredClone(tie),
      members: tie.members.map((member) => {
        const match = /^(.*?):(.*?)->(.*?):(.*)$/.exec(member)
        return match ? `${nodeIds.get(match[1]) || match[1]}:${match[2]}->${nodeIds.get(match[3]) || match[3]}:${match[4]}` : member
      }),
    })),
  })
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
