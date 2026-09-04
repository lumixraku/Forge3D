import test from 'node:test'
import assert from 'node:assert/strict'
import { meshyNodeOutput, meshyRequest, usesMeshy } from './meshy-mapping.js'
import { nodeDefaults } from '../src/canvas-schema.js'

// Nodes are built from the real schema defaults so a default change that breaks
// the mapping fails here rather than at runtime against a billed API.
function node(type, config = {}) {
  return { id: type, type, name: type, config: { ...nodeDefaults(type), ...config } }
}

test('nodes without a Meshy endpoint fall through to the mock producer', () => {
  for (const type of ['review', 'model-preview', 'prompt', 'reference-image', 'frame', 'generate-image', 'retopology', 'texture', 'segments', 'rigging', 'export-model']) {
    assert.equal(meshyRequest(node(type), { input: 'https://cdn/in.png' }), null, type)
    assert.equal(usesMeshy(node(type)), false, type)
  }
})

test('generate-model reconstructs from an image when one is upstream', () => {
  const { endpoint, body } = meshyRequest(node('generate-model'), { input: 'https://cdn/in.png', prompt: 'ignored' })
  assert.equal(endpoint, '/openapi/v1/image-to-3d')
  assert.equal(body.image_url, 'https://cdn/in.png')
  assert.equal(body.prompt, undefined)
})

test('generate-model falls back to text when nothing is upstream', () => {
  const { endpoint, body, refine } = meshyRequest(node('generate-model'), { prompt: 'a stylized shark' })
  assert.equal(endpoint, '/openapi/v2/text-to-3d')
  assert.equal(body.mode, 'preview')
  assert.equal(body.prompt, 'a stylized shark')
  assert.equal(body.image_url, undefined)
  // Texture is on by default, so a refine step follows the preview.
  assert.equal(typeof refine, 'function')
})

test('the text path textures through a refine task addressed to the preview', () => {
  const { refine } = meshyRequest(node('generate-model'), { prompt: 'a stylized shark' })
  const followup = refine('task_preview')
  assert.equal(followup.endpoint, '/openapi/v2/text-to-3d')
  assert.equal(followup.body.mode, 'refine')
  assert.equal(followup.body.preview_task_id, 'task_preview')
  // Schema defaults: pbr true, textureQuality extreme.
  assert.equal(followup.body.enable_pbr, true)
  assert.equal(followup.body.texture_resolution, '8k')
  assert.deepEqual(followup.body.target_formats, ['glb'])
})

test('generate-model needs either an image or a prompt', () => {
  assert.throws(() => meshyRequest(node('generate-model'), {}), /needs an upstream image or a text prompt/)
})

test('generate-model maps the schema defaults onto Meshy field names', () => {
  const { body } = meshyRequest(node('generate-model'), { input: 'https://cdn/in.png' })
  assert.equal(body.ai_model, 'latest')
  assert.equal(body.should_texture, true)
  assert.equal(body.enable_pbr, true)
  assert.equal(body.texture_resolution, '8k')
  // Only GLB is consumed downstream, so the other formats are not paid for.
  assert.deepEqual(body.target_formats, ['glb'])
  // The 2,000,000-face default means "no limit", which Meshy honors by not
  // remeshing at all — its documented recommendation for the best quality.
  assert.equal(body.should_remesh, undefined)
})

test('generate-model turns quad topology into a quad remesh', () => {
  const { body } = meshyRequest(node('generate-model', { topology: 'quad' }), { input: 'https://cdn/in.png' })
  assert.equal(body.should_remesh, true)
  assert.equal(body.topology, 'quad')
})

test('generate-model sends a polycount inside the Meshy range as a remesh target', () => {
  const { body } = meshyRequest(node('generate-model', { faceCount: 50000 }), { input: 'https://cdn/in.png' })
  assert.equal(body.should_remesh, true)
  assert.equal(body.target_polycount, 50000)
})

test('generate-model drops pbr and the refine step when texture is off', () => {
  const image = meshyRequest(node('generate-model', { texture: false }), { input: 'https://cdn/in.png' })
  assert.equal(image.body.should_texture, false)
  assert.equal(image.body.enable_pbr, undefined)

  const text = meshyRequest(node('generate-model', { texture: false }), { prompt: 'a shark' })
  assert.equal(text.refine, null)
  assert.equal(text.body.should_texture, undefined)
})

test('multiple images go to the multi-image endpoint, capped at four', () => {
  const images = ['https://cdn/front.png', 'https://cdn/back.png', 'https://cdn/left.png', 'https://cdn/right.png', 'https://cdn/extra.png']
  const { endpoint, body } = meshyRequest(node('generate-model'), { multiview: images })
  assert.equal(endpoint, '/openapi/v1/multi-image-to-3d')
  assert.deepEqual(body.image_urls, images.slice(0, 4))
})

test('a finished task becomes the canvas output shape', () => {
  const task = {
    id: 'task_abc',
    status: 'SUCCEEDED',
    consumed_credits: 30,
    thumbnail_url: 'https://cdn/preview.png',
    model_urls: { glb: 'https://cdn/model.glb' },
  }
  const output = meshyNodeOutput(node('generate-model'), task)
  assert.equal(output.preview, 'https://cdn/preview.png')
  assert.equal(output.modelUrl, 'https://cdn/model.glb')
  assert.equal(output.meshyTaskId, 'task_abc')
  assert.equal(output.creditsConsumed, 30)
  // Meshy URLs are signed and long-lived, so the download points at the GLB
  // directly instead of a refreshing proxy.
  assert.deepEqual(output.outputs, [{ format: 'glb', filename: 'model.glb', downloadUrl: 'https://cdn/model.glb' }])
})

test('an output without a thumbnail falls back to the upstream preview', () => {
  const output = meshyNodeOutput(node('generate-model'), { id: 'task_abc', status: 'SUCCEEDED', model_urls: { glb: 'https://cdn/model.glb' } }, { fallbackPreview: '/upstream.png' })
  assert.equal(output.preview, '/upstream.png')
})
