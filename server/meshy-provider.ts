// Runs one canvas node against Meshy. Input resolution mirrors the Tripo
// provider — the same ports, prompts, and upstream previews — but Meshy has no
// file upload endpoint: images are handed over as public URLs or data URIs, so
// a local file is read off disk and inlined rather than uploaded.

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { meshyNodeOutput, meshyRequest, usesMeshy } from './meshy-mapping.js'
import { assetUrlPrefix, resolveAssetPath } from './tripo-assets.js'
import { resolveGenerateModelImages, resolvePrompt, resolveUpstreamPreview } from './tripo-provider.js'
import { nodeInputPorts, nodeOutputPortValues, resolveInputSources } from '../src/canvas-nodes.js'

const root = path.dirname(fileURLToPath(import.meta.url))
const publicDirectory = path.join(root, '..', 'public')

// Only images reach Meshy here: generate-model is the one backed node type, and
// it never takes a mesh. Meshy itself accepts jpg, jpeg, and png.
const IMAGE_MIME_BY_EXTENSION = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
}

/**
 * Turns whatever a node holds as a reference into something Meshy accepts.
 *
 * - `data:` URL (how an uploaded reference image is stored today) -> passed
 *   through untouched; Meshy reads data URIs directly
 * - a local path, either a persisted asset or a bundled demo file -> read and
 *   inlined as a data URI
 * - a public http(s) URL -> passed through untouched
 */
