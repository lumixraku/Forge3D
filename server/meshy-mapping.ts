// Translates a generate-model node into one Meshy request, and a finished Meshy
// task back into the same output shape the mock producer emits. Pure functions:
// the caller resolves `input` (a public URL or a data URI — Meshy has no file
// upload endpoint) and performs the HTTP call.
//
// Every Meshy task-creation API the canvas can run. export-model only forwards
// the GLB the upstream task already produced. Types outside this set return
// null and the real provider rejects them.

export const meshyNodeTypes = new Set([
  'generate-model', 'text-to-3d', 'multiview-to-3d', 'export-model',
  'text-to-image', 'image-to-image', 'text-to-motion',
  'remesh', 'retexture', 'rigging', 'animation',
  'convert-model', 'resize-model', 'uv-unwrap',
  'print-analyze', 'print-repair', 'multi-color-print', 'auto-split',
  'creative-lab',
])
const MESHY_NODE_TYPES = meshyNodeTypes

// The node's textureQuality names line up with Meshy's texture_resolution steps.
const TEXTURE_RESOLUTIONS = { standard: '2k', detailed: '4k', extreme: '8k' }

// Meshy accepts 100-300,000 polygons for a remesh. The node's 2,000,000 default
// reads as "no limit" and exceeds that range, so it intentionally maps to no
// remesh at all — which is also Meshy's own recommendation for the
// highest-quality model.
const MAX_TARGET_POLYCOUNT = 300000

// A multi-image task takes 1 to 4 images; more are dropped rather than failing.
const MAX_IMAGES = 4

const STANDARD_MODELS = new Set(['latest', 'meshy-7.1', 'meshy-7', 'meshy-6', 'meshy-6-lite'])

function sharedBody(config) {
  const smart = config.modelType === 'smart-topology'
  const aiModel = smart
    ? (config.aiModel === 'meshy-t2' ? 'meshy-t2' : 'meshy-t2.5')
    : (STANDARD_MODELS.has(config.aiModel) ? config.aiModel : 'latest')
  const body: Record<string, unknown> = { ai_model: aiModel, target_formats: ['glb'] }
  if (smart) body.model_type = 'smart-topology'
  if (!smart && (aiModel === 'latest' || aiModel === 'meshy-7.1') && (config.geometryResolution === '2k' || config.geometryResolution === '4k')) {
    body.geometry_resolution = config.geometryResolution
  }
  body.should_texture = config.texture !== false
  // PBR and texture resolution exist only while texturing runs. 6 Lite cannot
  // go above 2K.
  if (body.should_texture) {
    body.enable_pbr = config.pbr !== false
    const resolution = TEXTURE_RESOLUTIONS[config.textureQuality] || '2k'
    body.texture_resolution = aiModel === 'meshy-6-lite' && resolution !== '2k' ? '2k' : resolution
  }
  if (config.poseMode === 'a-pose' || config.poseMode === 't-pose') body.pose_mode = config.poseMode
  const faceCount = Number(config.faceCount)
  if (smart) {
    const max = aiModel === 'meshy-t2' ? 15000 : 30000
    if (faceCount >= 100) body.target_polycount = Math.min(faceCount, max)
    return body
  }
  // Topology and polycount are honored only inside a remesh. Older nodes had
  // no Remesh toggle: a quad mesh, or a polycount inside Meshy's range, asked
  // for one.
  const remesh = typeof config.shouldRemesh === 'boolean'
    ? config.shouldRemesh
    : config.topology === 'quad' || (faceCount >= 100 && faceCount <= MAX_TARGET_POLYCOUNT)
  if (remesh) {
    body.should_remesh = true
    body.topology = config.topology === 'quad' ? 'quad' : 'triangle'
    if (faceCount >= 100 && faceCount <= MAX_TARGET_POLYCOUNT) body.target_polycount = faceCount
  }
  return body
}

/**
 * Builds the Meshy request for one node, or returns null when the node type is
 * not backed by Meshy and should fall through to the mock producer.
 *
 * `input` is a single image (URL or data URI), `multiview` an ordered array of
 * images with the front view first, and `prompt` the text fallback.
 *
 * The text path returns a `refine` factory alongside the preview request: Text
 * to 3D is two-step, and the refine request needs the preview's task id, which
 * only exists once that task is created. `refine` is null when texturing is
 * off; the preview's own GLB is then the result.
 */
