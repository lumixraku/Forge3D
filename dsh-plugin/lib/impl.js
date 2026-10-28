// @forge3d/dsh-plugin — host half.
//
// One job: own the `/forge3d` web route. The canvas itself renders natively in
// the harness page (`lib/client.js`); this route answers its `/forge3d/api`
// requests on the DSH origin, so the DSH auth cookie applies as-is.
//
// Phase 1 scope: static serving + SPA fallback + `/forge3d/api` reverse proxy,
// so an existing Forge3D server (default http://127.0.0.1:8787) can back the
// canvas while the offline port is still in progress.
import { spawn } from 'node:child_process'
import { createReadStream, openSync } from 'node:fs'
import net from 'node:net'
import { appendFileSync, copyFileSync, cpSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { promises as fsp } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createLocalApi } from './local-api.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_DIST = path.join(HERE, '..', 'dist')
const ROUTE = '/forge3d'
const STATE_DIR = process.env.FORGE3D_STATE_DIR || path.join(os.homedir(), '.dsh', 'storages', 'forge3d')
const REPO_ROOT = path.resolve(HERE, '..', '..')
const LOG_FILE = path.join(STATE_DIR, 'proxy.log')

/**
 * One stable visitor identity for this install.
 *
 * Forge3D scopes every canvas to a `forge3d_visitor` cookie. Behind the proxy
 * the browser's own cookie is fragile (it can be cleared, or kept from a
 * previous session), and losing it silently orphans everything created before.
 * Pinning the identity here makes the local tool behave like a single user.
 */
function visitorId() {
  const file = path.join(STATE_DIR, 'visitor-id')
  try {
    const existing = readFileSync(file, 'utf8').trim()
    if (/^visitor-[0-9a-f-]{36}$/.test(existing)) return existing
  } catch {
    /* no identity yet */
  }
  const created = 'visitor-' + globalThis.crypto.randomUUID()
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    writeFileSync(file, created + '\n')
  } catch {
    return 'visitor-00000000-0000-4000-8000-000000000000'
  }
  return created
}

/**
 * Force this install's visitor identity into a Cookie header, keeping every
 * other cookie. Forge3D scopes canvases to that cookie, so it must not depend on
 * whatever the browser happens to carry.
 * @param {string | undefined} cookie
 */
function pinnedCookie(cookie) {
  const others = String(cookie ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith('forge3d_visitor='))
  return [...others, `forge3d_visitor=${visitorId()}`].join('; ')
}

function log(line) {
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    appendFileSync(LOG_FILE, `${new Date().toISOString()} ${line}\n`)
  } catch {
    /* logging must never break a request */
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.map': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

// The app talks to `/api/...` as an absolute path. Inside the harness those
// requests would land on the DSH gateway, so the served document carries a tiny
// shim that moves them under our route; the route then proxies them upstream.
const API_SHIM = `<script>
(function () {
  var PREFIX = ${JSON.stringify(ROUTE)};
  function rewrite(u) {
    if (typeof u === 'string') {
      if (u.indexOf(PREFIX + '/api') === 0) return u;
      if (u.indexOf('/api/') === 0) return PREFIX + u;
      return u;
    }
    if (u && typeof u === 'object' && typeof u.url === 'string') {
      var next = rewrite(u.url);
      return next === u.url ? u : new Request(next, u);
    }
    return u;
  }
  var rawFetch = window.fetch;
  if (typeof rawFetch === 'function') {
    window.fetch = function (input, init) {
      try { input = rewrite(input); } catch (e) { /* keep the original */ }
      return rawFetch.call(this, input, init);
    };
  }
  var rawOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    try { arguments[1] = rewrite(url); } catch (e) { /* keep the original */ }
    return rawOpen.apply(this, arguments);
  };
})();
</script>`

function injectShim(html) {
  const at = html.indexOf('</head>')
  return at === -1 ? API_SHIM + html : html.slice(0, at) + API_SHIM + html.slice(at)
}

async function sendFile(res, file, req) {
  const stat = await fsp.stat(file)
  if (!stat.isFile()) throw new Error('not a file')
  res.writeHead(200, {
    'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': stat.size,
    'cache-control': 'no-cache',
    'last-modified': stat.mtime.toUTCString(),
  })
  if (req.method === 'HEAD') return res.end()
  createReadStream(file).pipe(res)
}

async function sendIndex(res, dist, req) {
  const file = path.join(dist, 'index.html')
  let html
  try {
    html = await fsp.readFile(file, 'utf8')
  } catch {
    // The harness build renders the canvas as React components inside the DSH
    // page, so it ships no standalone document. Anything that still asks for one
    // gets a plain answer instead of a stack trace.
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    return res.end('forge3d: this install renders inside the harness; no standalone page\n')
  }
  const body = Buffer.from(injectShim(html), 'utf8')
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': body.length,
    // An iframe document is what keeps a stale build alive across a host
    // restart: `no-cache` still allows a reuse with revalidation, and a restored
    // frame does not always revalidate. `no-store` forbids keeping it at all.
    'cache-control': 'no-store, must-revalidate',
  })
  if (req.method === 'HEAD') return res.end()
  res.end(body)
}

