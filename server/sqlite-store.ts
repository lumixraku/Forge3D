import { mkdir, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { migrateCanvas, migrateCanvasRefs, migrateTurns } from './store.js'
import { recordToValues, rowToRecord, tableColumns } from './tables.js'
import { assetContentType, assetDirectory, assetExtension, assetUrlPrefix, isAssetFileName } from './tripo-assets.js'

const collections = ['canvases', 'sessions', 'runs', 'turns', 'agentTraces', 'accounts', 'creditLedger']
// Bundled consumers (the DSH plugin) run this file from a different directory, so
// the server root it reads migrations, seed data and the default database from is
// overridable instead of being derived from the bundle's own location.
const root = process.env.FORGE3D_SERVER_DIR || path.dirname(fileURLToPath(import.meta.url))
const seedDirectory = path.join(root, 'seed')
const migrationDirectory = path.join(root, '..', 'migrations')
// Where the database lives. A consumer that owns the data (the DSH plugin) points
// this at its own directory, so removing the consumer removes the data with it.
const dataDirectory = process.env.FORGE3D_DATA_DIR || path.join(root, 'data')
const defaultFile = path.join(dataDirectory, 'forge3d.sqlite')
const LEGACY_OWNER_ID = 'demo-user'

const ASSET_TABLE = `
CREATE TABLE IF NOT EXISTS forge3d_assets (
  asset_id TEXT PRIMARY KEY,
  content_type TEXT NOT NULL,
  bytes BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
`

function selectAll(collection) {
  const { table, orderBy } = tableColumns[collection]
  return `SELECT * FROM ${table} ORDER BY ${orderBy}`
}

function insertStatement(collection) {
  const { table, columns } = tableColumns[collection]
  const placeholders = columns.map((_, index) => `?${index + 1}`).join(', ')
  return `INSERT INTO ${table} (${columns.map(([column]) => column).join(', ')}) VALUES (${placeholders})`
}

export async function createSqliteStore({ file = process.env.SQLITE_PATH || defaultFile } = {}) {
  await mkdir(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file, { timeout: 5000 })
  db.exec('PRAGMA journal_mode = WAL')
  await applyMigrations(db)
  db.exec(ASSET_TABLE)
  await importAssets(db)

  const state = Object.fromEntries(await Promise.all(collections.map(async (collection) => [collection, await loadOrSeed(db, collection)])))
  state.canvases = state.canvases.map((canvas) => migrateCanvas(canvas))
  state.sessions = migrateCanvasRefs(state.sessions)
  state.runs = migrateCanvasRefs(state.runs)
  state.turns = migrateTurns(state.turns)
  const persistQueues = new Map()

  async function loadOrSeed(database, collection) {
    const rows = database.prepare(selectAll(collection)).all()
    if (rows.length) return rows.map((row) => rowToRecord(collection, row, true))
    const contents = await readFile(path.join(seedDirectory, `${collection}.json`), 'utf8')
    let seeded = JSON.parse(contents).map((document) => (collection === 'canvases' ? { ...document, ownerId: document.ownerId || LEGACY_OWNER_ID } : document))
    if (collection === 'canvases') seeded = seeded.map((canvas) => migrateCanvas(canvas))
    if (collection === 'sessions' || collection === 'runs') seeded = migrateCanvasRefs(seeded)
    if (collection === 'turns') seeded = migrateTurns(seeded)
    persistCollection(database, collection, seeded)
    return seeded
  }

  function persistCollection(database, collection, documents) {
    const insert = database.prepare(insertStatement(collection))
    database.exec('BEGIN')
    try {
      database.prepare(`DELETE FROM ${tableColumns[collection].table}`).run()
      for (const document of documents) insert.run(...recordToValues(collection, document, { boolAsInt: true }))
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  async function persist(collection) {
    const queued = (persistQueues.get(collection) || Promise.resolve()).catch(() => {}).then(() => persistCollection(db, collection, state[collection]))
    persistQueues.set(collection, queued)
    await queued
  }

  async function reload(collection) {
    state[collection] = db.prepare(selectAll(collection)).all().map((row) => rowToRecord(collection, row, true))
    return state[collection]
  }

  async function removeCanvas(canvasId) {
    db.prepare('DELETE FROM canvases WHERE id = ?1').run(canvasId)
  }

  async function uploadAsset(bytes, contentType = '', filename = '') {
    const extension = assetExtension(filename, contentType)
    const assetId = `${createHash('md5').update(bytes).digest('hex')}.${extension}`
    db.prepare(
      'INSERT INTO forge3d_assets (asset_id, content_type, bytes) VALUES (?1, ?2, ?3) ON CONFLICT (asset_id) DO NOTHING',
    ).run(assetId, contentType.split(';')[0].trim() || assetContentType(assetId), bytes)
    return `${assetUrlPrefix}${assetId}`
  }

  async function readAsset(assetId) {
    if (!isAssetFileName(assetId)) return null
    const row = db.prepare('SELECT content_type, bytes FROM forge3d_assets WHERE asset_id = ?1').get(assetId)
    if (!row) return null
    return { bytes: row.bytes, contentType: row.content_type }
  }

  return { state, persist, reload, removeCanvas, uploadAsset, readAsset, close: () => db.close() }
}

async function applyMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS forge3d_schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `)
  const applied = new Set(db.prepare('SELECT name FROM forge3d_schema_migrations').all().map((row) => row.name))
  const files = (await readdir(migrationDirectory)).filter((file) => file.endsWith('.sql')).sort()
  const record = db.prepare('INSERT INTO forge3d_schema_migrations (name) VALUES (?1)')
  for (const file of files) {
    if (applied.has(file)) continue
    const sql = await readFile(path.join(migrationDirectory, file), 'utf8')
    db.exec('BEGIN')
    try {
      db.exec(sql)
      record.run(file)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw new Error(`SQLite migration ${file} failed: ${error.message}`)
    }
  }
}

async function importAssets(db) {
  const files = (await readdir(assetDirectory).catch(() => [])).filter(isAssetFileName)
  const insert = db.prepare(
    'INSERT INTO forge3d_assets (asset_id, content_type, bytes) VALUES (?1, ?2, ?3) ON CONFLICT (asset_id) DO NOTHING',
  )
  for (const assetId of files) {
    insert.run(assetId, assetContentType(assetId), await readFile(path.join(assetDirectory, assetId)))
  }
}
