import { Agent } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions'
import { addCanvasStage, buildCanvasStructure } from '../server/planner.js'
import { describeCanvasParameters, updateNodeParameters } from '../server/canvas-parameters.js'
import { systemPrompt } from '../server/deepseek.js'
import { canvasNodeTypes, canvasToolDefinition } from '../server/canvas-tools.js'

// Mirrors the contract of runDeepSeekAgent in server/deepseek.ts, but drives the
// loop with the Pi agent framework (@earendil-works/pi-*). DeepSeek is reached
// through pi-ai's openai-completions provider, so no code is DeepSeek-specific
// beyond the model descriptor.

export interface ProgressEvent {
  label: string
  status: string
}

export interface UserSelectionRequest {
  prompt: string
  options: { id: string; label: string }[]
  min: number
  max: number
}

export interface AgentPlan {
  canvas: any
  reply: string
  changedNodeIds: string[]
  structureChanged: boolean
  userSelectionRequest?: UserSelectionRequest
}

export interface RunOptions {
  apiKey: string
  baseUrl?: string
  model?: string
  message: string
  canvas: any
  onProgress?: (event: ProgressEvent) => void | Promise<void>
}

// Labels are prefixed with "Pi ·" so the UI's Thought process makes it obvious
// this run went through the Pi agent framework rather than the built-in loop.
const progressLabelByTool: Record<string, string> = {
  get_canvas_structure: 'Pi · Inspecting canvas structure',
  list_available_node_types: 'Pi · Listing available node types',
  get_canvas_parameters: 'Pi · Inspecting adjustable parameters',
  build_canvas: 'Pi · Building canvas',
  update_node_parameters: 'Pi · Updating node parameters',
  add_canvas_node: 'Pi · Adding canvas node',
  request_user_select: 'Pi · Requesting your selection',
}

const result = (text: string, details?: unknown) => ({ content: [{ type: 'text', text }], details })
const errorResult = (text: string) => ({ content: [{ type: 'text', text }], isError: true })
const toolSchema = (name: string) => Type.Unsafe(canvasToolDefinition(name)?.parameters)

// A run that is still alive: the caller holds the Pi Agent so it can inject
// steering messages mid-flight, and awaits `done` for the final plan.
export interface LiveRun {
  agent: any
  steer: (text: string) => void
  done: Promise<AgentPlan>
}

