import { isExecutableNodeType, isResultNodeType } from '../src/canvas-schema.js'
import { validateCanvasGraph } from '../src/canvas-nodes.js'
import { stagesOnlyEdges } from '../src/result-traversal.js'
import { downstreamCanvas, executeNode, executionNodes } from './mock-runs.js'
import { randomUUID } from './ids.js'
import { recordNodeExecution } from './run-log.js'
import { latestNodeRuns } from './node-state.js'
import { tripoNodeOutput } from './tripo-mapping.js'
import { meshyNodeOutput } from './meshy-mapping.js'
import { MESHY_PREVIEW_TASK } from './meshy-provider.js'

const TRIPO_FAILURE_STATUSES = new Set(['failed', 'banned', 'expired', 'cancelled'])
const ACTIVE_EXECUTION_STATUSES = new Set(['queued', 'running', 'cancelling'])
export const MAX_ACTIVE_EXECUTIONS_PER_PROJECT = 3

export function assertProjectExecutionCapacity(runs, projectId) {
  const activeTaskCount = runs.filter((run) => (run.projectId || run.canvasId) === projectId && ACTIVE_EXECUTION_STATUSES.has(run.status)).length
  if (activeTaskCount < MAX_ACTIVE_EXECUTIONS_PER_PROJECT) return
  const error = new Error(`This project already has ${activeTaskCount} active tasks. Wait for one to finish before creating another.`)
  error.statusCode = 409
  error.code = 'ACTIVE_TASK_LIMIT_REACHED'
  error.limit = MAX_ACTIVE_EXECUTIONS_PER_PROJECT
  error.activeTaskCount = activeTaskCount
  throw error
}

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

const MESHY_FAILURE_STATUSES = new Set(['FAILED', 'CANCELED'])

function fillPreviewTask(value, taskId) {
  if (value === MESHY_PREVIEW_TASK) return taskId
  if (Array.isArray(value)) return value.map((item) => fillPreviewTask(item, taskId))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fillPreviewTask(item, taskId)]))
  return value
}

function refreshRunStatus(run) {
  const statuses = Object.values(run.nodeRuns || {}).map((nodeRun) => nodeRun.status)
  if (statuses.includes('failed')) run.status = 'failed'
  else if (statuses.includes('cancelled')) run.status = 'cancelled'
  else if (statuses.some((status) => ['queued', 'running'].includes(status))) run.status = 'running'
  else if (statuses.includes('waiting_review')) run.status = 'waiting_review'
  else run.status = 'succeeded'
  run.completedAt = ['succeeded', 'failed', 'cancelled'].includes(run.status) ? new Date().toISOString() : null
}

// A handed-off Meshy task keeps running after the Worker request that submitted
// it has ended. The client's poll calls this to copy Meshy's status back, and to
// submit the refine step once the preview task succeeds.
export async function syncExecutionWithMeshy(run, { getMeshyTask, submitMeshyTask } = {}) {
  if (!run || !getMeshyTask) return run
  const open = Object.entries(run.nodeRuns || {}).filter(([, nodeRun]) => nodeRun.meshyHandedOff && nodeRun.meshyTaskId && ['queued', 'running'].includes(nodeRun.status))
  if (!open.length) return run

  let changed = false
  await Promise.all(open.map(async ([nodeId, nodeRun]) => {
    let task
    try {
      task = await getMeshyTask(nodeRun.meshyTaskId, nodeRun.meshyTaskEndpoint)
    } catch {
      return
    }
    const progress = task.progress ?? nodeRun.progress
    if (task.status === 'SUCCEEDED' && nodeRun.meshyFollowup && !nodeRun.meshyRefined && submitMeshyTask) {
      try {
        const refineId = await submitMeshyTask(nodeRun.meshyFollowup.endpoint, fillPreviewTask(nodeRun.meshyFollowup.body, task.id))
        nodeRun.meshyTaskId = refineId
        nodeRun.meshyTaskEndpoint = nodeRun.meshyFollowup.endpoint
        nodeRun.meshyFollowup = null
        nodeRun.meshyRefined = true
        nodeRun.status = 'running'
        nodeRun.progress = Math.max(progress ?? 0, 50)
        changed = true
      } catch (failure) {
        nodeRun.status = 'failed'
        nodeRun.error = failure.message
        changed = true
      }
      return
    }
    const node = run.input?.nodes?.find((candidate) => candidate.id === nodeId) || { type: nodeRun.nodeType, name: nodeRun.nodeName, config: {} }
    if (task.status === 'SUCCEEDED') {
      nodeRun.status = 'succeeded'
      nodeRun.output = meshyNodeOutput(node, task)
      nodeRun.progress = 100
      nodeRun.error = null
      changed = true
      return
    }
    if (MESHY_FAILURE_STATUSES.has(task.status)) {
      const reason = task.task_error?.message ? `: ${task.task_error.message}` : ''
      nodeRun.status = task.status === 'CANCELED' ? 'cancelled' : 'failed'
      nodeRun.error = `Meshy task ${task.status}${reason}`
      if (progress !== undefined) nodeRun.progress = progress
      changed = true
      return
    }
    if (nodeRun.progress !== progress) {
      nodeRun.progress = progress
      nodeRun.status = 'running'
      changed = true
    }
  }))
  if (changed) refreshRunStatus(run)
  return run
}

