// Forge3D backend, without the HTTP server.
//
// `server/index.ts` is the same API plus a `node:http` listener. The plugin runs
// inside the DeepSeek Harness host process, so the listener is dead weight: this
// entry keeps the exact context wiring and exports one function that takes a Node
// request/response pair. No port, no child process, no second service.
import { createSqliteStore } from '../server/sqlite-store.js'
import { createTripoRunner, createTripoTaskReader } from '../server/tripo-run.js'
import { createMeshyRunner, createMeshySubmitter, createMeshyTaskReader } from '../server/meshy-run.js'
import { createMeshyLocalReader } from '../server/meshy-local-file.js'
import { applyUserKeys, readUserKeys } from '../server/user-keys.js'
import { persistUploadedAsset, readAsset as readAssetFromDisk } from '../server/tripo-assets.js'
import { createApi } from '../server/api-core.js'
import { starterCanvasGraph, starterCanvasViewport } from '@forge3d/canvas-core'

// Canvas authoring primitives the web app's own agent uses. The DSH tools reuse
// them so a canvas built by the harness is indistinguishable from one built by
// the in-app copilot.
export { buildCanvasStructure, removeCanvasNodes } from '../server/planner.js'
export { describeCanvasParameters, updateNodeParameters } from '../server/canvas-parameters.js'
export { canvasNodeTypes } from '../server/canvas-tools.js'

const store = await createSqliteStore()
const readAsset = store.readAsset || readAssetFromDisk
const uploadAsset = store.uploadAsset || persistUploadedAsset
const createTripoProvider = createTripoRunner(process.env, { readAsset })
const createMeshyProvider = createMeshyRunner(process.env, { readLocal: createMeshyLocalReader(readAsset) })
const submitMeshyTask = createMeshySubmitter(process.env)
const getMeshyTask = createMeshyTaskReader(process.env)
const getTripoTask = createTripoTaskReader()

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
  waitUntil: (promise) => void Promise.resolve(promise).catch(() => {}),
  recoverAgentTurns: true,
}

const configuredSseIdleTimeout = Number(process.env.SSE_IDLE_TIMEOUT_MS)
const handle = createApi({
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
  request.on('close', () => controller.abort())
  return new Request(url, {
    method: request.method,
    headers: Object.entries(request.headers).filter(([, value]) => value !== undefined).map(([name, value]) => [name, String(value)]),
    body,
    signal: controller.signal,
  })
}

/**
 * Give a fresh install something to look at: when this visitor owns no canvas
 * yet, create the same starter workflow a new project gets in the web app.
 * @param {string} cookie — Cookie header carrying this install's visitor id.
 * @returns {Promise<boolean>} true when a canvas was created.
 */
export async function seedIfEmpty(cookie) {
  const list = await handle(new Request('http://127.0.0.1/api/projects', { headers: { cookie } }))
  const rows = await list.json()
  if (Array.isArray(rows) && rows.length > 0) return false
  const starter = starterCanvasGraph()
  const created = await handle(new Request('http://127.0.0.1/api/projects', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'My first 3D canvas',
      description: 'A ready-to-customize 3D production canvas.',
      provider: 'meshy',
      nodes: starter.nodes,
      edges: starter.edges,
      viewport: starterCanvasViewport,
    }),
  }))
  return created.ok
}

/**
 * Serve one Node request with the in-process API.
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 */
export { handle as serveRequest }

/**
 * Serve one Node request with the in-process API.
 */
export async function handleNodeRequest(request, response) {
  try {
    const result = await handle(await toRequest(request))
    response.writeHead(result.status, Object.fromEntries(result.headers))
    if (!result.body) return response.end()
    // Streamed bodies (the SSE channel) go out chunk by chunk.
    const reader = result.body.getReader()
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        response.write(value)
      }
    } catch {
      /* client went away mid-stream */
    }
    response.end()
  } catch (error) {
    if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify({ error: error.message }))
  }
}
