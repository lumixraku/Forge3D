<script setup>
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { SelectionMode, VueFlow, addEdge, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import Placeholder from '@tiptap/extension-placeholder'
import StarterKit from '@tiptap/starter-kit'
import WorkflowNode from './components/WorkflowNode.vue'
import FrameNode from './components/FrameNode.vue'
import { Attachment } from './editor/attachment.js'
import { mergeNodeRuns } from './node-runs.js'
import { summarizeRun } from './run-summary.js'
import { layoutWorkflow } from './workflow-layout.js'
import { canConnectNodeTypes, canConnectPorts, compatibleNodeTypes, nodeCatalog, nodeCategories, nodeDefinition, nodeDisplayName, nodeInputPorts, nodeOutputPorts } from './workflow-nodes.js'

const ModelEditor = defineAsyncComponent(() => import('./components/ModelEditor.vue'))

const nodePresentation = {
  frame: ['SECTION', 'Workflow group', 'slate'],
  'reference-image': ['INPUT', 'Reference source', 'cyan'],
  'generated-image': ['OUTPUT', 'Generated view', 'amber'],
  prompt: ['PROMPT', 'Creative direction', 'violet'],
  'generate-image': ['IMAGE', 'Concept generation', 'amber'],
  'generate-multiview-images': ['MULTI-VIEW', 'Four-view generation', 'amber'],
  review: ['CHECK', 'Approval gate', 'rose'],
  'generate-model': ['3D MODEL', 'Image or text to 3D', 'green'],
  'smart-mesh': ['3D MODEL', 'Smart mesh generation', 'green'],
  'multiview-to-3d': ['3D MODEL', 'Four-view reconstruction', 'green'],
  'text-to-3d': ['3D MODEL', 'Text to 3D', 'green'],
  retopology: ['MESH', 'Geometry optimization', 'rose'],
  bake: ['BAKE', 'Bake two models', 'rose'],
  texture: ['MATERIAL', 'UV texture generation', 'violet'],
  rigging: ['RIG', 'Auto rigging', 'violet'],
  split: ['SPLIT', 'Part segmentation', 'cyan'],
  'model-preview': ['REVIEW', 'Interactive preview', 'cyan'],
  'export-model': ['EXPORT', 'Export image or 3D model', 'amber'],
}

const nodeConfigDefaults = {
  frame: {},
  'reference-image': { sourceType: 'Upload', reference: '', background: 'Keep', preview: '/shark-reference.png' },
  'generated-image': { sourceType: 'Generated', reference: '', background: 'Keep', preview: '/shark-concept-front.png' },
  prompt: { prompt: 'Production-ready stylized 3D asset', strength: 80 },
  'generate-image': { model: 'GPT Image 2', count: 4, aspectRatio: '1:1', referenceMode: 'Image + Prompt', previews: ['/shark-concept-front.png', '/shark-concept-left.png', '/shark-concept-right.png', '/shark-concept-back.png'] },
  'generate-multiview-images': { model: 'GPT Image 2', aspectRatio: '1:1', referenceMode: 'Image + Prompt', viewPreviews: { front: '/shark-concept-front.png', back: '/shark-concept-back.png', left: '/shark-concept-left.png', right: '/shark-concept-right.png' } },
  review: { instruction: 'Review the generated image before continuing.', preview: '/shark-concept-front.png', approved: false },
  'generate-model': { modelVersion: 'Smart Mesh', textureMode: 'PBR', faceType: 'Triangle', faceCount: 20000, preview: '/shark-model.png' },
  'smart-mesh': { faceType: 'Triangle', faceCount: 20000, textureQuality: 'No texture', pbr: true, preview: '/shark-model.png' },
  'multiview-to-3d': { modelVersion: 'Smart Mesh', textureMode: 'PBR', faceType: 'Triangle', faceCount: 20000, preview: '/shark-model.png' },
  'text-to-3d': { modelVersion: 'Smart Mesh', textureMode: 'PBR', faceType: 'Triangle', faceCount: 20000, preview: '/shark-model.png' },
  retopology: { modelVersion: 'v2.0', faceType: 'Triangle', faceLimit: 10000, bakeTextures: true, preview: '/shark-retopology.png' },
  bake: { preview: '/shark-model.png' },
  texture: { textureQuality: '2K', pbr: true, preview: '/shark-textured.png' },
  rigging: { preview: '/shark-model.png' },
  split: { subdivision: 'Medium', complete: true, preview: '/shark-model.png' },
  'model-preview': { environment: 'Studio', autoRotate: true, wireframe: false, preview: '/shark-review.png' },
  'export-model': { modelFormat: 'GLB', exportTargets: ['dcc'], preview: '/shark-model.png' },
}

const workflows = ref([])
const activeWorkflow = ref(null)
const conversation = ref(null)
const nodes = ref([])
const edges = ref([])
const composerFileInput = ref(null)
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
const workflowImportInput = ref(null)
const workflowImportDragging = ref(false)
const workflowNameInput = ref(null)
const renamingWorkflow = ref(false)
const workflowNameDraft = ref('')
const contextMenu = ref(null)
const nodeMenuOpen = ref(false)
const nodeMenuContext = ref(null)
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
let marqueeSelecting = false

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

const { fitView, screenToFlowCoordinate, updateNodeInternals } = useVueFlow()
const edgeDefaults = { selectable: true }
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

function openComposerFilePicker() {
  composerFileInput.value?.click()
}

function addComposerFiles(event) {
  const files = [...(event.target.files || [])]
  event.target.value = ''
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
function renderAssistantMarkdown(content) {
  return DOMPurify.sanitize(marked.parse(content || '', { async: false, breaks: true, gfm: true, html: false }))
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
  if (structureChanged) await autoLayout({ persist: true })
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

function selectedOptionIds(message) {
  return message.selection?.selected_option_ids || selectedOptions.value[message.taskId] || []
}

function toggleSelectedOption(message, optionId) {
  const current = selectedOptionIds(message)
  if (current.includes(optionId)) {
    selectedOptions.value = { ...selectedOptions.value, [message.taskId]: current.filter((id) => id !== optionId) }
  } else if (message.request.max === 1) {
    selectedOptions.value = { ...selectedOptions.value, [message.taskId]: [optionId] }
  } else if (current.length < message.request.max) {
    selectedOptions.value = { ...selectedOptions.value, [message.taskId]: [...current, optionId] }
  }
}

function canContinueSelection(message) {
  const count = selectedOptionIds(message).length
  return count >= message.request.min && count <= message.request.max
}

async function continueTask(message) {
  if (!canContinueSelection(message) || continuingTaskId.value) return
  continuingTaskId.value = message.taskId
  error.value = ''
  message.pending = true
  try {
    const response = await fetch(`/api/tasks/${message.taskId}/continue`, {
      method: 'POST',
      headers: { accept: 'text/event-stream', 'content-type': 'application/json' },
      body: JSON.stringify({ request_id: message.request.request_id, selected_option_ids: selectedOptionIds(message) }),
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

function formatDuration(durationMs) {
  return durationMs >= 1000 ? `${(durationMs / 1000).toFixed(2)} s` : `${durationMs} ms`
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

// Aggregate every produced asset from the current workflow's nodes into the three
// library buckets (reference / 2D / 3D). Purely derived — the canvas data is untouched.
const MODEL_ASSET_TYPES = new Set(['generate-model', 'text-to-3d', 'multiview-to-3d', 'smart-mesh', 'texture', 'retopology', 'bake', 'rigging', 'split', 'model-preview', 'export-model'])
const assetLibrary = computed(() => {
  const reference = [], images = [], models = []
  for (const node of nodes.value) {
    if (node.type !== 'workflow') continue
    const type = node.data?.workflowType
    const config = node.data?.config || {}
    const label = node.data?.label || type
    if (type === 'reference-image') {
      const src = config.selectedPreview || config.preview
      if (src) reference.push({ id: node.id, src, label, nodeId: node.id })
    } else if (type === 'generate-image' || type === 'generated-image') {
      const previews = Array.isArray(config.previews) && config.previews.length ? config.previews : [config.selectedPreview || config.preview].filter(Boolean)
      previews.forEach((src, i) => src && images.push({ id: `${node.id}-${i}`, src, label, nodeId: node.id }))
    } else if (MODEL_ASSET_TYPES.has(type)) {
      const src = config.selectedPreview || config.preview
      if (src) models.push({ id: node.id, src, label, nodeId: node.id })
    }
  }
  return { reference, images, models, total: reference.length + images.length + models.length }
})
const assetRails = computed(() => [
  { key: 'reference', title: 'Reference', badge: 'REF', items: assetLibrary.value.reference },
  { key: 'images', title: '2D Assets', badge: '2D', items: assetLibrary.value.images },
  { key: 'models', title: '3D Assets', badge: '3D', items: assetLibrary.value.models },
])
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
  const workflowNodes = new Map(workflow.nodes.map((node) => [node.id, node]))
  // Child positions are persisted in the parent's local coordinate space.
  const positions = new Map(workflow.nodes.map((node) => [node.id, node.ui.position || { x: 0, y: 0 }]))
  // VueFlow requires a parent node to be present before its children.
  nodes.value = [...workflow.nodes].sort((left, right) => (left.type === 'frame' ? -1 : 0) - (right.type === 'frame' ? -1 : 0)).map((node) => {
    if (node.type === 'frame') {
      return {
        id: node.id,
        type: 'frame',
        position: positions.get(node.id),
        width: node.ui.size?.width || 900,
        height: node.ui.size?.height || 600,
        // Let the frame body pass clicks through to the edges/child nodes beneath
        // it; the header (see FrameNode.vue) re-enables pointer events as the handle.
        style: { pointerEvents: 'none' },
        data: { label: node.name, description: node.config?.description || '' },
      }
    }
    // Image to 3D and Text to 3D are merged into one "Gen Model" node; display
    // any legacy text-to-3d node as generate-model (identical config, gains a text port).
    const type = node.type === 'text-to-3d' ? 'generate-model' : node.type
    const [kind, detail, tone] = nodePresentation[type] || ['STEP', type, 'cyan']
    return {
      id: node.id,
      type: 'workflow',
      position: positions.get(node.id),
      parentNode: node.ui.parentFrameId,
      // No extent/expandParent: those let Vue Flow lock children inside the frame
      // and live-resize it mid-drag. The frame is only refit on drag stop (fitFrames).
      data: {
        kind,
        label: nodeDisplayName(type, node.name),
        detail,
        tone,
        status: 'ready',
        workflowType: type,
        config: normalizeNodeConfig(type, node.config),
        inputTypes: nodeDefinition(type)?.inputTypes || [],
        outputType: nodeDefinition(type)?.outputType || null,
        inputPorts: nodeInputPorts(type),
        outputPorts: nodeOutputPorts(type),
      },
    }
  })
  // Ports collapsed to one input/output handle per node. Remap each stored
  // edge — legacy typed ports (image/text/model) and the old view ports
  // (front/back/left/right) alike — onto those single handles, drop edges that
  // no longer resolve to a port, and dedupe pairs that used to target distinct
  // ports on the same node into one link.
  const seenEdges = new Set()
  edges.value = workflow.edges
    .map((edge) => {
      const sourceType = workflowNodes.get(edge.source.nodeId)?.type === 'text-to-3d' ? 'generate-model' : workflowNodes.get(edge.source.nodeId)?.type
      const targetType = workflowNodes.get(edge.target.nodeId)?.type === 'text-to-3d' ? 'generate-model' : workflowNodes.get(edge.target.nodeId)?.type
      const sourceHandle = nodeOutputPorts(sourceType)[0]?.id
      const targetHandle = nodeInputPorts(targetType)[0]?.id
      const key = `${edge.source.nodeId}->${edge.target.nodeId}`
      if (!sourceHandle || !targetHandle || seenEdges.has(key)) return null
      seenEdges.add(key)
      return {
        id: edge.id,
        source: edge.source.nodeId,
        target: edge.target.nodeId,
        sourceHandle,
        targetHandle,
        sourcePort: sourceHandle,
        targetPort: targetHandle,
        ...edgeDefaults,
      }
    })
    .filter(Boolean)
  // Repair workflows whose views were materialized before they were wired to the model node.
  await fitFramesAfterRender({ persist: true })
  hydrating = false
  syncHistoryWorkflow(workflow.id)
}

function normalizeNodeConfig(type, config = {}) {
  const normalized = { ...nodeConfigDefaults[type], ...config }
  if (type === 'generate-image' && Array.isArray(normalized.previews) && !normalized.previews.includes(normalized.selectedPreview)) normalized.selectedPreview = normalized.previews[0] || null
  if (['generate-model', 'text-to-3d'].includes(type)) {
    if (config.quality && !config.modelVersion) normalized.modelVersion = config.quality === 'standard' ? 'Smart Mesh' : config.quality
    if (typeof config.texture === 'boolean' && !config.textureMode) normalized.textureMode = config.texture ? 'PBR' : 'None'
  }
  if (type === 'retopology' && config.targetFaces && !config.faceLimit) normalized.faceLimit = config.targetFaces
  if (type === 'texture') {
    if (!config.textureQuality && typeof config.resolution === 'string') normalized.textureQuality = ['2K', '4K', '8K'].includes(config.resolution.toUpperCase()) ? config.resolution.toUpperCase() : '2K'
    delete normalized.model
    delete normalized.resolution
    delete normalized.style
  }
  if (type === 'export-model' && !Array.isArray(config.exportTargets)) normalized.exportTargets = ['dcc']
  if (type === 'model-preview' && config.viewer === 'turntable' && config.autoRotate === undefined) normalized.autoRotate = true
  if (type === 'model-preview') delete normalized.background
  return normalized
}

function fromCanvas() {
  if (!activeWorkflow.value) return null
  const nodeMap = new Map(activeWorkflow.value.nodes.map((node) => [node.id, node]))
  return {
    ...activeWorkflow.value,
    nodes: nodes.value.map((node) => node.type === 'frame'
      ? { ...nodeMap.get(node.id), id: node.id, type: 'frame', name: node.data.label, config: nodeMap.get(node.id)?.config || {}, ui: { position: node.position, size: { width: Number(node.dimensions?.width || node.width || 900), height: Number(node.dimensions?.height || node.height || 600) } } }
      : { ...nodeMap.get(node.id), id: node.id, name: node.data.label, type: node.data.workflowType, config: node.data.config, ui: { position: node.position, parentFrameId: node.parentNode } }),
    edges: edges.value.map((edge) => ({
      id: edge.id,
      source: { nodeId: edge.source, port: edge.sourceHandle || edge.sourcePort || 'output' },
      target: { nodeId: edge.target, port: edge.targetHandle || edge.targetPort || 'input' },
    })),
  }
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

function startRenameWorkflow() {
  if (!activeWorkflow.value || busy.value || workspaceMode.value !== 'workflow') return
  workflowNameDraft.value = activeWorkflow.value.name
  renamingWorkflow.value = true
  nextTick(() => {
    workflowNameInput.value?.focus()
    workflowNameInput.value?.select()
  })
}

async function commitRenameWorkflow() {
  if (!renamingWorkflow.value) return
  renamingWorkflow.value = false
  const name = workflowNameDraft.value.trim()
  if (!activeWorkflow.value || !name || name === activeWorkflow.value.name) return
  activeWorkflow.value = { ...activeWorkflow.value, name }
  await saveWorkflow()
}

function cancelRenameWorkflow() {
  renamingWorkflow.value = false
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
    const workflow = await request('/api/workflows', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...input,
        id: undefined,
        revision: undefined,
        createdAt: undefined,
        updatedAt: undefined,
      }),
    })
    await loadWorkflows(workflow.id)
  } catch (caught) {
    error.value = `Workflow import failed: ${caught.message}`
  }
}

function importWorkflow(event) {
  const [file] = event.target.files
  event.target.value = ''
  importWorkflowFile(file)
}

function onWorkflowImportDragOver(event) {
  event.preventDefault()
  workflowImportDragging.value = true
}

function onWorkflowImportDragLeave() {
  workflowImportDragging.value = false
}

function onWorkflowImportDrop(event) {
  event.preventDefault()
  workflowImportDragging.value = false
  const [file] = event.dataTransfer.files
  importWorkflowFile(file)
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
  const modelTypes = ['model-preview', 'texture', 'retopology', 'generate-model', 'smart-mesh', 'multiview-to-3d', 'text-to-3d', 'bake', 'rigging', 'split', 'export-model']
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

function scrollRail(event, direction) {
  const track = event.currentTarget.closest('.asset-rail')?.querySelector('.asset-rail-track')
  track?.scrollBy({ left: direction * Math.min(track.clientWidth * 0.85, 520), behavior: 'smooth' })
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
      config: structuredClone(nodeConfigDefaults[type]),
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

  const padding = 64
  const headerHeight = 44
  const left = Math.min(...selected.map((node) => node.position.x))
  const top = Math.min(...selected.map((node) => node.position.y))
  const right = Math.max(...selected.map((node) => node.position.x + Number(node.dimensions?.width || node.width || 260)))
  const bottom = Math.max(...selected.map((node) => node.position.y + Number(node.dimensions?.height || node.height || 430)))
  const frameId = nextNodeId('frame')
  const framePosition = { x: left - padding, y: top - padding - headerHeight }
  const selectedIds = new Set(selected.map((node) => node.id))
  const frame = {
    id: frameId,
    type: 'frame',
    position: framePosition,
    width: right - left + padding * 2,
    height: bottom - top + padding * 2 + headerHeight,
    selected: true,
    style: { pointerEvents: 'none' },
    data: { label: 'Workflow section', description: '' },
  }
  const children = nodes.value.map((node) => selectedIds.has(node.id)
    ? {
        ...node,
        parentNode: frameId,
        position: { x: node.position.x - framePosition.x, y: node.position.y - framePosition.y },
        selected: false,
      }
    : { ...node, selected: false })

  nodes.value = [frame, ...children]
  edges.value = edges.value.map((edge) => ({ ...edge, selected: false }))
  scheduleSave()
  focusNode(frameId)
}

function fitFrames() {
  const padding = { x: 64, y: 108 }
  let changed = false
  const nextNodes = [...nodes.value]
  const nodeIndexes = new Map(nextNodes.map((node, index) => [node.id, index]))

  for (const frame of nextNodes.filter((node) => node.type === 'frame')) {
    const children = nextNodes.filter((node) => node.parentNode === frame.id)
    if (!children.length) continue
    const left = Math.min(...children.map((node) => node.position.x))
    const top = Math.min(...children.map((node) => node.position.y))
    const right = Math.max(...children.map((node) => node.position.x + Number(node.dimensions?.width || node.width || 260)))
    const bottom = Math.max(...children.map((node) => node.position.y + Number(node.dimensions?.height || node.height || 430)))
    const width = right - left + padding.x * 2
    const height = bottom - top + padding.y * 2
    // Vue Flow renders a node's size from style.width/height when present (it
    // prioritises that over node.width), so read the current size from there and
    // write the fitted size back the same way — otherwise a stale style.width
    // (e.g. left behind by expandParent) freezes the frame and leaves dead space.
    const frameWidth = Number(parseFloat(frame.style?.width) || frame.width || frame.dimensions?.width || 900)
    const frameHeight = Number(parseFloat(frame.style?.height) || frame.height || frame.dimensions?.height || 600)
    const offset = { x: padding.x - left, y: padding.y - top }
    if (Math.abs(frameWidth - width) < 0.5 && Math.abs(frameHeight - height) < 0.5 && Math.abs(offset.x) < 0.5 && Math.abs(offset.y) < 0.5) continue

    changed = true
    nextNodes[nodeIndexes.get(frame.id)] = {
      ...frame,
      width,
      height,
      style: { ...frame.style, width: `${width}px`, height: `${height}px` },
    }
    for (const child of children) {
      nextNodes[nodeIndexes.get(child.id)] = {
        ...child,
        position: {
          x: child.position.x + offset.x,
          y: child.position.y + offset.y,
        },
      }
    }
  }

  if (changed) nodes.value = nextNodes
  return changed
}

function absoluteNodePosition(node, nodeMap = new Map(nodes.value.map((item) => [item.id, item]))) {
  if (node.positionAbsolute) return { x: node.positionAbsolute.x, y: node.positionAbsolute.y }
  const position = node.position || { x: 0, y: 0 }
  if (!node.parentNode) return { x: position.x, y: position.y }

  const parent = nodeMap.get(node.parentNode)
  if (!parent) return { x: position.x, y: position.y }
  const parentPosition = absoluteNodePosition(parent, nodeMap)
  return { x: parentPosition.x + position.x, y: parentPosition.y + position.y }
}

function updateDraggedNodeFrames(draggedNodes = []) {
  const currentNodes = [...nodes.value]
  const nodeMap = new Map(currentNodes.map((node) => [node.id, node]))
  const frames = currentNodes.filter((node) => node.type === 'frame')
  if (!draggedNodes.length) return false

  let changed = false
  for (const draggedNode of draggedNodes) {
    const node = nodeMap.get(draggedNode.id)
    if (!node || node.type === 'frame') continue

    const position = absoluteNodePosition(draggedNode, nodeMap)
    const width = Number(draggedNode.dimensions?.width || draggedNode.width || node.dimensions?.width || node.width || 260)
    const height = Number(draggedNode.dimensions?.height || draggedNode.height || node.dimensions?.height || node.height || 430)
    const right = position.x + width
    const bottom = position.y + height
    const oldParent = node.parentNode
    const containingFrames = frames
      .filter((frame) => frame.id !== node.id)
      .map((frame) => {
        const framePosition = absoluteNodePosition(frame, nodeMap)
        const frameRight = framePosition.x + Number(parseFloat(frame.style?.width) || frame.width || frame.dimensions?.width || 900)
        const frameBottom = framePosition.y + Number(parseFloat(frame.style?.height) || frame.height || frame.dimensions?.height || 600)
        const overlap = Math.max(0, Math.min(right, frameRight) - Math.max(position.x, framePosition.x)) * Math.max(0, Math.min(bottom, frameBottom) - Math.max(position.y, framePosition.y))
        return { frame, framePosition, overlap }
      })
      .filter(({ overlap }) => overlap > 0)
      .sort((left, right) => right.overlap - left.overlap)
    const nextParent = containingFrames[0]?.frame || null

    if (nextParent?.id === oldParent) continue
    const nextParentPosition = nextParent ? containingFrames[0].framePosition : { x: 0, y: 0 }
    const nodeIndex = currentNodes.findIndex((item) => item.id === node.id)
    const updatedNode = {
      ...node,
      parentNode: nextParent?.id,
      position: {
        x: position.x - nextParentPosition.x,
        y: position.y - nextParentPosition.y,
      },
    }
    currentNodes[nodeIndex] = updatedNode
    nodeMap.set(node.id, updatedNode)
    changed = true
  }

  if (changed) nodes.value = currentNodes
  return changed
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

function toggleWorkflowSwitcher() {
  workflowSwitcherOpen.value = !workflowSwitcherOpen.value
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
  const menu = contextMenu.value
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
}

function onElementsChange(changes) {
  // A marquee (box) selection must grab the nodes inside a frame, not the frame
  // itself: frames are large containers, so Vue Flow's partial hit-test always
  // includes them. Strip that here, but only while a marquee is in progress —
  // deliberate frame selection (left/right click, which never run during a
  // marquee) stays intact so frames can still be dissolved or deleted.
  if (marqueeSelecting) {
    const frameIds = new Set(nodes.value.filter((node) => node.type === 'frame').map((node) => node.id))
    if (changes.some((change) => change.type === 'select' && change.selected && frameIds.has(change.id))) {
      // Vue Flow applies its selection change around this callback; enforce the
      // frame exception after that update without disturbing child selection.
      queueMicrotask(() => {
        nodes.value = nodes.value.map((node) => node.type === 'frame' && node.selected ? { ...node, selected: false } : node)
      })
    }
  }
  const hasDimensions = changes.some((change) => change.type === 'dimensions')
  // Resize frames to their children only once settled: on a node's own size change,
  // or on a position change that is NOT part of an in-flight drag. While the mouse is
  // down we leave the frame untouched; onNodeDragStop refits on release.
  if (hasDimensions || (!dragging && changes.some((change) => change.type === 'position'))) {
    queueFrameFit({ persist: hasDimensions })
  }
  if (changes.some((change) => change.type === 'remove')) scheduleSave()
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
  const positions = await layoutWorkflow(workflowNodes, edges.value)
  const padding = 70
  const frameBounds = new Map()
  for (const node of workflowNodes) {
    if (!node.parentNode) continue
    const position = positions.get(node.id)
    if (!position) continue
    const bounds = frameBounds.get(node.parentNode) || { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }
    bounds.left = Math.min(bounds.left, position.x)
    bounds.top = Math.min(bounds.top, position.y)
    bounds.right = Math.max(bounds.right, position.x + (node.dimensions?.width || node.width || 260))
    bounds.bottom = Math.max(bounds.bottom, position.y + (node.dimensions?.height || node.height || 430))
    frameBounds.set(node.parentNode, bounds)
  }
  // The layout works in a single global space, but a framed child's position is
  // stored relative to its frame's origin. Anchor each frame to the top-left of
  // its (padded) children, then convert children back into that local space.
  const frameOrigins = new Map()
  for (const [frameId, bounds] of frameBounds) {
    frameOrigins.set(frameId, { x: bounds.left - padding, y: bounds.top - padding })
  }
  nodes.value = nodes.value.map((node) => {
    if (node.type === 'frame') {
      const bounds = frameBounds.get(node.id)
      if (!bounds) return node
      const origin = frameOrigins.get(node.id)
      const width = bounds.right - bounds.left + padding * 2
      const height = bounds.bottom - bounds.top + padding * 2
      return { ...node, position: origin, width, height, style: { ...node.style, width: `${width}px`, height: `${height}px` } }
    }
    const position = positions.get(node.id)
    if (!position) return node
    const origin = node.parentNode ? frameOrigins.get(node.parentNode) : null
    return { ...node, position: origin ? { x: position.x - origin.x, y: position.y - origin.y } : position }
  })
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
  const workflow = fromCanvas()
  const selectedIds = new Set(selected.map((node) => node.id))
  const fragmentNodes = workflow.nodes.filter((node) => selectedIds.has(node.id))
  const minX = Math.min(...fragmentNodes.map((node) => node.ui.position.x))
  const minY = Math.min(...fragmentNodes.map((node) => node.ui.position.y))
  const internalEdges = workflow.edges.filter((edge) => selectedIds.has(edge.source.nodeId) && selectedIds.has(edge.target.nodeId))
  const inputs = workflow.edges
    .filter((edge) => !selectedIds.has(edge.source.nodeId) && selectedIds.has(edge.target.nodeId))
    .map((edge) => ({ nodeId: edge.target.nodeId, port: edge.target.port }))
  const outputs = workflow.edges
    .filter((edge) => selectedIds.has(edge.source.nodeId) && !selectedIds.has(edge.target.nodeId))
    .map((edge) => ({ nodeId: edge.source.nodeId, port: edge.source.port }))

  return {
    schemaVersion: '1.0',
    kind: 'workflow-fragment',
    name,
    description: `${fragmentNodes.length}-step reusable block from ${workflow.name}`,
    source: { workflowId: workflow.id, workflowRevision: workflow.revision },
    nodes: fragmentNodes.map((node) => ({ ...node, ui: { position: { x: node.ui.position.x - minX, y: node.ui.position.y - minY } } })),
    edges: internalEdges,
    interface: { inputs, outputs },
  }
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
  const suffix = Date.now().toString(36)
  const idMap = new Map(fragment.nodes.map((node, index) => [node.id, `${node.id}-${suffix}-${index}`]))
  const maxX = nodes.value.length ? Math.max(...nodes.value.map((node) => node.position.x)) : 0
  const offset = options.offset || { x: maxX + 310, y: 120 }
  const domainNodes = fragment.nodes.map((node) => ({
    ...JSON.parse(JSON.stringify(node)),
    id: idMap.get(node.id),
    ui: {
      ...node.ui,
      position: { x: node.ui.position.x + (node.type === 'frame' ? offset.x : 0), y: node.ui.position.y + (node.type === 'frame' ? offset.y : 0) },
      ...(node.ui.parentFrameId ? { parentFrameId: idMap.get(node.ui.parentFrameId) } : {}),
    },
  }))
  const domainEdges = fragment.edges.map((edge, index) => ({
    ...JSON.parse(JSON.stringify(edge)),
    id: `${edge.id}-${suffix}-${index}`,
    source: { ...edge.source, nodeId: idMap.get(edge.source.nodeId) },
    target: { ...edge.target, nodeId: idMap.get(edge.target.nodeId) },
  }))
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
  window.addEventListener('pointerdown', closeWorkflowSwitcher)
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
  window.removeEventListener('pointerdown', closeWorkflowSwitcher)
  systemTheme.removeEventListener('change', handleSystemThemeChange)
})
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <div class="brand-lockup flex items-center gap-3 h-full px-[18px] border-r border-line">
        <span class="brand-mark grid place-items-center w-[35px] h-[35px] rounded-[10px] bg-acid text-text-inverse font-mono font-semibold text-xs transition-all duration-150 hover:scale-105 hover:shadow-[0_0_0_3px] hover:shadow-acid/20">F3</span>
        <div><strong class="block font-mono font-semibold text-sm tracking-[-0.03em]">Forge3D</strong><small class="block mt-[2px] text-text-muted text-[11px]">Conversational workflow studio</small></div>
      </div>
      <div v-if="activeWorkflow" class="workflow-title min-w-0 px-6" @pointerdown.stop>
        <span class="label-mono">{{ workspaceMode === 'workflow' ? 'WORKFLOW' : 'MODEL EDITOR' }} / {{ activeWorkflow.revision.toString().padStart(2, '0') }}</span>
        <input v-if="renamingWorkflow" ref="workflowNameInput" v-model="workflowNameDraft" class="workflow-title-input" type="text" @keydown.enter.prevent="commitRenameWorkflow" @keydown.esc.prevent="cancelRenameWorkflow" @blur="commitRenameWorkflow" />
        <template v-else-if="workspaceMode === 'workflow'">
          <div class="workflow-title-bar">
            <strong class="workflow-title-name truncate" title="Double-click to rename" @dblclick="startRenameWorkflow">{{ activeWorkflow.name }}</strong>
            <div class="workflow-button-group" :class="{ open: workflowSwitcherOpen }">
              <button type="button" class="wbg-label" :aria-expanded="workflowSwitcherOpen" @click="toggleWorkflowSwitcher">
                <span>Workflows</span>
                <svg class="chevron-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </button>
              <button type="button" class="wbg-new" :disabled="busy" @click="createWorkflow">New</button>
            </div>
          </div>
          <div v-if="workflowSwitcherOpen" class="workflow-switcher-panel">
            <div class="workflow-switcher-head"><span>WORKFLOWS · {{ workflows.length }}</span></div>
            <button class="workflow-import-button" :class="{ dragging: workflowImportDragging }" type="button" :disabled="busy" @click="workflowImportInput.click()" @dragover="onWorkflowImportDragOver" @dragleave="onWorkflowImportDragLeave" @drop="onWorkflowImportDrop">{{ workflowImportDragging ? 'Drop to import' : 'Import JSON' }}</button>
            <div class="workflow-switcher-list">
              <button v-for="workflow in workflows" :key="workflow.id" class="workflow-list-item" :class="{ active: activeWorkflow?.id === workflow.id }" @click="openWorkflow(workflow.id)" @contextmenu="openWorkflowMenu($event, workflow)">
                <span>{{ workflow.name }}</span><small>{{ workflow.nodeCount }} nodes · v{{ workflow.revision }}</small>
              </button>
            </div>
            <p class="workflow-switcher-note">Right-click a workflow for export, duplicate, or delete.</p>
            <input ref="workflowImportInput" class="file-input" type="file" accept="application/json,.json" @change="importWorkflow" />
          </div>
        </template>
        <strong v-else class="block mt-[3px] text-sm truncate">{{ activeWorkflow.name }}</strong>
      </div>
      <div class="topbar-actions flex items-center gap-2 pr-4">
        <div v-if="workspaceMode === 'workflow'" class="workspace-view-switch" role="group" aria-label="Workspace view">
          <button type="button" :class="{ active: canvasView === 'canvas' }" :aria-pressed="canvasView === 'canvas'" title="Workflow canvas" @click="canvasView = 'canvas'"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="5.2" height="5.2" rx="1.2" /><rect x="8.8" y="2" width="5.2" height="5.2" rx="1.2" /><rect x="2" y="8.8" width="5.2" height="5.2" rx="1.2" /><rect x="8.8" y="8.8" width="5.2" height="5.2" rx="1.2" /></svg><span>Canvas</span></button>
          <button type="button" :class="{ active: canvasView === 'assets' }" :aria-pressed="canvasView === 'assets'" title="Asset library" @click="canvasView = 'assets'"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3.5" width="9" height="7" rx="1.4" /><rect x="5" y="6" width="9" height="7" rx="1.4" opacity=".5" /></svg><span>Assets</span></button>
        </div>
        <span class="save-state w-[15ch] truncate text-right text-text-muted font-mono text-[9px]">{{ savedState }}</span>
        <div class="theme-switcher" aria-label="Theme">
          <button v-for="option in ['light', 'dark', 'system']" :key="option" :class="{ active: theme === option }" :aria-pressed="theme === option" @click="setTheme(option)">{{ option }}</button>
        </div>
      </div>
    </header>

    <div v-if="workflowMenu" class="workflow-menu" :style="{ left: `${workflowMenu.left}px`, top: `${workflowMenu.top}px` }" @pointerdown.stop>
      <button type="button" @click="runWorkflowMenuAction(exportWorkflow)">Export JSON</button>
      <button type="button" @click="runWorkflowMenuAction(duplicateWorkflow)">Duplicate</button>
      <button class="danger" type="button" @click="runWorkflowMenuAction(deleteWorkflow)">Delete</button>
    </div>

    <section v-if="workspaceMode === 'workflow'" class="workspace">
      <section class="chat-panel bg-bg-panel border-r border-line">
        <header><div><span>WORKFLOW COPILOT</span><b>DeepSeek tool-calling agent</b></div><i /></header>
        <div class="message-list">
          <article v-for="message in messages" :key="message.id" class="message" :class="[message.role, { pending: message.pending }]">
            <span>{{ message.role === 'assistant' ? 'FORGE' : 'YOU' }}</span>
            <template v-if="message.role === 'assistant'">
              <div v-if="message.pending" class="thinking-progress"><b>Thinking</b><span>{{ message.progress.at(-1)?.label || 'Preparing workflow agent' }}</span></div>
              <details v-else-if="message.progress?.length" class="thought-process"><summary>Thought process <small>Tool activity</small></summary><span v-for="(event, index) in message.progress" :key="`${event.label}-${index}`">{{ event.label }}</span></details>
              <div v-if="message.content" class="message-content" v-html="renderAssistantMarkdown(message.content)" />
              <section v-if="message.request" class="user-selection">
                <p>{{ message.request.prompt }}</p>
                <small>Select {{ message.request.min === message.request.max ? message.request.min : `${message.request.min}–${message.request.max}` }} option{{ message.request.max === 1 ? '' : 's' }}.</small>
                <div class="user-selection-options">
                  <button v-for="option in message.request.options" :key="option.id" type="button" :class="{ selected: selectedOptionIds(message).includes(option.id) }" :disabled="Boolean(message.selection) || message.pending || continuingTaskId === message.taskId" @click="toggleSelectedOption(message, option.id)">{{ option.label }}</button>
                </div>
                <span v-if="message.selection" class="user-selection-answered">Answered</span>
                <button v-else class="user-selection-submit" type="button" :disabled="!canContinueSelection(message) || message.pending || continuingTaskId === message.taskId" @click="continueTask(message)">{{ continuingTaskId === message.taskId ? 'Continuing…' : 'Continue' }}</button>
              </section>
            </template>
            <p v-else>{{ message.content }}</p>
          </article>
        </div>
        <p v-if="error" class="error-message">{{ error }}</p>
        <form class="composer" @submit.prevent="sendMessage">
          <EditorContent :editor="composer" />
          <input ref="composerFileInput" class="file-input" type="file" multiple @change="addComposerFiles" />
          <div class="composer-actions"><button class="composer-attach-button" type="button" title="Attach files" @click="openComposerFilePicker">Attach</button><span>⌘ ENTER TO SEND</span><button :disabled="busy || !composerHasContent">Send ↗</button></div>
        </form>
      </section>

      <section class="canvas-panel bg-bg-secondary" @pointerdown.capture="selectCanvasEdge" @pointerdown="closeContextMenu">
        <div class="canvas-toolbar">
          <div><span>{{ canvasView === 'assets' ? 'ASSET LIBRARY' : 'CANVAS' }}</span><b v-if="canvasView === 'assets'">{{ assetLibrary.total }} assets · {{ assetLibrary.reference.length }} reference · {{ assetLibrary.images.length }} 2D · {{ assetLibrary.models.length }} 3D</b><b v-else>{{ nodes.length }} nodes · {{ edges.length }} connections · {{ selectedCount }} selected</b></div>
          <div><div class="canvas-view-switch" role="group" aria-label="Canvas view"><button type="button" :class="{ active: canvasView === 'canvas' }" :aria-pressed="canvasView === 'canvas'" title="Workflow canvas" @click="canvasView = 'canvas'"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="5.2" height="5.2" rx="1.2" /><rect x="8.8" y="2" width="5.2" height="5.2" rx="1.2" /><rect x="2" y="8.8" width="5.2" height="5.2" rx="1.2" /><rect x="8.8" y="8.8" width="5.2" height="5.2" rx="1.2" /></svg><span>Canvas</span></button><button type="button" :class="{ active: canvasView === 'assets' }" :aria-pressed="canvasView === 'assets'" title="Asset library" @click="canvasView = 'assets'"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3.5" width="9" height="7" rx="1.4" /><rect x="5" y="6" width="9" height="7" rx="1.4" opacity=".5" /></svg><span>Assets</span></button></div><template v-if="canvasView === 'canvas'"><div class="canvas-mode-switch" role="group" aria-label="Canvas interaction mode"><button type="button" :class="{ active: canvasMode === 'select' }" :aria-pressed="canvasMode === 'select'" title="Select and marquee" @click="canvasMode = 'select'"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 1.8 12.3 9l-4.1.7 2.2 3.7-2.1 1.2-2.1-3.7L3 13.5Z" /></svg><span>Select</span></button><button type="button" :class="{ active: canvasMode === 'move' }" :aria-pressed="canvasMode === 'move'" title="Move canvas" @click="canvasMode = 'move'"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.8 7V3.4a1 1 0 0 1 2 0V6h.4V2.8a1 1 0 0 1 2 0V6h.4V4a1 1 0 0 1 2 0v4.5l.5-.8a1 1 0 0 1 1.7 1l-2 3.5a3.3 3.3 0 0 1-2.9 1.7H8.3a3.3 3.3 0 0 1-2.8-1.6L3.2 8.5a1 1 0 0 1 1.7-1Z" /></svg><span>Move</span></button></div><div class="node-menu"><button class="add-node-button" :disabled="!activeWorkflow" @click="nodeMenuContext = null; nodeMenuOpen = !nodeMenuOpen">+ Add node</button><div v-if="nodeMenuOpen && !nodeMenuContext" class="node-menu-popover canvas-node-menu" @pointerdown.stop>
            <template v-for="category in nodeCategories" :key="category">
              <strong v-if="catalogForMenu().some((item) => item.category === category)">{{ category }}</strong>
              <button v-for="item in catalogForMenu().filter((item) => item.category === category)" :key="item.type" type="button" draggable="true" @dragstart="startNodeDrag($event, item.type)" @click="selectNodeType(item.type)">
                <span>{{ item.label }}</span><small>{{ item.description }}</small>
              </button>
            </template>
          </div></div><button :disabled="!activeWorkflow" @click="addNode('frame')">Section</button><button :disabled="!activeWorkflow" @click="addNode('generate-model')">Gen HD Model</button><button @click="fitView({ padding: .18, duration: 400 })">Fit</button><button :disabled="busy || saving || !nodes.length" @click="autoLayout">Auto layout</button></template><button class="run-button" :disabled="busy || isRunning || !activeWorkflow || !hasSelectedNode" @click="runWorkflow()">{{ isRunning ? 'Running current workflow…' : 'Run current workflow' }}</button></div>
        </div>
        <div v-if="nodeMenuOpen && nodeMenuContext" ref="contextMenu" class="node-menu-popover canvas-node-menu contextual" :class="{ 'selection-menu': nodeMenuContext.kind === 'selection' }" :style="{ left: `${nodeMenuContext.left}px`, top: `${nodeMenuContext.top}px`, maxWidth: `${nodeMenuContext.maxWidth}px`, maxHeight: `${nodeMenuContext.maxHeight}px` }" @pointerdown.stop>
          <template v-if="nodeMenuContext.kind === 'selection'">
             <strong>Selection</strong>
             <button type="button" :disabled="!canFrameSelection" @click="runContextMenuAction(makeSelectionFrame)"><span>Make as a section</span></button>
             <button type="button" :disabled="!canDissolveSelection" @click="runContextMenuAction(dissolveSelectedFrames)"><span>Dissolve section</span></button>
             <button type="button" @click="runContextMenuAction(createWorkflowFromSelection)"><span>Create workflow</span></button>
             <button type="button" @click="runContextMenuAction(copySelected)"><span>Copy</span></button>
             <button type="button" :disabled="!clipboardFragment" @click="runContextMenuAction(pasteFragment)"><span>Paste</span></button>
             <button type="button" @click="runContextMenuAction(duplicateSelected)"><span>Duplicate selected</span></button>
            <button type="button" @click="runContextMenuAction(deleteSelected)"><span>Delete</span></button>
           </template>
           <template v-else>
             <strong>Canvas</strong>
             <button type="button" :disabled="!clipboardFragment" @click="runContextMenuAction(pasteFragment)"><span>Paste</span></button>
             <template v-for="category in nodeCategories" :key="category">
              <strong v-if="catalogForMenu().some((item) => item.category === category)">{{ category }}</strong>
              <button v-for="item in catalogForMenu().filter((item) => item.category === category)" :key="item.type" type="button" draggable="true" @dragstart="startNodeDrag($event, item.type)" @click="selectNodeType(item.type)">
                <span>{{ item.label }}</span><small>{{ item.description }}</small>
              </button>
            </template>
            <small v-if="!catalogForMenu().length" class="node-menu-empty">No compatible node types</small>
          </template>
        </div>
        <VueFlow v-show="canvasView === 'canvas'" v-model:nodes="nodes" v-model:edges="edges" :class="['flow-canvas', `canvas-mode-${canvasMode}`]" :default-edge-options="edgeDefaults" :delete-key-code="null" :is-valid-connection="isValidConnection" :min-zoom=".08" :max-zoom="3.5" :snap-to-grid="false" :pan-on-scroll="true" :zoom-on-scroll="false" :zoom-activation-key-code="null" :pan-on-drag="panOnDrag" :selection-key-code="canvasMode === 'select' ? true : null" :selection-mode="SelectionMode.Partial" :multi-selection-key-code="'Shift'" fit-view-on-init @dragover="onCanvasDragOver" @drop="onCanvasDrop" @pane-context-menu="onPaneContextMenu" @node-context-menu="onNodeContextMenu" @selection-context-menu="onSelectionContextMenu" @connect="onConnect" @connect-start="onConnectStart" @connect-end="onConnectEnd" @connect-cancel="onConnectCancel" @node-drag-start="onNodeDragStart" @node-drag-stop="onNodeDragStop" @selection-start="onSelectionStart" @selection-end="onSelectionEnd" @nodes-change="onElementsChange" @edges-change="onElementsChange">
          <template #node-frame="props"><FrameNode v-bind="props" :running="busy || isRunning" @update-name="updateNodeName(props.id, $event)" @run-workflow="runWorkflow()" /></template>
          <template #node-workflow="props"><WorkflowNode v-bind="props" :node-run="nodeRuns[props.id] || null" :run-id="run?.id || null" :inbound-type="inboundExportTarget(props.id)" :inbound-image="inboundImage(props.id)" :node-catalog="compatibleNodeTypes(props.data.workflowType)" @update-config="updateNodeConfig(props.id, $event)" @update-name="updateNodeName(props.id, $event)" @open-model-editor="openModelEditor(props.id)" @preview-image="openImagePreview" @add-next="addNode($event, props.id)" @run-workflow="runWorkflow($event, 'downstream')" @run-downstream="runWorkflow($event, 'downstream')" /></template>
          <Background :gap="24" :size="1.2" :pattern-color="resolvedTheme === 'dark' ? '#252b2c' : '#cdd2cf'" />
          <MiniMap position="bottom-right" :width="160" :height="100" :pannable="true" :zoomable="true" :mask-color="resolvedTheme === 'dark' ? 'rgba(10, 12, 12, .7)' : 'rgba(238, 241, 238, .72)'" :node-color="resolvedTheme === 'dark' ? '#606a63' : '#a6afa9'" :node-stroke-color="resolvedTheme === 'dark' ? '#929a94' : '#737d76'" :node-stroke-width="1" :node-border-radius="4" />
          <Controls position="bottom-right" />
        </VueFlow>
        <div v-if="canvasView === 'assets'" class="asset-library">
          <div v-if="!assetLibrary.total" class="asset-empty">
            <strong>No assets yet</strong>
            <span>References, generated 2D images and 3D models from this workflow collect here.</span>
          </div>
          <template v-else>
            <section v-for="rail in assetRails" :key="rail.key" class="asset-rail">
              <header class="asset-rail-header">
                <div><span>{{ rail.title }}</span><b>{{ rail.items.length }}</b></div>
                <div v-if="rail.items.length" class="asset-rail-nav">
                  <button type="button" aria-label="Scroll left" @click="scrollRail($event, -1)">‹</button>
                  <button type="button" aria-label="Scroll right" @click="scrollRail($event, 1)">›</button>
                </div>
              </header>
              <div v-if="rail.items.length" class="asset-rail-track">
                <article v-for="item in rail.items" :key="item.id" class="asset-card">
                  <button type="button" class="asset-card-thumb" @click="openImagePreview({ src: item.src, alt: item.label })"><img :src="item.src" :alt="item.label" loading="lazy" /></button>
                  <div class="asset-card-meta"><strong :title="item.label">{{ item.label }}</strong><span class="asset-card-badge">{{ rail.badge }}</span></div>
                  <button v-if="rail.key === 'models'" type="button" class="asset-card-open" title="Open in Model Editor" @click="openModelEditor(item.nodeId)">↗</button>
                </article>
              </div>
              <p v-else class="asset-rail-empty">No {{ rail.title.toLowerCase() }} yet</p>
            </section>
          </template>
        </div>
        <aside v-if="runDetails && runSummaryOpen" class="run-log-panel bg-bg-card border-t border-line-strong">
          <header><div><span>RUN LOG</span><b>{{ runDetails.id }} · {{ runDetails.completed }}/{{ runDetails.total }} steps · {{ formatDuration(runDetails.totalDurationMs) }}</b></div><button type="button" aria-label="Close run log" @click="runSummaryOpen = false">×</button></header>
          <div class="run-log-steps">
            <article v-for="step in runDetails.steps" :key="step.id" class="run-log-step" :class="step.status"><i /><div><strong>{{ step.label }}</strong><small>{{ step.message }}</small></div><span>{{ step.status }}</span><b>{{ step.durationMs === null ? 'Pending' : formatDuration(step.durationMs) }}</b></article>
          </div>
        </aside>
        <footer><div class="run-status"><span><i />{{ runSummary }}</span><button v-if="runDetails" type="button" :aria-expanded="runSummaryOpen" @click="runSummaryOpen = !runSummaryOpen">{{ runSummaryOpen ? 'Hide logs' : 'Logs' }} <b>{{ runSummaryOpen ? '↓' : '↑' }}</b></button></div><span>Click or drag a node from Add node · Drop a connection on empty canvas to create a compatible node · Press / to add</span></footer>
      </section>
    </section>
    <ModelEditor v-else-if="modelEditorNode" :node="modelEditorNode" @back="closeModelEditor" @update-config="updateNodeConfig(modelEditorNode.id, $event)" />
    <Teleport to="body">
      <div v-if="imagePreview" class="image-preview-backdrop" role="dialog" aria-modal="true" :aria-label="imagePreview.alt" @click.self="closeImagePreview">
        <button type="button" class="image-preview-close" aria-label="Close image preview" @click="closeImagePreview">×</button>
        <img class="image-preview-image" :src="imagePreview.src" :alt="imagePreview.alt" />
      </div>
    </Teleport>
  </main>
</template>
