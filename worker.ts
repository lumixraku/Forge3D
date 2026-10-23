// Cloudflare Worker binding for the shared API (see server/api-core.ts).
// Everything runtime-specific lives here: the D1-backed store and serving the
// built assets. The route table and turn
// execution are shared with the Node dev server, so the two cannot drift apart.
//
// Tripo and the on-disk asset cache stay Node-only. Meshy is fetch-only: the
// Worker submits the task and returns, and the client's later polls collect the
// result. `waitUntil` ends 30 seconds after the response, which is shorter than
// a Meshy generation.

import { createApi } from './server/api-core.js'
import { createMeshyRunner, createMeshySubmitter, createMeshyTaskReader } from './server/meshy-run.js'
import { applyUserKeys, readUserKeys } from './server/user-keys.js'

const collections = ['canvases', 'sessions', 'runs', 'turns', 'agentTraces', 'accounts', 'creditLedger']

// One row per document in forge3d_documents (migrations/0002_documents.sql),
// the same layout as the local PostgreSQL store. A canvas's owner is stored in
// the owner_id column and handed to the core as `ownerId`.
async function readCollection(env, collection) {
  const { results } = await env.DB.prepare('SELECT document, owner_id FROM forge3d_documents WHERE collection = ?1 ORDER BY updated_at, document_id').bind(collection).all()
  return results.map((row) => {
    const document = JSON.parse(row.document)
    return collection === 'canvases' ? { ...document, ownerId: row.owner_id } : document
  })
}

async function writeCollections(env, state, names = collections) {
  const now = new Date().toISOString()
  const statements = names.flatMap((name) => [
    env.DB.prepare('DELETE FROM forge3d_documents WHERE collection = ?1').bind(name),
    ...state[name].map((document) => env.DB.prepare('INSERT INTO forge3d_documents (collection, document_id, document, owner_id, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)')
      .bind(name, document.id, JSON.stringify(document), name === 'canvases' ? document.ownerId : null, now)),
  ])
  // A D1 batch is one transaction, so a reader never sees a half-written collection.
  await env.DB.batch(statements)
}

async function loadState(env) {
  const values = await Promise.all(collections.map((name) => readCollection(env, name)))
  return Object.fromEntries(collections.map((name, index) => [name, values[index]]))
}

let initialized = false

function readWorkerReference(env) {
  return async function readLocal(reference) {
    if (!reference.startsWith('/') || reference.startsWith('//') || reference.startsWith('/api/')) {
      throw new Error(`The reference "${reference}" is not a supported image source.`)
    }
    const response = await env.ASSETS.fetch(new Request(new URL(reference, 'https://assets.local')))
    if (!response.ok) throw new Error(`The reference file ${reference} is missing.`)
    const filename = reference.split('/').pop()
    return { bytes: new Uint8Array(await response.arrayBuffer()), filename }
  }
}

const handle = createApi({
  async createContext(request, { env, ctx }) {
    const state = await loadState(env)
    const builtInConfig = {
      agentServiceUrl: env.AGENT_SERVICE_URL,
      deepseek: {
        apiKey: env.DEEPSEEK_API_KEY,
        baseUrl: env.DEEPSEEK_BASE_URL,
        model: env.DEEPSEEK_MODEL,
      },
      // Tripo still needs the local asset cache. Meshy reads public URLs, data
      // URIs, and files from the asset binding.
      createTripoProvider: null,
      createMeshyProvider: createMeshyRunner(env, { readLocal: readWorkerReference(env), pollBudgetMs: 0 }),
      getMeshyTask: createMeshyTaskReader(env),
      submitMeshyTask: createMeshySubmitter(env),
      resumeMeshyRuns: true,
      getTripoTask: null,
      readAsset: null,
      uploadAsset: null,
    }
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
        removeCanvas: async (canvasId) => {
          await env.DB.prepare('DELETE FROM forge3d_documents WHERE collection = ?1 AND document_id = ?2').bind('canvases', canvasId).run()
        },
      },
      // A visitor's own keys (from the API keys dialog) win over the Worker secrets.
      config: applyUserKeys(builtInConfig, readUserKeys(request), (apiKey) => {
        const keyed = { ...env, MESHY_API_KEY: apiKey }
        return {
          createMeshyProvider: createMeshyRunner(keyed, { readLocal: readWorkerReference(env), pollBudgetMs: 0 }),
          getMeshyTask: createMeshyTaskReader(keyed),
          submitMeshyTask: createMeshySubmitter(keyed),
        }
      }),
      builtInConfig,
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
