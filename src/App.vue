<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref } from 'vue'
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
import RunLogPanel from './components/RunLogPanel.vue'
import TopBar from './components/TopBar.vue'
import WorkflowNode from './components/WorkflowNode.vue'
import { useAgentChat } from './composables/useAgentChat'
import { useCanvasFrames } from './composables/useCanvasFrames'
import { useCanvasHistory } from './composables/useCanvasHistory'
import { useCanvasSelection } from './composables/useCanvasSelection'
import { useKeyboardShortcuts } from './composables/useKeyboardShortcuts'
import { useTheme } from './composables/useTheme'
import { useWorkflowDocument } from './composables/useWorkflowDocument'
import { useWorkflowRun } from './composables/useWorkflowRun'
import { buildAssetLibrary, buildAssetRails } from './asset-library'
import { edgeDefaults, nodePresentation } from './workflow-canvas'
import { canConnectPorts, compatibleNodeTypes, nodeCatalog, nodeCategories, nodeDefaults, nodeDefinition, nodeInputPorts, nodeOutputPorts } from './workflow-nodes'

const ModelEditor = defineAsyncComponent(() => import('./components/ModelEditor.vue'))

// The document and canvas state every composable below works on.
const workflows = ref([])
const activeWorkflow = ref(null)
const conversation = ref(null)
const nodes = ref([])
const edges = ref([])
const run = ref(null)
const nodeRuns = ref({})
const busy = ref(false)
const error = ref('')
const saving = ref(false)
const savedState = ref('Saved')
// Bumped whenever the active workflow changes or a run starts, so in-flight agent
// streams and run polls belonging to the previous context abandon themselves.
const runToken = ref(0)

// Canvas chrome: menus, overlays and the two view/mode switches.
const contextMenu = ref(null)
const nodeMenuOpen = ref(false)
const nodeMenuContext = ref(null)
const viewportDismissVersion = ref(0)
const workflowMenu = ref(null)
const workflowSwitcherOpen = ref(false)
const workspaceMode = ref('workflow')
const canvasMode = ref('select')
const canvasView = ref('canvas')
const modelEditorNodeId = ref(null)
const imagePreview = ref(null)
const runSummaryOpen = ref(false)
let pendingConnection = null

const { fitView, screenToFlowCoordinate, updateNodeInternals, viewport } = useVueFlow()
const { theme, resolvedTheme, setTheme } = useTheme()

const {
  clipboardFragment, selectedNodes, frameableSelectedNodes, canFrameSelection, canDissolveSelection,
  selectedCount, hasSelectedNode, hasSelection, deleteSelected, dissolveSelectedFrames, selectAll,
  selectCanvasEdge, copySelected, pasteFragment, duplicateSelected, createWorkflowFromSelection,
} = useCanvasSelection({
  nodes,
  edges,
  activeWorkflow,
  error,
  scheduleSave: () => scheduleSave(),
  fromCanvas: () => fromCanvas(),
  toCanvas: (workflow) => toCanvas(workflow),
  loadWorkflows: (preferredId) => loadWorkflows(preferredId),
})

const {
  fitFramesAfterRender, makeSelectionFrame, onCanvasPointerDown, onSelectionStart, onSelectionEnd,
  onElementsChange, onFrameResizeStart, onFrameResizeEnd, onNodeDragStart, onNodeDragStop, autoLayout,
} = useCanvasFrames({
  nodes,
  edges,
  viewport,
  fitView,
  screenToFlowCoordinate,
  updateNodeInternals,
  scheduleSave: () => scheduleSave(),
  frameableSelectedNodes,
  nextNodeId,
  focusNode,
})

const { syncHistoryWorkflow, recordHistory, undo, redo } = useCanvasHistory({
  nodes,
  edges,
  activeWorkflow,
  hydrating: computed(() => hydrating.value),
  updateNodeInternals,
  scheduleSave: () => scheduleSave(),
})

