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
import { useCanvasHistory } from './composables/useCanvasHistory'
import { useCanvasPresence } from './composables/useCanvasPresence'
import { useCanvasSelection } from './composables/useCanvasSelection'
import { useKeyboardShortcuts } from './composables/useKeyboardShortcuts'
import { useTheme } from './composables/useTheme'
import { useCanvasDocument } from './composables/useCanvasDocument'
import { useCanvasRun } from './composables/useCanvasRun'
import { useDebugSettings } from './composables/useDebugSettings'
import { edgeDefaults, nodePresentation } from './canvas-graph'
import { canConnectNodeTypes, compatibleNodeTypes, hasModelEditor, isExecutableNodeType, nodeCatalog, nodeCategories, nodeDefaults, nodeDefinition, nodeInputPorts, nodeOutputPorts } from './canvas-nodes'

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
const saving = ref(false)
const savedState = ref('Saved')
// Bumped whenever the active canvas changes or a run starts, so in-flight agent
// streams and run polls belonging to the previous context abandon themselves.
const runToken = ref(0)

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
const editLockedNoticeOpen = ref(false)
const editLockedNoticeName = ref('')
let pendingConnection = null
let editLockedNoticeTimer

const executionEdges = computed(() => edges.value.map((edge) => ({
  ...edge,
  type: 'execution',
  data: { ...edge.data, running: nodeRuns.value[edge.target]?.status === 'running' },
})))

const { fitView, screenToFlowCoordinate, updateNodeInternals, viewport } = useVueFlow()
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
  scheduleSave: () => scheduleSave(),
  fromCanvas: () => fromCanvas(),
  toCanvas: (canvas) => toCanvas(canvas),
  loadCanvass: (preferredId) => loadCanvass(preferredId),
  focusNodes,
})

const {
  fitFramesAfterRender, suppressFrameFit, makeSelectionFrame, onCanvasPointerDown, onSelectionStart, onSelectionEnd,
  onElementsChange, onFrameResizeStart, onFrameResizeEnd, onNodeDragStart, onNodeDragStop, autoLayout,
} = useCanvasFrames({
  nodes,
  edges,
  fitView,
  screenToFlowCoordinate,
  updateNodeInternals,
  scheduleSave: () => scheduleSave(),
  scheduleLayoutSave: () => scheduleLayoutSave(),
  frameableSelectedNodes,
  nextNodeId,
  focusNode,
})

const { syncHistoryCanvas, recordHistory, undo, redo } = useCanvasHistory({
  nodes,
  edges,
  activeCanvas,
  hydrating: computed(() => hydrating.value),
  updateNodeInternals,
  scheduleSave: () => scheduleSave(),
})

const {
  hydrating, toCanvas, fromCanvas, syncCanvasSummary, loadCanvass, openCanvas, scheduleSave, scheduleLayoutSave,
  flushPendingSave, saveCanvas, stopPendingSave, duplicateCanvas, deleteCanvas, createCanvas,
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
  composer, composerHasContent, messages, selectedOptions, continuingTurnId, runningTurnId, stoppingTurnId, addComposerFiles,
  loadSessions, restoreTurns, subscribeCanvasEvents, closeCanvasEvents, toggleSelectedOption,
  continueTurn, stopTurn, sendMessage,
} = useAgentChat({
  activeCanvas,
  activeSession,
  busy: agentBusy,
  error,
  runToken: agentToken,
  toCanvas: (canvas) => toCanvas(canvas),
  syncCanvasSummary: (canvas) => syncCanvasSummary(canvas),
  flushPendingSave: () => flushPendingSave(),
  onCanvasEvent: applyPresenceEvent,
  onCanvasDocumentEvent: () => refreshCanvasFromServer(),
  clientId,
  acquireEditLease,
  markEditActivity,
})

configureIdleRelease({
  flush: () => flushPendingSave({ detectChanges: true }),
  isBusy: () => saving.value || busy.value || isRunning.value || Boolean(runningTurnId.value),
})

const { capabilitiesError, debugPanelOpen, selectedProvider, activeProvider, tripoAvailable, tripoNodeTypes, setProvider } = useDebugSettings()

const { isRunning, runDetails, runSummary, runCanvas, cancelRun } = useCanvasRun({
  activeCanvas,
  nodes,
  edges,
  run,
  nodeRuns,
  canvasBusy,
  error: canvasError,
  runToken: canvasRunToken,
  saveCanvas: () => saveCanvas(),
  materializeRunBatch: (sourceId, runId, previews) => materializeRunBatch(sourceId, runId, previews),
  // Null lets the server pick; the debug panel forces one backend.
  provider: selectedProvider,
})

watch([() => run.value?.id, () => run.value?.status], ([runId]) => {
  if (runId) taskQueueOpen.value = true
})

