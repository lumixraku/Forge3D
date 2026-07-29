<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { SelectionMode, VueFlow, addEdge, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import '@vue-flow/node-resizer/dist/style.css'
import { useEditor } from '@tiptap/vue-3'
import Placeholder from '@tiptap/extension-placeholder'
import StarterKit from '@tiptap/starter-kit'
import AssetLibraryView from './components/AssetLibraryView.vue'
import CanvasContextMenu from './components/CanvasContextMenu.vue'
import CanvasToolbar from './components/CanvasToolbar.vue'
import ChatPanel from './components/ChatPanel.vue'
import FrameNode from './components/FrameNode.vue'
import ImagePreviewOverlay from './components/ImagePreviewOverlay.vue'
import RunLogPanel from './components/RunLogPanel.vue'
import TopBar from './components/TopBar.vue'
import WorkflowNode from './components/WorkflowNode.vue'
import { Attachment } from './editor/attachment'
import { buildAssetLibrary, buildAssetRails } from './asset-library'
import { canContinueSelection, selectedOptionIds } from './chat-selection'
import { applyLayoutPositions, buildSelectionFrame, fitFrameNodes, pointInAnyFrame, reparentDraggedNodes } from './frame-geometry'
import { mergeNodeRuns } from './node-runs'
import { formatDuration, summarizeRun } from './run-summary'
import { edgeDefaults, nodePresentation, toCanvasGraph, toDomainWorkflow } from './workflow-canvas'
import { buildFragment, importPlacementOffset, remapFragment, validateImportedWorkflow } from './workflow-fragment'
import { frameComponentGap, frameInsets, layoutWorkflow } from './workflow-layout'
import { canConnectNodeTypes, canConnectPorts, compatibleNodeTypes, nodeCatalog, nodeCategories, nodeDefaults, nodeDefinition, nodeInputPorts, nodeOutputPorts } from './workflow-nodes'

const ModelEditor = defineAsyncComponent(() => import('./components/ModelEditor.vue'))

const workflows = ref([])
const activeWorkflow = ref(null)
const conversation = ref(null)
const nodes = ref([])
const edges = ref([])
const composerVersion = ref(0)
const busy = ref(false)
const selectedOptions = ref({})
const continuingTaskId = ref(null)
const saving = ref(false)
const savedState = ref('Saved')
const run = ref(null)
const nodeRuns = ref({})
const error = ref('')
const clipboardFragment = ref(null)
const contextMenu = ref(null)
const nodeMenuOpen = ref(false)
const nodeMenuContext = ref(null)
const viewportDismissVersion = ref(0)
const workflowMenu = ref(null)
const workflowSwitcherOpen = ref(false)
const theme = ref(localStorage.getItem('forge3d-theme') || 'system')
const workspaceMode = ref('workflow')
const canvasMode = ref('select')
const canvasView = ref('canvas')
const modelEditorNodeId = ref(null)
const imagePreview = ref(null)
const runSummaryOpen = ref(false)
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
let saveTimer
let hydrating = false
let pendingConnection = null
let runPollToken = 0
const downloadedExportRuns = new Set()
let savePromise = null
let pendingSaveSnapshot = null
let frameFitQueued = false
let frameFitShouldSave = false
let dragging = false
let resizingFrameId = null
let marqueeSelecting = false
let marqueeStartedInFrame = false

// Canvas undo/redo history: each entry is a JSON snapshot of { nodes, edges }.
const HISTORY_LIMIT = 100
let historyPast = []
let historyFuture = []
let historyPresent = null
let historyPendingPrev = null
let historyTimer = null
let historyWorkflowId = null
let restoringHistory = false
let historySettling = false
let historySettleTimer = null
const canUndo = ref(false)
const canRedo = ref(false)

const { fitView, screenToFlowCoordinate, updateNodeInternals, viewport } = useVueFlow()
const messages = computed(() => conversation.value?.messages || [])
const composer = useEditor({
  extensions: [
    StarterKit,
    Placeholder.configure({ placeholder: 'Describe a 3D workflow or ask for a change...' }),
    Attachment,
  ],
  editorProps: {
    attributes: {
      class: 'composer-editor',
      'aria-label': 'Describe a 3D workflow or ask for a change',
    },
    handleKeyDown(_view, event) {
      if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return false
      event.preventDefault()
      sendMessage()
      return true
    },
  },
  onUpdate() {
    composerVersion.value += 1
  },
})
const composerHasContent = computed(() => {
  composerVersion.value
  const document = composer.value?.getJSON()
  return Boolean(composer.value?.getText().trim() || document?.content?.some((block) => block.content?.some((node) => node.type === 'attachment')))
})

function composerMessage() {
  return (composer.value?.getJSON().content || []).map((block) => (block.content || []).map((node) => {
    if (node.type === 'text') return node.text
    if (node.type === 'attachment') return `[Attachment: ${node.attrs.name}]`
    return ''
  }).join('')).join('\n').trim()
}

function clearComposer() {
  composer.value?.commands.clearContent()
  composerVersion.value += 1
}

function addComposerFiles(files) {
  for (const file of files) {
    const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null
    composer.value?.chain().focus().insertAttachment({
      id: crypto.randomUUID(),
      name: file.name,
      type: file.type,
      preview,
    }).insertContent(' ').run()
  }
}

async function submitAgentTask(input) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { accept: 'text/event-stream', 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || 'Request failed')
  }
  if (!response.body) throw new Error('Agent stream is unavailable')
  return response.body
}

