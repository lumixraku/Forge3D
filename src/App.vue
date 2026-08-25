<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { SelectionMode, VueFlow, addEdge, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import '@vue-flow/node-resizer/dist/style.css'
import AssetLibraryView from './components/AssetLibraryView.vue'
import CanvasContextMenu from './components/CanvasContextMenu.vue'
import CanvasToolbar from './components/CanvasToolbar.vue'
import ChatPanel from './components/ChatPanel.vue'
import FrameNode from './components/FrameNode.vue'
import ImagePreviewOverlay from './components/ImagePreviewOverlay.vue'
import DebugPanel from './components/DebugPanel.vue'
import ExecutionOutputPanel from './components/ExecutionOutputPanel.vue'
import RunLogPanel from './components/RunLogPanel.vue'
import TopBar from './components/TopBar.vue'
import CanvasNode from './components/CanvasNode.vue'
import ExecutionEdge from './components/ExecutionEdge.vue'
import { useAgentChat } from './composables/useAgentChat'
import { useAssetLibrary } from './composables/useAssetLibrary'
import { useCanvasFrames } from './composables/useCanvasFrames'
import { useFrameDraw } from './composables/useFrameDraw'
import { useCanvasHistory } from './composables/useCanvasHistory'
import { useCanvasPresence } from './composables/useCanvasPresence'
import { useCanvasSelection } from './composables/useCanvasSelection'
import { useKeyboardShortcuts } from './composables/useKeyboardShortcuts'
import { useTheme } from './composables/useTheme'
import { useCanvasDocument } from './composables/useCanvasDocument'
import { useCanvasRun } from './composables/useCanvasRun'
import { useDebugSettings } from './composables/useDebugSettings'
import { request } from './api'
import { edgeDefaults, nodePresentation } from './canvas-graph'
import { canConnectNodeTypes, compatibleNodeTypes, hasModelEditor, isExecutableNodeType, missingInputsByNode, nodeCatalog, nodeCategories, nodeDefaults, nodeInputPorts, nodeOutputPorts } from './canvas-nodes'

const ModelEditor = defineAsyncComponent(() => import('./components/ModelEditor.vue'))

// The document and canvas state every composable below works on.
const canvases = ref([])
const activeCanvas = ref(null)
const activeSession = ref(null)
const nodes = ref([])
const edges = ref([])
const run = ref(null)
const nodeRuns = ref({})
const agentBusy = ref(false)
const canvasBusy = ref(false)
const error = ref('')
const canvasError = ref('')
const saving = ref(false)
const savedState = ref('Saved')
// A canvas switch invalidates both independently-running domains. A node run and
// an Agent turn never invalidate or block one another.
const agentToken = ref(0)
const canvasRunToken = ref(0)
const account = ref(null)

async function loadAccount() {
  account.value = await request('/api/account')
}

// Canvas chrome: menus, overlays and the two view/mode switches.
const contextMenu = ref(null)
const nodeMenuOpen = ref(false)
const nodeMenuContext = ref(null)
const viewportDismissVersion = ref(0)
const canvasMenu = ref(null)
const canvasSwitcherOpen = ref(false)
const workspaceMode = ref('canvas')
const canvasMode = ref('select')
const canvasView = ref('canvas')
const modelEditorNodeId = ref(null)
const imagePreview = ref(null)
const runSummaryOpen = ref(false)
const taskQueueOpen = ref(false)
const editLockedNoticeOpen = ref(false)
const editLockedNoticeName = ref('')
let pendingConnection = null
const connectionSourceId = ref(null)
let editLockedNoticeTimer

const executionEdges = computed(() => edges.value.map((edge) => ({
  ...edge,
  type: 'execution',
  data: { ...edge.data, running: nodeRuns.value[edge.target]?.status === 'running' },
})))

const { findNode, fitView, screenToFlowCoordinate, updateNodeInternals, viewport } = useVueFlow()
const { theme, resolvedTheme, setTheme } = useTheme()
const {
  clientId, canEdit, editorName, acquireEditLease, markEditActivity, configureIdleRelease,
  applyPresenceEvent, canvasOpened, releasePresence,
} = useCanvasPresence({ activeCanvas, error })

function ensureEditAccess(event?: Event) {
  if (!canEdit.value) {
    if (editorName.value) showEditLockedNotice()
    acquireEditLease()
  }
  return true
}

function showEditLockedNotice() {
  if (!editorName.value) return
  editLockedNoticeName.value = editorName.value
  editLockedNoticeOpen.value = true
  clearTimeout(editLockedNoticeTimer)
  editLockedNoticeTimer = setTimeout(() => {
    editLockedNoticeOpen.value = false
    editLockedNoticeName.value = ''
  }, 3000)
}

watch(editorName, (name) => {
  if (name) showEditLockedNotice()
})

const {
  selectedNodes, frameableSelectedNodes, canFrameSelection, canDissolveSelection,
  selectedCount, hasSelection, deleteSelected, dissolveSelectedFrames, selectAll,
  selectCanvasEdge, copySelected, pasteFragment, duplicateSelected, createCanvasFromSelection,
} = useCanvasSelection({
  nodes,
  edges,
  activeCanvas,
  error,
  saveCanvas: () => saveCanvas(),
  fromCanvas: () => fromCanvas(),
  toCanvas: (canvas) => toCanvas(canvas),
  loadCanvass: (preferredId) => loadCanvass(preferredId),
  focusNodes,
})

const {
  fitFramesAfterRender, suppressFrameFit, makeSelectionFrame, onCanvasPointerDown, onSelectionStart, onSelectionEnd,
  onElementsChange, onFrameResizeEnd, onNodeDragStart, onNodeDragStop, autoLayout,
} = useCanvasFrames({
  nodes,
  edges,
  screenToFlowCoordinate,
  updateNodeInternals,
  saveCanvas: () => saveCanvas(),
  frameableSelectedNodes,
  nextNodeId,
  focusNode,
})

const { drawRect: frameDrawRect, drawing: frameDrawing, onFrameDrawPointerDown, cancelFrameDraw } = useFrameDraw({
  nodes,
  edges,
  canvasMode,
  activeCanvas,
  screenToFlowCoordinate,
  nextNodeId,
  saveCanvas: () => saveCanvas(),
  // A click that never became a drag falls back to the default centred section.
  createDefaultFrame: (point) => addNode('frame', null, point),
})

const { syncHistoryCanvas, recordHistory, undo, redo } = useCanvasHistory({
  nodes,
  edges,
  activeCanvas,
  hydrating: computed(() => hydrating.value),
  updateNodeInternals,
  saveCanvas: () => saveCanvas(),
})

const {
  hydrating, toCanvas, fromCanvas, syncCanvasSummary, loadCanvass, openCanvas,
  saveCanvas, stopPendingSave, duplicateCanvas, deleteCanvas, createCanvas,
  renameCanvas, exportCanvas, importCanvasFile, refreshCanvasFromServer,
} = useCanvasDocument({
  canvases,
  activeCanvas,
  activeSession,
  nodes,
  edges,
  run,
  nodeRuns,
  busy: agentBusy,
  error,
  saving,
  savedState,
  agentToken,
  canvasRunToken,
  fitView,
  recordHistory,
  syncHistoryCanvas,
  fitFramesAfterRender,
  suppressFrameFit,
  loadSessions: (id) => loadSessions(id),
  restoreTurns: () => restoreTurns(),
  subscribeCanvasEvents: (id) => subscribeCanvasEvents(id),
  closeCanvasEvents: () => closeCanvasEvents(),
  pasteFragment,
  resetWorkspace,
  closeCanvasSwitcher,
  clientId,
  canvasOpened,
  releasePresence,
  acquireEditLease,
  markEditActivity,
})

const {
  composer, composerHasContent, messages, selectedOptions, continuingTurnId, addComposerFiles,
  loadSessions, restoreTurns, subscribeCanvasEvents, closeCanvasEvents, toggleSelectedOption,
  continueTurn, sendMessage, retryMessage,
} = useAgentChat({
  activeCanvas,
  activeSession,
  busy: agentBusy,
  error,
  runToken: agentToken,
  toCanvas: (canvas) => toCanvas(canvas),
  syncCanvasSummary: (canvas) => syncCanvasSummary(canvas),
  // An Agent turn cannot wait out the debounce: the server reads the canvas.
  saveCanvas: () => saveCanvas({ immediate: true }),
  onCanvasEvent: applyPresenceEvent,
  onCanvasDocumentEvent: () => Promise.all([refreshCanvasFromServer(), loadAccount()]),
  clientId,
  acquireEditLease,
  markEditActivity,
})

configureIdleRelease({
  // Releasing the edit lease hands the canvas to someone else, so land it first.
  flush: () => saveCanvas({ immediate: true }),
  isBusy: () => saving.value || agentBusy.value || isRunning.value,
})

const { capabilitiesError, debugPanelOpen, selectedProvider, activeProvider, tripoAvailable, tripoNodeTypes, setProvider } = useDebugSettings()

const { isRunning, runDetails, runSummary, runCanvas, cancelRun, executions, executionsLoading, loadExecutions, activeExecutions } = useCanvasRun({
  activeCanvas,
  nodes,
  edges,
  run,
  nodeRuns,
  canvasBusy,
  error: canvasError,
  runToken: canvasRunToken,
  // A run cannot wait out the debounce: creating it reads the saved canvas.
  saveCanvas: () => saveCanvas({ immediate: true }),
  materializeRunBatch: (sourceId, runId, previews) => materializeRunBatch(sourceId, runId, previews),
  onAccountChanged: loadAccount,
  // Null lets the server pick; the debug panel forces one backend.
  provider: selectedProvider,
})

watch([() => run.value?.id, () => run.value?.status], ([runId]) => {
  if (runId) taskQueueOpen.value = true
})

watch(() => activeCanvas.value?.id, (canvasId) => { loadExecutions(canvasId) }, { immediate: true })

// Cover every insertion and removal path, including Vue Flow's native delete
// event, while the document's debounced scheduler coalesces rapid changes.
watch(() => nodes.value.length, () => {
  saveCanvas()
}, { flush: 'sync' })

// A section runs from its first executable child that nothing inside the section
// feeds, falling back to the first executable child when they are all fed.
function sectionEntryNodeId(frameId) {
  const children = nodes.value.filter((node) => node.parentNode === frameId)
  const childIds = new Set(children.map((node) => node.id))
  const executable = children.filter((node) => isExecutableNodeType(node.data?.canvasType))
  return executable.find((node) => !edges.value.some((edge) => childIds.has(edge.source) && edge.target === node.id))?.id
    || executable[0]?.id
}

function runSection(frameId) {
  const entryNodeId = sectionEntryNodeId(frameId)
  if (entryNodeId) runCanvas(entryNodeId, 'downstream')
}

function sectionIsRunning(frameId) {
  return nodes.value.some((node) => node.parentNode === frameId
    && ['queued', 'running', 'cancelling'].includes(nodeRuns.value[node.id]?.status))
}

const { rails: assetRails, library: assetLibrary, loading: assetsLoading, loadAssets } = useAssetLibrary({ activeCanvas, error })

const panOnDrag = computed(() => canvasMode.value === 'move')
// While the section tool is armed the canvas must not drag or select anything:
// with both off Vue Flow drops pointer events on its nodes, so the whole pane
// answers the draw gesture uniformly.
const canvasInteractive = computed(() => canvasMode.value !== 'frame')
// The preview sits outside Vue Flow's transformation pane, so it carries the
// viewport transform itself and draws in plain flow coordinates.
const frameDrawLayerStyle = computed(() => ({
  transform: `translate(${viewport.value.x}px, ${viewport.value.y}px) scale(${viewport.value.zoom})`,
}))
const frameDrawRectStyle = computed(() => frameDrawRect.value ? {
  left: `${frameDrawRect.value.left}px`,
  top: `${frameDrawRect.value.top}px`,
  width: `${frameDrawRect.value.right - frameDrawRect.value.left}px`,
  height: `${frameDrawRect.value.bottom - frameDrawRect.value.top}px`,
  // The layer is scaled by the viewport, so undo that for the hairline border.
  borderWidth: `${1 / viewport.value.zoom}px`,
  borderRadius: `${15 / viewport.value.zoom}px`,
} : {})
// The readout rides outside the rectangle at a screen-constant size, like the
// section title in FrameNode.
const frameDrawLabelStyle = computed(() => ({
  transform: `translateY(${-6 / viewport.value.zoom}px) scale(${1 / viewport.value.zoom})`,
}))
const frameDrawSize = computed(() => frameDrawRect.value
  ? `${Math.round(frameDrawRect.value.right - frameDrawRect.value.left)} × ${Math.round(frameDrawRect.value.bottom - frameDrawRect.value.top)}`
  : '')
const toolbarMenuOpen = computed(() => nodeMenuOpen.value && !nodeMenuContext.value)
// Assets outlive their nodes, so the model editor is only offered for the ones
// whose node is still on the canvas.
const canvasNodeIds = computed(() => nodes.value.map((node) => node.id))
const modelEditorNode = computed(() => nodes.value.find((node) => node.id === modelEditorNodeId.value) || null)

// The library reads the run history, so it is refetched when the panel opens and
// whenever a run finishes adding to that history.
watch([canvasView, () => activeCanvas.value?.id], ([view]) => {
  if (view === 'assets') loadAssets()
})
watch(isRunning, (running, wasRunning) => {
  if (wasRunning && !running && canvasView.value === 'assets') loadAssets()
})

// The single input handle is untyped, so the inbound media is read from what
// each upstream node produces rather than from a named target port.
function inboundSourceNodes(nodeId) {
  return edges.value
    .filter((edge) => edge.target === nodeId)
    .map((edge) => nodes.value.find((node) => node.id === edge.source))
    .filter(Boolean)
}

function inboundExportTarget(nodeId) {
  const sources = inboundSourceNodes(nodeId)
  if (sources.some((node) => nodeOutputPorts(node.data?.canvasType)[0]?.type === 'model')) return '3D Model'
  if (sources.some((node) => nodeOutputPorts(node.data?.canvasType)[0]?.type === 'image')) return 'Image'
  return null
}

function inboundImage(nodeId) {
  for (const source of inboundSourceNodes(nodeId)) {
    if (nodeOutputPorts(source.data?.canvasType)[0]?.type !== 'image') continue
    const config = source.data?.config
    const image = config?.selectedPreview || config?.preview || config?.previews?.[0]
    if (image) return image
  }
  return null
}

// A node that still needs inbound content cannot run, so the canvas explains
// what is missing rather than letting the run reach the server and come back a
// 400. Read from the domain canvas because the check follows named ports, while
// the canvas keeps its connections on a single untyped handle — converted once
// per canvas change for every node rather than once per node.
const missingInputs = computed(() => {
  void nodes.value
  void edges.value
  const canvas = fromCanvas()
  return canvas ? missingInputsByNode(canvas) : {}
})

function onConnect(connection) {
  addConnection(connection)
  pendingConnection = null
}

function onConnectStart(connection) {
  pendingConnection = connection.handleType === 'source' ? { nodeId: connection.nodeId, sourceHandle: connection.handleId } : null
  connectionSourceId.value = pendingConnection?.nodeId || null
}

function isValidConnection(connection) {
  if (!connection?.source || !connection?.target || connection.source === connection.target) return false
  const source = nodes.value.find((node) => node.id === connection.source)
  const target = nodes.value.find((node) => node.id === connection.target)
  return Boolean(source && target && canConnectNodeTypes(source.data.canvasType, target.data.canvasType))
}

function addConnection(connection) {
  const source = nodes.value.find((node) => node.id === connection.source)
  const target = nodes.value.find((node) => node.id === connection.target)
  if (!source || !target || !isValidConnection(connection)) return false
  const exists = edges.value.some((edge) => edge.source === source.id && edge.target === target.id)
  if (exists) return false
  edges.value = addEdge({
    id: `edge-${source.id}-${target.id}-${Date.now().toString(36)}`,
    source: source.id,
    target: target.id,
    sourceHandle: 'output',
    targetHandle: 'input',
    ...edgeDefaults,
  }, edges.value)
  saveCanvas()
  return true
}

function onConnectEnd(event) {
  if (!pendingConnection) {
    pendingConnection = null
    return
  }
  const pointerEvent = event?.event || event
  const point = pointerEvent?.changedTouches?.[0] || pointerEvent
  const targetElement = point ? document.elementFromPoint(point.clientX, point.clientY)?.closest('.vue-flow__node') : null
  const target = targetElement?.dataset.id
  if (target) {
    addConnection({ source: pendingConnection.nodeId, sourceHandle: 'output', target, targetHandle: 'input' })
  }
  else if (point) openNodeMenuAt(point.clientX, point.clientY, pendingConnection.nodeId)
  pendingConnection = null
  connectionSourceId.value = null
}

function onConnectCancel() {
  pendingConnection = null
  connectionSourceId.value = null
}

function updateNodeConfig(id, config) {
  const node = nodes.value.find((candidate) => candidate.id === id)
  if (!node) return
  node.data = { ...node.data, config }
  saveCanvas()
}

function updateNodeName(id, name) {
  const node = nodes.value.find((candidate) => candidate.id === id)
  const normalized = name.trim()
  if (!node || !normalized || normalized === node.data.label) return
  node.data = { ...node.data, label: normalized }
  saveCanvas()
}

function openModelEditor(id) {
  if (!id) return
  const node = nodes.value.find((candidate) => candidate.id === id)
  const uploadedModel = node?.data.canvasType === 'reference-image' && node.data.config.assetType === 'model' && typeof node.data.config.modelUrl === 'string'
  if (!node || !hasModelEditor(node.data.canvasType) || (!uploadedModel && nodeRuns.value[id]?.status !== 'succeeded')) return
  modelEditorNodeId.value = node.id
  workspaceMode.value = 'model-editor'
  nextTick(() => window.scrollTo({ top: 0 }))
}

function closeModelEditor() {
  workspaceMode.value = 'canvas'
  modelEditorNodeId.value = null
  nextTick(() => {
    window.scrollTo({ top: 0 })
    fitView({ padding: 0.18, duration: 300 })
  })
}

function openImagePreview(preview) {
  imagePreview.value = preview
}

function closeImagePreview() {
  imagePreview.value = null
}

// Opening another canvas leaves the model editor and any open overlay behind.
function resetWorkspace() {
  closeCanvasSwitcher()
  cancelFrameDraw()
  canvasMode.value = 'select'
  imagePreview.value = null
  workspaceMode.value = 'canvas'
  modelEditorNodeId.value = null
}

function nextNodeId(type, taken = new Set()) {
  const ids = new Set([...nodes.value.map((node) => node.id), ...taken])
  if (!ids.has(type)) return type
  let index = 2
  while (ids.has(`${type}-${index}`)) index += 1
  return `${type}-${index}`
}

function nodePosition(sourceId) {
  const source = sourceId ? nodes.value.find((node) => node.id === sourceId) : null
  if (source) return { x: source.position.x + 340, y: source.position.y }
  const selected = selectedNodes.value[0]
  if (selected) return { x: selected.position.x + 310, y: selected.position.y + 24 }
  if (!nodes.value.length) return { x: 120, y: 120 }
  return {
    x: Math.max(...nodes.value.map((node) => node.position.x)) + 310,
    y: Math.min(...nodes.value.map((node) => node.position.y)),
  }
}

function canvasCenterPosition() {
  const bounds = document.querySelector('.forge3d-flow-canvas')?.getBoundingClientRect()
  if (!bounds) return { x: 120, y: 120 }
  return screenToFlowCoordinate({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 })
}

// fitView silently ignores nodes it has not measured yet, and a freshly added
// node is measured by a ResizeObserver whose timing we cannot predict, so wait
// for real dimensions rather than a fixed number of frames.
async function waitForNodeDimensions(ids, attempts = 30) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (ids.every((id) => {
      const node = findNode(id)
      return node && node.dimensions.width > 0 && node.dimensions.height > 0
    })) return true
    await new Promise((resolve) => requestAnimationFrame(resolve))
  }
  return false
}

