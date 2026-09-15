const ACTIVE_STATUSES = new Set(['queued', 'running', 'cancelling'])

export function latestNodeRuns(canvas, runs) {
  const nodeIds = new Set(canvas.nodes.map((node) => node.id))
  const latest = {}

  for (const run of runs) {
    if (run.canvasId !== canvas.id) continue
    // A finished run only describes the revision it ran against, but a task that
    // is still in flight is happening right now: every edit saved while it runs
    // moves the revision on, and dropping it would hide the running node.
    if (run.canvasRevision !== canvas.revision && !ACTIVE_STATUSES.has(run.status)) continue
    for (const [nodeId, nodeRun] of Object.entries(run.nodeRuns)) {
      if (nodeIds.has(nodeId)) latest[nodeId] = nodeRun
    }
  }

  return latest
}
