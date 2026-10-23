import test from 'node:test'
import assert from 'node:assert/strict'
import { canConnectNodeTypes, canConnectPorts, compatibleNodeTypes, compatibleUpstreamNodeTypes, nodeCatalog, nodeDefaults, nodeDisplayName, nodeInputPorts, nodeOutputPorts } from './canvas-nodes.js'
import { normalizeNodeConfig, normalizeGeneratedAssets, splitNodeTrees, canvasNodeSchema } from './canvas-schema.js'

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
  assert.equal(normalizeGeneratedAssets('reference-image', {}).preview, undefined)
  assert.equal(normalizeGeneratedAssets('reference-image', { preview: '/shark-reference.png' }).preview, undefined)
  assert.equal(normalizeGeneratedAssets('reference-image', { preview: '/api/assets/uploaded.png' }).preview, '/api/assets/uploaded.png')
})

test('does not define preview data as node defaults', () => {
  for (const node of canvasNodeSchema) {
    assert.equal(Object.hasOwn(node.defaults, 'preview'), false, `${node.type} has a default preview`)
    assert.equal(Object.hasOwn(node.defaults, 'previews'), false, `${node.type} has default previews`)
    assert.equal(Object.hasOwn(node.defaults, 'viewPreviews'), false, `${node.type} has default view previews`)
  }
})

test('removes legacy bundled previews while retaining uploaded assets', () => {
  assert.equal(normalizeGeneratedAssets('segments', { preview: '/shark-model.png' }).preview, undefined)
  assert.equal(normalizeGeneratedAssets('generate-image', { previews: ['/shark-concept-front.png'] }).previews, undefined)
  assert.deepEqual(normalizeGeneratedAssets('generate-multiview-images', { viewPreviews: { front: '/shark-concept-front.png' } }).viewPreviews, undefined)
  assert.equal(normalizeGeneratedAssets('reference-image', { preview: '/api/assets/uploaded.png' }).preview, '/api/assets/uploaded.png')
})

test('splits uploads and results out of an older config and keeps the separated copies authoritative', () => {
  // A canvas saved before the split keeps its uploads and results in config; both
  // move across while the parameters stay put.
  assert.deepEqual(splitNodeTrees({ amount: 4, previews: ['/a.png'], selectedPreview: '/a.png' }), {
    config: { amount: 4 },
    uploadAssets: {},
    generatedAssets: { previews: ['/a.png'], selectedPreview: '/a.png' },
  })
  assert.deepEqual(splitNodeTrees({ amount: 4, reference: 'shark.glb', assetType: 'model', assetUrl: '/a.glb', modelUrl: '/a.glb' }), {
    config: { amount: 4 },
    uploadAssets: { reference: 'shark.glb', assetType: 'model', assetUrl: '/a.glb', modelUrl: '/a.glb' },
    generatedAssets: {},
  })
  // Already split: a same-named leftover in config does not overwrite either tree.
  assert.deepEqual(splitNodeTrees({ preview: '/stale.png', assetUrl: '/stale.png' }, { assetUrl: '/kept.png' }, { preview: '/fresh.png' }), {
    config: {},
    uploadAssets: { assetUrl: '/kept.png' },
    generatedAssets: { preview: '/fresh.png' },
  })
})

test('reads the result tree stored under its old name', () => {
  // `outputResult` shipped as the result tree's name before it became
  // `generatedAssets`, so canvases were saved with it. Dropping it would strip a
  // saved canvas of its results.
  assert.deepEqual(splitNodeTrees({}, {}, {}, { previews: ['/a.png'], selectedPreview: '/a.png' }).generatedAssets, {
    previews: ['/a.png'], selectedPreview: '/a.png',
  })
  // The current name wins where both carry the same key.
  assert.deepEqual(splitNodeTrees({}, {}, { preview: '/new.png' }, { preview: '/old.png', approved: true }).generatedAssets, {
    preview: '/new.png', approved: true,
  })
})

test('exposes schema-defined typed input and output handles', () => {
  // An upload can carry an image or a model, so it has one output of each kind.
  assert.deepEqual(nodeOutputPorts('reference-image').map(({ id, type }) => ({ id, type })), [{ id: 'image', type: 'image' }, { id: 'model', type: 'model' }])
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
  // A model input does not take an image: the port types have to match.
  assert.equal(canConnectPorts('reference-image', 'image', 'retopology', 'model'), false)
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

test('returns nodes that can feed a target as upstream steps', () => {
  const intoRetopology = compatibleUpstreamNodeTypes('retopology').map((node) => node.type)
  assert.ok(intoRetopology.includes('reference-image'))
  assert.ok(intoRetopology.includes('generate-model'))
  assert.ok(!intoRetopology.includes('export-model'))
  assert.deepEqual(compatibleUpstreamNodeTypes('reference-image'), [])
})

test('hides Image from node menus and groups Export under Output', () => {
  const section = nodeCatalog.find((node) => node.type === 'frame')
  const image = nodeCatalog.find((node) => node.type === 'generated-image')
  const exportNode = nodeCatalog.find((node) => node.type === 'export-model')

  assert.equal(section.label, 'Section')
  assert.equal(image.hidden, true)
  assert.equal(exportNode.category, 'Output')
  assert.ok(!compatibleNodeTypes('generate-image').some((node) => node.type === 'generated-image'))
  // Result nodes are created by runs, never offered in Add node.
  assert.equal(nodeCatalog.find((node) => node.type === 'generated-model').hidden, true)
})

test('registers the image decomposition demo as an image node', () => {
  const decomposition = nodeCatalog.find((node) => node.type === 'image-decomposition')

  assert.equal(decomposition.category, '2D')
  assert.deepEqual(nodeInputPorts(decomposition.type), [{ id: 'image', label: 'Image', type: 'image' }])
  assert.deepEqual(nodeOutputPorts(decomposition.type), [{ id: 'image', label: 'Image', type: 'image' }])
  // The port declares data flow; running the node is what needs the image.
  assert.deepEqual(decomposition.requires, ['image'])
  assert.ok(compatibleNodeTypes('reference-image').some((node) => node.type === decomposition.type))
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
