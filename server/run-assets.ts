// Every asset a canvas has ever produced, read from the run history rather
// than from the canvas. Running the same canvas n times yields n sets of
// assets, and they survive the nodes that made them being edited or deleted.
const REFERENCE_TYPES = new Set(['reference-image'])
const IMAGE_TYPES = new Set(['generate-image', 'generated-image', 'image-decomposition', 'generate-multiview-images', 'review'])
const MODEL_TYPES = new Set(['generate-model', 'smart-mesh', 'multiview-to-3d', 'text-to-3d', 'texture', 'retopology', 'rigging', 'segments', 'model-preview', 'export-model'])

function assetKind(nodeType) {
  if (REFERENCE_TYPES.has(nodeType)) return 'reference'
  if (IMAGE_TYPES.has(nodeType)) return 'image'
  if (MODEL_TYPES.has(nodeType)) return 'model'
  return null
}

// A batch node reports `previews`/`viewPreviews`; single-output nodes report
// `image` or `preview`. `image` on a batch node is only the selected candidate,
// so it is skipped to avoid emitting the same file twice.
function assetSources(output) {
  const batch = [
    ...(Array.isArray(output.previews) ? output.previews : []),
    ...Object.values(output.viewPreviews || {}),
  ].filter(Boolean)
  if (batch.length) return batch
  const single = output.image || output.preview
  return single ? [single] : []
}

export function collectRunAssets(runs, canvasId, canvas = null) {
  const nodeTypes = new Map((canvas?.nodes || []).map((node) => [node.id, node.type]))
  const assets = []

  for (const run of runs) {
    if (run.canvasId !== canvasId) continue
    const createdAt = run.completedAt || run.createdAt
    for (const [nodeId, nodeRun] of Object.entries(run.nodeRuns || {})) {
      if (!nodeRun.output) continue
      // Runs recorded before node identity was stored fall back to the canvas.
      const nodeType = nodeRun.nodeType || nodeTypes.get(nodeId) || ''
      const kind = assetKind(nodeType)
      if (!kind) continue
      const downloads = Array.isArray(nodeRun.output.outputs) ? nodeRun.output.outputs.filter((output) => output.downloadUrl) : []
      assetSources(nodeRun.output).forEach((src, index) => assets.push({
        id: `${run.id}:${nodeId}:${index}`,
        runId: run.id,
        executionId: run.id,
        canvasId: run.canvasId,
        canvasRevision: run.canvasRevision,
        entryNodeId: run.entryNodeId || Object.keys(run.nodeRuns || {})[0],
        nodeId,
        producerNodeId: nodeId,
        nodeType,
        producerNodeType: nodeType,
        label: nodeRun.nodeName || nodeType,
        producerNodeName: nodeRun.nodeName || nodeType,
        kind,
        src,
        downloads,
        status: nodeRun.status,
        createdAt,
      }))
    }
  }

  // Newest run first; nodes keep their execution order inside a run.
  return assets.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
}

export function runHistory(runs, canvasId) {
  return runs
    .filter((run) => run.canvasId === canvasId)
    .map((run) => {
      const nodeRuns = Object.values(run.nodeRuns || {})
      return {
        id: run.id,
        canvasId: run.canvasId,
        canvasRevision: run.canvasRevision,
        status: run.status,
        createdAt: run.createdAt,
        completedAt: run.completedAt,
        nodeCount: nodeRuns.length,
        durationMs: nodeRuns.reduce((total, nodeRun) => total + (nodeRun.durationMs || 0), 0),
      }
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
}

export function executionAssets(runs, { canvasId, nodeId, executionId, kind } = {}) {
  const selectedRuns = runs.filter((run) => (
    (!canvasId || run.canvasId === canvasId)
    && (!executionId || run.id === executionId)
  ))
  return collectRunAssets(selectedRuns, canvasId).filter((asset) => (
    (!nodeId || asset.producerNodeId === nodeId)
    && (!kind || asset.kind === kind)
  ))
}
