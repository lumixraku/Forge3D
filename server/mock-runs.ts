import { randomUUID } from './ids.js'

const terminalStatuses = new Set(['succeeded', 'failed', 'waiting_review'])

// The single input handle is untyped, so inbound media is read from what each
// upstream node produces rather than from a named target port.
const modelProducingTypes = new Set(['generate-model', 'smart-mesh', 'multiview-to-3d', 'text-to-3d', 'retopology', 'bake', 'texture', 'rigging', 'segments', 'model-preview'])

function inboundSources(node, workflow) {
  const nodesById = new Map(workflow.nodes.map((item) => [item.id, item]))
  return (workflow.edges || [])
    .filter((edge) => edge.target?.nodeId === node.id)
    .map((edge) => nodesById.get(edge.source?.nodeId))
    .filter(Boolean)
}

function exportTarget(node, workflow) {
  const sources = inboundSources(node, workflow)
  if (sources.some((source) => modelProducingTypes.has(source.type))) return '3D Model'
  if (sources.length) return 'Image'
  return '3D Model'
}

function sourceOutputImage(sourceNode, run) {
  const output = run.nodeRuns[sourceNode.id]?.output
  return output?.image || output?.preview || sourceNode.config?.selectedPreview || sourceNode.config?.preview || sourceNode.config?.previews?.[0] || null
}

function sourceOutputImages(sourceNode, run) {
  const output = run.nodeRuns[sourceNode.id]?.output
  const images = [
    ...(Array.isArray(output?.previews) ? output.previews : []),
    ...Object.values(output?.viewPreviews || {}),
  ].filter(Boolean)
  if (images.length) return [...new Set(images)]
  const image = sourceOutputImage(sourceNode, run)
  return image ? [image] : []
}

function resolveInputImages(node, workflow, run) {
  return [...new Set(inboundSources(node, workflow)
    .filter((source) => !modelProducingTypes.has(source.type))
    .flatMap((source) => sourceOutputImages(source, run)))]
}

function resolveInputImage(node, workflow, run) {
  for (const source of inboundSources(node, workflow)) {
    if (modelProducingTypes.has(source.type)) continue
    const image = sourceOutputImage(source, run)
    if (image) return image
  }
  return null
}

function nodeOutput(node, workflow, run) {
  if (['reference-image', 'generated-image'].includes(node.type)) {
    const image = resolveInputImage(node, workflow, run) || node.config?.preview || null
    return { message: `${node.name} ready`, image, preview: image }
  }
  if (node.type === 'generate-image') {
    const all = node.config?.previews || []
    const count = Number(node.config?.amount) > 0 ? Number(node.config.amount) : all.length
    const previews = all.slice(0, count)
    const selected = previews.includes(node.config?.selectedPreview) ? node.config.selectedPreview : previews[0] || null
    return { message: 'Image candidates generated', previews, image: selected }
  }
  if (node.type === 'image-decomposition') {
    const previews = (node.config?.previews || []).slice(0, Number(node.config?.amount) || 4)
    return { message: 'Image assets extracted', previews, image: previews[0] || null }
  }
  if (node.type === 'generate-multiview-images') {
    return { message: 'Front, back, left, and right views generated', viewPreviews: node.config?.viewPreviews || {} }
  }
  if (node.type === 'review') {
    const image = resolveInputImage(node, workflow, run) || node.config?.preview || null
    return { message: node.config?.approved ? 'Image approved' : 'Awaiting image approval', image, preview: image }
  }
  if (['generate-model', 'smart-mesh', 'multiview-to-3d', 'text-to-3d', 'retopology', 'bake', 'texture', 'rigging', 'segments', 'model-preview'].includes(node.type)) {
    if (node.type === 'generate-model') {
      const inputImages = resolveInputImages(node, workflow, run)
      return { message: `${node.name} generated from ${inputImages.length > 1 ? `${inputImages.length} images` : inputImages.length === 1 ? '1 image' : 'text'}`, preview: node.config?.preview || null, inputMode: inputImages.length > 1 ? 'multi-image' : inputImages.length === 1 ? 'single-image' : 'text', inputImages }
    }
    return node.type === 'texture'
      ? { message: 'UV texture generated', preview: node.config?.preview || null, textureQuality: node.config?.textureQuality || 'detailed' }
      : { message: `${node.name} generated`, preview: node.config?.preview || null }
  }
  if (node.type === 'export-model') {
    const format = ['usdz', 'fbx', 'obj', 'stl', 'gltf', '3mf'].includes(node.config?.modelFormat) ? node.config.modelFormat : 'gltf'
    const fileName = node.config?.fileName || 'shark-gardener'
    const outputs = [{ destination: 'dcc', format, filename: `${fileName}.${format === 'gltf' ? 'glb' : format}`, downloadUrl: '/models/shark-gardener.glb', mock: format !== 'gltf' }]
    return { message: `${node.name} ready`, target: exportTarget(node, workflow), format, outputs, preview: node.config?.preview || '/shark-model.png' }
  }
  return { message: `Mock ${node.type} result` }
}

