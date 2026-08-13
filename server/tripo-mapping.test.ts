import test from 'node:test'
import assert from 'node:assert/strict'
import { tripoNodeOutput, tripoRequest, usesTripo } from './tripo-mapping.js'
import { nodeDefaults } from '../src/canvas-schema.js'

// Nodes are built from the real schema defaults so a default change that breaks
// the mapping fails here rather than at runtime against a billed API.
function node(type, config = {}) {
  return { id: type, type, name: type, config: { ...nodeDefaults(type), ...config } }
}

test('nodes without a Tripo endpoint fall through to the mock producer', () => {
  for (const type of ['review', 'model-preview', 'prompt', 'reference-image', 'frame', 'generate-image']) {
    assert.equal(tripoRequest(node(type), { input: 'task_abc' }), null, type)
    assert.equal(usesTripo(node(type)), false, type)
  }
})

test('generate-model reconstructs from an image when one is upstream', () => {
  const { endpoint, body } = tripoRequest(node('generate-model'), { input: 'file_abc', prompt: 'ignored' })
  assert.equal(endpoint, '/generation/image-to-model')
  assert.equal(body.input, 'file_abc')
  assert.equal(body.model, 'v3.1-20260211')
  assert.equal(body.prompt, undefined)
})

test('generate-model falls back to text when nothing is upstream', () => {
  const { endpoint, body } = tripoRequest(node('generate-model'), { prompt: 'a stylized shark' })
  assert.equal(endpoint, '/generation/text-to-model')
  assert.equal(body.prompt, 'a stylized shark')
  assert.equal(body.input, undefined)
})

test('generate-model needs either an image or a prompt', () => {
  assert.throws(() => tripoRequest(node('generate-model'), {}), /needs an upstream image or a text prompt/)
})

test('generate-model maps the schema defaults onto Tripo field names', () => {
  const { body } = tripoRequest(node('generate-model'), { input: 'file_abc' })
  // Schema defaults: geometryQuality true, texture true, pbr true,
  // textureQuality extreme, topology triangle, faceCount 2,000,000.
  assert.equal(body.geometry_quality, 'detailed')
  assert.equal(body.texture, true)
  assert.equal(body.pbr, true)
  assert.equal(body.texture_quality, 'extreme')
  assert.equal(body.quad, false)
  assert.equal(body.face_limit, 2000000)
})

test('generate-model sends quad topology and a lowered face limit', () => {
  const { body } = tripoRequest(node('generate-model', { topology: 'quad', faceCount: 50000 }), { input: 'file_abc' })
  assert.equal(body.quad, true)
  assert.equal(body.face_limit, 50000)
})

test('generate-model omits v3-only options on v2.5', () => {
  const { body } = tripoRequest(node('generate-model', { modelVersion: 'v2.5-20250123' }), { input: 'file_abc' })
  assert.equal(body.model, 'v2.5-20250123')
  assert.equal(body.geometry_quality, undefined)
  assert.equal(body.texture_quality, undefined)
  assert.equal(body.quad, undefined)
  // Texture and PBR are not version gated.
  assert.equal(body.texture, true)
  assert.equal(body.pbr, true)
})

test('generate-model drops texture and pbr when generating parts', () => {
  // Tripo rejects generate_parts unless texture, pbr, and quad are all false.
  const { body } = tripoRequest(node('generate-model', { generateParts: true }), { input: 'file_abc' })
  assert.equal(body.generate_parts, true)
  assert.equal(body.texture, false)
  assert.equal(body.pbr, false)
  assert.equal(body.texture_quality, undefined)
  assert.equal(body.quad, undefined)
})

test('generate-model turns pbr off when texture is off', () => {
  const { body } = tripoRequest(node('generate-model', { texture: false }), { input: 'file_abc' })
  assert.equal(body.texture, false)
  assert.equal(body.pbr, false)
  assert.equal(body.texture_quality, undefined)
})

