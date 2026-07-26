import test from 'node:test'
import assert from 'node:assert/strict'
import { runDeepSeekAgent } from './deepseek.js'
import { planWorkflow } from './planner.js'

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

test('uses DeepSeek tool calls to update validated node parameters', async () => {
  const workflow = planWorkflow('Create a text-to-3D workflow').workflow
  const requests = []
  const replies = [
    response({ choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'update_node_parameters', arguments: JSON.stringify({ nodeId: 'text-to-3d', parameters: { faceCount: 12000, modelVersion: 'v2.5' } }) } }] } }] }),
    response({ choices: [{ message: { role: 'assistant', content: 'Updated Text to 3D to 12,000 faces using v2.5.' } }] }),
  ]
  const fetchImpl = async (url, options) => {
    requests.push({ url, options, body: JSON.parse(options.body) })
    return replies.shift()
  }

  const result = await runDeepSeekAgent({ apiKey: 'test-key', message: 'Use 12,000 faces and v2.5', workflow, fetchImpl })

  assert.equal(result.workflow.nodes.find((node) => node.id === 'text-to-3d').config.faceCount, 12000)
  assert.equal(result.workflow.nodes.find((node) => node.id === 'text-to-3d').config.modelVersion, 'v2.5')
  assert.deepEqual(result.changedNodeIds, ['text-to-3d'])
  assert.equal(requests.length, 2)
  assert.equal(requests[0].options.headers.authorization, 'Bearer test-key')
  assert.equal(requests[0].body.model, 'deepseek-v4-flash')
  assert.equal(requests[1].body.messages.at(-1).tool_call_id, 'call-1')
})

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

test('accepts user-facing parameter labels returned by DeepSeek', async () => {
  const workflow = planWorkflow('Create a text-to-3D workflow').workflow
  const replies = [
    response({ choices: [{ message: { role: 'assistant', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'update_node_parameters', arguments: JSON.stringify({ nodeId: 'text-to-3d', parameters: { 'generated face count': 12000, 'model version': 'v2.5' } }) } }] } }] }),
    response({ choices: [{ message: { role: 'assistant', content: 'Updated.' } }] }),
  ]

  const result = await runDeepSeekAgent({ apiKey: 'test-key', message: 'Update it', workflow, fetchImpl: async () => replies.shift() })

  assert.equal(result.workflow.nodes.find((node) => node.id === 'text-to-3d').config.faceCount, 12000)
  assert.equal(result.workflow.nodes.find((node) => node.id === 'text-to-3d').config.modelVersion, 'v2.5')
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

test('describes every adjustable field in the update tool schema', async () => {
  const workflow = planWorkflow('Create a text-to-3D workflow with retopology and texture').workflow
  let requestBody

  await runDeepSeekAgent({
    apiKey: 'test-key',
    message: 'Update retopology and texture',
    workflow,
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body)
      return response({ choices: [{ message: { role: 'assistant', content: 'No changes.' } }] })
    },
  })

  const updateTool = requestBody.tools.find((tool) => tool.function.name === 'update_node_parameters')
  const properties = updateTool.function.parameters.properties.parameters.properties
  assert.deepEqual(properties.faceType.enum, ['Triangle', 'Quad'])
  assert.equal(properties.faceLimit.multipleOf, 500)
  assert.deepEqual(properties.textureQuality.enum, ['No texture', 'Standard', 'HD', '2K', '4K', '8K'])
  assert.deepEqual(properties.exportTargets.items.enum, ['dcc', 'texture', 'bambu'])
})

test('applies multiple parameters across multiple tool calls', async () => {
  const workflow = planWorkflow('Create a text-to-3D workflow with retopology and texture').workflow
  const replies = [
    response({ choices: [{ message: { role: 'assistant', tool_calls: [
      { id: 'call-1', type: 'function', function: { name: 'update_node_parameters', arguments: JSON.stringify({ nodeId: 'retopology', parameters: { faceLimit: 6000, faceType: 'Quad' } }) } },
      { id: 'call-2', type: 'function', function: { name: 'update_node_parameters', arguments: JSON.stringify({ nodeId: 'texture', parameters: { textureQuality: '4K' } }) } },
    ] } }] }),
    response({ choices: [{ message: { role: 'assistant', content: 'Updated.' } }] }),
  ]

  const result = await runDeepSeekAgent({ apiKey: 'test-key', message: 'Update it', workflow, fetchImpl: async () => replies.shift() })

  assert.equal(result.workflow.nodes.find((node) => node.id === 'retopology').config.faceLimit, 6000)
  assert.equal(result.workflow.nodes.find((node) => node.id === 'retopology').config.faceType, 'Quad')
  assert.equal(result.workflow.nodes.find((node) => node.id === 'texture').config.textureQuality, '4K')
  assert.deepEqual(result.changedNodeIds, ['retopology', 'texture'])
})

