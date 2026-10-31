import { describeCanvasParameters, canvasParameters, updateNodeParameters } from './canvas-parameters.js'
import { randomUUID } from './ids.js'
import { applyNodeParameter, defaultCanvasProvider, nodeDefaults as schemaDefaults, canvasNodeSchema } from '@forge3d/canvas-core'
import { nodeInputPorts, nodeOutputPorts } from '@forge3d/canvas-core'

export const nodeDefaults = Object.fromEntries(canvasNodeSchema
  .filter((node) => node.role !== 'container' && node.role !== 'result')
  .map((node) => [node.type, { name: node.label, config: schemaDefaults(node.type) }]))

function frameName(message) {
  if (/blahaj|鲨鱼/i.test(message)) return 'Blahaj 3D Reconstruction'
  return '3D Asset Reconstruction'
}

function createFrame(message, nodes = []) {
  return {
    id: slug('frame-main', nodes),
    type: 'frame',
    name: frameName(message),
    config: {},
    ui: { position: { x: 40, y: 80 }, size: { width: 1640, height: 650 } },
  }
}

function slug(type, nodes) {
  let id = type
  let index = 2
  while (nodes.some((node) => node.id === id)) id = `${type}-${index++}`
  return id
}

function createNode(type, nodes) {
  const id = slug(type, nodes)
  const previous = nodes.filter((node) => node.type !== 'frame').at(-1)
  const frame = nodes.find((node) => node.type === 'frame')
  return {
    id,
    type,
    name: nodeDefaults[type].name,
    config: structuredClone(nodeDefaults[type].config),
    ui: { position: { x: previous ? previous.ui.position.x + 340 : 100, y: previous?.ui.position.y ?? 150 }, ...(frame ? { parentFrameId: frame.id } : {}) },
  }
}

function fitFrame(nodes, options = {}) {
  const padding = options.padding ?? 70
  const nodeWidth = options.nodeWidth ?? 260
  const nodeHeight = options.nodeHeight ?? 430
  for (const frame of nodes.filter((node) => node.type === 'frame')) {
    const children = nodes.filter((node) => node.ui.parentFrameId === frame.id)
    if (!children.length) continue

    const minX = Math.min(...children.map((node) => node.ui.position.x))
    const minY = Math.min(...children.map((node) => node.ui.position.y))
    const maxX = Math.max(...children.map((node) => node.ui.position.x + nodeWidth))
    const maxY = Math.max(...children.map((node) => node.ui.position.y + nodeHeight))

    frame.ui.size = { width: maxX - minX + padding * 2, height: maxY - minY + padding * 2 }
    for (const child of children) {
      child.ui.position.x += padding - minX
      child.ui.position.y += padding - minY
    }
  }
  return nodes
}