watch(() => activeCanvas.value?.id, (canvasId) => { loadExecutions(canvasId) }, { immediate: true })

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

function onConnect(connection) {
  addConnection(connection)
  pendingConnection = null
}

function onConnectStart(connection) {
  pendingConnection = connection.handleType === 'source' ? { nodeId: connection.nodeId, sourceHandle: connection.handleId } : null
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
  scheduleSave()
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
}

function onConnectCancel() {
  pendingConnection = null
}

function updateNodeConfig(id, config) {
  const node = nodes.value.find((candidate) => candidate.id === id)
  if (!node) return
  node.data = { ...node.data, config }
  scheduleSave()
}

function updateNodeName(id, name) {
  const node = nodes.value.find((candidate) => candidate.id === id)
  const normalized = name.trim()
  if (!node || !normalized || normalized === node.data.label) return
  node.data = { ...node.data, label: normalized }
  scheduleSave()
}

function openModelEditor(id) {
  if (!id) return
  const node = nodes.value.find((candidate) => candidate.id === id)
  if (!node || !hasModelEditor(node.data.canvasType) || nodeRuns.value[id]?.status !== 'succeeded') return
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
  const bounds = document.querySelector('.flow-canvas')?.getBoundingClientRect()
  if (!bounds) return { x: 120, y: 120 }
  return screenToFlowCoordinate({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 })
}

async function focusNodes(ids, padding = 0.25) {
  if (!ids.length) return
  await nextTick()
  await new Promise((resolve) => requestAnimationFrame(resolve))
  await nextTick()
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
      inputTypes: nodeDefinition(type)?.inputTypes || [],
      outputType: nodeDefinition(type)?.outputType || null,
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
    scheduleSave()
    focusNode(frame.id)
    return
  }
  const node = buildCanvasNode(type, { position: position || nodePosition(sourceId), selected: true })
  nodes.value = [...nodes.value.map((item) => ({ ...item, selected: false })), node]
  closeContextMenu()
  scheduleSave()
  nextTick(() => {
    if (sourceId) {
      addConnection({ source: sourceId, sourceHandle: 'output', target: node.id, targetHandle: 'input' })
    }
    fitView({ nodes: [node.id], padding: 1.5, maxZoom: 1, duration: 350 })
  })
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
    scheduleSave()
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
  const panel = document.querySelector('.flow-canvas')?.getBoundingClientRect()
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
  addNode(type, context?.sourceId, context?.position)
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
  if (event.ctrlKey && !(event.target instanceof Element && event.target.closest('.flow-canvas'))) event.preventDefault()
}