async function refreshWorkflow(workflowId, taskId, structureChanged) {
  const data = await request(`/api/workflows/${workflowId}`)
  const pendingMessages = conversation.value?.messages.filter((item) => item.pending && item.taskId !== taskId) || []
  activeWorkflow.value = data.workflow
  conversation.value = { ...data.conversation, messages: [...data.conversation.messages, ...pendingMessages] }
  await toCanvas(data.workflow)
  await loadWorkflowList()
  await nextTick()
}

function applyAgentEvent(event, pendingAssistantId) {
  const pending = conversation.value?.messages.find((item) => item.id === pendingAssistantId || item.taskId === event.turn_id)
  if (event.type === 'task-start' && pending) pending.taskId = event.turn_id
  if (event.type === 'progress' && pending) pending.progress = [...(pending.progress || []), { label: event.label, status: event.status }]
  if (event.type === 'text' && pending) {
    pending.streamMessageId = event.id
    pending.content = event.text || ''
  }
  if (event.type === 'request_user_select' && pending) {
    pending.pending = false
    pending.request = event.request
    pending.content = ''
  }
  if (event.type === 'error') throw new Error(event.error || 'Agent task failed')
  return event.type === 'finish' ? { taskId: event.turn_id } : null
}

async function consumeAgentStream(stream, pendingAssistantId, token = runPollToken) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let completion = null
  while (token === runPollToken) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
    const frames = buffer.split(/\r?\n\r?\n/)
    buffer = frames.pop()
    for (const frame of frames) {
      const protocolType = frame.split(/\r?\n/).find((line) => line.startsWith('event: '))?.slice(7)
      const data = frame.split(/\r?\n/).find((line) => line.startsWith('data: '))?.slice(6)
      if (!data) continue
      const event = JSON.parse(data)
      if (!['message', 'error'].includes(protocolType) || (protocolType === 'error') !== (event.type === 'error')) throw new Error('Invalid SSE event framing')
      const outcome = applyAgentEvent(event, pendingAssistantId)
      if (event.type === 'workflow-updated') await refreshWorkflow(event.workflow_id, event.turn_id, event.structure_changed)
      completion = outcome || completion
    }
    if (done) break
  }
  if (completion) {
    const pending = conversation.value?.messages.find((item) => item.taskId === completion.taskId)
    if (pending) pending.pending = false
  }
}

async function restoreAgentTasks(workflowId) {
  const tasks = await request(`/api/tasks?workflowId=${encodeURIComponent(workflowId)}&status=queued,running,waiting_for_user`)
  for (const task of tasks) {
    const existing = conversation.value?.messages.some((item) => item.taskId === task.id)
    if (!existing) {
      conversation.value.messages.push(
        { id: `task-user-${task.id}`, role: 'user', content: task.message, taskId: task.id, createdAt: task.createdAt },
        { id: `task-assistant-${task.id}`, role: 'assistant', content: '', progress: task.progress, taskId: task.id, createdAt: task.createdAt, pending: task.status !== 'waiting_for_user', request: task.status === 'waiting_for_user' ? task.request : null },
      )
    }
  }
}

function toggleSelectedOption(message, optionId) {
  const current = selectedOptionIds(message, selectedOptions.value)
  if (current.includes(optionId)) {
    selectedOptions.value = { ...selectedOptions.value, [message.taskId]: current.filter((id) => id !== optionId) }
  } else if (message.request.max === 1) {
    selectedOptions.value = { ...selectedOptions.value, [message.taskId]: [optionId] }
  } else if (current.length < message.request.max) {
    selectedOptions.value = { ...selectedOptions.value, [message.taskId]: [...current, optionId] }
  }
}

