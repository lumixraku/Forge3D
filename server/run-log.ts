import { randomUUID } from './ids.js'

// Each completed node is appended to its server-owned execution record.
export function recordNodeExecution(runs, { runId, canvas, node, result, entryNode = node, mode = 'node', now = () => new Date().toISOString() }) {
  const timestamp = now()
  const id = runId || `run-${randomUUID()}`
  // The type and name are copied off the node so the record stays readable after
  // the node is renamed or deleted from the canvas.
  const nodeRun = {
    status: result.status,
    nodeType: node.type,
    nodeName: node.name || node.type,
    durationMs: result.durationMs ?? null,
    output: result.output ?? null,
    error: result.error ?? null,
  }

  let run = runs.find((candidate) => candidate.id === id && candidate.canvasId === canvas.id)
  if (!run) {
    run = {
      id,
      canvasId: canvas.id,
      canvasRevision: canvas.revision,
      entryNodeId: entryNode.id,
      entryNodeType: entryNode.type,
      entryNodeName: entryNode.name || entryNode.type,
      mode,
      status: nodeRun.status,
      createdAt: timestamp,
      completedAt: timestamp,
      nodeRuns: {},
    }
    runs.push(run)
  }

  run.nodeRuns[node.id] = nodeRun
  run.canvasRevision = canvas.revision
  run.status = nodeRun.status
  run.completedAt = timestamp
  return run
}
