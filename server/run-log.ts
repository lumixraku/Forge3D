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
    // Only present when a real backend produced this node.
    ...(result.tripoTaskId ? { tripoTaskId: result.tripoTaskId } : {}),
    ...(result.meshyTaskId ? { meshyTaskId: result.meshyTaskId } : {}),
    ...(result.progress === undefined ? {} : { progress: result.progress }),
    ...(result.creditsConsumed === undefined || result.creditsConsumed === null ? {} : { creditsConsumed: result.creditsConsumed }),
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
  run.status = runStatus(run.nodeRuns)
  run.completedAt = timestamp
  return run
}

// The run is only finished once no node is still pending. Reading the last
// recorded node instead would report a multi-node run as succeeded the moment its
// first node lands, and a client polling for a terminal status would stop early.
function runStatus(nodeRuns) {
  const statuses = Object.values(nodeRuns).map((nodeRun) => nodeRun.status)
  if (statuses.includes('failed')) return 'failed'
  // A review checkpoint holds the rest of the run until it is approved.
  if (statuses.includes('waiting_review')) return 'waiting_review'
  if (statuses.some((status) => ['queued', 'running'].includes(status))) return 'running'
  return 'succeeded'
}
