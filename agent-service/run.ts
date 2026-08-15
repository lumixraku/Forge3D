import { Agent } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
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
  executionRequests: { nodeId: string; mode: 'node' | 'downstream' }[]
  cancellationRequests: string[]
}

export interface RunOptions {
  turnId?: string
  apiKey: string
  baseUrl?: string
  model?: string
  timeoutMs?: number
  message: string
  canvas: any
  account: { id: string; name: string; balance: number; executionCost: number }
  executions?: any[]
  checkpoint?: any
  taskKind?: 'canvas' | 'general'
  onProgress?: (event: ProgressEvent) => void | Promise<void>
  onTrace?: (event: any) => void | Promise<void>
  onCheckpoint?: (checkpoint: any) => void | Promise<void>
}

export interface CoordinatedTask {
  title: string
  message: string
  kind: 'canvas' | 'general'
}

function isPrivateAddress(address: string) {
  if (address === '::1' || address === '::') return true
  if (address.startsWith('fc') || address.startsWith('fd') || address.startsWith('fe80:')) return true
  const parts = address.split('.').map(Number)
  if (parts.length !== 4) return false
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
}

async function assertPublicUrl(url: URL) {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hostname.endsWith('.local')) throw new Error('Only public HTTP and HTTPS URLs are allowed.')
  const addresses = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true })
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error('Private network URLs are not allowed.')
}

async function fetchPublicPage(input: string) {
  let url = new URL(input)
  for (let redirects = 0; redirects <= 4; redirects += 1) {
    await assertPublicUrl(url)
    const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 Forge3DAgent/1.0' }, signal: AbortSignal.timeout(15_000), redirect: 'manual' })
    if (![301, 302, 303, 307, 308].includes(response.status)) return response
    const location = response.headers.get('location')
    if (!location) return response
    url = new URL(location, url)
  }
  throw new Error('Too many redirects.')
}

export async function coordinateTasks(opts: Pick<RunOptions, 'apiKey' | 'baseUrl' | 'model' | 'message' | 'timeoutMs'>): Promise<CoordinatedTask[]> {
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
    maxTokens: 2048,
  }
  const prompt = `You are a task coordinator. Split the user's request into independent tasks that can run concurrently. Return JSON only, with this exact shape: {"tasks":[{"title":"short title","message":"self-contained worker instruction","kind":"canvas"|"general"}]}. Use kind canvas for work that reads or changes the 3D node canvas. Use kind general for analysis, writing, or research. Keep dependent work in one task. Do not create a task that waits for, combines, summarizes, reports, or verifies other tasks; the coordinator always performs the final synthesis after every worker finishes. Create at most 4 tasks.\n\nUser request:\n${opts.message}`
  const agent = new Agent({
    initialState: { systemPrompt: 'Return only valid JSON. Do not use markdown fences.', model, tools: [] },
    streamFn: ((currentModel: any, context: any, options: any) => streamSimple(currentModel, context, { ...options, timeoutMs: opts.timeoutMs || 30_000 })) as any,
    getApiKey: () => opts.apiKey,
  })
  let reply = ''
  agent.subscribe((event: any) => {
    if (event.type === 'message_end' && event.message?.role === 'assistant') {
      reply = (event.message.content || []).filter((part: any) => part.type === 'text').map((part: any) => part.text).join('')
    }
  })
  await agent.prompt(prompt)
  let parsed: any
  try {
    parsed = JSON.parse(reply.trim().replace(/^```json\s*|\s*```$/g, ''))
  } catch {
    return [{ title: opts.message.trim().slice(0, 60) || 'Canvas task', message: opts.message, kind: 'canvas' }]
  }
  if (!Array.isArray(parsed.tasks) || !parsed.tasks.length) throw new Error('Coordinator returned no tasks')
  return parsed.tasks.slice(0, 4).map((task: any, index: number) => ({
    title: typeof task.title === 'string' && task.title.trim() ? task.title.trim() : `Task ${index + 1}`,
    message: typeof task.message === 'string' && task.message.trim() ? task.message.trim() : opts.message,
    kind: task.kind === 'general' ? 'general' : 'canvas',
  }))
}

