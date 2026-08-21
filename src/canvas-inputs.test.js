import test from 'node:test'
import assert from 'node:assert/strict'
import { nodeOutputPortValues, resolveInputSources, resolveNodeInputs } from './canvas-nodes.js'

const node = (id, type, config = {}) => ({ id, type, name: id, config })
const edge = (source, sourcePort, target, targetPort) => ({
  id: `${source}-${target}-${targetPort}`,
  source: { nodeId: source, ...(sourcePort ? { port: sourcePort } : {}) },
  target: { nodeId: target, ...(targetPort ? { port: targetPort } : {}) },
})

test('resolves each named view to the matching input port', () => {
  const views = node('views', 'generate-multiview-images', {
    viewPreviews: { front: '/f.png', back: '/b.png', left: '/l.png', right: '/r.png' },
  })
  const model = node('model', 'multiview-to-3d')
  const canvas = {
    nodes: [views, model],
    edges: ['front', 'back', 'left', 'right'].map((view) => edge('views', view, 'model', view)),
  }

  assert.deepEqual(resolveNodeInputs(model, canvas), {
    front: '/f.png', back: '/b.png', left: '/l.png', right: '/r.png',
  })
})

test('a multiple port collects every compatible output of one collapsed edge', () => {
  // The canvas writes `output`/`input` for its single visual handle, so a
  // four-view upstream has to reach a multi-image port through one edge.
  const views = node('views', 'generate-multiview-images', {
    viewPreviews: { front: '/f.png', back: '/b.png', left: '/l.png', right: '/r.png' },
  })
  const model = node('model', 'generate-model')
  const canvas = { nodes: [views, model], edges: [edge('views', null, 'model', null)] }

  assert.deepEqual(resolveNodeInputs(model, canvas).image, ['/f.png', '/b.png', '/l.png', '/r.png'])
})

test('a single-value port takes one value from the same upstream', () => {
  const views = node('views', 'generate-multiview-images', {
    viewPreviews: { front: '/f.png', back: '/b.png' },
  })
  const review = node('review', 'review')
  const canvas = { nodes: [views, review], edges: [edge('views', null, 'review', null)] }

  assert.equal(resolveNodeInputs(review, canvas).image, '/f.png')
})

test('a text port falls back to its own config field when nothing is connected', () => {
  const model = node('model', 'text-to-3d', { prompt: 'a brass shark' })

  assert.deepEqual(resolveNodeInputs(model, { nodes: [model], edges: [] }), { text: 'a brass shark' })
  // An empty prompt is not an input: a required text port stays unsatisfied.
  const blank = node('blank', 'text-to-3d', { prompt: '   ' })
  assert.deepEqual(resolveNodeInputs(blank, { nodes: [blank], edges: [] }), {})
})

test('a connected value wins over the port config fallback', () => {
  const prompt = node('prompt', 'prompt', { prompt: 'from upstream' })
  const model = node('model', 'text-to-3d', { prompt: 'own field' })
  const canvas = { nodes: [prompt, model], edges: [edge('prompt', 'text', 'model', 'text')] }

  assert.equal(resolveNodeInputs(model, canvas).text, 'from upstream')
})

test('what this run produced wins over what the canvas saved', () => {
  const source = node('model', 'generate-model', { preview: '/stale.png' })
  const target = node('retopo', 'retopology')
  const canvas = { nodes: [source, target], edges: [edge('model', 'model', 'retopo', 'model')] }
  const produced = new Map([['model', { modelUrl: '/fresh.glb' }]])

  assert.equal(resolveNodeInputs(target, canvas, produced).model, '/fresh.glb')
})

test('an image and a mesh reaching one node land on their own ports', () => {
  // texture takes a mesh on `model` and a reference image on `image`; neither may
  // pick up the other.
  const reference = node('ref', 'reference-image', { preview: '/ref.png' })
  const model = node('model', 'generate-model', { modelUrl: '/mesh.glb' })
  const texture = node('tex', 'texture')
  const canvas = {
    nodes: [reference, model, texture],
    edges: [edge('ref', 'image', 'tex', 'image'), edge('model', 'model', 'tex', 'model')],
  }

  assert.deepEqual(resolveNodeInputs(texture, canvas), { model: '/mesh.glb', image: '/ref.png' })
})

test('an uploaded model uses the asset upload output as a model input', () => {
  const upload = node('upload', 'reference-image', { assetType: 'model', modelUrl: '/model.glb' })
  const retopo = node('retopo', 'retopology')
  const canvas = { nodes: [upload, retopo], edges: [edge('upload', 'image', 'retopo', 'model')] }

  assert.deepEqual(nodeOutputPortValues(upload), { image: '/model.glb' })
  assert.deepEqual(resolveNodeInputs(retopo, canvas), { model: '/model.glb' })
})

test('reports which upstream node and port feeds each input', () => {
  const model = node('model', 'generate-model', { modelUrl: '/mesh.glb' })
  const retopo = node('retopo', 'retopology')
  const canvas = { nodes: [model, retopo], edges: [edge('model', 'model', 'retopo', 'model')] }

  const sources = resolveInputSources(retopo, canvas)
  assert.equal(sources.model.length, 1)
  assert.equal(sources.model[0].node.id, 'model')
  assert.equal(sources.model[0].portId, 'model')
})

test('output values prefer the selected candidate over the first one', () => {
  const concepts = node('concepts', 'generate-image', {
    previews: ['/a.png', '/b.png'],
    selectedPreview: '/b.png',
  })

  assert.deepEqual(nodeOutputPortValues(concepts), { image: '/b.png' })
})

test('a terminal node exposes no output values', () => {
  assert.deepEqual(nodeOutputPortValues(node('exp', 'export-model', { preview: '/p.png' })), {})
})