export function rebuildDagEdges(nodes) {
  const byType = new Map(nodes.map((node) => [node.type, node]))
  const edges = []
  // Ports named after their media type are the generic way in. Labeled ports
  // (front / left / motion) only ever accept their namesake, so an image wire
  // can no longer slide into a view slot just because both carry an image.
  const GENERIC_PORTS = new Set(['image', 'model', 'text'])

  const connect = (sourceType, targetType, ports = {}) => {
    const source = byType.get(sourceType)
    const target = byType.get(targetType)
    if (!source || !target) return
    const usedTargetPorts = new Set(edges.filter((edge) => edge.target.nodeId === target.id).map((edge) => edge.target.port))
    for (const sourcePort of nodeOutputPorts(sourceType)) {
      if (ports.from && sourcePort.id !== ports.from) continue
      const inputs = nodeInputPorts(targetType).filter((candidate) => !usedTargetPorts.has(candidate.id))
      const targetPort = ports.to
        ? inputs.find((candidate) => candidate.id === ports.to)
        : inputs.find((candidate) => candidate.id === sourcePort.id)
          || inputs.find((candidate) => GENERIC_PORTS.has(candidate.id) && (sourcePort.type === 'any' || candidate.type === sourcePort.type || candidate.type === 'any'))
      if (!targetPort) continue
      usedTargetPorts.add(targetPort.id)
      edges.push({
        id: `${source.id}-${sourcePort.id}-${target.id}-${targetPort.id}`,
        source: { nodeId: source.id, port: sourcePort.id },
        target: { nodeId: target.id, port: targetPort.id },
      })
    }
  }

  connect('reference-image', 'generate-image')
  connect('prompt', 'generate-image')
  connect('generate-image', 'image-to-image')
  connect('text-to-image', 'image-to-image')
  connect('reference-image', 'image-decomposition')
  connect('image-decomposition', 'generate-image')
  connect('prompt', 'text-to-image')
  // A review gate is a pass-through for the image stage, so the wire runs
  // through it instead of bypassing it.
  if (byType.has('review')) {
    connect('generate-image', 'review')
    connect('review', 'generate-model', { from: 'image', to: 'image' })
  } else {
    connect('generate-image', 'generate-model')
  }
  connect('reference-image', 'generate-multiview-images')
  connect('prompt', 'generate-multiview-images')
  connect('prompt', 'text-to-3d')
  connect('prompt', 'text-to-motion')
  connect('generate-image', 'smart-mesh')
  connect('prompt', 'smart-mesh')
  connect('reference-image', 'creative-lab')
  connect('generate-image', 'creative-lab')
  // Multi-view images feed the 3D reconstruction stage. Without this the
  // generate-multiview-images node is left dangling before the model node.
  connect('generate-multiview-images', 'multiview-to-3d')
  connect('generate-multiview-images', 'generate-model')
  connect('generate-multiview-images', 'smart-mesh')

  // When no intermediate image node exists, the reference image and prompt feed
  // the 3D model node directly (generate-model / smart-mesh accept image + text).
  // Without this, an image→3D chain leaves reference-image and prompt dangling.
  if (!byType.has('generate-image') && !byType.has('generate-multiview-images')) {
    connect('reference-image', 'generate-model')
    connect('reference-image', 'smart-mesh')
    connect('prompt', 'generate-model')
  }

  const modelSource = byType.has('text-to-3d')
    ? 'text-to-3d'
    : byType.has('multiview-to-3d')
      ? 'multiview-to-3d'
      : byType.has('smart-mesh')
        ? 'smart-mesh'
        : byType.has('creative-lab')
          ? 'creative-lab'
          : 'generate-model'
  // Mesh-refinement stages in pipeline order. Everything present is linked into
  // one chain, so a stage from the print / retopo / rigging families is no
  // longer left dangling the way it was when this list stopped at `segments`.
  const MESH_STAGES = [
    'retopology', 'remesh', 'uv-unwrap', 'texture', 'retexture', 'rigging',
    'animation', 'segments', 'resize-model', 'print-analyze', 'print-repair',
    'auto-split', 'multi-color-print', 'convert-model',
  ]
  // A motion clip is the animation node's second input, not a mesh upstream.
  connect('text-to-motion', 'animation', { from: 'model', to: 'motion' })
  const modelChain = [modelSource, ...MESH_STAGES.filter((type) => byType.has(type))]
  modelChain.slice(1).forEach((type, index) => connect(modelChain[index], type))
  const finalModelType = modelChain.at(-1)
  const finalNodeType = byType.has('export-model') ? 'export-model' : 'model-preview'
  connect(finalModelType, finalNodeType)

  return edges
}

/**
 * Append one frame of nodes to a canvas.
 *
 * @param {string} message — the instruction the section came from (used for naming).
 * @param {string[]} types — node types, in pipeline order.
 * @param {object|null} existingCanvas — canvas to append to.
 * @param {{ configs?: Record<string, object> }} [options] — per-type parameter
 *   overrides applied after the node is created. Without this the section can
 *   only ever run on schema defaults, which is how the canvas ended up with 8K
 *   textures nobody asked for.
 */
