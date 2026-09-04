// Translates a generate-model node into one Meshy request, and a finished Meshy
// task back into the same output shape the mock producer emits. Pure functions:
// the caller resolves `input` (a public URL or a data URI — Meshy has no file
// upload endpoint) and performs the HTTP call.
//
// Only `generate-model` is backed by Meshy today. Every other node type returns
// null here and stays on the mock producer (or on Tripo when that provider runs).

export const meshyNodeTypes = new Set(['generate-model'])
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

function sharedBody(config) {
  // `latest` tracks Meshy's newest model, matching how the Tripo mapping pins
  // the node's own default version.
  const body: Record<string, unknown> = { ai_model: 'latest', target_formats: ['glb'] }
  body.should_texture = config.texture !== false
  // PBR maps only exist when texturing runs.
  if (body.should_texture) {
    body.enable_pbr = config.pbr !== false
    body.texture_resolution = TEXTURE_RESOLUTIONS[config.textureQuality] || '2k'
  }
  // Meshy only honors topology and a polycount inside a remesh pass.
  const faceCount = Number(config.faceCount)
  if (config.topology === 'quad' || (faceCount > 0 && faceCount <= MAX_TARGET_POLYCOUNT)) {
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
export function meshyRequest(node, { input = null, prompt = '', multiview = null } = {}) {
  if (!MESHY_NODE_TYPES.has(node.type)) return null
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
 * Meshy's URLs are signed and valid for days, so the download points at the GLB
 * directly rather than at a refreshing proxy like the Tripo one.
 */
export function meshyNodeOutput(node, task, { preview = null, modelUrl = null, fallbackPreview = null } = {}) {
  const resolvedPreview = preview || task?.thumbnail_url || fallbackPreview || null
  const resolvedModel = modelUrl || task?.model_urls?.glb || null
  const taskId = task?.id || null
  return {
    message: `${node.name || node.type} generated`,
    preview: resolvedPreview,
    modelUrl: resolvedModel,
    meshyTaskId: taskId,
    creditsConsumed: task?.consumed_credits ?? null,
    outputs: taskId && resolvedModel ? [{ format: 'glb', filename: 'model.glb', downloadUrl: resolvedModel }] : [],
  }
}
