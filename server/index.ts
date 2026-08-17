// Node binding for the shared API (see api-core.ts). Everything runtime-specific
// lives here: the http server, the IncomingMessage/ServerResponse bridge to
// Web-standard Request/Response, the file-backed store, Tripo, and local assets.

import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { createStore } from './store.js'
import { createTripoRunner, createTripoTaskReader } from './tripo-run.js'
import { persistUploadedAsset, readAsset } from './tripo-assets.js'
import { createApi } from './api-core.js'
import { listenOnAvailablePort } from './listen.js'

const port = Number(process.env.PORT || 8787)
// Set by the characterization tests so they run against a temp directory
// instead of the real server/data.
const dataDirectory = process.env.FORGE3D_DATA_DIR || undefined
// Null when TRIPO_API_KEY is unset, which keeps every node on the simulated
// producer so the demo runs without credentials.
const createTripoProvider = createTripoRunner()
const getTripoTask = createTripoTaskReader()
const store = await createStore({ dataDirectory })

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
    getTripoTask,
    readAsset,
    uploadAsset: persistUploadedAsset,
  },
  // Node keeps the process alive on its own, so a background turn or run only
  // needs its rejection swallowed.
  waitUntil: (promise) => void Promise.resolve(promise).catch(() => {}),
  recoverAgentTurns: true,
}

const configuredSseIdleTimeout = Number(process.env.SSE_IDLE_TIMEOUT_MS)
const handle = createApi({
  createContext: () => context,
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