export function buildCanvasStructure(message, types, existingCanvas = null, options = {}) {
  const normalizedTypes = [...new Set(types)].filter((type) => nodeDefaults[type])
  if (!normalizedTypes.length) return existingCanvas ? structuredClone(existingCanvas) : baseCanvas(message)

  const existingNodes = existingCanvas ? structuredClone(existingCanvas.nodes) : []
  const sectionNodes = [createFrame(message, existingNodes)]
  for (const type of normalizedTypes) {
    const node = createNode(type, sectionNodes)
    node.id = slug(type, [...existingNodes, ...sectionNodes])
    sectionNodes.push(node)
  }
  fitFrame(sectionNodes)
  if (existingNodes.length) {
    const topLevelNodes = existingNodes.filter((node) => !node.ui.parentFrameId)
    if (topLevelNodes.length) {
      const right = Math.max(...topLevelNodes.map((node) => node.ui.position.x + (node.ui.size?.width ?? 260)))
      sectionNodes[0].ui.position = {
        x: right + 160,
        y: Math.min(...topLevelNodes.map((node) => node.ui.position.y)),
      }
    }
  }
  const nodes = [...existingNodes, ...sectionNodes]
  const edges = [
    ...(existingCanvas ? structuredClone(existingCanvas.edges) : []),
    ...rebuildDagEdges(sectionNodes),
  ]
  const now = new Date().toISOString()
  const canvas = existingCanvas ? structuredClone(existingCanvas) : {
    schemaVersion: '1.0',
    id: `canvas-${randomUUID()}`,
    revision: 0,
    createdAt: now,
  }
  const textTo3d = normalizedTypes.includes('text-to-3d')
  const next = {
    ...canvas,
    name: existingCanvas?.name || (textTo3d ? 'Text to 3D Pipeline' : '3D Asset Pipeline'),
    description: existingCanvas?.description || 'A reusable 3D production canvas created through conversation.',
    revision: existingCanvas ? existingCanvas.revision + 1 : 1,
    updatedAt: now,
    nodes,
    edges,
    viewport: existingCanvas?.viewport || { x: 80, y: 160, zoom: 0.72 },
  }

  const configs = options?.configs || {}
  // Only the nodes this call created: a canvas can already hold a node of the
  // same type, and an override must never reach back into an earlier section.
  const created = new Map(sectionNodes.filter((node) => node.type !== 'frame').map((node) => [node.type, node]))
  for (const [type, config] of Object.entries(configs)) {
    if (!config || typeof config !== 'object') continue
    const node = created.get(type)
    if (!node) {
      throw new Error(`configs mentions "${type}", which is not part of this build (${normalizedTypes.join(', ')})`)
    }
    // Reject loudly: a silently dropped override would look applied in the tool
    // result while the canvas still runs on the default.
    try {
      updateNodeParameters(next, node.id, config)
    } catch (error) {
      throw new Error(`${type}: ${error.message}`)
    }
  }
  return next
}

/** Node types that only display what flows through them (Asset Preview). */
const PREVIEW_TYPES = new Set(canvasNodeSchema.filter((node) => node.role === 'result').map((node) => node.type))

/** One wire, named the way a wire tie names its members. */
function wireKeyOf(edge) {
  return `${edge.source.nodeId}:${edge.source.port}->${edge.target.nodeId}:${edge.target.port}`
}

/** Column width the canvas lays a section out with. */
const COLUMN_GAP = 340

/**
 * Re-pack each frame's children into one row and resize the frame to fit.
 * A multi-row section is left where the user put it — only its frame resizes.
 */