async function focusNodes(ids, padding = 0.25) {
  if (!ids.length) return
  await nextTick()
  await waitForNodeDimensions(ids)
  fitView({ nodes: ids, padding, maxZoom: 1, duration: 350 })
}

function focusNode(id, padding = 0.25) {
  focusNodes([id], padding)
}

function fitCanvasView() {
  const selectedIds = selectedNodes.value.map((node) => node.id)
  fitView({ ...(selectedIds.length ? { nodes: selectedIds } : {}), padding: 0.18, duration: 400 })
}

function buildCanvasNode(type, { id, position, selected = false, config, parentNode } = {}) {
  const [kind, detail, tone] = nodePresentation[type]
  return {
    id: id || nextNodeId(type),
    type: 'canvas',
    position,
    parentNode,
    selected,
    data: {
      kind,
      label: nodeCatalog.find((item) => item.type === type)?.label || type,
      detail,
      tone,
      status: 'ready',
      canvasType: type,
      config: { ...nodeDefaults(type), ...config },
      inputPorts: nodeInputPorts(type),
      outputPorts: nodeOutputPorts(type),
    },
  }
}

function addNode(type, sourceId, position) {
  const presentation = nodePresentation[type]
  if (!presentation || !activeCanvas.value) return
  if (type === 'frame') {
    const width = 900
    const height = 600
    const center = position || canvasCenterPosition()
    const frame = {
      id: nextNodeId(type),
      type: 'frame',
      position: { x: center.x - width / 2, y: center.y - height / 2 },
      width,
      height,
      selected: true,
      style: { pointerEvents: 'none' },
      data: { label: 'New canvas section', description: '' },
    }
    nodes.value = [frame, ...nodes.value.map((item) => ({ ...item, selected: false }))]
    closeContextMenu()
    saveCanvas()
    focusNode(frame.id)
    return
  }
  const node = buildCanvasNode(type, { position: position || nodePosition(sourceId), selected: true })
  nodes.value = [...nodes.value.map((item) => ({ ...item, selected: false })), node]
  closeContextMenu()
  saveCanvas()
  nextTick(() => {
    if (sourceId) {
      addConnection({ source: sourceId, sourceHandle: 'output', target: node.id, targetHandle: 'input' })
    }
  })
  // fitView ignores nodes it has not measured yet, so this has to wait for the
  // node to render or the viewport would never move.
  focusNode(node.id)
}