test('mesh transforms require an upstream model', () => {
  for (const type of ['retopology', 'texture', 'segments', 'rigging', 'export-model']) {
    assert.throws(() => tripoRequest(node(type), { prompt: 'text is not enough' }), /needs an upstream 3D model/, type)
  }
})

test('retopology selects the smart tier from the Smart Low Poly toggle', () => {
  const smart = tripoRequest(node('retopology', { smartPoly: true, faceLimit: 5000 }), { input: 'task_abc' })
  assert.equal(smart.endpoint, '/mesh/decimate')
  assert.equal(smart.body.model, 'v2.0')
  assert.equal(smart.body.face_limit, 5000)
  // Schema default topology is quad.
  assert.equal(smart.body.quad, true)

  const basic = tripoRequest(node('retopology', { topology: 'triangle' }), { input: 'task_abc' })
  assert.equal(basic.body.model, 'v1.0')
  assert.equal(basic.body.quad, false)
})

test('basic decimation needs an explicit face limit', () => {
  assert.throws(
    () => tripoRequest(node('retopology', { smartPoly: false, faceLimit: 0 }), { input: 'task_abc' }),
    /needs a polygon count/,
  )
})

test('texture passes the quality through and guides with text or an image', () => {
  const textGuided = tripoRequest(node('texture', { inputMode: 'textGenerate' }), { input: 'task_abc', prompt: 'worn leather' })
  assert.equal(textGuided.endpoint, '/models/texture')
  assert.equal(textGuided.body.model, 'v3.0-20250812')
  assert.equal(textGuided.body.texture_quality, 'extreme')
  assert.deepEqual(textGuided.body.texture_prompt, { text: 'worn leather' })

  const imageGuided = tripoRequest(node('texture'), { input: 'task_abc', imageInput: 'file_img' })
  assert.deepEqual(imageGuided.body.texture_prompt, { image: 'file_img' })

  // No guidance available is valid when the mesh came from Tripo.
  const bare = tripoRequest(node('texture'), { input: 'task_abc' })
  assert.equal(bare.body.texture_prompt, undefined)
})

test('segments maps the detail level onto segmentation granularity', () => {
  const cases = { low: 'simple', medium: 'balanced', high: 'detailed' }
  for (const [detailLevel, granularity] of Object.entries(cases)) {
    const { endpoint, body } = tripoRequest(node('segments', { detailLevel }), { input: 'task_abc' })
    assert.equal(endpoint, '/mesh/segment')
    assert.equal(body.model, 'v2.0-20260430')
    assert.equal(body.segmentation_granularity, granularity, detailLevel)
  }
})

test('rigging forwards the node model version unchanged', () => {
  const { endpoint, body } = tripoRequest(node('rigging'), { input: 'task_abc' })
  assert.equal(endpoint, '/animations/rig')
  // The schema's two options are already Tripo's own version strings.
  assert.equal(body.model, 'v2.5-20260210')
})

test('export-model maps the node format onto a convert target', () => {
  const cases = { gltf: 'GLTF', fbx: 'FBX', usdz: 'USDZ', obj: 'OBJ', stl: 'STL', '3mf': '3MF' }
  for (const [modelFormat, format] of Object.entries(cases)) {
    const { endpoint, body } = tripoRequest(node('export-model', { modelFormat }), { input: 'task_abc' })
    assert.equal(endpoint, '/models/convert')
    assert.equal(body.format, format, modelFormat)
  }
})

