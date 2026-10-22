import { LGraph, LGraphCanvas, LGraphGroup, LiteGraph } from 'litegraph.js'
import { canConnectPorts, hasModelEditor, isExecutableNodeType, nodeSchema, parameterRange, visibleParameters } from './canvas-nodes'
import { meshyAssetHref } from './meshy-asset'
import { applyNodeParameter } from './canvas-schema'

const NODE_TYPE = 'forge/node'
const PORT_COLOR: Record<string, string> = {
  image: '#7fb3d5',
  text: '#f2c14e',
  model: '#a98ae8',
  any: '#b3a184',
}
const TONE_COLOR: Record<string, string> = {
  cyan: '#2fa8a0',
  amber: '#d99a3f',
  violet: '#9b82d6',
  green: '#5aa15f',
  rose: '#e08a96',
  slate: '#8f9aa0',
}
const PREVIEW_HEIGHT = 148
// Stock title text starts at NODE_TITLE_HEIGHT (30) to clear a status dot we
// paint in the title color, so the gap is just empty padding.
const TITLE_TEXT_X = 12
const ACTION_INSET = 10
const ACTION_GAP = 6
const ACTION_SIZE = 28
const WIDGET_INSET = 10
// Textarea parameters: a label line, then the DOM field.
const TEXTAREA_LABEL = 18
const TEXTAREA_HEIGHT = 72
// Canvas text follows the app sans; stock LiteGraph falls back to Arial.
const CANVAS_FONT = "'Nunito', 'PingFang SC', sans-serif"
// Missing-input notice: a tinted strip between the parameters and the actions.
const NOTICE_PAD = 8
const NOTICE_LINE = 16
const NOTICE_GAP = 6
const measureText = (() => {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  return (label: string, font = `12px ${CANVAS_FONT}`) => {
    if (!context) return label.length * 7
    context.font = font
    return context.measureText(label).width
  }
})()
// Section fill and title stay this sage green. Selection is a separate stroke.
const FRAME_COLOR = '#8cc99b'
const FRAME_TITLE_BAND = 36
// Same greens as --acid. LiteGraph's #9A9 reads as white on the light canvas,
// and a selected node repaints every attached link #FFF.
const LINK_COLOR: Record<string, string> = {
  light: '#5aa15f',
  dark: '#5aa15f',
}
const LINK_HOVER_COLOR = '#2f7d43'
const RUNNING_LINK_COLOR = '#9bd94f'
const NODE_BODY_COLOR = '#fffdf7'
const NODE_INK = '#794f27'
// Parameter rows share one left edge, one right edge, and the same corner.
// Action buttons are not parameters: they size to the label and share a row.
// LiteGraph's own widgets are capsules with arrows that shove the labels out of line.
const WIDGET_PALETTE = {
  light: {
    field: '#fffdf7',
    button: '#f6efdf',
    text: '#794f27',
    label: '#96795a',
    outline: '#e6dcc8',
    hover: '#f2e7d2',
    hoverOutline: '#c9b48c',
    pressed: '#ece0c9',
    caret: '#a38a68',
    trackOff: '#ddd1b9',
    trackOn: '#19b8aa',
    knob: '#fffdf7',
  },
  dark: {
    field: '#fffdf7',
    button: '#f6efdf',
    text: '#794f27',
    label: '#96795a',
    outline: '#e6dcc8',
    hover: '#f2e7d2',
    hoverOutline: '#c9b48c',
    pressed: '#ece0c9',
    caret: '#a38a68',
    trackOff: '#ddd1b9',
    trackOn: '#19b8aa',
    knob: '#fffdf7',
  },
}

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
    if (!this.previewSlot || this.flags?.collapsed) return
    const width = this.size[0] - 16
    const height = PREVIEW_HEIGHT - 12
    const x = 8
    const y = this.size[1] - PREVIEW_HEIGHT + 4
    const light = this.bgcolor === '#f4f7f4'
    ctx.save()
    ctx.beginPath()
    if (ctx.roundRect) ctx.roundRect(x, y, width, height, 6)
    else ctx.rect(x, y, width, height)
    ctx.fillStyle = '#f4eedd'
    ctx.fill()
    ctx.lineWidth = 1
    ctx.strokeStyle = '#e6dcc8'
    ctx.stroke()
    const image = this.previewImage as HTMLImageElement | undefined
    if (image?.complete && image.naturalWidth > 0) {
      ctx.clip()
      const contain = this.properties.canvasType === 'generated-model'
      const scale = contain
        ? Math.min(width / image.naturalWidth, height / image.naturalHeight)
        : Math.max(width / image.naturalWidth, height / image.naturalHeight)
      const drawWidth = image.naturalWidth * scale
      const drawHeight = image.naturalHeight * scale
      ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight)
    } else {
      ctx.font = `12px ${CANVAS_FONT}`
      ctx.fillStyle = '#b3a184'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('Preview', x + width / 2, y + height / 2)
    }
    ctx.restore()
  }
  ForgeNode.prototype.onDrawForeground = function(this: any, ctx: CanvasRenderingContext2D) {
    this.graph?._forgeHost?.paintNodeActions(this, ctx)
    if (!this.noticeLines?.length || this.flags?.collapsed) return
    const light = this.bgcolor === '#f4f7f4'
    const x = WIDGET_INSET
    const w = this.size[0] - WIDGET_INSET * 2
    const h = noticeBoxHeight(this.noticeLines.length)
    ctx.save()
    ctx.beginPath()
    if (ctx.roundRect) ctx.roundRect(x, this.noticeY, w, h, 6)
    else ctx.rect(x, this.noticeY, w, h)
    ctx.fillStyle = 'rgba(224, 90, 90, 0.10)'
    ctx.fill()
    ctx.lineWidth = 1
    ctx.strokeStyle = 'rgba(224, 90, 90, 0.38)'
    ctx.stroke()
    ctx.font = `12px ${CANVAS_FONT}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#c24b3a'
    this.noticeLines.forEach((line: string, index: number) => {
      ctx.fillText(line, x + NOTICE_PAD, this.noticeY + NOTICE_PAD / 2 + NOTICE_LINE * (index + 0.5) + 1)
    })
    ctx.restore()
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
  const raw = generated.selectedPreview || generated.preview || generated.previews?.[0]
    || uploaded.thumbnailUrl
    || (uploaded.assetType === 'image' ? uploaded.assetUrl : '')
    || ''
  return meshyAssetHref(generated, 'preview', raw) || raw
}

function previewSlot(node: any) {
  return Boolean(previewSource(node)) || node.data?.canvasType === 'generated-image' || node.data?.canvasType === 'generated-model'
}

function previewHit(node: any, localX: number, localY: number) {
  if (!node?.previewSlot || node.flags?.collapsed) return false
  return localX >= 8 && localX <= node.size[0] - 8
    && localY >= node.size[1] - PREVIEW_HEIGHT + 4
    && localY <= node.size[1] - 8
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
      preview: previewSlot(node),
      // The notice text sets the node height, so a new message rebuilds the node.
      missing: node._missing || '',
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
    // Gen HD Model's loose-image mode takes up to four pictures. Show all four
    // sockets up front. One spare that appears only after a connection reads as
    // a single input. Any images already wired past four stay visible.
    const copies = port.multiple
      ? (node.data?.canvasType === 'generate-model' && port.id === 'image' ? Math.max(4, count) : Math.max(1, count + 1))
      : 1
    for (let index = 0; index < copies; index += 1) slots.push(port)
  }
  return slots
}

function widgetPlan(node: any) {
  if (node.type === 'frame') return []
  const schema = nodeSchema(node.data?.canvasType, node.data?.provider || 'meshy')
  return visibleParameters(schema?.parameters, node.data?.config || {})
}

function actionPlan(node: any) {
  if (node.type === 'frame') return []
  const actions: { id: string; label: string }[] = []
  const type = node.data?.canvasType
  const run = node._run
  if (type === 'reference-image') actions.push({ id: 'upload', label: node.data?.uploadAssets?.reference ? 'Replace asset' : 'Upload asset' })
  if (type === 'reference-image' && node.data?.uploadAssets?.assetUrl) actions.push({ id: 'clear', label: 'Remove asset' })
  if (type === 'review') actions.push({ id: 'approve', label: node.data?.generatedAssets?.approved ? 'Approved — continue' : 'Approve & continue' })
  const downloads = type === 'generated-export' ? node.data?.generatedAssets?.outputs : null
  if (Array.isArray(downloads)) {
    downloads.forEach((item: any, index: number) => {
      if (item?.downloadUrl) actions.push({ id: `download:${index}`, label: `Download ${item.filename || 'file'}` })
    })
  }
  if (type === 'generated-model' && node.data?.generatedAssets?.modelUrl) actions.push({ id: 'download-model', label: 'Download model' })
  if (isExecutableNodeType(type) && !['queued', 'running', 'cancelling'].includes(run?.status)) {
    actions.push({ id: 'run', label: 'Run' })
    actions.push({ id: 'downstream', label: 'Run downstream' })
  }
  if (['queued', 'running', 'cancelling'].includes(run?.status)) actions.push({ id: 'stop', label: 'Stop' })
  if (canOpenModel(node)) actions.push({ id: 'model', label: 'Open 3D' })
  return actions
}

function actionIcon(id: string) {
  if (id === 'upload') return 'replace'
  if (id === 'clear') return 'remove'
  if (id === 'model') return 'model'
  if (id.startsWith('download')) return 'download'
  return ''
}

function packActions(actions: { id: string; label: string }[], width: number, kind: 'icon' | 'text') {
  const inner = Math.max(40, width - ACTION_INSET * 2)
  const rows: { id: string; label: string; kind: 'icon' | 'text'; w: number }[][] = []
  let row: { id: string; label: string; kind: 'icon' | 'text'; w: number }[] = []
  let used = 0
  for (const action of actions) {
    const w = kind === 'icon' ? ACTION_SIZE : Math.min(inner, Math.max(ACTION_SIZE, Math.ceil(measureText(action.label) + 20)))
    if (row.length && used + ACTION_GAP + w > inner) {
      rows.push(row)
      row = []
      used = 0
    }
    row.push({ ...action, kind, w })
    used += w + ACTION_GAP
  }
  if (row.length) rows.push(row)
  return rows
}

function actionBandHeight(actions: { id: string; label: string }[], width: number, preview: boolean) {
  const icons = actions.filter((action) => actionIcon(action.id) && !preview)
  const texts = actions.filter((action) => !actionIcon(action.id))
  const rows = packActions(texts, width, 'text').length + packActions(icons, width, 'icon').length
  return rows ? rows * ACTION_SIZE + (rows - 1) * ACTION_GAP + 12 : 0
}

function noticeBoxHeight(lines: number) {
  return lines * NOTICE_LINE + NOTICE_PAD
}

// Word-wrap the notice to the strip's inner width.
function wrapNotice(text: string, nodeWidth: number) {
  if (!text) return []
  const width = nodeWidth - WIDGET_INSET * 2 - NOTICE_PAD * 2
  const font = `12px ${CANVAS_FONT}`
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word
    if (line && measureText(next, font) > width) {
      lines.push(line)
      line = word
    } else line = next
  }
  if (line) lines.push(line)
  return lines
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
  onClearUpload: (id: string) => void
  onOutput: (id: string, generatedAssets: Record<string, unknown>) => void
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
  onFrameContextMenu: (payload: { event: MouseEvent; id: string }) => void
  onPaneContextMenu: (event: MouseEvent) => void
  onPaneClick: () => void
  onEdgeClick: (payload: { edge: any; event: MouseEvent }) => void
  onViewport: (viewport: { x: number; y: number; zoom: number }) => void
}

export function createGraphHost(canvas: HTMLCanvasElement, handlers: GraphHostHandlers) {
  ensureNodeType()
  LiteGraph.alt_drag_do_clone_nodes = false
  const graph = new LGraph()
  // Links are otherwise painted on the back canvas, so the node body covers the
  // last stretch and the wire never meets the port.
  graph.config.links_ontop = true
  const view = new LGraphCanvas(canvas, graph)
  view.background_image = LGraphCanvas.DEFAULT_BACKGROUND_IMAGE
  view.clear_background_color = '#d3ecdb'
  view.round_radius = 16
  view.show_info = false
  // LiteGraph strokes a debug rectangle from graph (0, 0) out to the bitmap
  // size. On the light canvas that is a stray dark frame, and a different
  // window size on the next load moves its edges.
  view.render_canvas_border = false
  view.connections_width = 2
  view.render_connections_border = false
  // Stock paints a filled disc at the middle of every wire. A wire is just a wire.
  view.highquality_render = false
  view.allow_searchbox = false
  view.ds.min_scale = 0.6
  view.ds.max_scale = 3.5
  view.showShowNodePanel = () => {}
  view.processNodeDblClicked = () => {}
  // The constructor already bound the stock processKey. Replacing the method
  // does not replace that listener, so Cmd+C stored a private snapshot and
  // Cmd+V inserted nodes the document rebuild immediately threw away.
  canvas.removeEventListener('keydown', view._key_callback, true)
  document.removeEventListener('keyup', view._key_callback, true)
  const stockProcessKey = LGraphCanvas.prototype.processKey
  view.processKey = (event: KeyboardEvent) => {
    const chord = event.metaKey || event.ctrlKey
    const key = event.key?.toLowerCase?.() || ''
    if (event.type === 'keydown' && chord && ['a', 'c', 'd', 'v', 'x', 'y', 'z'].includes(key)) return
    if (event.type === 'keydown' && (event.key === 'Backspace' || event.key === 'Delete' || event.key === 'Escape')) return
    return stockProcessKey.call(view, event)
  }
  view._key_callback = (event: KeyboardEvent) => view.processKey(event)
  canvas.addEventListener('keydown', view._key_callback, true)
  document.addEventListener('keyup', view._key_callback, true)
  view.onDropItem = () => true
  view.onSelectionChange = () => commitSelection()

  let silent = false
  let interacting = false
  let moved = false
  let dragOrigin: { x: number; y: number } | null = null
  let selecting = false
  // Shift/Ctrl on the current press: keep the existing selection, sections included.
  let additive = false
  // LiteGraph rewrites selected_nodes inside processMouseUp. The wrapper decides
  // the final selection afterwards, so those intermediate changes are ignored.
  let releasing = false
  let draggedFrameId: string | null = null
  // Pressed on a node that was already selected: keep the group for a drag,
  // narrow to that node only if the press ends without movement.
  let pressedSelected: any = null
  let lastDragPos: number[] | null = null
  let lastStructure = ''
  let edgeQueued = false
  let mode = 'select'
  let theme = 'dark'
  let flowNodes: any[] = []
  function selectionColor() {
    return LINK_COLOR[theme] || LINK_COLOR.dark
  }
  // Every selection, one node, many nodes or a section, is the same thin dashed
  // box. Screen pixels, so zoom keeps the weight and the gap the same.
  const SELECTION_STROKE = 1
  const SELECTION_DASH = [4, 3]
  const SELECTION_PAD = 10
  // Stock paints its own white outline on a selected node. The dashed box replaces it.
  const drawNodeShape = view.drawNodeShape.bind(view)
  view.drawNodeShape = (node: any, ctx: CanvasRenderingContext2D, size: number[], fgcolor: string, bgcolor: string, selected: boolean, mouseOver: boolean) => {
    const outline = LiteGraph.NODE_BOX_OUTLINE_COLOR
    LiteGraph.NODE_BOX_OUTLINE_COLOR = 'rgba(0,0,0,0)'
    const fillText = ctx.fillText.bind(ctx)
    const titleY = LiteGraph.NODE_TITLE_TEXT_Y - LiteGraph.NODE_TITLE_HEIGHT
    ctx.fillText = (text: string, x: number, y: number, maxWidth?: number) => {
      fillText(text, y === titleY ? TITLE_TEXT_X : x, y, maxWidth)
    }
    try {
      drawNodeShape(node, ctx, size, fgcolor, bgcolor, false, mouseOver)
    } finally {
      ctx.fillText = fillText
      LiteGraph.NODE_BOX_OUTLINE_COLOR = outline
    }
  }
  view.onDrawForeground = (ctx: CanvasRenderingContext2D) => {
    const scale = view.ds.scale || 1
    ctx.save()
    ctx.strokeStyle = selectionColor()
    ctx.lineWidth = SELECTION_STROKE / scale
    ctx.lineJoin = 'miter'
    // One dashed box around everything selected, held off the content by a gap.
    const region = view.dragging_rectangle ? null : selectionRegion()
    if (region) {
      const pad = SELECTION_PAD / scale
      ctx.setLineDash(SELECTION_DASH.map((part) => part / scale))
      ctx.strokeRect(region[0] - pad, region[1] - pad, region[2] + pad * 2, region[3] + pad * 2)
      ctx.setLineDash([])
    }
    // Live marquee in the theme color instead of the stock white box.
    if (selecting && view.dragging_rectangle) {
      const box = dragBox(view.dragging_rectangle)
      ctx.save()
      ctx.globalAlpha = 0.08
      ctx.fillStyle = selectionColor()
      ctx.fillRect(box.x, box.y, box.w, box.h)
      ctx.restore()
      ctx.lineWidth = 1 / scale
      ctx.strokeRect(box.x, box.y, box.w, box.h)
    }
    ctx.restore()
  }
  let flowEdges: any[] = []
  const images = new Map<string, HTMLImageElement>()
  // LiteGraph only notices the midpoint of a wire, and it does not restyle the
  // stroke. Hit-test the curve ourselves and paint that one link brighter.
  let hoverLinkId: number | null = null
  let selectedLinkId: number | null = null
  view.render_link_tooltip = false
  view.default_link_color = LINK_COLOR.dark
  const renderLink = view.renderLink.bind(view)
  view.renderLink = (ctx: CanvasRenderingContext2D, ...args: any[]) => {
    const link = args[2]
    // Stock renderLink overwrites a highlighted link with white after it
    // reads the color argument, so the flag has to be gone for this call.
    const highlighted = Boolean(link) && view.highlighted_links?.[link.id]
    if (highlighted) delete view.highlighted_links[link.id]
    const hovered = Boolean(link) && (link.id === hoverLinkId || link.id === selectedLinkId)
    const running = Boolean(link) && linkIsRunning(link)
    // Leave flow off. Stock draws five discs. A running wire gets one streak below.
    if (!args[5]) args[5] = running ? RUNNING_LINK_COLOR : (LINK_COLOR[theme] || LINK_COLOR.dark)
    const width = view.connections_width
    if (hovered) {
      view.connections_width = width + 2
      args[5] = LINK_HOVER_COLOR
      ctx.save()
      ctx.shadowColor = 'rgba(47, 125, 67, 0.45)'
      ctx.shadowBlur = 6
    }
    try {
      return renderLink(ctx, ...args)
    } finally {
      if (highlighted) view.highlighted_links[link.id] = true
      view.connections_width = width
      if (hovered) ctx.restore()
      if (running) paintFlowStreak(ctx, args[0], args[1], args[6], args[7])
    }
  }

  // One bright length of the wire travels from the output into the input, then
  // the wire is clear until the next length leaves the output.
  function paintFlowStreak(ctx: CanvasRenderingContext2D, start: number[], end: number[], startDir: number, endDir: number) {
    const travel = 1400
    const gap = 380
    const length = 0.36
    const elapsed = LiteGraph.getTime() % (travel + gap)
    if (elapsed >= travel) return
    const head = (elapsed / travel) * (1 + length)
    const tail = head - length
    const from = Math.max(0, tail)
    const to = Math.min(1, head)
    if (to - from < 0.02) return
    const steps = Math.max(8, Math.ceil((to - from) * 28))
    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.shadowColor = RUNNING_LINK_COLOR
    ctx.shadowBlur = 9
    ctx.strokeStyle = '#f2ffd6'
    ctx.lineWidth = 3.5
    ctx.beginPath()
    for (let step = 0; step <= steps; step += 1) {
      const pos = view.computeConnectionPoint(start, end, from + (to - from) * (step / steps), startDir, endDir)
      if (step === 0) ctx.moveTo(pos[0], pos[1])
      else ctx.lineTo(pos[0], pos[1])
    }
    ctx.stroke()
    ctx.restore()
  }
  // The render loop already runs, but the front canvas (where links sit) only
  // repaints while dirty. Keep it dirty for the whole run so the streak moves.
  const drawFrame = view.draw.bind(view)
  view.draw = (...drawArgs: unknown[]) => {
    const drawn = drawFrame(...drawArgs)
    if (anyLinkRunning()) view.dirty_canvas = true
    return drawn
  }

  let hoverWidget: { node: any; widget: any } | null = null
  let widgetCursor = false
  function setHoverWidget(next: { node: any; widget: any } | null) {
    if (hoverWidget?.widget === next?.widget) return
    hoverWidget = next
    view.setDirty(true, true)
  }
  function widgetUnder(x: number, y: number) {
    const node = view.graph?.getNodeOnPos(x, y, view.visible_nodes, 5)
    if (!node?.widgets) return null
    const localX = x - node.pos[0]
    const localY = y - node.pos[1]
    const width = node.size[0]
    for (const widget of node.widgets) {
      if (!widget || widget.disabled || widget.forgeTextarea) continue
      const box = widget._box
      if (box) {
        if (localX >= box.x && localX <= box.x + box.w && localY >= box.y && localY <= box.y + box.h) return { node, widget }
        continue
      }
      if (widget.last_y == null) continue
      const widgetWidth = widget.width || width
      const height = widget.computeSize ? widget.computeSize(width)[1] : LiteGraph.NODE_WIDGET_HEIGHT
      if (localX < 6 || localX > widgetWidth - 12 || localY < widget.last_y || localY > widget.last_y + height) continue
      return { node, widget }
    }
    return null
  }
  function trackWidgetHover() {
    const mouse = view.graph_mouse
    if (!view.graph || !mouse || view.dragging_canvas || view.node_dragged || view.connecting_node) {
      setHoverWidget(null)
      return
    }
    const hit = widgetUnder(mouse[0], mouse[1])
    setHoverWidget(hit)
    const overPreview = !hit && view.graph?.getNodeOnPos(mouse[0], mouse[1], view.visible_nodes, 5)
    const previewHover = overPreview && previewHit(overPreview, mouse[0] - overPreview.pos[0], mouse[1] - overPreview.pos[1])
    if (hit || previewHover) {
      canvas.style.cursor = 'pointer'
      widgetCursor = true
    } else if (widgetCursor) {
      canvas.style.cursor = ''
      widgetCursor = false
    }
  }
  // Stock combo arrows stop on the first and last entry. These rows are a
  // two-way menu: the next click past either end comes back around.
  const passWidgets = view.processNodeWidgets.bind(view)
  view.processNodeWidgets = (node: any, pos: number[], event: MouseEvent, activeWidget?: any) => {
    if (event?.type === `${LiteGraph.pointerevents_method}down` && node?.widgets && pos) {
      const localX = pos[0] - node.pos[0]
      const localY = pos[1] - node.pos[1]
      const width = node.size[0]
      // A press on a textarea's label must not open LiteGraph's prompt dialog.
      for (const widget of node.widgets) {
        if (!widget?.forgeTextarea || widget.last_y == null) continue
        if (localY >= widget.last_y && localY <= widget.last_y + TEXTAREA_LABEL + TEXTAREA_HEIGHT) return null
      }
      for (const widget of node.widgets) {
        if (!widget || widget.type !== 'combo' || widget.disabled || widget.last_y == null) continue
        const height = widget.computeSize ? widget.computeSize(width)[1] : LiteGraph.NODE_WIDGET_HEIGHT
        const widgetWidth = widget.width || width
        if (localX < 6 || localX > widgetWidth - 12 || localY < widget.last_y || localY > widget.last_y + height) continue
        const delta = localX < 40 ? -1 : localX > widgetWidth - 40 ? 1 : 0
        const values = widget.options?.values
        const list = Array.isArray(values) ? values : []
        if (!delta || list.length < 2) break
        const index = list.indexOf(widget.value)
        if (index < 0) break
        const next = list[(index + delta + list.length) % list.length]
        widget.value = next
        widget.callback?.(next, view, node, pos, event)
        view.dirty_canvas = true
        return widget
      }
    }
    return passWidgets(node, pos, event, activeWidget)
  }

  view.drawNodeWidgets = (node: any, posY: number, ctx: CanvasRenderingContext2D) => {
    const widgets = node.widgets
    if (!widgets?.length) return 0
    const palette = theme === 'light' ? WIDGET_PALETTE.light : WIDGET_PALETTE.dark
    const width = node.size[0]
    const height = LiteGraph.NODE_WIDGET_HEIGHT
    const inset = 10
    const labelX = inset + 16
    let y = posY + 2
    ctx.save()
    ctx.font = `12px ${CANVAS_FONT}`
    ctx.textBaseline = 'middle'
    ctx.lineWidth = 1
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    for (const widget of widgets) {
      const rowHeight = widget.computeSize ? widget.computeSize(width)[1] : height
      if (widget.forgeTextarea) {
        // The DOM field follows last_y. Tell the overlay when it first lands or moves.
        if (widget.last_y !== y) queueMicrotask(publishViewport)
        widget.last_y = y
        ctx.globalAlpha = view.editor_alpha ?? 1
        ctx.textAlign = 'left'
        ctx.fillStyle = palette.label
        ctx.fillText(widget.label || widget.name || '', inset + 2, y + TEXTAREA_LABEL / 2)
        y += rowHeight + 4
        continue
      }
      widget.last_y = y
      const hot = hoverWidget?.node === node && hoverWidget.widget === widget
      ctx.globalAlpha = (view.editor_alpha ?? 1) * (widget.disabled ? 0.45 : 1)
      const rowX = inset
      const rowW = width - inset * 2
      const right = rowX + rowW
      ctx.beginPath()
      if (ctx.roundRect) ctx.roundRect(rowX, y, rowW, height, 5)
      else ctx.rect(rowX, y, rowW, height)
      ctx.fillStyle = hot ? palette.hover : palette.field
      ctx.fill()
      ctx.strokeStyle = hot ? palette.hoverOutline : palette.outline
      ctx.stroke()
      const midY = y + height / 2
      const stepped = widget.type === 'number' || widget.type === 'combo' || widget.type === 'slider'
      ctx.strokeStyle = palette.caret
      ctx.fillStyle = palette.caret
      if (stepped) {
        caret(ctx, rowX + 7, midY, -1)
        caret(ctx, right - 12, midY, 1)
      }
      const value = widget.type === 'toggle' ? '' : widgetValue(widget)
      ctx.textAlign = 'right'
      ctx.fillStyle = palette.text
      const valueX = widget.type === 'toggle' ? right - 30 : stepped ? right - 16 : right - 8
      if (value) ctx.fillText(value, valueX, midY)
      if (widget.type === 'toggle') paintSwitch(ctx, right - 8, midY, Boolean(widget.value), palette)
      ctx.save()
      ctx.beginPath()
      ctx.rect(labelX, y, Math.max(8, valueX - labelX - 8), height)
      ctx.clip()
      ctx.textAlign = 'left'
      ctx.fillStyle = palette.label
      ctx.fillText(widget.label || widget.name || '', labelX, midY)
      ctx.restore()
      y += rowHeight + 4
    }
    ctx.restore()
    return 0
  }

  function caret(ctx: CanvasRenderingContext2D, x: number, y: number, direction: number) {
    ctx.beginPath()
    ctx.moveTo(x + (direction < 0 ? 4 : 0), y - 3.5)
    ctx.lineTo(x + (direction < 0 ? 0 : 4), y)
    ctx.lineTo(x + (direction < 0 ? 4 : 0), y + 3.5)
    ctx.stroke()
  }

  function paintSwitch(ctx: CanvasRenderingContext2D, rightEdge: number, y: number, on: boolean, palette: typeof WIDGET_PALETTE.light) {
    const trackW = 18
    const trackH = 10
    const x = rightEdge - trackW
    ctx.beginPath()
    if (ctx.roundRect) ctx.roundRect(x, y - trackH / 2, trackW, trackH, trackH / 2)
    else ctx.rect(x, y - trackH / 2, trackW, trackH)
    ctx.fillStyle = on ? palette.trackOn : palette.trackOff
    ctx.fill()
    ctx.beginPath()
    ctx.arc(on ? x + trackW - 5 : x + 5, y, 3.5, 0, Math.PI * 2)
    ctx.fillStyle = palette.knob
    ctx.fill()
  }

  function widgetValue(widget: any) {
    if (widget.type === 'toggle') return widget.value ? widget.options?.on || 'true' : widget.options?.off || 'false'
    if (widget.type === 'number' || widget.type === 'slider') {
      const precision = widget.options?.precision
      return Number(widget.value).toFixed(precision !== undefined ? precision : widget.type === 'slider' ? 2 : 0)
    }
    if (widget.type === 'combo') {
      const values = typeof widget.options?.values === 'function' ? widget.options.values() : widget.options?.values
      if (values && !Array.isArray(values)) return String(values[widget.value] ?? widget.value ?? '')
      return widget.value == null ? '' : String(widget.value)
    }
    if (widget.type === 'string' || widget.type === 'text') return widget.value == null ? '' : String(widget.value).slice(0, 30)
    return ''
  }

  function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
    const dx = bx - ax
    const dy = by - ay
    const length2 = dx * dx + dy * dy
    if (length2 === 0) return Math.hypot(px - ax, py - ay)
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length2))
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
  }

  function distanceToLink(x: number, y: number, link: any) {
    const start = graph.getNodeById(link.origin_id)
    const end = graph.getNodeById(link.target_id)
    if (!start || !end) return Infinity
    const from = start.getConnectionPos(false, link.origin_slot)
    const to = end.getConnectionPos(true, link.target_slot)
    let previous = view.computeConnectionPoint(from, to, 0)
    let best = Infinity
    for (let step = 1; step <= 16; step += 1) {
      const next = view.computeConnectionPoint(from, to, step / 16)
      best = Math.min(best, distanceToSegment(x, y, previous[0], previous[1], next[0], next[1]))
      previous = next
    }
    return best
  }

  function linkIsRunning(link: any) {
    return endpointRunning(link.origin_id) || endpointRunning(link.target_id)
  }

  function endpointRunning(liteId: number) {
    const lite = graph.getNodeById(liteId)
    const flow = lite?.properties?.forgeId
      ? flowNodes.find((item) => item.id === lite.properties.forgeId)
      : null
    return ['queued', 'running', 'cancelling'].includes(flow?._run?.status)
  }

  function anyLinkRunning() {
    for (const link of Object.values(graph.links || {}) as any[]) {
      if (link && linkIsRunning(link)) return true
    }
    return false
  }

  function setHoverLink(id: number | null) {
    if (id === hoverLinkId) return
    hoverLinkId = id
    view.setDirty(true, true)
  }

  function setSelectedLink(id: number | null) {
    if (id === selectedLinkId) return
    selectedLinkId = id
    view.setDirty(true, true)
    if (id == null) return
    view.deselectAllNodes()
    commitSelection()
  }

  function linkUnder(x: number, y: number) {
    const limit = 8 / (view.ds.scale || 1)
    let best: any = null
    let bestDistance = limit
    for (const link of Object.values(graph.links || {}) as any[]) {
      if (!link) continue
      const distance = distanceToLink(x, y, link)
      if (distance < bestDistance) {
        bestDistance = distance
        best = link
      }
    }
    return best
  }

  function trackLinkHover() {
    const mouse = view.graph_mouse
    if (!view.graph || !mouse || view.connecting_node || view.dragging_canvas) {
      setHoverLink(null)
      return
    }
    const x = mouse[0]
    const y = mouse[1]
    if (view.graph.getNodeOnPos(x, y)) {
      setHoverLink(null)
      return
    }
    const link = linkUnder(x, y)
    setHoverLink(link ? link.id : null)
    if (link && view.canvas) view.canvas.style.cursor = 'pointer'
  }

  function deleteSelectedLink() {
    if (selectedLinkId == null || !graph.links?.[selectedLinkId]) return
    graph.removeLink(selectedLinkId)
    setSelectedLink(null)
    view.setDirty(true, true)
    scheduleEdges()
  }

  function onLinkKey(event: KeyboardEvent) {
    if (selectedLinkId == null) return
    const target = event.target
    if (target instanceof Element && target.closest('input, textarea, [contenteditable="true"]')) return
    if (event.key === 'Escape') {
      setSelectedLink(null)
      return
    }
    if (event.key !== 'Delete' && event.key !== 'Backspace') return
    event.preventDefault()
    event.stopPropagation()
    deleteSelectedLink()
  }
  window.addEventListener('keydown', onLinkKey, true)
  const clearLinkHover = () => {
    setHoverLink(null)
    setHoverWidget(null)
  }
  canvas.addEventListener('pointerleave', clearLinkHover)

  // Title rename is a DOM field in the camera layer, so it rides with the node.
  let renamingId: string | null = null
  function publishViewport() {
    const scale = view.ds.scale
    handlers.onViewport({
      x: view.ds.offset[0] * scale,
      y: view.ds.offset[1] * scale,
      zoom: scale,
    })
  }
  function renameNode() {
    return renamingId ? byForgeId().get(renamingId) : null
  }
  function restoreTitle(node: any) {
    if (node?.getTitle) delete node.getTitle
  }
  function renameField() {
    const node = renameNode()
    if (!node || node.flags?.collapsed) return null
    const height = LiteGraph.NODE_TITLE_HEIGHT
    return {
      id: renamingId,
      x: node.pos[0],
      y: node.pos[1] - height,
      w: node.size[0],
      h: height,
      textX: TITLE_TEXT_X,
      value: node.title || '',
      color: '#fff',
    }
  }
  function closeRename() {
    if (!renamingId) return
    restoreTitle(renameNode())
    renamingId = null
    view.setDirty(true, true)
    publishViewport()
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
      // The node title already names the node: "Gen HD Model requires X" reads "Needs X" here.
      _missing: missing[node.id]?.length ? missing[node.id].map((message) => message.replace(/^.+? requires /, 'Needs ')).join(' ') : '',
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
    created.title = node.data?.label || node.data?.canvasType || 'Node'
    created.color = toneOf(node)
    created.bgcolor = NODE_BODY_COLOR
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
    const size = created.computeSize()
    size[0] = Math.max(250, size[0])
    // The notice takes its own room under the parameters. Actions and the
    // preview are anchored to the bottom, so they stay clear of it.
    created.noticeLines = wrapNotice(node._missing || '', size[0])
    if (created.noticeLines.length) {
      created.noticeY = size[1]
      size[1] += noticeBoxHeight(created.noticeLines.length) + NOTICE_GAP
    }
    created.previewSlot = previewSlot(node)
    created.uploadWell = node.data?.canvasType === 'reference-image' && !created.previewSlot
    const actions = actionPlan(node).filter((action: { id: string }) => !(created.uploadWell && (action.id === 'upload' || action.id === 'clear')))
    const band = actionBandHeight(actions, size[0], Boolean(created.previewSlot))
    if (band) size[1] += band
    if (created.previewSlot || created.uploadWell) size[1] += PREVIEW_HEIGHT
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
    } else if (parameter.control === 'slider') {
      const range = parameterRange(parameter, config) || { min: 0, max: 1, step: 0.01 }
      created.addWidget('number', parameter.label, Number(config[parameter.key] ?? range.min), (value: number) => commit(value), {
        min: range.min, max: range.max, step: range.step, precision: range.step < 1 ? 2 : 0,
      })
    } else if (parameter.control === 'select' || parameter.control === 'segmented') {
      const options = parameter.options || []
      const labels = options.map((option: any) => String(option.label))
      const current = options.find((option: any) => option.value === config[parameter.key])
      created.addWidget('combo', parameter.label, current ? String(current.label) : labels[0], (label: string) => {
        const option = options.find((item: any) => String(item.label) === label)
        if (option) commit(option.value)
      }, { values: labels })
    } else if (parameter.control === 'textarea') {
      // Long text is a real DOM textarea laid over the node (see textFields).
      // The canvas only reserves the room and paints the label above it.
      const widget = created.addWidget('text', parameter.label, config[parameter.key] == null ? '' : String(config[parameter.key]), (value: string) => commit(value))
      widget.forgeTextarea = { key: parameter.key, placeholder: parameter.placeholder || '' }
      widget.computeSize = (width: number) => [width, TEXTAREA_LABEL + TEXTAREA_HEIGHT]
    } else {
      created.addWidget('text', parameter.label, config[parameter.key] == null ? '' : String(config[parameter.key]), (value: string) => commit(value))
    }
  }

  // Every textarea parameter on screen, in graph coordinates.
  function textFields() {
    const fields = []
    for (const node of graph._nodes) {
      if (node.flags?.collapsed || !node.widgets) continue
      for (const widget of node.widgets) {
        if (!widget.forgeTextarea || widget.last_y == null) continue
        fields.push({
          key: `${node.properties.forgeId}:${widget.forgeTextarea.key}`,
          nodeId: node.properties.forgeId,
          paramKey: widget.forgeTextarea.key,
          label: widget.label || widget.name || '',
          placeholder: widget.forgeTextarea.placeholder,
          value: widget.value == null ? '' : String(widget.value),
          x: node.pos[0] + WIDGET_INSET,
          y: node.pos[1] + widget.last_y + TEXTAREA_LABEL,
          w: node.size[0] - WIDGET_INSET * 2,
          h: TEXTAREA_HEIGHT,
        })
      }
    }
    return fields
  }

  function commitText(nodeId: string, key: string, value: string) {
    const node = byForgeId().get(nodeId)
    const widget = node?.widgets?.find((item: any) => item.forgeTextarea?.key === key)
    if (widget) widget.value = value
    handlers.onParameter(nodeId, key, value)
  }

  function runAction(id: string, action: string) {
    if (action === 'upload') handlers.onUpload(id)
    if (action === 'clear') handlers.onClearUpload(id)
    if (action === 'approve') {
      const node = byForgeId().get(id)
      const assets = { ...(node?.data?.generatedAssets || {}), approved: !node?.data?.generatedAssets?.approved }
      handlers.onOutput(id, assets)
    }
    if (action.startsWith('download:')) {
      const node = byForgeId().get(id)
      const generated = node?.data?.generatedAssets
      const item = generated?.outputs?.[Number(action.slice(9))]
      const href = meshyAssetHref(generated, 'model', item?.downloadUrl)
      if (href) window.open(href, '_blank', 'noopener')
    }
    if (action === 'download-model') {
      const node = byForgeId().get(id)
      const generated = node?.data?.generatedAssets
      const href = meshyAssetHref(generated, 'model', generated?.modelUrl)
      if (href) window.open(href, '_blank', 'noopener')
    }
    if (action === 'run') handlers.onRun(id)
    if (action === 'downstream') handlers.onRunDownstream(id)
    if (action === 'stop') handlers.onStop()
    if (action === 'model') handlers.onOpenModel(id)
  }

  // The browser opens only six connections to the API origin. A canvas with
  // dozens of previews would take all of them and queue the next canvas's reads
  // behind slow image downloads, so same-origin previews load a few at a time
  // through fetch, which (unlike clearing an <img> src) can really be aborted.
  const PREVIEW_CONCURRENCY = 2
  const previewQueue: string[] = []
  const previewLoads = new Map<string, AbortController>()

  function pumpPreviews() {
    while (previewLoads.size < PREVIEW_CONCURRENCY && previewQueue.length) {
      const url = previewQueue.shift()!
      const image = images.get(url)
      if (!image) continue
      const controller = new AbortController()
      previewLoads.set(url, controller)
      fetch(url, { signal: controller.signal })
        .then((response) => (response.ok ? response.blob() : null))
        .then((blob) => {
          if (images.get(url) !== image) return
          // A failed preview leaves the cache, so the next time it is shown it retries.
          if (!blob) return void images.delete(url)
          const objectUrl = URL.createObjectURL(blob)
          image.addEventListener('load', () => URL.revokeObjectURL(objectUrl), { once: true })
          image.src = objectUrl
        })
        .catch(() => { if (images.get(url) === image && !controller.signal.aborted) images.delete(url) })
        .finally(() => {
          if (previewLoads.get(url) === controller) previewLoads.delete(url)
          pumpPreviews()
        })
    }
  }

  // Previews of nodes that are gone (the previous canvas) stop downloading.
  function dropUnusedImages() {
    const used = new Set(graph._nodes.map((node: any) => node.previewUrl).filter(Boolean))
    for (const [url, image] of images) {
      if (used.has(url) || image.complete) continue
      previewLoads.get(url)?.abort()
      previewLoads.delete(url)
      image.onload = null
      images.delete(url)
    }
    for (let index = previewQueue.length - 1; index >= 0; index -= 1) {
      if (!images.has(previewQueue[index])) previewQueue.splice(index, 1)
    }
    pumpPreviews()
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
      images.set(url, image)
      // Another host has its own connection pool, and may not allow CORS fetch.
      if (new URL(url, location.href).origin === location.origin) {
        previewQueue.push(url)
        pumpPreviews()
      } else {
        image.src = url
      }
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
      group.color = FRAME_COLOR
      group.forgeId = node.id
      // Stock LiteGraph grabs every node the group box overlaps when a drag
      // starts, so a pasted section on top of the original carried the
      // original's nodes away. A section moves its own children only.
      group.recomputeInsideNodes = function(this: any) {
        const live = byForgeId()
        this._nodes = flowNodes
          .filter((flow) => flow.parentNode === this.forgeId)
          .map((flow) => live.get(flow.id))
          .filter(Boolean)
      }
      graph.add(group)
    }
    for (const node of nodes) {
      if (node.type === 'frame') continue
      buildNode(node, byId, edges)
    }
    silent = false
    dropUnusedImages()
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
      group.color = FRAME_COLOR
      group.forgeSelected = Boolean(frame?.selected)
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
      link.color = linkIsRunning(link) ? RUNNING_LINK_COLOR : (LINK_COLOR[theme] || LINK_COLOR.dark)
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

  // A drag on empty space inside the section is a marquee, so only the title
  // strip and the resize corner catch the pointer for dragging. A click with
  // no movement still selects the section, including on the lower half.
  function frameChrome(x: number, y: number) {
    const group = graph.getGroupOnPos(x, y)
    if (!group) return null
    const onTitle = y <= group.pos[1] + FRAME_TITLE_BAND
    const corner = Math.hypot(x - (group.pos[0] + group.size[0]), y - (group.pos[1] + group.size[1])) * (view.ds.scale || 1) < 10
    return onTitle || corner ? group : null
  }

  function readPointer(event: MouseEvent) {
    view.adjustMouseEvent(event)
    return {
      node: graph.getNodeOnPos(event.canvasX, event.canvasY, view.visible_nodes, 5),
      group: frameChrome(event.canvasX, event.canvasY),
    }
  }

  // Left-drag pans only in Move mode. A click inside a section used to leave
  // dragging_canvas set, so the next plain mouse move panned the view.
  function releaseCanvasPan(event: MouseEvent) {
    const left = (event.buttons & 1) !== 0
    const middle = (event.buttons & 4) !== 0
    const draggingSomething = view.node_dragged || view.dragging_rectangle || view.connecting_node || view.selected_group
    if (middle || (left && mode === 'move' && !draggingSomething)) return
    view.dragging_canvas = false
  }

  function dragBox(rect: ArrayLike<number>) {
    const width = rect[2]
    const height = rect[3]
    return {
      x: width < 0 ? rect[0] + width : rect[0],
      y: height < 0 ? rect[1] + height : rect[1],
      w: Math.abs(width),
      h: Math.abs(height),
    }
  }

  // The marquee picks an object only when it covers at least one of its four corners.
  function coversCorner(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
    const inside = (x: number, y: number) => x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.h
    return inside(b.x, b.y) || inside(b.x + b.w, b.y) || inside(b.x, b.y + b.h) || inside(b.x + b.w, b.y + b.h)
  }

  function graphNodeBox(node: any) {
    const bounds = new Float32Array(4)
    node.getBounding(bounds)
    return { x: bounds[0], y: bounds[1], w: bounds[2], h: bounds[3] }
  }

  // A selected frame is one object. Its children stay unselected and only move with it.
  function insideSelectedFrame(id: string, selected: Set<string>) {
    let parent = flowNodes.find((node) => node.id === id)?.parentNode
    while (parent) {
      if (selected.has(parent)) return true
      parent = flowNodes.find((node) => node.id === parent)?.parentNode
    }
    return false
  }

  // The marquee selects an object once it covers one of that object's corners.
  // A marquee drawn inside a frame never reaches its corners and leaves it alone.
  function marqueeSelection(box: { x: number; y: number; w: number; h: number }, additive: boolean) {
    const selected = new Set<string>()
    if (additive) {
      for (const node of flowNodes) if (node.selected) selected.add(node.id)
    }
    for (const group of graph._groups) {
      if (!group.forgeId) continue
      const frame = { x: group.pos[0], y: group.pos[1], w: group.size[0], h: group.size[1] }
      if (!coversCorner(box, frame)) continue
      selected.add(group.forgeId)
    }
    for (const node of graph._nodes) {
      const id = node.properties?.forgeId
      if (!id || selected.has(id) || !coversCorner(box, graphNodeBox(node))) continue
      selected.add(id)
    }
    for (const id of [...selected]) if (insideSelectedFrame(id, selected)) selected.delete(id)
    return flowNodes.map((node) => ({ ...node, selected: selected.has(node.id) }))
  }

  function publishSelection(next: any[]) {
    // Always resync LiteGraph: its own handlers may have toggled is_selected.
    applySelection(next)
    view.setDirty(true, true)
    if (next.every((node, index) => Boolean(node.selected) === Boolean(flowNodes[index]?.selected))) return
    flowNodes = next
    remember()
    handlers.onNodes(cleanNodes(next))
    view.setDirty(true, true)
  }

  // Stock behavior collapses a multi-selection to the pressed node, so a group
  // could never be dragged together. Keep it and decide on release instead.
  const originalNodeSelected = view.processNodeSelected.bind(view)
  view.processNodeSelected = (node: any, event: MouseEvent) => {
    const modifier = event && (event.shiftKey || event.ctrlKey || event.metaKey)
    if (!modifier && node?.is_selected && event?.type?.endsWith('down')) {
      pressedSelected = node
      return
    }
    originalNodeSelected(node, event)
  }

  const originalDown = view.processMouseDown.bind(view)
  const originalMove = view.processMouseMove.bind(view)
  const originalUp = view.processMouseUp.bind(view)
  view.processMouseDown = (event: MouseEvent) => {
    if (event.button === 0) additive = event.shiftKey || event.ctrlKey || event.metaKey
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
    if (event.button === 0 && view.selected_group && !frameChrome(event.canvasX, event.canvasY)) {
      view.selected_group = null
      view.selected_group_resizing = false
    }
    releaseCanvasPan(event)
    if (!wasConnecting && view.connecting_node?.properties?.forgeId) {
      handlers.onConnectStart(view.connecting_node.properties.forgeId)
    }
    if (view.node_dragged || view.selected_group) {
      const origin = view.node_dragged?.pos || view.selected_group?.pos
      dragOrigin = origin ? { x: origin[0], y: origin[1] } : null
      draggedFrameId = view.node_dragged ? null : view.selected_group?.forgeId || null
      handlers.onDragStart()
    }
    return result
  }
  view.processMouseMove = (event: MouseEvent) => {
    releaseCanvasPan(event)
    const result = originalMove(event)
    // Selected sections ride along when a selected node is dragged. LiteGraph
    // already moves the selected nodes, so only the section boxes shift here.
    const dragged = view.node_dragged
    if (dragged) {
      if (lastDragPos) {
        const dx = dragged.pos[0] - lastDragPos[0]
        const dy = dragged.pos[1] - lastDragPos[1]
        if (dx || dy) {
          const live = byForgeId()
          const frames = new Set<string>()
          for (const group of graph._groups) {
            if (!group.forgeSelected) continue
            group.pos[0] += dx
            group.pos[1] += dy
            frames.add(group.forgeId)
          }
          // Children of a selected section are not selected, so LiteGraph leaves
          // them behind. Carry them with their section.
          if (frames.size) {
            for (const flow of flowNodes) {
              if (!insideSelectedFrame(flow.id, frames)) continue
              const child = live.get(flow.id)
              if (!child || child.is_selected) continue
              child.pos[0] += dx
              child.pos[1] += dy
            }
          }
        }
      }
      lastDragPos = [dragged.pos[0], dragged.pos[1]]
    }
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
    const didMove = moved
    const rect = view.dragging_rectangle
    // originalUp consumes the rectangle. Copy it first. A click on empty canvas
    // still clears the selection; a real marquee keeps whatever it covered.
    const marqueeBox = selecting && rect && (Math.abs(rect[2]) > 10 || Math.abs(rect[3]) > 10) ? dragBox(rect) : null
    const frameDragged = draggedFrameId
    interacting = false
    moved = false
    dragOrigin = null
    draggedFrameId = null
    releasing = true
    let result
    try {
      result = originalUp(event)
    } finally {
      releasing = false
    }
    view.dragging_canvas = false
    const linksAfter = Object.keys(graph.links || {}).length
    if (connecting && connectingOutput && linksAfter === linksBefore && !hit.node) {
      handlers.onConnectEnd({ clientX: event.clientX, clientY: event.clientY, sourceId: connecting.properties.forgeId })
    }
    selecting = false
    const left = event.button === 0
    if (left && marqueeBox) {
      publishSelection(marqueeSelection(marqueeBox, additive))
    } else if (left && frameDragged) {
      // Dragging a section by its title leaves that section selected.
      selectFrame(frameDragged, additive)
    } else if (left && !didMove && !connecting && !hit.node) {
      // A click on a section body or title selects the section and its children.
      const frame = graph.getGroupOnPos(event.canvasX, event.canvasY)
      if (frame?.forgeId) selectFrame(frame.forgeId, additive)
      else if (!additive) {
        view.deselectAllNodes()
        handlers.onPaneClick()
        publishSelection(flowNodes.map((node) => ({ ...node, selected: false })))
      }
    } else if (left && pressedSelected && !didMove && !connecting) {
      // A plain click on a node inside a multi-selection narrows to that node.
      const only = pressedSelected.properties?.forgeId
      publishSelection(flowNodes.map((node) => ({ ...node, selected: node.id === only })))
    } else if (!didMove) commitSelection()
    additive = false
    pressedSelected = null
    lastDragPos = null
    if (didMove) commitGeometry()
    else if (marqueeBox) handlers.onSelectionEnd()
    if (!didMove && !marqueeBox && event.button === 0 && !connecting && hit.node && previewHit(hit.node, event.canvasX - hit.node.pos[0], event.canvasY - hit.node.pos[1])) {
      openNodePreview(hit.node)
    }
    publishViewport()
    return result
  }
  // bindEvents captured the prototype methods. Point the real listeners at the
  // wrappers, or box-select, drag save, and drop-to-add never run.
  canvas.removeEventListener('mousedown', view._mousedown_callback, true)
  view._mousedown_callback = (event: MouseEvent) => {
    if (event.button === 0 && view.graph) {
      view.adjustMouseEvent(event)
      const button = actionAt(event.canvasX, event.canvasY)
      if (button) {
        runAction(button.nodeId, button.id)
        event.stopPropagation()
        event.preventDefault()
        return
      }
      const onNode = view.graph.getNodeOnPos(event.canvasX, event.canvasY, view.visible_nodes, 5)
      const onGroup = frameChrome(event.canvasX, event.canvasY)
      if (!onNode && !onGroup) {
        const link = linkUnder(event.canvasX, event.canvasY)
        if (link) {
          setSelectedLink(link.id)
          event.stopPropagation()
          event.preventDefault()
          return
        }
      }
      setSelectedLink(null)
    }
    return view.processMouseDown(event)
  }
  canvas.addEventListener('mousedown', view._mousedown_callback, true)
  canvas.removeEventListener('mousemove', view._mousemove_callback)
  view._mousemove_callback = (event: MouseEvent) => {
    const result = view.processMouseMove(event)
    trackLinkHover()
    trackWidgetHover()
    const button = event.canvasX == null ? null : actionAt(event.canvasX, event.canvasY)
    const key = button?.key || null
    if (key !== hoverActionKey) {
      hoverActionKey = key
      view.setDirty(true, true)
    }
    if (button) {
      canvas.style.cursor = 'pointer'
      widgetCursor = true
    }
    return result
  }
  canvas.addEventListener('mousemove', view._mousemove_callback)
  canvas.removeEventListener('mouseup', view._mouseup_callback, true)
  view._mouseup_callback = (event: MouseEvent) => view.processMouseUp(event)
  canvas.addEventListener('mouseup', view._mouseup_callback, true)
  view.processContextMenu = (node: any, event: MouseEvent) => {
    event.preventDefault()
    const flow = node?.properties?.forgeId ? flowNodes.find((item) => item.id === node.properties.forgeId) : null
    if (flow) {
      handlers.onNodeContextMenu({ event, node: flow })
      return false
    }
    // A section is a group, not a node. The body is empty canvas for a left
    // drag, but a right-click anywhere on the frame is still that section.
    const group = graph.getGroupOnPos(event.canvasX, event.canvasY)
    if (group?.forgeId) {
      selectFrame(group.forgeId)
      handlers.onFrameContextMenu({ event, id: group.forgeId })
      return false
    }
    handlers.onPaneContextMenu(event)
    return false
  }
  view.showLinkMenu = (link: any, event: MouseEvent) => {
    const source = graph.getNodeById(link.origin_id)
    const target = graph.getNodeById(link.target_id)
    const edge = flowEdges.find((item) => item.source === source?.properties?.forgeId && item.target === target?.properties?.forgeId)
    if (edge) handlers.onEdgeClick({ edge, event })
  }

  function commitSelection() {
    if (silent || releasing) return
    const selected = new Set(Object.values(view.selected_nodes || {}).map((node: any) => node.properties?.forgeId).filter(Boolean))
    // Shift/Ctrl keeps selected sections. A plain node click drops them.
    const next = flowNodes.map((node) => ({
      ...node,
      selected: node.type === 'frame' ? additive && Boolean(node.selected) : selected.has(node.id),
    }))
    publishSelection(next)
  }

  function selectionRegion() {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    // Children of a selected section count as part of it, not as extra items.
    const selectedIds = new Set(flowNodes.filter((node) => node.selected).map((node) => node.id))
    const chosen = flowNodes.filter((node) => node.selected && !(node.parentNode && selectedIds.has(node.parentNode)))
    if (!chosen.length) return null
    for (const node of chosen) {
      const live = node.type === 'frame'
        ? graph._groups.find((group: any) => group.forgeId === node.id)
        : byForgeId().get(node.id)
      if (!live) continue
      const box = node.type === 'frame'
        ? { x: live.pos[0], y: live.pos[1], w: live.size[0], h: live.size[1] }
        : graphNodeBox(live)
      minX = Math.min(minX, box.x)
      minY = Math.min(minY, box.y)
      maxX = Math.max(maxX, box.x + box.w)
      maxY = Math.max(maxY, box.y + box.h)
    }
    if (minX === Infinity) return null
    return [minX, minY, maxX - minX, maxY - minY]
  }

  function selectFrame(id: string, add = false) {
    const selected = new Set([id])
    if (add) for (const node of flowNodes) if (node.selected) selected.add(node.id)
    for (const other of [...selected]) if (insideSelectedFrame(other, selected)) selected.delete(other)
    publishSelection(flowNodes.map((node) => ({ ...node, selected: selected.has(node.id) })))
  }

  function openNodePreview(node: any) {
    const flow = flowNodes.find((item) => item.id === node.properties.forgeId)
    if (!flow) return
    if (canOpenModel(flow)) {
      handlers.onOpenModel(flow.id)
      return
    }
    const url = node.previewUrl
    if (!url) return
    handlers.onPreview({ src: url, alt: flow.data?.label || 'Preview' })
  }

  function onNodeDoubleClick(node: any, _event: MouseEvent, pos: number[]) {
    if (pos && previewHit(node, pos[0], pos[1])) {
      openNodePreview(node)
      return
    }
    restoreTitle(renameNode())
    renamingId = node.properties.forgeId
    // The canvas title uses the same string. Hide it so the field is the only copy.
    node.getTitle = () => ''
    view.setDirty(true, true)
    publishViewport()
  }

  function sync(nodes: any[], edges: any[], nodeRuns: Record<string, any> = {}, missing: Record<string, string[]> = {}) {
    const decorated = decorate(nodes, nodeRuns, missing)
    flowNodes = decorated
    flowEdges = edges
    const nextKey = structureKey(decorated, edges)
    if (nextKey !== lastStructure) rebuild(decorated, edges)
    else patch(decorated)
  }

  function centerOn(graphX: number, graphY: number) {
    const rect = canvas.getBoundingClientRect()
    const scale = view.ds.scale || 1
    view.ds.offset[0] = rect.width / (2 * scale) - graphX
    view.ds.offset[1] = rect.height / (2 * scale) - graphY
    view.setDirty(true, true)
    publishViewport()
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

  // Which Forge node sits under a screen point. Drives hover-only node chrome.
  function nodeIdAt(point: { x: number; y: number }) {
    const flow = screenToFlowCoordinate(point)
    const node = graph.getNodeOnPos(flow.x, flow.y, view.visible_nodes, 5)
    return (node?.properties?.forgeId as string) || null
  }

  function findNode(id: string) {
    const live = byForgeId().get(id) || graph._groups.find((group: any) => group.forgeId === id)
    if (!live) return null
    return { dimensions: { width: live.size[0], height: live.size[1] }, position: { x: live.pos[0], y: live.pos[1] } }
  }

  // Text actions (Run, Run downstream, Stop, Approve) are drawn in the node,
  // in the node's own coordinates. A DOM button kept its own position and
  // stayed where the node used to be.
  function localActions(node: any) {
    const buttons: { key: string; nodeId: string; id: string; label: string; x: number; y: number; w: number; h: number }[] = []
    if (node.flags?.collapsed) return buttons
    const flow = flowNodes.find((item) => item.id === node.properties.forgeId)
    if (!flow) return buttons
    const preview = Boolean(node.previewSlot)
    const actions = actionPlan(flow).filter((action) => !actionIcon(action.id) && !(node.uploadWell && (action.id === 'upload' || action.id === 'clear')))
    if (!actions.length) return buttons
    const width = node.size[0]
    const icons = actionPlan(flow).filter((action) => actionIcon(action.id) && !(node.uploadWell && (action.id === 'upload' || action.id === 'clear')))
    const textRows = packActions(actions, width, 'text')
    const iconRows = preview ? [] : packActions(icons, width, 'icon')
    const rowCount = textRows.length + iconRows.length
    const band = rowCount ? rowCount * ACTION_SIZE + (rowCount - 1) * ACTION_GAP + 12 : 0
    const previewTop = preview || node.uploadWell ? node.size[1] - PREVIEW_HEIGHT : node.size[1]
    let y = previewTop - band + 6
    for (const row of textRows) {
      let x = ACTION_INSET
      for (const item of row) {
        buttons.push({ key: `${flow.id}:${item.id}`, nodeId: flow.id, id: item.id, label: item.label, x, y, w: item.w, h: ACTION_SIZE })
        x += item.w + ACTION_GAP
      }
      y += ACTION_SIZE + ACTION_GAP
    }
    return buttons
  }

  let hoverActionKey: string | null = null
  function paintNodeActions(node: any, ctx: CanvasRenderingContext2D) {
    const buttons = localActions(node)
    if (!buttons.length) return
    const palette = WIDGET_PALETTE.light
    ctx.save()
    ctx.font = `600 12px ${CANVAS_FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineWidth = 1
    for (const button of buttons) {
      const hot = hoverActionKey === button.key
      const primary = button.id === 'run' || button.id === 'downstream' || button.id === 'approve'
      const radius = button.w < 60 ? button.w / 2 : button.h / 2
      // Clear the node body first, then the pill's own drop shadow and face.
      ctx.fillStyle = NODE_BODY_COLOR
      ctx.fillRect(button.x - 2, button.y - 2, button.w + 4, button.h + 6)
      ctx.beginPath()
      if (ctx.roundRect) ctx.roundRect(button.x, button.y + 1, button.w, button.h, radius)
      else ctx.rect(button.x, button.y + 1, button.w, button.h)
      ctx.fillStyle = '#d6c6a6'
      ctx.fill()
      ctx.beginPath()
      if (ctx.roundRect) ctx.roundRect(button.x, button.y, button.w, button.h, radius)
      else ctx.rect(button.x, button.y, button.w, button.h)
      ctx.fillStyle = primary ? '#19b8aa' : (hot ? palette.hover : palette.field)
      ctx.fill()
      ctx.strokeStyle = primary ? '#12a294' : (hot ? palette.hoverOutline : palette.outline)
      ctx.stroke()
      ctx.fillStyle = primary ? '#ffffff' : palette.text
      ctx.fillText(button.label, button.x + button.w / 2, button.y + button.h / 2)
    }
    ctx.restore()
  }

  function actionAt(x: number, y: number) {
    const node = view.graph?.getNodeOnPos(x, y, view.visible_nodes, 5)
    if (!node) return null
    const localX = x - node.pos[0]
    const localY = y - node.pos[1]
    for (const button of localActions(node)) {
      if (localX >= button.x && localX <= button.x + button.w && localY >= button.y && localY <= button.y + button.h) return button
    }
    return null
  }

  function actionChrome() {
    const buttons: { key: string; nodeId: string; id: string; label: string; icon: string; kind: 'icon' | 'text'; x: number; y: number; w: number; h: number }[] = []
    for (const node of graph._nodes) {
      if (node.flags?.collapsed) continue
      const flow = flowNodes.find((item) => item.id === node.properties.forgeId)
      if (!flow) continue
      const preview = Boolean(node.previewSlot)
      const actions = actionPlan(flow).filter((action) => actionIcon(action.id) && !(node.uploadWell && (action.id === 'upload' || action.id === 'clear')))
      if (!actions.length) continue
      const width = node.size[0]
      const texts = actionPlan(flow).filter((action) => !actionIcon(action.id))
      const textRows = packActions(texts, width, 'text')
      const iconRows = preview ? [] : packActions(actions, width, 'icon')
      const rowCount = textRows.length + iconRows.length
      const band = rowCount ? rowCount * ACTION_SIZE + (rowCount - 1) * ACTION_GAP + 12 : 0
      const previewTop = preview || node.uploadWell ? node.size[1] - PREVIEW_HEIGHT : node.size[1]
      let y = node.pos[1] + previewTop - band + 6 + textRows.length * (ACTION_SIZE + ACTION_GAP)
      for (const row of iconRows) {
        let x = node.pos[0] + ACTION_INSET
        for (const item of row) {
          buttons.push({
            key: `${flow.id}:${item.id}`,
            nodeId: flow.id,
            id: item.id,
            label: item.label,
            icon: actionIcon(item.id),
            kind: item.kind,
            x,
            y,
            w: item.w,
            h: ACTION_SIZE,
          })
          x += item.w + ACTION_GAP
        }
        y += ACTION_SIZE + ACTION_GAP
      }
      if (!preview) continue
      let x = node.pos[0] + width - ACTION_INSET - actions.length * ACTION_SIZE - (actions.length - 1) * ACTION_GAP
      const iconY = node.pos[1] + node.size[1] - PREVIEW_HEIGHT + 12
      for (const action of actions) {
        buttons.push({
          key: `${flow.id}:${action.id}`,
          nodeId: flow.id,
          id: action.id,
          label: action.label,
          icon: actionIcon(action.id),
          kind: 'icon',
          x,
          y: iconY,
          w: ACTION_SIZE,
          h: ACTION_SIZE,
        })
        x += ACTION_SIZE + ACTION_GAP
      }
    }
    return buttons
  }

  function uploadWells() {
    const wells = []
    for (const node of graph._nodes) {
      if (!node.uploadWell || node.flags?.collapsed) continue
      const nodeId = node.properties.forgeId
      wells.push({
        key: nodeId,
        nodeId,
        x: node.pos[0] + 8,
        y: node.pos[1] + node.size[1] - PREVIEW_HEIGHT + 4,
        w: node.size[0] - 16,
        h: PREVIEW_HEIGHT - 12,
      })
    }
    return wells
  }

  function selectedFrameButton() {
    const frame = flowNodes.find((node) => node.type === 'frame' && node.selected)
    const group = frame && graph._groups.find((item: any) => item.forgeId === frame.id)
    if (!frame || !group) return null
    const scale = view.ds.scale
    const fontSize = group.font_size || 24
    const titleWidth = measureText(String(group.title || ''), `${fontSize}px Arial`)
    const buttonHeight = 22
    // Title baseline sits fontSize below the section top. Center the button on that text.
    const textCenter = fontSize - 9
    return {
      id: frame.id,
      left: (group.pos[0] + 4 + titleWidth + 8 + view.ds.offset[0]) * scale,
      top: (group.pos[1] + textCenter + view.ds.offset[1]) * scale - buttonHeight / 2,
    }
  }

  view.node_title_color = '#fff'
  view.title_text_font = `600 15px ${CANVAS_FONT}`
  view.inner_text_font = `12px ${CANVAS_FONT}`
  LiteGraph.NODE_SELECTED_TITLE_COLOR = '#fff'
  LiteGraph.NODE_TEXT_COLOR = NODE_INK

  const hostApi = {
    sync,
    scheduleEdges,
    onNodeDoubleClick,
    renameField,
    closeRename,
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
      const color = LINK_COLOR[next] || LINK_COLOR.dark
      view.default_link_color = color
      LiteGraph.CONNECTING_LINK_COLOR = color
      view.clear_background_color = '#d3ecdb'
      view.background_image = next === 'light' ? null : LGraphCanvas.DEFAULT_BACKGROUND_IMAGE
      // Node bodies take their color when built. Repaint the live ones too, or
      // a theme switch leaves light bodies under dark widgets.
      for (const node of graph._nodes) node.bgcolor = NODE_BODY_COLOR
      view.setDirty(true, true)
    },
    fitView,
    centerOn,
    screenToFlowCoordinate,
    nodeIdAt,
    findNode,
    selectedFrameButton,
    actionChrome,
    uploadWells,
    textFields,
    commitText,
    paintNodeActions,
    runNodeAction: runAction,
    destroy() {
      window.removeEventListener('keydown', onLinkKey, true)
      canvas.removeEventListener('keydown', view._key_callback, true)
      document.removeEventListener('keyup', view._key_callback, true)
      canvas.removeEventListener('mousedown', view._mousedown_callback, true)
      canvas.removeEventListener('mousemove', view._mousemove_callback)
      canvas.removeEventListener('mouseup', view._mouseup_callback, true)
      canvas.removeEventListener('pointerleave', clearLinkHover)
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