// Generated images are paid artifacts, so a rerun never overwrites an earlier
// batch: each run appends a fresh column of generated-image nodes to the right
// of the source, stacked below whatever previous batches already occupy.
const BATCH_COLUMN_GAP = 340
const BATCH_ROW_GAP = 150

function batchOrigin(sourceNode) {
  const existing = nodes.value.filter((node) => node.data?.config?.runBatch?.sourceId === sourceNode.id)
  const x = sourceNode.position.x + BATCH_COLUMN_GAP
  if (!existing.length) return { x, y: sourceNode.position.y }
  return { x, y: Math.max(...existing.map((node) => node.position.y)) + BATCH_ROW_GAP }
}

function materializeRunBatch(sourceId, runId, previews) {
  const source = nodes.value.find((node) => node.id === sourceId)
  if (!source || !previews.length) return
  // Idempotent: polling delivers the same succeeded output repeatedly.
  if (nodes.value.some((node) => node.data?.config?.runBatch?.runId === runId && node.data?.config?.runBatch?.sourceId === sourceId)) return

  const origin = batchOrigin(source)
  const taken = new Set()
  const created = previews.map((preview, index) => {
    const id = nextNodeId('generated-image', taken)
    taken.add(id)
    return buildCanvasNode('generated-image', {
      id,
      position: { x: origin.x + index * BATCH_COLUMN_GAP, y: origin.y },
      parentNode: source.parentNode,
      config: { preview, runBatch: { runId, sourceId, index } },
    })
  })

  nodes.value = [...nodes.value, ...created]
  nextTick(() => {
    for (const node of created) {
      addConnection({ source: sourceId, sourceHandle: 'output', target: node.id, targetHandle: 'input' })
    }
    saveCanvas()
  })
}