async function continueTask(message) {
  if (!canContinueSelection(message, selectedOptions.value) || continuingTaskId.value) return
  continuingTaskId.value = message.taskId
  error.value = ''
  message.pending = true
  try {
    const response = await fetch(`/api/tasks/${message.taskId}/continue`, {
      method: 'POST',
      headers: { accept: 'text/event-stream', 'content-type': 'application/json' },
      body: JSON.stringify({ request_id: message.request.request_id, selected_option_ids: selectedOptionIds(message, selectedOptions.value) }),
    })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || 'Request failed')
    }
    if (!response.body) throw new Error('Agent stream is unavailable')
    await consumeAgentStream(response.body, message.id, runPollToken)
    delete selectedOptions.value[message.taskId]
  } catch (caught) {
    message.pending = false
    error.value = caught.message
  } finally {
    continuingTaskId.value = null
  }
}

const runSummary = computed(() => {
  if (!run.value) return 'Ready to run'
  const nodeRuns = Object.values(run.value.nodeRuns)
  const completed = nodeRuns.filter((nodeRun) => ['succeeded', 'failed'].includes(nodeRun.status)).length
  const totalDurationMs = nodeRuns.reduce((total, nodeRun) => total + (nodeRun.durationMs || 0), 0)
  const duration = totalDurationMs ? ` · ${formatDuration(totalDurationMs)}` : ''
  return run.value.status === 'running' ? `Running · ${completed}/${nodeRuns.length} steps${duration}` : `${nodeRuns.length} steps · ${run.value.status}${duration}`
})
const runDetails = computed(() => summarizeRun(run.value, nodes.value))
const isRunning = computed(() => run.value?.status === 'running')
const selectedNodes = computed(() => nodes.value.filter((node) => node.selected))
const selectedEdges = computed(() => edges.value.filter((edge) => edge.selected))

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
const frameableSelectedNodes = computed(() => selectedNodes.value.filter((node) => node.type !== 'frame' && !node.parentNode))
const canFrameSelection = computed(() => frameableSelectedNodes.value.length > 0)
const canDissolveSelection = computed(() => selectedNodes.value.some((node) => node.type === 'frame'))
const selectedCount = computed(() => selectedNodes.value.length + selectedEdges.value.length)
const hasSelectedNode = computed(() => selectedNodes.value.length > 0)
const hasSelection = computed(() => selectedCount.value > 0)
const panOnDrag = computed(() => canvasMode.value === 'move')
const toolbarMenuOpen = computed(() => nodeMenuOpen.value && !nodeMenuContext.value)

const assetLibrary = computed(() => buildAssetLibrary(nodes.value))
const assetRails = computed(() => buildAssetRails(assetLibrary.value))
const resolvedTheme = computed(() => theme.value === 'system' ? (systemTheme.matches ? 'dark' : 'light') : theme.value)
const modelEditorNode = computed(() => nodes.value.find((node) => node.id === modelEditorNodeId.value) || null)

function applyTheme() {
  document.documentElement.dataset.theme = resolvedTheme.value
  document.documentElement.style.colorScheme = resolvedTheme.value
}

function setTheme(value) {
  theme.value = value
  localStorage.setItem('forge3d-theme', value)
  applyTheme()
}

function handleSystemThemeChange() {
  if (theme.value === 'system') applyTheme()
}

async function toCanvas(workflow) {
  hydrating = true
  const graph = toCanvasGraph(workflow)
  nodes.value = graph.nodes
  edges.value = graph.edges
  // Repair workflows whose views were materialized before they were wired to the model node.
  await fitFramesAfterRender({ persist: true })
  hydrating = false
  syncHistoryWorkflow(workflow.id)
}

function fromCanvas() {
  return toDomainWorkflow(activeWorkflow.value, nodes.value, edges.value)
}

async function request(url, options) {
  const response = await fetch(url, options)
  const data = response.status === 204 ? null : await response.json()
  if (!response.ok) throw new Error(data.error || 'Request failed')
  return data
}

async function loadWorkflows(preferredId) {
  await loadWorkflowList()
  const id = preferredId || activeWorkflow.value?.id || workflows.value[0]?.id
  if (id) await openWorkflow(id)
}

async function openWorkflow(id) {
  closeWorkflowSwitcher()
  if (activeWorkflow.value && activeWorkflow.value.id !== id) await flushPendingSave()
  runPollToken += 1
  error.value = ''
  imagePreview.value = null
  workspaceMode.value = 'workflow'
  modelEditorNodeId.value = null
  const data = await request(`/api/workflows/${id}`)
  activeWorkflow.value = data.workflow
  conversation.value = data.conversation
  run.value = null
  nodeRuns.value = data.nodeRuns || {}
  await toCanvas(data.workflow)
  await restoreAgentTasks(id)
  fitView({ padding: 0.18, duration: 500 })
}

