import assert from 'node:assert/strict'
import test from 'node:test'
import { readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStore, migrateCanvas, migrateCanvasRefs, migrateTurns } from './store.js'

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

test('migrates legacy workflowId references to canvasId once', () => {
  const session = { id: 'session-1', workflowId: 'wf-1', messages: [] }
  const [migrated] = migrateCanvasRefs([session])

  assert.equal(migrated.canvasId, 'wf-1')
  assert.equal('workflowId' in migrated, false)
  assert.equal(migrateCanvasRefs([migrated])[0], migrated)
})

test('migrates workflowRevision alongside workflowId on a run', () => {
  const run = { id: 'run-1', workflowId: 'wf-1', workflowRevision: 3, status: 'succeeded' }
  const [migrated] = migrateCanvasRefs([run])

  assert.equal(migrated.canvasId, 'wf-1')
  assert.equal(migrated.canvasRevision, 3)
  assert.equal('workflowId' in migrated, false)
  assert.equal('workflowRevision' in migrated, false)
})

test('leaves an already migrated record untouched by identity', () => {
  const run = { id: 'run-1', canvasId: 'canvas-1', canvasRevision: 2 }
  assert.equal(migrateCanvasRefs([run])[0], run)
})

test('keeps an existing canvasId when a stale workflowId is also present', () => {
  const run = { id: 'run-1', canvasId: 'canvas-1', workflowId: 'wf-stale' }
  const [migrated] = migrateCanvasRefs([run])

  assert.equal(migrated.canvasId, 'canvas-1')
  assert.equal('workflowId' in migrated, false)
})

test('migrates legacy turn conversation fields to session fields once', () => {
  const turn = { id: 'turn-1', conversationId: 'conv-1', result: { reply: 'ok', conversation: { id: 'conv-1' } } }
  const [migrated] = migrateTurns([turn])

  assert.equal(migrated.sessionId, 'conv-1')
  assert.equal('conversationId' in migrated, false)
  assert.deepEqual(migrated.result.session, { id: 'conv-1' })
  assert.equal('conversation' in migrated.result, false)
  assert.equal(migrateTurns([migrated])[0], migrated)
})

test('migrates thread fields to session fields and restores a missing session id', () => {
  const turn = { id: 'turn-1', threadId: 'thread-1', result: { reply: 'ok', thread: { id: 'thread-1' } } }
  const [migrated] = migrateTurns([turn])

  assert.equal(migrated.sessionId, 'thread-1')
  assert.equal('threadId' in migrated, false)
  assert.deepEqual(migrated.result.session, { id: 'thread-1' })
  assert.equal('thread' in migrated.result, false)
})
