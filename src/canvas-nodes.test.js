import test from 'node:test'
import assert from 'node:assert/strict'
import { canConnectNodeTypes, canConnectPorts, compatibleNodeTypes, nodeCatalog, nodeDefaults, nodeDisplayName, nodeInputPorts, nodeOutputPorts, nodeSchema, parameterRange } from './canvas-nodes.js'
import { normalizeNodeConfig, normalizeNodeOutput, splitNodeOutput, canvasNodeSchema } from './canvas-schema.js'

test('uses Lychee node names while preserving unmatched node names', () => {
  assert.equal(nodeDisplayName('reference-image', 'Reference Image'), 'Asset Upload')
  assert.equal(nodeDisplayName('prompt', 'Prompt'), 'Text Prompt')
  assert.equal(nodeDisplayName('generate-image', 'Generate Concept'), 'Gen Image')
  assert.equal(nodeDisplayName('generate-model', 'Generate 3D Model'), 'Gen HD Model')
  assert.equal(nodeDisplayName('text-to-3d', 'Generate 3D Model'), 'Text to 3D')
  assert.equal(nodeDisplayName('retopology', 'Low-poly Retopology'), 'Retopology')
  assert.equal(nodeDisplayName('texture', 'Generate PBR Texture'), 'UV Texture')
  assert.equal(nodeDisplayName('export-model', 'Export Model'), 'Export')
})

test('keeps Image Upload empty until an image is uploaded', () => {
  assert.equal(nodeDefaults('reference-image').preview, undefined)
  assert.equal(normalizeNodeOutput('reference-image', {}).preview, undefined)
  assert.equal(normalizeNodeOutput('reference-image', { preview: '/shark-reference.png' }).preview, undefined)
  assert.equal(normalizeNodeOutput('reference-image', { preview: '/api/assets/uploaded.png' }).preview, '/api/assets/uploaded.png')
})

test('does not define preview data as node defaults', () => {
  for (const node of canvasNodeSchema) {
    assert.equal(Object.hasOwn(node.defaults, 'preview'), false, `${node.type} has a default preview`)
    assert.equal(Object.hasOwn(node.defaults, 'previews'), false, `${node.type} has default previews`)
    assert.equal(Object.hasOwn(node.defaults, 'viewPreviews'), false, `${node.type} has default view previews`)
  }
})

test('removes legacy bundled previews while retaining uploaded assets', () => {
  assert.equal(normalizeNodeOutput('segments', { preview: '/shark-model.png' }).preview, undefined)
  assert.equal(normalizeNodeOutput('generate-image', { previews: ['/shark-concept-front.png'] }).previews, undefined)
  assert.deepEqual(normalizeNodeOutput('generate-multiview-images', { viewPreviews: { front: '/shark-concept-front.png' } }).viewPreviews, undefined)
  assert.equal(normalizeNodeOutput('reference-image', { preview: '/api/assets/uploaded.png' }).preview, '/api/assets/uploaded.png')
})

test('splits results out of an older config and keeps the separated copy authoritative', () => {
  // A canvas saved before the split keeps its results in config; they move across
  // while the parameters stay put.
  assert.deepEqual(splitNodeOutput({ amount: 4, previews: ['/a.png'], selectedPreview: '/a.png' }), {
    config: { amount: 4 },
    outputResult: { previews: ['/a.png'], selectedPreview: '/a.png' },
  })
  // Already split: a same-named leftover in config does not overwrite it.
  assert.deepEqual(splitNodeOutput({ preview: '/stale.png' }, { preview: '/fresh.png' }), {
    config: {},
    outputResult: { preview: '/fresh.png' },
  })
  // modelUrl stays a parameter: its only writer is the asset upload.
  assert.deepEqual(splitNodeOutput({ modelUrl: '/m.glb' }).config, { modelUrl: '/m.glb' })
})