function producedContext(run) {
  const context = new Map()
  for (const [nodeId, nodeRun] of Object.entries(run.nodeRuns || {})) {
    if (nodeRun.status !== 'succeeded' || !nodeRun.output) continue
    const { modelUrl = null, preview = null, ports = null } = nodeRun.output
    if (!(modelUrl || preview || ports || nodeRun.meshyTaskId)) continue
    context.set(nodeId, { tripoTaskId: nodeRun.tripoTaskId || null, meshyTaskId: nodeRun.meshyTaskId || nodeRun.output?.meshyTaskId || null, modelUrl, preview, ports })
  }
  return context
}

// Continues a handed-off run: once the open Meshy tasks have settled, submit the
// next ready nodes. One wave per call, so a poll stays inside a Worker request.
export async function resumeMeshyExecution(run, canvas, createProvider) {
  if (!run || !createProvider || !canvas || !['queued', 'running'].includes(run.status)) return run
  if (!Object.values(run.nodeRuns || {}).some((nodeRun) => nodeRun.meshyHandedOff)) return run
  if (Object.values(run.nodeRuns || {}).some((nodeRun) => nodeRun.status === 'running')) return run
  const nodes = run.input?.nodes || []
  const edges = run.input?.edges || []
  const provider = createProvider({ context: producedContext(run), run, onUpdate: async () => {}, canvas })
  const ready = nodes.filter((node) => {
    const nodeRun = run.nodeRuns[node.id]
    if (!nodeRun || nodeRun.status !== 'queued') return false
    const dependencies = edges.filter((edge) => edge.target?.nodeId === node.id).map((edge) => edge.source?.nodeId)
    return dependencies.every((id) => run.nodeRuns[id]?.status === 'succeeded')
  })
  if (!ready.length) {
    refreshRunStatus(run)
    return run
  }
  for (const node of ready) run.nodeRuns[node.id].status = 'running'
  await Promise.all(ready.map(async (node) => {
    try {
      const result = await executeNode(node, { nodes, edges }, { provider })
      if (result.status === 'running') {
        const nodeRun = run.nodeRuns[node.id]
        nodeRun.status = 'running'
        if (result.meshyTaskId) nodeRun.meshyTaskId = result.meshyTaskId
        if (result.meshyTaskEndpoint) nodeRun.meshyTaskEndpoint = result.meshyTaskEndpoint
        if (result.meshyFollowup) nodeRun.meshyFollowup = result.meshyFollowup
        if (result.meshyHandedOff) nodeRun.meshyHandedOff = true
        if (result.progress !== undefined) nodeRun.progress = result.progress
        return
      }
      recordNodeExecution([run], { runId: run.id, canvas, node, result, entryNode: node, mode: run.mode })
    } catch (failure) {
      const activeNodeRun = run.nodeRuns[node.id]
      recordNodeExecution([run], { runId: run.id, canvas, node, entryNode: node, mode: run.mode, result: { status: 'failed', durationMs: null, output: null, error: failure.message, ...(activeNodeRun?.meshyTaskId ? { meshyTaskId: activeNodeRun.meshyTaskId } : {}) } })
    }
  }))
  refreshRunStatus(run)
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
    input: run.input || null,
    parameters: run.parameters || null,
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

/** Turns the first graph issue into the 400 a caller can act on. */
function refuse(issues) {
  if (!issues.length) return
  const issue = issues[0]
  const error = new Error(issue.message)
  error.statusCode = 400
  error.issue = issue
  throw error
}

// Which stage a result slot belongs to, read from the canvas that holds it.
function slotStageOf(canvas) {
  const byId = new Map(canvas.nodes.map((node) => [node.id, node]))
  return (nodeId) => byId.get(nodeId)?.generatedAssets?.resultOf?.sourceId || null
}

export function createExecution(runs, canvas, entryNode, mode = 'downstream', { nodeIds = null, idempotencyKey = null, parameters = null } = {}) {
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
  refuse(validateCanvasGraph(canvas.nodes, canvas.edges || []))
  // Result nodes are transparent to the plan: a stage's dependencies are the
  // stages behind its result slots, and its outgoing edges continue at whatever
  // those slots feed. The canvas keeps the slots; the run does not execute them.
  const planCanvas = { ...canvas, edges: stagesOnlyEdges(canvas.nodes, canvas.edges || [], isResultNodeType, slotStageOf(canvas)) }
  const executionCanvas = mode === 'downstream'
    ? downstreamCanvas(planCanvas, entryNode.id)
    : { ...structuredClone(planCanvas), nodes: [structuredClone(entryNode)], edges: [] }
  const nodes = executionNodes(executionCanvas)
  const plannedNodeIds = nodes.map((node) => node.id)
  if (nodeIds !== null && (!Array.isArray(nodeIds) || !nodeIds.length || nodeIds.some((nodeId) => typeof nodeId !== 'string'))) {
    const error = new Error('nodeIds must be a non-empty array of node IDs')
    error.statusCode = 400
    throw error
  }
  if (nodeIds !== null && (nodeIds.length !== plannedNodeIds.length || nodeIds.some((nodeId, index) => nodeId !== plannedNodeIds[index]))) {
    const error = new Error('nodeIds must match the execution plan for entryNodeId and mode')
    error.statusCode = 409
    throw error
  }
  if (idempotencyKey !== null && (typeof idempotencyKey !== 'string' || !idempotencyKey.trim())) {
    const error = new Error('idempotencyKey must be a non-empty string')
    error.statusCode = 400
    throw error
  }
  if (parameters !== null && (typeof parameters !== 'object' || Array.isArray(parameters))) {
    const error = new Error('parameters must be an object keyed by node ID')
    error.statusCode = 400
    throw error
  }
  for (const [nodeId, config] of Object.entries(parameters || {})) {
    const node = nodes.find((candidate) => candidate.id === nodeId)
    if (!node || !config || typeof config !== 'object' || Array.isArray(config)) {
      const error = new Error('parameters must contain object values for planned node IDs')
      error.statusCode = 400
      throw error
    }
    node.config = { ...(node.config || {}), ...structuredClone(config) }
  }
  // Every planned node needs the parameters it runs with. Checked against the
  // real canvas edges, because neither execution canvas keeps them all: a
  // single-node run carries none, and a downstream run drops the edges from
  // non-executable sources. Scoped to the planned nodes so a half-built node
  // elsewhere cannot block this run, and run after the merge above so a prompt
  // supplied in `parameters` counts.
  const planned = new Map(nodes.map((node) => [node.id, node]))
  refuse(validateCanvasGraph(
    canvas.nodes.map((node) => planned.get(node.id) || node),
    canvas.edges || [],
    { requireParameters: planned.keys() },
  ))
  const executionEntryNode = nodes.find((node) => node.id === entryNode.id) || entryNode
  const timestamp = new Date().toISOString()
  const run = {
    id: `run-${randomUUID()}`,
    canvasId: canvas.id,
    projectId: canvas.id,
    canvasRevision: canvas.revision,
    entryNodeId: entryNode.id,
    entryNodeType: entryNode.type,
    entryNodeName: entryNode.name || entryNode.type,
    nodeIds: plannedNodeIds,
    ...(idempotencyKey ? { idempotencyKey: idempotencyKey.trim() } : {}),
    input: { entryNode: structuredClone(executionEntryNode), nodes: structuredClone(nodes), edges: structuredClone(executionCanvas.edges || []) },
    parameters: Object.fromEntries(nodes.map((node) => [node.id, structuredClone(node.config || {})])),
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


const SLOT_VIEWS = ['front', 'back', 'left', 'right']

// What one result slot holds after a stage ran. A slot names which of the
// stage's results it is (`generatedAssets.slot`), so the output is picked apart
// the same way resultArtifacts() does on the client: one slot per view, one per
// candidate image, one model, one export file.
function slotOutput(slot, output, runId) {
  const origin = { sourceId: slot.generatedAssets.resultOf.sourceId, runId }
  const base = { ...slot.generatedAssets, resultOf: origin }
  const previews = Array.isArray(output.previews) ? output.previews.filter((preview) => typeof preview === 'string' && preview) : []
  const viewPreviews = output.viewPreviews && typeof output.viewPreviews === 'object' ? output.viewPreviews : {}
  const spec = slot.generatedAssets.slot || ''

  if (slot.type === 'generated-export') {
    const downloads = Array.isArray(output.outputs) ? output.outputs : output.downloadUrl ? [{ downloadUrl: output.downloadUrl, filename: output.filename, format: output.format }] : []
    return { ...base, preview: output.preview, modelUrl: output.modelUrl, outputs: downloads }
  }
  if (slot.type === 'generated-model') return { ...base, preview: output.preview, modelUrl: output.modelUrl }

  const view = viewPreviews[slot.generatedAssets.view] || (spec.startsWith('view:') ? viewPreviews[spec.slice(5)] : null)
  if (typeof view === 'string' && view) return { ...base, preview: view }
  const index = Number(spec.startsWith('image:') ? spec.slice(6) : 0)
  const preview = previews[index] || (index === 0 ? output.preview : null)
  return preview ? { ...base, preview } : base
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
    const { modelUrl = null, preview = null, ports = null } = nodeRun.output
    // `ports` carries the per-output-port values a multi-output node produced,
    // which a single `preview` cannot represent.
    if (modelUrl || preview || ports) context.set(nodeId, { tripoTaskId: nodeRun.tripoTaskId || null, meshyTaskId: nodeRun.meshyTaskId || nodeRun.output?.meshyTaskId || null, modelUrl, preview, ports })
  }
  // The provider resolves inputs against the full canvas, not the pruned
  // execution canvas: a single-node run carries no edges, so the upstream image
  // or mesh would be invisible to it.
  const provider = createProvider ? createProvider({ context, run, onUpdate, canvas }) : null
  const nodeIds = new Set(nodes.map((node) => node.id))
  // Every planned node gets a dependency set, including one the caller appended
  // without an edge of its own; leaving it out would crash the wave loop below.
  const dependencies = new Map([...nodeIds].map((nodeId) => [nodeId, new Set()]))
  // Edges are converted to plain source/target ids first: stagesOnlyEdges works
  // on ids, while an execution canvas keeps `{ nodeId, port }` ends.
  const linked = (executionCanvas.edges || [])
    .filter((edge) => nodeIds.has(edge.source?.nodeId) && nodeIds.has(edge.target?.nodeId))
    .map((edge) => ({ source: edge.source.nodeId, target: edge.target.nodeId }))
  for (const edge of stagesOnlyEdges(nodes, linked, isResultNodeType, slotStageOf(canvas))) {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target) && dependencies.has(edge.target)) dependencies.get(edge.target).add(edge.source)
  }
  // A stage feeds its result slots: whatever it produced this run is written into
  // the canvas node that stands for it, so the canvas shows the result without the
  // run having to create a node for it.
  const fillSlots = async () => {
    const slots = (canvas.nodes || []).filter((node) => isResultNodeType(node.type) && node.generatedAssets?.resultOf?.sourceId)
    let changed = false
    for (const slot of slots) {
      const stageId = slot.generatedAssets.resultOf.sourceId
      // Only what this run executed fills its slots; a stage outside the plan
      // keeps whatever an earlier run left in its slot.
      if (!run.nodeRuns[stageId]) continue
      const nodeRun = run.nodeRuns[stageId]
      if (nodeRun.status !== 'succeeded' || !nodeRun.output) continue
      const next = slotOutput(slot, nodeRun.output, slot.generatedAssets.resultOf.runId || run.id)
      if (!next) continue
      slot.generatedAssets = next
      changed = true
    }
    if (changed) await onUpdate()
  }
  const completed = new Set()
  while (completed.size < nodes.length && !run.cancelRequested) {
    const ready = nodes.filter((node) => !completed.has(node.id) && [...dependencies.get(node.id)].every((id) => completed.has(id)))
    if (!ready.length) break
    for (const node of ready) run.nodeRuns[node.id].status = 'running'
    await onUpdate()
    let deferred = false
    await Promise.all(ready.map(async (node) => {
      try {
        const result = await executeNode(node, executionCanvas, provider ? { provider } : undefined)
        if (result.status === 'running') {
          const nodeRun = run.nodeRuns[node.id]
          nodeRun.status = 'running'
          if (result.meshyTaskId) nodeRun.meshyTaskId = result.meshyTaskId
          if (result.meshyTaskEndpoint) nodeRun.meshyTaskEndpoint = result.meshyTaskEndpoint
          if (result.meshyFollowup) nodeRun.meshyFollowup = result.meshyFollowup
          if (result.meshyHandedOff) nodeRun.meshyHandedOff = true
          if (result.progress !== undefined) nodeRun.progress = result.progress
          deferred = true
          return
        }
        if (result.status === 'succeeded') context.set(node.id, { tripoTaskId: result.tripoTaskId || null, meshyTaskId: result.meshyTaskId || null, modelUrl: result.output?.modelUrl || null, preview: result.output?.preview || null, ports: result.output?.ports || null })
        recordNodeExecution(runs, { runId: run.id, canvas, node, result, entryNode, mode: run.mode })
      } catch (failure) {
        const activeNodeRun = run.nodeRuns[node.id]
        recordNodeExecution(runs, { runId: run.id, canvas, node, entryNode, mode: run.mode, result: { status: 'failed', durationMs: null, output: null, error: failure.message, ...(activeNodeRun?.tripoTaskId ? { tripoTaskId: activeNodeRun.tripoTaskId } : {}), ...(activeNodeRun?.progress === undefined ? {} : { progress: activeNodeRun.progress }) } })
      } finally {
        const nodeRun = run.nodeRuns[node.id]
        if (!(nodeRun.status === 'running' && nodeRun.meshyHandedOff)) completed.add(node.id)
      }
    }))
    await fillSlots()
    await onUpdate()
    if (deferred) {
      run.status = 'running'
      run.completedAt = null
      await onUpdate()
      return executionDto(run)
    }
    if (Object.values(run.nodeRuns).some((nodeRun) => nodeRun.status === 'failed')) break
  }
  for (const nodeRun of Object.values(run.nodeRuns)) {
    if (nodeRun.status === 'queued') nodeRun.status = 'skipped'
  }
  if (run.cancelRequested) run.status = 'cancelled'
  else if (Object.values(run.nodeRuns).some((nodeRun) => nodeRun.status === 'failed')) run.status = 'failed'
  else if (Object.values(run.nodeRuns).some((nodeRun) => nodeRun.status === 'waiting_review')) run.status = 'waiting_review'
  else run.status = 'succeeded'
  run.completedAt = new Date().toISOString()
  await fillSlots()
  await onUpdate()
  return executionDto(run)
}