function compactFrames(nodes, options = {}) {
  if (options.compact === false) return
  for (const frame of nodes.filter((node) => node.type === 'frame')) {
    const children = nodes.filter((node) => node.ui?.parentFrameId === frame.id)
    if (!children.length) continue
    const ordered = [...children].sort((left, right) => left.ui.position.x - right.ui.position.x)
    const baseline = ordered[0].ui.position.y
    const singleRow = ordered.every((node) => Math.abs(node.ui.position.y - baseline) < 80)
    if (singleRow) {
      ordered.forEach((node, index) => {
        node.ui.position.x = ordered[0].ui.position.x + index * COLUMN_GAP
        node.ui.position.y = baseline
      })
    }
    const minX = Math.min(...ordered.map((node) => node.ui.position.x))
    const minY = Math.min(...ordered.map((node) => node.ui.position.y))
    const maxX = Math.max(...ordered.map((node) => node.ui.position.x + (node.ui.size?.width ?? 260)))
    const maxY = Math.max(...ordered.map((node) => node.ui.position.y + (node.ui.size?.height ?? 430)))
    frame.ui.size = { width: maxX - minX + 140, height: maxY - minY + 140 }
  }
}

/**
 * Delete nodes and repair the graph around them.
 *
 * Deleting a stage used to be a manual JSON edit: drop the node, drop its wires,
 * then reconnect upstream to downstream by hand. This does that. Preview slots
 * are left to the store's result-slot reconciler, which knows which slot belongs
 * to which stage — guessing from edges would delete slots that are fed by their
 * stage rather than by a wire.
 *
 * @param {{ nodes: any[], edges: any[], revision?: number, wireTies?: any[] }} canvas
 * @param {string[]} nodeIds
 * @param {{ compact?: boolean }} [options]
 */
export function removeCanvasNodes(canvas, nodeIds, options = {}) {
  const next = structuredClone(canvas)
  const doomed = new Set((nodeIds || []).filter((id) => typeof id === 'string'))
  const gone = next.nodes.filter((node) => doomed.has(node.id))
  if (!gone.length) return { canvas: next, removed: [], bridged: [], changed: false }

  const removedIds = new Set(gone.map((node) => node.id))
  const removed = gone.map((node) => ({ id: node.id, type: node.type, name: node.name }))
  const incoming = next.edges.filter((edge) => removedIds.has(edge.target.nodeId) && !removedIds.has(edge.source.nodeId))
  // Wires leaving the doomed region. A deleted stage usually takes its preview
  // slot with it, so follow the chain through deleted nodes to the first
  // surviving target instead of stopping at the immediate neighbour.
  const outgoing = []
  const walkDownstream = (edge) => {
    if (!removedIds.has(edge.target.nodeId)) {
      outgoing.push(edge)
      return
    }
    for (const deeper of next.edges.filter((candidate) => candidate.source.nodeId === edge.target.nodeId)) walkDownstream(deeper)
  }
  for (const edge of next.edges.filter((candidate) => removedIds.has(candidate.source.nodeId))) walkDownstream(edge)
  next.nodes = next.nodes.filter((node) => !removedIds.has(node.id))
  next.edges = next.edges.filter((edge) => !removedIds.has(edge.source.nodeId) && !removedIds.has(edge.target.nodeId))

  // Whatever fed the deleted stage now feeds what the stage fed.
  const bridged = []
  for (const inEdge of incoming) {
    for (const outEdge of outgoing) {
      const source = next.nodes.find((node) => node.id === inEdge.source.nodeId)
      const target = next.nodes.find((node) => node.id === outEdge.target.nodeId)
      if (!source || !target) continue
      const sourcePort = nodeOutputPorts(source.type).find((port) => port.id === inEdge.source.port)
      if (!sourcePort) continue
      const used = new Set(next.edges.filter((edge) => edge.target.nodeId === target.id).map((edge) => edge.target.port))
      const targetPort = nodeInputPorts(target.type).find((port) => port.id === outEdge.target.port && !used.has(port.id))
        || nodeInputPorts(target.type).find((port) => !used.has(port.id) && ['image', 'model', 'text'].includes(port.id) && (port.type === sourcePort.type || port.type === 'any' || sourcePort.type === 'any'))
      if (!targetPort) continue
      if (sourcePort.type !== 'any' && targetPort.type !== 'any' && sourcePort.type !== targetPort.type) continue
      if (next.edges.some((edge) => edge.source.nodeId === source.id && edge.target.nodeId === target.id && edge.target.port === targetPort.id)) continue
      let id = `edge-${source.id}-${target.id}`
      let suffix = 2
      while (next.edges.some((edge) => edge.id === id)) id = `edge-${source.id}-${target.id}-${suffix++}`
      next.edges.push({ id, source: { nodeId: source.id, port: sourcePort.id }, target: { nodeId: target.id, port: targetPort.id } })
      bridged.push({ from: source.id, to: target.id })
    }
  }

  // A tie pins specific wires; a tie whose wires are all gone is dead weight.
  if (Array.isArray(next.wireTies)) {
    const live = new Set(next.edges.map(wireKeyOf))
    next.wireTies = next.wireTies
      .map((tie) => ({ ...tie, members: (tie.members || []).filter((member) => live.has(member)) }))
      .filter((tie) => tie.members.length > 0)
  }

  compactFrames(next.nodes, options)
  next.revision = (canvas.revision || 0) + 1
  next.updatedAt = new Date().toISOString()
  return { canvas: next, removed, bridged, changed: true }
}

