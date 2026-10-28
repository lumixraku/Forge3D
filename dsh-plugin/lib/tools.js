// Canvas tools exposed to the DeepSeek Harness agent.
//
// Inside the harness the model is the harness's own — the app's in-canvas
// copilot (and the DeepSeek key it needs) is redundant here. These tools give
// the harness agent what the copilot could do: read the canvas, build a
// workflow, change parameters. Nothing leaves the process; every call goes
// through the same in-process backend the UI uses, so the open canvas refreshes
// through its own SSE channel.
//
// Why plain objects instead of `defineTool`: this package is `link:`-ed into a
// DSH profile, so `@deepseek-ai/dsh-tools` is not on its module resolution path
// — importing it throws ERR_MODULE_NOT_FOUND inside the host. `tool.register()`
// takes the already-compiled JSON Schema form, which is what these literals are.
import { apiJson, loadBackendForTools } from './impl.js'

/** Render a canonical value as one text block (the runtime already validated it). */
const render = (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]

async function currentCanvas(canvasId) {
  if (canvasId) return await apiJson(`/api/canvases/${encodeURIComponent(canvasId)}`)
  const rows = await apiJson('/api/projects')
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('No canvas exists yet. Ask the user to create one, or call forge3d_canvas_build with a new canvas.')
  return await apiJson(`/api/canvases/${encodeURIComponent(rows[0].id)}`)
}

/** Find a node by id, or by type when exactly one node carries it. */
function resolveNode(canvas, key) {
  const byId = canvas.nodes.find((node) => node.id === key)
  if (byId) return byId
  const matches = canvas.nodes.filter((node) => node.type === key)
  if (matches.length === 1) return matches[0]
  if (matches.length > 1) {
    throw new Error(`"${key}" matches ${matches.length} nodes (${matches.map((node) => node.id).join(', ')}); pass the node id instead.`)
  }
  throw new Error(`no node "${key}" on this canvas`)
}

/**
 * Read the canvas, let `mutate` rewrite it, and save it back.
 *
 * The canvas is shared with whatever the user has open, so a save can lose a
 * race with the UI or another agent: the server answers 409 and hands back the
 * current document. Re-read and retry rather than making the caller do it.
 */
async function mutateCanvas(canvasId, mutate) {
  let lastError = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const doc = await currentCanvas(canvasId)
    const canvas = doc.canvas ?? doc
    const next = await mutate(structuredClone(canvas))
    if (!next) return { saved: canvas, result: null }
    try {
      const saved = await apiJson(`/api/canvases/${encodeURIComponent(canvas.id)}`, {
        method: 'PUT',
        body: { baseRevision: canvas.revision, canvas: { ...canvas, ...next.canvas } },
      })
      return { saved, result: next.result ?? null }
    } catch (error) {
      lastError = error
      if (!/\(409\)/.test(String(error && error.message))) break
      await new Promise((resolve) => setTimeout(resolve, 120 * (attempt + 1)))
    }
  }
  throw lastError ?? new Error('canvas save failed')
}


function summary(doc) {
  const canvas = doc.canvas ?? doc
  return {
    id: canvas.id,
    name: canvas.name,
    revision: canvas.revision,
    nodes: (canvas.nodes ?? []).map((node) => ({
      id: node.id,
      type: node.type,
      name: node.data?.name ?? node.data?.label ?? node.type,
      config: node.data?.config ?? {},
    })),
    edges: (canvas.edges ?? []).map((edge) => ({ from: edge.source?.nodeId ?? edge.source, to: edge.target?.nodeId ?? edge.target })),
  }
}

/**
 * Register the canvas tool surface.
 * @param {any} ctx — cordis context with a `tools` service.
 */
