// Runs one canvas node against Tripo. The mock producer reads upstream results
// from the config the canvas already saved; a real run cannot, because each
// node's output only exists once the task finishes. So execution carries a
// context keyed by node id, and this resolves each node's `input` from it.
//
// Preferring the upstream `tripoTaskId` over its file means Tripo pulls the mesh
// from the previous task server-side and nothing is re-uploaded per node.

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { tripoNodeOutput, tripoRequest, usesTripo } from './tripo-mapping.js'
import { assetUrlPrefix, resolveAssetPath } from './tripo-assets.js'
import { nodeInputPorts, nodeOutputPorts, nodeOutputPortValues, resolveInputSources, resolveNodeInputs } from '../src/canvas-nodes.js'

const root = path.dirname(fileURLToPath(import.meta.url))
const publicDirectory = path.join(root, '..', 'public')

// Meshes appear here too: a chained transform uploads its upstream result,
// which retopology emits as FBX rather than GLB.
const MIME_BY_EXTENSION = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  glb: 'model/gltf-binary', gltf: 'model/gltf+json', fbx: 'application/octet-stream',
  obj: 'text/plain', stl: 'application/octet-stream',
}

function inboundSources(node, canvas) {
  const nodesById = new Map(canvas.nodes.map((item) => [item.id, item]))
  return (canvas.edges || [])
    .filter((edge) => edge.target?.nodeId === node.id)
    .map((edge) => nodesById.get(edge.source?.nodeId))
    .filter(Boolean)
}

/**
 * The prompt this node runs with: its own field first, then whatever text its
 * declared text ports carry. A text port names its own config field as a
 * fallback, so a node with nothing connected still resolves its own prompt.
 */
function resolvePrompt(node, canvas) {
  const own = typeof node.config?.prompt === 'string' ? node.config.prompt.trim() : ''
  if (own) return own
  const text = resolveNodeInputs(node, canvas).text
  return typeof text === 'string' ? text.trim() : ''
}

/**
 * Turns whatever a node holds as a reference into something Tripo accepts.
 *
 * - `data:` URL (how an uploaded reference image is stored today) -> upload
 * - a local path, either a persisted asset or a bundled demo file -> upload
 * - a public http(s) URL -> passed through untouched
 *
 * Tokens are cached per run so the same reference is uploaded once.
 */
