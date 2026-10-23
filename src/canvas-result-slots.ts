import { activeInputPorts, nodeInputPorts, nodeOutputPorts } from './canvas-nodes'
import { normalizeNodeConfig, nodeRole } from './canvas-schema'
import { isResultType, resultSpecs, type ResultSpec } from './canvas-results'

/**
 * Keeps every execution node's result slots on the canvas.
 *
 * A slot is a result node owned by one stage: `generatedAssets.resultOf.sourceId`
 * names the stage and `generatedAssets.slot` names which of its results it holds.
 * A run fills a slot; it never creates, removes or moves one. So the graph looks
 * the same before and after a run, which is what lets a workflow be reused and
 * what lets Run downstream plan the whole chain up front.
 *
 * Wiring a stage with slots: the stage feeds each slot, and the slot feeds
 * whatever the stage's outgoing edges fed. A downstream node therefore reads the
 * media through the slot while the run engine still sees the stage as its source.
 */

const COLUMN_GAP = 340
const ROW_GAP = 270

export interface SlotPort {
  nodeId: string
  port: string
}

export interface SlotEdge {
  id: string
  source?: SlotPort
  target?: SlotPort
  sourceHandle?: string
  targetHandle?: string
  data?: unknown
  [key: string]: unknown
}

export interface SlotNode {
  id: string
  type?: string
  name?: string
  position?: { x: number; y: number }
  parentNode?: string
  config?: Record<string, unknown>
  generatedAssets?: Record<string, unknown>
  ui?: { position?: { x: number; y: number }; parentFrameId?: string; [key: string]: unknown }
  data?: {
    canvasType?: string
    status?: string
    config?: Record<string, unknown>
    generatedAssets?: Record<string, unknown>
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface SlotCanvas {
  nodes: SlotNode[]
  edges?: SlotEdge[]
  provider?: string
}

type Shape = 'domain' | 'canvas'

function shapeOf(canvas: SlotCanvas): Shape {
  return canvas.nodes.some((node) => node.type === 'canvas') ? 'canvas' : 'domain'
}

function typeOf(node: SlotNode, shape: Shape) {
  return shape === 'canvas' ? node.data?.canvasType || node.type : node.type
}

function configOf(node: SlotNode, shape: Shape) {
  // A stored node keeps its three trees at the top level; a canvas node keeps
  // them under `data`.
  return (shape === 'canvas' ? node.data?.config : node.config) || {}
}

function generatedOf(node: SlotNode, shape: Shape) {
  return (shape === 'canvas' ? node.data?.generatedAssets : node.generatedAssets) || {}
}

function setGenerated(node: SlotNode, shape: Shape, generated: Record<string, unknown>) {
  if (shape === 'canvas') node.data = { ...node.data, generatedAssets: generated }
  else node.generatedAssets = generated
}

function positionOf(node: SlotNode, shape: Shape) {
  if (shape === 'canvas') return node.position || { x: 0, y: 0 }
  const ui = (node.ui || {}) as { position?: { x: number; y: number } }
  return ui.position || { x: 0, y: 0 }
}

function setPosition(node: SlotNode, shape: Shape, position: { x: number; y: number }) {
  if (shape === 'canvas') node.position = position
  else node.ui = { ...(node.ui || {}), position }
}

function parentOf(node: SlotNode, shape: Shape) {
  if (shape === 'canvas') return node.parentNode
  return (node.ui as { parentFrameId?: string } | undefined)?.parentFrameId
}

function stageOf(node: SlotNode, shape: Shape) {
  const origin = generatedOf(node, shape).resultOf as { sourceId?: string } | undefined
  return origin?.sourceId || null
}

function edgesOf(canvas: SlotCanvas, shape: Shape): SlotEdge[] {
  return (canvas.edges || []).map((edge) => shape === 'canvas'
    ? { ...edge, source: { nodeId: edge.source as unknown as string, port: edge.sourceHandle || 'output' }, target: { nodeId: edge.target as unknown as string, port: edge.targetHandle || 'input' } }
    : edge)
}

function sameSpec(node: SlotNode, shape: Shape, spec: ResultSpec) {
  const generated = generatedOf(node, shape)
  // The slot name is authoritative once it is written; a node made before slots
  // had names falls back to its type.
  if (typeof generated.slot === 'string') return generated.slot === spec.slot
  return typeOf(node, shape) === spec.type
}

/** Every node reachable from a stage along its own outgoing edges. */
function downstreamOf(startId: string, edges: SlotEdge[]) {
  const found = new Set<string>()
  const queue = [startId]
  while (queue.length) {
    const current = queue.shift()!
    for (const edge of edges) {
      if (edge.source?.nodeId !== current || found.has(edge.target!.nodeId)) continue
      found.add(edge.target!.nodeId)
      queue.push(edge.target!.nodeId)
    }
  }
  found.delete(startId)
  return found
}

function outputPortOf(type: string) {
  return nodeOutputPorts(type)[0]
}

function inputPortOf(type: string) {
  return nodeInputPorts(type)[0]
}

/** The port a stage's media leaves on, and the port a downstream node takes it. */
function mediaPair(sourceType: string, targetType: string) {
  const source = nodeOutputPorts(sourceType).find((port) => port.type === 'image' || port.type === 'model')
  const target = nodeInputPorts(targetType).find((port) => port.id === source?.id) || nodeInputPorts(targetType).find((port) => source && (port.type === source.type || port.type === 'any'))
  return source && target ? { sourcePort: source.id, targetPort: target.id, multiple: Boolean(target.multiple) } : null
}

/** A slot whose stage no longer wants this slot at all. */
function droppedNow(slot: SlotNode, stage: SlotNode, shape: Shape, provider: string) {
  const type = typeOf(stage, shape) || ''
  const specs = resultSpecs(type, normalizeNodeConfig(type, configOf(stage, shape), provider))
  return !specs.some((spec) => sameSpec(slot, shape, spec))
}

export interface SlotReconcile {
  canvas: SlotCanvas
  /** Nodes created to fill missing slots. */
  added: SlotNode[]
  /** Slot nodes removed because their stage or the count no longer holds them. */
  removed: string[]
  /** Result nodes whose media changed and must be registered with the canvas. */
  materialized: string[]
}

/**
 * Reconciles a canvas in place. `filled` maps a stage id to what its last run
 * produced so a repaired slot can show it; `materialize` turns a stage's raw
 * output into the media a slot of that kind holds.
 */
export function reconcileResultSlots(canvas: SlotCanvas, { filled = new Map<string, Record<string, unknown>>(), materialize = null as null | ((spec: ResultSpec, output: Record<string, unknown>) => Record<string, unknown> | null) } = {}): SlotReconcile {
  const shape = shapeOf(canvas)
  const provider = canvas.provider || 'tripo'
  const edges = edgesOf(canvas, shape)
  const taken = new Set(canvas.nodes.map((node) => node.id))
  const added: SlotNode[] = []
  const removed: string[] = []
  const materialized: string[] = []

  const nodes = canvas.nodes.slice()
  const all = () => [...nodes, ...added]
  const byId = new Map<string, SlotNode>()
  for (const node of all()) byId.set(node.id, node)
  const typeById = (id: string) => {
    const node = byId.get(id)
    return node ? typeOf(node, shape) || '' : ''
  }

  // 1. Which slots each stage should own.
  const owned = new Map<string, SlotNode[]>()
  for (const node of nodes) {
    if (!isResultType(typeOf(node, shape) || '')) continue
    const stage = stageOf(node, shape)
    if (!stage) continue
    owned.set(stage, [...(owned.get(stage) || []), node])
  }
  const wanted = new Map<string, SlotNode[]>()
  for (const node of nodes) {
    const type = typeOf(node, shape) || ''
    if (nodeRole(type) !== 'execution') continue
    const specs = resultSpecs(type, normalizeNodeConfig(type, configOf(node, shape), provider))
    const existing = owned.get(node.id) || []
    const keep: SlotNode[] = []
    for (const spec of specs) {
      const match = existing.find((slot) => sameSpec(slot, shape, spec))
      if (match) {
        keep.push(match)
        continue
      }
      const slot = createSlot(canvas, shape, node, type, spec, taken, filled.get(node.id), materialize)
      added.push(slot)
      byId.set(slot.id, slot)
      keep.push(slot)
      materialized.push(slot.id)
    }
    for (const slot of existing) if (!keep.includes(slot)) removed.push(slot.id)
    wanted.set(node.id, keep)
  }
  const baseEdges = edges.filter((edge) => !isResultType(typeById(edge.source?.nodeId || '')) && !isResultType(typeById(edge.target?.nodeId || '')))

  // 4. Each stage's slots belong in the column between it and what it feeds.
  // Slots that already sit there are left alone, so an untouched canvas keeps
  // whatever the user dragged into place.
  for (const [stageId, slots] of wanted) {
    const stage = byId.get(stageId)
    if (!stage || !slots.length) continue
    const stageX = positionOf(stage, shape).x
    const feeds = [...downstreamOf(stageId, baseEdges)]
      .map((id) => byId.get(id))
      .filter((node): node is SlotNode => Boolean(node))
      .map((node) => positionOf(node, shape).x)
      .filter((x) => x > stageX)
    // The column the stage already feeds must clear the slot, so a stage with a
    // downstream node right next to it pushes that node over instead of tucking
    // the slot underneath it.
    const targetX = feeds.length ? Math.min(...feeds) : Infinity
    if (targetX < stageX + COLUMN_GAP * 2) {
      const push = stageX + COLUMN_GAP * 2 - targetX
      for (const nodeId of downstreamOf(stageId, baseEdges)) {
        const node = byId.get(nodeId)
        if (node) setPosition(node, shape, { x: positionOf(node, shape).x + push, y: positionOf(node, shape).y })
      }
    }
    const wantedX = stageX + COLUMN_GAP
    slots.forEach((slot, index) => {
      const current = positionOf(slot, shape)
      // A slot already in the gap stays where the user put it.
      const inGap = current.x > stageX + 8 && current.x < targetX - 8
      if (inGap) return
      setPosition(slot, shape, { x: wantedX, y: positionOf(stage, shape).y + index * ROW_GAP })
    })
  }

  // A slot whose stage is gone goes with it.
  for (const [stageId, slots] of owned) {
    if (wanted.has(stageId)) continue
    if (nodes.some((node) => node.id === stageId)) continue
    for (const slot of slots) removed.push(slot.id)
  }

  // 2. Slots the canvas already holds get any missing media from the last run.
  for (const [stageId, slots] of wanted) {
    const output = filled.get(stageId)
    if (!output || !materialize) continue
    const specs = resultSpecs(typeById(stageId), normalizeNodeConfig(typeById(stageId), configOf(byId.get(stageId)!, shape), provider))
    for (const slot of slots) {
      const generated = generatedOf(slot, shape)
      if (generated.preview || generated.modelUrl || generated.outputs) continue
      const spec = specs.find((candidate) => sameSpec(slot, shape, candidate))
      const media = spec && materialize(spec, output)
      if (!media) continue
      setGenerated(slot, shape, { ...generated, ...media, resultOf: { ...(generated.resultOf || {}), sourceId: stageId }, slot: spec!.slot, ...(spec!.view ? { view: spec!.view } : {}) })
      materialized.push(slot.id)
    }
  }

  // 3. Rewire: stage -> slot -> whatever the stage fed.
  const nextEdges: SlotEdge[] = []
  const connected = new Set<string>()
  // Only real connections take part; an edge without both ends is left alone.
  const linked = edges.filter((edge) => byId.has(edge.source?.nodeId || '') && byId.has(edge.target?.nodeId || ''))
  const stageEdges = linked.filter((edge) => !isResultType(typeById(edge.source!.nodeId)) && !isResultType(typeById(edge.target!.nodeId)))
  const slotEdges = linked.filter((edge) => isResultType(typeById(edge.source!.nodeId)))
  const dropped = new Set(removed)

  // 3. A stage that just gained slots needs room for them: everything it feeds
  // moves right by the widest slot column, so nothing sits on top of the new
  // nodes. Positions are only touched when slots were actually added.
  // stage -> slot, one per stage and slot
  for (const [stageId, slots] of wanted) {
    const stageType = typeById(stageId)
    for (const slot of slots) {
      const slotType = typeOf(slot, shape) || ''
      // A multi-view stage has one output port per view: each view's slot reads
      // its own port, so Front, Back, Left and Right are four separate wires
      // rather than four wires off the first port.
      const view = generatedOf(slot, shape).view as string | undefined
      const ports = nodeOutputPorts(stageType)
      const source = (view && ports.find((port) => port.id === view))
        || ports.find((port) => {
          const forward = outputPortOf(slotType)
          return forward && (port.type === forward.type || port.type === 'any' || forward.type === 'any')
        })
      const target = outputPortOf(slotType)
      // Export carries no output of its own: its file slot only displays the
      // export, so there is nothing to wire it to.
      if (!source || !target) continue
      const id = `edge-${stageId}-${slot.id}`
      if (nextEdges.some((edge) => edge.id === id) || connected.has(id)) continue
      connected.add(id)
      nextEdges.push(slotLink(stageId, slot.id, source.id, target.id, shape, id))
    }
  }

  for (const edge of stageEdges) {
    const sourceId = edge.source!.nodeId
    const targetId = edge.target!.nodeId
    const slots = wanted.get(sourceId)
    // A stage with slots feeds its slots, not the nodes behind them.
    if (!slots?.length) {
      nextEdges.push(edge)
      continue
    }
    const targetType = typeById(targetId)
    if (!targetType) continue
    const pair = mediaPair(typeById(sourceId), targetType)
    if (!pair) continue
    // The edge kept its own target port: a labeled view feeds that same port
    // downstream, so the four views reach four different inputs.
    const targetPort = nodeInputPorts(targetType).find((port) => port.id === edge.target!.port)
    const collects = Boolean(targetPort?.multiple)
    // A single-value port takes one slot; the rest of the batch stays on the
    // stage's other slots unless the target collects a list.
    const viewSlots = slots.filter((slot) => generatedOf(slot, shape).view)
    // Only ports the downstream actually shows can be a target: a mode that hides
    // the labeled view ports takes the views on its image input instead.
    // Views keep one wire each; a plain image port takes the first so a value
    // is not wired twice into the same input.
    // A list port takes every slot; otherwise every view gets its own wire and a
    // plain image output contributes only its first slot.
    const usable = collects ? slots : viewSlots.length ? viewSlots : slots.slice(0, 1)
    for (const slot of usable) {
      const slotType = typeOf(slot, shape) || ''
      const output = outputPortOf(slotType)
      if (!output) continue
      const view = generatedOf(slot, shape).view as string | undefined
      // A downstream in `images` mode has no labeled view ports, so its single
      // Image input collects the views instead of dropping them.
      const inputs = activeInputPorts(targetType, configOf(byId.get(targetId)!, shape))
      const viewPort = view && inputs.find((port) => port.id === view && (port.type === output.type || port.type === 'any'))
      // A downstream in `images` mode has no labeled view ports: it takes the
      // media on its image input, one wire per view unless the port collects.
      const openInput = viewPort || inputs.find((port) => port.id === output.id && (port.type === output.type || port.type === 'any'))
        || inputs.find((port) => port.type === output.type || port.type === 'any')
      const target = viewPort
        || (targetPort && (targetPort.type === output.type || targetPort.type === 'any') ? targetPort : null)
        || openInput
      if (!target) continue
      // One wire per (slot, target port): two views on the same list port stay two wires.
      const id = `edge-${slot.id}-${targetId}-${target.id}`
      if (connected.has(id)) continue
      connected.add(id)
      nextEdges.push(slotLink(slot.id, targetId, output.id, target.id, shape, id))
    }
  }
  // A stage -> slot wire is enough to know where the media goes: the slot is the
  // stage's output now, so a downstream node that no longer has a wire (because a
  // previous repair re-homed it away) still gets one through the slot.
  for (const [stageId, slots] of wanted) {
    const stageType = typeById(stageId)
    if (!stageType || !slots.length) continue
    const downstream = nodes.filter((node) => {
      const type = typeOf(node, shape) || ''
      return !isResultType(type) && node.id !== stageId && mediaPair(stageType, type)
    })
    for (const node of downstream) {
      const type = typeOf(node, shape) || ''
      // Only a node with no incoming wire at all is filled in; a node that is
      // already fed (by a slot, a reference, a frame) is left as the user wired it.
      if (linked.some((edge) => edge.target?.nodeId === node.id)) continue
      const config = configOf(node, shape)
      const inputs = activeInputPorts(type, config)
      for (const slot of slots) {
        const slotType = typeOf(slot, shape) || ''
        const output = outputPortOf(slotType)
        if (!output) continue
        const view = generatedOf(slot, shape).view as string | undefined
        const target = (view && inputs.find((port) => port.id === view && (port.type === output.type || port.type === 'any')))
          || inputs.find((port) => port.id === output.id && (port.type === output.type || port.type === 'any'))
          || inputs.find((port) => port.type === output.type || port.type === 'any')
        if (!target) continue
        const id = `edge-${slot.id}-${node.id}-${target.id}`
        if (connected.has(id)) continue
        connected.add(id)
        nextEdges.push(slotLink(slot.id, node.id, output.id, target.id, shape, id))
      }
    }
  }

  for (const edge of slotEdges) {
    if (dropped.has(edge.source!.nodeId) || dropped.has(edge.target!.nodeId)) continue
    // A stage -> slot wire is drawn above, from the slot's own view. Keeping a
    // stored one would leave every view wired to whichever port it had before.
    const slot = byId.get(edge.target!.nodeId)
    const slotStage = slot && stageOf(slot, shape)
    if (slotStage && nodeRole(typeById(slotStage)) === 'execution') continue
    nextEdges.push(edge)
  }
  canvas.nodes = [...nodes.filter((node) => !dropped.has(node.id)), ...added]
  const untouched = edges.filter((edge) => !byId.has(edge.source?.nodeId || '') || !byId.has(edge.target?.nodeId || ''))
  canvas.edges = shape === 'canvas'
    ? nextEdges.map((edge) => ({ ...edge, source: edge.source!.nodeId, target: edge.target!.nodeId, sourceHandle: 'output', targetHandle: 'input' }))
    : nextEdges
  if (untouched.length) canvas.edges = [...(canvas.edges as SlotEdge[]), ...untouched]
  return { canvas, added, removed, materialized }
}

function slotLink(sourceId: string, targetId: string, sourcePort: string, targetPort: string, shape: Shape, id = `edge-${sourceId}-${targetId}`): SlotEdge {
  if (shape === 'canvas') {
    return { id, source: { nodeId: sourceId, port: sourcePort }, target: { nodeId: targetId, port: targetPort }, sourceHandle: 'output', targetHandle: 'input', data: { logicalConnections: [{ sourcePort, targetPort }] }, selectable: true, type: 'execution' }
  }
  return { id, source: { nodeId: sourceId, port: sourcePort }, target: { nodeId: targetId, port: targetPort } }
}

function createSlot(canvas: SlotCanvas, shape: Shape, stage: SlotNode, stageType: string, spec: ResultSpec, taken: Set<string>, output: Record<string, unknown> | undefined, materialize: null | ((spec: ResultSpec, output: Record<string, unknown>) => Record<string, unknown> | null), shiftX = 0) {
  const base = `${spec.type}-${stage.id}-${spec.slot.replace(/[^a-z0-9]+/gi, '-')}`
  let id = base
  let index = 2
  while (taken.has(id)) id = `${base}-${index++}`
  taken.add(id)
  const siblings = canvas.nodes.filter((node) => stageOf(node, shape) === stage.id)
  const origin = { ...positionOf(stage, shape), x: positionOf(stage, shape).x + shiftX }
  const media = spec && output && materialize ? materialize(spec, output) : null
  const generated: Record<string, unknown> = {
    resultOf: { sourceId: stage.id },
    slot: spec.slot,
    ...(spec.view ? { view: spec.view } : {}),
    ...(media || {}),
  }
  // The slot column sits between the stage and what it already feeds, so a new
  // column never lands on a node that was there first.
  const siblingX = siblings.map((node) => positionOf(node, shape).x).filter((x) => x > origin.x + 1)
  // A stage with nothing to its right (Export ends the chain) puts its slot one
  // column over; otherwise the slot takes the gap before what it already feeds.
  const columnX = COLUMN_GAP
  const position = { x: origin.x + columnX, y: origin.y + siblings.length * ROW_GAP }
  if (shape === 'canvas') {
    return {
      id,
      type: 'canvas',
      position,
      parentNode: parentOf(stage, shape),
      data: {
        kind: 'OUTPUT',
        label: spec.name,
        detail: spec.type === 'generated-model' ? 'Generated model' : spec.type === 'generated-export' ? 'Exported file' : 'Generated image',
        tone: spec.type === 'generated-model' ? 'green' : 'amber',
        status: 'ready',
        canvasType: spec.type,
        provider: canvas.provider || 'tripo',
        config: {},
        uploadAssets: {},
        generatedAssets: generated,
        inputPorts: [{ ...(inputPortOf(spec.type) || { id: 'input', type: 'image', label: 'Input' }), id: 'input' }],
        outputPorts: nodeOutputPorts(spec.type),
      },
    }
  }
  return {
    id,
    type: spec.type,
    name: spec.name,
    config: {},
    generatedAssets: generated,
    ui: { position, ...(parentOf(stage, shape) ? { parentFrameId: parentOf(stage, shape) } : {}) },
  }
}