async function sendMessage() {
  const message = composerMessage()
  if (!message) return
  const previousConversation = conversation.value
  const createdAt = new Date().toISOString()
  const pendingAssistantId = `pending-assistant-${Date.now()}`
  busy.value = true
  error.value = ''
  const previousComposer = composer.value?.getJSON()
  clearComposer()
  conversation.value = {
    ...previousConversation,
    messages: [
      ...messages.value,
      { id: `pending-user-${Date.now()}`, role: 'user', content: message, createdAt },
      { id: pendingAssistantId, role: 'assistant', content: '', progress: [], taskId: null, createdAt, pending: true },
    ],
  }
  try {
    await flushPendingSave()
    const workflowId = activeWorkflow.value?.id
    busy.value = false
    const stream = await submitAgentTask({ message, workflowId })
    await consumeAgentStream(stream, pendingAssistantId, runPollToken)
  } catch (caught) {
    const current = conversation.value?.messages.find((item) => item.id === pendingAssistantId)
    if (current) {
      current.pending = false
      current.failed = true
      current.content = caught.message
    } else {
      conversation.value = previousConversation
      composer.value?.commands.setContent(previousComposer || { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: message }] }] })
    }
    error.value = caught.message
  } finally {
    busy.value = false
  }
}

async function loadWorkflowList() {
  workflows.value = await request('/api/workflows')
}

function scheduleSave() {
  if (!activeWorkflow.value || busy.value || hydrating) return
  recordHistory()
  savedState.value = 'Unsaved changes'
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    saveWorkflow(fromCanvas())
  }, 700)
}

async function flushPendingSave() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
    await saveWorkflow(fromCanvas())
  } else if (savePromise) {
    await savePromise
  }
}

