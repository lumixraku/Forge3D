import test from 'node:test'
import assert from 'node:assert/strict'
import { addWorkflowStage, planWorkflow, rebuildDagEdges } from './planner.js'

test('creates a reusable workflow', () => {
  const { workflow } = planWorkflow('Create a game character workflow')
  assert.equal(workflow.schemaVersion, '1.0')
  assert.equal(workflow.nodes.length, 6)
  assert.equal(workflow.edges.length, 4)
  assert.deepEqual(workflow.nodes.find((node) => node.type === 'frame'), {
    id: 'frame-main',
    type: 'frame',
    name: '3D Asset Reconstruction',
    config: {},
    ui: { position: { x: 40, y: 80 }, size: { width: 1760, height: 570 } },
  })
  const frame = workflow.nodes.find((node) => node.type === 'frame')
  const children = workflow.nodes.filter((node) => node.type !== 'frame')
  for (const child of children) {
    assert.ok(child.ui.position.x >= 70, `${child.id} is inside frame left edge`)
    assert.ok(child.ui.position.y >= 70, `${child.id} is inside frame top edge`)
    assert.ok(child.ui.position.x + 260 <= frame.ui.size.width - 70, `${child.id} is inside frame right edge`)
    assert.ok(child.ui.position.y + 430 <= frame.ui.size.height - 70, `${child.id} is inside frame bottom edge`)
  }
  assert.deepEqual(workflow.nodes.find((node) => node.type === 'generate-model').config, {
    modelVersion: 'Smart Mesh',
    textureMode: 'PBR',
    faceType: 'Triangle',
    faceCount: 20000,
    preview: '/shark-model.png',
  })
  assert.equal(workflow.nodes.find((node) => node.type === 'generate-image').config.model, 'GPT Image 2')
  assert.equal(workflow.nodes.find((node) => node.type === 'generate-image').config.previews.length, 4)
  assert.deepEqual(Object.fromEntries(workflow.nodes.filter((node) => node.type !== 'frame').map((node) => [node.type, node.name])), {
    'reference-image': 'Image Upload',
    prompt: 'Text Prompt',
    'generate-image': 'Gen Image',
    'generate-model': 'Gen HD Model',
    'export-model': 'Export',
  })
  assert.deepEqual(workflow.edges.map((edge) => [edge.source.nodeId, edge.target.nodeId]), [
    ['reference-image', 'generate-image'],
    ['prompt', 'generate-image'],
    ['generate-image', 'generate-model'],
    ['generate-model', 'export-model'],
  ])
})

test('creates a named frame for a Blahaj reconstruction request', () => {
  const { workflow } = planWorkflow('复刻 Blahaj 的3D模型')
  const frame = workflow.nodes.find((node) => node.type === 'frame')

  assert.equal(frame.name, 'Blahaj 3D Reconstruction')
  assert.ok(workflow.nodes.filter((node) => node.type !== 'frame').every((node) => node.ui.parentFrameId === frame.id))
})

test('creates a dedicated Text to 3D workflow', () => {
  const { workflow } = planWorkflow('Create a text-to-3D workflow from a prompt')

  assert.deepEqual(workflow.nodes.filter((node) => node.type !== 'frame').map((node) => [node.type, node.name]), [
    ['prompt', 'Text Prompt'],
    ['text-to-3d', 'Text to 3D'],
    ['export-model', 'Export'],
  ])
  assert.deepEqual(workflow.edges.map((edge) => [edge.source.nodeId, edge.target.nodeId]), [
    ['prompt', 'text-to-3d'],
    ['text-to-3d', 'export-model'],
  ])
  assert.equal(workflow.nodes.find((node) => node.type === 'text-to-3d').config.modelVersion, 'Smart Mesh')
})

test('recognizes Chinese Text to 3D requests', () => {
  const { workflow } = planWorkflow('根据描述生成3D工作流')
  assert.ok(workflow.nodes.some((node) => node.type === 'text-to-3d'))
  assert.ok(!workflow.nodes.some((node) => node.type === 'generate-model'))
})