test('exposes schema-defined typed input and output handles', () => {
  assert.deepEqual(nodeOutputPorts('reference-image'), [{ id: 'image', label: 'Asset', type: 'any' }])
  assert.deepEqual(nodeInputPorts('generate-model').map(({ id, type }) => ({ id, type })), [
    { id: 'image', type: 'image' },
    { id: 'front', type: 'image' }, { id: 'back', type: 'image' }, { id: 'left', type: 'image' }, { id: 'right', type: 'image' },
    { id: 'text', type: 'text' },
  ])
  assert.deepEqual(nodeInputPorts('multiview-to-3d').map(({ id, type }) => ({ id, type })), [
    { id: 'front', type: 'image' }, { id: 'back', type: 'image' }, { id: 'left', type: 'image' }, { id: 'right', type: 'image' },
  ])
  assert.deepEqual(nodeInputPorts('texture').map(({ id, type }) => ({ id, type })), [{ id: 'model', type: 'model' }, { id: 'image', type: 'image' }, { id: 'text', type: 'text' }])
  // Source-only nodes have no input; terminal nodes have no output.
  assert.deepEqual(nodeInputPorts('prompt'), [])
  assert.deepEqual(nodeOutputPorts('export-model'), [])
  // Output keeps the node's result type on the single handle.
  assert.deepEqual(nodeOutputPorts('generate-model'), [{ id: 'model', label: 'Model', type: 'model' }])
  assert.deepEqual(nodeOutputPorts('generate-multiview-images').map(({ id, type }) => ({ id, type })), [
    { id: 'front', type: 'image' }, { id: 'back', type: 'image' }, { id: 'left', type: 'image' }, { id: 'right', type: 'image' },
  ])
})

test('connects only compatible port types', () => {
  assert.equal(canConnectNodeTypes('prompt', 'generate-image'), true)
  assert.equal(canConnectNodeTypes('reference-image', 'generate-image'), true)
  assert.equal(canConnectNodeTypes('reference-image', 'retopology'), true)
  assert.equal(canConnectNodeTypes('generate-image', 'generate-model'), true)
  assert.equal(canConnectNodeTypes('generate-multiview-images', 'multiview-to-3d'), true)
  assert.equal(canConnectNodeTypes('generate-model', 'texture'), true)
  // No output → cannot be a source; no input → cannot be a target.
  assert.equal(canConnectNodeTypes('export-model', 'texture'), false)
  assert.equal(canConnectNodeTypes('generate-model', 'prompt'), false)
  assert.equal(canConnectNodeTypes('unknown', 'generate-image'), false)
})

test('connects matching named ports only', () => {
  assert.equal(canConnectPorts('reference-image', 'image', 'multiview-to-3d', 'front'), true)
  assert.equal(canConnectPorts('reference-image', 'image', 'retopology', 'model'), true)
  assert.equal(canConnectPorts('generate-multiview-images', 'front', 'multiview-to-3d', 'front'), true)
  assert.equal(canConnectPorts('generate-model', 'model', 'texture', 'model'), true)
  assert.equal(canConnectPorts('generate-multiview-images', 'front', 'multiview-to-3d', 'back'), true)
  assert.equal(canConnectPorts('generate-image', 'image', 'texture', 'model'), false)
})

test('returns nodes accepted by a dragged output', () => {
  const fromPrompt = compatibleNodeTypes('prompt').map((node) => node.type)
  assert.ok(fromPrompt.includes('generate-image'))
  assert.ok(fromPrompt.includes('generate-model'))
  assert.ok(fromPrompt.includes('texture'))
  assert.ok(!fromPrompt.includes('frame'))
  // A terminal node (no output) offers nothing downstream.
  assert.deepEqual(compatibleNodeTypes('export-model'), [])
  assert.ok(!nodeCatalog.some((node) => ['save-asset'].includes(node.type)))
})

test('hides Image from node menus and groups Export under Output', () => {
  const section = nodeCatalog.find((node) => node.type === 'frame')
  const image = nodeCatalog.find((node) => node.type === 'generated-image')
  const exportNode = nodeCatalog.find((node) => node.type === 'export-model')

  assert.equal(section.label, 'Section')
  assert.equal(image.hidden, true)
  assert.equal(exportNode.category, 'Output')
  assert.ok(!compatibleNodeTypes('generate-image').some((node) => node.type === 'generated-image'))
  assert.equal(nodeCatalog.find((node) => node.type === 'multiview-to-3d').hidden, true)
})