async function saveWorkflow(workflow = fromCanvas()) {
  if (!workflow) return
  if (saving.value) {
    pendingSaveSnapshot = workflow
    return savePromise
  }
  saving.value = true
  savedState.value = 'Saving…'
  savePromise = (async () => {
    let nextWorkflow = workflow
    while (nextWorkflow) {
      const savingWorkflow = nextWorkflow
      pendingSaveSnapshot = null
      const savedWorkflow = await request(`/api/workflows/${savingWorkflow.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(savingWorkflow),
      })
      if (activeWorkflow.value?.id === savedWorkflow.id) activeWorkflow.value = savedWorkflow
      await loadWorkflowList()
      nextWorkflow = pendingSaveSnapshot
    }
  })()
  try {
    await savePromise
    savedState.value = 'Saved'
  } catch (caught) {
    error.value = caught.message
    savedState.value = 'Save failed'
  } finally {
    saving.value = false
    savePromise = null
  }
}

function snapshotCanvas() {
  return JSON.stringify({ nodes: nodes.value, edges: edges.value })
}

function updateHistoryFlags() {
  canUndo.value = historyPast.length > 0
  canRedo.value = historyFuture.length > 0
}

// Point the history at a workflow. Switching to a different workflow starts a
// fresh stack; re-hydrating the same one (e.g. after a paste) keeps it.
function syncHistoryWorkflow(workflowId) {
  if (workflowId === historyWorkflowId) return
  historyWorkflowId = workflowId
  historyPast = []
  historyFuture = []
  historyPendingPrev = null
  clearTimeout(historyTimer)
  historyTimer = null
  historyPresent = workflowId ? snapshotCanvas() : null
  updateHistoryFlags()
  // The canvas emits a persisted frame-fit as node dimensions settle after a
  // load; absorb that into the baseline so undo doesn't begin with a stray step.
  historySettling = true
  clearTimeout(historySettleTimer)
  historySettleTimer = setTimeout(() => { historySettling = false }, 400)
}

// Record a history step for the change that just scheduled a save. Rapid bursts
// (dragging, typing) coalesce into one step via a short debounce.
function recordHistory() {
  if (restoringHistory || hydrating || !activeWorkflow.value) return
  if (historySettling) {
    historyPresent = snapshotCanvas()
    return
  }
  if (historyPresent === null) historyPresent = snapshotCanvas()
  if (historyPendingPrev === null) historyPendingPrev = historyPresent
  clearTimeout(historyTimer)
  historyTimer = setTimeout(() => {
    historyTimer = null
    const next = snapshotCanvas()
    const previous = historyPendingPrev
    historyPendingPrev = null
    if (next === previous) return
    historyPast.push(previous)
    if (historyPast.length > HISTORY_LIMIT) historyPast.shift()
    historyFuture = []
    historyPresent = next
    updateHistoryFlags()
  }, 400)
}

// Fold any in-flight (debounced) change into the past so undo can revert it.
function flushHistory() {
  if (!historyTimer) return
  clearTimeout(historyTimer)
  historyTimer = null
  const next = snapshotCanvas()
  const previous = historyPendingPrev
  historyPendingPrev = null
  if (previous !== null && next !== previous) {
    historyPast.push(previous)
    if (historyPast.length > HISTORY_LIMIT) historyPast.shift()
    historyFuture = []
    historyPresent = next
    updateHistoryFlags()
  }
}

async function restoreSnapshot(snapshot) {
  const parsed = JSON.parse(snapshot)
  restoringHistory = true
  nodes.value = parsed.nodes
  edges.value = parsed.edges
  scheduleSave()
  await nextTick()
  parsed.nodes.forEach((node) => updateNodeInternals(node.id))
  restoringHistory = false
}

function undo() {
  flushHistory()
  if (!historyPast.length) return
  historyFuture.push(historyPresent)
  historyPresent = historyPast.pop()
  updateHistoryFlags()
  restoreSnapshot(historyPresent)
}

function redo() {
  if (!historyFuture.length) return
  historyPast.push(historyPresent)
  historyPresent = historyFuture.pop()
  updateHistoryFlags()
  restoreSnapshot(historyPresent)
}

async function duplicateWorkflow(workflowId = activeWorkflow.value?.id) {
  if (!workflowId) return
  try {
    const workflow = await request(`/api/workflows/${workflowId}/duplicate`, { method: 'POST' })
    await loadWorkflows(workflow.id)
  } catch (caught) {
    error.value = caught.message
  }
}

async function deleteWorkflow(workflowId) {
  const workflow = workflows.value.find((item) => item.id === workflowId)
  if (!workflow || !window.confirm(`Delete "${workflow.name}"? This cannot be undone.`)) return

  try {
    const deletingActiveWorkflow = activeWorkflow.value?.id === workflowId
    if (deletingActiveWorkflow) await flushPendingSave()
    await request(`/api/workflows/${workflowId}`, { method: 'DELETE' })
    await loadWorkflowList()
    if (!deletingActiveWorkflow) return

    activeWorkflow.value = null
    conversation.value = null
    nodes.value = []
    edges.value = []
    run.value = null
    nodeRuns.value = {}
    if (workflows.value[0]) await openWorkflow(workflows.value[0].id)
  } catch (caught) {
    error.value = caught.message
  }
}

async function createWorkflow() {
  const name = window.prompt('Name this workflow', 'New 3D workflow')?.trim()
  if (!name) return

  try {
    const workflow = await request('/api/workflows', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name,
        description: 'A new 3D production workflow ready to customize.',
        nodes: [],
        edges: [],
        viewport: { x: 80, y: 160, zoom: 0.72 },
      }),
    })
    await loadWorkflows(workflow.id)
  } catch (caught) {
    error.value = caught.message
  }
}

async function renameWorkflow(name) {
  activeWorkflow.value = { ...activeWorkflow.value, name }
  await saveWorkflow()
}

async function exportWorkflow(workflowId) {
  try {
    const { workflow } = await request(`/api/workflows/${workflowId}`)
    const blob = new Blob([`${JSON.stringify(workflow, null, 2)}\n`], { type: 'application/json' })
    const anchor = document.createElement('a')
    anchor.href = URL.createObjectURL(blob)
    anchor.download = `${workflow.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.workflow.json`
    anchor.click()
    URL.revokeObjectURL(anchor.href)
  } catch (caught) {
    error.value = `Workflow export failed: ${caught.message}`
  }
}

async function importWorkflowFile(file) {
  if (!file) return

  try {
    const input = JSON.parse(await file.text())
    if (!activeWorkflow.value) throw new Error('Open a workflow before importing')
    validateImportedWorkflow(input)
    await pasteFragment(
      { nodes: input.nodes, edges: input.edges || [] },
      { offset: importPlacementOffset(nodes.value, input.nodes), translateRoots: true },
    )
    closeWorkflowSwitcher()
  } catch (caught) {
    error.value = `Workflow import failed: ${caught.message}`
  }
}

async function runWorkflow(targetNodeId, scope = 'node') {
  if (!activeWorkflow.value || busy.value || isRunning.value) return
  busy.value = true
  error.value = ''
  const pollToken = ++runPollToken
  try {
    await saveWorkflow()
    const workflowId = activeWorkflow.value.id
    const startedRun = await request(`/api/workflows/${workflowId}/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetNodeId, scope }),
    })
    run.value = startedRun
    nodeRuns.value = targetNodeId ? mergeNodeRuns(nodeRuns.value, startedRun.nodeRuns) : startedRun.nodeRuns
    const runId = run.value.id
    busy.value = false

    while (run.value?.status === 'running' && runPollToken === pollToken) {
      await new Promise((resolve) => setTimeout(resolve, 250))
      const nextRun = await request(`/api/workflows/${workflowId}/runs/${runId}`)
      if (runPollToken !== pollToken || activeWorkflow.value?.id !== workflowId) return
      run.value = nextRun
      nodeRuns.value = targetNodeId ? mergeNodeRuns(nodeRuns.value, nextRun.nodeRuns) : nextRun.nodeRuns
      if (nextRun.status === 'succeeded' && !downloadedExportRuns.has(nextRun.id)) {
        downloadedExportRuns.add(nextRun.id)
        for (const [nodeId, nodeRun] of Object.entries(nextRun.nodeRuns)) {
          if (nodes.value.find((node) => node.id === nodeId)?.data.workflowType === 'export-model') downloadExport(nodeRun)
        }
      }
    }
  } catch (caught) {
    error.value = caught.message
  } finally {
    busy.value = false
  }
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

function downloadExport(nodeRun) {
  const outputs = nodeRun?.output?.outputs || (nodeRun?.output?.downloadUrl ? [nodeRun.output] : [])
  for (const output of outputs) {
    if (!output.downloadUrl) continue
    const anchor = document.createElement('a')
    anchor.href = output.downloadUrl
    anchor.download = output.filename || `shark-gardener.${String(output.format || 'GLB').toLowerCase()}`
    anchor.click()
  }
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

function deleteSelected({ preserveFrameChildren = true } = {}) {
  const selectedFrameIds = new Set(selectedNodes.value.filter((node) => node.type === 'frame').map((node) => node.id))
  const nodeIds = new Set(selectedNodes.value
    .filter((node) => node.type !== 'frame' && (!preserveFrameChildren || !selectedFrameIds.has(node.parentNode)))
    .map((node) => node.id))
  const edgeIds = new Set(selectedEdges.value.map((edge) => edge.id))
  const frames = new Map(nodes.value.filter((node) => selectedFrameIds.has(node.id)).map((node) => [node.id, node]))
  nodes.value = nodes.value
    .filter((node) => !selectedFrameIds.has(node.id) && !nodeIds.has(node.id))
    .map((node) => {
      const frame = frames.get(node.parentNode)
      if (!frame) return node
      return {
        ...node,
        parentNode: undefined,
        extent: undefined,
        expandParent: false,
        position: { x: frame.position.x + node.position.x, y: frame.position.y + node.position.y },
      }
    })
  edges.value = edges.value.filter((edge) =>
    !edgeIds.has(edge.id) &&
    !nodeIds.has(edge.source) &&
    !nodeIds.has(edge.target)
  )
  scheduleSave()
}

function dissolveSelectedFrames() {
  if (!canDissolveSelection.value) return
  deleteSelected({ preserveFrameChildren: true })
}

function onEdgeClick({ edge, event }) {
  const extendSelection = event?.shiftKey
  nodes.value = nodes.value.map((node) => extendSelection ? node : { ...node, selected: false })
  edges.value = edges.value.map((item) => ({
    ...item,
    selected: item.id === edge.id || (extendSelection && item.selected),
  }))
}

// Vue Flow's native @edge-click is unreliable here (pane selection intercepts it),
// so detect edge hits ourselves on the capture-phase pointerdown.
function selectCanvasEdge(event) {
  const edgeElement = event.target.closest?.('.vue-flow__edge')
  if (!edgeElement) return
  const edge = edges.value.find((item) => item.id === edgeElement.dataset.id)
  if (edge) onEdgeClick({ edge, event })
}

function nextNodeId(type) {
  const ids = new Set(nodes.value.map((node) => node.id))
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
  const [kind, detail, tone] = presentation
  const node = {
    id: nextNodeId(type),
    type: 'workflow',
    position: position || nodePosition(sourceId),
    selected: true,
    data: {
      kind,
      label: nodeCatalog.find((item) => item.type === type)?.label || type,
      detail,
      tone,
      status: 'ready',
      workflowType: type,
      config: nodeDefaults(type),
      inputTypes: nodeDefinition(type)?.inputTypes || [],
      outputType: nodeDefinition(type)?.outputType || null,
      inputPorts: nodeInputPorts(type),
      outputPorts: nodeOutputPorts(type),
    },
  }
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

function makeSelectionFrame() {
  const selected = frameableSelectedNodes.value
  if (!selected.length) return

  const frameId = nextNodeId('frame')
  nodes.value = buildSelectionFrame(nodes.value, selected, { insets: frameInsets(viewport.value.zoom), frameId })
  edges.value = edges.value.map((edge) => ({ ...edge, selected: false }))
  scheduleSave()
  focusNode(frameId)
}

function fitFrames() {
  const fitted = fitFrameNodes(nodes.value, frameInsets(viewport.value.zoom))
  if (fitted.changed) nodes.value = fitted.nodes
  return fitted.changed
}

function onCanvasPointerDown(event) {
  marqueeStartedInFrame = pointInAnyFrame(screenToFlowCoordinate({ x: event.clientX, y: event.clientY }), nodes.value)
}

function updateDraggedNodeFrames(draggedNodes = []) {
  const reparented = reparentDraggedNodes(nodes.value, draggedNodes)
  if (reparented.changed) nodes.value = reparented.nodes
  return reparented.changed
}

function queueFrameFit({ persist = false } = {}) {
  frameFitShouldSave ||= persist
  if (frameFitQueued) return
  frameFitQueued = true
  nextTick(async () => {
    frameFitQueued = false
    const shouldSave = frameFitShouldSave
    frameFitShouldSave = false
    await new Promise((resolve) => requestAnimationFrame(resolve))
    await nextTick()
    if (fitFrames() && shouldSave) scheduleSave()
  })
}

async function fitFramesAfterRender({ persist = false } = {}) {
  await nextTick()
  await new Promise((resolve) => requestAnimationFrame(resolve))
  await nextTick()
  const changed = fitFrames()
  // Handles use dynamic per-port positions, so refresh their measured bounds
  // after the DOM settles or edges connect to stale points.
  updateNodeInternals()
  if (changed && persist) scheduleSave()
  return changed
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

function onSelectionStart() {
  marqueeSelecting = true
}

function onSelectionEnd() {
  marqueeSelecting = false
  marqueeStartedInFrame = false
}

function onElementsChange(changes) {
  // A marquee that begins inside a section selects its contents. A marquee that
  // begins outside keeps the section selected along with anything it overlaps.
  if (marqueeSelecting && marqueeStartedInFrame) {
    const frameIds = new Set(nodes.value.filter((node) => node.type === 'frame').map((node) => node.id))
    if (changes.some((change) => change.type === 'select' && change.selected && frameIds.has(change.id))) {
      // Vue Flow applies its selection change around this callback; enforce the
      // inside-section exception after that update without disturbing children.
      queueMicrotask(() => {
        nodes.value = nodes.value.map((node) => node.type === 'frame' && node.selected ? { ...node, selected: false } : node)
      })
    }
  }
  const hasDimensions = changes.some((change) => change.type === 'dimensions' && change.id !== resizingFrameId)
  // Resize frames to their children only once settled: on a node's own size change,
  // or on a position change that is NOT part of an in-flight drag. While the mouse is
  // down we leave the frame untouched; onNodeDragStop refits on release.
  if (hasDimensions || (!dragging && changes.some((change) => change.type === 'position'))) {
    queueFrameFit({ persist: hasDimensions })
  }
  if (changes.some((change) => change.type === 'remove')) scheduleSave()
}

function onFrameResizeStart(id) {
  resizingFrameId = id
  nodes.value = nodes.value.map((node) => node.id === id ? { ...node, data: { ...node.data, manualSize: true } } : node)
}

function onFrameResizeEnd() {
  resizingFrameId = null
  scheduleSave()
}

function onNodeDragStart() {
  dragging = true
}

function onNodeDragStop({ nodes: draggedNodes = [] } = {}) {
  updateDraggedNodeFrames(draggedNodes)
  dragging = false
  fitFrames()
  scheduleSave()
}

async function autoLayout({ persist = true } = {}) {
  const workflowNodes = nodes.value.filter((node) => node.type !== 'frame')
  const positions = await layoutWorkflow(workflowNodes, edges.value, {
    componentGap: frameComponentGap(viewport.value.zoom),
  })
  nodes.value = applyLayoutPositions(nodes.value, positions, frameInsets(viewport.value.zoom))
  await fitFramesAfterRender({ persist: false })
  queueFrameFit({ persist })
  fitView({ padding: 0.18, duration: 500 })
  if (persist) scheduleSave()
}

function selectAll() {
  nodes.value = nodes.value.map((node) => ({ ...node, selected: true }))
}

function selectedFragmentData(name = 'Untitled block') {
  const selected = selectedNodes.value
  if (!selected.length) return null
  return buildFragment(fromCanvas(), new Set(selected.map((node) => node.id)), name)
}

async function copySelected() {
  const fragment = selectedFragmentData('Copied selection')
  if (!fragment) return
  clipboardFragment.value = fragment
  try {
    await navigator.clipboard.writeText(JSON.stringify(fragment, null, 2))
  } catch {
    // The in-app clipboard still works when browser clipboard permission is unavailable.
  }
}

async function pasteFragment(fragment = clipboardFragment.value, options = {}) {
  if (!fragment?.nodes?.length) return
  const maxX = nodes.value.length ? Math.max(...nodes.value.map((node) => node.position.x)) : 0
  const { nodes: domainNodes, edges: domainEdges } = remapFragment(fragment, {
    offset: options.offset || { x: maxX + 310, y: 120 },
    translateRoots: options.translateRoots,
  })
  activeWorkflow.value = {
    ...fromCanvas(),
    nodes: [...fromCanvas().nodes, ...domainNodes],
    edges: [...fromCanvas().edges, ...domainEdges],
  }
  toCanvas(activeWorkflow.value)
  await nextTick()
  if (options.selectInserted) {
    const insertedIds = new Set(domainNodes.map((node) => node.id))
    nodes.value = nodes.value.map((node) => ({ ...node, selected: insertedIds.has(node.id) }))
  }
  scheduleSave()
}

async function duplicateSelected() {
  const selected = selectedNodes.value
  const fragment = selectedFragmentData('Duplicated selection')
  if (!fragment || !selected.length) return
  const minX = Math.min(...selected.map((node) => node.position.x))
  const minY = Math.min(...selected.map((node) => node.position.y))
  await pasteFragment(fragment, { offset: { x: minX + 24, y: minY + 24 }, selectInserted: true })
}

async function createWorkflowFromSelection() {
  if (!selectedNodes.value.length) return
  const name = window.prompt('Name this workflow', 'Workflow from selection')?.trim()
  if (!name) return
  const selection = selectedFragmentData(name)
  if (!selection) return
  const payload = {
    name,
    description: `${selection.nodes.length} selected steps from ${activeWorkflow.value.name}`,
    nodes: selection.nodes,
    edges: selection.edges,
  }
  try {
    const workflow = await request('/api/workflows', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    await loadWorkflows(workflow.id)
  } catch (caught) {
    error.value = caught.message
  }
}

function handleKeyboard(event) {
  if (imagePreview.value) {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeImagePreview()
    }
    return
  }
  if (event.key === 'Escape' && workspaceMode.value === 'model-editor') {
    event.preventDefault()
    closeModelEditor()
    return
  }
  if (event.key === 'Escape' && workflowSwitcherOpen.value) {
    event.preventDefault()
    closeWorkflowSwitcher()
    return
  }
  const modifier = event.metaKey || event.ctrlKey
  if (event.key === 'Escape' && (nodeMenuOpen.value || workflowMenu.value)) {
    closeContextMenu()
    closeWorkflowMenu()
    return
  }
  if (modifier && event.code === 'KeyD') {
    event.preventDefault()
    if (hasSelection.value) duplicateSelected()
    return
  }
  const editing = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)
  if (editing) return
  if (modifier && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    if (event.shiftKey) redo()
    else undo()
    return
  }
  if (modifier && event.key.toLowerCase() === 'y') {
    event.preventDefault()
    redo()
    return
  }
  if (['Backspace', 'Delete'].includes(event.key) && hasSelection.value) {
    event.preventDefault()
    deleteSelected()
    return
  }
  if (event.key === '/') {
    event.preventDefault()
    const canvas = document.querySelector('.flow-canvas')?.getBoundingClientRect()
    if (canvas) openNodeMenuAt(canvas.left + canvas.width / 2, canvas.top + canvas.height / 2)
    return
  }
  if (modifier && event.key.toLowerCase() === 'a') {
    event.preventDefault()
    selectAll()
  }
  if (modifier && event.key.toLowerCase() === 'c' && hasSelection.value) {
    event.preventDefault()
    copySelected()
  }
  if (modifier && event.key.toLowerCase() === 'v' && clipboardFragment.value) {
    event.preventDefault()
    pasteFragment()
  }
}

onMounted(async () => {
  window.addEventListener('keydown', handleKeyboard, true)
  window.addEventListener('pointerdown', closeWorkflowMenu)
  systemTheme.addEventListener('change', handleSystemThemeChange)
  applyTheme()
  try {
    await loadWorkflows()
  } catch (caught) {
    error.value = caught.message
  }
})
onUnmounted(() => {
  clearTimeout(saveTimer)
  composer.value?.destroy()
  window.removeEventListener('keydown', handleKeyboard, true)
  window.removeEventListener('pointerdown', closeWorkflowMenu)
  systemTheme.removeEventListener('change', handleSystemThemeChange)
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
