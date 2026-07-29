import { workflowNodeSchema } from './workflow-schema'
import type { NodePort, PortType, WorkflowNodeSchema } from './workflow-schema'

export { applyNodeParameter, conditionsMatch, nodeDefaults, nodeSchema, parameterRange, workflowNodeSchema, workflowNodeSchemas } from './workflow-schema'
export type { NodeParameter, ParameterCondition, ParameterOption, ParameterRange, WorkflowNodeSchema } from './workflow-schema'

export type { NodePort, PortType }
export type NodeDefinition = WorkflowNodeSchema

export const nodeCatalog: NodeDefinition[] = workflowNodeSchema
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
  if (definition?.inputPorts) return definition.inputPorts
  return definition?.inputTypes.map((portType, index) => ({
    id: definition.inputTypes.length === 1 ? 'input' : `${portType}-${index + 1}`,
    label: portType[0].toUpperCase() + portType.slice(1),
    type: portType,
  })) || []
}

export function nodeOutputPorts(type: string): NodePort[] {
  const definition = nodeDefinition(type)
  if (definition?.outputPorts) return definition.outputPorts
  return definition?.outputType ? [{ id: 'output', label: 'Output', type: definition.outputType }] : []
}

export function canConnectPorts(sourceType: string, sourcePortId: string, targetType: string, targetPortId: string) {
  return Boolean(nodeOutputPorts(sourceType).some((port) => port.id === sourcePortId) && nodeInputPorts(targetType).some((port) => port.id === targetPortId))
}

export function compatibleNodeTypes(sourceType: string) {
  return nodeCatalog.filter((item) => !item.hidden && canConnectNodeTypes(sourceType, item.type))
}