const {
  hydrating, toCanvas, fromCanvas, loadWorkflowList, loadWorkflows, openWorkflow, scheduleSave,
  flushPendingSave, saveWorkflow, stopPendingSave, duplicateWorkflow, deleteWorkflow, createWorkflow,
  renameWorkflow, exportWorkflow, importWorkflowFile,
} = useWorkflowDocument({
  workflows,
  activeWorkflow,
  conversation,
  nodes,
  edges,
  run,
  nodeRuns,
  busy,
  error,
  saving,
  savedState,
  runToken,
  fitView,
  recordHistory,
  syncHistoryWorkflow,
  fitFramesAfterRender,
  restoreAgentTasks: (id) => restoreAgentTasks(id),
  pasteFragment,
  resetWorkspace,
  closeWorkflowSwitcher,
})

const {
  composer, composerHasContent, messages, selectedOptions, continuingTaskId, addComposerFiles,
  restoreAgentTasks, toggleSelectedOption, continueTask, sendMessage,
} = useAgentChat({
  activeWorkflow,
  conversation,
  busy,
  error,
  runToken,
  toCanvas: (workflow) => toCanvas(workflow),
  loadWorkflowList: () => loadWorkflowList(),
  flushPendingSave: () => flushPendingSave(),
})

const { isRunning, runDetails, runSummary, runWorkflow } = useWorkflowRun({
  activeWorkflow,
  nodes,
  run,
  nodeRuns,
  busy,
  error,
  runToken,
  saveWorkflow: () => saveWorkflow(),
  materializeRunBatch: (sourceId, runId, previews) => materializeRunBatch(sourceId, runId, previews),
})

const panOnDrag = computed(() => canvasMode.value === 'move')
const toolbarMenuOpen = computed(() => nodeMenuOpen.value && !nodeMenuContext.value)
const assetLibrary = computed(() => buildAssetLibrary(nodes.value))
const assetRails = computed(() => buildAssetRails(assetLibrary.value))
const modelEditorNode = computed(() => nodes.value.find((node) => node.id === modelEditorNodeId.value) || null)

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
  if (sources.some((node) => nodeOutputPorts(node.data?.workflowType)[0]?.type === 'model')) return '3D Model'
  if (sources.some((node) => nodeOutputPorts(node.data?.workflowType)[0]?.type === 'image')) return 'Image'
  return null
}

