import { allParameters, canvasNodeSchema, isExecutableNodeType, nodeSchema } from './canvas-schema'
import type { NodePort, NodePorts, PortType, CanvasNodeSchema } from './canvas-schema'

export { allParameters, applyNodeParameter, conditionsMatch, hasModelEditor, isExecutableNodeType, isInputNodeType, isResultNodeType, nodeDefaults, nodeRole, nodeSchema, parameterRange, visibleParameters, canvasNodeSchema, canvasNodeSchemas } from './canvas-schema'
export type { NodeParameter, NodeRequirement, NodeRole, ParameterCondition, ParameterOption, ParameterRange, CanvasNodeSchema, CanvasProvider } from './canvas-schema'

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

const namedViewPortIds = ['front', 'back', 'left', 'right']

/** Images unless this Gen HD Model was explicitly set to the labeled-view mode. */
export function modelInputMode(config?: Record<string, unknown> | null): 'images' | 'views' {
  return config?.inputMode === 'views' ? 'views' : 'images'
}

/**
 * A saved Gen HD Model with no mode follows the wires already on it.
 * Named-view wires mean Views. Anything else, including a loose image, means Images.
 */
export function inferModelInputMode(config: Record<string, unknown> | undefined, targetPorts: string[]): 'images' | 'views' {
  if (config?.inputMode === 'views' || config?.inputMode === 'images') return config.inputMode
  return targetPorts.some((port) => namedViewPortIds.includes(port)) ? 'views' : 'images'
}

/** Ports drawn and wired for this node. Gen HD Model shows one image mode at a time. */
export function activeInputPorts(type: string, config?: Record<string, unknown> | null): NodePort[] {
  const ports = nodeInputPorts(type)
  if (type !== 'generate-model') return ports
  const hidden = new Set(modelInputMode(config) === 'views' ? ['image'] : namedViewPortIds)
  return ports.filter((port) => !hidden.has(port.id))
}

export function nodeOutputPorts(type: string): NodePort[] {
  return toPortList(nodeDefinition(type)?.outputs)
}

/** Image or model, from the file the user uploaded. Anything else is not a port. */
export function referenceAssetKind(uploadAssets?: Record<string, unknown> | null): 'image' | 'model' | null {
  if (!uploadAssets) return null
  if (uploadAssets.assetType === 'model') return 'model'
  if (uploadAssets.assetType === 'image') return 'image'
  if (typeof uploadAssets.modelUrl === 'string' && uploadAssets.modelUrl) return 'model'
  if (typeof uploadAssets.assetUrl === 'string' && uploadAssets.assetUrl) return 'image'
  return null
}

/**
 * Ports actually drawn for a node. An upload exposes one output, Image or Model,
 * matching the file. The schema lists both so either connection stays valid.
 */
export function outputPortsOf(type: string, uploadAssets?: Record<string, unknown> | null): NodePort[] {
  if (type !== 'reference-image') return nodeOutputPorts(type)
  const kind = referenceAssetKind(uploadAssets)
  return nodeOutputPorts(type).filter((port) => port.id === kind)
}

export function canConnectPorts(sourceType: string, sourcePortId: string, targetType: string, targetPortId: string) {
  const sourcePort = nodeOutputPorts(sourceType).find((port) => port.id === sourcePortId)
  const targetPort = nodeInputPorts(targetType).find((port) => port.id === targetPortId)
  return Boolean(sourcePort && targetPort && (sourcePort.type === 'any' || targetPort.type === 'any' || sourcePort.type === targetPort.type))
}

export function compatibleNodeTypes(sourceType: string, uploadAssets?: Record<string, unknown> | null) {
  if (sourceType === 'reference-image' && arguments.length > 1) {
    const outputs = outputPortsOf(sourceType, uploadAssets)
    return nodeCatalog.filter((item) => !item.hidden && outputs.some((sourcePort) => nodeInputPorts(item.type).some((targetPort) => sourcePort.type === targetPort.type || targetPort.type === 'any')))
  }
  return nodeCatalog.filter((item) => !item.hidden && canConnectNodeTypes(sourceType, item.type))
}

/** Node types that can feed the given node as an upstream step. */
export function compatibleUpstreamNodeTypes(targetType: string) {
  return nodeCatalog.filter((item) => !item.hidden && canConnectNodeTypes(item.type, targetType))
}

export interface CanvasGraphNode {
  id: string
  type: string
  name?: string
  /** Parameters the user filled in. */
  config?: Record<string, unknown>
  /** What the user uploaded to this node, alongside config. */
  uploadAssets?: Record<string, unknown>
  /** What the node produced by running, alongside config. */
  generatedAssets?: Record<string, unknown>
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
    || (!edge.target?.port || edge.target.port === 'input' ? targetPorts.find((port) => sourcePort && (sourcePort.type === 'any' || port.type === 'any' || port.type === sourcePort.type)) : undefined)
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
    .filter((sourcePort) => sourcePort.type === 'any' || pair.targetPort.type === 'any' || sourcePort.type === pair.targetPort.type)
    .map((sourcePort) => ({ sourcePort, targetPort: pair.targetPort }))
}

/**
 * Reads one node's produced values keyed by output port id.
 *
 * A run's own result is authoritative; the generatedAssets a canvas saved earlier is
 * the fallback, which is what lets a single-node run read upstream results that
 * this run never executed. Flat `preview`/`previews`/`viewPreviews` shapes are
 * mapped onto declared ports so a node that has not been migrated still resolves.
 */
