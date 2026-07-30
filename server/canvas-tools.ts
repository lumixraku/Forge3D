import { canvasParameterJsonSchema } from './canvas-parameters.js'
import { canvasNodeSchema } from '../src/canvas-schema.js'

export const canvasNodeTypes = canvasNodeSchema.filter((node) => !['frame', 'generated-image'].includes(node.type)).map((node) => node.type)

export const canvasToolDefinitions = [
  {
    name: 'get_canvas_structure',
    description: 'Inspect every node and connection on the current canvas, across all canvas sections.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_available_node_types',
    description: 'List every node type that can be created in a canvas.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'build_canvas',
    description: 'Append a canvas section from an ordered list of node types without replacing existing canvas content. All new nodes are placed inside one frame and compatible nodes are connected automatically.',
    parameters: {
      type: 'object',
      properties: {
        nodeTypes: {
          type: 'array',
          description: 'Complete ordered node type list. Do not include frame; it is created automatically.',
          items: { type: 'string', enum: canvasNodeTypes },
          minItems: 1,
        },
      },
      required: ['nodeTypes'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_canvas_parameters',
    description: 'List all nodes on the current canvas and their adjustable parameters, valid ranges, and options.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'update_node_parameters',
    description: 'Update validated parameters on one existing canvas node. You must use the exact nodeId returned by get_canvas_structure; do not use a display name or node type.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Exact ID of a node on the current canvas.' },
        parameters: canvasParameterJsonSchema(),
      },
      required: ['nodeId', 'parameters'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_canvas_node',
    description: 'Add one canvas node of the requested type when that node type does not already exist. Frame can also be added as a separate canvas container.',
    parameters: {
      type: 'object',
      properties: { type: { type: 'string', enum: ['frame', ...canvasNodeTypes] } },
      required: ['type'],
      additionalProperties: false,
    },
  },
  {
    name: 'request_user_select',
    description: 'Pause the turn and ask the user to select one or more options before continuing.',
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

export function canvasToolDefinition(name) {
  return canvasToolDefinitions.find((definition) => definition.name === name)
}
