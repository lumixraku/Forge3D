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
import { assetUrlPrefix, persistTripoAsset, resolveAssetPath } from './tripo-assets.js'

const root = path.dirname(fileURLToPath(import.meta.url))
const publicDirectory = path.join(root, '..', 'public')

// Which upstream node types carry a mesh rather than an image. Mirrors the set
// the mock producer uses so both providers read the same graph the same way.
const MODEL_PRODUCING_TYPES = new Set(['generate-model', 'smart-mesh', 'multiview-to-3d', 'text-to-3d', 'retopology', 'bake', 'texture', 'rigging', 'segments', 'model-preview'])

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

/** Collects the prompt text reachable on this node's inputs, plus its own. */
function resolvePrompt(node, canvas) {
  const own = typeof node.config?.prompt === 'string' ? node.config.prompt.trim() : ''
  if (own) return own
  for (const source of inboundSources(node, canvas)) {
    const text = typeof source.config?.prompt === 'string' ? source.config.prompt.trim() : ''
    if (text) return text
  }
  return ''
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
  for (const source of inboundSources(node, canvas)) {
    const produced = context.get(source.id)
    if (!produced) continue
    // A generation task id lets Tripo read the mesh server-side and skips a
    // re-upload; anything else has to be addressed by its stored file.
    if (produced.tripoTaskId && GENERATION_NODE_TYPES.has(source.type)) return { taskId: produced.tripoTaskId }
    if (produced.modelUrl) return { reference: produced.modelUrl }
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
  const views = source.config?.viewPreviews
  return source.config?.selectedPreview
    || source.config?.preview
    || source.config?.previews?.[0]
    // Tripo's image-to-model takes one image; the front view is the canonical one.
    || views?.front
    || Object.values(views || {}).find(Boolean)
    || null
}

/**
 * Finds the image this node should be guided by, walking upstream until one turns
 * up. The search has to cross model-producing nodes rather than stop at them:
 * texturing a retopologised mesh still needs the original reference image, which
 * by then sits several hops back, and `/models/texture` fails with
 * `reference_image_path not found` when it is missing.
 */
function resolveUpstreamImage(node, canvas, context = new Map()) {
  const seen = new Set([node.id])
  let frontier = inboundSources(node, canvas)
  while (frontier.length) {
    const next = []
    for (const source of frontier) {
      if (seen.has(source.id)) continue
      seen.add(source.id)
      // A model-producing node carries no usable image itself, but its own
      // inputs may.
      if (!MODEL_PRODUCING_TYPES.has(source.type)) {
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
  fetchImpl = fetch,
  pollIntervalMs = 2000,
  taskTimeoutMs = 600000,
} = {}) {
  if (!usesTripo(node)) return null
  const startedAt = Date.now()

  // Model transforms read the mesh from this run; generate-model reads an image
  // and falls back to text.
  const needsModel = node.type !== 'generate-model'
  const upstreamModel = needsModel ? resolveUpstreamModel(node, canvas, context) : null
  const input = needsModel
    // A generation task id is passed straight through; a stored mesh has to be
    // uploaded, because Tripo cannot fetch a local /api/assets path.
    ? upstreamModel?.taskId || await toTripoInput(upstreamModel?.reference, { client, uploads })
    : await toTripoInput(resolveUpstreamImage(node, canvas, context), { client, uploads })
  const imageInput = node.type === 'texture'
    ? await toTripoInput(resolveUpstreamImage(node, canvas, context), { client, uploads })
    : null

  const request = tripoRequest(node, { input, prompt: resolvePrompt(node, canvas), imageInput })
  if (!request) return null

  const taskId = await client.createTask(request.endpoint, request.body)
  await onProgress({ tripoTaskId: taskId, progress: 0 })
  const task = await client.awaitTask(taskId, {
    intervalMs: pollIntervalMs,
    timeoutMs: taskTimeoutMs,
    onProgress: (current) => onProgress({ tripoTaskId: taskId, progress: current.progress ?? 0 }),
  })

  // Output URLs expire in about five minutes, so both files are copied now.
  const [preview, modelUrl] = await Promise.all([
    persistTripoAsset(task.output?.rendered_image_url, { fetchImpl }),
    persistTripoAsset(task.output?.model_url, { fetchImpl }),
  ])

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
    output: tripoNodeOutput(node, task, { preview, modelUrl, fallbackPreview }),
  }
}
