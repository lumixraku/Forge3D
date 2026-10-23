import { reconcileResultSlots } from '../src/canvas-result-slots.js'

/**
 * Fills in the result slots a stage must own. A stage created by a request, an
 * Agent plan or a copy gets them here, so a workflow looks the same before and
 * after it runs and Run downstream can plan the whole chain.
 */
export function withResultSlots(canvas) {
  const repair = reconcileResultSlots({ nodes: canvas.nodes || [], edges: canvas.edges || [], provider: canvas.provider })
  if (!repair.added.length && !repair.removed.length) return canvas
  return { ...canvas, nodes: repair.canvas.nodes, edges: repair.canvas.edges }
}

export function projectDto(canvas) {
  return {
    id: canvas.id,
    name: canvas.name,
    description: canvas.description,
    provider: canvas.provider,
    revision: canvas.revision,
    createdAt: canvas.createdAt,
    updatedAt: canvas.updatedAt,
    nodeCount: canvas.nodes.length,
    edgeCount: canvas.edges.length,
  }
}

export function replaceCanvasDocument(project, input, canvasId, updatedAt) {
  const repaired = withResultSlots({ ...input, provider: input.provider ?? project.provider })
  return {
    ...input,
    ...(repaired.nodes === input.nodes ? {} : { nodes: repaired.nodes, edges: repaired.edges }),
    id: canvasId,
    name: project.name,
    description: project.description,
    provider: input.provider ?? project.provider,
    createdAt: project.createdAt,
    revision: project.revision + 1,
    updatedAt,
    ...(project.ownerId ? { ownerId: project.ownerId } : {}),
  }
}

export function applyAgentCanvas(project, canvas) {
  return withResultSlots({
    ...canvas,
    name: project.name,
    description: project.description,
    provider: project.provider,
    createdAt: project.createdAt,
    ...(project.ownerId ? { ownerId: project.ownerId } : {}),
  })
}