test('export-model sends only the flags its format supports', () => {
  const fbx = tripoRequest(node('export-model', { modelFormat: 'fbx', fbxPreset: 'mixamo', withAnimation: true, animateInPlace: true }), { input: 'task_abc' })
  assert.equal(fbx.body.fbx_preset, 'mixamo')
  assert.equal(fbx.body.with_animation, true)
  assert.equal(fbx.body.animate_in_place, true)
  // export_vertex_colors is only valid for OBJ and GLTF.
  assert.equal(fbx.body.export_vertex_colors, undefined)

  const obj = tripoRequest(node('export-model', { modelFormat: 'obj', exportVertexColors: true }), { input: 'task_abc' })
  assert.equal(obj.body.export_vertex_colors, true)
  assert.equal(obj.body.fbx_preset, undefined)

  const glb = tripoRequest(node('export-model'), { input: 'task_abc' })
  assert.equal(glb.body.texture_size, 2048)
  assert.equal(glb.body.pack_uv, false)
  assert.equal(glb.body.with_animation, false)
  // animate_in_place is meaningless without animation.
  assert.equal(glb.body.animate_in_place, undefined)
})

test('a succeeded task becomes the output shape the canvas renders', () => {
  const task = {
    task_id: 'task_abc',
    status: 'success',
    output: { model_url: 'https://cdn.tripo3d.ai/m.glb', rendered_image_url: 'https://cdn.tripo3d.ai/p.png' },
    credits_consumed: 30,
  }
  const output = tripoNodeOutput(node('generate-model'), task)
  assert.equal(output.preview, 'https://cdn.tripo3d.ai/p.png')
  assert.equal(output.modelUrl, 'https://cdn.tripo3d.ai/m.glb')
  assert.equal(output.tripoTaskId, 'task_abc')
  assert.equal(output.creditsConsumed, 30)
  assert.match(output.message, /generated/)
})

test('persisted asset paths override the expiring Tripo urls', () => {
  const task = { task_id: 'task_abc', output: { model_url: 'https://cdn.tripo3d.ai/m.glb', rendered_image_url: 'https://cdn.tripo3d.ai/p.png' } }
  const output = tripoNodeOutput(node('generate-model'), task, { preview: '/api/assets/aa.png', modelUrl: '/api/assets/bb.glb' })
  assert.equal(output.preview, '/api/assets/aa.png')
  assert.equal(output.modelUrl, '/api/assets/bb.glb')
})

test('export output carries a download the canvas can click', () => {
  const task = { task_id: 'task_abc', output: { model_url: 'https://cdn.tripo3d.ai/m.fbx' } }
  const output = tripoNodeOutput(node('export-model', { modelFormat: 'fbx', fileName: 'shark' }), task, { modelUrl: '/api/assets/bb.fbx' })
  assert.deepEqual(output.outputs, [{ destination: 'dcc', format: 'fbx', filename: 'shark.fbx', downloadUrl: '/api/tripo/tasks/task_abc/download' }])
  assert.equal(output.target, '3D Model')
})

test('glb export keeps the gltf format but a .glb filename', () => {
  const task = { task_id: 'task_abc', output: { model_url: 'https://cdn.tripo3d.ai/m.glb' } }
  const output = tripoNodeOutput(node('export-model', { fileName: 'shark' }), task, { modelUrl: '/api/assets/bb.glb' })
  assert.deepEqual(output.outputs.map((entry) => entry.filename), ['shark.glb'])
})

test('a task that renders no image falls back to the upstream thumbnail', () => {
  // A convert task returns only a model_url, so without the fallback the export
  // node renders a broken thumbnail.
  const task = { task_id: 'task_abc', output: { model_url: 'https://cdn.tripo3d.ai/m.glb' } }
  const output = tripoNodeOutput(node('export-model', { fileName: 'shark' }), task, {
    modelUrl: '/api/assets/bb.glb',
    fallbackPreview: '/api/assets/aa.webp',
  })
  assert.equal(output.preview, '/api/assets/aa.webp')
})

test('a task with its own render ignores the fallback', () => {
  const task = { task_id: 'task_abc', output: { model_url: 'https://cdn/m.glb', rendered_image_url: 'https://cdn/r.webp' } }
  const output = tripoNodeOutput(node('texture'), task, { preview: '/api/assets/own.webp', fallbackPreview: '/api/assets/up.webp' })
  assert.equal(output.preview, '/api/assets/own.webp')
})
