import { describeWorkflowParameters, updateNodeParameters } from './workflow-parameters.js'
import { addWorkflowStage, buildWorkflowStructure, planWorkflow } from './planner.js'
import { workflowStageTypes, workflowToolDefinitions } from './workflow-tools.js'

// Every selectable stage, with what it does and the media it consumes/produces.
// This is what lets the model match each stage to the media it consumes.
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
  ['bake', 'Bake detail from one model onto another.', '3D models', '3D model'],
  ['texture', 'Generate UV textures for a model (optionally guided by an image or text).', '3D model (+ optional image/text)', '3D model'],
  ['rigging', 'Add a skeleton / rig to a model.', '3D model', '3D model'],
  ['split', 'Split a model into separate parts.', '3D model', '3D model'],
  ['model-preview', 'Interactive 3D preview of the result.', '3D model', '3D model'],
  ['export-model', 'Export the final image or 3D model. Terminal stage.', 'image or 3D model', 'none'],
]
const nodeCatalogText = nodeCatalogRows.map(([type, summary, input, output]) => `- ${type}: ${summary} Input: ${input}. Output: ${output}.`).join('\n')

export const systemPrompt = `You are the builder agent for a 3D production workflow canvas. You can build workflow structures and adjust node parameters. Use tools for every workflow change; never claim a change unless a tool succeeded.

Node catalog (each stage, what it does, and the media it takes/produces). A stage can only receive what a previous stage produces:
${nodeCatalogText}

Choose stages by matching outputs to inputs. Key rule: generate-model is the unified 3D generation stage. It accepts text, a single image, or multiple images and automatically selects single-image or multi-image reconstruction from the upstream output. Any "one image → multiple views → 3D" request must use generate-multiview-images followed by generate-model.

When the user asks to create, build, or design a workflow, call build_workflow with the complete ordered list of stages. The server appends one new frame without replacing existing canvas content, places all new stages inside it, connects compatible ports, and lays out the new section. Common shapes: text-to-image-to-3D = reference-image, prompt, generate-image, generate-model, export-model; direct text-to-3D = prompt, text-to-3d, export-model; single image to multi-view to 3D = reference-image, generate-multiview-images, generate-model, export-model. Add retopology, texture, rigging, and split before export-model when requested.

Use get_workflow_structure when the current nodes or available stage types are unclear. Use add_workflow_stage to add any supported node type, including frame, when it is not already present; use build_workflow to append a complete workflow section. Use get_workflow_parameters when parameter names, node IDs, ranges, or options are unclear. Apply every parameter explicitly requested by the user. Group all requested changes for the same node into one update_node_parameters call, use separate calls for different nodes, and verify every requested change appears in successful tool results before replying. When you need the user to choose from a finite set of valid alternatives before continuing, you MUST call request_user_select. Never ask that question, list the options, or tell the user to choose in normal assistant text. For an empty workflow, if the user has not stated how to create the model, call request_user_select with the available workflow approaches. Do not ask for free-form text with this tool. Reply concisely in the user's language and summarize the nodes and connections actually created or changed.`

export { workflowStageTypes } from './workflow-tools.js'
const progressLabelByTool = {
  get_workflow_structure: 'Inspecting workflow structure',
  get_workflow_parameters: 'Inspecting adjustable parameters',
  build_workflow: 'Building workflow',
  update_node_parameters: 'Updating node parameters',
  add_workflow_stage: 'Adding workflow stage',
  request_user_select: 'Waiting for your selection',
}

const tools = workflowToolDefinitions.map((definition) => ({ type: 'function', function: definition }))

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