async function toTripoInput(reference, { client, uploads }) {
  if (!reference || typeof reference !== 'string') return null
  if (/^https?:\/\//.test(reference)) return reference
  if (uploads.has(reference)) return uploads.get(reference)

  let bytes
  let filename
  if (reference.startsWith('data:')) {
    const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(reference)
    if (!match) throw new Error('The reference image could not be read.')
    const [, mime, base64, payload] = match
    bytes = Buffer.from(base64 ? payload : decodeURIComponent(payload), base64 ? 'base64' : 'utf8')
    filename = `reference.${(mime.split('/')[1] || 'png').toLowerCase()}`
  } else if (reference.startsWith(assetUrlPrefix)) {
    const resolved = resolveAssetPath(reference.slice(assetUrlPrefix.length))
    if (!resolved) throw new Error('The upstream asset could not be read.')
    bytes = await readFile(resolved)
    filename = path.basename(resolved)
  } else if (reference.startsWith('/')) {
    // A bundled demo file such as /shark-reference.png. Tripo cannot fetch a
    // local dev path, so it is uploaded like any other reference.
    const resolved = path.join(publicDirectory, reference)
    if (!resolved.startsWith(publicDirectory + path.sep)) throw new Error('The reference image path is not allowed.')
    bytes = await readFile(resolved).catch(() => { throw new Error(`The reference file ${reference} is missing.`) })
    filename = path.basename(resolved)
  } else {
    throw new Error(`The reference "${reference}" is not a supported image source.`)
  }

  const extension = filename.split('.').pop()?.toLowerCase() || ''
  const token = await client.uploadFile(bytes, filename, MIME_BY_EXTENSION[extension] || 'application/octet-stream')
  uploads.set(reference, token)
  return token
}

/**
 * Finds the mesh this node should transform: the nearest upstream node that
 * produced one during this run.
 */
// A task id is passed through only for generation tasks; a mesh-processing
// upstream is uploaded instead. Whether Tripo would in fact resolve a
// processing task id is unconfirmed, and the upload always works, so this
// stays as the safe path rather than a proven constraint.
const GENERATION_NODE_TYPES = new Set(['generate-model', 'multiview-to-3d', 'text-to-3d', 'smart-mesh'])

/**
 * Finds the mesh this node should transform.
 *
 * Returns `{ taskId }` when Tripo can resolve the mesh itself, or `{ reference }`
 * with a stored file that has to be uploaded first. The two are not
 * interchangeable, so the caller must not pass a reference where an id is meant.
 */
function resolveUpstreamModel(node, canvas, context) {
  // Only the declared model inputs are considered, so an image feeding the same
  // node is never mistaken for its mesh.
  const sources = resolveInputSources(node, canvas)
  const modelPorts = nodeInputPorts(node.type).filter((port) => port.type === 'model' || port.type === 'any')
  for (const port of modelPorts) {
    for (const source of sources[port.id] || []) {
      const produced = context.get(source.node.id)
      if (!produced) continue
      // A generation task id lets Tripo read the mesh server-side and skips a
      // re-upload; anything else has to be addressed by its stored file.
      if (produced.tripoTaskId && GENERATION_NODE_TYPES.has(source.node.type)) return { taskId: produced.tripoTaskId }
      if (produced.modelUrl) return { reference: produced.modelUrl }
    }
  }
  return null
}

/**
 * Finds an image on this node's inputs, preferring what this run produced over
 * what the canvas saved. A multi-view upstream reports `viewPreviews` rather
 * than a single preview, and its front view is the one to reconstruct from.
 */
function nodeImage(source, context) {
  const produced = context.get(source.id)
  if (produced?.preview) return produced.preview
  // Results read generatedAssets; an uploaded asset reads uploadAssets, being input
  // the user gave rather than something a run produced.
  const views = source.generatedAssets?.viewPreviews
  return source.generatedAssets?.selectedPreview
    || source.generatedAssets?.preview
    || source.generatedAssets?.previews?.[0]
    || source.uploadAssets?.assetUrl
    // Tripo's image-to-model takes one image; the front view is the canonical one.
    || views?.front
    || Object.values(views || {}).find(Boolean)
    || null
}

/**
 * Finds the image this node should be guided by.
 *
 * A declared image port is authoritative. Failing that, the search walks
 * upstream, because the image a node needs is not always one it declares: a
 * texture node takes a mesh, yet `/models/texture` fails with
 * `reference_image_path not found` unless it is also sent the original reference
 * image, which by then sits several hops back with no edge to this node at all.
 */
function resolveUpstreamImage(node, canvas, context = new Map()) {
  const sources = resolveInputSources(node, canvas)
  for (const port of nodeInputPorts(node.type)) {
    if (port.type !== 'image' && port.type !== 'any') continue
    for (const source of sources[port.id] || []) {
      const produced = context.get(source.node.id)
      const value = nodeOutputPortValues(source.node, produced)[source.portId]
      if (value) return value
    }
  }

  const seen = new Set([node.id])
  let frontier = inboundSources(node, canvas)
  while (frontier.length) {
    const next = []
    for (const source of frontier) {
      if (seen.has(source.id)) continue
      seen.add(source.id)
      // A model-producing node carries no usable image itself, but its own
      // inputs may.
      if (!nodeOutputPorts(source.type).every((port) => port.type === 'model')) {
        const image = nodeImage(source, context)
        if (image) return image
      }
      next.push(...inboundSources(source, canvas))
    }
    frontier = next
  }
  return null
}

/**
 * The thumbnail of the nearest upstream node that produced one this run. Used by
 * a node whose own task renders no image, so it still shows what it acted on.
 */
function resolveUpstreamPreview(node, canvas, context) {
  const seen = new Set([node.id])
  let frontier = inboundSources(node, canvas)
  while (frontier.length) {
    const next = []
    for (const source of frontier) {
      if (seen.has(source.id)) continue
      seen.add(source.id)
      const produced = context.get(source.id)
      if (produced?.preview) return produced.preview
      next.push(...inboundSources(source, canvas))
    }
    frontier = next
  }
  return null
}

/**
 * Resolves generate-model's image inputs for this run. Returns `{ input }` for
 * one image, `{ multiview }` for several — labeled views become view-key
 * objects, unlabeled images become a positional string array — or `{}` when
 * nothing came in so the node falls back to text.
 */
async function resolveGenerateModelImages(node, canvas, context, { client, uploads }) {
  const sources = resolveInputSources(node, canvas)
  const views: Record<string, unknown> = {}
  for (const key of ['front', 'back', 'left', 'right']) {
    const source = (sources[key] || [])[0]
    if (!source) continue
    const value = nodeOutputPortValues(source.node, context.get(source.node.id))[source.portId]
    if (value) views[key] = value
  }
  const viewKeys = Object.keys(views)
  if (viewKeys.length >= 2 && views.front) {
    const inputs = []
    for (const key of viewKeys) inputs.push({ [key]: await toTripoInput(views[key], { client, uploads }) })
    return { multiview: inputs }
  }
  const loose = (sources.image || [])
    .map((source) => nodeOutputPortValues(source.node, context.get(source.node.id))[source.portId])
    .filter(Boolean)
  if (loose.length > 1) {
    const inputs = []
    for (const url of loose) inputs.push(await toTripoInput(url, { client, uploads }))
    return { multiview: inputs }
  }
  if (loose.length === 1) return { input: await toTripoInput(loose[0], { client, uploads }) }
  return {}
}

/**
 * Executes one node through Tripo and returns the same `{ status, durationMs,
 * output }` shape the mock producer returns.
 *
 * `context` is the run-scoped Map of nodeId -> produced media, which this reads
 * for upstream input and the caller updates from the result.
 */
export async function executeTripoNode(node, canvas, {
  client,
  context = new Map(),
  uploads = new Map(),
  onProgress = async () => {},
  pollIntervalMs = 2000,
} = {}) {
  if (!usesTripo(node)) return null
  const startedAt = Date.now()

  // Model transforms read the mesh from this run; generate-model reads an image
  // and falls back to text.
  const needsModel = node.type !== 'generate-model'
  const upstreamModel = needsModel ? resolveUpstreamModel(node, canvas, context) : null
  let input = null
  let multiview = null
  if (needsModel) {
    // A generation task id is passed straight through; a stored mesh has to be
    // uploaded, because Tripo cannot fetch a local /api/assets path.
    input = upstreamModel?.taskId || await toTripoInput(upstreamModel?.reference, { client, uploads })
  } else {
    const resolved = await resolveGenerateModelImages(node, canvas, context, { client, uploads })
    input = resolved.input ?? null
    multiview = resolved.multiview ?? null
  }
  const imageInput = node.type === 'texture'
    ? await toTripoInput(resolveUpstreamImage(node, canvas, context), { client, uploads })
    : null

  const request = tripoRequest(node, { input, prompt: resolvePrompt(node, canvas), imageInput, multiview })
  if (!request) return null

  const taskId = await client.createTask(request.endpoint, request.body)
  await onProgress({ tripoTaskId: taskId, progress: 0 })
  const task = await client.awaitTask(taskId, {
    intervalMs: pollIntervalMs,
    onProgress: (current) => onProgress({ tripoTaskId: taskId, progress: current.progress ?? 0 }),
  })

  // A convert task renders no image, so the node falls back to the thumbnail of
  // the mesh it was given.
  const fallbackPreview = resolveUpstreamPreview(node, canvas, context)

  return {
    nodeId: node.id,
    status: 'succeeded',
    durationMs: Math.max(1, Date.now() - startedAt),
    tripoTaskId: taskId,
    progress: 100,
    creditsConsumed: task.credits_consumed ?? null,
    output: tripoNodeOutput(node, task, { fallbackPreview }),
  }
}
