import { reconcileResultSlots } from '@forge3d/canvas-core'

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
  // A revision numbers the content, so a document that matches what the server
  // already holds must not spend one. Pointer-driven saves and a re-measured
  // viewport can send a canvas identical to the stored one; treating those as
  // edits is what made opening a menu look like a change to the workflow.
  const changed = documentChanged(project, repaired)
  return {
    ...input,
    ...(repaired.nodes === input.nodes ? {} : { nodes: repaired.nodes, edges: repaired.edges }),
    id: canvasId,
    name: project.name,
    description: project.description,
    provider: input.provider ?? project.provider,
    createdAt: project.createdAt,
    revision: changed ? project.revision + 1 : project.revision,
    updatedAt: changed ? updatedAt : project.updatedAt,
    ...(project.ownerId ? { ownerId: project.ownerId } : {}),
  }
}

// Compares the parts of a canvas that are its content. The camera is where the
// last editor was looking, so it never makes a document different; everything a
// run reads — the graph, the wiring, the notes — does.
function documentChanged(project, input) {
  return JSON.stringify(project.nodes || []) !== JSON.stringify(input.nodes || [])
    || JSON.stringify(project.edges || []) !== JSON.stringify(input.edges || [])
    || JSON.stringify(project.wireTies || []) !== JSON.stringify(input.wireTies || [])
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
