import { isExecutableNodeType } from '../src/canvas-schema.js'
import { validateCanvasGraph } from '../src/canvas-nodes.js'
import { downstreamCanvas, executeNode, executionNodes } from './mock-runs.js'
import { randomUUID } from './ids.js'
import { recordNodeExecution } from './run-log.js'
import { latestNodeRuns } from './node-state.js'
import { tripoNodeOutput } from './tripo-mapping.js'

const TRIPO_FAILURE_STATUSES = new Set(['failed', 'banned', 'expired', 'cancelled'])

export async function syncExecutionWithTripo(run, getTripoTask) {
  if (!run || !getTripoTask) return run
  const remoteNodes = Object.entries(run.nodeRuns || {}).filter(([, nodeRun]) => nodeRun.tripoTaskId)
  if (!remoteNodes.length) return run

  let changed = false
  await Promise.all(remoteNodes.map(async ([nodeId, nodeRun]) => {
    let task
    try {
      task = await getTripoTask(nodeRun.tripoTaskId)
    } catch {
      // An unavailable status endpoint cannot change the task's known state.
      return
    }

    const nextStatus = task.status === 'success'
      ? 'succeeded'
      : TRIPO_FAILURE_STATUSES.has(task.status) ? (task.status === 'cancelled' ? 'cancelled' : 'failed') : 'running'
    const nextError = TRIPO_FAILURE_STATUSES.has(task.status)
      ? task.message || task.error || `Tripo task ${task.status}`
      : null
    const nextProgress = task.progress ?? nodeRun.progress
    const node = run.input?.nodes?.find((candidate) => candidate.id === nodeId)
      || { type: nodeRun.nodeType, name: nodeRun.nodeName, config: {} }
    const nextOutput = task.status === 'success' ? tripoNodeOutput(node, task) : nodeRun.output
    if (nodeRun.status === nextStatus && nodeRun.error === nextError && nodeRun.progress === nextProgress && JSON.stringify(nodeRun.output) === JSON.stringify(nextOutput)) return
    nodeRun.status = nextStatus
    nodeRun.error = nextError
    nodeRun.output = nextOutput
    if (nextProgress !== undefined) nodeRun.progress = nextProgress
    changed = true
  }))

  if (!changed) return run
  const statuses = Object.values(run.nodeRuns || {}).map((nodeRun) => nodeRun.status)
  if (statuses.includes('failed')) run.status = 'failed'
  else if (statuses.includes('cancelled')) run.status = 'cancelled'
  else if (statuses.some((status) => ['queued', 'running'].includes(status))) run.status = 'running'
  else run.status = 'succeeded'
  run.completedAt = ['succeeded', 'failed', 'cancelled'].includes(run.status) ? new Date().toISOString() : null
  return run
}

export function executionById(runs, executionId) {
  return runs.find((run) => run.id === executionId) || null
}

export function executionDto(run) {
  const nodeExecutions = run.nodeRuns || {}
  return {
    id: run.id,
    entryNodeId: run.entryNodeId || Object.keys(run.nodeRuns || {})[0] || null,
    entryNodeName: run.entryNodeName || null,
    canvasId: run.canvasId,
    canvasRevision: run.canvasRevision,
    mode: run.mode || 'node',
    status: run.status,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
    executedNodeCount: Object.values(nodeExecutions).filter((node) => ['succeeded', 'failed', 'waiting_review'].includes(node.status)).length,
    durationMs: Object.values(nodeExecutions).reduce((total, node) => total + (node.durationMs || 0), 0),
    nodeExecutions,
  }
}

export function canvasExecutions(runs, canvasId) {
  return runs
    .filter((run) => run.canvasId === canvasId)
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
    .map(executionDto)
}

export function cancelExecution(run) {
  if (!run || ['succeeded', 'failed', 'cancelled'].includes(run.status)) return run
  run.cancelRequested = true
  run.status = 'cancelling'
  return run
}

export function paginateAssets(assets, url) {
  const requested = Number(url.searchParams.get('limit') || 50)
  const limit = Number.isInteger(requested) ? Math.min(200, Math.max(1, requested)) : 50
  const cursor = url.searchParams.get('cursor')
  const start = cursor ? Math.max(0, assets.findIndex((asset) => asset.id === cursor) + 1) : 0
  const items = assets.slice(start, start + limit)
  const hasMore = start + limit < assets.length
  return { items, nextCursor: hasMore ? items.at(-1)?.id || null : null, hasMore }
}

