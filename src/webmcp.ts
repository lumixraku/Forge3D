// WebMCP tools for the open Forge3D page.
//
// Chrome (flag chrome://flags/#enable-webmcp-testing, or the origin trial)
// exposes `document.modelContext`. An agent attached to this tab discovers
// these tools and calls them. The handlers below only call the live page, so
// the canvas the user is looking at is the one that changes.
//
// Browsers without the API are a no-op. Nothing here is a network MCP server.

import {
  allParameters,
  canConnectNodeTypes,
  defaultCanvasProvider,
  isExecutableNodeType,
  nodeCatalog,
  nodeSchema,
  parameterRange,
  type CanvasProvider,
  type NodeParameter,
} from '@forge3d/canvas-core'

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

interface WebMcpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: {
    readOnlyHint?: boolean
    consequentialHint?: boolean
  }
  execute: (args: Record<string, unknown>) => Promise<string> | string
}

interface ModelContext {
  registerTool: (tool: WebMcpTool, options?: { signal?: AbortSignal }) => Promise<void>
}

export interface ForgePageNode {
  id: string
  type?: string
  parentNode?: string
  data?: {
    canvasType?: string
    label?: string
    config?: Record<string, unknown>
  }
}

export interface ForgePageEdge {
  source: string
  target: string
}

export interface ForgePageRun {
  id: string | null
  status: string
  entryNodeId: string | null
  mode: string
  nodeRuns?: Record<string, { status?: string; error?: string | null; progress?: number }>
}

/** The open page. Every method reads the current canvas, not a snapshot taken at registration. */
export interface ForgePage {
  canvas: () => { id?: string; name?: string; provider?: string } | null
  nodes: () => ForgePageNode[]
  edges: () => ForgePageEdge[]
  run: () => ForgePageRun | null
  busy: () => boolean
  error: () => string
  addNode: (type: string, sourceId?: string | null) => { id: string } | undefined
  /** Resolves after the page has applied the connection queued by addNode. */
  settled: () => Promise<void>
  connect: (sourceId: string, targetId: string) => boolean
  updateParameter: (id: string, key: string, value: unknown) => void
  runNode: (id: string, scope: 'node' | 'downstream') => Promise<void>
  focus: (id: string) => void
  ensureEdit: () => void
  projects: () => Array<{ id: string; name: string }>
  createProject: (name: string) => Promise<{ id: string; name: string }>
  openProject: (id: string) => Promise<void>
  renameProject: (name: string) => Promise<{ id: string; name: string }>
}

const emptySchema = { type: 'object', properties: {}, additionalProperties: false }

function modelContext(): ModelContext | undefined {
  return (document as Document & { modelContext?: ModelContext }).modelContext
}

function providerOf(page: ForgePage): CanvasProvider {
  const provider = page.canvas()?.provider
  return provider === 'mock' || provider === 'tripo' || provider === 'meshy' ? provider : defaultCanvasProvider
}

function canvasTypeOf(node: ForgePageNode) {
  return node.type === 'frame' ? 'frame' : node.data?.canvasType || node.type || 'unknown'
}

function requireCanvas(page: ForgePage) {
  const canvas = page.canvas()
  if (!canvas?.id) throw new Error('No canvas is open.')
  return canvas
}

function findNode(page: ForgePage, id: string) {
  const node = page.nodes().find((candidate) => candidate.id === id)
  if (!node) throw new Error(`No node "${id}" on this canvas. Call get_canvas for the current ids.`)
  return node
}

function nodeSummary(node: ForgePageNode) {
  if (node.type === 'frame') {
    return { id: node.id, type: 'frame', name: node.data?.label || 'Section' }
  }
  return {
    id: node.id,
    type: canvasTypeOf(node),
    name: node.data?.label || canvasTypeOf(node),
    config: node.data?.config || {},
    ...(node.parentNode ? { sectionId: node.parentNode } : {}),
  }
}

function runSummary(run: ForgePageRun | null) {
  if (!run) return { status: 'idle' }
  return {
    id: run.id,
    status: run.status,
    entryNodeId: run.entryNodeId,
    mode: run.mode,
    nodes: Object.entries(run.nodeRuns || {}).map(([id, nodeRun]) => ({
      id,
      status: nodeRun.status,
      ...(nodeRun.error ? { error: nodeRun.error } : {}),
      ...(typeof nodeRun.progress === 'number' ? { progress: nodeRun.progress } : {}),
    })),
  }
}

