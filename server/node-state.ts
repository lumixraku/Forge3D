export function latestNodeRuns(workflow, runs) {
  const nodeIds = new Set(workflow.nodes.map((node) => node.id))
  const latest = {}

  for (const run of runs) {
    if (run.workflowId !== workflow.id || run.workflowRevision !== workflow.revision) continue
    for (const [nodeId, nodeRun] of Object.entries(run.nodeRuns)) {
      if (nodeIds.has(nodeId)) latest[nodeId] = nodeRun
    }
  }

  return latest
}
