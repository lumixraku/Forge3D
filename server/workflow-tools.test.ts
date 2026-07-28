import test from 'node:test'
import assert from 'node:assert/strict'
import { workflowStageTypes, workflowToolDefinitions } from './workflow-tools.js'

test('defines complete closed schemas for every workflow agent tool', () => {
  assert.deepEqual(workflowToolDefinitions.map((tool) => tool.name), [
    'get_workflow_structure',
    'build_workflow',
    'get_workflow_parameters',
    'update_node_parameters',
    'add_workflow_stage',
    'request_user_select',
  ])
  assert.ok(workflowToolDefinitions.every((tool) => tool.parameters.additionalProperties === false))

  const tools = Object.fromEntries(workflowToolDefinitions.map((tool) => [tool.name, tool]))
  assert.equal(tools.build_workflow.parameters.properties.stages.minItems, 1)
  assert.deepEqual(tools.build_workflow.parameters.properties.stages.items.enum, workflowStageTypes)
  assert.deepEqual(tools.add_workflow_stage.parameters.properties.type.enum, ['frame', ...workflowStageTypes])

  const updateParameters = tools.update_node_parameters.parameters.properties.parameters
  assert.equal(updateParameters.additionalProperties, false)
  assert.deepEqual(updateParameters.properties.faceType.enum, ['Triangle', 'Quad'])
  assert.equal(updateParameters.properties.faceLimit.multipleOf, 500)
  assert.deepEqual(updateParameters.properties.textureQuality.enum, ['No texture', 'Standard', 'HD', '2K', '4K', '8K'])
  assert.deepEqual(updateParameters.properties.exportTargets.items.enum, ['dcc', 'texture', 'bambu'])

  const selection = tools.request_user_select.parameters
  assert.equal(selection.properties.prompt.minLength, 1)
  assert.equal(selection.properties.options.minItems, 1)
  assert.equal(selection.properties.options.items.additionalProperties, false)
  assert.equal(selection.properties.options.items.properties.id.minLength, 1)
  assert.equal(selection.properties.options.items.properties.label.minLength, 1)
  assert.equal(selection.properties.min.minimum, 1)
  assert.equal(selection.properties.max.minimum, 1)
})
