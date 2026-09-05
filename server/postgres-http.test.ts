import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { createApi } from './api-core.js'
import { createPostgresStore } from './postgres-store.js'

const connectionString = process.env.TEST_DATABASE_URL

test('HTTP project and asset mutations are persisted in PostgreSQL', { skip: !connectionString }, async () => {
  const store = await createPostgresStore({ connectionString })
  const pool = new pg.Pool({ connectionString })
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
  const request = (path, options) => api(new Request(`https://forge.test${path}`, options))

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

    const canvas = await pool.query("SELECT document->>'name' AS name, document->>'revision' AS revision, document->'nodes'->0->>'id' AS node_id, document->'nodes'->0->'config'->>'prompt' AS prompt FROM forge3d_documents WHERE collection = 'canvases' AND document_id = $1", [projectId])
    const session = await pool.query("SELECT document->>'canvasId' AS canvas_id, jsonb_array_length(document->'messages') AS message_count FROM forge3d_documents WHERE collection = 'sessions' AND document->>'canvasId' = $1", [projectId])
    const asset = await pool.query('SELECT content_type, bytes = $2::bytea AS bytes_match FROM forge3d_assets WHERE asset_id = $1', [assetId, assetBytes])
    assert.deepEqual(canvas.rows[0], { name: projectName, revision: '2', node_id: nodeId, prompt: 'after update' })
    assert.deepEqual(session.rows[0], { canvas_id: projectId, message_count: 1 })
    assert.deepEqual(asset.rows[0], { content_type: 'application/octet-stream', bytes_match: true })
  } finally {
    if (projectId) await request(`/api/projects/${projectId}`, { method: 'DELETE' })
    if (assetId) await pool.query('DELETE FROM forge3d_assets WHERE asset_id = $1', [assetId])
    await pool.query("DELETE FROM forge3d_documents WHERE document->>'name' = $1 OR document->'nodes'->0->>'id' = $2", [projectName, nodeId])
    await pool.end()
    await store.close()
  }
})