function catalogForMenu() {
  if (!nodeMenuContext.value?.sourceId) return nodeCatalog.filter((item) => !item.hidden)
  const source = nodes.value.find((node) => node.id === nodeMenuContext.value.sourceId)
  return source ? compatibleNodeTypes(source.data.canvasType) : []
}

function openNodeMenuAt(clientX, clientY, sourceId = null) {
  nodeMenuContext.value = {
    sourceId,
    position: screenToFlowCoordinate({ x: clientX, y: clientY }),
    left: clientX,
    top: clientY,
  }
  nodeMenuOpen.value = true
  constrainContextMenu()
}

function closeContextMenu() {
  nodeMenuOpen.value = false
  nodeMenuContext.value = null
}

function dismissCanvasPopups() {
  closeContextMenu()
  viewportDismissVersion.value += 1
}

function openCanvasMenu(event, canvas) {
  event.preventDefault()
  const width = 164
  const height = 84
  const gap = 8
  canvasMenu.value = {
    canvasId: canvas.id,
    left: Math.min(event.clientX, window.innerWidth - width - gap),
    top: Math.min(event.clientY, window.innerHeight - height - gap),
  }
}

function closeCanvasMenu() {
  canvasMenu.value = null
}

function closeCanvasSwitcher() {
  canvasSwitcherOpen.value = false
}