const IMAGE_MODELS = new Set(['nano-banana', 'nano-banana-2', 'nano-banana-2-lite', 'nano-banana-pro', 'gpt-image-2', 'gpt-image-2-5-flare', 'gpt-image-2-5-sunburst'])
const RETEXTURE_MODELS = new Set(['latest', 'meshy-6', 'meshy-6-lite', 'meshy-7'])
const CREATIVE_LAB = {
  keychain: ['/openapi/creative-lab/keychain/v1/prototype', '/openapi/creative-lab/keychain/v1/build'],
  'fridge-magnet': ['/openapi/creative-lab/fridge-magnet/v1/prototype', '/openapi/creative-lab/fridge-magnet/v1/build'],
  figure: ['/openapi/creative-lab/figure/v1/prototype', '/openapi/creative-lab/figure/v1/build'],
  'vinyl-figure': ['/openapi/creative-lab/vinyl-figure/v1/prototype', '/openapi/creative-lab/vinyl-figure/v1/build'],
  'brick-figure': ['/openapi/creative-lab/brick-figure/v1/prototype', '/openapi/creative-lab/brick-figure/v1/build'],
  lamp: ['/openapi/creative-lab/lamp/v1/prototype', '/openapi/creative-lab/lamp/v1/build'],
  keycap: ['/openapi/creative-lab/keycap/v1/prototype', '/openapi/creative-lab/keycap/v1/build'],
  'fidget-pixel': ['/openapi/creative-lab/fidget-pixel/v1/prototype', '/openapi/creative-lab/fidget-pixel/v1/build'],
  'fidget-collapsible': ['/openapi/creative-lab/fidget-collapsible/v1', null],
}

function imageRequestBody(config, prompt) {
  if (!prompt) throw new Error('This image step needs a text prompt.')
  const body = {
    ai_model: IMAGE_MODELS.has(config.aiModel) ? config.aiModel : 'nano-banana',
    prompt,
  }
  if (config.generateMultiView) body.generate_multi_view = true
  else if (config.aspectRatio) body.aspect_ratio = config.aspectRatio
  if (config.removeBackground) body.remove_background = true
  if (config.poseMode === 'a-pose' || config.poseMode === 't-pose') body.pose_mode = config.poseMode
  return body
}

// A mesh step prefers the upstream Meshy task id. A file URL is the fallback
// for an upload that never ran through Meshy.
function meshRequestBody(node, mesh, { formats = null } = {}) {
  const body = {}
  if (formats) body.target_formats = formats
  if (mesh?.taskId) body.input_task_id = mesh.taskId
  else if (mesh?.modelUrl) body.model_url = mesh.modelUrl
  else throw new Error(`${node.name || node.type} needs an upstream 3D model.`)
  return body
}

