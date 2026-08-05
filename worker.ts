// Cloudflare Worker binding for the shared API (see server/api-core.ts).
// Everything runtime-specific lives here: the D1-backed store, the legacy
// collection migrations, and serving the built assets. The route table and turn
// execution are shared with the Node dev server, so the two cannot drift apart.
//
// Tripo and the local asset store are Node-only, so they are passed as null and
// the shared core reports them as unavailable instead of failing on execution.

import { migrateCanvasRefs, migrateTurns } from './server/migrations.js'
import { createApi } from './server/api-core.js'

const collections = ['canvases', 'sessions', 'runs', 'turns', 'agentTraces']

async function readCollection(env, collection) {
  const value = await env.DB.prepare('SELECT value FROM app_state WHERE collection = ?1').bind(collection).first('value')
  return value ? JSON.parse(value) : []
}

async function collectionExists(env, collection) {
  return Boolean(await env.DB.prepare('SELECT 1 AS present FROM app_state WHERE collection = ?1').bind(collection).first('present'))
}

async function writeCollections(env, state, names = collections) {
  const statements = names.map((name) => env.DB.prepare('INSERT INTO app_state (collection, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(collection) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').bind(name, JSON.stringify(state[name]), new Date().toISOString()))
  await env.DB.batch(statements)
}

// The workflow -> canvas rename (263b56e) renamed these collections but shipped
// no data migration, so a database written before it still holds the rows under
// the old names. Read-only: the old row is left in place as a backup.
const renamedCollections = [['canvases', 'workflows'], ['turns', 'tasks']]

async function loadState(env) {
  const [values, hasSessions, hasThreads, present] = await Promise.all([
    Promise.all(collections.map((name) => readCollection(env, name))),
    collectionExists(env, 'sessions'),
    collectionExists(env, 'threads'),
    Promise.all(renamedCollections.map(([name]) => collectionExists(env, name))),
  ])
  const state = Object.fromEntries(collections.map((name, index) => [name, values[index]]))
  const seeded = []
  for (const [index, [name, legacyName]] of renamedCollections.entries()) {
    if (present[index]) continue
    const legacy = await readCollection(env, legacyName)
    if (!legacy.length) continue
    state[name] = legacy
    seeded.push(name)
  }
  if (seeded.length) await writeCollections(env, state, seeded)
  if (!hasSessions) {
    const legacy = hasThreads ? await readCollection(env, 'threads') : await readCollection(env, 'conversations')
    if (legacy.length) {
      state.sessions = legacy
      await writeCollections(env, state, ['sessions'])
    }
  }
  // Rows that point at a canvas still carry `workflowId` from the same rename.
  const rewritten = ['sessions', 'runs', 'turns'].filter((name) => {
    const migrated = migrateCanvasRefs(state[name])
    if (!migrated.some((record, index) => record !== state[name][index])) return false
    state[name] = migrated
    return true
  })
  if (rewritten.length) await writeCollections(env, state, rewritten)
  const migratedTurns = migrateTurns(state.turns)
  if (migratedTurns.some((turn, index) => turn !== state.turns[index])) {
    state.turns = migratedTurns
    await writeCollections(env, state, ['turns'])
  }
  return state
}

let initialized = false

const handle = createApi({
  async createContext(request, { env, ctx }) {
    const state = await loadState(env)
    const context = {
      store: {
        state,
        persist: (names) => writeCollections(env, state, names),
        // Refreshes the same state object the in-flight turn is holding, so a
        // background turn sees writes made by later requests.
        reload: async (names) => {
          const values = await Promise.all(names.map((name) => readCollection(env, name)))
          names.forEach((name, index) => {
            state[name] = values[index]
          })
        },
        // Canvases live inside the collection row, so removing one is just the
        // collection write the shared core already performs.
        removeCanvas: async () => {},
      },
      config: {
        agentServiceUrl: env.AGENT_SERVICE_URL,
        deepseek: {
          apiKey: env.DEEPSEEK_API_KEY,
          baseUrl: env.DEEPSEEK_BASE_URL,
          model: env.DEEPSEEK_MODEL,
        },
        // Node-only: the Tripo runner and the on-disk asset cache.
        createTripoProvider: null,
        getTripoTask: null,
        readAsset: null,
        uploadAsset: null,
      },
      waitUntil: (promise) => ctx.waitUntil(Promise.resolve(promise).catch(() => {})),
      recoverAgentTurns: !initialized,
    }
    initialized = true
    return context
  },
})

export default {
  async fetch(request, env, ctx) {
    // Anything outside /api is the built single-page app.
    const [first] = new URL(request.url).pathname.split('/').filter(Boolean)
    if (first !== 'api') return env.ASSETS.fetch(request)
    return handle(request, { env, ctx })
  },
}
