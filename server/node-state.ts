export function latestNodeRuns(canvas, runs) {
  const nodeIds = new Set(canvas.nodes.map((node) => node.id))
  const latest = {}

  for (const run of runs) {
    if (run.canvasId !== canvas.id || run.canvasRevision !== canvas.revision) continue
    for (const [nodeId, nodeRun] of Object.entries(run.nodeRuns)) {
      if (nodeIds.has(nodeId)) latest[nodeId] = nodeRun
    }
  }

  return latest
}
