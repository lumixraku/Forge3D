import { LGraph, LGraphCanvas, LGraphGroup, LiteGraph } from 'litegraph.js'
import { canConnectPorts, conditionsMatch, hasModelEditor, isExecutableNodeType, nodeSchema, parameterRange } from './canvas-nodes'
import { applyNodeParameter } from './canvas-schema'

const NODE_TYPE = 'forge/node'
const PORT_COLOR: Record<string, string> = {
  image: '#64a2c8',
  text: '#e6c34a',
  model: '#8d62f0',
  any: '#9aa39c',
}
const TONE_COLOR: Record<string, string> = {
  cyan: '#0f6e72',
  amber: '#8a5a14',
  violet: '#5b3d8a',
  green: '#1d6b3c',
  rose: '#8a3148',
  slate: '#3c4a52',
}
const PREVIEW_HEIGHT = 148

let nodeTypeReady = false

function ensureNodeType() {
  if (nodeTypeReady) return
  nodeTypeReady = true

  function ForgeNode(this: any) {
    LiteGraph.LGraphNode.prototype._ctor.call(this)
    this.properties.forgeId = ''
    this.properties.canvasType = ''
    this.shape = LiteGraph.ROUND_SHAPE
    this.resizable = false
  }
  ForgeNode.prototype.onConnectInput = function(this: any, targetSlot: number, _type: string, _output: unknown, sourceNode: any, sourceSlot: number) {
    const sourcePort = sourceNode?.outputs?.[sourceSlot]?.forgePortId
    const targetPort = this.inputs?.[targetSlot]?.forgePortId
    return canConnectPorts(sourceNode?.properties?.canvasType, sourcePort, this.properties.canvasType, targetPort)
  }
  ForgeNode.prototype.onConnectionsChange = function(this: any) {
    this.graph?._forgeHost?.scheduleEdges()
  }
  ForgeNode.prototype.onDrawBackground = function(this: any, ctx: CanvasRenderingContext2D) {
    const image = this.previewImage as HTMLImageElement | undefined
    if (!image || this.flags?.collapsed) return
    const width = this.size[0] - 16
    const height = PREVIEW_HEIGHT - 12
    const y = this.size[1] - PREVIEW_HEIGHT + 4
    ctx.save()
    ctx.beginPath()
    if (ctx.roundRect) ctx.roundRect(8, y, width, height, 6)
    else ctx.rect(8, y, width, height)
    ctx.clip()
    const scale = Math.max(width / image.width, height / image.height)
    const drawWidth = image.width * scale
    const drawHeight = image.height * scale
    ctx.drawImage(image, 8 + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight)
    ctx.restore()
  }
  ForgeNode.prototype.onDrawForeground = function(this: any, ctx: CanvasRenderingContext2D) {
    if (!this.properties.missing || this.flags?.collapsed) return
    ctx.font = '11px sans-serif'
    ctx.fillStyle = '#ef5b5b'
    ctx.fillText(String(this.properties.missing), 12, this.size[1] - (this.previewImage ? PREVIEW_HEIGHT + 4 : 8))
  }
  ForgeNode.prototype.onDblClick = function(this: any, event: MouseEvent, pos: number[]) {
    this.graph?._forgeHost?.onNodeDoubleClick(this, event, pos)
  }
  LiteGraph.registerNodeType(NODE_TYPE, ForgeNode)
}

function absolutePosition(node: any, byId: Map<string, any>) {
  let x = node.position?.x || 0
  let y = node.position?.y || 0
  let parentId = node.parentNode
  const seen = new Set<string>()
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = byId.get(parentId)
    if (!parent) break
    x += parent.position?.x || 0
    y += parent.position?.y || 0
    parentId = parent.parentNode
  }
  return { x, y }
}

function previewSource(node: any) {
  const generated = node.data?.generatedAssets || {}
  const uploaded = node.data?.uploadAssets || {}
  return generated.selectedPreview || generated.preview || generated.previews?.[0]
    || uploaded.thumbnailUrl
    || (uploaded.assetType === 'image' ? uploaded.assetUrl : '')
    || ''
}

function pairsOf(edge: any, source: any, target: any) {
  const saved = edge.data?.logicalConnections
  if (saved?.length) return saved
  const outputs = source?.data?.outputPorts || []
  const inputs = target?.data?.inputPorts || []
  const sourceType = source?.data?.canvasType
  const targetType = target?.data?.canvasType
  const named = outputs.flatMap((output: any) => {
    const input = inputs.find((candidate: any) => candidate.id === output.id && canConnectPorts(sourceType, output.id, targetType, candidate.id))
    return input ? [{ sourcePort: output.id, targetPort: input.id }] : []
  })
  if (named.length) return named
  for (const output of outputs) {
    const input = inputs.find((candidate: any) => canConnectPorts(sourceType, output.id, targetType, candidate.id))
    if (input) return [{ sourcePort: output.id, targetPort: input.id }]
  }
  return []
}