function proxy(req, res, upstream, rest, search) {
  let target
  try {
    target = new URL(upstream)
  } catch {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
    return res.end(`forge3d: invalid upstream ${JSON.stringify(upstream)}\n`)
  }
  const headers = { ...req.headers }
  delete headers.host
  delete headers.connection
  // Forge3D scopes every canvas to its `forge3d_visitor` cookie, so the proxy
  // pins one identity for the whole install instead of trusting whatever the
  // browser happens to carry. Everything else in the Cookie header is kept.
  const visitor = visitorId()
  headers.cookie = pinnedCookie(req.headers.cookie)
  const upstreamReq = http.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      method: req.method,
      path: rest + search,
      headers,
    },
    (upstreamRes) => {
      log(`${req.method} ${rest}${search} -> ${upstreamRes.statusCode ?? 502} visitor=${visitor.slice(8, 16)}`)
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers)
      upstreamRes.pipe(res)
    },
  )
  upstreamReq.on('error', (error) => {
    log(`${req.method} ${rest}${search} -> ERROR ${error.message}`)
    if (res.headersSent) return res.destroy()
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(`forge3d: upstream ${upstream} unreachable (${error.message})\n`)
  })
  req.pipe(upstreamReq)
}

// The Forge3D backend runs in this very process: `server-entry.ts` is bundled to
// `server.bundle.mjs`, keeps the original context wiring, and exposes one
// function that serves a Node request. No port, no child process, no second
// service — the plugin's own web route is the service.
const BACKEND_KEY = Symbol.for('forge3d.dsh.backend')
// The database lives with the rest of this install's state, never inside the
// package: an installed package may sit on a read-only volume, and an update
// replaces its contents wholesale. Derived from STATE_DIR and never from
// `process.env.FORGE3D_DATA_DIR`: this module is re-imported on every edit, and
// reading the env var it later sets would pin the first (legacy) path forever.
const PLUGIN_DATA = path.join(STATE_DIR, 'data')

/**
 * Where an older install of this plugin kept its data, newest convention first.
 *
 * - `STATE_DIR/data`: where it lives now.
 * - `HERE/../data`: the package-local location used before the move.
 * - `REPO_ROOT/server/data`: the checkout's server store, for a dev install.
 */
function legacyDataDirs() {
  return [path.join(HERE, '..', 'data'), path.join(REPO_ROOT, 'server', 'data')]
}

/**
 * Take an existing store along instead of starting empty. Copies once; never
 * overwrites. The database is copied with its WAL files so that a store that was
 * open when this ran still arrives consistent.
 */
function adoptExistingData() {
  try {
    mkdirSync(PLUGIN_DATA, { recursive: true })
    if (readFileSync(path.join(PLUGIN_DATA, 'forge3d.sqlite'))) return
  } catch {
    /* no database yet — a copy below may still apply */
  }
  for (const source of legacyDataDirs()) {
    const database = path.join(source, 'forge3d.sqlite')
    try {
      copyFileSync(database, path.join(PLUGIN_DATA, 'forge3d.sqlite'))
    } catch {
      continue
    }
    for (const suffix of ['-wal', '-shm']) {
      try {
        copyFileSync(database + suffix, path.join(PLUGIN_DATA, 'forge3d.sqlite') + suffix)
      } catch {
        /* a cleanly closed store has no WAL */
      }
    }
    try {
      cpSync(path.join(source, 'assets'), path.join(PLUGIN_DATA, 'assets'), { recursive: true, force: false, errorOnExist: false })
    } catch {
      /* no assets to adopt */
    }
    log(`adopted existing database from ${database}`)
    return
  }
}

export async function loadBackendForTools() {
  return await loadBackend()
}