function runCanvasMenuAction(action) {
  const canvasId = canvasMenu.value?.canvasId
  closeCanvasMenu()
  action(canvasId)
}

async function constrainContextMenu() {
  await nextTick()
  const menu = contextMenu.value?.$el
  if (!menu || !nodeMenuContext.value) return
  const panel = document.querySelector('.forge3d-flow-canvas')?.getBoundingClientRect()
  if (!panel) return
  const gap = 8
  nodeMenuContext.value.maxWidth = Math.max(0, panel.width - gap * 2)
  nodeMenuContext.value.maxHeight = Math.max(0, panel.height - gap * 2)
  await nextTick()
  nodeMenuContext.value.left = Math.max(panel.left + gap, Math.min(nodeMenuContext.value.left + gap, panel.right - menu.offsetWidth - gap))
  nodeMenuContext.value.top = Math.max(panel.top + gap, Math.min(nodeMenuContext.value.top + gap, panel.bottom - menu.offsetHeight - gap))
}

function openSelectionMenuAt(clientX, clientY) {
  nodeMenuContext.value = { kind: 'selection', left: clientX, top: clientY }
  nodeMenuOpen.value = true
  constrainContextMenu()
}

function onPaneContextMenu(event) {
  event.preventDefault()
  const selectedElements = [...document.querySelectorAll('.vue-flow__node.selected')]
  if (selectedElements.length) {
    const rects = selectedElements.map((element) => element.getBoundingClientRect())
    const bounds = {
      left: Math.min(...rects.map((rect) => rect.left)),
      top: Math.min(...rects.map((rect) => rect.top)),
      right: Math.max(...rects.map((rect) => rect.right)),
      bottom: Math.max(...rects.map((rect) => rect.bottom)),
    }
    if (event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom) {
      openSelectionMenuAt(event.clientX, event.clientY)
      return
    }
  }
  openNodeMenuAt(event.clientX, event.clientY)
}

function onNodeContextMenu({ event, node }) {
  event.preventDefault()
  if (!node.selected) {
    nodes.value = nodes.value.map((item) => ({ ...item, selected: item.id === node.id }))
    edges.value = edges.value.map((edge) => ({ ...edge, selected: false }))
  }
  openSelectionMenuAt(event.clientX, event.clientY)
}

function onSelectionContextMenu({ event }) {
  event.preventDefault()
  openSelectionMenuAt(event.clientX, event.clientY)
}

function runContextMenuAction(action) {
  closeContextMenu()
  action()
}

function selectNodeType(type) {
  const context = nodeMenuContext.value
  // A section is drawn, not placed: picking it from the menu arms the draw tool
  // instead of dropping a frame where the menu happened to be open.
  if (type === 'frame') {
    closeContextMenu()
    canvasMode.value = 'frame'
    return
  }
  addNode(type, context?.sourceId, context?.position)
}

function toggleFrameMode() {
  cancelFrameDraw()
  canvasMode.value = canvasMode.value === 'frame' ? 'select' : 'frame'
}

function startNodeDrag(event, type) {
  event.dataTransfer.setData('application/x-canvas-node', type)
  event.dataTransfer.effectAllowed = 'copy'
}

function onCanvasDragOver(event) {
  if (event.dataTransfer.types.includes('application/x-canvas-node')) event.preventDefault()
}

function onCanvasDrop(event) {
  const type = event.dataTransfer.getData('application/x-canvas-node')
  if (!type) return
  event.preventDefault()
  addNode(type, null, screenToFlowCoordinate({ x: event.clientX, y: event.clientY }))
}

useKeyboardShortcuts({
  imagePreview,
  workspaceMode,
  canvasSwitcherOpen,
  nodeMenuOpen,
  canvasMenu,
  hasSelection,
  canvasMode,
  frameDrawing,
  cancelFrameDraw,
  closeImagePreview,
  closeModelEditor,
  closeCanvasSwitcher,
  closeContextMenu,
  closeCanvasMenu,
  openNodeMenuAt,
  undo,
  redo,
  selectAll,
  copySelected,
  pasteFragment,
  duplicateSelected,
  deleteSelected,
  ensureEditAccess,
})

async function handleProjectNavigation() {
  const projectId = window.location.pathname.match(/^\/projects\/([^/]+)\/?$/)?.[1]
  if (!projectId || projectId === activeCanvas.value?.id) return

  try {
    await openCanvas(projectId, { replaceHistory: true })
  } catch (caught) {
    error.value = caught.message
  }
}

function preventNativePinchZoom(event: Event) {
  event.preventDefault()
}

function preventPageTrackpadPinchZoom(event: WheelEvent) {
  if (event.ctrlKey && !(event.target instanceof Element && event.target.closest('.forge3d-flow-canvas'))) event.preventDefault()
}

async function releaseOnBlur() {
  try {
    await saveCanvas({ immediate: true, keepalive: true })
  } finally {
    await releasePresence(undefined, { keepalive: true })
  }
}

function flushWhenHidden() {
  if (document.visibilityState === 'hidden') releaseOnBlur()
  else refreshOnFocus()
}

function refreshOnFocus() {
  refreshCanvasFromServer().catch((caught) => { error.value = caught.message })
}

onMounted(async () => {
  window.addEventListener('pointerdown', closeCanvasMenu)
  window.addEventListener('popstate', handleProjectNavigation)
  window.addEventListener('blur', releaseOnBlur)
  window.addEventListener('focus', refreshOnFocus)
  window.addEventListener('pagehide', releaseOnBlur)
  document.addEventListener('visibilitychange', flushWhenHidden)
  document.addEventListener('gesturestart', preventNativePinchZoom, { passive: false })
  document.addEventListener('wheel', preventPageTrackpadPinchZoom, { capture: true, passive: false })
  try {
    await Promise.all([loadCanvass(), loadAccount()])
  } catch (caught) {
    error.value = caught.message
  }
})
onUnmounted(() => {
  stopPendingSave()
  clearTimeout(editLockedNoticeTimer)
  window.removeEventListener('pointerdown', closeCanvasMenu)
  window.removeEventListener('popstate', handleProjectNavigation)
  window.removeEventListener('blur', releaseOnBlur)
  window.removeEventListener('focus', refreshOnFocus)
  window.removeEventListener('pagehide', releaseOnBlur)
  document.removeEventListener('visibilitychange', flushWhenHidden)
  document.removeEventListener('gesturestart', preventNativePinchZoom)
  document.removeEventListener('wheel', preventPageTrackpadPinchZoom, true)
})
</script>



