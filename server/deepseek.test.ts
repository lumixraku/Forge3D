import test from 'node:test'
import assert from 'node:assert/strict'
import { runDeepSeekAgent, workflowNodeTypes } from './deepseek.js'
import { planWorkflow } from './planner.js'

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

test('emits only safe activity labels while calling tools', async () => {
  const workflow = planWorkflow('Create a text-to-3D workflow').workflow
  const progress = []
  const replies = [
    response({ choices: [{ message: { role: 'assistant', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'update_node_parameters', arguments: JSON.stringify({ nodeId: 'text-to-3d', parameters: { faceCount: 12000 } }) } }] } }] }),
    response({ choices: [{ message: { role: 'assistant', content: 'Updated.' } }] }),
  ]

  await runDeepSeekAgent({ apiKey: 'test-key', message: 'Use 12,000 faces', workflow, fetchImpl: async () => replies.shift(), onProgress: (event) => progress.push(event) })

  assert.deepEqual(progress, [
    { label: 'Reviewing your request', status: 'running' },
    { label: 'Updating node parameters', status: 'running' },
    { label: 'Updating node parameters', status: 'complete' },
    { label: 'Reviewing workflow changes', status: 'running' },
    { label: 'Preparing final response', status: 'complete' },
  ])
  assert.ok(progress.every((event) => !JSON.stringify(event).includes('text-to-3d')))
})

test('returns a validated generic user selection request', async () => {
  const workflow = planWorkflow('Create a text-to-3D workflow').workflow
  const result = await runDeepSeekAgent({
    apiKey: 'test-key',
    message: 'Help me choose a model version',
    workflow,
    fetchImpl: async () => response({ choices: [{ message: { role: 'assistant', tool_calls: [{ id: 'call-select', type: 'function', function: { name: 'request_user_select', arguments: JSON.stringify({ prompt: 'Choose a model version', options: [{ id: 'v2', label: 'v2' }, { id: 'v25', label: 'v2.5' }], min: 1, max: 1 }) } }] } }] }),
  })

  assert.deepEqual(result.userSelectionRequest, {
    prompt: 'Choose a model version',
    options: [{ id: 'v2', label: 'v2' }, { id: 'v25', label: 'v2.5' }],
    min: 1,
    max: 1,
  })
})

test('requires the exact node ID selected by the model', async () => {
  const workflow = planWorkflow('Create an image-first 3D workflow').workflow
  const replies = [
    response({ choices: [{ message: { role: 'assistant', tool_calls: [{ id: 'call-structure', type: 'function', function: { name: 'get_workflow_structure', arguments: '{}' } }] } }] }),
    response({ choices: [{ message: { role: 'assistant', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'update_node_parameters', arguments: JSON.stringify({ nodeId: 'generate-model', parameters: { faceCount: 10000 } }) } }] } }] }),
    response({ choices: [{ message: { role: 'assistant', content: '已将 Gen HD Model 面数改为 10000。' } }] }),
  ]

  const result = await runDeepSeekAgent({ apiKey: 'test-key', message: 'Image to 3D 的面数改成 1 万', workflow, fetchImpl: async () => replies.shift() })

  assert.equal(result.workflow.nodes.find((node) => node.type === 'generate-model').config.faceCount, 10000)
  assert.deepEqual(result.changedNodeIds, ['generate-model'])
})

test('separates current workflow structure from available node types', async () => {
  const workflow = planWorkflow('Create a text-to-3D workflow').workflow
  const replies = [
    response({ choices: [{ message: { role: 'assistant', tool_calls: [{ id: 'call-structure', type: 'function', function: { name: 'get_workflow_structure', arguments: '{}' } }] } }] }),
    response({ choices: [{ message: { role: 'assistant', tool_calls: [{ id: 'call-types', type: 'function', function: { name: 'list_available_node_types', arguments: '{}' } }] } }] }),
    response({ choices: [{ message: { role: 'assistant', content: 'Inspected.' } }] }),
  ]
  const requests = []

  await runDeepSeekAgent({
    apiKey: 'test-key',
    message: 'Inspect the workflow and available node types',
    workflow,
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body))
      return replies.shift()
    },
  })

  const structureResult = JSON.parse(requests[1].messages.find((entry) => entry.tool_call_id === 'call-structure').content)
  const nodeTypesResult = JSON.parse(requests[2].messages.find((entry) => entry.tool_call_id === 'call-types').content)
  assert.deepEqual(Object.keys(structureResult), ['nodes', 'edges'])
  assert.deepEqual(nodeTypesResult, { nodeTypes: workflowNodeTypes })
})