export function startPiAgent(opts: RunOptions): LiveRun {
  const model = {
    id: opts.model || 'deepseek-chat',
    name: 'DeepSeek',
    api: 'openai-completions',
    provider: 'deepseek',
    baseUrl: opts.baseUrl || 'https://api.deepseek.com',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 65536,
    maxTokens: 8192,
  }

  const session: {
    canvas: any
    changes: { nodeId: string }[]
    structureChanged: boolean
    userSelectionRequest?: UserSelectionRequest
    agent?: any
  } = { canvas: structuredClone(opts.canvas), changes: [], structureChanged: false }

  const emit = (tool: string) => opts.onProgress?.({ label: progressLabelByTool[tool] || tool, status: 'running' })
  const nodeSummary = () => session.canvas.nodes.map((node: any) => ({ id: node.id, type: node.type, name: node.name }))

  const tools = [
    {
      name: 'get_canvas_structure',
      label: 'Inspect canvas',
      description: canvasToolDefinition('get_canvas_structure')!.description,
      parameters: toolSchema('get_canvas_structure'),
      execute: async () => {
        await emit('get_canvas_structure')
        return result(JSON.stringify({ nodes: nodeSummary(), edges: session.canvas.edges }))
      },
    },
    {
      name: 'list_available_node_types',
      label: 'List node types',
      description: canvasToolDefinition('list_available_node_types')!.description,
      parameters: toolSchema('list_available_node_types'),
      execute: async () => {
        await emit('list_available_node_types')
        return result(JSON.stringify({ nodeTypes: canvasNodeTypes }))
      },
    },
    {
      name: 'build_canvas',
      label: 'Build canvas',
      description: canvasToolDefinition('build_canvas')!.description,
      parameters: toolSchema('build_canvas'),
      execute: async (_id: string, params: any) => {
        await emit('build_canvas')
        if (!Array.isArray(params.nodeTypes) || !params.nodeTypes.length || params.nodeTypes.some((type: string) => !canvasNodeTypes.includes(type))) {
          return errorResult('Invalid canvas structure requested.')
        }
        const existingNodeIds = new Set(session.canvas.nodes.map((node: any) => node.id))
        session.canvas = buildCanvasStructure(opts.message, params.nodeTypes, session.canvas)
        const addedNodes = session.canvas.nodes.filter((node: any) => !existingNodeIds.has(node.id))
        session.structureChanged = true
        for (const node of addedNodes) session.changes.push({ nodeId: node.id })
        return result(JSON.stringify({
          frameId: addedNodes.find((node: any) => node.type === 'frame')?.id,
          nodes: addedNodes.filter((node: any) => node.type !== 'frame').map((node: any) => ({ id: node.id, type: node.type, name: node.name })),
          edges: session.canvas.edges.filter((edge: any) => addedNodes.some((node: any) => node.id === edge.source.nodeId)).map((edge: any) => ({ source: edge.source.nodeId, target: edge.target.nodeId })),
        }))
      },
    },
    {
      name: 'get_canvas_parameters',
      label: 'Inspect parameters',
      description: canvasToolDefinition('get_canvas_parameters')!.description,
      parameters: toolSchema('get_canvas_parameters'),
      execute: async () => {
        await emit('get_canvas_parameters')
        return result(JSON.stringify({ nodes: nodeSummary(), parameters: describeCanvasParameters(session.canvas) }))
      },
    },
    {
      name: 'update_node_parameters',
      label: 'Update parameters',
      description: canvasToolDefinition('update_node_parameters')!.description,
      parameters: toolSchema('update_node_parameters'),
      execute: async (_id: string, params: any) => {
        await emit('update_node_parameters')
        try {
          const applied = updateNodeParameters(session.canvas, params.nodeId, params.parameters)
          session.changes.push(...applied)
          return result(JSON.stringify({ changes: applied }))
        } catch (error: any) {
          return errorResult(error.message)
        }
      },
    },
    {
      name: 'add_canvas_node',
      label: 'Add node',
      description: canvasToolDefinition('add_canvas_node')!.description,
      parameters: toolSchema('add_canvas_node'),
      execute: async (_id: string, params: any) => {
        await emit('add_canvas_node')
        try {
          const planned = addCanvasStage(session.canvas, params.type, opts.message)
          session.canvas = planned.canvas
          session.structureChanged ||= planned.structureChanged
          for (const nodeId of planned.changedNodeIds) session.changes.push({ nodeId })
          return result(JSON.stringify({ addedNodeIds: planned.changedNodeIds }))
        } catch (error: any) {
          return errorResult(error.message)
        }
      },
    },
    {
      name: 'request_user_select',
      label: 'Request selection',
      description: canvasToolDefinition('request_user_select')!.description,
      parameters: toolSchema('request_user_select'),
      execute: async (_id: string, params: any) => {
        await emit('request_user_select')
        const optionIds = new Set((params.options || []).map((option: any) => option.id))
        if (!params.prompt?.trim() || !Array.isArray(params.options) || !params.options.length || optionIds.size !== params.options.length
          || !Number.isInteger(params.min) || !Number.isInteger(params.max) || params.min < 1 || params.max < params.min || params.max > params.options.length) {
          return errorResult('Invalid user selection requested.')
        }
        session.userSelectionRequest = { prompt: params.prompt.trim(), options: params.options, min: params.min, max: params.max }
        // Stop the loop; the host will surface the request and resume with a follow-up prompt.
        session.agent?.abort()
        return result('Selection requested; pausing for the user.')
      },
    },
  ]

  const agent = new Agent({
    initialState: { systemPrompt, model, tools },
    streamFn: streamSimple as any,
    getApiKey: () => opts.apiKey,
    // Drain every queued steering message at the next turn boundary.
    steeringMode: 'all',
  })
  session.agent = agent

  let reply = ''
  let runError: string | undefined
  agent.subscribe((event: any) => {
    if (event.type === 'message_end' && event.message?.role === 'assistant') {
      const text = (event.message.content || []).filter((part: any) => part.type === 'text').map((part: any) => part.text).join('')
      if (text) reply = text
    }
    // Surface model/transport failures instead of silently returning an empty plan.
    const error = event.error || event.errorMessage || (typeof event.type === 'string' && event.type.includes('error') ? (event.message || 'agent error') : undefined)
    if (error) runError = typeof error === 'string' ? error : (error.message || JSON.stringify(error))
  })

  // Inject a user message into the running loop. Pi holds it until the current
  // assistant turn (and its tool calls) finishes, then feeds it to the model.
  const steer = (text: string) => {
    agent.steer({ role: 'user', content: [{ type: 'text', text }], timestamp: Date.now() })
  }

  const done = (async (): Promise<AgentPlan> => {
    await opts.onProgress?.({ label: 'Pi · Reviewing your request', status: 'running' })
    try {
      await agent.prompt(opts.message)
    } catch (error: any) {
      // request_user_select aborts the run on purpose; any other rejection is real.
      if (!session.userSelectionRequest) runError = runError || error?.message || 'Agent run failed'
    }

    if (runError && !session.userSelectionRequest) throw new Error(runError)

    const changedNodeIds = [...new Set(session.changes.map((change) => change.nodeId))]
    if (session.userSelectionRequest) {
      return { canvas: session.canvas, reply, changedNodeIds, structureChanged: session.structureChanged, userSelectionRequest: session.userSelectionRequest }
    }
    if (session.changes.length && session.canvas.revision === opts.canvas.revision) session.canvas.revision += 1
    if (session.changes.length) session.canvas.updatedAt = new Date().toISOString()
    return {
      canvas: session.canvas,
      reply: reply || (session.changes.length ? 'Canvas updated.' : 'No canvas changes were made. Use the canvas tools to make a change.'),
      changedNodeIds,
      structureChanged: session.structureChanged,
    }
  })()

  return { agent, steer, done }
}

// Convenience wrapper for callers that do not need to steer: start and await.
export async function runPiAgent(opts: RunOptions): Promise<AgentPlan> {
  return startPiAgent(opts).done
}