<template>
  <main class="forge:grid forge:h-full forge:w-full forge:grid-rows-[68px_minmax(0,1fr)] forge:bg-bg-primary forge:transition-colors forge:duration-200 forge:max-[760px]:h-auto forge:max-[760px]:min-h-full forge:max-[760px]:grid-rows-[58px_auto]">
    <div v-if="editLockedNoticeOpen" class="forge:fixed forge:left-1/2 forge:top-4 forge:z-[1000] forge:flex forge:min-w-[300px] forge:-translate-x-1/2 forge:items-center forge:gap-[18px] forge:rounded-[10px] forge:border forge:border-line-strong forge:bg-bg-panel forge:py-3 forge:pl-4 forge:pr-3 forge:text-[13px] forge:text-text-primary forge:shadow-popover" role="alert">
      <span><strong>{{ editLockedNoticeName }}</strong> 正在编辑此画布</span>
    </div>
    <TopBar
      v-model:switcher-open="canvasSwitcherOpen"
      :active-canvas="activeCanvas"
      :canvases="canvases"
      :workspace-mode="workspaceMode"
      :canvas-view="canvasView"
      :saved-state="savedState"
      :theme="theme"
      :account="account"
      :busy="agentBusy"
      @rename="renameCanvas"
      @open-canvas="openCanvas"
      @create-canvas="createCanvas"
      @canvas-context-menu="openCanvasMenu($event.event, $event.canvas)"
      @import-file="importCanvasFile"
      @set-theme="setTheme"
      @update:canvas-view="canvasView = $event"
    />

    <div v-if="canvasMenu" class="forge:fixed forge:z-40 forge:grid forge:w-[164px] forge:gap-[3px] forge:rounded-lg forge:border forge:border-line-strong forge:bg-bg-input forge:p-[5px] forge:shadow-popover" :style="{ left: `${canvasMenu.left}px`, top: `${canvasMenu.top}px` }" @pointerdown.stop>
      <button class="forge:min-h-[34px] forge:rounded-md forge:border forge:border-transparent forge:bg-transparent forge:px-[9px] forge:py-[7px] forge:text-left forge:text-[10px] forge:font-medium forge:transition-colors forge:hover:border-line-strong forge:hover:bg-bg-input-hover" type="button" @click="runCanvasMenuAction(exportCanvas)">Export JSON</button>
      <button class="forge:min-h-[34px] forge:rounded-md forge:border forge:border-transparent forge:bg-transparent forge:px-[9px] forge:py-[7px] forge:text-left forge:text-[10px] forge:font-medium forge:transition-colors forge:hover:border-line-strong forge:hover:bg-bg-input-hover" type="button" @click="runCanvasMenuAction(duplicateCanvas)">Duplicate</button>
      <button class="forge:min-h-[34px] forge:rounded-md forge:border forge:border-transparent forge:bg-transparent forge:px-[9px] forge:py-[7px] forge:text-left forge:text-[10px] forge:font-medium forge:text-status-failed forge:transition-colors forge:hover:border-line-strong forge:hover:bg-[color-mix(in_srgb,var(--status-failed)_10%,transparent)]" type="button" @click="runCanvasMenuAction(deleteCanvas)">Delete</button>
    </div>

    <section v-if="workspaceMode === 'canvas'" class="forge:relative forge:grid forge:min-h-0 forge:grid-cols-[350px_minmax(0,1fr)] forge:grid-rows-[minmax(0,1fr)] forge:overflow-hidden forge:max-[1200px]:grid-cols-[310px_minmax(0,1fr)] forge:max-[760px]:grid-cols-1 forge:max-[760px]:grid-rows-[480px_620px]">
      <ChatPanel
        :messages="messages"
        :editor="composer"
        :busy="agentBusy"
        :error="error"
        :composer-has-content="composerHasContent"
        :continuing-turn-id="continuingTurnId"
        :selected-options="selectedOptions"
        @send="sendMessage"
        @attach-files="addComposerFiles"
        @toggle-option="toggleSelectedOption($event.message, $event.optionId)"
        @continue-turn="continueTurn"
        @retry="retryMessage"
      />

      <section class="forge3d-canvas-panel forge:relative forge:grid forge:min-h-0 forge:min-w-0 forge:grid-rows-[62px_minmax(0,1fr)_auto_27px] forge:overflow-hidden forge:bg-bg-secondary forge:transition-colors forge:duration-200" @pointerdown.capture="selectCanvasEdge" @pointerdown="closeContextMenu">
        <CanvasToolbar
          :canvas-view="canvasView"
          :canvas-mode="canvasMode"
          :node-count="nodes.length"
          :edge-count="edges.length"
          :selected-count="selectedCount"
          :asset-library="assetLibrary"
          :has-canvas="Boolean(activeCanvas)"
          :is-running="isRunning"
          :menu-open="toolbarMenuOpen"
          :catalog="catalogForMenu()"
          :categories="nodeCategories"
          @update:canvas-view="canvasView = $event"
          @update:canvas-mode="canvasMode = $event"
          @toggle-menu="nodeMenuContext = null; nodeMenuOpen = !nodeMenuOpen"
          @select-node-type="selectNodeType"
          @drag-node-type="startNodeDrag($event.event, $event.type)"
          @toggle-frame-mode="toggleFrameMode"
          @fit-view="fitCanvasView"
          @auto-layout="autoLayout().then(fitCanvasView)"
        />
        <CanvasContextMenu
          v-if="nodeMenuOpen && nodeMenuContext"
          ref="contextMenu"
          :context="nodeMenuContext"
          :catalog="catalogForMenu()"
          :categories="nodeCategories"
          :can-frame-selection="canFrameSelection"
          :can-dissolve-selection="canDissolveSelection"
          :has-clipboard="Boolean(clipboardFragment)"
          @frame-selection="runContextMenuAction(makeSelectionFrame)"
          @dissolve-selection="runContextMenuAction(dissolveSelectedFrames)"
          @create-canvas="runContextMenuAction(createCanvasFromSelection)"
          @copy="runContextMenuAction(copySelected)"
          @paste="runContextMenuAction(pasteFragment)"
          @duplicate="runContextMenuAction(duplicateSelected)"
          @delete="runContextMenuAction(deleteSelected)"
          @select-node-type="selectNodeType"
          @drag-node-type="startNodeDrag($event.event, $event.type)"
        />
        <VueFlow v-show="canvasView === 'canvas'" v-model:nodes="nodes" :edges="executionEdges" @update:edges="edges = $event" :class="['forge3d-flow-canvas forge:bg-bg-primary forge:touch-none forge:transition-colors forge:duration-200', `forge3d-canvas-mode-${canvasMode}`]" :default-edge-options="edgeDefaults" :delete-key-code="null" :is-valid-connection="isValidConnection" :min-zoom=".08" :max-zoom="3.5" :snap-to-grid="false" :pan-on-scroll="true" :zoom-on-scroll="false" :zoom-activation-key-code="null" :pan-on-drag="panOnDrag" :selection-key-code="canvasMode === 'select' ? true : null" :selection-mode="SelectionMode.Partial" :multi-selection-key-code="'Shift'" fit-view-on-init @viewport-change-start="dismissCanvasPopups" :nodes-draggable="canvasInteractive" :elements-selectable="canvasInteractive" @pointerdown.capture="onCanvasPointerDown($event); onFrameDrawPointerDown($event)" @dragover="onCanvasDragOver" @drop="onCanvasDrop" @pane-context-menu="onPaneContextMenu" @node-context-menu="onNodeContextMenu" @selection-context-menu="onSelectionContextMenu" @connect="onConnect" @connect-start="onConnectStart" @connect-end="onConnectEnd" @connect-cancel="onConnectCancel" @node-drag-start="onNodeDragStart" @node-drag-stop="onNodeDragStop" @selection-start="onSelectionStart" @selection-end="onSelectionEnd" @nodes-change="onElementsChange" @edges-change="onElementsChange">
          <template #node-frame="props"><FrameNode v-bind="props" :zoom="viewport.zoom" :running="sectionIsRunning(props.id)" @update-name="updateNodeName(props.id, $event)" @resize-end="onFrameResizeEnd" @run="runSection(props.id)" @stop-run="cancelRun" /></template>
          <template #node-canvas="props"><CanvasNode v-bind="props" :node-run="nodeRuns[props.id] || null" :run-id="run?.id || null" :run-entry-node-id="run?.entryNodeId || null" :run-mode="run?.mode || null" :run-status="run?.status || null" :inbound-type="inboundExportTarget(props.id)" :inbound-image="inboundImage(props.id)" :missing-inputs="missingInputs[props.id] || []" :node-catalog="compatibleNodeTypes(props.data.canvasType)" :viewport-dismiss-version="viewportDismissVersion" :connection-invalid="Boolean(connectionSourceId && connectionSourceId !== props.id && !canConnectNodeTypes(nodes.find((node) => node.id === connectionSourceId)?.data.canvasType, props.data.canvasType))" @update-config="updateNodeConfig(props.id, $event)" @update-name="updateNodeName(props.id, $event)" @open-model-editor="openModelEditor(props.id)" @preview-image="openImagePreview" @add-next="addNode($event, props.id)" @run-canvas="runCanvas($event, 'node')" @run-downstream="runCanvas($event, 'downstream')" @stop-run="cancelRun" /></template>
          <template #edge-execution="props"><ExecutionEdge v-bind="props" /></template>
          <div v-if="frameDrawRect" class="forge3d-frame-draw-layer" :style="frameDrawLayerStyle"><div class="forge3d-frame-draw-rect" :style="frameDrawRectStyle"><span class="forge3d-frame-draw-size" :style="frameDrawLabelStyle">{{ frameDrawSize }}</span></div></div>
          <Background :gap="24" :size="1.2" :pattern-color="resolvedTheme === 'dark' ? '#252b2c' : '#cdd2cf'" />
          <MiniMap position="bottom-right" :width="160" :height="100" :pannable="true" :zoomable="true" :mask-color="resolvedTheme === 'dark' ? 'rgba(10, 12, 12, .7)' : 'rgba(238, 241, 238, .72)'" :node-color="resolvedTheme === 'dark' ? '#606a63' : '#a6afa9'" :node-stroke-color="resolvedTheme === 'dark' ? '#929a94' : '#737d76'" :node-stroke-width="1" :node-border-radius="4" />
          <Controls position="bottom-right" />
        </VueFlow>
        <AssetLibraryView v-if="canvasView === 'assets'" :rails="assetRails" :total="assetLibrary.total" :loading="assetsLoading" :canvas-node-ids="canvasNodeIds" @preview="openImagePreview" @open-model-editor="openModelEditor" />
        <RunLogPanel v-if="runDetails && runSummaryOpen" :details="runDetails" @close="runSummaryOpen = false" />
        <footer class="forge:row-start-4 forge:flex forge:min-h-0 forge:items-center forge:justify-between forge:border-t forge:border-line forge:px-[13px] forge:font-mono forge:text-[8px] forge:font-medium forge:leading-none forge:text-text-muted"><div class="forge:flex forge:h-full forge:items-center forge:gap-[9px] forge:whitespace-nowrap"><span class="forge:flex forge:h-full forge:items-center forge:gap-[7px] forge:uppercase"><i class="forge:size-[7px] forge:rounded-full forge:bg-acid forge:shadow-[0_0_9px_color-mix(in_srgb,var(--acid)_60%,transparent)]" />{{ runSummary }}</span><button v-if="runDetails" class="forge:flex forge:h-[19px] forge:items-center forge:gap-[5px] forge:rounded forge:border forge:border-line-strong forge:bg-bg-input forge:px-[7px] forge:font-mono forge:text-[7px] forge:font-semibold forge:uppercase forge:tracking-[.06em] forge:text-acid forge:transition-colors forge:hover:bg-bg-input-hover" type="button" :aria-expanded="runSummaryOpen" @click="runSummaryOpen = !runSummaryOpen">{{ runSummaryOpen ? 'Hide logs' : 'Logs' }} <b class="forge:text-[9px] forge:font-medium">{{ runSummaryOpen ? '↓' : '↑' }}</b></button></div><span class="forge:overflow-hidden forge:text-ellipsis forge:whitespace-nowrap forge:max-[760px]:hidden">Click or drag a node from Add node · Drop a connection on empty canvas to create a compatible node · Press / to add</span></footer>
      </section>
      <button class="forge:absolute forge:right-0 forge:top-[76px] forge:z-[21] forge:flex forge:h-[42px] forge:w-9 forge:items-center forge:justify-center forge:gap-[3px] forge:rounded-l-lg forge:border forge:border-r-0 forge:border-line forge:bg-bg-card forge:font-mono forge:text-[11px] forge:font-semibold forge:text-acid forge:shadow-[-5px_4px_14px_rgba(20,26,22,.1)] forge:transition-[right] forge:duration-200 forge:has-[+_.is-open]:right-[300px] forge:max-[1200px]:has-[+_.is-open]:right-[270px] forge:max-[760px]:has-[+_.is-open]:right-[min(300px,90vw)]" type="button" :aria-expanded="taskQueueOpen" aria-controls="task-queue-panel" @click="taskQueueOpen = !taskQueueOpen">
        <span aria-hidden="true">{{ taskQueueOpen ? '→' : '←' }}</span>
        <b class="forge:text-[9px] forge:text-text-secondary">{{ executions.length + (run?.id && !executions.some((execution) => execution.id === run.id) ? 1 : 0) }}</b>
      </button>
      <ExecutionOutputPanel id="task-queue-panel" :class="{ 'forge3d-is-open': taskQueueOpen }" :executions="executions" :active-execution="run" :active-executions="activeExecutions" :loading="executionsLoading" />
    </section>
    <ModelEditor v-else-if="modelEditorNode" :node="modelEditorNode" @back="closeModelEditor" @update-config="updateNodeConfig(modelEditorNode.id, $event)" />
    <ImagePreviewOverlay :preview="imagePreview" @close="closeImagePreview" />
    <DebugPanel
      v-model:open="debugPanelOpen"
      :selected-provider="selectedProvider"
      :active-provider="activeProvider"
      :tripo-available="tripoAvailable"
      :tripo-node-types="tripoNodeTypes"
      :error="capabilitiesError"
      @set-provider="setProvider"
    />
  </main>
