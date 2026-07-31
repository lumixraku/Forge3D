import assert from 'node:assert/strict'
import test from 'node:test'
import { readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStore, migrateCanvas } from './store.js'

const canvasDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'canvases')

function canvasFixture(id) {
  return { schemaVersion: '1.0', id, name: id, description: '', revision: 1, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
}

test('migrates split nodes to segments once', () => {
  const canvas = {
    revision: 1,
    updatedAt: 'before',
    nodes: [{ id: 'split', type: 'split', name: 'Split', config: {} }],
    edges: [],
  }

  const migrated = migrateCanvas(canvas, () => 'after')
  assert.deepEqual(migrated.nodes, [{ id: 'split', type: 'segments', name: 'Segments', config: { detailLevel: 'low', preview: '/shark-model.png' } }])
  assert.equal(migrated.revision, 2)
  assert.equal(migrated.updatedAt, 'after')
  assert.equal(migrateCanvas(migrated), migrated)
})

test('saving canvases never deletes one another process created', async () => {
  // A save used to reap every file absent from the saving process's own list, so
  // two servers running at once silently destroyed each other's canvases.
  const mine = `canvas-test-${'1'.repeat(8)}`
  const theirs = `canvas-test-${'2'.repeat(8)}`
  const theirFile = path.join(canvasDirectory, `${theirs}.json`)
  try {
    const { state, persist, removeCanvas } = await createStore()
    state.canvases.push(canvasFixture(mine))
    await persist('canvases')

    // Another process writes its canvas straight to disk, as the real one does.
    await writeFile(theirFile, `${JSON.stringify(canvasFixture(theirs), null, 2)}\n`)
    await persist('canvases')

    const files = await readdir(canvasDirectory)
    assert.ok(files.includes(`${theirs}.json`), 'a concurrent save must not delete another canvas')
    assert.equal(JSON.parse(await readFile(theirFile, 'utf8')).id, theirs)

    // Deleting is explicit, and removes only the one asked for.
    await removeCanvas(mine)
    const remaining = await readdir(canvasDirectory)
    assert.ok(!remaining.includes(`${mine}.json`))
    assert.ok(remaining.includes(`${theirs}.json`))
  } finally {
    await rm(theirFile, { force: true })
    await rm(path.join(canvasDirectory, `${mine}.json`), { force: true })
  }
})

test('migrates legacy model options and fills new defaults once', () => {
  const canvas = {
    revision: 1,
    updatedAt: 'before',
    nodes: [{ id: 'model', type: 'generate-model', name: 'Gen HD Model', config: { modelVersion: 'Smart Mesh', geometryQuality: 'detailed', faceType: 'Quad', faceCount: 30000 } }],
    edges: [],
  }

  const migrated = migrateCanvas(canvas, () => 'after')
  assert.equal(migrated.nodes[0].config.modelVersion, 'v3.1-20260211')
  assert.equal(migrated.nodes[0].config.geometryQuality, true)
  assert.equal(migrated.nodes[0].config.aiComplete, false)
  assert.equal(migrated.nodes[0].config.textureQuality, 'extreme')
  assert.equal(migrated.nodes[0].config.topology, 'quad')
  assert.equal(migrated.revision, 2)
  assert.equal(migrated.updatedAt, 'after')
  assert.equal(migrateCanvas(migrated), migrated)
})