async function toMeshyInput(reference, { readAsset, binary = false } = {}) {
  if (!reference || typeof reference !== 'string') return null
  if (/^https?:\/\//.test(reference) || reference.startsWith('data:')) return reference

  let bytes
  let filename
  if (reference.startsWith(assetUrlPrefix)) {
    const assetId = reference.slice(assetUrlPrefix.length)
    if (readAsset) {
      const asset = await readAsset(assetId)
      if (!asset) throw new Error('The upstream asset could not be read.')
      bytes = asset.bytes
      filename = assetId
    } else {
      const resolved = resolveAssetPath(assetId)
      if (!resolved) throw new Error('The upstream asset could not be read.')
      bytes = await readFile(resolved)
      filename = path.basename(resolved)
    }
  } else if (reference.startsWith('/')) {
    // A bundled demo file such as /shark-reference.png. Meshy cannot fetch a
    // local dev path, so it is inlined like any other reference.
    const resolved = path.join(publicDirectory, reference)
    if (!resolved.startsWith(publicDirectory + path.sep)) throw new Error('The reference image path is not allowed.')
    bytes = await readFile(resolved).catch(() => { throw new Error(`The reference file ${reference} is missing.`) })
    filename = path.basename(resolved)
  } else {
    throw new Error(`The reference "${reference}" is not a supported image source.`)
  }

  const extension = filename.split('.').pop()?.toLowerCase() || ''
  const mime = binary ? 'application/octet-stream' : (IMAGE_MIME_BY_EXTENSION[extension] || 'application/octet-stream')
  return `data:${mime};base64,${bytes.toString('base64')}`
}

const IMAGE_TASK_TYPES = new Set(['text-to-image', 'image-to-image'])

// The mesh this node should transform. A Meshy task id lets the next API skip
// re-uploading the file. `portId` limits the search to one input, so Animation
// can read its rig and its motion clip from different ports.
async function resolveMesh(node, canvas, context, toInput, portId = null) {
  const sources = resolveInputSources(node, canvas)
  const ports = nodeInputPorts(node.type).filter((port) => (port.type === 'model' || port.type === 'any') && (!portId || port.id === portId))
  for (const port of ports) {
    const source = (sources[port.id] || [])[0]
    if (!source) continue
    const produced = context.get(source.node.id)
    if (produced?.meshyTaskId) return { taskId: produced.meshyTaskId, modelUrl: produced.modelUrl || null, sourceType: source.node.type }
    const value = nodeOutputPortValues(source.node, produced)[source.portId]
    if (typeof value === 'string' && value) return { modelUrl: await toInput(value, { binary: true }), sourceType: source.node.type }
  }
  return null
}

/**
 * Executes one node through Meshy and returns the same `{ status, durationMs,
 * output }` shape the mock producer returns. Returns null for a node type Meshy
 * does not back; the shared runner turns that into an unsupported-node failure.
 *
 * `context` is the run-scoped Map of nodeId -> produced media, which this reads
 * for upstream input and the caller updates from the result.
 */
export async function executeMeshyNode(node, canvas, {
  client,
  context = new Map(),
  readAsset,
  onProgress = async () => {},
  pollIntervalMs = 2000,
} = {}) {
  if (!usesMeshy(node)) return null
  const startedAt = Date.now()

  if (node.type === 'export-model') {
    const sources = resolveInputSources(node, canvas)
    const modelPort = nodeInputPorts(node.type).find((port) => port.type === 'model')
    const source = (sources[modelPort?.id] || [])[0]
    const produced = source ? context.get(source.node.id) : null
    const modelUrl = produced?.modelUrl || (source ? nodeOutputPortValues(source.node, produced)[modelPort.id] : null)
    if (!modelUrl) throw new Error(`${node.name || 'Export'} needs an upstream 3D model.`)
    const fileName = node.config?.fileName || 'model'
    return {
      nodeId: node.id,
      status: 'succeeded',
      durationMs: Math.max(1, Date.now() - startedAt),
      progress: 100,
      output: {
        message: `${node.name || 'Export'} ready`,
        target: '3D Model',
        format: 'gltf',
        modelUrl,
        outputs: [{ destination: 'dcc', format: 'gltf', filename: `${fileName}.glb`, downloadUrl: modelUrl }],
      },
    }
  }

  const toInput = (reference, options) => toMeshyInput(reference, { readAsset, ...options })
  const imageNodes = node.type === 'generate-model' || node.type === 'multiview-to-3d' || node.type === 'image-to-image' || node.type === 'creative-lab' || node.type === 'retexture'
  const resolved = imageNodes
    ? await resolveGenerateModelImages(node, canvas, context, { toInput, labeledViews: false })
    : {}
  const mesh = await resolveMesh(node, canvas, context, toInput, node.type === 'animation' ? 'model' : null)
  const motion = node.type === 'animation' ? await resolveMesh(node, canvas, context, toInput, 'motion') : null
  const styleImage = node.type === 'retexture' && node.config?.styleMode === 'image'
    ? await toInput(resolveStyleImage(node, canvas, context))
    : null
  const request = meshyRequest(node, {
    input: resolved.input ?? null,
    prompt: resolvePrompt(node, canvas),
    multiview: resolved.multiview ?? null,
    images: resolved.multiview ?? null,
    mesh,
    styleImage,
    rigTaskId: mesh?.sourceType === 'rigging' ? mesh.taskId : null,
    motionTaskId: motion?.sourceType === 'text-to-motion' ? motion.taskId : null,
    imageTaskId: imageTaskFrom(node, canvas, context),
  })
  if (!request) return null

  const taskId = await client.createTask(request.endpoint, request.body)
  // Text to 3D and Creative Lab are two-step, so a single-task run owns the
  // whole bar while the first task is mapped onto the first half and its
  // follow-up onto the second. The percentage never jumps backwards.
  const scale = request.refine ? (progress) => Math.round(progress / 2) : (progress) => progress
  await onProgress({ meshyTaskId: taskId, progress: 0 })
  let task = await client.awaitTask(request.endpoint, taskId, {
    intervalMs: pollIntervalMs,
    onProgress: (current) => onProgress({ meshyTaskId: taskId, progress: scale(current.progress ?? 0) }),
  })

  let endpoint = request.endpoint
  let creditsConsumed = task.consumed_credits ?? null
  if (request.refine) {
    const followup = request.refine(taskId)
    endpoint = followup.endpoint
    const refineTaskId = await client.createTask(followup.endpoint, followup.body)
    await onProgress({ meshyTaskId: refineTaskId, progress: 50 })
    const previewCredits = task.consumed_credits ?? null
    task = await client.awaitTask(followup.endpoint, refineTaskId, {
      intervalMs: pollIntervalMs,
      onProgress: (current) => onProgress({ meshyTaskId: refineTaskId, progress: 50 + Math.round((current.progress ?? 0) / 2) }),
    })
    creditsConsumed = (previewCredits ?? 0) + (task.consumed_credits ?? 0) || null
  }
  return {
    nodeId: node.id,
    status: 'succeeded',
    durationMs: Math.max(1, Date.now() - startedAt),
    meshyTaskId: task.id,
    meshyTaskEndpoint: endpoint,
    progress: 100,
    creditsConsumed,
    output: meshyNodeOutput(node, task, { fallbackPreview: resolveUpstreamPreview(node, canvas, context) }),
  }
}

function imageTaskFrom(node, canvas, context) {
  const sources = resolveInputSources(node, canvas)
  for (const source of sources.image || []) {
    const produced = context.get(source.node.id)
    if (produced?.meshyTaskId && IMAGE_TASK_TYPES.has(source.node.type)) return produced.meshyTaskId
  }
  return null
}

function resolveStyleImage(node, canvas, context) {
  const sources = resolveInputSources(node, canvas)
  const source = (sources.image || [])[0]
  if (!source) return null
  const value = nodeOutputPortValues(source.node, context.get(source.node.id))[source.portId]
  return typeof value === 'string' ? value : null
}