export function createExecution(runs, canvas, entryNode, mode = 'downstream') {
  if (!['node', 'downstream'].includes(mode)) {
    const error = new Error('Invalid execution mode')
    error.statusCode = 400
    throw error
  }
  // Frames and the input/output-only types carry no work, so they cannot be the
  // entry point. Without this, downstreamCanvas returns null and the pruning
  // below fails on it; a single-node run would produce an empty plan instead.
  if (!isExecutableNodeType(entryNode.type)) {
    const error = new Error(`${entryNode.name || entryNode.type} cannot be run on its own`)
    error.statusCode = 400
    throw error
  }
  const issues = validateCanvasGraph(canvas.nodes, canvas.edges || [], { requireInputs: true })
  if (issues.length) {
    const issue = issues[0]
    const error = new Error(issue.message)
    error.statusCode = 400
    error.issue = issue
    throw error
  }
  const executionCanvas = mode === 'downstream'
    ? downstreamCanvas(canvas, entryNode.id)
    : { ...structuredClone(canvas), nodes: [structuredClone(entryNode)], edges: [] }
  const nodes = executionNodes(executionCanvas)
  const timestamp = new Date().toISOString()
  const run = {
    id: `run-${randomUUID()}`,
    canvasId: canvas.id,
    canvasRevision: canvas.revision,
    entryNodeId: entryNode.id,
    entryNodeType: entryNode.type,
    entryNodeName: entryNode.name || entryNode.type,
    mode,
    status: 'queued',
    cancelRequested: false,
    createdAt: timestamp,
    completedAt: null,
    nodeRuns: Object.fromEntries(nodes.map((node) => [node.id, { status: 'queued', nodeType: node.type, nodeName: node.name || node.type, durationMs: null, output: null, error: null }])),
  }
  runs.push(run)
  return { run, executionCanvas, nodes }
}

export async function executeExecution(runs, run, canvas, executionCanvas, nodes, entryNode, onUpdate = async () => {}, { createProvider = null } = {}) {
  run.status = 'running'
  await onUpdate()
  // What each node produced during this run. A real backend cannot read an
  // upstream result off the saved canvas the way the simulation does, because the
  // output only exists once the task finishes, so it is threaded here instead.
  //
  // Seeded from what earlier runs produced, so re-running one node on its own
  // still sees the mesh its upstream already made. Without this, exporting a
  // finished chain fails with "needs an upstream 3D model".
  const context = new Map()
  // This run's own nodes are queued, not produced, so it is excluded: leaving it
  // in would overwrite an earlier succeeded result with its own queued entry.
  const earlier = latestNodeRuns(canvas, runs.filter((candidate) => candidate.id !== run.id))
  for (const [nodeId, nodeRun] of Object.entries(earlier)) {
    if (nodeRun.status !== 'succeeded' || !nodeRun.output) continue
    const { modelUrl = null, preview = null } = nodeRun.output
    if (modelUrl || preview) context.set(nodeId, { tripoTaskId: nodeRun.tripoTaskId || null, modelUrl, preview })
  }
  // The provider resolves inputs against the full canvas, not the pruned
  // execution canvas: a single-node run carries no edges, so the upstream image
  // or mesh would be invisible to it.
  const provider = createProvider ? createProvider({ context, run, onUpdate, canvas }) : null
  for (const node of nodes) {
    if (run.cancelRequested) break
    run.nodeRuns[node.id].status = 'running'
    await onUpdate()
    try {
      const result = await executeNode(node, executionCanvas, provider ? { provider } : undefined)
      if (result.status === 'succeeded') {
        context.set(node.id, { tripoTaskId: result.tripoTaskId || null, modelUrl: result.output?.modelUrl || null, preview: result.output?.preview || null })
      }
      recordNodeExecution(runs, { runId: run.id, canvas, node, result, entryNode, mode: run.mode })
      await onUpdate()
      if (result.status !== 'succeeded') break
    } catch (failure) {
      const activeNodeRun = run.nodeRuns[node.id]
      run = recordNodeExecution(runs, {
        runId: run.id,
        canvas,
        node,
        entryNode,
        mode: run.mode,
        // Tripo may have accepted a task before this failed. Keep its id so the
        // recorded failure remains traceable to the real task.
        result: {
          status: 'failed',
          durationMs: null,
          output: null,
          error: failure.message,
          ...(activeNodeRun?.tripoTaskId ? { tripoTaskId: activeNodeRun.tripoTaskId } : {}),
          ...(activeNodeRun?.progress === undefined ? {} : { progress: activeNodeRun.progress }),
        },
      })
      await onUpdate()
      break
    }
  }
  for (const nodeRun of Object.values(run.nodeRuns)) {
    if (nodeRun.status === 'queued') nodeRun.status = 'skipped'
  }
  if (run.cancelRequested) run.status = 'cancelled'
  run.completedAt = new Date().toISOString()
  await onUpdate()
  return executionDto(run)
}
