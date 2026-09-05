import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import pg from 'pg'
import { migrateCanvas, migrateCanvasRefs, migrateTurns } from './store.js'
import { assetContentType, assetDirectory, assetExtension, assetUrlPrefix, isAssetFileName } from './tripo-assets.js'

const { Pool } = pg
const collections = ['canvases', 'sessions', 'runs', 'turns', 'agentTraces', 'accounts', 'creditLedger']
const root = path.dirname(fileURLToPath(import.meta.url))
const seedDirectory = path.join(root, 'seed')
const migrationDirectory = path.join(root, 'migrations')

// PostgreSQL stores each domain record as JSONB. The application still owns the
// domain shape and migrations, while the database provides durable transactions,
// indexing, and multi-process visibility.
export async function createPostgresStore({ connectionString = process.env.DATABASE_URL } = {}) {
  if (!connectionString) throw new Error('DATABASE_URL is required for the PostgreSQL store')
  const pool = new Pool({ connectionString })
  const migrationFiles = (await readdir(migrationDirectory)).filter((file) => file.endsWith('.sql')).sort()
  for (const migrationFile of migrationFiles) await pool.query(await readFile(path.join(migrationDirectory, migrationFile), 'utf8'))
  await importAssets()

  const state = Object.fromEntries(await Promise.all(collections.map(async (collection) => [collection, await loadOrSeed(collection)])))
  state.canvases = state.canvases.map((canvas) => migrateCanvas(canvas))
  state.sessions = migrateCanvasRefs(state.sessions)
  state.runs = migrateCanvasRefs(state.runs)
  state.turns = migrateTurns(state.turns)
  const persistQueues = new Map()

  async function loadOrSeed(collection) {
    const result = await pool.query('SELECT document FROM forge3d_documents WHERE collection = $1 ORDER BY updated_at, document_id', [collection])
    if (result.rows.length) return result.rows.map((row) => row.document)
    const contents = await readFile(path.join(seedDirectory, `${collection}.json`), 'utf8')
    const seeded = JSON.parse(contents)
    await persistCollection(collection, seeded)
    return seeded
  }

  async function persistCollection(collection, documents) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('DELETE FROM forge3d_documents WHERE collection = $1', [collection])
      for (const document of documents) {
        await client.query(
          'INSERT INTO forge3d_documents (collection, document_id, document) VALUES ($1, $2, $3::jsonb)',
          [collection, document.id, JSON.stringify(document)],
        )
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async function persist(collection) {
    const queued = (persistQueues.get(collection) || Promise.resolve()).catch(() => {}).then(() => persistCollection(collection, state[collection]))
    persistQueues.set(collection, queued)
    await queued
  }

  async function reload(collection) {
    const result = await pool.query('SELECT document FROM forge3d_documents WHERE collection = $1 ORDER BY updated_at, document_id', [collection])
    state[collection] = result.rows.map((row) => row.document)
    return state[collection]
  }

  async function removeCanvas(canvasId) {
    await pool.query('DELETE FROM forge3d_documents WHERE collection = $1 AND document_id = $2', ['canvases', canvasId])
  }

  async function importAssets() {
    const files = (await readdir(assetDirectory).catch(() => [])).filter(isAssetFileName)
    await Promise.all(files.map(async (assetId) => {
      await pool.query(
        'INSERT INTO forge3d_assets (asset_id, content_type, bytes) VALUES ($1, $2, $3) ON CONFLICT (asset_id) DO NOTHING',
        [assetId, assetContentType(assetId), await readFile(path.join(assetDirectory, assetId))],
      )
    }))
  }

  async function uploadAsset(bytes, contentType = '', filename = '') {
    const extension = assetExtension(filename, contentType)
    const assetId = `${createHash('md5').update(bytes).digest('hex')}.${extension}`
    await pool.query(
      'INSERT INTO forge3d_assets (asset_id, content_type, bytes) VALUES ($1, $2, $3) ON CONFLICT (asset_id) DO NOTHING',
      [assetId, contentType.split(';')[0].trim() || assetContentType(assetId), bytes],
    )
    return `${assetUrlPrefix}${assetId}`
  }

  async function readAsset(assetId) {
    if (!isAssetFileName(assetId)) return null
    const result = await pool.query('SELECT content_type, bytes FROM forge3d_assets WHERE asset_id = $1', [assetId])
    if (!result.rows.length) return null
    return { bytes: result.rows[0].bytes, contentType: result.rows[0].content_type }
  }

  return { state, persist, reload, removeCanvas, uploadAsset, readAsset, close: () => pool.end() }
}

export { migrateCanvasRefs, migrateTurns }