test('builds an image-first workflow from a natural language request', () => {
  const existing = planWorkflow('Create a text-to-3D workflow').workflow
  const { workflow, structureChanged } = planWorkflow('你创建一个常用的3D建模流程，根据文字生成图片，然后再根据图片生成3D', existing)

  assert.equal(structureChanged, true)
  const frame = workflow.nodes.find((node) => node.type === 'frame')
  assert.ok(frame)
  assert.deepEqual(workflow.nodes.filter((node) => node.type !== 'frame').map((node) => node.type), [
    'reference-image',
    'prompt',
    'generate-image',
    'generate-model',
    'export-model',
  ])
  assert.ok(workflow.nodes.filter((node) => node.type !== 'frame').every((node) => node.ui.parentFrameId === frame.id))
  assert.deepEqual(workflow.edges.map((edge) => [edge.source.nodeId, edge.target.nodeId]), [
    ['reference-image', 'generate-image'],
    ['prompt', 'generate-image'],
    ['generate-image', 'generate-model'],
    ['generate-model', 'export-model'],
  ])
})

test('adds requested stages without duplicates', () => {
  const initial = planWorkflow('Create a prop workflow').workflow
  const first = planWorkflow('Add low-poly and PBR texture', initial).workflow
  const second = planWorkflow('Add low-poly again', first).workflow
  assert.equal(first.nodes.filter((node) => node.type === 'retopology').length, 1)
  assert.equal(first.nodes.filter((node) => node.type === 'texture').length, 1)
  assert.equal(second.nodes.filter((node) => node.type === 'retopology').length, 1)
  assert.equal(first.nodes.find((node) => node.type === 'retopology').name, 'Retopology')
  assert.equal(first.nodes.find((node) => node.type === 'texture').name, 'UV Texture')
  assert.ok(first.nodes.every((node) => Number.isFinite(node.ui.position.x) && Number.isFinite(node.ui.position.y)))
  const firstFrame = first.nodes.find((node) => node.type === 'frame')
  const firstChildren = first.nodes.filter((node) => node.type !== 'frame')
  const firstRight = Math.max(...firstChildren.map((node) => node.ui.position.x + 260))
  const firstBottom = Math.max(...firstChildren.map((node) => node.ui.position.y + 430))
  assert.equal(firstFrame.ui.size.width, firstRight - Math.min(...firstChildren.map((node) => node.ui.position.x)) + 140)
  assert.equal(firstFrame.ui.size.height, firstBottom - Math.min(...firstChildren.map((node) => node.ui.position.y)) + 140)
  assert.equal(first.nodes.find((node) => node.type === 'retopology').config.bakeTextures, true)
  assert.equal(first.nodes.find((node) => node.type === 'texture').config.textureQuality, '2K')
  assert.deepEqual(first.edges.map((edge) => [edge.source.nodeId, edge.target.nodeId]), [
    ['reference-image', 'generate-image'],
    ['prompt', 'generate-image'],
    ['generate-image', 'generate-model'],
    ['generate-model', 'retopology'],
    ['retopology', 'texture'],
    ['texture', 'export-model'],
  ])
})

test('adds rigging and split to the model pipeline', () => {
  const initial = planWorkflow('Create a text-to-3D workflow').workflow
  const result = planWorkflow('Add rigging and Split拆件', initial)

  assert.deepEqual(result.workflow.nodes.filter((node) => node.type !== 'frame').map((node) => node.type), [
    'prompt',
    'text-to-3d',
    'rigging',
    'split',
    'export-model',
  ])
  assert.deepEqual(result.workflow.edges.map((edge) => [edge.source.nodeId, edge.target.nodeId]), [
    ['prompt', 'text-to-3d'],
    ['text-to-3d', 'rigging'],
    ['rigging', 'split'],
    ['split', 'export-model'],
  ])
})

test('ends processed models at export', () => {
  const initial = planWorkflow('Create a prop workflow').workflow
  const { workflow } = planWorkflow('Add low-poly, PBR texture, save to asset library, and export FBX', initial)
  const incoming = (id) => workflow.edges.filter((edge) => edge.target.nodeId === id)
  const outgoing = (id) => workflow.edges.filter((edge) => edge.source.nodeId === id)

  assert.deepEqual(workflow.nodes.filter((node) => node.type !== 'frame' && incoming(node.id).length === 0).map((node) => node.id), ['reference-image', 'prompt'])
  assert.deepEqual(workflow.nodes.filter((node) => node.type !== 'frame' && outgoing(node.id).length === 0).map((node) => node.id), ['export-model'])
  assert.equal(incoming('generate-image').length, 2)
  assert.equal(outgoing('texture').length, 1)
  assert.deepEqual(workflow.edges.at(-1), {
    id: 'texture-export-model',
    source: { nodeId: 'texture', port: 'model' },
    target: { nodeId: 'export-model', port: 'model' },
  })
  assert.ok(!workflow.nodes.some((node) => ['save-asset', 'model-preview'].includes(node.type)))
})

