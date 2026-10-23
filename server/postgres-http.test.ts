import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { createApi } from './api-core.js'
import { createPostgresStore } from './postgres-store.js'

const connectionString = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL

test('HTTP project and asset mutations are persisted in PostgreSQL', { skip: !connectionString }, async () => {
  // This test creates and deletes canvases, so it runs against a database of its
  // own: sharing the default one makes it race the other PostgreSQL tests.
  const databaseName = `forge3d_http_${randomUUID().replaceAll('-', '')}`
  const adminUrl = new URL(connectionString)
  adminUrl.pathname = '/postgres'
  const admin = new pg.Pool({ connectionString: adminUrl.toString() })
  await admin.query(`CREATE DATABASE "${databaseName}"`)
  await admin.end()
  const isolatedUrl = new URL(connectionString)
  isolatedUrl.pathname = `/${databaseName}`
  const isolatedConnection = isolatedUrl.toString()

  // A fresh database would make the store seed itself from the bundled canvas
  // file, which predates the required `provider` column. Run the migrations and
  // put one valid canvas in first so the store finds a non-empty table.
  const migrationDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')
  const bootstrap = new pg.Pool({ connectionString: isolatedConnection })
  for (const file of (await readdir(migrationDir)).filter((name) => name.endsWith('.sql')).sort()) {
    await bootstrap.query(await readFile(path.join(migrationDir, file), 'utf8'))
  }
  await bootstrap.query(
    'INSERT INTO canvases (id, owner_id, name, description, provider, schema_version, revision, nodes, edges, viewport, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12)',
    ['canvas-bootstrap', 'demo-user', 'bootstrap', '', 'mock', '1.0', 1, '[]', '[]', '{"x":0,"y":0,"zoom":1}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'],
  )
  await bootstrap.end()

  const store = await createPostgresStore({ connectionString: isolatedConnection })
  const pool = new pg.Pool({ connectionString: isolatedConnection })
  const marker = randomUUID()
  const projectName = `PostgreSQL HTTP acceptance ${marker}`
  const nodeId = `node-${marker}`
  const assetBytes = Buffer.from(`asset-${marker}`)
  let projectId
  let assetId
  const api = createApi({ createContext: async () => ({
    store: {
      state: store.state,
      persist: (collections) => Promise.all(collections.map(store.persist)),
      reload: (collections) => Promise.all(collections.map(store.reload)),
      removeCanvas: store.removeCanvas,
    },
    config: { createTripoProvider: null, createMeshyProvider: null, getTripoTask: null, readAsset: store.readAsset, uploadAsset: store.uploadAsset },
    waitUntil: (promise) => promise,
  }) })
  // One visitor for the whole test: a request without the cookie is a different,
  // empty visitor and cannot see the canvas it just created.
  const VISITOR_COOKIE = 'forge3d_visitor=visitor-11111111-1111-1111-1111-111111111111'
  const request = (path, options) => api(new Request(`https://forge.test${path}`, { ...options, headers: { ...(options?.headers || {}), cookie: VISITOR_COOKIE } }))

  try {
    const node = { id: nodeId, type: 'prompt', name: 'Acceptance Prompt', ui: { position: { x: 24, y: 48 } }, config: { prompt: 'before update' } }
    const created = await request('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: projectName, nodes: [node], edges: [] }) })
    assert.equal(created.status, 201)
    projectId = (await created.json()).id

    const loadedResponse = await request(`/api/canvases/${projectId}`)
    const loaded = await loadedResponse.json()
    const updated = { ...loaded.canvas, nodes: [{ ...loaded.canvas.nodes[0], config: { prompt: 'after update' } }] }
    const updatedResponse = await request(`/api/canvases/${projectId}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseRevision: loaded.canvas.revision, canvas: updated, clientId: 'postgres-http-test' }) })
    assert.equal(updatedResponse.status, 200)

    const uploadResponse = await request('/api/assets', { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-file-name': 'acceptance.glb' }, body: assetBytes })
    assert.equal(uploadResponse.status, 200)
    assetId = (await uploadResponse.json()).url.slice('/api/assets/'.length)
    const assetResponse = await request(`/api/assets/${assetId}`)
    assert.equal(assetResponse.status, 200)
    assert.deepEqual(Buffer.from(await assetResponse.arrayBuffer()), assetBytes)

    // Each domain has its own table now, with a column per field.
    const canvas = await pool.query("SELECT name, revision::text AS revision, nodes->0->>'id' AS node_id, nodes->0->'config'->>'prompt' AS prompt FROM canvases WHERE id = $1", [projectId])
    const session = await pool.query('SELECT canvas_id, jsonb_array_length(messages) AS message_count FROM sessions WHERE canvas_id = $1', [projectId])
    const asset = await pool.query('SELECT content_type, bytes = $2::bytea AS bytes_match FROM forge3d_assets WHERE asset_id = $1', [assetId, assetBytes])
    assert.deepEqual(canvas.rows[0], { name: projectName, revision: '2', node_id: nodeId, prompt: 'after update' })
    assert.deepEqual(session.rows[0], { canvas_id: projectId, message_count: 1 })
    assert.deepEqual(asset.rows[0], { content_type: 'application/octet-stream', bytes_match: true })
  } finally {
    if (projectId) await request(`/api/projects/${projectId}`, { method: 'DELETE' })
    if (assetId) await pool.query('DELETE FROM forge3d_assets WHERE asset_id = $1', [assetId])
    await pool.query('DELETE FROM canvases WHERE name = $1', [projectName])
    // Close every connection to this database before dropping it, or PostgreSQL
    // reports the drop as an administrator kill on a live connection.
    await pool.end()
    await store.close()
    const cleanup = new pg.Pool({ connectionString: adminUrl.toString() })
    await cleanup.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
    await cleanup.end()
  }
})