function requestedStructure(message) {
  const lower = message.toLowerCase()
  const imageFirst = /图生|文字.*生成图片|图片.*(?:生成|转).*3d|根据图片.*3d|image.*(?:to|into).*3d|reference.*3d/i.test(message)
  const textFirst = /文生|文字.*(?:生成|转).*3d|text.*(?:to|into).*3d/i.test(message)
  if (!/创建|新建|构建|搭建|设计|重建|build|create|construct|canvas|流程/i.test(message) || (!imageFirst && !textFirst)) return null
  if (imageFirst) return ['reference-image', 'prompt', 'generate-image', 'generate-model', 'export-model']
  return ['prompt', 'text-to-3d', 'export-model']
}

function baseCanvas(message) {
  const lower = message.toLowerCase()
  const name = lower.includes('prop') || message.includes('道具') ? 'Game Prop Pipeline' : '3D Asset Pipeline'
  const textTo3d = /text[ -]?to[ -]?3d|generate (?:a )?(?:3d )?model from (?:text|a prompt|a description)|文生3d|文字生成3d|文本生成3d|提示词生成3d|根据描述生成3d/i.test(message)
  const types = textTo3d
    ? ['prompt', 'text-to-3d', 'export-model']
    : ['reference-image', 'prompt', 'generate-image', 'generate-model', 'export-model']
  const nodes = [createFrame(message)]
  for (const type of types) nodes.push(createNode(type, nodes))
  fitFrame(nodes)
  return {
    schemaVersion: '1.0',
    id: `canvas-${randomUUID()}`,
    name,
    description: 'A reusable 3D production canvas created through conversation.',
    revision: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    nodes,
    edges: rebuildDagEdges(nodes),
    viewport: { x: 80, y: 160, zoom: 0.72 },
  }
}

/** Section a stage edit applies to: the requested frame, else the newest one. */
function targetFrameId(canvas, frameId) {
  const frames = canvas.nodes.filter((node) => node.type === 'frame')
  if (frameId) {
    if (!frames.some((frame) => frame.id === frameId)) throw new Error(`Frame not found on the current canvas: ${frameId}`)
    return frameId
  }
  return frames.at(-1)?.id ?? null
}

function sectionMembers(canvas, frameId) {
  return canvas.nodes.filter((node) => node.type !== 'frame' && (node.ui?.parentFrameId ?? null) === frameId)
}

/**
 * Rewire one section from its own nodes. rebuildDagEdges keys nodes by type,
 * so feeding it the whole canvas wired a prompt in one section into a model
 * node in another and dropped every other section's wires.
 */