function structureKey(nodes: any[], edges: any[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  return JSON.stringify({
    nodes: nodes.map((node) => ({
      id: node.id,
      kind: node.type,
      canvasType: node.data?.canvasType,
      parent: node.parentNode || '',
      inputs: inputPlan(node, edges, byId).map((port: any) => port.id),
      outputs: (node.data?.outputPorts || []).map((port: any) => port.id),
      widgets: widgetPlan(node).map((parameter: any) => parameter.key),
      actions: actionPlan(node).map((action: any) => action.id),
      preview: Boolean(previewSource(node)),
      missing: Boolean(node._missing),
    })),
    edges: edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      pairs: pairsOf(edge, byId.get(edge.source), byId.get(edge.target)),
    })),
  })
}

function inputPlan(node: any, edges: any[], byId: Map<string, any>) {
  if (node.type === 'frame') return []
  const slots: any[] = []
  for (const port of node.data?.inputPorts || []) {
    const count = edges.reduce((total, edge) => {
      if (edge.target !== node.id) return total
      return total + pairsOf(edge, byId.get(edge.source), node).filter((pair: any) => pair.targetPort === port.id).length
    }, 0)
    const copies = port.multiple ? Math.max(1, count + 1) : 1
    for (let index = 0; index < copies; index += 1) slots.push(port)
  }
  return slots
}

function widgetPlan(node: any) {
  if (node.type === 'frame') return []
  const schema = nodeSchema(node.data?.canvasType, node.data?.provider || 'tripo')
  return (schema?.parameters || []).filter((parameter: any) => conditionsMatch(parameter.visibleWhen, node.data?.config || {}))
}

function actionPlan(node: any) {
  if (node.type === 'frame') return []
  const actions: { id: string; label: string }[] = []
  const type = node.data?.canvasType
  const run = node._run
  if (type === 'reference-image') actions.push({ id: 'upload', label: node.data?.uploadAssets?.reference ? 'Replace asset' : 'Upload asset' })
  if (isExecutableNodeType(type) && !['queued', 'running', 'cancelling'].includes(run?.status)) {
    actions.push({ id: 'run', label: 'Run' })
    actions.push({ id: 'downstream', label: 'Run downstream' })
  }
  if (['queued', 'running', 'cancelling'].includes(run?.status)) actions.push({ id: 'stop', label: 'Stop' })
  if (canOpenModel(node)) actions.push({ id: 'model', label: 'Open 3D' })
  return actions
}

function canOpenModel(node: any) {
  const type = node.data?.canvasType
  if (!hasModelEditor(type)) return false
  const uploadedModel = type === 'reference-image' && node.data?.uploadAssets?.assetType === 'model' && typeof node.data?.uploadAssets?.modelUrl === 'string'
  const resultModel = type === 'generated-model' && typeof node.data?.generatedAssets?.modelUrl === 'string'
  return uploadedModel || resultModel || node._run?.status === 'succeeded'
}

export interface GraphHostHandlers {
  onNodes: (nodes: any[]) => void
  onEdges: (edges: any[]) => void
  onParameter: (id: string, key: string, value: unknown) => void
  onName: (id: string, name: string) => void
  onUpload: (id: string) => void
  onRun: (id: string) => void
  onRunDownstream: (id: string) => void
  onStop: () => void
  onOpenModel: (id: string) => void
  onPreview: (preview: { src: string; alt: string }) => void
  onDragStart: () => void
  onDragStop: (payload: { nodes: any[] }) => void
  onSelectionStart: () => void
  onSelectionEnd: () => void
  onConnectStart: (nodeId: string) => void
  onConnectEnd: (payload: { clientX: number; clientY: number; sourceId: string }) => void
  onNodeContextMenu: (payload: { event: MouseEvent; node: any }) => void
  onPaneContextMenu: (event: MouseEvent) => void
  onPaneClick: () => void
  onEdgeClick: (payload: { edge: any; event: MouseEvent }) => void
  onViewport: (viewport: { x: number; y: number; zoom: number }) => void
}