function creatableTypes() {
  return nodeCatalog.filter((node) => !node.hidden)
}

function describeParameter(parameter: NodeParameter, config?: Record<string, unknown>) {
  const described: Record<string, Json> = {
    key: parameter.key,
    label: parameter.label,
    control: parameter.control,
  }
  if (parameter.options?.length) {
    described.options = parameter.options.map((option) => ({
      value: option.value,
      label: option.label,
      ...(option.inputs?.length ? { inputs: option.inputs.map((input) => describeParameter(input, config)) } : {}),
    }))
  }
  const range = config ? parameterRange(parameter, config) : parameter.range
  if (range) described.range = { min: range.min, max: range.max, step: range.step }
  if (config && parameter.key in config) described.value = config[parameter.key] as Json
  return described
}

function coerceValue(parameter: NodeParameter, value: unknown) {
  if (parameter.control === 'toggle') {
    if (value === true || value === 'true') return true
    if (value === false || value === 'false') return false
    throw new Error(`"${parameter.key}" is a toggle. Pass true or false.`)
  }
  const numeric = parameter.control === 'slider' || parameter.options?.some((option) => typeof option.value === 'number')
  if (numeric && typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return value
}

function assertParameterValue(parameter: NodeParameter, value: unknown, config: Record<string, unknown>) {
  if (parameter.options?.length && !parameter.options.some((option) => option.value === value)) {
    const allowed = parameter.options.map((option) => JSON.stringify(option.value)).join(', ')
    throw new Error(`"${parameter.key}" must be one of ${allowed}.`)
  }
  const range = parameterRange(parameter, config)
  if (range && typeof value === 'number' && (value < range.min || value > range.max)) {
    throw new Error(`"${parameter.key}" must be between ${range.min} and ${range.max}.`)
  }
}

function toolsFor(page: ForgePage): WebMcpTool[] {
  const typeEnum = creatableTypes().map((node) => node.type)
  return [
    {
      name: 'list_projects',
      description: 'List the canvases that belong to this browser. Use an id from here with open_project.',
      inputSchema: emptySchema,
      annotations: { readOnlyHint: true },
      execute() {
        const openId = page.canvas()?.id || null
        return JSON.stringify(page.projects().map((project) => ({
          id: project.id,
          name: project.name,
          ...(project.id === openId ? { open: true } : {}),
        })))
      },
    },
    {
      name: 'create_project',
      description: 'Create a new canvas with the given name, save it, and open it in this tab. Does not ask the user to type the name.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name of the new canvas.' },
        },
        required: ['name'],
        additionalProperties: false,
      },
      execute: async (args) => {
        const name = typeof args.name === 'string' ? args.name.trim() : ''
        if (!name) throw new Error('name is required.')
        const created = await page.createProject(name)
        return JSON.stringify(created)
      },
    },
    {
      name: 'open_project',
      description: 'Open one existing canvas in this tab by id. Call list_projects first.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: false,
      },
      execute: async (args) => {
        const id = typeof args.id === 'string' ? args.id : ''
        if (!id) throw new Error('id is required.')
        await page.openProject(id)
        const canvas = page.canvas()
        return JSON.stringify({ id: canvas?.id, name: canvas?.name || '' })
      },
    },
    {
      name: 'rename_project',
      description: 'Rename the canvas that is open in this tab.',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
        additionalProperties: false,
      },
      execute: async (args) => {
        const name = typeof args.name === 'string' ? args.name.trim() : ''
        if (!name) throw new Error('name is required.')
        return JSON.stringify(await page.renameProject(name))
      },
    },
    {
      name: 'get_canvas',
      description: 'Read the canvas open in this tab: its nodes (id, type, name, config) and edges. Call this before changing or running anything, and use the ids it returns.',
      inputSchema: emptySchema,
      annotations: { readOnlyHint: true },
      execute() {
        const canvas = page.canvas()
        if (!canvas?.id) return JSON.stringify({ open: false })
        const nodes = page.nodes()
        return JSON.stringify({
          open: true,
          id: canvas.id,
          name: canvas.name || '',
          provider: providerOf(page),
          nodes: nodes.map(nodeSummary),
          edges: page.edges().map((edge) => ({ source: edge.source, target: edge.target })),
          run: runSummary(page.run()),
        })
      },
    },
    {
      name: 'list_node_types',
      description: 'List the node types that can be added to the canvas. Result previews are created automatically and are not listed.',
      inputSchema: emptySchema,
      annotations: { readOnlyHint: true },
      execute() {
        const provider = providerOf(page)
        return JSON.stringify(creatableTypes().map((node) => ({
          type: node.type,
          label: node.label,
          category: node.category,
          description: node.description,
          executable: Boolean(nodeSchema(node.type, provider)?.executable),
        })))
      },
    },
    {
      name: 'describe_node',
      description: 'Describe one node type: parameter keys, controls, allowed values, and ranges. Pass nodeId to include the values currently set on that node and only the parameters its current options reveal.',
      inputSchema: {
        type: 'object',
        properties: {
          nodeType: { type: 'string', description: 'Node type from list_node_types. Optional when nodeId is set.' },
          nodeId: { type: 'string', description: 'Existing node id. Its type and current config are used.' },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute(args) {
        const nodeId = typeof args.nodeId === 'string' ? args.nodeId : ''
        const node = nodeId ? findNode(page, nodeId) : null
        const nodeType = node ? canvasTypeOf(node) : typeof args.nodeType === 'string' ? args.nodeType : ''
        if (!nodeType) throw new Error('Pass nodeType or nodeId.')
        const provider = providerOf(page)
        const schema = nodeSchema(nodeType, provider)
        if (!schema) throw new Error(`Unknown node type "${nodeType}".`)
        const config = node?.data?.config || {}
        return JSON.stringify({
          type: schema.type,
          label: schema.label,
          description: schema.description,
          executable: Boolean(schema.executable),
          ...(node ? { nodeId: node.id, config } : {}),
          parameters: schema.parameters.map((parameter) => describeParameter(parameter, node ? config : undefined)),
        })
      },
    },
    {
      name: 'add_node',
      description: 'Add one node to the open canvas and scroll it into view. Pass sourceId to connect it downstream of an existing node when the two types are compatible.',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: typeEnum, description: 'Node type from list_node_types.' },
          sourceId: { type: 'string', description: 'Optional node id to connect from.' },
        },
        required: ['type'],
        additionalProperties: false,
      },
      execute: async (args) => {
        requireCanvas(page)
        const type = String(args.type || '')
        if (!typeEnum.includes(type)) throw new Error(`"${type}" cannot be added. Call list_node_types.`)
        const sourceId = typeof args.sourceId === 'string' && args.sourceId ? args.sourceId : ''
        if (sourceId) {
          const source = findNode(page, sourceId)
          if (!canConnectNodeTypes(canvasTypeOf(source), type)) {
            throw new Error(`"${canvasTypeOf(source)}" cannot connect to "${type}".`)
          }
        }
        page.ensureEdit()
        const created = page.addNode(type, sourceId || null)
        if (!created) throw new Error(`Could not add "${type}".`)
        await page.settled()
        const connected = sourceId ? page.edges().some((edge) => edge.source === sourceId && edge.target === created.id) : false
        return JSON.stringify({ id: created.id, type, ...(sourceId ? { connectedTo: sourceId, connected } : {}) })
      },
    },
    {
      name: 'connect_nodes',
      description: 'Connect the output of one existing node to the input of another, when their types are compatible.',
      inputSchema: {
        type: 'object',
        properties: {
          sourceId: { type: 'string', description: 'Node id whose output is connected.' },
          targetId: { type: 'string', description: 'Node id whose input receives it.' },
        },
        required: ['sourceId', 'targetId'],
        additionalProperties: false,
      },
      execute(args) {
        requireCanvas(page)
        const source = findNode(page, String(args.sourceId || ''))
        const target = findNode(page, String(args.targetId || ''))
        if (!canConnectNodeTypes(canvasTypeOf(source), canvasTypeOf(target))) {
          throw new Error(`"${canvasTypeOf(source)}" cannot connect to "${canvasTypeOf(target)}".`)
        }
        page.ensureEdit()
        const connected = page.connect(source.id, target.id)
        if (!connected) throw new Error(`Could not connect ${source.id} to ${target.id}. They may already be connected.`)
        return JSON.stringify({ sourceId: source.id, targetId: target.id, connected: true })
      },
    },
    {
      name: 'update_node_parameter',
      description: 'Set one parameter on an existing node. Call describe_node first and pass a key and value it lists. The canvas updates in place.',
      inputSchema: {
        type: 'object',
        properties: {
          nodeId: { type: 'string' },
          key: { type: 'string', description: 'Parameter key from describe_node.' },
          value: { oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] },
        },
        required: ['nodeId', 'key', 'value'],
        additionalProperties: false,
      },
      execute(args) {
        requireCanvas(page)
        const node = findNode(page, String(args.nodeId || ''))
        const type = canvasTypeOf(node)
        const schema = nodeSchema(type, providerOf(page))
        const parameter = allParameters(schema?.parameters).find((candidate) => candidate.key === args.key)
        if (!parameter) throw new Error(`"${type}" has no parameter "${String(args.key)}". Call describe_node.`)
        const config = node.data?.config || {}
        const value = coerceValue(parameter, args.value)
        assertParameterValue(parameter, value, config)
        page.ensureEdit()
        page.updateParameter(node.id, parameter.key, value)
        const updated = findNode(page, node.id)
        return JSON.stringify({ nodeId: node.id, key: parameter.key, value: updated.data?.config?.[parameter.key] ?? value })
      },
    },
    {
      name: 'run_node',
      description: 'Run one executable node on the open canvas. scope "node" runs that node; "downstream" also runs the nodes it feeds. This spends generation credits. The call returns once the run is queued, not when generation finishes. Poll get_canvas or get_run.',
      inputSchema: {
        type: 'object',
        properties: {
          nodeId: { type: 'string' },
          scope: { type: 'string', enum: ['node', 'downstream'], description: 'Defaults to "node".' },
        },
        required: ['nodeId'],
        additionalProperties: false,
      },
      annotations: { consequentialHint: true },
      execute: async (args) => {
        requireCanvas(page)
        if (page.busy()) throw new Error('The canvas is already starting a run.')
        const node = findNode(page, String(args.nodeId || ''))
        const type = canvasTypeOf(node)
        if (!isExecutableNodeType(type)) throw new Error(`"${node.id}" (${type}) cannot be run.`)
        const scope = args.scope === 'downstream' ? 'downstream' : 'node'
        page.ensureEdit()
        await page.runNode(node.id, scope)
        const failure = page.error()
        if (failure) throw new Error(failure)
        return JSON.stringify(runSummary(page.run()))
      },
    },
    {
      name: 'get_run',
      description: 'Read the latest run on the open canvas: status, and per-node status, progress, and error.',
      inputSchema: emptySchema,
      annotations: { readOnlyHint: true },
      execute() {
        requireCanvas(page)
        return JSON.stringify(runSummary(page.run()))
      },
    },
    {
      name: 'focus_node',
      description: 'Scroll the open canvas so one node is in view.',
      inputSchema: {
        type: 'object',
        properties: { nodeId: { type: 'string' } },
        required: ['nodeId'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute(args) {
        const node = findNode(page, String(args.nodeId || ''))
        page.focus(node.id)
        return JSON.stringify({ nodeId: node.id, focused: true })
      },
    },
  ]
}

/** Register the page tools. Returns a function that removes them. No-op when WebMCP is unavailable. */
export function registerForgeWebMcp(page: ForgePage) {
  const context = modelContext()
  if (!context) return () => {}
  const controller = new AbortController()
  const tools = toolsFor(page)
  void (async () => {
    const registered: string[] = []
    for (const tool of tools) {
      if (controller.signal.aborted) return
      try {
        await context.registerTool(tool, { signal: controller.signal })
        registered.push(tool.name)
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught)
        if (controller.signal.aborted || /duplicate/i.test(message)) continue
        console.warn(`[forge3d] WebMCP failed to register ${tool.name}`, caught)
      }
    }
    if (!controller.signal.aborted && registered.length) console.info(`[forge3d] WebMCP tools: ${registered.join(', ')}`)
  })()
  return () => controller.abort()
}
