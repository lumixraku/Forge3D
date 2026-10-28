import test from 'node:test'
import assert from 'node:assert/strict'
import { addCanvasStage, buildCanvasStructure, planCanvas, rebuildDagEdges, removeCanvasNodes } from './planner.js'

test('creates a named frame for a Blahaj reconstruction request', () => {
  const { canvas } = planCanvas('复刻 Blahaj 的3D模型')
  const frame = canvas.nodes.find((node) => node.type === 'frame')

  assert.equal(frame.name, 'Blahaj 3D Reconstruction')
  assert.ok(canvas.nodes.filter((node) => node.type !== 'frame').every((node) => node.ui.parentFrameId === frame.id))
})

test('recognizes Chinese Text to 3D requests', () => {
  const { canvas } = planCanvas('根据描述生成3D工作流')
  assert.ok(canvas.nodes.some((node) => node.type === 'text-to-3d'))
  assert.ok(!canvas.nodes.some((node) => node.type === 'generate-model'))
})

test('appends an image-first canvas in a new frame without replacing the canvas', () => {
  const existing = planCanvas('Create a text-to-3D canvas').canvas
  const existingNodes = structuredClone(existing.nodes)
  const existingEdges = structuredClone(existing.edges)
  const existingFrame = existing.nodes.find((node) => node.type === 'frame')
  const { canvas, structureChanged } = planCanvas('你创建一个常用的3D建模流程，根据文字生成图片，然后再根据图片生成3D', existing)

  assert.equal(structureChanged, true)
  assert.deepEqual(canvas.nodes.slice(0, existingNodes.length), existingNodes)
  assert.deepEqual(canvas.edges.slice(0, existingEdges.length), existingEdges)

  const addedNodes = canvas.nodes.slice(existingNodes.length)
  const frame = addedNodes.find((node) => node.type === 'frame')
  assert.ok(frame)
  assert.ok(frame.ui.position.x > existingFrame.ui.position.x + existingFrame.ui.size.width)
  assert.deepEqual(addedNodes.filter((node) => node.type !== 'frame').map((node) => node.type), [
    'reference-image',
    'prompt',
    'generate-image',
    'generate-model',
    'export-model',
  ])
  assert.ok(addedNodes.filter((node) => node.type !== 'frame').every((node) => node.ui.parentFrameId === frame.id))
  assert.equal(new Set(canvas.nodes.map((node) => node.id)).size, canvas.nodes.length)
  assert.equal(new Set(canvas.edges.map((edge) => edge.id)).size, canvas.edges.length)
  assert.deepEqual(canvas.edges.slice(existingEdges.length).map((edge) => [edge.source.nodeId, edge.target.nodeId]), [
    ['reference-image', 'generate-image'],
    ['prompt-2', 'generate-image'],
    ['generate-image', 'generate-model'],
    ['generate-model', 'export-model-2'],
  ])
})

test('adds rigging and segments to the model pipeline', () => {
  const initial = planCanvas('Create a text-to-3D canvas').canvas
  const result = planCanvas('Add rigging and Split拆件', initial)

  assert.deepEqual(result.canvas.nodes.filter((node) => node.type !== 'frame').map((node) => node.type), [
    'prompt',
    'text-to-3d',
    'rigging',
    'segments',
    'export-model',
  ])
  assert.deepEqual(result.canvas.edges.map((edge) => [edge.source.nodeId, edge.target.nodeId]), [
    ['prompt', 'text-to-3d'],
    ['text-to-3d', 'rigging'],
    ['rigging', 'segments'],
    ['segments', 'export-model'],
  ])
})