function rebuildSectionEdges(canvas, frameId) {
  const members = sectionMembers(canvas, frameId)
  const memberIds = new Set(members.map((node) => node.id))
  const kept = canvas.edges.filter((edge) => !memberIds.has(edge.source.nodeId) && !memberIds.has(edge.target.nodeId))
  canvas.edges = [...kept, ...rebuildDagEdges(members)]
}

function insertBefore(canvas, type, beforeTypes, frameId = targetFrameId(canvas)) {
  const members = sectionMembers(canvas, frameId)
  if (members.some((node) => node.type === type)) return false
  const anchor = members.findLast((node) => !beforeTypes.includes(node.type)) ?? members.at(-1)
  const node = {
    id: slug(type, canvas.nodes),
    type,
    name: nodeDefaults[type].name,
    config: structuredClone(nodeDefaults[type].config),
    ui: {
      position: { x: anchor ? anchor.ui.position.x + 340 : 100, y: anchor?.ui.position.y ?? 150 },
      ...(frameId ? { parentFrameId: frameId } : {}),
    },
  }
  const before = members.find((candidate) => beforeTypes.includes(candidate.type))
  const index = before ? canvas.nodes.indexOf(before) : canvas.nodes.length
  canvas.nodes.splice(index, 0, node)
  return node
}

export function addCanvasStage(canvas, type, message = '', frameId = undefined) {
  const nextCanvas = structuredClone(canvas)
  const allowedTypes = new Set(['frame', ...Object.keys(nodeDefaults)])
  if (!allowedTypes.has(type)) throw new Error(`Unsupported canvas node type: ${type}`)

  const changedNodeIds = []
  if (type === 'frame') {
    const frame = createFrame(message, nextCanvas.nodes)
    nextCanvas.nodes.push(frame)
    changedNodeIds.push(frame.id)
    nextCanvas.revision += 1
    nextCanvas.updatedAt = new Date().toISOString()
    return { canvas: nextCanvas, changedNodeIds, structureChanged: true }
  }

  const sectionId = targetFrameId(nextCanvas, frameId)
  const added = insertBefore(nextCanvas, type, type === 'review' ? ['generate-model', 'multiview-to-3d'] : ['export-model', 'model-preview'], sectionId)
  if (!added) {
    return { canvas: nextCanvas, changedNodeIds, structureChanged: false }
  }
  changedNodeIds.push(added.id)

  rebuildSectionEdges(nextCanvas, sectionId)
  fitFrame(nextCanvas.nodes)
  nextCanvas.revision += 1
  nextCanvas.updatedAt = new Date().toISOString()
  return { canvas: nextCanvas, changedNodeIds, structureChanged: true }
}

/**
 * add_canvas_node as the agent calls it. Sections already on the canvas are
 * demos the user edits by hand, so a node only joins one when the user named
 * it (frameId) or when this turn built it. Otherwise it starts its own section.
 */
export function addAgentCanvasNode(canvas, type, message = '', { frameId = undefined, changes = [] } = {}) {
  if (type === 'frame' || frameId) return addCanvasStage(canvas, type, message, frameId)
  const addedThisTurn = new Set(changes.map((change) => change.nodeId))
  const turnFrame = canvas.nodes.filter((node) => node.type === 'frame' && addedThisTurn.has(node.id)).at(-1)
  if (turnFrame) return addCanvasStage(canvas, type, message, turnFrame.id)
  if (!nodeDefaults[type]) throw new Error(`Unsupported canvas node type: ${type}`)
  const existingIds = new Set(canvas.nodes.map((node) => node.id))
  const next = buildCanvasStructure(message, [type], canvas)
  return { canvas: next, changedNodeIds: next.nodes.filter((node) => !existingIds.has(node.id)).map((node) => node.id), structureChanged: true }
}

