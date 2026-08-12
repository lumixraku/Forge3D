import { access, mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeNodeConfig } from '../src/canvas-schema.js'
import { migrateCanvasRefs, migrateTurns } from './migrations.js'

// Re-exported so the store stays the single entry point for migrations even
// though they have to live in a Node-free module for the Worker.
export { migrateCanvasRefs, migrateTurns }

const root = path.dirname(fileURLToPath(import.meta.url))
const seedDirectory = path.join(root, 'seed')
export const defaultDataDirectory = path.join(root, 'data')
const collections = ['canvases', 'sessions', 'runs', 'turns', 'agentTraces', 'accounts', 'creditLedger']
const retiredNodeTypes = new Set(['save-asset'])

export function migrateCanvas(canvas, now = () => new Date().toISOString()) {
  const migrated = structuredClone(canvas)
  const retainedNodes = migrated.nodes.filter((node) => !retiredNodeTypes.has(node.type))
  const retainedNodeIds = new Set(retainedNodes.map((node) => node.id))
  let changed = retainedNodes.length !== migrated.nodes.length

  migrated.nodes = retainedNodes.map((node) => {
    if (node.type === 'split') {
      changed = true
      return { ...node, type: 'segments', name: node.name === 'Split' ? 'Segments' : node.name, config: normalizeNodeConfig('segments', node.config) }
    }
    const config = normalizeNodeConfig(node.type, node.config)
    if (JSON.stringify(config) === JSON.stringify(node.config)) return node
    changed = true
    return { ...node, config }
  })
  const retainedEdges = migrated.edges.filter((edge) => retainedNodeIds.has(edge.source.nodeId) && retainedNodeIds.has(edge.target.nodeId))
  if (retainedEdges.length !== migrated.edges.length) changed = true
  migrated.edges = retainedEdges

  const description = migrated.description
    ?.replace(/, review, save, and export/, ', and review')
    .replace(/, review (a production-ready)/, ', and review $1')
  if (description !== migrated.description) {
    migrated.description = description
    changed = true
  }
  if (!changed) return canvas
  migrated.revision = (migrated.revision || 0) + 1
  migrated.updatedAt = now()
  return migrated
}

export async function createStore({ dataDirectory = defaultDataDirectory } = {}) {
  const canvasDirectory = path.join(dataDirectory, 'canvases')
  await mkdir(dataDirectory, { recursive: true })

  for (const collection of collections.filter((name) => name !== 'canvases')) {
    const destination = path.join(dataDirectory, `${collection}.json`)
    try {
      await access(destination)
    } catch {
      let seed
      if (collection === 'sessions') {
        try {
          seed = await readFile(path.join(dataDirectory, 'threads.json'), 'utf8')
        } catch {
          try {
            seed = await readFile(path.join(dataDirectory, 'conversations.json'), 'utf8')
          } catch {
            seed = await readFile(path.join(seedDirectory, 'sessions.json'), 'utf8')
          }
        }
      } else {
        seed = await readFile(path.join(seedDirectory, `${collection}.json`), 'utf8')
      }
      await writeFile(destination, seed)
    }
  }

  await migrateCanvasFiles()
  const state = Object.fromEntries(await Promise.all(collections.map(async (collection) => {
    if (collection === 'canvases') return [collection, await readCanvasFiles()]
    const contents = await readFile(path.join(dataDirectory, `${collection}.json`), 'utf8')
    return [collection, JSON.parse(contents)]
  })))
  const persistQueues = new Map()

  async function persist(collection) {
    const queued = (persistQueues.get(collection) || Promise.resolve()).catch(() => {}).then(async () => {
      if (collection === 'canvases') {
        await persistCanvasFiles(state.canvases)
        return
      }
      const destination = path.join(dataDirectory, `${collection}.json`)
      const temporary = `${destination}.tmp`
      await writeFile(temporary, `${JSON.stringify(state[collection], null, 2)}\n`)
      await rename(temporary, destination)
    })
    persistQueues.set(collection, queued)
    return queued
  }

  async function reload(collection) {
    const value = collection === 'canvases'
      ? await readCanvasFiles()
      : JSON.parse(await readFile(path.join(dataDirectory, `${collection}.json`), 'utf8'))
    state[collection] = value
    return value
  }

  const canvases = state.canvases.map((canvas) => migrateCanvas(canvas))
  if (canvases.some((canvas, index) => canvas !== state.canvases[index])) {
    state.canvases = canvases
    await persist('canvases')
  }
  const turns = migrateTurns(state.turns)
  if (turns.some((turn, index) => turn !== state.turns[index])) {
    state.turns = turns
    await persist('turns')
  }

  /** Deletes one canvas file. Deleting is explicit so a save can never do it. */
  async function removeCanvas(canvasId) {
    await unlink(path.join(canvasDirectory, `${canvasId}.json`)).catch(() => {})
  }

  return { state, persist, reload, removeCanvas }

  async function migrateCanvasFiles() {
    let files
    try {
      files = (await readdir(canvasDirectory)).filter((file) => file.endsWith('.json'))
    } catch {
      await mkdir(canvasDirectory, { recursive: true })
      files = []
    }
    if (files.length > 0) return

    const legacy = path.join(dataDirectory, 'canvases.json')
    let canvases
    try {
      canvases = JSON.parse(await readFile(legacy, 'utf8'))
    } catch {
      canvases = JSON.parse(await readFile(path.join(seedDirectory, 'canvases.json'), 'utf8'))
    }

    await persistCanvasFiles(canvases)
  }

  async function readCanvasFiles() {
    const files = (await readdir(canvasDirectory)).filter((file) => file.endsWith('.json'))
    return Promise.all(files.map(async (file) => JSON.parse(await readFile(path.join(canvasDirectory, file), 'utf8'))))
  }

  // Writes only; a canvas file is removed by `removeCanvas`. Reaping every file
  // absent from this list would delete a canvas a second server process had just
  // created, which is how one went missing during development.
  async function persistCanvasFiles(canvases) {
    await mkdir(canvasDirectory, { recursive: true })
    await Promise.all(canvases.map(async (canvas) => {
      const destination = path.join(canvasDirectory, `${canvas.id}.json`)
      const temporary = `${destination}.tmp`
      await writeFile(temporary, `${JSON.stringify(canvas, null, 2)}\n`)
      await rename(temporary, destination)
    }))
  }
}
