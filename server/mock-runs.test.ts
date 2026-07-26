import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createMockRun, downstreamWorkflow, executeMockRun, executionNodes, isRunTerminal } from './mock-runs.js'

const workflow = {
  id: 'wf-test',
  revision: 3,
  nodes: [
    { id: 'prompt', type: 'prompt', name: 'Text Prompt', config: {} },
    { id: 'model', type: 'text-to-3d', name: 'Text to 3D', config: { preview: '/model.png' } },
  ],
  edges: [
    { source: { nodeId: 'prompt' }, target: { nodeId: 'model' } },
  ],
}

test('creates a running mock run with stable node result shapes', () => {
  const run = createMockRun(workflow, { id: 'run-test', now: () => 'start' })

  assert.equal(run.status, 'running')
  assert.equal(run.completedAt, null)
  assert.deepEqual(run.nodeRuns.prompt, { status: 'running', durationMs: null, output: null, error: null })
  assert.deepEqual(run.nodeRuns.model, { status: 'queued', durationMs: null, output: null, error: null })
})

test('executes nodes in order and returns runtime preview output', async () => {
  const run = createMockRun(workflow, { id: 'run-test', now: () => 'start' })
  const transitions = []
  await executeMockRun(run, workflow, {
    wait: async () => {},
    now: () => 'complete',
    persist: async () => transitions.push(workflow.nodes.map((node) => run.nodeRuns[node.id].status)),
  })

  assert.equal(run.status, 'succeeded')
  assert.equal(run.completedAt, 'complete')
  assert.equal(run.nodeRuns.prompt.output.message, 'Mock prompt result')
  assert.deepEqual(run.nodeRuns.model.output, { message: 'Text to 3D generated', preview: '/model.png' })
  assert.ok(transitions.some((statuses) => statuses[0] === 'succeeded' && statuses[1] === 'running'))
  assert.equal(isRunTerminal(run), true)
})

test('derives execution order from workflow edges', () => {
  const reversed = { ...workflow, nodes: [...workflow.nodes].reverse() }
  assert.deepEqual(executionNodes(reversed).map((node) => node.id), ['prompt', 'model'])
})

test('treats four view connections as one execution dependency', () => {
  const multiviewWorkflow = {
    ...workflow,
    nodes: [
      { id: 'views', type: 'generate-multiview-images', name: 'Views', config: {} },
      { id: 'model', type: 'multiview-to-3d', name: 'Model', config: {} },
    ],
    edges: ['front', 'back', 'left', 'right'].map((view) => ({ source: { nodeId: 'views', port: view }, target: { nodeId: 'model', port: view } })),
  }

  assert.deepEqual(executionNodes(multiviewWorkflow).map((node) => node.id), ['views', 'model'])
})

test('emits four named views from a completed multiview generation', async () => {
  const multiviewWorkflow = {
    ...workflow,
    nodes: [{
      id: 'views',
      type: 'generate-multiview-images',
      name: 'Generate Multi-view Images',
      config: { viewPreviews: { front: '/front.png', back: '/back.png', left: '/left.png', right: '/right.png' } },
    }],
    edges: [],
  }
  const run = createMockRun(multiviewWorkflow)
  await executeMockRun(run, multiviewWorkflow, { wait: async () => {}, persist: async () => {} })

  assert.deepEqual(run.nodeRuns.views.output.viewPreviews, {
    front: '/front.png', back: '/back.png', left: '/left.png', right: '/right.png',
  })
})

test('limits image candidates to the configured count', async () => {
  const countWorkflow = { ...workflow, nodes: [{ id: 'concepts', type: 'generate-image', name: 'Gen Image', config: { count: 2, previews: ['/a.png', '/b.png', '/c.png', '/d.png'] } }], edges: [] }
  const run = createMockRun(countWorkflow)
  await executeMockRun(run, countWorkflow, { wait: async () => {}, persist: async () => {} })
  assert.deepEqual(run.nodeRuns.concepts.output.previews, ['/a.png', '/b.png'])
})

test('flows the selected candidate image downstream to a review node', async () => {
  const selectionWorkflow = {
    ...workflow,
    nodes: [
      { id: 'concepts', type: 'generate-image', name: 'Image to Image', config: { previews: ['/a.png', '/b.png', '/c.png', '/d.png'], selectedPreview: '/c.png' } },
      { id: 'review', type: 'review', name: 'Human Review', config: { preview: '/fallback.png', approved: true } },
    ],
    edges: [{ source: { nodeId: 'concepts', port: 'image' }, target: { nodeId: 'review', port: 'image' } }],
  }
  const run = createMockRun(selectionWorkflow)
  await executeMockRun(run, selectionWorkflow, { wait: async () => {}, persist: async () => {} })

  assert.equal(run.nodeRuns.concepts.output.image, '/c.png')
  assert.equal(run.nodeRuns.review.output.preview, '/c.png')
})

test('executes the complete seeded production pipeline', async () => {
  const [seedWorkflow] = JSON.parse(await readFile(new URL('./seed/workflows.json', import.meta.url), 'utf8'))
  const run = createMockRun(seedWorkflow)
  await executeMockRun(run, seedWorkflow, { wait: async () => {}, persist: async () => {} })

  assert.deepEqual(executionNodes(seedWorkflow).map((node) => node.id), [
    'prompt', 'text-to-3d', 'retopology', 'texture', 'preview',
  ])
  assert.equal(Object.keys(run.nodeRuns).length, 5)
  assert.ok(Object.values(run.nodeRuns).every((nodeRun) => nodeRun.status === 'succeeded'))
})