function inboundImage(nodeId) {
  for (const source of inboundSourceNodes(nodeId)) {
    if (nodeOutputPorts(source.data?.workflowType)[0]?.type !== 'image') continue
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
  return Boolean(source && target && canConnectPorts(source.data.workflowType, connection.sourceHandle, target.data.workflowType, connection.targetHandle))
}

function addConnection(connection) {
  if (!isValidConnection(connection)) return false
  const source = nodes.value.find((node) => node.id === connection.source)
  const target = nodes.value.find((node) => node.id === connection.target)
  const exists = edges.value.some((edge) => edge.source === source.id && edge.sourceHandle === connection.sourceHandle && edge.target === target.id && edge.targetHandle === connection.targetHandle)
  if (exists) return false
  edges.value = addEdge({
    id: `edge-${source.id}-${connection.sourceHandle}-${target.id}-${connection.targetHandle}-${Date.now().toString(36)}`,
    source: source.id,
    target: target.id,
    sourceHandle: connection.sourceHandle,
    targetHandle: connection.targetHandle,
    sourcePort: connection.sourceHandle,
    targetPort: connection.targetHandle,
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
    const targetNode = nodes.value.find((node) => node.id === target)
    const targetHandle = nodeInputPorts(targetNode?.data.workflowType).find((port) => canConnectPorts(nodes.value.find((node) => node.id === pendingConnection.nodeId)?.data.workflowType, pendingConnection.sourceHandle, targetNode?.data.workflowType, port.id))?.id
    if (targetHandle) addConnection({ source: pendingConnection.nodeId, sourceHandle: pendingConnection.sourceHandle, target, targetHandle })
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
  const modelTypes = ['model-preview', 'texture', 'retopology', 'generate-model', 'smart-mesh', 'multiview-to-3d', 'text-to-3d', 'bake', 'rigging', 'segments', 'export-model']
  if (!node || !modelTypes.includes(node.data.workflowType) || nodeRuns.value[id]?.status !== 'succeeded') return
  modelEditorNodeId.value = node.id
  workspaceMode.value = 'model-editor'
  nextTick(() => window.scrollTo({ top: 0 }))
}

function closeModelEditor() {
  workspaceMode.value = 'workflow'
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

// Opening another workflow leaves the model editor and any open overlay behind.
function resetWorkspace() {
  closeWorkflowSwitcher()
  imagePreview.value = null
  workspaceMode.value = 'workflow'
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

function focusNode(id, padding = 0.25) {
  nextTick(() => fitView({ nodes: [id], padding, maxZoom: 1, duration: 350 }))
}

function buildWorkflowNode(type, { id, position, selected = false, config, parentNode } = {}) {
  const [kind, detail, tone] = nodePresentation[type]
  return {
    id: id || nextNodeId(type),
    type: 'workflow',
    position,
    parentNode,
    selected,
    data: {
      kind,
      label: nodeCatalog.find((item) => item.type === type)?.label || type,
      detail,
      tone,
      status: 'ready',
      workflowType: type,
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
  if (!presentation || !activeWorkflow.value) return
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
      data: { label: 'New workflow section', description: '' },
    }
    nodes.value = [frame, ...nodes.value.map((item) => ({ ...item, selected: false }))]
    closeContextMenu()
    scheduleSave()
    focusNode(frame.id)
    return
  }
  const node = buildWorkflowNode(type, { position: position || nodePosition(sourceId), selected: true })
  nodes.value = [...nodes.value.map((item) => ({ ...item, selected: false })), node]
  closeContextMenu()
  scheduleSave()
  nextTick(() => {
    if (sourceId) {
      const source = nodes.value.find((item) => item.id === sourceId)
      const sourceHandle = source?.data.outputPorts?.[0]?.id
      const targetHandle = node.data.inputPorts.find((port) => canConnectPorts(source?.data.workflowType, sourceHandle, type, port.id))?.id
      if (sourceHandle && targetHandle) addConnection({ source: sourceId, sourceHandle, target: node.id, targetHandle })
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
    return buildWorkflowNode('generated-image', {
      id,
      position: { x: origin.x + index * BATCH_COLUMN_GAP, y: origin.y },
      parentNode: source.parentNode,
      config: { preview, runBatch: { runId, sourceId, index } },
    })
  })

  nodes.value = [...nodes.value, ...created]
  nextTick(() => {
    const sourceHandle = source.data.outputPorts?.[0]?.id
    for (const node of created) {
      const targetHandle = node.data.inputPorts.find((port) => canConnectPorts(source.data.workflowType, sourceHandle, 'generated-image', port.id))?.id
      if (sourceHandle && targetHandle) addConnection({ source: sourceId, sourceHandle, target: node.id, targetHandle })
    }
    scheduleSave()
  })
}

function catalogForMenu() {
  if (!nodeMenuContext.value?.sourceId) return nodeCatalog.filter((item) => !item.hidden)
  const source = nodes.value.find((node) => node.id === nodeMenuContext.value.sourceId)
  return source ? compatibleNodeTypes(source.data.workflowType) : []
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

function openWorkflowMenu(event, workflow) {
  event.preventDefault()
  const width = 164
  const height = 84
  const gap = 8
  workflowMenu.value = {
    workflowId: workflow.id,
    left: Math.min(event.clientX, window.innerWidth - width - gap),
    top: Math.min(event.clientY, window.innerHeight - height - gap),
  }
}

function closeWorkflowMenu() {
  workflowMenu.value = null
}

function closeWorkflowSwitcher() {
  workflowSwitcherOpen.value = false
}

function runWorkflowMenuAction(action) {
  const workflowId = workflowMenu.value?.workflowId
  closeWorkflowMenu()
  action(workflowId)
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
  event.dataTransfer.setData('application/x-workflow-node', type)
  event.dataTransfer.effectAllowed = 'copy'
}

function onCanvasDragOver(event) {
  if (event.dataTransfer.types.includes('application/x-workflow-node')) event.preventDefault()
}

function onCanvasDrop(event) {
  const type = event.dataTransfer.getData('application/x-workflow-node')
  if (!type) return
  event.preventDefault()
  addNode(type, null, screenToFlowCoordinate({ x: event.clientX, y: event.clientY }))
}

useKeyboardShortcuts({
  imagePreview,
  workspaceMode,
  workflowSwitcherOpen,
  nodeMenuOpen,
  workflowMenu,
  hasSelection,
  clipboardFragment,
  closeImagePreview,
  closeModelEditor,
  closeWorkflowSwitcher,
  closeContextMenu,
  closeWorkflowMenu,
  openNodeMenuAt,
  undo,
  redo,
  selectAll,
  copySelected,
  pasteFragment,
  duplicateSelected,
  deleteSelected,
})

onMounted(async () => {
  window.addEventListener('pointerdown', closeWorkflowMenu)
  try {
    await loadWorkflows()
  } catch (caught) {
    error.value = caught.message
  }
})
onUnmounted(() => {
  stopPendingSave()
  window.removeEventListener('pointerdown', closeWorkflowMenu)
})
</script>



<template>
  <main class="app-shell">
    <TopBar
      v-model:switcher-open="workflowSwitcherOpen"
      :active-workflow="activeWorkflow"
      :workflows="workflows"
      :workspace-mode="workspaceMode"
      :canvas-view="canvasView"
      :saved-state="savedState"
      :theme="theme"
      :busy="busy"
      @rename="renameWorkflow"
      @open-workflow="openWorkflow"
      @create-workflow="createWorkflow"
      @workflow-context-menu="openWorkflowMenu($event.event, $event.workflow)"
      @import-file="importWorkflowFile"
      @set-theme="setTheme"
      @update:canvas-view="canvasView = $event"
    />

    <div v-if="workflowMenu" class="workflow-menu" :style="{ left: `${workflowMenu.left}px`, top: `${workflowMenu.top}px` }" @pointerdown.stop>
      <button type="button" @click="runWorkflowMenuAction(exportWorkflow)">Export JSON</button>
      <button type="button" @click="runWorkflowMenuAction(duplicateWorkflow)">Duplicate</button>
      <button class="danger" type="button" @click="runWorkflowMenuAction(deleteWorkflow)">Delete</button>
    </div>

    <section v-if="workspaceMode === 'workflow'" class="workspace">
      <ChatPanel
        :messages="messages"
        :editor="composer"
        :busy="busy"
        :error="error"
        :composer-has-content="composerHasContent"
        :continuing-task-id="continuingTaskId"
        :selected-options="selectedOptions"
        @send="sendMessage"
        @attach-files="addComposerFiles"
        @toggle-option="toggleSelectedOption($event.message, $event.optionId)"
        @continue-task="continueTask"
      />

      <section class="canvas-panel bg-bg-secondary" @pointerdown.capture="selectCanvasEdge" @pointerdown="closeContextMenu">
        <CanvasToolbar
          :canvas-view="canvasView"
          :canvas-mode="canvasMode"
          :node-count="nodes.length"
          :edge-count="edges.length"
          :selected-count="selectedCount"
          :asset-library="assetLibrary"
          :has-workflow="Boolean(activeWorkflow)"
          :busy="busy"
          :saving="saving"
          :is-running="isRunning"
          :has-selected-node="hasSelectedNode"
          :menu-open="toolbarMenuOpen"
          :catalog="catalogForMenu()"
          :categories="nodeCategories"
          @update:canvas-view="canvasView = $event"
          @update:canvas-mode="canvasMode = $event"
          @toggle-menu="nodeMenuContext = null; nodeMenuOpen = !nodeMenuOpen"
          @select-node-type="selectNodeType"
          @drag-node-type="startNodeDrag($event.event, $event.type)"
          @add-frame="addNode('frame')"
          @fit-view="fitView({ padding: .18, duration: 400 })"
          @auto-layout="autoLayout"
          @run="runWorkflow()"
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
          @create-workflow="runContextMenuAction(createWorkflowFromSelection)"
          @copy="runContextMenuAction(copySelected)"
          @paste="runContextMenuAction(pasteFragment)"
          @duplicate="runContextMenuAction(duplicateSelected)"
          @delete="runContextMenuAction(deleteSelected)"
          @select-node-type="selectNodeType"
          @drag-node-type="startNodeDrag($event.event, $event.type)"
        />
        <VueFlow v-show="canvasView === 'canvas'" v-model:nodes="nodes" v-model:edges="edges" :class="['flow-canvas', `canvas-mode-${canvasMode}`]" :default-edge-options="edgeDefaults" :delete-key-code="null" :is-valid-connection="isValidConnection" :min-zoom=".08" :max-zoom="3.5" :snap-to-grid="false" :pan-on-scroll="true" :zoom-on-scroll="false" :zoom-activation-key-code="null" :pan-on-drag="panOnDrag" :selection-key-code="canvasMode === 'select' ? true : null" :selection-mode="SelectionMode.Partial" :multi-selection-key-code="'Shift'" fit-view-on-init @viewport-change-start="dismissCanvasPopups" @pointerdown.capture="onCanvasPointerDown" @dragover="onCanvasDragOver" @drop="onCanvasDrop" @pane-context-menu="onPaneContextMenu" @node-context-menu="onNodeContextMenu" @selection-context-menu="onSelectionContextMenu" @connect="onConnect" @connect-start="onConnectStart" @connect-end="onConnectEnd" @connect-cancel="onConnectCancel" @node-drag-start="onNodeDragStart" @node-drag-stop="onNodeDragStop" @selection-start="onSelectionStart" @selection-end="onSelectionEnd" @nodes-change="onElementsChange" @edges-change="onElementsChange">
          <template #node-frame="props"><FrameNode v-bind="props" :running="busy || isRunning" :zoom="viewport.zoom" @update-name="updateNodeName(props.id, $event)" @run-workflow="runWorkflow()" @resize-start="onFrameResizeStart(props.id)" @resize-end="onFrameResizeEnd" /></template>
          <template #node-workflow="props"><WorkflowNode v-bind="props" :node-run="nodeRuns[props.id] || null" :run-id="run?.id || null" :inbound-type="inboundExportTarget(props.id)" :inbound-image="inboundImage(props.id)" :node-catalog="compatibleNodeTypes(props.data.workflowType)" :viewport-dismiss-version="viewportDismissVersion" @update-config="updateNodeConfig(props.id, $event)" @update-name="updateNodeName(props.id, $event)" @open-model-editor="openModelEditor(props.id)" @preview-image="openImagePreview" @add-next="addNode($event, props.id)" @run-workflow="runWorkflow($event, 'downstream')" @run-downstream="runWorkflow($event, 'downstream')" /></template>
          <Background :gap="24" :size="1.2" :pattern-color="resolvedTheme === 'dark' ? '#252b2c' : '#cdd2cf'" />
          <MiniMap position="bottom-right" :width="160" :height="100" :pannable="true" :zoomable="true" :mask-color="resolvedTheme === 'dark' ? 'rgba(10, 12, 12, .7)' : 'rgba(238, 241, 238, .72)'" :node-color="resolvedTheme === 'dark' ? '#606a63' : '#a6afa9'" :node-stroke-color="resolvedTheme === 'dark' ? '#929a94' : '#737d76'" :node-stroke-width="1" :node-border-radius="4" />
          <Controls position="bottom-right" />
        </VueFlow>
        <AssetLibraryView v-if="canvasView === 'assets'" :rails="assetRails" :total="assetLibrary.total" @preview="openImagePreview" @open-model-editor="openModelEditor" />
        <RunLogPanel v-if="runDetails && runSummaryOpen" :details="runDetails" @close="runSummaryOpen = false" />
        <footer><div class="run-status"><span><i />{{ runSummary }}</span><button v-if="runDetails" type="button" :aria-expanded="runSummaryOpen" @click="runSummaryOpen = !runSummaryOpen">{{ runSummaryOpen ? 'Hide logs' : 'Logs' }} <b>{{ runSummaryOpen ? '↓' : '↑' }}</b></button></div><span>Click or drag a node from Add node · Drop a connection on empty canvas to create a compatible node · Press / to add</span></footer>
      </section>
    </section>
    <ModelEditor v-else-if="modelEditorNode" :node="modelEditorNode" @back="closeModelEditor" @update-config="updateNodeConfig(modelEditorNode.id, $event)" />
    <ImagePreviewOverlay :preview="imagePreview" @close="closeImagePreview" />
  </main>
</template>