export function nodeOutputPortValues(node: CanvasGraphNode, produced?: Record<string, unknown> | null): Record<string, unknown> {
  const uploads = node.uploadAssets || {}
  const output = node.generatedAssets || {}
  if (node.type === 'reference-image') {
    const kind = referenceAssetKind(uploads)
    const raw = kind === 'model' ? uploads.modelUrl ?? uploads.assetUrl : kind === 'image' ? uploads.assetUrl ?? output.preview : null
    const value = typeof raw === 'string' ? raw.trim() : raw
    return kind && value ? { [kind]: value } : {}
  }
  const ports = nodeOutputPorts(node.type)
  if (!ports.length) return {}
  const fromPorts = (produced?.ports || null) as Record<string, unknown> | null
  const values: Record<string, unknown> = {}
  const config = node.config || {}
  const viewPreviews = (output.viewPreviews || {}) as Record<string, unknown>
  const previews = (Array.isArray(output.previews) ? output.previews : []) as unknown[]

  for (const port of ports) {
    if (fromPorts && fromPorts[port.id] != null) {
      values[port.id] = fromPorts[port.id]
      continue
    }
    // A port named after a view reads that view; an image port otherwise takes
    // the node's single result, and `previews` being a candidate list means its
    // selected entry wins.
    const fallback = port.type === 'model'
      // modelUrl is not a generated key: its only writer used to be the asset
      // upload. A generated-model result node also carries one, so it is read
      // from the result tree too.
      ? produced?.modelUrl ?? uploads.modelUrl ?? output.modelUrl
      : port.type === 'text'
        ? produced?.text ?? config.prompt
        : viewPreviews[port.id]
          ?? produced?.preview
          ?? output.selectedPreview
          ?? output.preview
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
  /** The port an edge issue is about. */
  port?: string
  /** The parameter key a missing-parameter issue is about. */
  parameter?: string
  code: 'invalid_edge' | 'incompatible_ports' | 'duplicate_input' | 'required_parameter_missing' | 'cycle'
  message: string
}

/** How a required parameter is named to the user. */
function parameterLabel(type: string, key: string) {
  const port = nodeInputPorts(type).find((candidate) => candidate.id === key)
  if (port) return port.label
  const parameter = allParameters(nodeSchema(type)?.parameters).find((candidate) => candidate.key === key)
  return parameter?.label || key[0].toUpperCase() + key.slice(1)
}

function labelChoices(labels: string[]) {
  if (labels.length > 2) return `${labels.slice(0, -1).join(', ')}, or ${labels.at(-1)}`
  return labels.length === 2 ? `${labels[0]} or ${labels[1]}` : labels[0]
}

const hasValue = (value: unknown) => (typeof value === 'string' ? Boolean(value.trim()) : value != null)

/**
 * Validates the persisted graph rather than the UI handles that render it.
 *
 * `requireParameters` also checks that every node has the parameters it runs
 * with, which is what the execution API is handed. Pass a set of node ids to
 * check only those: a run constrains the nodes it plans, so a half-built node
 * elsewhere on the canvas cannot block it.
 */
export function validateCanvasGraph(
  nodes: CanvasGraphNode[],
  edges: CanvasGraphEdge[],
  { requireParameters = false }: { requireParameters?: boolean | Iterable<string> } = {},
): CanvasGraphIssue[] {
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
    if (sourcePort.type !== 'any' && targetPort.type !== 'any' && targetPort.type !== sourcePort.type) {
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

  if (requireParameters) {
    const scope = typeof requireParameters === 'boolean' ? null : new Set(requireParameters)
    for (const node of nodes) {
      if (scope && !scope.has(node.id)) continue
      const ports = new Map(nodeInputPorts(node.type).map((port) => [port.id, port]))
      /**
       * Whether this parameter will have a value when the node runs. A parameter
       * an input port carries is filled by that connection — the upstream value
       * does not exist until it runs, so the edge itself is the evidence — or by
       * the port's own fallback field. A parameter with no port is the node's
       * own, so its config is all there is to read.
       *
       * Config is read the way resolveNodeInputs reads it, so a whitespace-only
       * prompt cannot pass here and then resolve to nothing at run time.
       */
      const satisfied = (key: string) => {
        const port = ports.get(key)
        if (!port) return hasValue(node.config?.[key])
        if (inputCounts.get(`${node.id}:${key}`)) return true
        return port.fallbackConfig ? hasValue(node.config?.[port.fallbackConfig]) : false
      }
      for (const requirement of nodeSchema(node.type)?.requires || []) {
        // An array is a set of alternatives: one satisfied parameter covers all.
        const keys = Array.isArray(requirement) ? requirement : [requirement]
        if (keys.some(satisfied)) continue
        const choices = labelChoices(keys.map((key) => parameterLabel(node.type, key)))
        issues.push({ nodeId: node.id, parameter: keys[0], code: 'required_parameter_missing', message: `${node.name || node.type} requires ${choices}.` })
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

/**
 * Which parameters each node is still missing before it can run, keyed by node
 * id, so the canvas can say so itself rather than letting a run reach the server
 * and be refused. Only executable nodes carry work, so only they are reported.
 */
export function missingParametersByNode(canvas: { nodes: CanvasGraphNode[]; edges?: CanvasGraphEdge[] }): Record<string, string[]> {
  const executable = canvas.nodes.filter((node) => isExecutableNodeType(node.type)).map((node) => node.id)
  const missing: Record<string, string[]> = {}
  for (const issue of validateCanvasGraph(canvas.nodes, canvas.edges || [], { requireParameters: executable })) {
    if (issue.code !== 'required_parameter_missing' || !issue.nodeId) continue
    missing[issue.nodeId] = [...(missing[issue.nodeId] || []), issue.message]
  }
  return missing
}