export function executionNodes(workflow) {
  const executableNodes = workflow.nodes.filter((node) => node.type !== 'frame')
  const nodesById = new Map(executableNodes.map((node) => [node.id, node]))
  const outgoing = new Map(executableNodes.map((node) => [node.id, []]))
  const indegree = new Map(executableNodes.map((node) => [node.id, 0]))

  const dependencies = new Set()
  for (const edge of workflow.edges || []) {
    const sourceId = edge.source?.nodeId
    const targetId = edge.target?.nodeId
    if (!nodesById.has(sourceId) || !nodesById.has(targetId) || dependencies.has(`${sourceId}:${targetId}`)) continue
    dependencies.add(`${sourceId}:${targetId}`)
    outgoing.get(sourceId).push(targetId)
    indegree.set(targetId, indegree.get(targetId) + 1)
  }

  const queued = executableNodes.filter((node) => indegree.get(node.id) === 0)
  const ordered = []
  while (queued.length) {
    const node = queued.shift()
    ordered.push(node)
    for (const targetId of outgoing.get(node.id)) {
      indegree.set(targetId, indegree.get(targetId) - 1)
      if (indegree.get(targetId) === 0) queued.push(nodesById.get(targetId))
    }
  }

  return ordered.length === executableNodes.length ? ordered : executableNodes
}

export function downstreamWorkflow(workflow, startNodeId) {
  const executableNodes = workflow.nodes.filter((node) => node.type !== 'frame')
  const nodeIds = new Set(executableNodes.map((node) => node.id))
  if (!nodeIds.has(startNodeId)) return null

  const outgoing = new Map(executableNodes.map((node) => [node.id, []]))
  for (const edge of workflow.edges || []) {
    const sourceId = edge.source?.nodeId
    const targetId = edge.target?.nodeId
    if (outgoing.has(sourceId) && nodeIds.has(targetId)) outgoing.get(sourceId).push(targetId)
  }

  const includedNodeIds = new Set([startNodeId])
  const queued = [startNodeId]
  while (queued.length) {
    const nodeId = queued.shift()
    for (const targetId of outgoing.get(nodeId)) {
      if (includedNodeIds.has(targetId)) continue
      includedNodeIds.add(targetId)
      queued.push(targetId)
    }
  }

  return {
    ...structuredClone(workflow),
    nodes: executableNodes.filter((node) => includedNodeIds.has(node.id)).map((node) => structuredClone(node)),
    edges: (workflow.edges || []).filter((edge) => (
      includedNodeIds.has(edge.source?.nodeId) && includedNodeIds.has(edge.target?.nodeId)
    )).map((edge) => structuredClone(edge)),
  }
}

export function createMockRun(workflow, { id = `run-${randomUUID()}`, now = () => new Date().toISOString() } = {}) {
  const createdAt = now()
  const nodes = executionNodes(workflow)
  const nodeRuns = Object.fromEntries(nodes.map((node, index) => [node.id, {
    status: index === 0 ? 'running' : 'queued',
    durationMs: null,
    output: null,
    error: null,
  }]))
  const empty = nodes.length === 0

  return {
    id,
    workflowId: workflow.id,
    workflowRevision: workflow.revision,
    status: empty ? 'succeeded' : 'running',
    createdAt,
    completedAt: empty ? createdAt : null,
    nodeRuns,
  }
}

export async function executeMockRun(run, workflow, {
  wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration)),
  persist = async () => {},
  now = () => new Date().toISOString(),
} = {}) {
  const nodes = executionNodes(workflow)
  for (const [index, node] of nodes.entries()) {
    const nodeRun = run.nodeRuns[node.id]
    nodeRun.status = 'running'
    await persist()
    const durationMs = 650
    await wait(600)

    if (node.type === 'review' && !node.config?.approved) {
      nodeRun.status = 'waiting_review'
      nodeRun.durationMs = durationMs
      nodeRun.output = nodeOutput(node, workflow, run)
      run.status = 'waiting_review'
      await persist()
      return run
    }

    if (node.config?.mockFailure) {
      nodeRun.status = 'failed'
      nodeRun.durationMs = durationMs
      nodeRun.error = `Mock ${node.type} execution failed`
      run.status = 'failed'
      run.completedAt = now()
      await persist()
      return run
    }

    nodeRun.status = 'succeeded'
    nodeRun.durationMs = durationMs
    nodeRun.output = nodeOutput(node, workflow, run)
    if (nodes[index + 1]) run.nodeRuns[nodes[index + 1].id].status = 'running'
    await persist()
  }

  run.status = 'succeeded'
  run.completedAt = now()
  await persist()
  return run
}

export function isRunTerminal(run) {
  return terminalStatuses.has(run.status)
}