test('updates core node parameters and reports the exact changes', () => {
  const initial = planWorkflow('Create a text-to-3D workflow from a prompt').workflow
  const withStages = planWorkflow('Add retopology and texture', initial).workflow
  const result = planWorkflow('Set generated face count to 12000, retopology target faces to 5000, texture resolution to 4K, and prompt strength to 65%', withStages)

  assert.equal(result.workflow.nodes.find((node) => node.type === 'text-to-3d').config.faceCount, 12000)
  assert.equal(result.workflow.nodes.find((node) => node.type === 'retopology').config.faceLimit, 5000)
  assert.equal(result.workflow.nodes.find((node) => node.type === 'texture').config.textureQuality, '4K')
  assert.equal(result.workflow.nodes.find((node) => node.type === 'prompt').config.strength, 65)
  assert.deepEqual(result.changedNodeIds.sort(), ['prompt', 'retopology', 'text-to-3d', 'texture'])
  assert.match(result.reply, /Retopology: target face count 10000 → 5000/)
  assert.equal(result.structureChanged, false)
})


test('lists adjustable parameters without changing the workflow revision', () => {
  const initial = planWorkflow('Create a text-to-3D workflow from a prompt').workflow
  const result = planWorkflow('What parameters can I adjust?', initial)

  assert.equal(result.workflow.revision, initial.revision)
  assert.deepEqual(result.changedNodeIds, [])
  assert.match(result.reply, /Text to 3D: generated face count/)
  assert.match(result.reply, /Text Prompt: .*prompt strength/)
})

test('lists retopology parameters after adding the node', () => {
  const initial = planWorkflow('Create a prop workflow').workflow
  const withRetopology = planWorkflow('Add retopology', initial).workflow
  const result = planWorkflow('Retopology 有哪些参数可以调？', withRetopology)

  assert.match(result.reply, /Retopology: target face count/)
  assert.doesNotMatch(result.reply, /Texture Model/)
})

test('adds any supported workflow node type without duplicating it', () => {
  const initial = planWorkflow('Create a text-to-3D workflow').workflow
  const originalPositions = new Map(initial.nodes.map((node) => [node.id, structuredClone(node.ui.position)]))
  const first = addWorkflowStage(initial, 'generate-image')
  const second = addWorkflowStage(first.workflow, 'generate-image')

  assert.equal(first.structureChanged, true)
  assert.deepEqual(first.changedNodeIds, ['generate-image'])
  assert.equal(first.workflow.nodes.filter((node) => node.type === 'generate-image').length, 1)
  assert.equal(second.structureChanged, false)
  assert.deepEqual(second.changedNodeIds, [])
  assert.equal(second.workflow.nodes.filter((node) => node.type === 'generate-image').length, 1)
  for (const node of initial.nodes) {
    assert.deepEqual(first.workflow.nodes.find((candidate) => candidate.id === node.id).ui.position, originalPositions.get(node.id))
  }
  const frame = first.workflow.nodes.find((node) => node.type === 'frame')
  const children = first.workflow.nodes.filter((node) => node.ui.parentFrameId === frame.id)
  assert.ok(children.every((node) => node.ui.position.x >= 70 && node.ui.position.y >= 70))
  assert.ok(children.every((node) => node.ui.position.x + 260 <= frame.ui.size.width - 70))
  assert.ok(children.every((node) => node.ui.position.y + 430 <= frame.ui.size.height - 70))
})

test('wires a single-image to multi-view to 3D reconstruction chain', () => {
  const nodes = [
    { id: 'reference-image', type: 'reference-image' },
    { id: 'generate-multiview-images', type: 'generate-multiview-images' },
    { id: 'multiview-to-3d', type: 'multiview-to-3d' },
    { id: 'export-model', type: 'export-model' },
  ]
  const edges = rebuildDagEdges(nodes).map((edge) => [edge.source.nodeId, edge.target.nodeId])
  assert.deepEqual(edges, [
    ['reference-image', 'generate-multiview-images'],
    ['generate-multiview-images', 'multiview-to-3d'],
    ['multiview-to-3d', 'export-model'],
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

test('adds a new frame with a unique ID', () => {
  const initial = planWorkflow('Create a prop workflow').workflow
  const result = addWorkflowStage(initial, 'frame', 'Add another group')
  const frames = result.workflow.nodes.filter((node) => node.type === 'frame')

  assert.equal(result.structureChanged, true)
  assert.deepEqual(result.changedNodeIds, ['frame-main-2'])
  assert.equal(frames.length, 2)
  assert.notEqual(frames[0].id, frames[1].id)
  assert.equal(result.workflow.edges.length, initial.edges.length)
})
