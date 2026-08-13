import { describeCanvasParameters, updateNodeParameters } from './canvas-parameters.js'
import { addCanvasStage, buildCanvasStructure, planCanvas } from './planner.js'
import { canvasNodeTypes, canvasToolDefinitions } from './canvas-tools.js'

// Every selectable node type, with what it does and the media it consumes/produces.
// This is what lets the model match each node to the media it consumes.
const nodeCatalogRows = [
  ['reference-image', 'Upload or reference a single source image.', 'none', 'image'],
  ['prompt', 'A text description / creative direction.', 'none', 'text'],
  ['generate-image', 'Generate concept image candidates from a reference image and/or text.', 'image, text', 'image(s)'],
  ['generate-multiview-images', 'Generate several views (front/back/left/right) of the SAME subject from one reference image and/or text.', 'image, text', 'multiple view images'],
  ['generate-model', 'Reconstruct a 3D model from text, one image, or multiple images. It automatically detects how many images the upstream stage outputs.', 'image(s), text', '3D model'],
  ['smart-mesh', 'Generate a mesh directly from a single image and/or text.', 'image, text', '3D model'],
  ['text-to-3d', 'Reconstruct a 3D model from text only.', 'text', '3D model'],
  ['review', 'Manual checkpoint to approve an image before continuing.', 'image', 'image'],
  ['retopology', 'Optimize / clean up model geometry.', '3D model', '3D model'],
  ['texture', 'Generate UV textures for a model (optionally guided by an image or text).', '3D model (+ optional image/text)', '3D model'],
  ['rigging', 'Add a skeleton / rig to a model.', '3D model', '3D model'],
  ['segments', 'Segment a model into separate parts.', '3D model', '3D model'],
  ['model-preview', 'Interactive 3D preview of the result.', '3D model', '3D model'],
  ['export-model', 'Export the final image or 3D model. Terminal stage.', 'image or 3D model', 'none'],
]
const nodeCatalogText = nodeCatalogRows.map(([type, summary, input, output]) => `- ${type}: ${summary} Input: ${input}. Output: ${output}.`).join('\n')

export const systemPrompt = `You are the builder agent for a 3D production canvas canvas. You can build canvas structures and adjust node parameters. Use tools for every canvas change; never claim a change unless a tool succeeded.

Node catalog (each node type, what it does, and the media it takes/produces). A node can only receive what a previous node produces:
${nodeCatalogText}

Choose node types by matching outputs to inputs. generate-model is the unified 3D generation node: it accepts text, a single image, or multiple images and automatically selects single-image or multi-image reconstruction from its upstream input. There are two distinct ways to feed several images into a 3D model, and they use different nodes:

1. Generate the missing views from ONE image: reference-image → generate-multiview-images → generate-model. Use generate-multiview-images only when the user has a single reference and wants you to CREATE front/back/left/right views from it.

2. Use SEVERAL existing images directly: reference-image → generate-model. When the user already has multiple images of the subject (different angles already available), feed them straight into generate-model and do NOT add generate-multiview-images, because those views already exist.

When a multi-image request is ambiguous — you cannot tell whether the user has one image (and wants the views generated) or already has several images — do NOT guess. Call request_user_select with one option per path above, so the user confirms which one.

When the user asks to create, build, or design a canvas, call build_canvas with the complete ordered nodeTypes list. The server appends one new frame without replacing existing canvas content, places all new nodes inside it, connects compatible ports, and lays out the new section. Common shapes: text-to-image-to-3D = reference-image, prompt, generate-image, generate-model, export-model; direct text-to-3D = prompt, text-to-3d, export-model; one image generating multi-view then 3D = reference-image, generate-multiview-images, generate-model, export-model; several existing images to 3D = reference-image, generate-model, export-model. Add retopology, texture, rigging, and segments before export-model when requested.

Use get_canvas_structure when the current nodes or connections are unclear. Use list_available_node_types when the creatable node types are unclear. Use get_credit_balance when the user asks about their credits or before a paid execution if the balance is unclear. Use execute_canvas_node only when the user explicitly asks to run, generate, regenerate, retry, or export; it requests execution but cannot alter the price or balance. Use add_canvas_node to add any supported node type, including frame, when it is not already present; use build_canvas to append a complete canvas section. Use get_canvas_parameters when parameter names, node IDs, ranges, or options are unclear. Apply every parameter explicitly requested by the user. Group all requested changes for the same node into one update_node_parameters call, use separate calls for different nodes, and verify every requested change appears in successful tool results before replying. When you need the user to choose from a finite set of valid alternatives before continuing, you MUST call request_user_select. Never ask that question, list the options, or tell the user to choose in normal assistant text. For an empty canvas, if the user has not stated how to create the model, call request_user_select with the available canvas approaches. Do not ask for free-form text with this tool. Reply concisely in the user's language and summarize the nodes and connections actually created or changed.`