test('creates and executes a run containing only the requested node', async () => {
  const executionWorkflow = { ...workflow, nodes: [workflow.nodes[1]] }
  const run = createMockRun(executionWorkflow, { id: 'run-target', now: () => 'start' })

  assert.deepEqual(Object.keys(run.nodeRuns), ['model'])
  await executeMockRun(run, executionWorkflow, { wait: async () => {}, now: () => 'complete', persist: async () => {} })
  assert.equal(run.status, 'succeeded')
  assert.deepEqual(Object.keys(run.nodeRuns), ['model'])
  assert.deepEqual(run.nodeRuns.model.output, { message: 'Text to 3D generated', preview: '/model.png' })
})

test('runs a target node and all reachable downstream nodes in topological order', async () => {
  const branchedWorkflow = {
    ...workflow,
    nodes: [
      { id: 'preview', type: 'model-preview', name: 'Preview', config: {} },
      { id: 'texture', type: 'texture', name: 'Texture', config: {} },
      { id: 'model', type: 'text-to-3d', name: 'Text to 3D', config: {} },
      { id: 'prompt', type: 'prompt', name: 'Prompt', config: {} },
      { id: 'alternate', type: 'generate-image', name: 'Alternate', config: {} },
    ],
    edges: [
      { source: { nodeId: 'prompt' }, target: { nodeId: 'model' } },
      { source: { nodeId: 'model' }, target: { nodeId: 'texture' } },
      { source: { nodeId: 'texture' }, target: { nodeId: 'preview' } },
      { source: { nodeId: 'prompt' }, target: { nodeId: 'alternate' } },
    ],
  }
  const executionWorkflow = downstreamWorkflow(branchedWorkflow, 'model')
  const run = createMockRun(executionWorkflow)

  assert.deepEqual(executionNodes(executionWorkflow).map((node) => node.id), ['model', 'texture', 'preview'])
  assert.deepEqual(Object.keys(run.nodeRuns), ['model', 'texture', 'preview'])
  await executeMockRun(run, executionWorkflow, { wait: async () => {}, persist: async () => {} })
  assert.ok(Object.values(run.nodeRuns).every((nodeRun) => nodeRun.status === 'succeeded'))
  assert.ok(Object.values(run.nodeRuns).every((nodeRun) => typeof nodeRun.durationMs === 'number'))
})

test('stops at a deterministic mocked node failure', async () => {
  const failingWorkflow = structuredClone(workflow)
  failingWorkflow.nodes[1].config.mockFailure = true
  const run = createMockRun(failingWorkflow)
  await executeMockRun(run, failingWorkflow, { wait: async () => {}, now: () => 'failed', persist: async () => {} })

  assert.equal(run.status, 'failed')
  assert.equal(run.nodeRuns.model.status, 'failed')
  assert.equal(run.nodeRuns.model.output, null)
  assert.match(run.nodeRuns.model.error, /execution failed/)
})

test('prepares a DCC export from the connected model input', async () => {
  const exportWorkflow = {
    ...workflow,
    nodes: [{ id: 'model', type: 'text-to-3d', name: 'Text to 3D', config: { preview: '/model.png' } }, { id: 'export', type: 'export-model', name: 'Export', config: { modelFormat: 'FBX' } }],
    edges: [{ source: { nodeId: 'model', port: 'model' }, target: { nodeId: 'export', port: 'model' } }],
  }
  const run = createMockRun(exportWorkflow)
  await executeMockRun(run, exportWorkflow, { wait: async () => {}, persist: async () => {} })
  assert.deepEqual(run.nodeRuns.export.output, {
    message: 'Export ready', target: '3D Model', format: 'FBX', preview: '/shark-model.png',
    outputs: [{ destination: 'dcc', format: 'FBX', filename: 'shark-gardener.fbx', downloadUrl: '/models/shark-gardener.glb', mock: true }],
  })
})

test('prepares every selected export destination', async () => {
  const exportWorkflow = {
    ...workflow,
    nodes: [{ id: 'model', type: 'text-to-3d', name: 'Text to 3D', config: { preview: '/model.png' } }, { id: 'export', type: 'export-model', name: 'Export', config: { modelFormat: 'OBJ', exportTargets: ['dcc', 'texture', 'bambu'] } }],
    edges: [{ source: { nodeId: 'model', port: 'model' }, target: { nodeId: 'export', port: 'model' } }],
  }
  const run = createMockRun(exportWorkflow)
  await executeMockRun(run, exportWorkflow, { wait: async () => {}, persist: async () => {} })
  assert.deepEqual(run.nodeRuns.export.output.outputs, [
    { destination: 'dcc', format: 'OBJ', filename: 'shark-gardener.obj', downloadUrl: '/models/shark-gardener.glb', mock: true },
    { destination: 'texture', format: 'ZIP', filename: 'shark-gardener-textures.zip', status: 'prepared', mock: true },
    { destination: 'bambu', format: '3MF', filename: 'shark-gardener.3mf', status: 'sent', mock: true },
  ])
})
