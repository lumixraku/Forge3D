import test from 'node:test'
import assert from 'node:assert/strict'
import { canConnectNodeTypes, canConnectPorts, compatibleNodeTypes, nodeCatalog, nodeDisplayName, nodeInputPorts, nodeOutputPorts, nodeSchema, parameterRange } from './workflow-nodes.js'

test('uses Lychee node names while preserving unmatched node names', () => {
  assert.equal(nodeDisplayName('reference-image', 'Reference Image'), 'Image Upload')
  assert.equal(nodeDisplayName('prompt', 'Prompt'), 'Text Prompt')
  assert.equal(nodeDisplayName('generate-image', 'Generate Concept'), 'Gen Image')
  assert.equal(nodeDisplayName('generate-model', 'Generate 3D Model'), 'Gen HD Model')
  assert.equal(nodeDisplayName('text-to-3d', 'Generate 3D Model'), 'Text to 3D')
  assert.equal(nodeDisplayName('retopology', 'Low-poly Retopology'), 'Retopology')
  assert.equal(nodeDisplayName('texture', 'Generate PBR Texture'), 'UV Texture')
  assert.equal(nodeDisplayName('export-model', 'Export Model'), 'Export')
})

test('every node exposes at most one universal input and one output handle', () => {
  // Multi-input nodes collapse to a single untyped input handle.
  assert.deepEqual(nodeInputPorts('generate-model'), [{ id: 'input', label: 'Input', type: 'any' }])
  assert.deepEqual(nodeInputPorts('multiview-to-3d'), [{ id: 'input', label: 'Input', type: 'any' }])
  assert.deepEqual(nodeInputPorts('texture'), [{ id: 'input', label: 'Input', type: 'any' }])
  // Source-only nodes have no input; terminal nodes have no output.
  assert.deepEqual(nodeInputPorts('prompt'), [])
  assert.deepEqual(nodeOutputPorts('export-model'), [])
  // Output keeps the node's result type on the single handle.
  assert.deepEqual(nodeOutputPorts('generate-model'), [{ id: 'output', label: 'Output', type: 'model' }])
  assert.deepEqual(nodeOutputPorts('generate-multiview-images'), [{ id: 'output', label: 'Output', type: 'image' }])
})

test('the universal input accepts any producing node', () => {
  assert.equal(canConnectNodeTypes('prompt', 'generate-image'), true)
  assert.equal(canConnectNodeTypes('reference-image', 'generate-image'), true)
  assert.equal(canConnectNodeTypes('generate-image', 'generate-model'), true)
  assert.equal(canConnectNodeTypes('generate-multiview-images', 'multiview-to-3d'), true)
  assert.equal(canConnectNodeTypes('generate-model', 'texture'), true)
  // No output → cannot be a source; no input → cannot be a target.
  assert.equal(canConnectNodeTypes('export-model', 'texture'), false)
  assert.equal(canConnectNodeTypes('generate-model', 'prompt'), false)
  assert.equal(canConnectNodeTypes('unknown', 'generate-image'), false)
})

test('connects only the single output handle to the single input handle', () => {
  assert.equal(canConnectPorts('reference-image', 'output', 'multiview-to-3d', 'input'), true)
  assert.equal(canConnectPorts('generate-multiview-images', 'output', 'multiview-to-3d', 'input'), true)
  assert.equal(canConnectPorts('generate-model', 'output', 'texture', 'input'), true)
  // Legacy typed / view port ids no longer resolve to a real handle.
  assert.equal(canConnectPorts('generate-multiview-images', 'front', 'multiview-to-3d', 'front'), false)
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
  assert.deepEqual(nodeInputPorts(decomposition.type), [{ id: 'input', label: 'Input', type: 'any' }])
  assert.deepEqual(nodeOutputPorts(decomposition.type), [{ id: 'output', label: 'Output', type: 'image' }])
  assert.ok(compatibleNodeTypes('reference-image').some((node) => node.type === decomposition.type))
})

test('matches the Tripo Studio parameters without changing node types', () => {
  const generateModel = nodeSchema('generate-model')
  const smartMesh = nodeSchema('smart-mesh')
  const segmentation = nodeSchema('segments')
  const retopology = nodeSchema('retopology')
  const texture = nodeSchema('texture')

  assert.equal(generateModel.type, 'generate-model')
  assert.equal(smartMesh.type, 'smart-mesh')
  assert.equal(segmentation.type, 'segments')
  assert.equal(segmentation.label, 'Segments')
  assert.equal(generateModel.defaults.generateParts, false)
  assert.equal(generateModel.defaults.texture8k, true)
  assert.equal(generateModel.defaults.privacy, 'sharing-only')
  assert.equal(generateModel.parameters.find(({ key }) => key === 'texture8k').control, 'toggle')

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