export async function summarizeTasks(opts: Pick<RunOptions, 'apiKey' | 'baseUrl' | 'model' | 'message' | 'timeoutMs'> & { results: any[] }): Promise<string> {
  const model = {
    id: opts.model || 'deepseek-chat', name: 'DeepSeek', api: 'openai-completions', provider: 'deepseek',
    baseUrl: opts.baseUrl || 'https://api.deepseek.com', reasoning: false, input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 65536, maxTokens: 4096,
  }
  const agent = new Agent({
    initialState: { systemPrompt: 'You are the coordinator. Give the user one concise final answer that combines the worker results. Mention failures clearly. Do not expose internal orchestration JSON.', model, tools: [] },
    streamFn: ((currentModel: any, context: any, options: any) => streamSimple(currentModel, context, { ...options, timeoutMs: opts.timeoutMs || 30_000 })) as any,
    getApiKey: () => opts.apiKey,
  })
  let reply = ''
  agent.subscribe((event: any) => {
    if (event.type === 'message_end' && event.message?.role === 'assistant') reply = (event.message.content || []).filter((part: any) => part.type === 'text').map((part: any) => part.text).join('')
  })
  await agent.prompt(`Original request:\n${opts.message}\n\nWorker results:\n${JSON.stringify(opts.results)}`)
  return reply || 'The requested tasks have finished.'
}

// Labels are prefixed with "Pi ·" so the UI's Thought process makes it obvious
// this run went through the Pi agent framework rather than the built-in loop.
const progressLabelByTool: Record<string, string> = {
  get_canvas_structure: 'Pi · Inspecting canvas structure',
  list_available_node_types: 'Pi · Listing available node types',
  get_credit_balance: 'Pi · Checking credit balance',
  get_canvas_parameters: 'Pi · Inspecting adjustable parameters',
  build_canvas: 'Pi · Building canvas',
  update_node_parameters: 'Pi · Updating node parameters',
  add_canvas_node: 'Pi · Adding canvas node',
  request_user_select: 'Pi · Requesting your selection',
  execute_canvas_node: 'Pi · Requesting node execution',
  list_canvas_executions: 'Pi · Listing canvas tasks',
  get_execution_status: 'Pi · Checking task progress',
  cancel_execution: 'Pi · Requesting task cancellation',
}

const result = (text: string, details?: unknown) => ({ content: [{ type: 'text', text }], details })
const errorResult = (text: string) => ({ content: [{ type: 'text', text }], isError: true })
const toolSchema = (name: string) => Type.Unsafe(canvasToolDefinition(name)?.parameters)

// A run that is still alive: the caller holds the Pi Agent so it can inject
// steering messages mid-flight, and awaits `done` for the final plan.
export interface LiveRun {
  agent: any
  steer: (text: string) => void
  abort: () => void
  done: Promise<AgentPlan>
}

