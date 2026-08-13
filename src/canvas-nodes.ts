import { canvasNodeSchema } from './canvas-schema'
import type { NodePort, NodePorts, PortType, CanvasNodeSchema } from './canvas-schema'

export { applyNodeParameter, conditionsMatch, hasModelEditor, isExecutableNodeType, nodeDefaults, nodeSchema, parameterRange, canvasNodeSchema, canvasNodeSchemas } from './canvas-schema'
export type { NodeParameter, ParameterCondition, ParameterOption, ParameterRange, CanvasNodeSchema } from './canvas-schema'

export type { NodePort, NodePorts, NodePortSpec, PortType } from './canvas-schema'
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

/** Expands declared ports into the keyed-plus-label shape the graph helpers use. */
function toPortList(ports: NodePorts | undefined): NodePort[] {
  return Object.entries(ports || {}).map(([id, port]) => ({
    ...port,
    id,
    label: port.label || id[0].toUpperCase() + id.slice(1),
  }))
}

export function nodeInputPorts(type: string): NodePort[] {
  return toPortList(nodeDefinition(type)?.inputs)
}

export function nodeOutputPorts(type: string): NodePort[] {
  return toPortList(nodeDefinition(type)?.outputs)
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

/**
 * Resolves which declared ports an edge actually joins, or null when it joins
 * none. Stored edges predating named ports carry the literals `output`/`input`
 * (and the canvas still writes them for the single collapsed handle), so those
 * fall back to the first output and the first type-compatible input.
 */
export function resolveEdgePorts(sourceType: string | undefined, targetType: string | undefined, edge: CanvasGraphEdge) {
  const sourcePorts = sourceType ? nodeOutputPorts(sourceType) : []
  const targetPorts = targetType ? nodeInputPorts(targetType) : []
  const sourcePort = sourcePorts.find((port) => port.id === edge.source?.port)
    || (!edge.source?.port || edge.source.port === 'output' ? sourcePorts[0] : undefined)
  const targetPort = targetPorts.find((port) => port.id === edge.target?.port)
    || (!edge.target?.port || edge.target.port === 'input' ? targetPorts.find((port) => sourcePort && (port.type === 'any' || port.type === sourcePort.type)) : undefined)
  return sourcePort && targetPort ? { sourcePort, targetPort } : null
}

/**
 * Every port pairing one edge stands for.
 *
 * Normally that is the single pair the edge names. A collapsed edge carrying no
 * source port is the exception: when its target accepts several values, every
 * compatible output travels along it, which is how one visual connection from a
 * multi-view node feeds all four views into a model node.
 */
export function resolveEdgePortPairs(sourceType: string | undefined, targetType: string | undefined, edge: CanvasGraphEdge) {
  const pair = resolveEdgePorts(sourceType, targetType, edge)
  if (!pair || !sourceType) return []
  const named = edge.source?.port && edge.source.port !== 'output'
  if (named || !pair.targetPort.multiple) return [pair]
  return nodeOutputPorts(sourceType)
    .filter((sourcePort) => pair.targetPort.type === 'any' || sourcePort.type === pair.targetPort.type)
    .map((sourcePort) => ({ sourcePort, targetPort: pair.targetPort }))
}

/**
 * Reads one node's produced values keyed by output port id.
 *
 * A run's own result is authoritative; the config a canvas saved earlier is the
 * fallback, which is what lets a single-node run read upstream results that this
 * run never executed. Flat `preview`/`previews`/`viewPreviews` shapes are mapped
 * onto declared ports so a node that has not been migrated still resolves.
 */
export function nodeOutputPortValues(node: CanvasGraphNode, produced?: Record<string, unknown> | null): Record<string, unknown> {
  const ports = nodeOutputPorts(node.type)
  if (!ports.length) return {}
  const fromPorts = (produced?.ports || null) as Record<string, unknown> | null
  const values: Record<string, unknown> = {}
  const config = node.config || {}
  const viewPreviews = (config.viewPreviews || {}) as Record<string, unknown>
  const previews = (Array.isArray(config.previews) ? config.previews : []) as unknown[]

  for (const port of ports) {
    if (fromPorts && fromPorts[port.id] != null) {
      values[port.id] = fromPorts[port.id]
      continue
    }
    // A port named after a view reads that view; an image port otherwise takes
    // the node's single result, and `previews` being a candidate list means its
    // selected entry wins.
    const fallback = port.type === 'model'
      ? produced?.modelUrl ?? config.modelUrl
      : port.type === 'text'
        ? produced?.text ?? config.prompt
        : viewPreviews[port.id]
          ?? produced?.preview
          ?? config.selectedPreview
          ?? config.preview
          ?? previews[0]
    const value = typeof fallback === 'string' ? fallback.trim() : fallback
    if (value != null && value !== '') values[port.id] = value
  }
  return values
}

/**
 * Resolves a node's inputs as a map of input port id to value, following the
 * declared ports rather than guessing from upstream node types. A `multiple`
 * port collects a list; a `fallbackConfig` port falls back to its own config
 * field when nothing is connected.
 *
 * `producedByNodeId` holds results from the current run, which take precedence
 * over the values the canvas saved.
 */
export interface InputSource {
  node: CanvasGraphNode
  /** The upstream output port feeding this input. */
  portId: string
}

/**
 * Which upstream node and output port feeds each of this node's input ports.
 *
 * Callers that need more than the value itself use this: a real backend reads
 * per-node run metadata (an upstream task id, say) that no port value carries.
 */
export function resolveInputSources(
  node: CanvasGraphNode,
  canvas: { nodes: CanvasGraphNode[]; edges?: CanvasGraphEdge[] },
): Record<string, InputSource[]> {
  const byId = new Map(canvas.nodes.map((item) => [item.id, item]))
  const sources: Record<string, InputSource[]> = {}
  for (const port of nodeInputPorts(node.type)) sources[port.id] = []

  for (const edge of canvas.edges || []) {
    if (edge.target?.nodeId !== node.id) continue
    const source = byId.get(edge.source?.nodeId || '')
    if (!source) continue
    for (const pair of resolveEdgePortPairs(source.type, node.type, edge)) {
      const found = sources[pair.targetPort.id]
      if (!found || found.some((item) => item.node.id === source.id && item.portId === pair.sourcePort.id)) continue
      found.push({ node: source, portId: pair.sourcePort.id })
    }
  }
  return sources
}

export function resolveNodeInputs(
  node: CanvasGraphNode,
  canvas: { nodes: CanvasGraphNode[]; edges?: CanvasGraphEdge[] },
  producedByNodeId: Map<string, Record<string, unknown>> | Record<string, Record<string, unknown>> = new Map(),
): Record<string, unknown> {
  const produced = producedByNodeId instanceof Map ? producedByNodeId : new Map(Object.entries(producedByNodeId))
  const sources = resolveInputSources(node, canvas)
  const resolved: Record<string, unknown> = {}

  for (const port of nodeInputPorts(node.type)) {
    const values: unknown[] = []
    for (const source of sources[port.id] || []) {
      const value = nodeOutputPortValues(source.node, produced.get(source.node.id))[source.portId]
      if (value != null && !values.includes(value)) values.push(value)
    }
    if (!values.length && port.fallbackConfig) {
      const fallback = node.config?.[port.fallbackConfig]
      if (typeof fallback === 'string' ? fallback.trim() : fallback != null) values.push(fallback)
    }
    if (values.length) resolved[port.id] = port.multiple ? values : values[0]
  }
  return resolved
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
    const ports = source && target ? resolveEdgePorts(source.type, target.type, edge) : null
    const { sourcePort, targetPort } = ports || {}
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
        const hasFallback = Boolean(port.fallbackConfig && node.config?.[port.fallbackConfig])
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
