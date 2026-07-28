import { nodeDefaults } from './planner.js'
import { workflowParameterJsonSchema } from './workflow-parameters.js'

export const workflowStageTypes = Object.keys(nodeDefaults)

export const workflowToolDefinitions = [
  {
    name: 'get_workflow_structure',
    description: 'Inspect the current workflow nodes and connections, plus every stage type that can be created.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'build_workflow',
    description: 'Append a workflow section from an ordered list of stages without replacing existing canvas content. All new stages are placed inside one frame and compatible stages are connected automatically.',
    parameters: {
      type: 'object',
      properties: {
        stages: {
          type: 'array',
          description: 'Complete ordered stage list. Do not include frame; it is created automatically.',
          items: { type: 'string', enum: workflowStageTypes },
          minItems: 1,
        },
      },
      required: ['stages'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_workflow_parameters',
    description: 'List current workflow nodes and their adjustable parameters, valid ranges, and options.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'update_node_parameters',
    description: 'Update validated parameters on one existing workflow node. You must use the exact nodeId returned by get_workflow_structure; do not use a display name or node type.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Exact node ID from the current workflow.' },
        parameters: workflowParameterJsonSchema(),
      },
      required: ['nodeId', 'parameters'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_workflow_stage',
    description: 'Add one workflow node of the requested type when that node type does not already exist. Frame can also be added as a separate workflow container.',
    parameters: {
      type: 'object',
      properties: { type: { type: 'string', enum: ['frame', ...workflowStageTypes] } },
      required: ['type'],
      additionalProperties: false,
    },
  },
  {
    name: 'request_user_select',
    description: 'Pause the task and ask the user to select one or more options before continuing.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', minLength: 1 },
        options: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', minLength: 1 },
              label: { type: 'string', minLength: 1 },
            },
            required: ['id', 'label'],
            additionalProperties: false,
          },
        },
        min: { type: 'integer', minimum: 1 },
        max: { type: 'integer', minimum: 1 },
      },
      required: ['prompt', 'options', 'min', 'max'],
      additionalProperties: false,
    },
  },
]

export function workflowToolDefinition(name) {
  return workflowToolDefinitions.find((definition) => definition.name === name)
}
