// Translates a canvas node into one Tripo v3 request, and a finished Tripo task
// back into the same output shape the mock producer emits. Pure functions: the
// caller resolves `input` (a file_token, an upstream task_id, or a public URL)
// and performs the HTTP call.
//
// Node types absent from this map are not backed by Tripo and stay on the mock
// producer: `bake` has no v3 endpoint, and `review` / `model-preview` / `prompt`
// / `reference-image` / `frame` never call an API.

// Only these node types reach Tripo today. 2D image nodes are deferred: Tripo's
// image models are a different enum entirely (seedream / banana / chat_image).
export const tripoNodeTypes = new Set(['generate-model', 'retopology', 'texture', 'segments', 'rigging', 'export-model'])
const TRIPO_NODE_TYPES = tripoNodeTypes

// texture_quality, geometry_quality, quad, generate_parts, auto_size,
// smart_low_poly, and compress are only honored from v3.0-20250812 onward.
function supportsV3Options(modelVersion: string) {
  return modelVersion !== 'v2.5-20250123'
}

const SEGMENTATION_GRANULARITY = { low: 'simple', medium: 'balanced', high: 'detailed' }
const CONVERT_FORMATS = { gltf: 'GLTF', fbx: 'FBX', usdz: 'USDZ', obj: 'OBJ', stl: 'STL', '3mf': '3MF' }

function generateModelRequest(config, { input, prompt }) {
  const modelVersion = config.modelVersion
  const body: Record<string, unknown> = { model: modelVersion }
  // `generate_parts` requires texture, pbr, and quad to all be false. The node
  // schema already forces that combination through its effects, so the flag is
  // trusted here and the incompatible fields are simply left off.
  if (config.generateParts && supportsV3Options(modelVersion)) {
    body.generate_parts = true
    body.texture = false
    body.pbr = false
  } else {
    body.texture = config.texture !== false
    body.pbr = body.texture ? config.pbr !== false : false
    if (body.texture && supportsV3Options(modelVersion)) body.texture_quality = config.textureQuality || 'standard'
    if (supportsV3Options(modelVersion)) body.quad = config.topology === 'quad'
  }
  if (supportsV3Options(modelVersion)) body.geometry_quality = config.geometryQuality ? 'detailed' : 'standard'
  if (Number(config.faceCount) > 0) body.face_limit = Number(config.faceCount)

  // An image input wins over the prompt: the node reconstructs from whatever the
  // upstream stage produced and only falls back to text when nothing came in.
  if (input) return { endpoint: '/generation/image-to-model', body: { ...body, input } }
  if (prompt) return { endpoint: '/generation/text-to-model', body: { ...body, prompt } }
  throw new Error('Gen HD Model needs an upstream image or a text prompt.')
}

function texturePrompt(config, { input, prompt, imageInput }) {
  if (config.inputMode === 'textGenerate' && prompt) return { text: prompt }
  // The docs recommend re-sending the reference image even when the mesh is
  // addressed by task_id, so the image is passed whenever one is available.
  if (config.inputMode === 'imageGenerate' && imageInput) return { image: imageInput }
  return null
}

/**
 * Builds the Tripo request for one node, or returns null when the node type is
 * not backed by Tripo and should fall through to the mock producer.
 *
 * `input` addresses the upstream media (file_token, upstream task_id, or URL).
 * `imageInput` is a separate image reference for nodes that take a mesh on the
 * main input and an image as guidance.
 */
