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
  return {
    ...input,
    id: canvasId,
    name: project.name,
    description: project.description,
    provider: input.provider ?? project.provider,
    createdAt: project.createdAt,
    revision: project.revision + 1,
    updatedAt,
  }
}

export function applyAgentCanvas(project, canvas) {
  return {
    ...canvas,
    name: project.name,
    description: project.description,
    provider: project.provider,
    createdAt: project.createdAt,
  }
}