export function startPiAgent(opts: RunOptions): LiveRun {
  const timeoutMs = opts.timeoutMs || 120_000
  const runLabel = opts.turnId || 'unknown-turn'
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
    executionRequests: { nodeId: string; mode: 'node' | 'downstream' }[]
    cancellationRequests: string[]
    agent?: any
    webToolCalls: number
  } = {
    canvas: structuredClone(opts.checkpoint?.canvas || opts.canvas),
    changes: structuredClone(opts.checkpoint?.changes || []),
    structureChanged: Boolean(opts.checkpoint?.structureChanged),
    executionRequests: structuredClone(opts.checkpoint?.executionRequests || []),
    cancellationRequests: structuredClone(opts.checkpoint?.cancellationRequests || []),
    webToolCalls: 0,
  }

  const emit = (tool: string) => opts.onProgress?.({ label: progressLabelByTool[tool] || tool, status: 'running' })
  const nodeSummary = () => session.canvas.nodes.map((node: any) => ({ id: node.id, type: node.type, name: node.name }))

  const toolImplementations = [
    {
      name: 'web_search',
      label: 'Search the web',
      description: 'Search the public web for current information. Returns result titles, URLs, and snippets.',
      parameters: Type.Object({ query: Type.String({ minLength: 1 }) }),
      execute: async (_id: string, params: any) => {
        if (session.webToolCalls >= 1) {
          session.agent?.steer({ role: 'user', content: [{ type: 'text', text: 'Stop calling tools now. Write the final answer from the evidence already collected, including source URLs.' }], timestamp: Date.now() })
          return errorResult('Web research budget reached. Write the final answer now.')
        }
        session.webToolCalls += 1
        await emit('web_search')
        const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(params.query)}`, { headers: { 'user-agent': 'Mozilla/5.0 Forge3DAgent/1.0' } })
        if (!response.ok) return errorResult(`Web search failed with status ${response.status}.`)
        const html = await response.text()
        const results = [...html.matchAll(/class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)].slice(0, 8).map((match) => ({
          url: match[1].replace(/&amp;/g, '&'),
          title: match[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&'),
          snippet: match[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().replace(/&amp;/g, '&'),
        }))
        session.agent?.steer({ role: 'user', content: [{ type: 'text', text: 'You have enough evidence. Stop calling tools and write the final answer now, including source URLs.' }], timestamp: Date.now() })
        return result(JSON.stringify({ results }))
      },
    },
    {
      name: 'fetch_web_page',
      label: 'Read web page',
      description: 'Fetch and read a public HTTP or HTTPS page by URL.',
      parameters: Type.Object({ url: Type.String({ minLength: 1 }) }),
      execute: async (_id: string, params: any) => {
        if (session.webToolCalls >= 1) {
          session.agent?.steer({ role: 'user', content: [{ type: 'text', text: 'Stop calling tools now. Write the final answer from the evidence already collected, including source URLs.' }], timestamp: Date.now() })
          return errorResult('Web research budget reached. Write the final answer now.')
        }
        session.webToolCalls += 1
        await emit('fetch_web_page')
        let response: Response
        try {
          response = await fetchPublicPage(params.url)
        } catch (error: any) {
          return errorResult(error.message)
        }
        if (!response.ok) return errorResult(`Page fetch failed with status ${response.status}.`)
        const text = (await response.text()).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        session.agent?.steer({ role: 'user', content: [{ type: 'text', text: 'You have enough evidence. Stop calling tools and write the final answer now, including source URLs.' }], timestamp: Date.now() })
        return result(JSON.stringify({ url: response.url, text: text.slice(0, 8_000) }))
      },
    },
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
      name: 'get_credit_balance',
      label: 'Check credits',
      description: canvasToolDefinition('get_credit_balance')!.description,
      parameters: toolSchema('get_credit_balance'),
      execute: async () => {
        await emit('get_credit_balance')
        return result(JSON.stringify(opts.account))
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
    {
      name: 'execute_canvas_node',
      label: 'Execute node',
      description: canvasToolDefinition('execute_canvas_node')!.description,
      parameters: toolSchema('execute_canvas_node'),
      execute: async (_id: string, params: any) => {
        await emit('execute_canvas_node')
        const node = session.canvas.nodes.find((candidate: any) => candidate.id === params.nodeId)
        if (!node || !['node', 'downstream'].includes(params.mode)) return errorResult('Invalid node execution requested.')
        const request = { nodeId: node.id, mode: params.mode }
        session.executionRequests.push(request)
        return result(JSON.stringify({ accepted: true, ...request, cost: opts.account.executionCost, background: true }))
      },
    },
    {
      name: 'list_canvas_executions',
      label: 'List canvas tasks',
      description: canvasToolDefinition('list_canvas_executions')!.description,
      parameters: toolSchema('list_canvas_executions'),
      execute: async () => {
        await emit('list_canvas_executions')
        return result(JSON.stringify({ executions: opts.executions || [] }))
      },
    },
    {
      name: 'get_execution_status',
      label: 'Check task progress',
      description: canvasToolDefinition('get_execution_status')!.description,
      parameters: toolSchema('get_execution_status'),
      execute: async (_id: string, params: any) => {
        await emit('get_execution_status')
        const execution = (opts.executions || []).find((candidate: any) => candidate.id === params.executionId)
        return execution ? result(JSON.stringify(execution)) : errorResult('Execution not found on the current canvas.')
      },
    },
    {
      name: 'cancel_execution',
      label: 'Cancel task',
      description: canvasToolDefinition('cancel_execution')!.description,
      parameters: toolSchema('cancel_execution'),
      execute: async (_id: string, params: any) => {
        await emit('cancel_execution')
        const execution = (opts.executions || []).find((candidate: any) => candidate.id === params.executionId)
        if (!execution) return errorResult('Execution not found on the current canvas.')
        session.cancellationRequests.push(execution.id)
        return result(JSON.stringify({ accepted: true, executionId: execution.id, status: execution.status }))
      },
    },
  ]

  const enabledTools = opts.taskKind === 'general'
    ? toolImplementations.filter((tool) => ['web_search', 'fetch_web_page', 'get_canvas_structure', 'get_canvas_parameters', 'list_canvas_executions', 'get_execution_status'].includes(tool.name))
    : toolImplementations.filter((tool) => !['web_search', 'fetch_web_page'].includes(tool.name))
  const tools = enabledTools.map((tool) => ({
    ...tool,
    execute: async (...args: any[]) => {
      const startedAt = Date.now()
      await opts.onTrace?.({ type: 'tool_call_started', payload: { toolCallId: args[0], toolName: tool.name, arguments: args[1] } })
      try {
        const output = await tool.execute(...args)
        await opts.onTrace?.({ type: output?.isError ? 'tool_call_failed' : 'tool_call_succeeded', payload: { toolCallId: args[0], toolName: tool.name, durationMs: Date.now() - startedAt, result: output } })
        return output
      } catch (error: any) {
        await opts.onTrace?.({ type: 'tool_call_failed', payload: { toolCallId: args[0], toolName: tool.name, durationMs: Date.now() - startedAt, error: { name: error?.name || 'Error', message: error?.message || String(error) } } })
        throw error
      }
    },
  }))

  const workerPrompt = opts.taskKind === 'general'
    ? 'You are an independent research and analysis worker. Complete only the assigned task and report a concise answer in the user\'s language. Canvas tools are read-only context; never claim to modify the canvas. Use at most 1 web tool call. If the instruction gives an authoritative URL, fetch it directly. Otherwise, search once and answer from the returned snippets. After that single call, stop using tools and answer with concrete findings and source URLs.'
    : systemPrompt
  const agent = new Agent({
    initialState: { systemPrompt: workerPrompt, model, tools },
    streamFn: ((model: any, context: any, options: any) => streamSimple(model, context, { ...options, timeoutMs })) as any,
    getApiKey: () => opts.apiKey,
    // Drain every queued steering message at the next turn boundary.
    steeringMode: 'all',
  })
  session.agent = agent

  let reply = ''
  let runError: string | undefined
  let cancelled = false
  let timedOut = false
  agent.subscribe((event: any) => {
    void opts.onTrace?.({ type: 'agent_event', payload: { type: event.type, message: event.type === 'message_end' ? event.message : undefined } })
    if (event.type === 'message_end' && event.message?.role === 'assistant') {
      const text = (event.message.content || []).filter((part: any) => part.type === 'text').map((part: any) => part.text).join('')
      if (text) reply = text
      if (event.message.errorMessage) runError = event.message.errorMessage
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

  const abort = () => {
    cancelled = true
    agent.abort()
  }

  const done = (async (): Promise<AgentPlan> => {
    await opts.onProgress?.({ label: 'Pi · Reviewing your request', status: 'running' })
    const timeout = setTimeout(() => {
      timedOut = true
      agent.abort()
    }, timeoutMs)
    await opts.onTrace?.({ type: 'model_request_started', payload: { model: model.id } })
    try {
      const resumeContext = opts.checkpoint?.phase === 'tool_complete'
        ? `Resume an interrupted run. The already applied canvas changes are listed below. Do not repeat them; continue from the current canvas state.\n${JSON.stringify(opts.checkpoint.changes || [])}\n\nOriginal request: ${opts.message}`
        : opts.message
      await agent.prompt(resumeContext)
    } catch (error: any) {
      // request_user_select aborts the run on purpose; any other rejection is real.
      if (!session.userSelectionRequest && !cancelled) runError = runError || error?.message || 'Agent run failed'
    } finally {
      clearTimeout(timeout)
    }

    if (timedOut) throw new Error(`Agent run timed out after ${Math.round(timeoutMs / 1000)}s`)
    if (cancelled) {
      const error = new Error('Agent run cancelled')
      error.name = 'AbortError'
      throw error
    }
    if (runError && !session.userSelectionRequest) throw new Error(runError)

    const changedNodeIds = [...new Set(session.changes.map((change) => change.nodeId))]
    await opts.onCheckpoint?.({ phase: session.userSelectionRequest ? 'waiting_for_user' : 'complete', canvas: session.canvas, changes: session.changes, structureChanged: session.structureChanged, executionRequests: session.executionRequests, cancellationRequests: session.cancellationRequests })
    if (session.userSelectionRequest) {
      return { canvas: session.canvas, reply, changedNodeIds, structureChanged: session.structureChanged, userSelectionRequest: session.userSelectionRequest }
    }
    if (session.changes.length && session.canvas.revision === opts.canvas.revision) session.canvas.revision += 1
    if (session.changes.length) session.canvas.updatedAt = new Date().toISOString()
    return {
      canvas: session.canvas,
      reply: reply || (session.changes.length ? 'Canvas updated.' : 'Task completed without canvas changes.'),
      changedNodeIds,
      structureChanged: session.structureChanged,
      executionRequests: session.executionRequests,
      cancellationRequests: session.cancellationRequests,
    }
  })()

  return { agent, steer, abort, done }
}

// Convenience wrapper for callers that do not need to steer: start and await.
export async function runPiAgent(opts: RunOptions): Promise<AgentPlan> {
  return startPiAgent(opts).done
}
