// Node binding for the shared API (see api-core.ts). Everything runtime-specific
// lives here: the http server, the IncomingMessage/ServerResponse bridge to
// Web-standard Request/Response, PostgreSQL, Tripo, and Meshy.

import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { createPostgresStore } from './postgres-store.js'
import { createTripoRunner, createTripoTaskReader } from './tripo-run.js'
import { createMeshyRunner, createMeshySubmitter, createMeshyTaskReader } from './meshy-run.js'
import { createMeshyLocalReader } from './meshy-local-file.js'
import { applyUserKeys, readUserKeys } from './user-keys.js'
import { persistUploadedAsset, readAsset as readAssetFromDisk } from './tripo-assets.js'
import { createApi } from './api-core.js'
import { listenOnAvailablePort } from './listen.js'

// The local runtime stores everything in PostgreSQL. A missing or unreachable
// database is the most common startup failure, so report it with the fix
// instead of a raw driver stack.
async function createRuntimeStore() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env, then start PostgreSQL with "docker compose up -d postgres".')
    process.exit(1)
  }
  try {
    return await createPostgresStore()
  } catch (error) {
    if (error?.code === 'ECONNREFUSED') {
      const { hostname, port } = new URL(process.env.DATABASE_URL)
      console.error(`Cannot reach PostgreSQL at ${hostname}:${port}. Start it with "docker compose up -d postgres".`)
      process.exit(1)
    }
    throw error
  }
}

const port = Number(process.env.PORT || 8787)
const store = await createRuntimeStore()
const readAsset = store.readAsset || readAssetFromDisk
const uploadAsset = store.uploadAsset || persistUploadedAsset
const createTripoProvider = createTripoRunner(process.env, { readAsset })
const createMeshyProvider = createMeshyRunner(process.env, { readLocal: createMeshyLocalReader(readAsset) })
const submitMeshyTask = createMeshySubmitter(process.env)
const getMeshyTask = createMeshyTaskReader(process.env)
const getTripoTask = createTripoTaskReader()

// Local dev defaults to the Pi agent service. Set AGENT_SERVICE_URL=direct to use
// the built-in DeepSeek loop instead.
const agentServiceUrl = process.env.AGENT_SERVICE_URL === 'direct'
  ? ''
  : (process.env.AGENT_SERVICE_URL || 'http://127.0.0.1:8788/agent')

const context = {
  store: {
    state: store.state,
    persist: (collections) => Promise.all(collections.map(store.persist)),
    reload: (collections) => Promise.all(collections.map(store.reload)),
    removeCanvas: store.removeCanvas,
  },
  config: {
    agentServiceUrl,
    deepseek: {
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseUrl: process.env.DEEPSEEK_BASE_URL,
      model: process.env.DEEPSEEK_MODEL,
    },
    createTripoProvider,
    createMeshyProvider,
    getMeshyTask,
    submitMeshyTask,
    getTripoTask,
    readAsset,
    uploadAsset,
  },
  // Node keeps the process alive on its own, so a background turn or run only
  // needs its rejection swallowed.
  waitUntil: (promise) => void Promise.resolve(promise).catch(() => {}),
  recoverAgentTurns: true,
}

const configuredSseIdleTimeout = Number(process.env.SSE_IDLE_TIMEOUT_MS)
const handle = createApi({
  // Same store for every request; only the config picks up a visitor's own keys.
  createContext: (request) => {
    const config = applyUserKeys(context.config, readUserKeys(request), (apiKey) => {
      const keyed = { ...process.env, MESHY_API_KEY: apiKey }
      return {
        createMeshyProvider: createMeshyRunner(keyed, { readLocal: createMeshyLocalReader(readAsset) }),
        getMeshyTask: createMeshyTaskReader(keyed),
        submitMeshyTask: createMeshySubmitter(keyed),
      }
    })
    return config === context.config ? context : { ...context, config, builtInConfig: context.config }
  },
  ...(Number.isFinite(configuredSseIdleTimeout) && configuredSseIdleTimeout > 0 ? { sseIdleTimeoutMs: configuredSseIdleTimeout } : {}),
})

async function toRequest(request) {
  const url = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`)
  const hasBody = !['GET', 'HEAD'].includes(request.method)
  let body
  if (hasBody) {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    body = chunks.length ? Buffer.concat(chunks) : undefined
  }
  const controller = new AbortController()
  // Lets the SSE route tear its channel subscription down when the client leaves.
  request.on('close', () => controller.abort())
  return new Request(url, {
    method: request.method,
    headers: Object.entries(request.headers).filter(([, value]) => value !== undefined).map(([name, value]) => [name, String(value)]),
    body,
    signal: controller.signal,
  })
}

async function writeResponse(result, response) {
  response.writeHead(result.status, Object.fromEntries(result.headers))
  if (!result.body) return response.end()
  // Streamed bodies (the SSE channel) are forwarded chunk by chunk so events
  // reach the client as they are produced rather than at the end.
  const reader = result.body.getReader()
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      response.write(value)
    }
  } catch {
    // The client went away mid-stream.
  }
  response.end()
}

const server = createServer(async (request, response) => {
  try {
    await writeResponse(await handle(await toRequest(request)), response)
  } catch (error) {
    console.error(error)
    if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify({ error: error.message }))
  }
})

const listeningPort = await listenOnAvailablePort(server, port, '127.0.0.1')
console.log(`API listening on http://127.0.0.1:${listeningPort}`)

export { server }

if (process.argv[1] !== fileURLToPath(import.meta.url)) server.close()