/**
 * Call the in-process backend as this install's visitor.
 * @param {string} path — `/api/...` path.
 * @param {{ method?: string, body?: unknown }} [init]
 */
export async function apiJson(path, init = {}) {
  const backend = await loadBackend()
  if (!backend) throw new Error('forge3d backend is unavailable')
  const headers = { cookie: pinnedCookie() }
  let body
  if (init.body !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(init.body)
  }
  const response = await backend.serveRequest(new Request(`http://127.0.0.1${path}`, { method: init.method ?? 'GET', headers, body }))
  const text = await response.text()
  if (!response.ok) throw new Error(`forge3d ${init.method ?? 'GET'} ${path} failed (${response.status}): ${text.slice(0, 200)}`)
  return text ? JSON.parse(text) : null
}

async function loadBackend() {
  const file = path.join(HERE, 'server.bundle.mjs')
  let key = '0'
  try {
    key = String(statSync(file).mtimeMs)
  } catch {
    return null
  }
  const state = (globalThis[BACKEND_KEY] ??= { key: '', mod: null })
  if (state.mod && state.key === key) return state.mod
  // The plugin is its own stack: it never borrows the dev `agent:service`
  // process. `direct` runs the built-in loop inside this process, so the plugin
  // has exactly zero external services. Set FORGE3D_AGENT_SERVICE_URL to point
  // at a separate agent service instead.
  process.env.AGENT_SERVICE_URL = process.env.FORGE3D_AGENT_SERVICE_URL || 'direct'
  // The plugin owns its data: everything the backend writes (database, uploaded
  // and generated assets) lives inside the package, so removing the plugin
  // removes the data with it.
  adoptExistingData()
  // The store reads `seed/` under this root and `migrations/` one level above
  // it, so the package ships `runtime/` (root) and `migrations/` beside it —
  // the same shape the checkout has, inside the package.
  process.env.FORGE3D_SERVER_DIR = path.join(HERE, '..', 'runtime')
  process.env.FORGE3D_DATA_DIR = PLUGIN_DATA
  const mod = await import(new URL(`./server.bundle.mjs?rev=${key}`, import.meta.url).href)
  state.key = key
  state.mod = mod
  // First run on a fresh install: one starter canvas, so the list is not empty.
  if (!state.seeded && typeof mod.seedIfEmpty === 'function') {
    state.seeded = true
    try {
      if (await mod.seedIfEmpty(pinnedCookie())) log('seeded starter canvas')
    } catch (error) {
      log(`seed failed: ${error && error.message}`)
    }
  }
  return mod
}

// The plugin owns the app AND its backend: when the repository ships a server,
// the host starts it as a child process and forwards `/forge3d/api` there. That
// keeps every existing feature (canvas agent, Meshy execution, assets, sessions)
// instead of re-implementing route by route. The handle is parked on globalThis
// because this module is re-imported whenever it changes.
const SERVER_KEY = Symbol.for('forge3d.dsh.localServer')