function parameterHelpType(message) {
  if (/segments?|split|拆件|拆分|分件/i.test(message)) return 'segments'
  if (/smart[ -]?mesh|智能网格/i.test(message)) return 'smart-mesh'
  if (/retopo|拓扑|减面/i.test(message)) return 'retopology'
  if (/texture|贴图|纹理/i.test(message)) return 'texture'
  if (/text[ -]?to[ -]?3d|文生3d/i.test(message)) return 'text-to-3d'
  if (/multi[ -]?view|多视角|四视图/i.test(message)) return 'multiview-to-3d'
  if (/image[ -]?to[ -]?3d|图生3d/i.test(message)) return 'generate-model'
  if (/prompt|提示词/i.test(message)) return 'prompt'
  return null
}

function numberFrom(match) {
  if (!match) return null
  const value = Number(match[1].replaceAll(',', ''))
  return Number.isFinite(value) ? value : null
}

function setParameter(canvas, changes, type, field, value) {
  const node = canvas.nodes.find((candidate) => candidate.type === type)
  const definition = canvasParameters[type]?.fields[field]
  if (!node || !definition) return false
  if (definition.kind === 'number' && (value < definition.min || value > definition.max || value % definition.step !== 0)) return false
  if (definition.kind === 'enum' && !definition.values.includes(value)) return false
  const previousValue = node.config[field]
  if (previousValue === value) return true
  node.config = applyNodeParameter(type, node.config, field, value, canvas.provider || defaultCanvasProvider)
  changes.push({ nodeId: node.id, nodeLabel: canvasParameters[type].label, fieldLabel: definition.label, previousValue, value })
  return true
}

export function applyParameterChanges(message, canvas, changes) {
  const lower = message.toLowerCase()
  const retopoFaces = numberFrom(lower.match(/(?:retopo(?:logy)?|拓扑|减面)[^\d]{0,30}(\d[\d,]*)\s*(?:faces?|面)?/))
    ?? numberFrom(lower.match(/(?:face limit|target faces?|目标面数)[^\d]{0,12}(\d[\d,]*)/))
  if (retopoFaces !== null) setParameter(canvas, changes, 'retopology', 'faceLimit', retopoFaces)

  const retopoTopology = lower.match(/(?:retopo(?:logy)?|拓扑|减面)[^.;；。]{0,50}(triangle|quad|三角面|四边面)/)?.[1]
    ?? lower.match(/(?:topology|面类型)[^.;；。]{0,12}(triangle|quad|三角面|四边面)/)?.[1]
  if (retopoTopology) {
    setParameter(canvas, changes, 'retopology', 'topology', /quad|四边面/.test(retopoTopology) ? 'quad' : 'triangle')
  }

  const generatedFaces = numberFrom(lower.match(/(?:text[ -]?to[ -]?3d|image[ -]?to[ -]?3d|generate(?:d)?|生成)[^\d]{0,30}(\d[\d,]*)\s*(?:faces?|面)/))
    ?? numberFrom(lower.match(/(?:face count|生成面数)[^\d]{0,12}(\d[\d,]*)/))
  if (generatedFaces !== null) {
    const type = canvas.nodes.some((node) => node.type === 'text-to-3d') ? 'text-to-3d' : canvas.nodes.some((node) => node.type === 'multiview-to-3d') ? 'multiview-to-3d' : 'generate-model'
    setParameter(canvas, changes, type, 'faceCount', generatedFaces)
  }

  const resolution = lower.match(/\b(2k|4k|8k)\b/)?.[1]
  if (resolution && /texture|uv|resolution|贴图|纹理|分辨率/i.test(message)) {
    setParameter(canvas, changes, 'texture', 'textureQuality', { '2k': 'standard', '4k': 'detailed', '8k': 'extreme' }[resolution])
  }

  const version = lower.match(/\b(v(?:2\.5|3\.0|3\.1)(?:-\d{8})?)\b/)?.[1]
  if (version) {
    const canonical = { 'v2.5': 'v2.5-20250123', 'v3.0': 'v3.0-20250812', 'v3.1': 'v3.1-20260211' }[version] || version
    const type = canvas.nodes.some((node) => node.type === 'text-to-3d') ? 'text-to-3d' : canvas.nodes.some((node) => node.type === 'multiview-to-3d') ? 'multiview-to-3d' : 'generate-model'
    setParameter(canvas, changes, type, 'modelVersion', canonical)
  }
}