export function tripoRequest(node, { input = null, prompt = '', imageInput = null } = {}) {
  if (!TRIPO_NODE_TYPES.has(node.type)) return null
  const config = node.config || {}

  if (node.type === 'generate-model') return generateModelRequest(config, { input, prompt })

  // Every remaining type transforms an existing mesh, so an input is mandatory.
  if (!input) throw new Error(`${node.name || node.type} needs an upstream 3D model.`)

  if (node.type === 'retopology') {
    // v2.0 is Smart Retopology (AI, edge-preserving); v1.0 is basic decimation,
    // which requires an explicit face limit.
    const model = config.smartPoly ? 'v2.0' : 'v1.0'
    const body: Record<string, unknown> = { input, model, quad: config.topology === 'quad' }
    if (Number(config.faceLimit) > 0) body.face_limit = Number(config.faceLimit)
    else if (model === 'v1.0') throw new Error('Retopology needs a polygon count when Smart Low Poly is off.')
    return { endpoint: '/mesh/decimate', body }
  }

  if (node.type === 'texture') {
    // The node has no version control of its own. v3.0 is the newest version
    // this endpoint accepts and the docs advise it for v3.1 meshes too.
    const body: Record<string, unknown> = { input, model: 'v3.0-20250812', pbr: true, texture_quality: config.textureQuality || 'standard' }
    const guidance = texturePrompt(config, { input, prompt, imageInput })
    if (guidance) body.texture_prompt = guidance
    return { endpoint: '/models/texture', body }
  }

  if (node.type === 'segments') {
    // v2.0 is the only version that accepts a granularity.
    return {
      endpoint: '/mesh/segment',
      body: { input, model: 'v2.0-20260430', segmentation_granularity: SEGMENTATION_GRANULARITY[config.detailLevel] || 'balanced' },
    }
  }

  if (node.type === 'rigging') {
    // `rig_type` has no control on the node yet, so Tripo's `biped` default applies.
    return { endpoint: '/animations/rig', body: { input, model: config.modelVersion || 'v1.0-20240301' } }
  }

  const format = CONVERT_FORMATS[String(config.modelFormat || 'gltf').toLowerCase()] || 'GLTF'
  const body: Record<string, unknown> = {
    input,
    format,
    texture_size: Number(config.textureSize) > 0 ? Number(config.textureSize) : 2048,
    pack_uv: config.packUV === true,
    with_animation: config.withAnimation === true,
  }
  if (body.with_animation) body.animate_in_place = config.animateInPlace === true
  if (format === 'FBX') body.fbx_preset = config.fbxPreset || 'blender'
  if (['OBJ', 'GLTF'].includes(format)) body.export_vertex_colors = config.exportVertexColors === true
  return { endpoint: '/models/convert', body }
}

// A node whose config would produce no Tripo call at all.
export function usesTripo(node) {
  return TRIPO_NODE_TYPES.has(node.type)
}

/**
 * Converts a succeeded Tripo task into the output shape the canvas already
 * renders. `preview` keeps pointing at an image so the node thumbnail works;
 * `modelUrl` is what the model editor and the export download consume.
 */
export function tripoNodeOutput(node, task, { preview = null, modelUrl = null, fallbackPreview = null } = {}) {
  const output = task?.output || {}
  // A convert task renders no image of its own, so the node would show a broken
  // thumbnail without the upstream one to fall back on.
  const resolvedPreview = preview || output.rendered_image_url || fallbackPreview || null
  const resolvedModel = modelUrl || output.model_url || null
  const taskId = task?.task_id || null
  const shared = {
    preview: resolvedPreview,
    modelUrl: resolvedModel,
    tripoTaskId: taskId,
    creditsConsumed: task?.credits_consumed ?? null,
  }

  if (node.type === 'export-model') {
    const format = String(node.config?.modelFormat || 'gltf').toLowerCase()
    const fileName = node.config?.fileName || 'model'
    const extension = format === 'gltf' ? 'glb' : format
    return {
      ...shared,
      message: `${node.name || 'Export'} ready`,
      target: '3D Model',
      format,
      outputs: taskId
        ? [{ destination: 'dcc', format, filename: `${fileName}.${extension}`, downloadUrl: `/api/tripo/tasks/${encodeURIComponent(taskId)}/download` }]
        : resolvedModel ? [{ destination: 'dcc', format, filename: `${fileName}.${extension}`, downloadUrl: resolvedModel }] : [],
    }
  }

  if (node.type === 'texture') {
    return {
      ...shared,
      message: 'UV texture generated',
      textureQuality: node.config?.textureQuality || 'standard',
      outputs: taskId && resolvedModel ? [{ format: 'glb', filename: 'textured-model.glb', downloadUrl: `/api/tripo/tasks/${encodeURIComponent(taskId)}/download` }] : [],
    }
  }

  return {
    ...shared,
    message: `${node.name || node.type} generated`,
    outputs: taskId && resolvedModel ? [{ format: 'glb', filename: 'model.glb', downloadUrl: `/api/tripo/tasks/${encodeURIComponent(taskId)}/download` }] : [],
  }
}
