import test from 'node:test'
import assert from 'node:assert/strict'
import { resultArtifacts } from './run-results.js'

const of = { runId: 'run-1', sourceId: 'gen' }
const origin = { ...of, sourceType: undefined }

test('splits an image batch into one result node per candidate', () => {
  const artifacts = resultArtifacts('generate-image', { previews: ['/a.png', '/b.png'], selectedPreview: '/b.png' }, of)
  assert.equal(artifacts.length, 2)
  assert.deepEqual(artifacts.map((artifact) => artifact.type), ['generated-image', 'generated-image'])
  assert.deepEqual(artifacts[0].generatedAssets, { preview: '/a.png', index: 0, resultOf: { ...origin, sourceType: 'generate-image' } })
})

test('splits a multi-view result into one image node per view', () => {
  const artifacts = resultArtifacts('generate-multiview-images', { viewPreviews: { front: '/f.png', back: '/b.png', left: '/l.png', right: '/r.png' } }, of)
  assert.equal(artifacts.length, 4)
  assert.deepEqual(artifacts.map((artifact) => artifact.generatedAssets.view), ['front', 'back', 'left', 'right'])
  assert.ok(artifacts.every((artifact) => artifact.type === 'generated-image'))
})

test('a model-producing stage yields a single model result', () => {
  const artifacts = resultArtifacts('generate-model', { preview: '/model.png', modelUrl: '/model.glb' }, of)
  assert.equal(artifacts.length, 1)
  assert.equal(artifacts[0].type, 'generated-model')
  assert.equal(artifacts[0].generatedAssets.modelUrl, '/model.glb')
})

test('an export yields one file result carrying its downloads', () => {
  const artifacts = resultArtifacts('export-model', { preview: '/model.png', modelUrl: '/model.glb', outputs: [{ downloadUrl: '/model.glb', filename: 'shark.glb' }] }, of)
  assert.equal(artifacts.length, 1)
  assert.equal(artifacts[0].type, 'generated-export')
  assert.deepEqual(artifacts[0].generatedAssets.outputs, [{ downloadUrl: '/model.glb', filename: 'shark.glb' }])
})

test('input, review, and empty outputs produce no result nodes', () => {
  assert.deepEqual(resultArtifacts('prompt', { preview: '/x.png' }, of), [])
  assert.deepEqual(resultArtifacts('review', { preview: '/x.png' }, of), [])
  assert.deepEqual(resultArtifacts('generate-image', null, of), [])
  assert.deepEqual(resultArtifacts('generate-image', {}, of), [])
  assert.equal(resultArtifacts('generate-image', {}, of, { allowEmpty: true }).length, 1)
})
