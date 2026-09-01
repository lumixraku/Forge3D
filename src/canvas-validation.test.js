import test from 'node:test'
import assert from 'node:assert/strict'
import { validateCanvasGraph } from './canvas-nodes.js'

const node = (id, type, config = {}) => ({ id, type, name: id, config })

test('validates named multi-view ports without collapsing their connections', () => {
  // The prompt is what the view generator itself runs on; the four edges are
  // what this test is about.
  const nodes = [node('views', 'generate-multiview-images', { prompt: 'a shark' }), node('model', 'multiview-to-3d')]
  const edges = ['front', 'back', 'left', 'right'].map((view) => ({ source: { nodeId: 'views', port: view }, target: { nodeId: 'model', port: view } }))

  assert.deepEqual(validateCanvasGraph(nodes, edges, { requireParameters: true }), [])
})

test('a node missing every parameter it runs with cannot run', () => {
  const issues = validateCanvasGraph([node('model', 'generate-model')], [], { requireParameters: true })

  assert.equal(issues.length, 1)
  assert.equal(issues[0].code, 'required_parameter_missing')
  assert.equal(issues[0].parameter, 'image')
  assert.equal(issues[0].message, 'model requires Image, Front, Back, Left, Right, or Text.')
})

test('alternative parameters are satisfied by any one of them', () => {
  const model = node('model', 'generate-model')
  const source = node('source', 'reference-image')
  const views = node('views', 'generate-multiview-images', { prompt: 'a shark' })
  const satisfied = (nodes, edges) => assert.deepEqual(validateCanvasGraph(nodes, edges, { requireParameters: true }), [])

  // One loose image is enough, and so is a partial set of labeled views: the
  // group is a set of alternatives, not a list of things that must all be there.
  satisfied([model, source], [{ source: { nodeId: 'source', port: 'image' }, target: { nodeId: 'model', port: 'image' } }])
  satisfied([model, views], [
    { source: { nodeId: 'views', port: 'front' }, target: { nodeId: 'model', port: 'front' } },
    { source: { nodeId: 'views', port: 'back' }, target: { nodeId: 'model', port: 'back' } },
  ])
  satisfied([node('model', 'generate-model', { prompt: 'a shark' })], [])
  // Export writes whichever one is connected, so a model alone is enough. The
  // upstream node needs its own source, or it would be the one reported here.
  satisfied([node('export', 'export-model'), node('model', 'generate-model', { prompt: 'a shark' })], [
    { source: { nodeId: 'model', port: 'model' }, target: { nodeId: 'export', port: 'model' } },
  ])
})

test('a blank prompt does not satisfy a parameter', () => {
  // resolveNodeInputs trims, so anything it would resolve to nothing has to be
  // refused here rather than failing later in the run.
  const issues = validateCanvasGraph([node('model', 'text-to-3d', { prompt: '   ' })], [], { requireParameters: true })

  assert.equal(issues[0]?.code, 'required_parameter_missing')
})

test('a connection satisfies the parameter its port carries', () => {
  // The upstream value does not exist until it runs, so the edge itself is what
  // says this parameter will be filled.
  const nodes = [node('model', 'generate-model', { prompt: 'a shark' }), node('retopo', 'retopology')]
  const edges = [{ source: { nodeId: 'model', port: 'model' }, target: { nodeId: 'retopo', port: 'model' } }]

  assert.deepEqual(validateCanvasGraph(nodes, edges, { requireParameters: true }), [])
})

test('requireParameters can be limited to named nodes', () => {
  const nodes = [node('ready', 'text-to-3d', { prompt: 'a shark' }), node('half-built', 'generate-model')]

  assert.deepEqual(validateCanvasGraph(nodes, [], { requireParameters: ['ready'] }), [])
  assert.equal(validateCanvasGraph(nodes, [], { requireParameters: true }).length, 1)
})

test('rejects incompatible, duplicate, and incomplete logical inputs', () => {
  const texture = node('texture', 'texture')
  const model = node('model', 'generate-model')
  const prompt = node('prompt', 'prompt')

  assert.equal(validateCanvasGraph([texture, prompt], [{ source: { nodeId: 'prompt', port: 'text' }, target: { nodeId: 'texture', port: 'model' } }], { requireParameters: true })[0].code, 'incompatible_ports')
  assert.equal(validateCanvasGraph([texture, model], [
    { source: { nodeId: 'model', port: 'model' }, target: { nodeId: 'texture', port: 'model' } },
    { source: { nodeId: 'model', port: 'model' }, target: { nodeId: 'texture', port: 'model' } },
  ])[0].code, 'duplicate_input')
  assert.equal(validateCanvasGraph([texture], [], { requireParameters: true })[0].code, 'required_parameter_missing')
})
