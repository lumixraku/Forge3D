import test from 'node:test'
import assert from 'node:assert/strict'
import { addWorkflowStage, buildWorkflowStructure, planWorkflow, rebuildDagEdges } from './planner.js'

test('creates a named frame for a Blahaj reconstruction request', () => {
  const { workflow } = planWorkflow('复刻 Blahaj 的3D模型')
  const frame = workflow.nodes.find((node) => node.type === 'frame')

  assert.equal(frame.name, 'Blahaj 3D Reconstruction')
  assert.ok(workflow.nodes.filter((node) => node.type !== 'frame').every((node) => node.ui.parentFrameId === frame.id))
})

test('recognizes Chinese Text to 3D requests', () => {
  const { workflow } = planWorkflow('根据描述生成3D工作流')
  assert.ok(workflow.nodes.some((node) => node.type === 'text-to-3d'))
  assert.ok(!workflow.nodes.some((node) => node.type === 'generate-model'))
})

test('appends an image-first workflow in a new frame without replacing the canvas', () => {
  const existing = planWorkflow('Create a text-to-3D workflow').workflow
  const existingNodes = structuredClone(existing.nodes)
  const existingEdges = structuredClone(existing.edges)
  const existingFrame = existing.nodes.find((node) => node.type === 'frame')
  const { workflow, structureChanged } = planWorkflow('你创建一个常用的3D建模流程，根据文字生成图片，然后再根据图片生成3D', existing)

  assert.equal(structureChanged, true)
  assert.deepEqual(workflow.nodes.slice(0, existingNodes.length), existingNodes)
  assert.deepEqual(workflow.edges.slice(0, existingEdges.length), existingEdges)

  const addedNodes = workflow.nodes.slice(existingNodes.length)
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
  assert.equal(new Set(workflow.nodes.map((node) => node.id)).size, workflow.nodes.length)
  assert.equal(new Set(workflow.edges.map((edge) => edge.id)).size, workflow.edges.length)
  assert.deepEqual(workflow.edges.slice(existingEdges.length).map((edge) => [edge.source.nodeId, edge.target.nodeId]), [
    ['reference-image', 'generate-image'],
    ['prompt-2', 'generate-image'],
    ['generate-image', 'generate-model'],
    ['generate-model', 'export-model-2'],
  ])
})

test('adds rigging and segments to the model pipeline', () => {
  const initial = planWorkflow('Create a text-to-3D workflow').workflow
  const result = planWorkflow('Add rigging and Split拆件', initial)

  assert.deepEqual(result.workflow.nodes.filter((node) => node.type !== 'frame').map((node) => node.type), [
    'prompt',
    'text-to-3d',
    'rigging',
    'segments',
    'export-model',
  ])
  assert.deepEqual(result.workflow.edges.map((edge) => [edge.source.nodeId, edge.target.nodeId]), [
    ['prompt', 'text-to-3d'],
    ['text-to-3d', 'rigging'],
    ['rigging', 'segments'],
    ['segments', 'export-model'],
  ])
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

test('wires a single-image to multi-view to unified 3D reconstruction chain', () => {
  const nodes = [
    { id: 'reference-image', type: 'reference-image' },
    { id: 'generate-multiview-images', type: 'generate-multiview-images' },
    { id: 'generate-model', type: 'generate-model' },
    { id: 'export-model', type: 'export-model' },
  ]
  const edges = rebuildDagEdges(nodes).map((edge) => [edge.source.nodeId, edge.target.nodeId])
  assert.deepEqual(edges, [
    ['reference-image', 'generate-multiview-images'],
    ['generate-multiview-images', 'generate-model'],
    ['generate-model', 'export-model'],
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
  const initial = planWorkflow('Create a prop workflow').workflow
  const result = addWorkflowStage(initial, 'frame', 'Add another group')
  const frames = result.workflow.nodes.filter((node) => node.type === 'frame')

  assert.equal(result.structureChanged, true)
  assert.deepEqual(result.changedNodeIds, ['frame-main-2'])
  assert.equal(frames.length, 2)
  assert.notEqual(frames[0].id, frames[1].id)
  assert.equal(result.workflow.edges.length, initial.edges.length)
})