export function createGraphHost(canvas: HTMLCanvasElement, handlers: GraphHostHandlers) {
  ensureNodeType()
  LiteGraph.alt_drag_do_clone_nodes = false
  const graph = new LGraph()
  const view = new LGraphCanvas(canvas, graph)
  view.background_image = LGraphCanvas.DEFAULT_BACKGROUND_IMAGE
  view.clear_background_color = '#121614'
  view.show_info = false
  view.allow_searchbox = false
  view.ds.min_scale = 0.6
  view.ds.max_scale = 3.5
  view.showShowNodePanel = () => {}
  view.processNodeDblClicked = () => {}
  view.processKey = () => {}
  view.onDropItem = () => true
  view.onSelectionChange = () => commitSelection()

  let silent = false
  let interacting = false
  let moved = false
  let dragOrigin: { x: number; y: number } | null = null
  let selecting = false
  let lastStructure = ''
  let edgeQueued = false
  let mode = 'select'
  let theme = 'dark'
  let flowNodes: any[] = []
  let flowEdges: any[] = []
  const images = new Map<string, HTMLImageElement>()

  function publishViewport() {
    const scale = view.ds.scale
    handlers.onViewport({
      x: view.ds.offset[0] * scale,
      y: view.ds.offset[1] * scale,
      zoom: scale,
    })
  }

  // LiteGraph lays the graph out in CSS pixels, then draws into a backing
  // store that is devicePixelRatio times larger. The camera transform is the
  // only place that scale is applied, so pointers and zoom stay in CSS pixels.
  const applyCamera = view.ds.toCanvasContext.bind(view.ds)
  view.ds.toCanvasContext = (ctx: CanvasRenderingContext2D) => {
    const rect = canvas.getBoundingClientRect()
    const ratio = rect.width > 0 ? canvas.width / rect.width : window.devicePixelRatio || 1
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    applyCamera(ctx)
  }
  view.ds.computeVisibleArea = function computeVisibleArea(viewport?: number[]) {
    const rect = canvas.getBoundingClientRect()
    let width = rect.width || canvas.clientWidth
    let height = rect.height || canvas.clientHeight
    let startX = -this.offset[0]
    let startY = -this.offset[1]
    if (viewport) {
      startX += viewport[0] / this.scale
      startY += viewport[1] / this.scale
      width = viewport[2]
      height = viewport[3]
    }
    this.visible_area[0] = startX
    this.visible_area[1] = startY
    this.visible_area[2] = width / this.scale
    this.visible_area[3] = height / this.scale
  }

  // Two-finger drag is a wheel event. Pinch is the same event with ctrlKey,
  // and Chrome sets deltaY = -100 * ln(finger distance ratio). Safari also
  // sends gesture events whose scale is that ratio directly.
  let pinchStart = 0
  const onGestureStart = (event: Event) => {
    event.preventDefault()
    pinchStart = view.ds.scale
  }
  const onGestureChange = (event: Event) => {
    if (!pinchStart || !view.graph || !view.allow_dragcanvas) return
    event.preventDefault()
    const pinch = event as Event & { scale: number; clientX: number; clientY: number }
    const rect = canvas.getBoundingClientRect()
    view.ds.changeScale(pinchStart * pinch.scale, [pinch.clientX - rect.left, pinch.clientY - rect.top])
    view.setDirty(true, true)
    publishViewport()
  }
  const onGestureEnd = () => { pinchStart = 0 }
  canvas.addEventListener('gesturestart', onGestureStart, { passive: false })
  canvas.addEventListener('gesturechange', onGestureChange, { passive: false })
  canvas.addEventListener('gestureend', onGestureEnd)
  canvas.removeEventListener('mousewheel', view._mousewheel_callback)
  canvas.removeEventListener('DOMMouseScroll', view._mousewheel_callback)
  view._mousewheel_callback = (event: WheelEvent) => {
    if (!view.graph || !view.allow_dragcanvas) return
    const rect = canvas.getBoundingClientRect()
    if (event.clientX < rect.left || event.clientX >= rect.right || event.clientY < rect.top || event.clientY >= rect.bottom) return
    event.preventDefault()
    if (event.ctrlKey) {
      if (pinchStart) return
      view.ds.changeScale(view.ds.scale * Math.exp(-event.deltaY / 100), [event.clientX - rect.left, event.clientY - rect.top])
    } else {
      let deltaX = event.deltaX
      let deltaY = event.deltaY
      if (event.deltaMode === 1) {
        deltaX *= 16
        deltaY *= 16
      } else if (event.deltaMode === 2) {
        deltaX *= rect.width
        deltaY *= rect.height
      }
      view.ds.offset[0] -= deltaX / view.ds.scale
      view.ds.offset[1] -= deltaY / view.ds.scale
    }
    view.setDirty(true, true)
    publishViewport()
  }
  canvas.addEventListener('wheel', view._mousewheel_callback, { passive: false })

  function remember(nodes = flowNodes, edges = flowEdges) {
    lastStructure = structureKey(nodes, edges)
  }

  function decorate(nodes: any[], nodeRuns: Record<string, any> = {}, missing: Record<string, string[]> = {}) {
    return nodes.map((node) => ({
      ...node,
      _run: nodeRuns[node.id],
      _missing: missing[node.id]?.length ? `Missing ${missing[node.id].join(', ')}` : '',
    }))
  }

  function byForgeId() {
    return new Map<string, any>(graph._nodes.map((node: any) => [node.properties.forgeId, node]))
  }

  function clearGraph() {
    silent = true
    while (graph._nodes.length) graph.remove(graph._nodes[0])
    while (graph._groups.length) graph.remove(graph._groups[0])
    silent = false
  }

  function toneOf(node: any) {
    if (node._run?.status === 'failed') return '#8a3030'
    if (['queued', 'running', 'cancelling'].includes(node._run?.status)) return '#5d7420'
    return TONE_COLOR[node.data?.tone] || '#3c4a52'
  }

  function buildNode(node: any, byId: Map<string, any>, edges: any[]) {
    const created = LiteGraph.createNode(NODE_TYPE)
    created.properties.forgeId = node.id
    created.properties.canvasType = node.data?.canvasType
    created.properties.missing = node._missing || ''
    created.title = node.data?.label || node.data?.canvasType || 'Node'
    created.color = toneOf(node)
    created.bgcolor = theme === 'light' ? '#f4f7f4' : '#222826'
    created.boxcolor = node._missing ? '#ef5b5b' : created.color
    const position = absolutePosition(node, byId)
    created.pos = [position.x, position.y]
    for (const port of inputPlan(node, edges, byId)) {
      const slot = created.addInput(port.label || port.id, port.type, { forgePortId: port.id })
      slot.color_on = PORT_COLOR[port.type] || PORT_COLOR.any
      slot.color_off = slot.color_on
    }
    for (const port of node.data?.outputPorts || []) {
      const slot = created.addOutput(port.label || port.id, port.type, { forgePortId: port.id })
      slot.color_on = PORT_COLOR[port.type] || PORT_COLOR.any
      slot.color_off = slot.color_on
    }
    for (const parameter of widgetPlan(node)) addParameterWidget(created, node, parameter)
    for (const action of actionPlan(node)) {
      created.addWidget('button', action.label, null, () => runAction(node.id, action.id))
    }
    const size = created.computeSize()
    size[0] = Math.max(250, size[0])
    if (previewSource(node)) size[1] += PREVIEW_HEIGHT
    if (node._missing) size[1] += 16
    created.setSize(size)
    graph.add(created)
    attachPreview(created, previewSource(node))
    return created
  }

  function addParameterWidget(created: any, node: any, parameter: any) {
    const config = node.data?.config || {}
    const commit = (value: unknown) => {
      if (silent) return
      handlers.onParameter(node.id, parameter.key, value)
    }
    if (parameter.control === 'toggle') {
      created.addWidget('toggle', parameter.label, Boolean(config[parameter.key]), (value: boolean) => commit(value))
      return
    }
    if (parameter.control === 'slider') {
      const range = parameterRange(parameter, config) || { min: 0, max: 1, step: 0.01 }
      created.addWidget('number', parameter.label, Number(config[parameter.key] ?? range.min), (value: number) => commit(value), {
        min: range.min, max: range.max, step: range.step, precision: range.step < 1 ? 2 : 0,
      })
      return
    }
    if (parameter.control === 'select' || parameter.control === 'segmented') {
      const options = parameter.options || []
      const labels = options.map((option: any) => String(option.label))
      const current = options.find((option: any) => option.value === config[parameter.key])
      created.addWidget('combo', parameter.label, current ? String(current.label) : labels[0], (label: string) => {
        const option = options.find((item: any) => String(item.label) === label)
        if (option) commit(option.value)
      }, { values: labels })
      return
    }
    created.addWidget('text', parameter.label, config[parameter.key] == null ? '' : String(config[parameter.key]), (value: string) => commit(value), {
      multiline: parameter.control === 'textarea',
    })
  }

  function runAction(id: string, action: string) {
    if (action === 'upload') handlers.onUpload(id)
    if (action === 'run') handlers.onRun(id)
    if (action === 'downstream') handlers.onRunDownstream(id)
    if (action === 'stop') handlers.onStop()
    if (action === 'model') handlers.onOpenModel(id)
  }

  function attachPreview(created: any, url: string) {
    created.previewUrl = url
    if (!url) {
      created.previewImage = null
      return
    }
    const cached = images.get(url)
    if (cached?.complete) {
      created.previewImage = cached
      return
    }
    const image = cached || new Image()
    if (!cached) {
      image.onload = () => view.setDirty(true, true)
      image.src = url
      images.set(url, image)
    }
    created.previewImage = image
  }

  function connectEdges(nodes: any[], edges: any[]) {
    const byId = new Map(nodes.map((node) => [node.id, node]))
    const live = byForgeId()
    silent = true
    for (const edge of edges) {
      const source = live.get(edge.source)
      const target = live.get(edge.target)
      if (!source || !target) continue
      const used = new Map<string, number>()
      for (const pair of pairsOf(edge, byId.get(edge.source), byId.get(edge.target))) {
        const outputIndex = source.outputs?.findIndex((slot: any) => slot.forgePortId === pair.sourcePort) ?? -1
        const seen = used.get(pair.targetPort) || 0
        const matches = (target.inputs || []).map((slot: any, index: number) => slot.forgePortId === pair.targetPort ? index : -1).filter((index: number) => index >= 0)
        const inputIndex = matches[seen] ?? matches[0] ?? -1
        used.set(pair.targetPort, seen + 1)
        if (outputIndex >= 0 && inputIndex >= 0) source.connect(outputIndex, target, inputIndex)
      }
    }
    silent = false
  }

  function rebuild(nodes: any[], edges: any[]) {
    const viewport = { scale: view.ds.scale, offset: [view.ds.offset[0], view.ds.offset[1]] }
    clearGraph()
    silent = true
    const byId = new Map(nodes.map((node) => [node.id, node]))
    for (const node of nodes) {
      if (node.type !== 'frame') continue
      const group = new LGraphGroup(node.data?.label || 'Section')
      group.pos = [node.position?.x || 0, node.position?.y || 0]
      group.size = [node.width || 900, node.height || 600]
      group.color = node.selected ? '#d6ff55' : '#6d8f78'
      group.forgeId = node.id
      graph.add(group)
    }
    for (const node of nodes) {
      if (node.type === 'frame') continue
      buildNode(node, byId, edges)
    }
    silent = false
    connectEdges(nodes, edges)
    applySelection(nodes)
    view.ds.scale = viewport.scale
    view.ds.offset[0] = viewport.offset[0]
    view.ds.offset[1] = viewport.offset[1]
    view.setDirty(true, true)
    remember(nodes, edges)
  }

  function applySelection(nodes: any[]) {
    const wanted = new Set(nodes.filter((node) => node.selected && node.type !== 'frame').map((node) => node.id))
    view.selected_nodes = {}
    for (const node of graph._nodes) {
      const selected = wanted.has(node.properties.forgeId)
      node.is_selected = selected
      if (selected) view.selected_nodes[node.id] = node
    }
    for (const group of graph._groups) {
      const frame = nodes.find((node) => node.id === group.forgeId)
      group.color = frame?.selected ? '#d6ff55' : '#6d8f78'
      group.title = frame?.data?.label || group.title
    }
  }

  function patch(nodes: any[]) {
    const byId = new Map(nodes.map((node) => [node.id, node]))
    if (!interacting) {
      for (const node of graph._nodes) {
        const flow = byId.get(node.properties.forgeId)
        if (!flow) continue
        const position = absolutePosition(flow, byId)
        if (node.pos[0] !== position.x || node.pos[1] !== position.y) node.pos = [position.x, position.y]
        node.title = flow.data?.label || node.title
        node.color = toneOf(flow)
        node.boxcolor = flow._missing ? '#ef5b5b' : node.color
        node.properties.missing = flow._missing || ''
        const url = previewSource(flow)
        if (url !== node.previewUrl) attachPreview(node, url)
        writeWidgetValues(node, flow)
      }
      for (const group of graph._groups) {
        const frame = byId.get(group.forgeId)
        if (!frame) continue
        group.pos = [frame.position?.x || 0, frame.position?.y || 0]
        group.size = [frame.width || 900, frame.height || 600]
        group.title = frame.data?.label || group.title
      }
    }
    applySelection(nodes)
    for (const link of Object.values(graph.links || {}) as any[]) {
      if (!link) continue
      const target = graph.getNodeById(link.target_id)
      const flow = target ? byId.get(target.properties.forgeId) : null
      link.color = ['queued', 'running', 'cancelling'].includes(flow?._run?.status) ? '#d6ff55' : undefined
    }
    view.setDirty(true, true)
  }

  function writeWidgetValues(created: any, node: any) {
    const config = node.data?.config || {}
    let widgetIndex = 0
    for (const parameter of widgetPlan(node)) {
      const widget = created.widgets?.[widgetIndex]
      widgetIndex += 1
      if (!widget || view.node_widget?.[0] === created && view.node_widget?.[1] === widget) continue
      if (parameter.control === 'select' || parameter.control === 'segmented') {
        const option = (parameter.options || []).find((item: any) => item.value === config[parameter.key])
        if (option) widget.value = String(option.label)
      } else if (parameter.control === 'toggle') widget.value = Boolean(config[parameter.key])
      else if (parameter.control === 'slider') widget.value = Number(config[parameter.key] ?? widget.value)
      else widget.value = config[parameter.key] == null ? '' : String(config[parameter.key])
    }
  }

  function edgesFromGraph() {
    const live = byForgeId()
    const inverse = new Map<number, any>()
    for (const node of graph._nodes) inverse.set(node.id, node)
    const grouped = new Map<string, { source: string; target: string; pairs: { sourcePort: string; targetPort: string }[] }>()
    for (const link of Object.values(graph.links || {}) as any[]) {
      if (!link) continue
      const source = inverse.get(link.origin_id)
      const target = inverse.get(link.target_id)
      if (!source || !target) continue
      const sourcePort = source.outputs?.[link.origin_slot]?.forgePortId
      const targetPort = target.inputs?.[link.target_slot]?.forgePortId
      if (!sourcePort || !targetPort) continue
      const key = `${source.properties.forgeId}->${target.properties.forgeId}`
      const entry = grouped.get(key) || { source: source.properties.forgeId, target: target.properties.forgeId, pairs: [] }
      if (!entry.pairs.some((pair) => pair.sourcePort === sourcePort && pair.targetPort === targetPort)) {
        entry.pairs.push({ sourcePort, targetPort })
      }
      grouped.set(key, entry)
    }
    return [...grouped.values()].map((entry) => {
      const existing = flowEdges.find((edge) => edge.source === entry.source && edge.target === entry.target)
      return {
        id: existing?.id || `edge-${entry.source}-${entry.target}-${Date.now().toString(36)}`,
        source: entry.source,
        target: entry.target,
        sourceHandle: 'output',
        targetHandle: 'input',
        data: { logicalConnections: entry.pairs },
        selectable: true,
        type: 'execution',
        selected: existing?.selected || false,
      }
    })
  }

  function scheduleEdges() {
    if (silent || edgeQueued) return
    edgeQueued = true
    queueMicrotask(() => {
      edgeQueued = false
      if (silent) return
      const next = edgesFromGraph()
      flowEdges = next
      remember()
      handlers.onEdges(next)
    })
  }

  function cleanNodes(nodes: any[]) {
    return nodes.map((node) => {
      const { _run, _missing, ...rest } = node
      return rest
    })
  }

  function commitGeometry() {
    const byId = new Map(flowNodes.map((node) => [node.id, node]))
    const dragged: any[] = []
    const next = flowNodes.map((node) => {
      if (node.type === 'frame') {
        const group = graph._groups.find((item: any) => item.forgeId === node.id)
        if (!group) return node
        const position = { x: group.pos[0], y: group.pos[1] }
        dragged.push({ ...node, position, positionAbsolute: position, width: group.size[0], height: group.size[1] })
        return { ...node, position, width: group.size[0], height: group.size[1] }
      }
      const live = byForgeId().get(node.id)
      if (!live) return node
      const positionAbsolute = { x: live.pos[0], y: live.pos[1] }
      const parent = node.parentNode ? byId.get(node.parentNode) : null
      const parentAbsolute = parent ? absolutePosition(parent, byId) : { x: 0, y: 0 }
      const frame = parent ? graph._groups.find((item: any) => item.forgeId === parent.id) : null
      if (frame) {
        parentAbsolute.x = frame.pos[0]
        parentAbsolute.y = frame.pos[1]
      }
      const position = node.parentNode
        ? { x: positionAbsolute.x - parentAbsolute.x, y: positionAbsolute.y - parentAbsolute.y }
        : positionAbsolute
      dragged.push({
        id: node.id,
        position,
        positionAbsolute,
        dimensions: { width: live.size[0], height: live.size[1] },
      })
      return { ...node, position }
    })
    flowNodes = next
    remember()
    handlers.onNodes(cleanNodes(next))
    handlers.onDragStop({ nodes: dragged })
  }

  function readPointer(event: MouseEvent) {
    view.adjustMouseEvent(event)
    return {
      node: graph.getNodeOnPos(event.canvasX, event.canvasY, view.visible_nodes, 5),
      group: graph.getGroupOnPos(event.canvasX, event.canvasY),
    }
  }

  const originalDown = view.processMouseDown.bind(view)
  const originalMove = view.processMouseMove.bind(view)
  const originalUp = view.processMouseUp.bind(view)
  view.processMouseDown = (event: MouseEvent) => {
    if (mode === 'select' && event.button === 0) {
      const hit = readPointer(event)
      if (!hit.node && !hit.group && !event.ctrlKey) {
        view.dragging_rectangle = new Float32Array(4)
        view.dragging_rectangle[0] = event.canvasX
        view.dragging_rectangle[1] = event.canvasY
        view.dragging_rectangle[2] = 1
        view.dragging_rectangle[3] = 1
        selecting = true
        handlers.onSelectionStart()
      }
    }
    const wasConnecting = Boolean(view.connecting_node)
    const result = originalDown(event)
    if (!wasConnecting && view.connecting_node?.properties?.forgeId) {
      handlers.onConnectStart(view.connecting_node.properties.forgeId)
    }
    if (view.node_dragged || view.selected_group) {
      const origin = view.node_dragged?.pos || view.selected_group?.pos
      dragOrigin = origin ? { x: origin[0], y: origin[1] } : null
      handlers.onDragStart()
    }
    return result
  }
  view.processMouseMove = (event: MouseEvent) => {
    const result = originalMove(event)
    const origin = view.node_dragged?.pos || view.selected_group?.pos
    if (origin && dragOrigin && Math.hypot(origin[0] - dragOrigin.x, origin[1] - dragOrigin.y) > 3) {
      interacting = true
      moved = true
    }
    publishViewport()
    return result
  }
  view.processMouseUp = (event: MouseEvent) => {
    const hit = readPointer(event)
    const connecting = view.connecting_node
    const connectingOutput = view.connecting_output
    const linksBefore = Object.keys(graph.links || {}).length
    const group = view.selected_group
    const didMove = moved
    interacting = false
    moved = false
    dragOrigin = null
    const result = originalUp(event)
    const linksAfter = Object.keys(graph.links || {}).length
    if (connecting && connectingOutput && linksAfter === linksBefore && !hit.node) {
      handlers.onConnectEnd({ clientX: event.clientX, clientY: event.clientY, sourceId: connecting.properties.forgeId })
    }
    if (didMove) commitGeometry()
    else if (selecting) handlers.onSelectionEnd()
    selecting = false
    if (!didMove && event.button === 0 && !connecting) {
      if (group?.forgeId) selectFrame(group.forgeId)
      else if (!hit.node && !hit.group) handlers.onPaneClick()
    }
    publishViewport()
    return result
  }
  view.processContextMenu = (node: any, event: MouseEvent) => {
    event.preventDefault()
    const flow = node?.properties?.forgeId ? flowNodes.find((item) => item.id === node.properties.forgeId) : null
    if (flow) handlers.onNodeContextMenu({ event, node: flow })
    else handlers.onPaneContextMenu(event)
    return false
  }
  view.showLinkMenu = (link: any, event: MouseEvent) => {
    const source = graph.getNodeById(link.origin_id)
    const target = graph.getNodeById(link.target_id)
    const edge = flowEdges.find((item) => item.source === source?.properties?.forgeId && item.target === target?.properties?.forgeId)
    if (edge) handlers.onEdgeClick({ edge, event })
  }

  function commitSelection() {
    if (silent) return
    const selected = new Set(Object.values(view.selected_nodes || {}).map((node: any) => node.properties?.forgeId).filter(Boolean))
    const next = flowNodes.map((node) => ({
      ...node,
      selected: node.type === 'frame' ? false : selected.has(node.id),
    }))
    if (next.every((node, index) => Boolean(node.selected) === Boolean(flowNodes[index]?.selected))) return
    flowNodes = next
    remember()
    handlers.onNodes(cleanNodes(next))
  }

  function selectFrame(id: string) {
    const next = flowNodes.map((node) => ({ ...node, selected: node.id === id }))
    flowNodes = next
    remember()
    handlers.onNodes(cleanNodes(next))
  }

  function onNodeDoubleClick(node: any, _event: MouseEvent, pos: number[]) {
    const url = node.previewUrl
    if (url && pos?.[1] > node.size[1] - PREVIEW_HEIGHT) {
      const flow = flowNodes.find((item) => item.id === node.properties.forgeId)
      handlers.onPreview({ src: url, alt: flow?.data?.label || 'Preview' })
      return
    }
    view.prompt('Name', node.title, (value: string) => {
      if (value?.trim()) handlers.onName(node.properties.forgeId, value.trim())
    }, null, false)
  }

  function sync(nodes: any[], edges: any[], nodeRuns: Record<string, any> = {}, missing: Record<string, string[]> = {}) {
    const decorated = decorate(nodes, nodeRuns, missing)
    flowNodes = decorated
    flowEdges = edges
    const nextKey = structureKey(decorated, edges)
    if (nextKey !== lastStructure) rebuild(decorated, edges)
    else patch(decorated)
  }

  function screenToFlowCoordinate(point: { x: number; y: number }) {
    const rect = canvas.getBoundingClientRect()
    const scale = view.ds.scale || 1
    return {
      x: (point.x - rect.left) / scale - view.ds.offset[0],
      y: (point.y - rect.top) / scale - view.ds.offset[1],
    }
  }

  function fitView({ padding = 0.18, nodes: ids, maxZoom = 1, duration = 0 }: { padding?: number; nodes?: string[]; maxZoom?: number; duration?: number } = {}) {
    const byId = new Map(flowNodes.map((node) => [node.id, node]))
    const chosen = ids?.length ? flowNodes.filter((node) => ids.includes(node.id)) : flowNodes
    if (!chosen.length) return
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const node of chosen) {
      const live = node.type === 'frame'
        ? graph._groups.find((group: any) => group.forgeId === node.id)
        : byForgeId().get(node.id)
      const position = live ? { x: live.pos[0], y: live.pos[1] } : absolutePosition(node, byId)
      const width = live?.size?.[0] || node.width || 250
      const height = live?.size?.[1] || node.height || 120
      minX = Math.min(minX, position.x)
      minY = Math.min(minY, position.y - 30)
      maxX = Math.max(maxX, position.x + width)
      maxY = Math.max(maxY, position.y + height)
    }
    const rect = canvas.getBoundingClientRect()
    const boundsWidth = Math.max(1, maxX - minX)
    const boundsHeight = Math.max(1, maxY - minY)
    let scale = Math.min(maxZoom, (rect.width * (1 - padding * 2)) / boundsWidth, (rect.height * (1 - padding * 2)) / boundsHeight)
    scale = Math.max(view.ds.min_scale, Math.min(view.ds.max_scale, scale || 1))
    const offset = [
      rect.width / (2 * scale) - (minX + boundsWidth / 2),
      rect.height / (2 * scale) - (minY + boundsHeight / 2),
    ]
    if (!duration) {
      view.ds.scale = scale
      view.ds.offset[0] = offset[0]
      view.ds.offset[1] = offset[1]
      view.setDirty(true, true)
      publishViewport()
      return
    }
    const startScale = view.ds.scale
    const startOffset = [view.ds.offset[0], view.ds.offset[1]]
    const started = performance.now()
    const step = (now: number) => {
      const progress = Math.min(1, (now - started) / duration)
      const eased = 1 - (1 - progress) ** 3
      view.ds.scale = startScale + (scale - startScale) * eased
      view.ds.offset[0] = startOffset[0] + (offset[0] - startOffset[0]) * eased
      view.ds.offset[1] = startOffset[1] + (offset[1] - startOffset[1]) * eased
      view.setDirty(true, true)
      publishViewport()
      if (progress < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }

  function findNode(id: string) {
    const live = byForgeId().get(id) || graph._groups.find((group: any) => group.forgeId === id)
    if (!live) return null
    return { dimensions: { width: live.size[0], height: live.size[1] }, position: { x: live.pos[0], y: live.pos[1] } }
  }

  function selectedFrameButton() {
    const frame = flowNodes.find((node) => node.type === 'frame' && node.selected)
    const group = frame && graph._groups.find((item: any) => item.forgeId === frame.id)
    if (!frame || !group) return null
    const scale = view.ds.scale
    return {
      id: frame.id,
      left: (group.pos[0] + group.size[0] - 72 + view.ds.offset[0]) * scale,
      top: (group.pos[1] + view.ds.offset[1]) * scale - 26,
    }
  }

  const hostApi = {
    sync,
    scheduleEdges,
    onNodeDoubleClick,
    resize() {
      const parent = canvas.parentElement
      if (!parent) return
      const ratio = window.devicePixelRatio || 1
      const width = Math.max(1, Math.round(parent.clientWidth * ratio))
      const height = Math.max(1, Math.round(parent.clientHeight * ratio))
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
        if (view.bgcanvas) {
          view.bgcanvas.width = width
          view.bgcanvas.height = height
        }
        view.setDirty(true, true)
      }
      publishViewport()
    },
    setMode(next: string) {
      mode = next
      const framing = next === 'frame'
      view.read_only = framing
      view.allow_dragnodes = !framing
      view.allow_interaction = !framing
      view.allow_dragcanvas = !framing
    },
    setTheme(next: string) {
      theme = next
      view.clear_background_color = next === 'light' ? '#e7ece8' : '#121614'
      view.background_image = next === 'light' ? null : LGraphCanvas.DEFAULT_BACKGROUND_IMAGE
      view.setDirty(true, true)
    },
    fitView,
    screenToFlowCoordinate,
    findNode,
    selectedFrameButton,
    destroy() {
      canvas.removeEventListener('wheel', view._mousewheel_callback)
      canvas.removeEventListener('gesturestart', onGestureStart)
      canvas.removeEventListener('gesturechange', onGestureChange)
      canvas.removeEventListener('gestureend', onGestureEnd)
      view.stopRendering()
      view.unbindEvents()
      clearGraph()
    },
  }
  hostApi.resize()
  graph._forgeHost = hostApi
  publishViewport()
  return hostApi
}
