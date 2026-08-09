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
  return nodeOutputPorts(sourceType).some((sourcePort) => nodeInputPorts(targetType).some((targetPort) => canConnectPorts(sourceType, sourcePort.id, targetType, targetPort.id)))
}

export function nodeInputPorts(type: string): NodePort[] {
  const definition = nodeDefinition(type)
  if (!definition) return []
  if (definition.inputPorts?.length) return definition.inputPorts
  return definition.inputTypes.map((portType) => ({
    id: portType,
    label: portType[0].toUpperCase() + portType.slice(1),
    type: portType,
    ...(portType === 'text' ? { configKey: 'prompt' } : {}),
  }))
}

export function nodeOutputPorts(type: string): NodePort[] {
  const definition = nodeDefinition(type)
  if (!definition) return []
  if (definition.outputPorts?.length) return definition.outputPorts
  return definition.outputType ? [{ id: definition.outputType, label: definition.outputType[0].toUpperCase() + definition.outputType.slice(1), type: definition.outputType }] : []
}

export function canConnectPorts(sourceType: string, sourcePortId: string, targetType: string, targetPortId: string) {
  const sourcePort = nodeOutputPorts(sourceType).find((port) => port.id === sourcePortId)
  const targetPort = nodeInputPorts(targetType).find((port) => port.id === targetPortId)
  return Boolean(sourcePort && targetPort && (targetPort.type === 'any' || sourcePort.type === targetPort.type))
}

export function compatibleNodeTypes(sourceType: string) {
  return nodeCatalog.filter((item) => !item.hidden && canConnectNodeTypes(sourceType, item.type))
}

export interface CanvasGraphNode {
  id: string
  type: string
  name?: string
  config?: Record<string, unknown>
}

export interface CanvasGraphEdge {
  source?: { nodeId?: string; port?: string }
  target?: { nodeId?: string; port?: string }
}

export interface CanvasGraphIssue {
  nodeId?: string
  port?: string
  code: 'invalid_edge' | 'incompatible_ports' | 'duplicate_input' | 'required_input_missing' | 'cycle'
  message: string
}

/** Validates the persisted graph rather than the UI handles that render it. */
export function validateCanvasGraph(nodes: CanvasGraphNode[], edges: CanvasGraphEdge[], { requireInputs = false } = {}): CanvasGraphIssue[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const issues: CanvasGraphIssue[] = []
  const inputCounts = new Map<string, number>()
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]))

  for (const edge of edges) {
    const source = byId.get(edge.source?.nodeId || '')
    const target = byId.get(edge.target?.nodeId || '')
    const sourcePorts = source ? nodeOutputPorts(source.type) : []
    const sourcePort = sourcePorts.find((port) => port.id === edge.source?.port)
      || (!edge.source?.port || edge.source.port === 'output' ? sourcePorts[0] : undefined)
    const targetPorts = target ? nodeInputPorts(target.type) : []
    const targetPort = targetPorts.find((port) => port.id === edge.target?.port)
      || (!edge.target?.port || edge.target.port === 'input' ? targetPorts.find((port) => sourcePort && (port.type === 'any' || port.type === sourcePort.type)) : undefined)
    if (!source || !target || !sourcePort || !targetPort) {
      issues.push({ nodeId: target?.id, port: edge.target?.port, code: 'invalid_edge', message: 'Connection references a node or port that does not exist.' })
      continue
    }
    if (targetPort.type !== 'any' && targetPort.type !== sourcePort.type) {
      issues.push({ nodeId: target.id, port: targetPort.id, code: 'incompatible_ports', message: `${targetPort.label} accepts ${targetPort.type}, not ${sourcePort.type}.` })
      continue
    }
    const key = `${target.id}:${targetPort.id}`
    inputCounts.set(key, (inputCounts.get(key) || 0) + 1)
    if (!targetPort.multiple && inputCounts.get(key)! > 1) {
      issues.push({ nodeId: target.id, port: targetPort.id, code: 'duplicate_input', message: `${targetPort.label} accepts only one connection.` })
    }
    outgoing.get(source.id)?.push(target.id)
  }

  if (requireInputs) {
    for (const node of nodes) {
      for (const port of nodeInputPorts(node.type)) {
        const hasConnection = Boolean(inputCounts.get(`${node.id}:${port.id}`))
        const hasFallback = Boolean(port.configKey && node.config?.[port.configKey])
        if (port.required && !hasConnection && !hasFallback) {
          issues.push({ nodeId: node.id, port: port.id, code: 'required_input_missing', message: `${node.name || node.type} requires ${port.label}.` })
        }
      }
    }
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true
    if (visited.has(id)) return false
    visiting.add(id)
    const cyclic = outgoing.get(id)?.some(visit)
    visiting.delete(id)
    visited.add(id)
    return Boolean(cyclic)
  }
  if (nodes.some((node) => visit(node.id))) issues.push({ code: 'cycle', message: 'Canvas connections must not contain a cycle.' })
  return issues
}