function buildMeshyTask(node, { input, prompt, images, styleImage, rigTaskId, motionTaskId, mesh, imageTaskId }) {
  const config = node.config || {}
  switch (node.type) {
    case 'text-to-image':
      return { endpoint: '/openapi/v1/text-to-image', body: imageRequestBody(config, prompt) }
    case 'image-to-image': {
      const body = imageRequestBody(config, prompt)
      if (imageTaskId) body.input_task_id = imageTaskId
      else {
        const refs = [input, ...(images || [])].filter(Boolean).slice(0, 5)
        if (!refs.length) throw new Error('Image to Image needs a reference image.')
        body.reference_image_urls = refs
      }
      return { endpoint: '/openapi/v1/image-to-image', body }
    }
    case 'text-to-motion': {
      if (!prompt) throw new Error('Text to Motion needs a text prompt.')
      const duration = Number(config.duration)
      return {
        endpoint: '/openapi/v1/text-to-motion',
        body: { prompt, mode: config.mode === 'swift' ? 'swift' : 'prime', duration: duration >= 2 && duration <= 10 ? duration : 3 },
      }
    }
    case 'remesh': {
      const body = meshRequestBody(node, mesh, { formats: ['glb'] })
      body.topology = config.topology === 'quad' ? 'quad' : 'triangle'
      const faces = Number(config.faceCount)
      if (faces >= 100 && faces <= MAX_TARGET_POLYCOUNT) body.target_polycount = faces
      return { endpoint: '/openapi/v1/remesh', body }
    }
    case 'retexture': {
      const body = meshRequestBody(node, mesh)
      body.ai_model = RETEXTURE_MODELS.has(config.aiModel) ? config.aiModel : 'latest'
      body.enable_pbr = config.pbr !== false
      body.enable_original_uv = config.enableOriginalUv === true
      const resolution = TEXTURE_RESOLUTIONS[config.textureQuality] || '2k'
      body.texture_resolution = body.ai_model === 'meshy-6-lite' && resolution !== '2k' ? '2k' : resolution
      if (config.styleMode === 'image') {
        if (!styleImage) throw new Error('Retexture needs a style image.')
        body.image_style_url = styleImage
      } else if (prompt) {
        body.text_style_prompt = prompt
      } else {
        throw new Error('Retexture needs a style prompt or a style image.')
      }
      return { endpoint: '/openapi/v1/retexture', body }
    }
    case 'rigging': {
      const body = meshRequestBody(node, mesh)
      delete body.target_formats
      const height = Number(config.heightMeters)
      if (height > 0) body.height_meters = height
      return { endpoint: '/openapi/v1/rigging', body }
    }
    case 'animation': {
      if (!rigTaskId) throw new Error('Animation needs an upstream Rigging task.')
      const body = { rig_task_id: rigTaskId }
      if (motionTaskId) body.motion_task_id = motionTaskId
      else body.action_id = Number.isFinite(Number(config.actionId)) ? Number(config.actionId) : 0
      if (config.postProcess === 'change_fps' || config.postProcess === 'fbx2usdz' || config.postProcess === 'extract_armature') {
        body.post_process = { operation_type: config.postProcess }
        if (config.postProcess === 'change_fps') body.post_process.fps = [24, 25, 30, 60].includes(Number(config.fps)) ? Number(config.fps) : 30
      }
      return { endpoint: '/openapi/v1/animations', body }
    }
    case 'convert-model': {
      const format = ['glb', 'fbx', 'obj', 'usdz', 'blend', 'stl', '3mf'].includes(config.targetFormat) ? config.targetFormat : 'fbx'
      return { endpoint: '/openapi/v1/convert', body: meshRequestBody(node, mesh, { formats: [format] }) }
    }
    case 'resize-model': {
      const body = meshRequestBody(node, mesh)
      if (config.resizeMode === 'longest') body.resize_longest_side = Number(config.resizeLength) || 1
      else if (config.resizeMode === 'auto') {
        body.auto_size = true
        body.origin_at = config.originAt === 'center' ? 'center' : 'bottom'
      } else body.resize_height = Number(config.resizeHeight) || 1
      return { endpoint: '/openapi/v1/resize', body }
    }
    case 'uv-unwrap':
      return { endpoint: '/openapi/v1/uv-unwrap', body: meshRequestBody(node, mesh) }
    case 'print-analyze':
      return { endpoint: '/openapi/v1/print/analyze', body: meshRequestBody(node, mesh) }
    case 'print-repair':
      return { endpoint: '/openapi/v1/print/repair', body: meshRequestBody(node, mesh) }
    case 'multi-color-print': {
      const body = meshRequestBody(node, mesh)
      const brands = ['bambu', 'anycubic', 'creality', 'elegoo', 'flashforge', 'prusa', 'qidi', 'snapmaker', 'ankermake']
      body.printer_brand = brands.includes(config.printerBrand) ? config.printerBrand : 'bambu'
      return { endpoint: '/openapi/v1/print/multi-color', body }
    }
    case 'auto-split': {
      const body = meshRequestBody(node, mesh, { formats: ['glb'] })
      body.mode = config.splitMode === 'by_parts' || config.splitMode === 'by_color' ? config.splitMode : 'auto'
      body.layout = config.layout === 'on_plate' ? 'on_plate' : 'assembled'
      if (body.mode !== 'auto') {
        if (!prompt) throw new Error('Auto Split needs a prompt naming the parts.')
        body.prompt = prompt
      }
      if (config.connectors) {
        body.connectors = true
        body.connector_type = config.connectorType === 'cylinder' ? 'cylinder' : 'cube'
      }
      return { endpoint: '/openapi/v1/print/split', body }
    }
    case 'creative-lab': {
      if (!input) throw new Error('Creative Lab needs an image.')
      const [prototype, build] = CREATIVE_LAB[config.product] || CREATIVE_LAB.keychain
      const body = { image_url: input }
      if ((config.product || 'keychain') === 'keychain' && config.nameText) body.name_text = String(config.nameText).trim().slice(0, 10)
      return {
        endpoint: prototype,
        body,
        refine: build ? (taskId) => ({ endpoint: build, body: { input_task_id: taskId } }) : null,
      }
    }
    default:
      return null
  }
}