</template>

<style scoped>
:deep(.forge3d-flow-canvas .vue-flow__pane), :deep(.forge3d-flow-canvas .vue-flow__node.draggable), :deep(.forge3d-flow-canvas .vue-flow__nodesselection-rect) { cursor: default; }
:deep(.forge3d-flow-canvas.forge3d-canvas-mode-select .vue-flow__pane.selection) { cursor: default; }
:deep(.forge3d-flow-canvas.forge3d-canvas-mode-move .vue-flow__pane) { cursor: default; }
:deep(.forge3d-flow-canvas.forge3d-canvas-mode-frame .vue-flow__pane) { cursor: crosshair; }
.forge3d-frame-draw-layer { position: absolute; inset: 0; z-index: 5; pointer-events: none; transform-origin: 0 0; }
.forge3d-frame-draw-rect { position: absolute; border-style: dashed; border-color: var(--acid); background: color-mix(in srgb, var(--acid) 5%, transparent); }
.forge3d-frame-draw-size { position: absolute; bottom: 100%; left: 0; transform-origin: bottom left; border-radius: 5px; background: color-mix(in srgb, var(--acid) 16%, var(--bg-input)); padding: 3px 6px; font-family: var(--font-mono, monospace); font-size: 10px; font-weight: 600; line-height: 1; color: var(--text-primary); white-space: nowrap; }
:deep(.forge3d-flow-canvas.forge3d-canvas-mode-move .vue-flow__pane.dragging) { cursor: grabbing; }
:deep(.forge3d-flow-canvas .vue-flow__node.draggable.dragging), :deep(.forge3d-flow-canvas .vue-flow__nodesselection-rect.dragging) { cursor: grabbing; }
:deep(.vue-flow__node-frame) { z-index: 2 !important; }
:deep(.vue-flow__node-canvas) { z-index: 1 !important; }
:deep(.vue-flow__node-canvas:focus), :deep(.vue-flow__node-canvas:focus-visible) { outline: none; }
:deep(.vue-flow__background > rect) { stroke: none; }
:deep(.vue-flow__edge-path) { stroke: #535a56; stroke-width: 1.6; transition: stroke .15s ease, stroke-width .15s ease; }
:deep(.vue-flow__edge) { cursor: pointer; }
:deep(.vue-flow__edge:hover .vue-flow__edge-path) { stroke: color-mix(in srgb, var(--acid) 70%, #535a56); stroke-width: 2.6; }
:deep(.vue-flow__edge.selected .vue-flow__edge-path) { stroke: var(--acid); stroke-width: 3; }
:deep(.vue-flow__edge-interaction) { stroke: transparent; stroke-width: 36; pointer-events: stroke; cursor: pointer; }
:deep(.vue-flow__connection) { z-index: 1000; pointer-events: none; overflow: visible; }
:deep(.vue-flow__connection path), :deep(.vue-flow__connection-path) { stroke: var(--acid) !important; stroke-width: 5 !important; stroke-linecap: round; fill: none; filter: drop-shadow(0 0 4px color-mix(in srgb, var(--acid) 65%, transparent)); }
:deep(.vue-flow__minimap) { right: 16px; bottom: 16px; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--bg-card); overflow: hidden; }
:deep(.vue-flow__controls) { right: 186px; bottom: 16px; border: 1px solid var(--line-strong); border-radius: 7px; box-shadow: none; overflow: hidden; }
:deep(.vue-flow__controls-button) { width: 28px; height: 28px; border-bottom-color: var(--line-strong); background: var(--bg-card); fill: #929994; transition: background .15s ease, fill .15s ease; }
:deep(.vue-flow__controls-button:hover) { background: var(--bg-input-hover); fill: var(--acid); }
:global(:root[data-theme='light']) :deep(.vue-flow__edge-path) { stroke: #909993; }
:global(:root[data-theme='light']) :deep(.vue-flow__edge:hover .vue-flow__edge-path) { stroke: color-mix(in srgb, var(--acid) 75%, #6c756f); }
:global(:root[data-theme='light']) :deep(.vue-flow__edge.selected .vue-flow__edge-path) { stroke: var(--acid); }
:global(:root[data-theme='light']) :deep(.vue-flow__controls-button) { fill: #616a64; }
</style>
