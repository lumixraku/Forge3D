import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import pg from 'pg'
import { createPostgresStore } from './postgres-store.js'

const connectionString = process.env.TEST_DATABASE_URL

test('PostgreSQL store persists, reloads, and removes documents', { skip: !connectionString }, async () => {
  const store = await createPostgresStore({ connectionString })
  const canvasId = `canvas-test-${randomUUID()}`
  const canvas = {
    schemaVersion: '1.0',
    id: canvasId,
    name: 'PostgreSQL test',
    description: '',
    revision: 1,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  }

  try {
    store.state.canvases.push(canvas)
    await store.persist('canvases')
    store.state.canvases = []
    await store.reload('canvases')
    assert.deepEqual(store.state.canvases.find((item) => item.id === canvasId), canvas)

    await store.removeCanvas(canvasId)
    await store.reload('canvases')
    assert.equal(store.state.canvases.some((item) => item.id === canvasId), false)
  } finally {
    await store.removeCanvas(canvasId)
    await store.close()
  }
})

test('PostgreSQL store persists uploaded assets as bytes', { skip: !connectionString }, async () => {
  const store = await createPostgresStore({ connectionString })
  const pool = new pg.Pool({ connectionString })
  const bytes = Buffer.from([137, 80, 78, 71])
  let assetId

  try {
    const url = await store.uploadAsset(bytes, 'image/png', 'reference.png')
    assetId = url.slice('/api/assets/'.length)
    const asset = await store.readAsset(assetId)

    assert.match(url, /^\/api\/assets\/[a-f0-9]{32}\.png$/)
    assert.equal(asset?.contentType, 'image/png')
    assert.deepEqual(asset?.bytes, bytes)
    assert.equal(await store.readAsset('../.env'), null)
  } finally {
    if (assetId) await pool.query('DELETE FROM forge3d_assets WHERE asset_id = $1', [assetId])
    await pool.end()
    await store.close()
  }
})

test('PostgreSQL store does not write to a file data directory', { skip: !connectionString }, async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'forge3d-postgres-data-'))
  const previousDataDirectory = process.env.FORGE3D_DATA_DIR
  process.env.FORGE3D_DATA_DIR = dataDirectory
  const store = await createPostgresStore({ connectionString })

  try {
    await store.persist('accounts')
    assert.deepEqual(await readdir(dataDirectory), [])
  } finally {
    if (previousDataDirectory === undefined) delete process.env.FORGE3D_DATA_DIR
    else process.env.FORGE3D_DATA_DIR = previousDataDirectory
    await store.close()
    await rm(dataDirectory, { recursive: true, force: true })
  }
})