test('adds any supported canvas node type without duplicating it', () => {
  const initial = planCanvas('Create a text-to-3D canvas').canvas
  const originalPositions = new Map(initial.nodes.map((node) => [node.id, structuredClone(node.ui.position)]))
  const first = addCanvasStage(initial, 'generate-image')
  const second = addCanvasStage(first.canvas, 'generate-image')

  assert.equal(first.structureChanged, true)
  assert.deepEqual(first.changedNodeIds, ['generate-image'])
  assert.equal(first.canvas.nodes.filter((node) => node.type === 'generate-image').length, 1)
  assert.equal(second.structureChanged, false)
  assert.deepEqual(second.changedNodeIds, [])
  assert.equal(second.canvas.nodes.filter((node) => node.type === 'generate-image').length, 1)
  for (const node of initial.nodes) {
    assert.deepEqual(first.canvas.nodes.find((candidate) => candidate.id === node.id).ui.position, originalPositions.get(node.id))
  }
  const frame = first.canvas.nodes.find((node) => node.type === 'frame')
  const children = first.canvas.nodes.filter((node) => node.ui.parentFrameId === frame.id)
  assert.ok(children.every((node) => node.ui.position.x >= 70 && node.ui.position.y >= 70))
  assert.ok(children.every((node) => node.ui.position.x + 260 <= frame.ui.size.width - 70))
  assert.ok(children.every((node) => node.ui.position.y + 430 <= frame.ui.size.height - 70))
})

test('wires a single-image to multi-view to unified 3D reconstruction chain', () => {
  const nodes = [
    { id: 'reference-image', type: 'reference-image' },
    { id: 'generate-multiview-images', type: 'generate-multiview-images' },
    { id: 'generate-model', type: 'generate-model' },
    { id: 'export-model', type: 'export-model' },
  ]
  const edges = rebuildDagEdges(nodes)
  const pairs = edges.map((edge) => [edge.source.nodeId, edge.target.nodeId])
  assert.deepEqual(pairs.filter(([source]) => source === 'reference-image'), [['reference-image', 'generate-multiview-images']])
  assert.deepEqual(pairs.filter(([source]) => source === 'generate-model'), [['generate-model', 'export-model']])
  // All four views pair with their namesake ports on the unified model node, so
  // the view label survives into the model node rather than collapsing to one image.
  const viewEdges = edges.filter((edge) => edge.source.nodeId === 'generate-multiview-images' && edge.target.nodeId === 'generate-model')
  assert.deepEqual(viewEdges.map((edge) => [edge.source.port, edge.target.port]), [
    ['front', 'front'],
    ['back', 'back'],
    ['left', 'left'],
    ['right', 'right'],
  ])
})

test('connects multi-view images to the model node even without multiview-to-3d', () => {
  const nodes = [
    { id: 'reference-image', type: 'reference-image' },
    { id: 'generate-multiview-images', type: 'generate-multiview-images' },
    { id: 'generate-model', type: 'generate-model' },
    { id: 'export-model', type: 'export-model' },
  ]
  const edges = rebuildDagEdges(nodes)
  const pairs = edges.map((edge) => [edge.source.nodeId, edge.target.nodeId])
  assert.ok(pairs.some(([source, target]) => source === 'generate-multiview-images' && target === 'generate-model'))
  // The model node is no longer left without an inbound edge.
  assert.ok(edges.some((edge) => edge.target.nodeId === 'generate-model'))
})

test('wires reference image and prompt directly into the model without an intermediate image node', () => {
  const nodes = [
    { id: 'reference-image', type: 'reference-image' },
    { id: 'prompt', type: 'prompt' },
    { id: 'generate-model', type: 'generate-model' },
    { id: 'export-model', type: 'export-model' },
  ]
  const edges = rebuildDagEdges(nodes)
  const pairs = edges.map((edge) => [edge.source.nodeId, edge.target.nodeId])
  assert.deepEqual(pairs, [
    ['reference-image', 'generate-model'],
    ['prompt', 'generate-model'],
    ['generate-model', 'export-model'],
  ])
  // Neither the reference image nor the prompt is left dangling.
  const outgoing = (id) => edges.filter((edge) => edge.source.nodeId === id).length
  assert.ok(outgoing('reference-image') > 0)
  assert.ok(outgoing('prompt') > 0)
})

test('adds a new frame with a unique ID', () => {
  const initial = planCanvas('Create a prop canvas').canvas
  const result = addCanvasStage(initial, 'frame', 'Add another group')
  const frames = result.canvas.nodes.filter((node) => node.type === 'frame')

  assert.equal(result.structureChanged, true)
  assert.deepEqual(result.changedNodeIds, ['frame-main-2'])
  assert.equal(frames.length, 2)
  assert.notEqual(frames[0].id, frames[1].id)
  assert.equal(result.canvas.edges.length, initial.edges.length)
})