test('registers the image decomposition demo as an image node', () => {
  const decomposition = nodeCatalog.find((node) => node.type === 'image-decomposition')

  assert.equal(decomposition.category, '2D')
  assert.deepEqual(nodeInputPorts(decomposition.type), [{ id: 'image', label: 'Image', type: 'image', required: true }])
  assert.deepEqual(nodeOutputPorts(decomposition.type), [{ id: 'image', label: 'Image', type: 'image' }])
  assert.ok(compatibleNodeTypes('reference-image').some((node) => node.type === decomposition.type))
})

test('matches the Tripo Studio parameters without changing node types', () => {
  const prompt = nodeSchema('prompt')
  const generateImage = nodeSchema('generate-image')
  const generateModel = nodeSchema('generate-model')
  const smartMesh = nodeSchema('smart-mesh')
  const segmentation = nodeSchema('segments')
  const retopology = nodeSchema('retopology')
  const texture = nodeSchema('texture')

  assert.equal(generateModel.type, 'generate-model')
  assert.equal(smartMesh.type, 'smart-mesh')
  assert.equal(segmentation.type, 'segments')
  assert.equal(segmentation.label, 'Segments')
  assert.equal(Object.hasOwn(prompt.defaults, 'tPose'), false)
  assert.equal(prompt.parameters.some(({ key }) => key === 'tPose'), false)
  assert.equal(generateImage.defaults.tPose, false)
  assert.equal(generateImage.parameters.find(({ key }) => key === 'tPose').control, 'toggle')
  assert.equal(generateModel.defaults.generateParts, false)
  assert.equal(generateModel.defaults.geometryQuality, true)
  assert.equal(generateModel.defaults.aiComplete, false)
  assert.equal(generateModel.defaults.textureQuality, 'extreme')
  assert.equal(generateModel.defaults.texture8k, true)
  assert.equal(generateModel.defaults.privacy, 'sharing-only')
  assert.equal(generateModel.parameters.find(({ key }) => key === 'geometryQuality').control, 'toggle')
  assert.equal(generateModel.parameters.find(({ key }) => key === 'aiComplete').control, 'toggle')
  assert.deepEqual(generateModel.parameters.find(({ key }) => key === 'textureQuality').options.map(({ label }) => label), ['2K', '4K', '8K'])
  assert.equal(generateModel.parameters.find(({ key }) => key === 'texture8k').control, 'toggle')
  assert.deepEqual(parameterRange(generateModel.parameters.find(({ key }) => key === 'faceCount'), generateModel.defaults), { min: 500, max: 2000000, step: 500 })

  assert.equal(segmentation.defaults.detailLevel, 'low')
  assert.deepEqual(segmentation.parameters[0].options.map(({ label }) => label), [
    'Simple · 3-6 parts',
    'Balanced · 6-15 parts',
    'Detailed · 15+ parts',
  ])

  assert.deepEqual(retopology.parameters[0].options.map(({ value }) => value), ['quad', 'triangle'])
  assert.equal(retopology.parameters[1].label, 'Smart Low Poly v2')
  assert.deepEqual(parameterRange(retopology.parameters[2], retopology.defaults), { min: 500, max: 50000, step: 500 })
  assert.equal(retopology.defaults.faceLimit, 10000)

  assert.equal(texture.defaults.textureQuality, 'extreme')
  assert.equal(texture.parameters.find(({ key }) => key === 'textureQuality').control, 'segmented')
  assert.deepEqual(texture.parameters.find(({ key }) => key === 'textureQuality').options.map(({ label }) => label), ['2K', '4K', '8K'])
})

test('gives every select a valid default and normalizes legacy values', () => {
  for (const schema of canvasNodeSchema) {
    for (const parameter of schema.parameters.filter(({ control }) => control === 'select')) {
      assert.ok(parameter.options.some(({ value }) => value === schema.defaults[parameter.key]), `${schema.type}.${parameter.key} has a selected default`)
    }
  }

  assert.equal(normalizeNodeConfig('generate-model', { modelVersion: 'Smart Mesh' }).modelVersion, 'v3.1-20260211')
  assert.equal(normalizeNodeConfig('generate-model', { geometryQuality: 'detailed' }).geometryQuality, true)
  assert.equal(normalizeNodeConfig('export-model', { modelFormat: 'GLB' }).modelFormat, 'gltf')
})