test('uses DeepSeek to append a framed workflow with nodes and connections', async () => {
  const workflow = planWorkflow('Create a text-to-3D workflow').workflow
  const existingNodes = structuredClone(workflow.nodes)
  const existingEdges = structuredClone(workflow.edges)
  const replies = [
    response({ choices: [{ message: { role: 'assistant', tool_calls: [{
      id: 'call-build',
      type: 'function',
      function: {
        name: 'build_workflow',
        arguments: JSON.stringify({ nodeTypes: ['reference-image', 'prompt', 'generate-image', 'generate-model', 'export-model'] }),
      },
    }] } }] }),
    response({ choices: [{ message: { role: 'assistant', content: '已创建常用的图生 3D 工作流。' } }] }),
  ]

  const result = await runDeepSeekAgent({
    apiKey: 'test-key',
    message: '创建一个常用的3D建模流程，根据文字生成图片，再根据图片生成3D',
    workflow,
    fetchImpl: async () => replies.shift(),
  })

  const addedNodes = result.workflow.nodes.slice(existingNodes.length)
  const frame = addedNodes.find((node) => node.type === 'frame')
  assert.equal(result.structureChanged, true)
  assert.deepEqual(result.workflow.nodes.slice(0, existingNodes.length), existingNodes)
  assert.deepEqual(result.workflow.edges.slice(0, existingEdges.length), existingEdges)
  assert.deepEqual(addedNodes.filter((node) => node.type !== 'frame').map((node) => node.type), [
    'reference-image',
    'prompt',
    'generate-image',
    'generate-model',
    'export-model',
  ])
  assert.ok(addedNodes.filter((node) => node.type !== 'frame').every((node) => node.ui.parentFrameId === frame.id))
  assert.deepEqual(result.workflow.edges.slice(existingEdges.length).map((edge) => [edge.source.nodeId, edge.target.nodeId]), [
    ['reference-image', 'generate-image'],
    ['prompt-2', 'generate-image'],
    ['generate-image', 'generate-model'],
    ['generate-model', 'export-model-2'],
  ])
  assert.deepEqual(result.changedNodeIds, addedNodes.map((node) => node.id))
})

test('does not expose the API key in upstream errors', async () => {
  const workflow = planWorkflow('Create a text-to-3D workflow').workflow
  await assert.rejects(
    runDeepSeekAgent({ apiKey: 'secret-key', message: 'Change it', workflow, fetchImpl: async () => response({ error: 'bad key' }, 401) }),
    (error) => error.message === 'DeepSeek request failed with status 401.' && !error.message.includes('secret-key'),
  )
})

test('adds any supported node type through add_workflow_node', async () => {
  const workflow = planWorkflow('Create a text-to-3D workflow').workflow
  const replies = [
    response({ choices: [{ message: { role: 'assistant', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'add_workflow_node', arguments: JSON.stringify({ type: 'generate-image' }) } }] } }] }),
    response({ choices: [{ message: { role: 'assistant', content: 'Added Image to Image.' } }] }),
  ]
  let requestBody
  const result = await runDeepSeekAgent({
    apiKey: 'test-key',
    message: 'Add an image generation node',
    workflow,
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body)
      return replies.shift()
    },
  })

  const addTool = requestBody.tools.find((tool) => tool.function.name === 'add_workflow_node')
  const nodeTypes = addTool.function.parameters.properties.type.enum
  assert.ok(nodeTypes.includes('generate-image'))
  assert.ok(addTool.function.parameters.properties.type.enum.includes('frame'))
  assert.ok(nodeTypes.includes('smart-mesh'))
  assert.ok(nodeTypes.includes('bake'))
  assert.ok(nodeTypes.includes('rigging'))
  assert.ok(nodeTypes.includes('segments'))
  assert.ok(result.workflow.nodes.some((node) => node.type === 'generate-image'))
  assert.deepEqual(result.changedNodeIds, ['generate-image'])
  assert.equal(result.structureChanged, true)
})
