import { Agent } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions'
import { addWorkflowStage, buildWorkflowStructure } from '../server/planner.js'
import { describeWorkflowParameters, updateNodeParameters } from '../server/workflow-parameters.js'
import { systemPrompt, workflowStageTypes } from '../server/deepseek.js'

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
  workflow: any
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
  workflow: any
  onProgress?: (event: ProgressEvent) => void | Promise<void>
}

// Labels are prefixed with "Pi ·" so the UI's Thought process makes it obvious
// this run went through the Pi agent framework rather than the built-in loop.
const progressLabelByTool: Record<string, string> = {
  get_workflow_structure: 'Pi · Inspecting workflow structure',
  get_workflow_parameters: 'Pi · Inspecting adjustable parameters',
  build_workflow: 'Pi · Building workflow',
  update_node_parameters: 'Pi · Updating node parameters',
  add_workflow_stage: 'Pi · Adding workflow stage',
  request_user_select: 'Pi · Requesting your selection',
}

const result = (text: string, details?: unknown) => ({ content: [{ type: 'text', text }], details })
const errorResult = (text: string) => ({ content: [{ type: 'text', text }], isError: true })

export async function runPiAgent(opts: RunOptions): Promise<AgentPlan> {
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
    workflow: any
    changes: { nodeId: string }[]
    structureChanged: boolean
    userSelectionRequest?: UserSelectionRequest
    agent?: any
  } = { workflow: structuredClone(opts.workflow), changes: [], structureChanged: false }

  const emit = (tool: string) => opts.onProgress?.({ label: progressLabelByTool[tool] || tool, status: 'running' })
  const nodeSummary = () => session.workflow.nodes.map((node: any) => ({ id: node.id, type: node.type, name: node.name }))

  const tools = [
    {
      name: 'get_workflow_structure',
      label: 'Inspect workflow',
      description: 'Inspect the current workflow nodes and connections, plus every stage type that can be created.',
      parameters: Type.Object({}),
      execute: async () => {
        await emit('get_workflow_structure')
        return result(JSON.stringify({ nodes: nodeSummary(), edges: session.workflow.edges, availableStageTypes: workflowStageTypes }))
      },
    },
    {
      name: 'build_workflow',
      label: 'Build workflow',
      description: 'Build or rebuild the current workflow from an ordered list of stages. All stages are placed inside one frame and compatible stages are connected automatically.',
      parameters: Type.Object({ stages: Type.Array(Type.String(), { description: 'Complete ordered stage list. Do not include frame; it is created automatically.' }) }),
      execute: async (_id: string, params: any) => {
        await emit('build_workflow')
        if (!Array.isArray(params.stages) || !params.stages.length || params.stages.some((type: string) => !workflowStageTypes.includes(type))) {
          return errorResult('Invalid workflow structure requested.')
        }
        session.workflow = buildWorkflowStructure(opts.message, params.stages, session.workflow)
        session.structureChanged = true
        for (const node of session.workflow.nodes) session.changes.push({ nodeId: node.id })
        return result(JSON.stringify({
          frameId: session.workflow.nodes.find((node: any) => node.type === 'frame')?.id,
          nodes: session.workflow.nodes.filter((node: any) => node.type !== 'frame').map((node: any) => ({ id: node.id, type: node.type, name: node.name })),
          edges: session.workflow.edges.map((edge: any) => ({ source: edge.source.nodeId, target: edge.target.nodeId })),
        }))
      },
    },
    {
      name: 'get_workflow_parameters',
      label: 'Inspect parameters',
      description: 'List current workflow nodes and their adjustable parameters, valid ranges, and options.',
      parameters: Type.Object({}),
      execute: async () => {
        await emit('get_workflow_parameters')
        return result(JSON.stringify({ nodes: nodeSummary(), parameters: describeWorkflowParameters(session.workflow) }))
      },
    },
    {
      name: 'update_node_parameters',
      label: 'Update parameters',
      description: 'Update validated parameters on one existing workflow node. Use the exact nodeId returned by get_workflow_structure; not a display name or node type.',
      parameters: Type.Object({ nodeId: Type.String(), parameters: Type.Record(Type.String(), Type.Any()) }),
      execute: async (_id: string, params: any) => {
        await emit('update_node_parameters')
        try {
          const applied = updateNodeParameters(session.workflow, params.nodeId, params.parameters)
          session.changes.push(...applied)
          return result(JSON.stringify({ changes: applied }))
        } catch (error: any) {
          return errorResult(error.message)
        }
      },
    },
    {
      name: 'add_workflow_stage',
      label: 'Add stage',
      description: 'Add one workflow node of the requested type when that node type does not already exist. Frame can also be added as a separate workflow container.',
      parameters: Type.Object({ type: Type.String() }),
      execute: async (_id: string, params: any) => {
        await emit('add_workflow_stage')
        try {
          const planned = addWorkflowStage(session.workflow, params.type, opts.message)
          session.workflow = planned.workflow
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
      description: 'Pause the task and ask the user to select one or more options before continuing.',
      parameters: Type.Object({
        prompt: Type.String(),
        options: Type.Array(Type.Object({ id: Type.String(), label: Type.String() })),
        min: Type.Integer(),
        max: Type.Integer(),
      }),
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
    return { workflow: session.workflow, reply, changedNodeIds, structureChanged: session.structureChanged, userSelectionRequest: session.userSelectionRequest }
  }
  if (session.changes.length && session.workflow.revision === opts.workflow.revision) session.workflow.revision += 1
  if (session.changes.length) session.workflow.updatedAt = new Date().toISOString()
  return {
    workflow: session.workflow,
    reply: reply || (session.changes.length ? 'Workflow updated.' : 'No workflow changes were made. Use the workflow tools to make a change.'),
    changedNodeIds,
    structureChanged: session.structureChanged,
  }
}
