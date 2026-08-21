import test from 'node:test'
import assert from 'node:assert/strict'
import { validateCanvasGraph } from './canvas-nodes.js'

const node = (id, type, config = {}) => ({ id, type, name: id, config })

test('validates named multi-view ports without collapsing their connections', () => {
  const nodes = [node('views', 'generate-multiview-images'), node('model', 'multiview-to-3d')]
  const edges = ['front', 'back', 'left', 'right'].map((view) => ({ source: { nodeId: 'views', port: view }, target: { nodeId: 'model', port: view } }))

  assert.deepEqual(validateCanvasGraph(nodes, edges, { requireInputs: true }), [])
})

test('rejects incompatible, duplicate, and incomplete logical inputs', () => {
  const texture = node('texture', 'texture')
  const model = node('model', 'generate-model')
  const prompt = node('prompt', 'prompt')

  assert.equal(validateCanvasGraph([texture, prompt], [{ source: { nodeId: 'prompt', port: 'text' }, target: { nodeId: 'texture', port: 'model' } }], { requireInputs: true })[0].code, 'incompatible_ports')
  assert.equal(validateCanvasGraph([texture, model], [
    { source: { nodeId: 'model', port: 'model' }, target: { nodeId: 'texture', port: 'model' } },
    { source: { nodeId: 'model', port: 'model' }, target: { nodeId: 'texture', port: 'model' } },
  ])[0].code, 'duplicate_input')
  assert.equal(validateCanvasGraph([texture], [], { requireInputs: true })[0].code, 'required_input_missing')
})