export function planCanvas(message, existingCanvas) {
  const lower = message.toLowerCase()
  const requestedTypes = requestedStructure(message)
  if (requestedTypes && existingCanvas) {
    const existingNodeIds = new Set(existingCanvas.nodes.map((node) => node.id))
    const canvas = buildCanvasStructure(message, requestedTypes, existingCanvas)
    return {
      canvas,
      reply: `I built a ${requestedTypes.includes('text-to-3d') ? 'text-to-3D' : 'image-first 3D'} canvas with ${requestedTypes.length} nodes inside one frame.`,
      changedNodeIds: canvas.nodes.filter((node) => !existingNodeIds.has(node.id)).map((node) => node.id),
      structureChanged: true,
    }
  }
  const canvas = existingCanvas ? structuredClone(existingCanvas) : baseCanvas(message)
  const changes = []
  const structuralChanges = []
  const helpRequest = existingCanvas && /(?:what|which|show|list).*(?:parameters?|settings?)|(?:parameters?|settings?).*(?:available|adjust|change)|哪些?参数|参数.*(?:可以|能).*(?:调|改)|有什么.*参数/i.test(message)

  if (helpRequest) {
    const description = describeCanvasParameters(canvas, parameterHelpType(message))
    return { canvas, reply: description || 'This canvas has no adjustable parameters.', changedNodeIds: [], structureChanged: false }
  }

  if (/审核|审查|确认|review|approval|approve/i.test(message)) {
    const added = insertBefore(canvas, 'review', ['generate-model', 'multiview-to-3d'])
    if (added) structuralChanges.push(added.id)
  }
  if (/低模|low[ -]?poly|retopo/.test(lower)) {
    const added = insertBefore(canvas, 'retopology', ['texture', 'export-model', 'model-preview'])
    if (added) structuralChanges.push(added.id)
  }
  if (/贴图|texture|pbr/.test(lower)) {
    const added = insertBefore(canvas, 'texture', ['export-model', 'model-preview'])
    if (added) structuralChanges.push(added.id)
  }
  if (/rigging|rig|骨骼|绑定/.test(lower)) {
    const added = insertBefore(canvas, 'rigging', ['segments', 'export-model', 'model-preview'])
    if (added) structuralChanges.push(added.id)
  }
  if (/segments?|split|拆件|拆分|分件/.test(lower)) {
    const added = insertBefore(canvas, 'segments', ['export-model', 'model-preview'])
    if (added) structuralChanges.push(added.id)
  }

  if (existingCanvas) applyParameterChanges(message, canvas, changes)

  if (structuralChanges.length) {
    rebuildSectionEdges(canvas, targetFrameId(canvas))
    fitFrame(canvas.nodes)
  }
  const didChange = !existingCanvas || structuralChanges.length || changes.length
  if (existingCanvas && didChange) canvas.revision += 1
  if (didChange) canvas.updatedAt = new Date().toISOString()

  const reply = existingCanvas
    ? changes.length
      ? changes.map((change) => `${change.nodeLabel}: ${change.fieldLabel} ${change.previousValue} → ${change.value}`).join('\n')
      : structuralChanges.length
        ? `I added ${structuralChanges.length} requested canvas node${structuralChanges.length === 1 ? '' : 's'}.`
        : 'I could not find a supported parameter change. Ask “What parameters can I adjust?” to see the available controls.'
    : `I created “${canvas.name}” as a reusable canvas. You can move nodes freely, edit the structure, and continue refining it through conversation.`

  return {
    canvas,
    reply,
    changedNodeIds: [...new Set([...structuralChanges, ...changes.map((change) => change.nodeId)])],
    structureChanged: !existingCanvas || structuralChanges.length > 0,
  }
}
