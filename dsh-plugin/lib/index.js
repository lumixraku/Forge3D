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

// The tool schemas say what each call does. Nothing in them says when the canvas
// is the subject at all — the model cannot tell "the canvas" from any other tab,
// or that these tools never run anything. That is what this section is for.
const CANVAS_PROMPT = `## Forge3D canvas

The user has Forge3D open as the **Canvas** tab: a node graph that turns a prompt
or a reference image into a 3D model (text/image to 3D, UV texture, export),
executed against Meshy or Tripo. The canvas is live — anything written through the
forge3d_* tools appears in that tab without a reload.

Reach for the forge3d_* tools whenever the user is talking about that canvas: "the
canvas", "my workflow", "画布", "工作流", "这条链路", a node they can see, or any 3D
asset stage (mesh, texture, retopology, export). Do not guess node types — call
forge3d_node_types and, when parameters matter, forge3d_describe_node before
building or updating.

- Omitting canvasId means the most recently updated canvas. When the user names a
  canvas, or several exist and it is unclear which one they mean, call
  forge3d_canvas_list first.
- These tools edit the graph; they do not execute it. A run starts when the user
  clicks Run on a node, and no tool here reports execution results or assets. Never
  say a workflow was run, generated, or is generating.
- Read before writing (forge3d_canvas_read), change parameters rather than deleting
  and rebuilding, and answer in the user's language.
`

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
  // A prompt section is the plugin's introduction: without it the tools are the
  // only clue that this tab exists.
  try {
    ctx.systemPrompt.section({ name: 'forge3d:canvas', order: 3150, text: CANVAS_PROMPT })
  } catch (error) {
    console.warn('forge3d: system prompt section not registered:', error && error.message)
  }
  // The harness model drives the canvas through these; the app's own copilot
  // (and its DeepSeek key) is what they replace inside the harness.
  ctx.effect(() => registerTools(ctx))
}