test('uses DeepSeek to rebuild a framed workflow with nodes and connections', async () => {
  const workflow = planWorkflow('Create a text-to-3D workflow').workflow
  const replies = [
    response({ choices: [{ message: { role: 'assistant', tool_calls: [{
      id: 'call-build',
      type: 'function',
      function: {
        name: 'build_workflow',
        arguments: JSON.stringify({ stages: ['reference-image', 'prompt', 'generate-image', 'generate-model', 'export-model'] }),
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

  const frame = result.workflow.nodes.find((node) => node.type === 'frame')
  assert.equal(result.structureChanged, true)
  assert.deepEqual(result.workflow.nodes.filter((node) => node.type !== 'frame').map((node) => node.type), [
    'reference-image',
    'prompt',
    'generate-image',
    'generate-model',
    'export-model',
  ])
  assert.ok(result.workflow.nodes.filter((node) => node.type !== 'frame').every((node) => node.ui.parentFrameId === frame.id))
  assert.deepEqual(result.workflow.edges.map((edge) => [edge.source.nodeId, edge.target.nodeId]), [
    ['reference-image', 'generate-image'],
    ['prompt', 'generate-image'],
    ['generate-image', 'generate-model'],
    ['generate-model', 'export-model'],
  ])
})

test('applies only parameters selected by DeepSeek without changing workflow structure', async () => {
  const workflow = planWorkflow('Create a text-to-3D workflow with retopology and texture').workflow
  const originalNodeCount = workflow.nodes.length
  const originalEdgeCount = workflow.edges.length
  const replies = [
    response({ choices: [{ message: { role: 'assistant', tool_calls: [
       { id: 'call-1', type: 'function', function: { name: 'update_node_parameters', arguments: JSON.stringify({ nodeId: 'retopology', parameters: { faceLimit: 6000, faceType: 'Quad' } }) } },
      { id: 'call-2', type: 'function', function: { name: 'update_node_parameters', arguments: JSON.stringify({ nodeId: 'texture', parameters: { textureQuality: '4K' } }) } },
    ] } }] }),
    response({ choices: [{ message: { role: 'assistant', content: 'Updated.' } }] }),
  ]

  const result = await runDeepSeekAgent({
    apiKey: 'test-key',
    message: '把 Retopology 的目标面数改成 6000，面类型改成 Quad；同时把纹理分辨率改成 4K',
    workflow,
    fetchImpl: async () => replies.shift(),
  })

  assert.equal(result.workflow.nodes.find((node) => node.id === 'retopology').config.faceType, 'Quad')
  assert.equal(result.workflow.nodes.length, originalNodeCount)
  assert.equal(result.workflow.edges.length, originalEdgeCount)
  assert.equal(result.structureChanged, false)
})

test('rejects invalid parameter values requested by the model', async () => {
  const workflow = planWorkflow('Create a text-to-3D workflow').workflow
  const fetchImpl = async () => response({ choices: [{ message: { role: 'assistant', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'update_node_parameters', arguments: JSON.stringify({ nodeId: 'text-to-3d', parameters: { faceCount: 999999 } }) } }] } }] })

  await assert.rejects(
    runDeepSeekAgent({ apiKey: 'test-key', message: 'Use lots of faces', workflow, fetchImpl }),
    /generated face count must be 1000-50000/,
  )
})

test('does not expose the API key in upstream errors', async () => {
  const workflow = planWorkflow('Create a text-to-3D workflow').workflow
  await assert.rejects(
    runDeepSeekAgent({ apiKey: 'secret-key', message: 'Change it', workflow, fetchImpl: async () => response({ error: 'bad key' }, 401) }),
    (error) => error.message === 'DeepSeek request failed with status 401.' && !error.message.includes('secret-key'),
  )
})

test('adds any supported node type through add_workflow_stage', async () => {
  const workflow = planWorkflow('Create a text-to-3D workflow').workflow
  const replies = [
    response({ choices: [{ message: { role: 'assistant', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'add_workflow_stage', arguments: JSON.stringify({ type: 'generate-image' }) } }] } }] }),
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

  const addTool = requestBody.tools.find((tool) => tool.function.name === 'add_workflow_stage')
  const stageTypes = addTool.function.parameters.properties.type.enum
  assert.ok(stageTypes.includes('generate-image'))
  assert.ok(addTool.function.parameters.properties.type.enum.includes('frame'))
  assert.ok(stageTypes.includes('smart-mesh'))
  assert.ok(stageTypes.includes('bake'))
  assert.ok(stageTypes.includes('rigging'))
  assert.ok(stageTypes.includes('split'))
  assert.ok(result.workflow.nodes.some((node) => node.type === 'generate-image'))
  assert.deepEqual(result.changedNodeIds, ['generate-image'])
  assert.equal(result.structureChanged, true)
})