export async function runDeepSeekAgent({ apiKey, message, workflow, history = [], fetchImpl = fetch, baseUrl = 'https://api.deepseek.com', model = 'deepseek-v4-flash', maxRounds = 5, onProgress = () => {} }) {
  if (!apiKey) throw new DeepSeekError('DeepSeek is not configured.', 503)
  baseUrl ||= 'https://api.deepseek.com'
  model ||= 'deepseek-v4-flash'
  let nextWorkflow = structuredClone(workflow)
  let structureChanged = false
  const changes = []
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-20).map(({ role, content }) => ({ role, content })),
    { role: 'user', content: message },
  ]

  for (let round = 0; round < maxRounds; round += 1) {
    await onProgress({ label: round ? 'Reviewing workflow changes' : 'Reviewing your request', status: 'running' })
    let response
    try {
      response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages, tools, tool_choice: 'auto', stream: false }),
        signal: AbortSignal.timeout(30000),
      })
    } catch {
      throw new DeepSeekError('The DeepSeek service is unavailable.', 503)
    }
    if (!response.ok) throw new DeepSeekError(`DeepSeek request failed with status ${response.status}.`, response.status === 429 ? 503 : 502)
    const payload = await response.json()
    const assistant = payload.choices?.[0]?.message
    if (!assistant) throw new DeepSeekError('DeepSeek returned an invalid response.')
    if (!assistant.tool_calls?.length) {
      await onProgress({ label: 'Preparing final response', status: 'complete' })
      if (changes.length && nextWorkflow.revision === workflow.revision) nextWorkflow.revision += 1
      if (changes.length) nextWorkflow.updatedAt = new Date().toISOString()
      return {
        workflow: nextWorkflow,
        reply: assistant.content || (changes.length ? 'Workflow updated.' : 'No workflow changes were made. Use the workflow tools to make a change.'),
        changedNodeIds: [...new Set(changes.map((change) => change.nodeId))],
        structureChanged,
      }
    }

    messages.push({ role: 'assistant', content: assistant.content || '', tool_calls: assistant.tool_calls })
    for (const call of assistant.tool_calls) {
      const args = parseArguments(call)
      const label = progressLabelByTool[call.function.name]
      if (!label) throw new DeepSeekError(`DeepSeek requested unsupported tool "${call.function.name}".`)
      await onProgress({ label, status: 'running' })
      let result
      if (call.function.name === 'get_workflow_structure') {
        result = {
          nodes: nextWorkflow.nodes.map(({ id, type, name }) => ({ id, type, name })),
          edges: nextWorkflow.edges,
          availableStageTypes: workflowStageTypes,
        }
      } else if (call.function.name === 'build_workflow') {
        if (!Array.isArray(args.stages) || !args.stages.length || args.stages.some((type) => !workflowStageTypes.includes(type))) {
          throw new DeepSeekError('DeepSeek requested an invalid workflow structure.')
        }
        const existingNodeIds = new Set(nextWorkflow.nodes.map((node) => node.id))
        nextWorkflow = buildWorkflowStructure(message, args.stages, nextWorkflow)
        const addedNodes = nextWorkflow.nodes.filter((node) => !existingNodeIds.has(node.id))
        structureChanged = true
        for (const node of addedNodes) changes.push({ nodeId: node.id, added: true })
        result = {
          frameId: addedNodes.find((node) => node.type === 'frame')?.id,
          nodes: addedNodes.filter((node) => node.type !== 'frame').map(({ id, type, name }) => ({ id, type, name })),
          edges: nextWorkflow.edges.filter((edge) => addedNodes.some((node) => node.id === edge.source.nodeId)).map((edge) => ({ source: edge.source.nodeId, target: edge.target.nodeId })),
        }
      } else if (call.function.name === 'get_workflow_parameters') {
        result = {
          nodes: nextWorkflow.nodes.map(({ id, type, name }) => ({ id, type, name })),
          parameters: describeWorkflowParameters(nextWorkflow),
        }
      } else if (call.function.name === 'update_node_parameters') {
        const applied = updateNodeParameters(nextWorkflow, args.nodeId, args.parameters)
        changes.push(...applied)
        result = { changes: applied }
      } else if (call.function.name === 'add_workflow_stage') {
        let planned
        try {
          planned = addWorkflowStage(nextWorkflow, args.type, message)
        } catch (error) {
          throw new DeepSeekError(error.message)
        }
        nextWorkflow = planned.workflow
        structureChanged ||= planned.structureChanged
        for (const nodeId of planned.changedNodeIds) changes.push({ nodeId, added: true })
        result = { addedNodeIds: planned.changedNodeIds }
      } else if (call.function.name === 'request_user_select') {
        const optionIds = new Set(args.options?.map((option) => option.id))
        if (typeof args.prompt !== 'string' || !args.prompt.trim() || !Array.isArray(args.options) || !args.options.length || optionIds.size !== args.options.length || args.options.some((option) => typeof option.id !== 'string' || !option.id || typeof option.label !== 'string' || !option.label) || !Number.isInteger(args.min) || !Number.isInteger(args.max) || args.min < 1 || args.max < args.min || args.max > args.options.length) {
          throw new DeepSeekError('DeepSeek requested an invalid user selection.')
        }
        return {
          workflow: nextWorkflow,
          changedNodeIds: [...new Set(changes.map((change) => change.nodeId))],
          structureChanged,
          userSelectionRequest: { prompt: args.prompt.trim(), options: args.options, min: args.min, max: args.max },
        }
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
      await onProgress({ label, status: 'complete' })
    }
  }
  throw new DeepSeekError('DeepSeek exceeded the tool-call limit.')
}