export { canvasNodeTypes } from './canvas-tools.js'
const progressLabelByTool = {
  get_canvas_structure: 'Inspecting canvas structure',
  list_available_node_types: 'Listing available node types',
  get_credit_balance: 'Checking credit balance',
  get_canvas_parameters: 'Inspecting adjustable parameters',
  build_canvas: 'Building canvas',
  update_node_parameters: 'Updating node parameters',
  add_canvas_node: 'Adding canvas node',
  request_user_select: 'Waiting for your selection',
  execute_canvas_node: 'Requesting node execution',
}

const tools = canvasToolDefinitions.map((definition) => ({ type: 'function', function: definition }))

export class DeepSeekError extends Error {
  constructor(message, status = 502) {
    super(message)
    this.status = status
  }
}

function parseArguments(call) {
  try {
    return JSON.parse(call.function.arguments || '{}')
  } catch {
    throw new DeepSeekError('DeepSeek returned invalid tool arguments.')
  }
}

export async function runDeepSeekAgent({ apiKey, message, canvas, account, history = [], fetchImpl = fetch, baseUrl = 'https://api.deepseek.com', model = 'deepseek-v4-flash', maxRounds = 5, signal, onProgress = () => {}, onTrace = () => {}, onCheckpoint = () => {}, checkpoint }) {
  if (!apiKey) throw new DeepSeekError('DeepSeek is not configured.', 503)
  baseUrl ||= 'https://api.deepseek.com'
  model ||= 'deepseek-v4-flash'
  let nextCanvas = structuredClone(checkpoint?.canvas || canvas)
  let structureChanged = Boolean(checkpoint?.structureChanged)
  const changes = structuredClone(checkpoint?.changes || [])
  let executionRequest = structuredClone(checkpoint?.executionRequest)
  const messages = checkpoint?.messages ? structuredClone(checkpoint.messages) : [
    { role: 'system', content: systemPrompt },
    ...history.slice(-20).map(({ role, content }) => ({ role, content })),
    { role: 'user', content: message },
  ]
  if (checkpoint?.phase === 'waiting_for_user') messages.push({ role: 'user', content: message })

  for (let round = checkpoint?.round || 0; round < maxRounds; round += 1) {
    await onProgress({ label: round ? 'Reviewing canvas changes' : 'Reviewing your request', status: 'running' })
    let response
    const requestStartedAt = Date.now()
    await onTrace({ type: 'model_request_started', payload: { round, model, messageCount: messages.length } })
    try {
      response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages, tools, tool_choice: 'auto', stream: false }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
      })
    } catch (error) {
      await onTrace({ type: 'model_request_failed', payload: { round, durationMs: Date.now() - requestStartedAt, error: { name: error?.name || 'Error', message: error?.message || String(error) } } })
      if (signal?.aborted) throw error
      throw new DeepSeekError('The DeepSeek service is unavailable.', 503)
    }
    await onTrace({ type: 'model_response_received', payload: { round, status: response.status, durationMs: Date.now() - requestStartedAt } })
    if (!response.ok) throw new DeepSeekError(`DeepSeek request failed with status ${response.status}.`, response.status === 429 ? 503 : 502)
    const payload = await response.json()
    const assistant = payload.choices?.[0]?.message
    if (!assistant) throw new DeepSeekError('DeepSeek returned an invalid response.')
    await onTrace({ type: 'assistant_message', payload: { round, content: assistant.content || '', toolCallCount: assistant.tool_calls?.length || 0, finishReason: payload.choices?.[0]?.finish_reason, usage: payload.usage } })
    if (!assistant.tool_calls?.length) {
      await onProgress({ label: 'Preparing final response', status: 'complete' })
      if (changes.length && nextCanvas.revision === canvas.revision) nextCanvas.revision += 1
      if (changes.length) nextCanvas.updatedAt = new Date().toISOString()
      return {
        canvas: nextCanvas,
        reply: assistant.content || (changes.length ? 'Canvas updated.' : 'No canvas changes were made. Use the canvas tools to make a change.'),
        changedNodeIds: [...new Set(changes.map((change) => change.nodeId))],
        structureChanged,
        ...(executionRequest ? { executionRequest } : {}),
      }
    }

    messages.push({ role: 'assistant', content: assistant.content || '', tool_calls: assistant.tool_calls })
    for (const call of assistant.tool_calls) {
      const toolStartedAt = Date.now()
      await onTrace({ type: 'tool_call_started', payload: { round, toolCallId: call.id, toolName: call.function.name, arguments: call.function.arguments } })
      let args
      try {
        args = parseArguments(call)
      } catch (error) {
        await onTrace({ type: 'tool_call_failed', payload: { round, toolCallId: call.id, toolName: call.function.name, error: { name: error.name, message: error.message } } })
        throw error
      }
      const label = progressLabelByTool[call.function.name]
      if (!label) throw new DeepSeekError(`DeepSeek requested unsupported tool "${call.function.name}".`)
      await onProgress({ label, status: 'running' })
      let result
      if (call.function.name === 'get_canvas_structure') {
        result = {
          nodes: nextCanvas.nodes.map(({ id, type, name }) => ({ id, type, name })),
          edges: nextCanvas.edges,
        }
      } else if (call.function.name === 'list_available_node_types') {
        result = { nodeTypes: canvasNodeTypes }
      } else if (call.function.name === 'get_credit_balance') {
        result = account
      } else if (call.function.name === 'build_canvas') {
        if (!Array.isArray(args.nodeTypes) || !args.nodeTypes.length || args.nodeTypes.some((type) => !canvasNodeTypes.includes(type))) {
          throw new DeepSeekError('DeepSeek requested an invalid canvas structure.')
        }
        const existingNodeIds = new Set(nextCanvas.nodes.map((node) => node.id))
        nextCanvas = buildCanvasStructure(message, args.nodeTypes, nextCanvas)
        const addedNodes = nextCanvas.nodes.filter((node) => !existingNodeIds.has(node.id))
        structureChanged = true
        for (const node of addedNodes) changes.push({ nodeId: node.id, added: true })
        result = {
          frameId: addedNodes.find((node) => node.type === 'frame')?.id,
          nodes: addedNodes.filter((node) => node.type !== 'frame').map(({ id, type, name }) => ({ id, type, name })),
          edges: nextCanvas.edges.filter((edge) => addedNodes.some((node) => node.id === edge.source.nodeId)).map((edge) => ({ source: edge.source.nodeId, target: edge.target.nodeId })),
        }
      } else if (call.function.name === 'get_canvas_parameters') {
        result = {
          nodes: nextCanvas.nodes.map(({ id, type, name }) => ({ id, type, name })),
          parameters: describeCanvasParameters(nextCanvas),
        }
      } else if (call.function.name === 'update_node_parameters') {
        const applied = updateNodeParameters(nextCanvas, args.nodeId, args.parameters)
        changes.push(...applied)
        result = { changes: applied }
      } else if (call.function.name === 'add_canvas_node') {
        let planned
        try {
          planned = addCanvasStage(nextCanvas, args.type, message)
        } catch (error) {
          throw new DeepSeekError(error.message)
        }
        nextCanvas = planned.canvas
        structureChanged ||= planned.structureChanged
        for (const nodeId of planned.changedNodeIds) changes.push({ nodeId, added: true })
        result = { addedNodeIds: planned.changedNodeIds }
      } else if (call.function.name === 'request_user_select') {
        const optionIds = new Set(args.options?.map((option) => option.id))
        if (typeof args.prompt !== 'string' || !args.prompt.trim() || !Array.isArray(args.options) || !args.options.length || optionIds.size !== args.options.length || args.options.some((option) => typeof option.id !== 'string' || !option.id || typeof option.label !== 'string' || !option.label) || !Number.isInteger(args.min) || !Number.isInteger(args.max) || args.min < 1 || args.max < args.min || args.max > args.options.length) {
          throw new DeepSeekError('DeepSeek requested an invalid user selection.')
        }
        const selectionPlan = {
          canvas: nextCanvas,
          changedNodeIds: [...new Set(changes.map((change) => change.nodeId))],
          structureChanged,
          userSelectionRequest: { prompt: args.prompt.trim(), options: args.options, min: args.min, max: args.max },
        }
        await onTrace({ type: 'tool_call_succeeded', payload: { round, toolCallId: call.id, toolName: call.function.name, durationMs: Date.now() - toolStartedAt, result: selectionPlan.userSelectionRequest } })
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(selectionPlan.userSelectionRequest) })
        await onCheckpoint({ round: round + 1, messages, canvas: nextCanvas, changes, structureChanged, phase: 'waiting_for_user' })
        return selectionPlan
      } else if (call.function.name === 'execute_canvas_node') {
        const node = nextCanvas.nodes.find((candidate) => candidate.id === args.nodeId)
        if (!node || !['node', 'downstream'].includes(args.mode)) throw new DeepSeekError('DeepSeek requested an invalid node execution.')
        executionRequest = { nodeId: node.id, mode: args.mode }
        result = { accepted: true, ...executionRequest, cost: account.executionCost }
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
      await onTrace({ type: 'tool_call_succeeded', payload: { round, toolCallId: call.id, toolName: call.function.name, durationMs: Date.now() - toolStartedAt, result } })
      await onProgress({ label, status: 'complete' })
    }
    await onCheckpoint({ round: round + 1, messages, canvas: nextCanvas, changes, structureChanged, executionRequest, phase: 'tool_complete' })
  }
  throw new DeepSeekError('DeepSeek exceeded the tool-call limit.')
}