export function registerTools(ctx) {
  const tools = [
    {
      name: 'forge3d_canvas_list',
      description:
        'List the canvases in the local Forge3D app with node counts and revisions. Call this first when you do not know which canvas the user means.',
      parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'string' }, render },
      timeoutMs: 15000,
      isConcurrencySafe: () => true,
      async execute() {
        const rows = await apiJson('/api/projects')
        return JSON.stringify(Array.isArray(rows) ? rows.map((row) => ({ id: row.id, name: row.name, nodes: row.nodeCount, revision: row.revision })) : rows)
      },
    },

    {
      name: 'forge3d_canvas_read',
      description:
        'Read one canvas: its nodes (id, type, name, config) and edges. Use it to see what the user is looking at before changing anything.',
      parameters: {
        type: 'object',
        properties: {
          canvasId: { type: 'string', description: 'Canvas id; omit for the most recent canvas.' },
        },
      },
      output: { schema: { type: 'string' }, render },
      timeoutMs: 15000,
      isConcurrencySafe: () => true,
      async execute(args) {
        return JSON.stringify(summary(await currentCanvas(args.canvasId)))
      },
    },

    {
      name: 'forge3d_node_types',
      description:
        'List every node type the canvas supports. Call this before forge3d_canvas_build so you build a workflow from real node types instead of guessing.',
      parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'string' }, render },
      timeoutMs: 15000,
      isConcurrencySafe: () => true,
      async execute() {
        const backend = await loadBackendForTools()
        const types = backend.canvasNodeTypes
        if (!Array.isArray(types)) throw new Error('node type catalog is unavailable')
        return JSON.stringify(types)
      },
    },

    {
      name: 'forge3d_describe_node',
      description:
        'Describe one node type: its parameters, their control kinds, and defaults. Use it when you need the exact parameter keys before building a canvas or changing a node.',
      parameters: {
        type: 'object',
        properties: {
          nodeType: { type: 'string', description: 'Node type id, as listed by forge3d_node_types.' },
        },
        required: ['nodeType'],
      },
      output: { schema: { type: 'string' }, render },
      timeoutMs: 15000,
      isConcurrencySafe: () => true,
      async execute(args) {
        const backend = await loadBackendForTools()
        // The catalog is derived from the canvas's own provider, so describe
        // against the canvas the user is looking at rather than a default one.
        const doc = await currentCanvas()
        const canvas = doc.canvas ?? doc
        const described = backend.describeCanvasParameters(canvas, args.nodeType)
        if (described) return described
        // A type that is supported but not on this canvas yet still has a schema:
        // describe it through a stub node instead of answering "unknown type".
        const types = backend.canvasNodeTypes
        if (!Array.isArray(types) || !types.includes(args.nodeType)) throw new Error(`unknown node type "${args.nodeType}"`)
        const stub = { provider: canvas.provider, nodes: [{ id: args.nodeType, type: args.nodeType, name: args.nodeType, config: {} }] }
        const fallback = backend.describeCanvasParameters(stub, args.nodeType)
        if (!fallback) throw new Error(`"${args.nodeType}" has no adjustable parameters`)
        return fallback
      },
    },

    {
      name: 'forge3d_canvas_build',
      description:
        'Append a workflow section to a canvas from an ordered list of node types (for example ["text-to-image","generate-model"]). Nodes are placed in a new frame and compatible ones are connected automatically. Existing content is kept.',
      parameters: {
        type: 'object',
        properties: {
          nodeTypes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Ordered node type list. Do not include frame; it is created automatically.',
          },
          canvasId: { type: 'string', description: 'Canvas id; omit for the most recent canvas.' },
          prompt: { type: 'string', description: 'The user instruction that produced this structure, used for node naming and defaults.' },
          configs: {
            type: 'object',
            additionalProperties: { type: 'object' },
            description:
              'Per-type parameter overrides applied at creation, keyed by node type — e.g. {"texture":{"textureQuality":"detailed"},"text-to-3d":{"topology":"quad","faceCount":30000}}. Unknown keys are rejected rather than silently ignored.',
          },
        },
        required: ['nodeTypes'],
      },
      output: { schema: { type: 'string' }, render },
      timeoutMs: 30000,
      async execute(args) {
        const backend = await loadBackendForTools()
        const types = Array.isArray(args.nodeTypes) ? args.nodeTypes : []
        if (types.length === 0) throw new Error('nodeTypes must contain at least one node type.')
        const { saved, result } = await mutateCanvas(args.canvasId, (canvas) => {
          const built = backend.buildCanvasStructure(String(args.prompt ?? ''), types, canvas, { configs: args.configs })
          const added = built.nodes.length - canvas.nodes.length
          return {
            canvas: { nodes: built.nodes, edges: built.edges },
            result: { addedTypes: types, addedNodes: added, nodes: built.nodes.length, edges: built.edges.length },
          }
        })
        return JSON.stringify({ canvasId: saved.id, revision: saved.revision, ...result })
      },
    },

    {
      name: 'forge3d_canvas_update',
      description:
        'Set parameters on one existing node, e.g. flip UV Texture to Model input, drop texture resolution to 2K, or change the export format. Names are the ones forge3d_describe_node reports; invalid values are rejected with the allowed range.',
      parameters: {
        type: 'object',
        properties: {
          canvasId: { type: 'string', description: 'Canvas id; omit for the most recent canvas.' },
          nodeId: { type: 'string', description: 'Node id, or its type when only one node on the canvas has that type.' },
          parameters: {
            type: 'object',
            additionalProperties: true,
            description: 'Parameter name to new value, e.g. {"textureQuality":"detailed","inputMode":"multiViewGenerate"}.',
          },
        },
        required: ['nodeId', 'parameters'],
      },
      output: { schema: { type: 'string' }, render },
      timeoutMs: 30000,
      async execute(args) {
        const backend = await loadBackendForTools()
        const parameters = args.parameters
        if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) throw new Error('parameters must be an object.')
        const { saved, result } = await mutateCanvas(args.canvasId, (canvas) => {
          const node = resolveNode(canvas, String(args.nodeId))
          const changes = backend.updateNodeParameters(canvas, node.id, parameters)
          return { canvas, result: { nodeId: node.id, nodeType: node.type, changes } }
        })
        return JSON.stringify({ canvasId: saved.id, revision: saved.revision, ...result })
      },
    },

    {
      name: 'forge3d_canvas_delete',
      description:
        'Delete one or more nodes and repair the graph around them: whatever fed a deleted stage is reconnected to what the stage fed (following through any preview slots deleted with it), and the frame is re-packed. Preview slots are reconciled by the store. Use this to drop a stage instead of leaving it bypassed in the chain.',
      parameters: {
        type: 'object',
        properties: {
          canvasId: { type: 'string', description: 'Canvas id; omit for the most recent canvas.' },
          nodeIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Node ids (or types when unique), e.g. ["retopology"].',
          },
        },
        required: ['nodeIds'],
      },
      output: { schema: { type: 'string' }, render },
      timeoutMs: 30000,
      async execute(args) {
        const backend = await loadBackendForTools()
        const keys = Array.isArray(args.nodeIds) ? args.nodeIds.filter((key) => typeof key === 'string') : []
        if (keys.length === 0) throw new Error('nodeIds must name at least one node.')
        const { saved, result } = await mutateCanvas(args.canvasId, (canvas) => {
          const ids = keys.map((key) => resolveNode(canvas, key).id)
          const removal = backend.removeCanvasNodes(canvas, ids)
          if (!removal.changed) throw new Error(`none of ${keys.join(', ')} exist on this canvas`)
          return { canvas: removal.canvas, result: { removed: removal.removed, bridged: removal.bridged } }
        })
        return JSON.stringify({ canvasId: saved.id, revision: saved.revision, ...result })
      },
    },
  ]

  const disposers = []
  for (const tool of tools) {
    disposers.push(ctx.tools.register(tool))
  }
  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}
