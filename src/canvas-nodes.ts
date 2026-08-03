import { canvasNodeSchema } from './canvas-schema'
import type { NodePort, PortType, CanvasNodeSchema } from './canvas-schema'

export { applyNodeParameter, conditionsMatch, hasModelEditor, isExecutableNodeType, nodeDefaults, nodeSchema, parameterRange, canvasNodeSchema, canvasNodeSchemas } from './canvas-schema'
export type { NodeParameter, ParameterCondition, ParameterOption, ParameterRange, CanvasNodeSchema } from './canvas-schema'

export type { NodePort, PortType }
export type NodeDefinition = CanvasNodeSchema

export const nodeCatalog: NodeDefinition[] = canvasNodeSchema
export const nodeCategories = [...new Set(nodeCatalog.map((node) => node.category))]

export function nodeDefinition(type: string) {
  return nodeCatalog.find((item) => item.type === type)
}

export function nodeDisplayName(type: string, fallback?: string) {
  return nodeDefinition(type)?.label || fallback || type
}

export function canConnectNodeTypes(sourceType: string, targetType: string) {
  return nodeOutputPorts(sourceType).length > 0 && nodeInputPorts(targetType).length > 0
}

export function nodeInputPorts(type: string): NodePort[] {
  const definition = nodeDefinition(type)
  return definition && (definition.inputTypes.length > 0 || definition.inputPorts?.length)
    ? [{ id: 'input', label: 'Input', type: 'any' }]
    : []
}

export function nodeOutputPorts(type: string): NodePort[] {
  const definition = nodeDefinition(type)
  const outputType = definition?.outputType || definition?.outputPorts?.[0]?.type
  return outputType ? [{ id: 'output', label: 'Output', type: outputType }] : []
}

export function canConnectPorts(sourceType: string, sourcePortId: string, targetType: string, targetPortId: string) {
  return Boolean(nodeOutputPorts(sourceType).some((port) => port.id === sourcePortId) && nodeInputPorts(targetType).some((port) => port.id === targetPortId))
}

export function compatibleNodeTypes(sourceType: string) {
  return nodeCatalog.filter((item) => !item.hidden && canConnectNodeTypes(sourceType, item.type))
}