async function releaseOnBlur() {
  try {
    await flushPendingSave({ detectChanges: true, keepalive: true })
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
    await loadCanvass()
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
  <main class="app-shell">
    <div v-if="editLockedNoticeOpen" class="edit-lock-notice" role="alert">
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
      :busy="agentBusy"
      @rename="renameCanvas"
      @open-canvas="openCanvas"
      @create-canvas="createCanvas"
      @canvas-context-menu="openCanvasMenu($event.event, $event.canvas)"
      @import-file="importCanvasFile"
      @set-theme="setTheme"
      @update:canvas-view="canvasView = $event"
    />

    <div v-if="canvasMenu" class="canvas-menu" :style="{ left: `${canvasMenu.left}px`, top: `${canvasMenu.top}px` }" @pointerdown.stop>
      <button type="button" @click="runCanvasMenuAction(exportCanvas)">Export JSON</button>
      <button type="button" @click="runCanvasMenuAction(duplicateCanvas)">Duplicate</button>
      <button class="danger" type="button" @click="runCanvasMenuAction(deleteCanvas)">Delete</button>
    </div>

    <section v-if="workspaceMode === 'canvas'" class="workspace">
      <ChatPanel
        :messages="messages"
        :editor="composer"
        :busy="agentBusy"
        :error="error"
        :composer-has-content="composerHasContent"
        :continuing-turn-id="continuingTurnId"
        :running-turn-id="runningTurnId"
        :stopping-turn-id="stoppingTurnId"
        :selected-options="selectedOptions"
        @send="sendMessage"
        @attach-files="addComposerFiles"
        @toggle-option="toggleSelectedOption($event.message, $event.optionId)"
        @continue-turn="continueTurn"
        @stop-turn="stopTurn"
      />

      <section class="canvas-panel bg-bg-secondary" @pointerdown.capture="selectCanvasEdge" @pointerdown="closeContextMenu">
        <CanvasToolbar
          :canvas-view="canvasView"
          :canvas-mode="canvasMode"
          :node-count="nodes.length"
          :edge-count="edges.length"
          :selected-count="selectedCount"
          :asset-library="assetLibrary"
          :has-canvas="Boolean(activeCanvas)"
          :busy="canvasBusy"
          :saving="saving"
          :is-running="isRunning"
          :menu-open="toolbarMenuOpen"
          :catalog="catalogForMenu()"
          :categories="nodeCategories"
          @update:canvas-view="canvasView = $event"
          @update:canvas-mode="canvasMode = $event"
          @toggle-menu="nodeMenuContext = null; nodeMenuOpen = !nodeMenuOpen"
          @select-node-type="selectNodeType"
          @drag-node-type="startNodeDrag($event.event, $event.type)"
          @add-frame="addNode('frame')"
          @fit-view="fitCanvasView"
          @auto-layout="autoLayout"
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
        <VueFlow v-show="canvasView === 'canvas'" v-model:nodes="nodes" :edges="executionEdges" @update:edges="edges = $event" :class="['flow-canvas', `canvas-mode-${canvasMode}`]" :default-edge-options="edgeDefaults" :delete-key-code="null" :is-valid-connection="isValidConnection" :min-zoom=".08" :max-zoom="3.5" :snap-to-grid="false" :pan-on-scroll="true" :zoom-on-scroll="false" :zoom-activation-key-code="null" :pan-on-drag="panOnDrag" :selection-key-code="canvasMode === 'select' ? true : null" :selection-mode="SelectionMode.Partial" :multi-selection-key-code="'Shift'" fit-view-on-init @viewport-change-start="dismissCanvasPopups" @pointerdown.capture="onCanvasPointerDown" @dragover="onCanvasDragOver" @drop="onCanvasDrop" @pane-context-menu="onPaneContextMenu" @node-context-menu="onNodeContextMenu" @selection-context-menu="onSelectionContextMenu" @connect="onConnect" @connect-start="onConnectStart" @connect-end="onConnectEnd" @connect-cancel="onConnectCancel" @node-drag-start="onNodeDragStart" @node-drag-stop="onNodeDragStop" @selection-start="onSelectionStart" @selection-end="onSelectionEnd" @nodes-change="onElementsChange" @edges-change="onElementsChange">
          <template #node-frame="props"><FrameNode v-bind="props" :zoom="viewport.zoom" :running="sectionIsRunning(props.id)" @update-name="updateNodeName(props.id, $event)" @resize-start="onFrameResizeStart(props.id)" @resize-end="onFrameResizeEnd" @run="runSection(props.id)" @stop-run="cancelRun" /></template>
          <template #node-canvas="props"><CanvasNode v-bind="props" :node-run="nodeRuns[props.id] || null" :run-id="run?.id || null" :run-entry-node-id="run?.entryNodeId || null" :run-mode="run?.mode || null" :run-status="run?.status || null" :inbound-type="inboundExportTarget(props.id)" :inbound-image="inboundImage(props.id)" :node-catalog="compatibleNodeTypes(props.data.canvasType)" :viewport-dismiss-version="viewportDismissVersion" @update-config="updateNodeConfig(props.id, $event)" @update-name="updateNodeName(props.id, $event)" @open-model-editor="openModelEditor(props.id)" @preview-image="openImagePreview" @add-next="addNode($event, props.id)" @run-canvas="runCanvas($event, 'node')" @run-downstream="runCanvas($event, 'downstream')" @stop-run="cancelRun" /></template>
          <template #edge-execution="props"><ExecutionEdge v-bind="props" /></template>
          <Background :gap="24" :size="1.2" :pattern-color="resolvedTheme === 'dark' ? '#252b2c' : '#cdd2cf'" />
          <MiniMap position="bottom-right" :width="160" :height="100" :pannable="true" :zoomable="true" :mask-color="resolvedTheme === 'dark' ? 'rgba(10, 12, 12, .7)' : 'rgba(238, 241, 238, .72)'" :node-color="resolvedTheme === 'dark' ? '#606a63' : '#a6afa9'" :node-stroke-color="resolvedTheme === 'dark' ? '#929a94' : '#737d76'" :node-stroke-width="1" :node-border-radius="4" />
          <Controls position="bottom-right" />
        </VueFlow>
        <AssetLibraryView v-if="canvasView === 'assets'" :rails="assetRails" :total="assetLibrary.total" :loading="assetsLoading" :canvas-node-ids="canvasNodeIds" @preview="openImagePreview" @open-model-editor="openModelEditor" />
        <RunLogPanel v-if="runDetails && runSummaryOpen" :details="runDetails" @close="runSummaryOpen = false" />
        <footer><div class="run-status"><span><i />{{ runSummary }}</span><button v-if="runDetails" type="button" :aria-expanded="runSummaryOpen" @click="runSummaryOpen = !runSummaryOpen">{{ runSummaryOpen ? 'Hide logs' : 'Logs' }} <b>{{ runSummaryOpen ? '↓' : '↑' }}</b></button></div><span>Click or drag a node from Add node · Drop a connection on empty canvas to create a compatible node · Press / to add</span></footer>
      </section>
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
