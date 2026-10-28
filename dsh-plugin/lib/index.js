// @forge3d/dsh-plugin — host entry.
//
// A Cordis plugin entry is an ES module, so an edited implementation would stay
// cached in the running host process until the whole app restarts. That made
// every fix cost a restart. This entry registers a stable route once and
// delegates each request to `impl.js` through a cache-busted dynamic import
// keyed by file mtime: edit the implementation, reload the page, done.
import { statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { registerTools } from './tools.js'

const IMPL_PATH = fileURLToPath(new URL('./impl.js', import.meta.url))
const ROUTE = '/forge3d'

let cache = { key: '', mod: null }

async function loadImpl() {
  let key = '0'
  try {
    key = String(statSync(IMPL_PATH).mtimeMs)
  } catch {
    /* keep the previous module if the file cannot be inspected */
  }
  if (cache.mod && cache.key === key) return cache.mod
  const mod = await import(`./impl.js?rev=${key}`)
  cache = { key, mod }
  return mod
}

export const name = 'forge3d-dsh-plugin'
export const inject = ['webServer', 'tools']

/**
 * Cordis entry: claim `/forge3d` once and delegate every request to the current
 * implementation, so host-side edits apply without restarting the app.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ dist?: string, upstream?: string, stateDir?: string }} [config]
 */
export function apply(ctx, config = {}) {
  const handler = async (req, res) => {
    let mod
    try {
      mod = await loadImpl()
    } catch (error) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`forge3d: implementation failed to load (${error && error.message})\n`)
      return
    }
    try {
      await mod.createHandler(config)(req, res)
    } catch (error) {
      if (res.headersSent) return res.destroy()
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`forge3d: ${error && error.message ? error.message : String(error)}\n`)
    }
  }
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: ROUTE, handler }))
  // The harness model drives the canvas through these; the app's own copilot
  // (and its DeepSeek key) is what they replace inside the harness.
  ctx.effect(() => registerTools(ctx))
}