export function meshyRequest(node, { input = null, prompt = '', multiview = null, mesh = null, images = null, styleImage = null, rigTaskId = null, motionTaskId = null, imageTaskId = null } = {}) {
  if (node.type === 'text-to-3d') {
    if (!prompt) throw new Error('Text to 3D needs a text prompt.')
    return generateModelRequest({ ...node, type: 'generate-model' }, { prompt })
  }
  if (node.type === 'multiview-to-3d') {
    if (!multiview?.length) throw new Error('Multi-view to 3D needs a front view and at least one more view.')
    return generateModelRequest({ ...node, type: 'generate-model' }, { multiview })
  }
  if (node.type !== 'generate-model') return buildMeshyTask(node, { input, prompt, images, styleImage, rigTaskId, motionTaskId, mesh, imageTaskId })
  return generateModelRequest(node, { input, prompt, multiview })
}

function generateModelRequest(node, { input = null, prompt = '', multiview = null }) {
  const config = node.config || {}
  const body = sharedBody(config)

  // An image input wins over the prompt: the node reconstructs from whatever the
  // upstream stage produced and only falls back to text when nothing came in.
  if (multiview) return { endpoint: '/openapi/v1/multi-image-to-3d', body: { ...body, image_urls: multiview.slice(0, MAX_IMAGES) } }
  if (input) return { endpoint: '/openapi/v1/image-to-3d', body: { ...body, image_url: input } }
  if (prompt) {
    const { should_texture: shouldTexture, enable_pbr: enablePbr, texture_resolution: textureResolution, ...preview } = body
    return {
      endpoint: '/openapi/v2/text-to-3d',
      body: { ...preview, mode: 'preview', prompt },
      refine: shouldTexture
        ? (previewTaskId) => ({
            endpoint: '/openapi/v2/text-to-3d',
            body: { mode: 'refine', preview_task_id: previewTaskId, enable_pbr: enablePbr, texture_resolution: textureResolution, target_formats: ['glb'] },
          })
        : null,
    }
  }
  throw new Error('Gen HD Model needs an upstream image or a text prompt.')
}

// A node whose config would produce no Meshy call at all.
export function usesMeshy(node) {
  return MESHY_NODE_TYPES.has(node.type)
}

/**
 * Converts a succeeded Meshy task into the output shape the canvas already
 * renders. `preview` keeps pointing at an image so the node thumbnail works;
 * `modelUrl` is what the model editor consumes.
 *
 * `modelUrl` is the signed GLB from this response. It expires with the task.
 * A later download uses `meshyTaskId` to ask Meshy for the file again.
 */
function taskModelUrl(task) {
  const urls = task?.model_urls || {}
  return urls.glb || urls.fbx || urls.obj || urls.usdz || urls.stl || urls.blend || urls['3mf']
    || urls.lamp_stl || urls.base_stl
    || task?.animation_glb_url || task?.animation_fbx_url
    || task?.rigged_character_glb_url || task?.rigged_character_fbx_url
    || task?.motion_url
    || null
}

export function meshyNodeOutput(node, task, { preview = null, modelUrl = null, fallbackPreview = null } = {}) {
  const images = Array.isArray(task?.image_urls) ? task.image_urls.filter((url) => typeof url === 'string' && url) : []
  const resolvedPreview = preview || task?.thumbnail_url || images[0] || fallbackPreview || null
  const resolvedModel = modelUrl || taskModelUrl(task)
  const taskId = task?.id || null
  const extension = resolvedModel?.split('?')[0].split('.').pop()?.toLowerCase()
  const format = ['glb', 'fbx', 'obj', 'usdz', 'stl', 'blend', '3mf', 'bvh'].includes(extension) ? extension : 'glb'
  const ports = {}
  if (images[0]) ports.image = images[0]
  if (images.length >= 2) {
    ports.front = images[0]
    ports.side = images[1]
    if (images[2]) ports.back = images[2]
  }
  const report = task?.printability || task?.print_repair_report || null
  return {
    message: report ? `${node.name || node.type} finished` : `${node.name || node.type} generated`,
    preview: resolvedPreview,
    modelUrl: resolvedModel,
    meshyTaskId: taskId,
    creditsConsumed: task?.consumed_credits ?? null,
    ...(Object.keys(ports).length ? { ports } : {}),
    ...(report ? { report } : {}),
    outputs: taskId && resolvedModel ? [{ format, filename: `model.${format === 'gltf' ? 'glb' : format}`, downloadUrl: resolvedModel }] : [],
  }
}