test('applies per-type config overrides while building', () => {
  const canvas = buildCanvasStructure('Build a prop pipeline', ['prompt', 'text-to-3d', 'texture', 'export-model'], null, {
    configs: {
      'texture': { textureQuality: 'detailed' },
      'export-model': { modelFormat: 'usdz' },
    },
  })
  const texture = canvas.nodes.find((node) => node.type === 'texture')
  const exported = canvas.nodes.find((node) => node.type === 'export-model')

  assert.equal(texture.config.textureQuality, 'detailed')
  assert.equal(exported.config.modelFormat, 'usdz')
})

test('rejects an override the node does not have', () => {
  assert.throws(
    () => buildCanvasStructure('Build a prop pipeline', ['prompt', 'text-to-3d'], null, {
      configs: { 'text-to-3d': { notAParameter: 1 } },
    }),
    /does not support parameter/,
  )
})

test('wires every mesh stage in the chain, not just the original four', () => {
  const nodes = [
    { id: 'prompt', type: 'prompt' },
    { id: 'text-to-3d', type: 'text-to-3d' },
    { id: 'remesh', type: 'remesh' },
    { id: 'uv-unwrap', type: 'uv-unwrap' },
    { id: 'print-analyze', type: 'print-analyze' },
    { id: 'print-repair', type: 'print-repair' },
    { id: 'convert-model', type: 'convert-model' },
    { id: 'export-model', type: 'export-model' },
  ]
  const pairs = rebuildDagEdges(nodes).map((edge) => [edge.source.nodeId, edge.target.nodeId]).filter(([source]) => source !== 'prompt')

  assert.deepEqual(pairs, [
    ['text-to-3d', 'remesh'],
    ['remesh', 'uv-unwrap'],
    ['uv-unwrap', 'print-analyze'],
    ['print-analyze', 'print-repair'],
    ['print-repair', 'convert-model'],
    ['convert-model', 'export-model'],
  ])
})

test('routes a motion clip into the animation node motion port', () => {
  const edges = rebuildDagEdges([
    { id: 'text-to-motion', type: 'text-to-motion' },
    { id: 'rigging', type: 'rigging' },
    { id: 'animation', type: 'animation' },
  ])
  const motion = edges.find((edge) => edge.source.nodeId === 'text-to-motion')

  assert.deepEqual([motion.target.nodeId, motion.target.port], ['animation', 'motion'])
})

test('deleting a stage reconnects upstream to downstream and drops the orphan preview', () => {
  const slot = (id) => ({ id, type: 'generated-model', name: 'generated-model', config: {}, ui: {} })
  const node = (id, type) => ({ id, type, name: type, config: {}, ui: {} })
  const edge = (id, from, to) => ({ id, source: { nodeId: from, port: 'model' }, target: { nodeId: to, port: 'model' } })
  const canvas = {
    revision: 4,
    nodes: [node('text-to-3d', 'text-to-3d'), slot('slot-a'), node('retopology', 'retopology'), slot('slot-b'), node('texture', 'texture')],
    edges: [edge('e1', 'text-to-3d', 'slot-a'), edge('e2', 'slot-a', 'retopology'), edge('e3', 'retopology', 'slot-b'), edge('e4', 'slot-b', 'texture')],
  }

  // Deleting the stage and its preview slot together must not strand the node
  // that came after them.
  const result = removeCanvasNodes(canvas, ['retopology', 'slot-b'])

  assert.equal(result.changed, true)
  assert.deepEqual(result.removed.map((entry) => entry.id).sort(), ['retopology', 'slot-b'])
  assert.ok(result.bridged.some((hop) => hop.from === 'slot-a' && hop.to === 'texture'))
  const ids = new Set(result.canvas.nodes.map((entry) => entry.id))
  assert.ok(result.canvas.edges.every((entry) => ids.has(entry.source.nodeId) && ids.has(entry.target.nodeId)))
  assert.equal(result.canvas.revision, 5)
})

test('removing a node that is not there is a no-op', () => {
  const canvas = buildCanvasStructure('Build a text pipeline', ['prompt', 'text-to-3d'], null)
  const result = removeCanvasNodes(canvas, ['not-a-node'])
  assert.equal(result.changed, false)
})