function serverState() {
  if (!globalThis[SERVER_KEY]) {
    globalThis[SERVER_KEY] = { child: null, origin: '', port: 0, starting: null, failed: '' }
  }
  return globalThis[SERVER_KEY]
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.unref()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

async function reachable(origin) {
  try {
    const res = await fetch(`${origin}/api/capabilities`, { signal: AbortSignal.timeout(1200) })
    return res.ok
  } catch {
    return false
  }
}

async function startServer() {
  const state = serverState()
  if (state.origin && (await reachable(state.origin))) return state.origin
  if (state.starting) return state.starting
  state.starting = (async () => {
    const entry = path.join(REPO_ROOT, 'server', 'index.ts')
    try {
      await fsp.access(entry)
    } catch {
      state.failed = 'no server/index.ts in this checkout'
      return ''
    }
    const port = await freePort()
    mkdirSync(STATE_DIR, { recursive: true })
    const logFd = openSync(path.join(STATE_DIR, 'server.log'), 'a')
    const child = spawn(process.execPath, ['--env-file-if-exists=.env', '--import', 'tsx', 'server/index.ts'], {
      cwd: REPO_ROOT,
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NO_PROXY: '127.0.0.1,localhost' },
      stdio: ['ignore', logFd, logFd],
    })
    child.on('exit', (code) => {
      log(`server exited (${code})`)
      state.child = null
      state.origin = ''
    })
    state.child = child
    // Never outlive the host: a stray backend on a random port is invisible to
    // the user but would keep the SQLite file busy.
    const reap = () => { try { child.kill() } catch {} }
    process.once('exit', reap)
    const origin = `http://127.0.0.1:${port}`
    for (let i = 0; i < 80; i++) {
      if (await reachable(origin)) {
        state.origin = origin
        state.port = port
        log(`server ready on ${origin}`)
        return origin
      }
      if (child.exitCode !== null) break
      await new Promise((r) => setTimeout(r, 250))
    }
    state.failed = 'server did not become ready'
    try { child.kill() } catch {}
    state.child = null
    return ''
  })().finally(() => {
    state.starting = null
  })
  return state.starting
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * Build the `/forge3d` request handler.
 * @param {{ dist?: string, upstream?: string }} [options] — build output directory and the
 *   Forge3D server backing `/forge3d/api`; `upstream` may be empty to disable the proxy.
 */
export function createHandler(options = {}) {
  const dist = path.resolve(options.dist ?? DEFAULT_DIST)
  // Offline by default: the canvas API is answered locally. Setting `upstream`
  // forwards the routes the local store does not implement to a Forge3D server.
  const upstream = options.upstream ?? ''
  const stateDir = path.resolve(options.stateDir ?? STATE_DIR)
  const local = createLocalApi(stateDir)
  return async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const { pathname } = url
    // A path that climbed above the prefix can normalize into somebody else's
    // namespace; answer it here instead of letting it reach the SPA fallback.
    if (pathname !== ROUTE && !pathname.startsWith(ROUTE + '/')) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      return res.end('forge3d: outside route\n')
    }
    let rest = pathname.slice(ROUTE.length)
    if (rest === '') rest = '/'
    try {
      // Layout probe: the tab reports the box chain it is laid out in, so a
      // sizing bug can be read from the server instead of guessed at.
      if (rest === '/api/_debug/layout' && req.method === 'POST') {
        let body = ''
        for await (const chunk of req) body += chunk
        appendFileSync(path.join(STATE_DIR, 'layout.log'), `${new Date().toISOString()} ${body}\n`)
        res.writeHead(204, { 'cache-control': 'no-store' })
        return res.end()
      }
      if (rest === '/api' || rest.startsWith('/api/')) {
        // Visible proof that the tab reloaded (HMR or a fresh window): the app
        // asks for its canvases the moment it mounts.
        if (rest === '/api/projects' && req.method === 'GET') log('tab mounted: GET /api/projects')
        if (options.server !== 'spawn') {
          const backend = await loadBackend()
          if (backend) {
            // The backend routes on `/api/...`; the plugin owns `/forge3d/api/...`.
            req.url = rest + url.search
            req.headers.cookie = pinnedCookie(req.headers.cookie)
            return backend.handleNodeRequest(req, res)
          }
        }
        if (options.server === 'spawn') {
          const origin = await startServer()
          if (origin) return proxy(req, res, origin, rest, url.search)
        }
        const owned = await local({
          method: req.method ?? 'GET',
          pathname: rest,
          body: async () => {
            const text = await readBody(req)
            return text ? JSON.parse(text) : {}
          },
          res,
        })
        if (owned) return
        if (!upstream) {
          res.writeHead(501, { 'content-type': 'application/json; charset=utf-8' })
          return res.end(JSON.stringify({ error: `Not available offline: ${req.method} ${rest}` }))
        }
        return proxy(req, res, upstream, rest, url.search)
      }
      // Log which document and which bundle the tab actually asks for. A stale
      // iframe is otherwise invisible from this side: the server is right, the
      // browser is showing something else, and no one can tell which.
      if (rest === '/' || rest === '') log(`GET ${ROUTE}/ (index)`)
      if (/\.(js|css)$/.test(rest)) log(`GET ${ROUTE}${rest}`)
      if (rest === '/' || rest === '') return await sendIndex(res, dist, req)
      const file = path.resolve(dist, '.' + decodeURIComponent(rest))
      if (file !== dist && !file.startsWith(dist + path.sep)) {
        res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
        return res.end('forge3d: outside dist\n')
      }
      try {
        return await sendFile(res, file, req)
      } catch {
        if (path.extname(rest) === '') return await sendIndex(res, dist, req)
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        return res.end(`forge3d: not found ${rest}\n`)
      }
    } catch (error) {
      if (res.headersSent) return res.destroy()
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`forge3d: ${error && error.message ? error.message : String(error)}\n`)
    }
  }
}

/** Route prefix owned by this plugin. */
export { ROUTE }
