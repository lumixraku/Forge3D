// @forge3d/dsh-plugin — local canvas store.
//
// The canvas app talks to `/api/*`. Offline, those routes are answered here:
// every canvas is one JSON file under `<state>/canvases/`, and there is no
// visitor identity, no database, and no second process. That is the whole
// difference between "a plugin that borrows a dev server" and a local tool.
//
// Implemented: list / create / rename / delete / duplicate projects, read and
// save a canvas (with the revision guard the app already relies on), presence as
// a no-op, capabilities and account as local values, empty asset and session
// lists. Anything else answers 501 with a JSON error so the UI can degrade
// instead of hanging.
import { promises as fsp } from 'node:fs'
import path from 'node:path'

const JSON_TYPE = { 'content-type': 'application/json; charset=utf-8' }
const now = () => new Date().toISOString()

function send(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  res.writeHead(status, { ...JSON_TYPE, 'content-length': body.length, 'cache-control': 'no-store' })
  res.end(body)
}

const summary = (canvas) => ({
  id: canvas.id,
  name: canvas.name,
  description: canvas.description ?? '',
  provider: canvas.provider ?? 'meshy',
  revision: canvas.revision,
  schemaVersion: canvas.schemaVersion ?? '1.0',
  createdAt: canvas.createdAt,
  updatedAt: canvas.updatedAt,
  nodeCount: Array.isArray(canvas.nodes) ? canvas.nodes.length : 0,
  edgeCount: Array.isArray(canvas.edges) ? canvas.edges.length : 0,
  nodes: canvas.nodes ?? [],
  edges: canvas.edges ?? [],
  viewport: canvas.viewport ?? { x: 0, y: 0, zoom: 1 },
})

/**
 * Build the local API.
 * @param {string} root — directory that holds `canvases/`.
 */
export function createLocalApi(root) {
  const dir = path.join(root, 'canvases')
  const file = (id) => path.join(dir, `${id}.json`)

  async function ensureDir() {
    await fsp.mkdir(dir, { recursive: true })
  }

  async function read(id) {
    try {
      return JSON.parse(await fsp.readFile(file(id), 'utf8'))
    } catch {
      return null
    }
  }

  async function write(canvas) {
    await ensureDir()
    const tmp = file(canvas.id) + '.tmp'
    await fsp.writeFile(tmp, JSON.stringify(canvas, null, 2))
    await fsp.rename(tmp, file(canvas.id))
  }

  async function list() {
    await ensureDir()
    const names = await fsp.readdir(dir)
    const rows = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const canvas = await read(name.slice(0, -5))
      if (canvas) rows.push(summary(canvas))
    }
    return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  }

  async function create(body) {
    const id = `canvas-${globalThis.crypto.randomUUID()}`
    const stamp = now()
    const canvas = {
      schemaVersion: '1.0',
      id,
      name: body.name || 'New 3D canvas',
      description: body.description ?? '',
      provider: body.provider ?? 'meshy',
      revision: 1,
      createdAt: stamp,
      updatedAt: stamp,
      nodes: Array.isArray(body.nodes) ? body.nodes : [],
      edges: Array.isArray(body.edges) ? body.edges : [],
      viewport: body.viewport ?? { x: 0, y: 0, zoom: 1 },
    }
    await write(canvas)
    return summary(canvas)
  }

  /**
   * Route one `/api/...` request. Returns true when it owned the response.
   * @param {{ method: string, pathname: string, body: () => Promise<any>, res: import('node:http').ServerResponse }} ctx
   */
  return async function handle({ method, pathname, body, res }) {
    const parts = pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean)
    const [head, id, action] = parts

    if (head === 'capabilities' && method === 'GET') {
      return send(res, 200, { providers: { mock: true, tripo: false, meshy: true }, defaultProvider: 'meshy', tripoNodeTypes: [] }), true
    }
    if (head === 'account' && method === 'GET') {
      return send(res, 200, { id: 'local', name: 'Local', balance: 1_000_000, executionCost: 0 }), true
    }
    if (head === 'projects') {
      if (!id && method === 'GET') return send(res, 200, await list()), true
      if (!id && method === 'POST') return send(res, 201, await create(await body())), true
      if (id && action === 'duplicate' && method === 'POST') {
        const source = await read(id)
        if (!source) return send(res, 404, { error: 'Canvas not found' }), true
        const copy = { ...source, name: `${source.name} copy`, revision: 1, createdAt: now(), updatedAt: now() }
        delete copy.id
        return send(res, 201, await create(copy)), true
      }
      if (id && !action && method === 'PATCH') {
        const canvas = await read(id)
        if (!canvas) return send(res, 404, { error: 'Canvas not found' }), true
        const patch = await body()
        Object.assign(canvas, { name: patch.name ?? canvas.name, description: patch.description ?? canvas.description, updatedAt: now() })
        await write(canvas)
        return send(res, 200, summary(canvas)), true
      }
      if (id && !action && method === 'DELETE') {
        await fsp.rm(file(id), { force: true })
        res.writeHead(204)
        res.end()
        return true
      }
      return false
    }
    if (head === 'sessions' && id && action === 'chat-history' && method === 'GET') {
      const canvasId = id.replace(/^session-/, 'canvas-')
      return send(res, 200, { id, canvasId, messages: [], createdAt: now(), updatedAt: now() }), true
    }
    if (head === 'canvases') {
      if (!id) return false
      // Opening a canvas also opens its agent session; the client treats a
      // missing session as a hard failure, so an empty chat thread is served
      // locally instead of an empty list.
      if (action === 'sessions' && method === 'GET') {
        return send(res, 200, [{ id: id.replace(/^canvas-/, 'session-'), canvasId: id, title: 'Canvas copilot', createdAt: now(), updatedAt: now() }]), true
      }
      if (action === 'assets' && method === 'GET') return send(res, 200, []), true
      if (action === 'executions' && method === 'GET') return send(res, 200, []), true
      if (action === 'presence') {
        if (method === 'GET') return send(res, 200, { lease: null }), true
        if (method === 'POST') return send(res, 200, { lease: null }), true
        if (method === 'DELETE') return send(res, 204, {}), true
      }
      if (!action && method === 'GET') {
        const canvas = await read(id)
        return canvas ? (send(res, 200, { canvas }), true) : (send(res, 404, { error: 'Canvas not found' }), true)
      }
      if (!action && method === 'PUT') {
        const canvas = await read(id)
        if (!canvas) return send(res, 404, { error: 'Canvas not found' }), true
        const patch = await body()
        const base = Number(patch.baseRevision)
        // The app sends one save at a time against the revision it holds; a
        // mismatch means an older save landed late and must not overwrite.
        if (Number.isFinite(base) && base !== canvas.revision) {
          return send(res, 409, { error: 'Revision conflict', canvas }), true
        }
        const incoming = patch.canvas ?? {}
        const saved = {
          ...canvas,
          nodes: Array.isArray(incoming.nodes) ? incoming.nodes : canvas.nodes,
          edges: Array.isArray(incoming.edges) ? incoming.edges : canvas.edges,
          viewport: incoming.viewport ?? canvas.viewport,
          name: incoming.name ?? canvas.name,
          description: incoming.description ?? canvas.description,
          provider: incoming.provider ?? canvas.provider,
          revision: canvas.revision + 1,
          updatedAt: now(),
        }
        await write(saved)
        return send(res, 200, saved), true
      }
      return false
    }
    return false
  }
}
