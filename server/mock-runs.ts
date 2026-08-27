// Inbound media is read through each node's declared input ports, so what a node
// receives follows the graph rather than a guess about which upstream types
// carry an image or a mesh.
import { isExecutableNodeType } from '../src/canvas-schema.js'
import { resolveNodeInputs } from '../src/canvas-nodes.js'

// The bundled demo images this simulation hands back. They belong to the
// simulation rather than to a node's defaults: an untouched node has produced
// nothing yet, so its result area stays empty until a run fills it in.
const demoConceptImages = ['/shark-concept-front.png', '/shark-concept-left.png', '/shark-concept-right.png', '/shark-concept-back.png']
const demoViewImages = { front: '/shark-concept-front.png', back: '/shark-concept-back.png', left: '/shark-concept-left.png', right: '/shark-concept-right.png' }
const demoModelImages = { retopology: '/shark-retopology.png', texture: '/shark-textured.png', 'model-preview': '/shark-review.png' }
const demoModelUrl = '/models/shark-gardener.glb'

function demoModelImage(type) {
  return demoModelImages[type] || '/shark-model.png'
}

// Nodes are executed one request at a time, so an upstream result is read from
// the config the canvas already saved rather than from a shared run record.
function asList(value) {
  return value == null ? [] : [...new Set([value].flat().filter(Boolean))]
}

function resolveInputImages(node, canvas) {
  return asList(resolveNodeInputs(node, canvas).image)
}

function resolveInputImage(node, canvas) {
  return resolveInputImages(node, canvas)[0] || null
}

function exportTarget(node, canvas) {
  const inputs = resolveNodeInputs(node, canvas)
  if (inputs.model) return '3D Model'
  return inputs.image ? 'Image' : '3D Model'
}

export function nodeOutput(node, canvas) {
  if (['reference-image', 'generated-image'].includes(node.type)) {
    const image = resolveInputImage(node, canvas) || null
    return { message: `${node.name} ready`, image, preview: image }
  }
  // A previous run's images and its selection are results, so they read
  // generatedAssets; `amount` and the rest are parameters and read config.
  if (node.type === 'generate-image') {
    const all = node.generatedAssets?.previews?.length ? node.generatedAssets.previews : demoConceptImages
    const count = Number(node.config?.amount) > 0 ? Number(node.config.amount) : all.length
    const previews = all.slice(0, count)
    const selected = previews.includes(node.generatedAssets?.selectedPreview) ? node.generatedAssets.selectedPreview : previews[0] || null
    return { message: 'Image candidates generated', previews, image: selected }
  }
  if (node.type === 'image-decomposition') {
    const all = node.generatedAssets?.previews?.length ? node.generatedAssets.previews : demoConceptImages
    const previews = all.slice(0, Number(node.config?.amount) || 4)
    return { message: 'Image assets extracted', previews, image: previews[0] || null }
  }
  if (node.type === 'generate-multiview-images') {
    const viewPreviews = Object.keys(node.generatedAssets?.viewPreviews || {}).length ? node.generatedAssets.viewPreviews : demoViewImages
    // The four views are this node's four output ports, so they double as the
    // port-keyed result downstream nodes resolve against.
    return { message: 'Front, back, left, and right views generated', viewPreviews, ports: { ...viewPreviews } }
  }
  if (node.type === 'review') {
    const image = resolveInputImage(node, canvas) || null
    return { message: node.generatedAssets?.approved ? 'Image approved' : 'Awaiting image approval', image, preview: image }
  }
  if (['generate-model', 'smart-mesh', 'multiview-to-3d', 'text-to-3d', 'retopology', 'texture', 'rigging', 'segments', 'model-preview'].includes(node.type)) {
    if (node.type === 'generate-model') {
      const inputImages = resolveInputImages(node, canvas)
      return { message: `${node.name} generated from ${inputImages.length > 1 ? `${inputImages.length} images` : inputImages.length === 1 ? '1 image' : 'text'}`, preview: demoModelImage(node.type), modelUrl: demoModelUrl, inputMode: inputImages.length > 1 ? 'multi-image' : inputImages.length === 1 ? 'single-image' : 'text', inputImages }
    }
    return node.type === 'texture'
      ? { message: 'UV texture generated', preview: demoModelImage(node.type), modelUrl: demoModelUrl, textureQuality: node.config?.textureQuality || 'detailed' }
      : { message: `${node.name} generated`, preview: demoModelImage(node.type), modelUrl: demoModelUrl }
  }
  if (node.type === 'export-model') {
    const format = ['usdz', 'fbx', 'obj', 'stl', 'gltf', '3mf'].includes(node.config?.modelFormat) ? node.config.modelFormat : 'gltf'
    const fileName = node.config?.fileName || 'shark-gardener'
    const outputs = [{ destination: 'dcc', format, filename: `${fileName}.${format === 'gltf' ? 'glb' : format}`, downloadUrl: '/models/shark-gardener.glb', mock: format !== 'gltf' }]
    return { message: `${node.name} ready`, target: exportTarget(node, canvas), format, outputs, preview: '/shark-model.png', modelUrl: outputs[0].downloadUrl }
  }
  return { message: `Mock ${node.type} result` }
}

export function executionNodes(canvas) {
  const executableNodes = canvas.nodes.filter((node) => isExecutableNodeType(node.type))
  const nodesById = new Map(executableNodes.map((node) => [node.id, node]))
  const outgoing = new Map(executableNodes.map((node) => [node.id, []]))
  const indegree = new Map(executableNodes.map((node) => [node.id, 0]))

  const dependencies = new Set()
  for (const edge of canvas.edges || []) {
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

export function downstreamCanvas(canvas, startNodeId) {
  const executableNodes = canvas.nodes.filter((node) => isExecutableNodeType(node.type))
  const nodeIds = new Set(executableNodes.map((node) => node.id))
  if (!nodeIds.has(startNodeId)) return null

  const outgoing = new Map(executableNodes.map((node) => [node.id, []]))
  for (const edge of canvas.edges || []) {
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
    ...structuredClone(canvas),
    nodes: executableNodes.filter((node) => includedNodeIds.has(node.id)).map((node) => structuredClone(node)),
    edges: (canvas.edges || []).filter((edge) => (
      includedNodeIds.has(edge.source?.nodeId) && includedNodeIds.has(edge.target?.nodeId)
    )).map((edge) => structuredClone(edge)),
  }
}

// Executes one node and returns its result. Failing nodes surface as a thrown
// error so the caller can stop the sequence and report which node broke.
//
// `provider` runs the node against a real backend. It returns null for a node it
// does not handle, which falls through to the simulation below, so a canvas with
// no provider configured behaves exactly as it always has.
export async function executeNode(node, canvas, {
  wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration)),
  provider = null,
} = {}) {
  if (node.config?.mockFailure) {
    const error = new Error(`Mock ${node.type} execution failed`)
    error.statusCode = 422
    throw error
  }

  if (provider) {
    const produced = await provider(node, canvas)
    if (produced) return produced
  }

  const startedAt = Date.now()
  await wait(5000)

  // An unapproved check node is not a failure: it holds the sequence until the
  // user approves, so the caller stops without marking anything red.
  const status = node.type === 'review' && !node.generatedAssets?.approved ? 'waiting_review' : 'succeeded'

  return {
    nodeId: node.id,
    status,
    durationMs: Math.max(1, Date.now() - startedAt),
    output: nodeOutput(node, canvas),
  }
}
