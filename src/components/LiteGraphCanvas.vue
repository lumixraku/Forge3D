<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createGraphHost } from '../litegraph-canvas'
import { createModelThumbnail } from '../model-thumbnail'

const props = defineProps({
  nodes: { type: Array, required: true },
  edges: { type: Array, required: true },
  nodeRuns: { type: Object, default: () => ({}) },
  missingParameters: { type: Object, default: () => ({}) },
  theme: { type: String, default: 'dark' },
  canvasMode: { type: String, default: 'select' },
  frameDrawRect: { type: Object, default: null },
  sectionRunning: { type: Function, default: () => false },
})

const emit = defineEmits([
  'update:nodes', 'update:edges', 'update-parameter', 'update-uploads', 'update-output', 'clear-upload', 'update-name',
  'drag-start', 'drag-stop', 'selection-start', 'selection-end',
  'connect-start', 'connect-end', 'node-context-menu', 'frame-context-menu', 'pane-context-menu', 'pane-click',
  'edge-click', 'preview-image', 'run-node', 'run-downstream', 'stop-run', 'open-model-editor', 'run-section',
  'viewport',
])

const root = ref(null)
const canvasEl = ref(null)
const mapEl = ref(null)
const viewport = ref({ x: 0, y: 0, zoom: 1 })
const frameButton = ref(null)
const nodeActions = ref([])
const uploadWells = ref([])
const renameField = ref(null)
const renameDraft = ref('')
const renameInput = ref(null)
const fileInput = ref(null)
let uploadNodeId = ''
let host = null
let observer = null
const consumedAssets = new WeakSet()

function refreshFrameButton() {
  frameButton.value = host?.selectedFrameButton() || null
  nodeActions.value = host?.actionChrome() || []
  uploadWells.value = host?.uploadWells() || []
  renameField.value = host?.renameField() || null
}

function commitRename() {
  const field = renameField.value
  if (!field) return
  const name = renameDraft.value.trim()
  const previous = field.value
  const id = field.id
  host?.closeRename()
  if (name && name !== previous) emit('update-name', { id, name })
}

function cancelRename() {
  host?.closeRename()
}

function onUploadWellDrop(event, well) {
  const file = event.dataTransfer?.files?.[0]
  if (file) uploadAsset(well.nodeId, file)
}

function onNodeAction(action) {
  host?.runNodeAction(action.nodeId, action.id)
}

onMounted(() => {
  host = createGraphHost(canvasEl.value, {
    onNodes: (nodes) => { emit('update:nodes', nodes); queueMicrotask(refreshFrameButton) },
    onEdges: (edges) => emit('update:edges', edges),
    onParameter: (id, key, value) => emit('update-parameter', { id, key, value }),
    onName: (id, name) => emit('update-name', { id, name }),
    onUpload: (id) => { uploadNodeId = id; fileInput.value?.click() },
    onClearUpload: (id) => emit('clear-upload', id),
    onOutput: (id, generatedAssets) => emit('update-output', { id, generatedAssets }),
    onRun: (id) => emit('run-node', id),
    onRunDownstream: (id) => emit('run-downstream', id),
    onStop: () => emit('stop-run'),
    onOpenModel: (id) => emit('open-model-editor', id),
    onPreview: (preview) => emit('preview-image', preview),
    onDragStart: () => emit('drag-start'),
    onDragStop: (payload) => emit('drag-stop', payload),
    onSelectionStart: () => emit('selection-start'),
    onSelectionEnd: () => emit('selection-end'),
    onConnectStart: (nodeId) => emit('connect-start', nodeId),
    onConnectEnd: (payload) => emit('connect-end', payload),
    onNodeContextMenu: (payload) => emit('node-context-menu', payload),
    onFrameContextMenu: (payload) => emit('frame-context-menu', payload),
    onPaneContextMenu: (event) => emit('pane-context-menu', event),
    onPaneClick: () => emit('pane-click'),
    onEdgeClick: (payload) => emit('edge-click', payload),
    onViewport: (next) => { viewport.value = next; emit('viewport', next); refreshFrameButton() },
  })
  host.setTheme(props.theme)
  host.setMode(props.canvasMode)
  host.sync(props.nodes, props.edges, props.nodeRuns, props.missingParameters)
  refreshFrameButton()
  observer = new ResizeObserver(() => { host?.resize(); drawMinimap() })
  observer.observe(root.value)
  scanUploads()
  drawMinimap()
})

onBeforeUnmount(() => {
  observer?.disconnect()
  host?.destroy()
  host = null
})

watch(() => [props.nodes, props.edges, props.nodeRuns, props.missingParameters], () => {
  host?.sync(props.nodes, props.edges, props.nodeRuns, props.missingParameters)
  refreshFrameButton()
  scanUploads()
}, { deep: true })

watch(() => renameField.value?.id, async (id) => {
  if (!id) return
  renameDraft.value = renameField.value.value
  await nextTick()
  const input = renameInput.value
  if (!input) return
  input.focus()
  const end = input.value.length
  input.setSelectionRange(end, end)
})

watch(() => props.theme, (theme) => { host?.setTheme(theme); drawMinimap() })
watch(() => props.canvasMode, (mode) => host?.setMode(mode))
watch(viewport, drawMinimap, { deep: true })
watch(() => props.nodes, drawMinimap, { deep: true })

const MAP_WIDTH = 220
const MAP_HEIGHT = 140
let mapLayout = null
let mapDragging = false

function absoluteOrigin(node, byId) {
  let x = node.position?.x || 0
  let y = node.position?.y || 0
  let parentId = node.parentNode
  const seen = new Set()
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

function minimapBoxes() {
  const byId = new Map(props.nodes.map((node) => [node.id, node]))
  return props.nodes.flatMap((node) => {
    const loose = node.type !== 'frame' && !node.parentNode
    if (node.type !== 'frame' && !loose) return []
    const origin = absoluteOrigin(node, byId)
    const width = Number(node.dimensions?.width || node.width || (node.type === 'frame' ? 900 : 250))
    const height = Number(node.dimensions?.height || node.height || (node.type === 'frame' ? 600 : 180))
    return [{ id: node.id, x: origin.x, y: origin.y, width, height, frame: node.type === 'frame', selected: Boolean(node.selected) }]
  })
}

function drawMinimap() {
  const map = mapEl.value
  const panel = root.value
  if (!map || !panel) return
  const boxes = minimapBoxes()
  const ratio = window.devicePixelRatio || 1
  if (map.width !== Math.round(MAP_WIDTH * ratio) || map.height !== Math.round(MAP_HEIGHT * ratio)) {
    map.width = Math.round(MAP_WIDTH * ratio)
    map.height = Math.round(MAP_HEIGHT * ratio)
  }
  const ctx = map.getContext('2d')
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  const style = getComputedStyle(panel)
  const acid = style.getPropertyValue('--acid').trim() || '#789800'
  const card = style.getPropertyValue('--bg-card').trim() || '#ffffff'
  const line = style.getPropertyValue('--line-strong').trim() || '#cbd1cd'
  ctx.clearRect(0, 0, MAP_WIDTH, MAP_HEIGHT)
  ctx.fillStyle = card
  ctx.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT)
  if (!boxes.length) {
    mapLayout = null
    return
  }
  const left = Math.min(...boxes.map((box) => box.x))
  const top = Math.min(...boxes.map((box) => box.y))
  const right = Math.max(...boxes.map((box) => box.x + box.width))
  const bottom = Math.max(...boxes.map((box) => box.y + box.height))
  const pad = 10
  const spanX = Math.max(1, right - left)
  const spanY = Math.max(1, bottom - top)
  const scale = Math.min((MAP_WIDTH - pad * 2) / spanX, (MAP_HEIGHT - pad * 2) / spanY)
  const ox = pad + (MAP_WIDTH - pad * 2 - spanX * scale) / 2
  const oy = pad + (MAP_HEIGHT - pad * 2 - spanY * scale) / 2
  mapLayout = { left, top, scale, ox, oy }
  for (const box of boxes) {
    const x = ox + (box.x - left) * scale
    const y = oy + (box.y - top) * scale
    const width = Math.max(1, box.width * scale)
    const height = Math.max(1, box.height * scale)
    ctx.fillStyle = box.frame ? 'rgba(109, 143, 120, 0.85)' : 'rgba(60, 74, 82, 0.7)'
    ctx.fillRect(x, y, width, height)
    if (box.selected) {
      ctx.strokeStyle = acid
      ctx.lineWidth = 1.5
      ctx.strokeRect(x - 0.5, y - 0.5, width + 1, height + 1)
    }
  }
  const zoom = viewport.value.zoom || 1
  const viewX = ox + ((-viewport.value.x / zoom) - left) * scale
  const viewY = oy + ((-viewport.value.y / zoom) - top) * scale
  const viewW = (panel.clientWidth / zoom) * scale
  const viewH = (panel.clientHeight / zoom) * scale
  ctx.fillStyle = 'rgba(120, 152, 0, 0.16)'
  ctx.fillRect(viewX, viewY, viewW, viewH)
  ctx.strokeStyle = acid
  ctx.lineWidth = 1.5
  ctx.strokeRect(viewX, viewY, viewW, viewH)
  ctx.strokeStyle = line
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, MAP_WIDTH - 1, MAP_HEIGHT - 1)
}

function graphPointFromMap(event) {
  if (!mapLayout || !mapEl.value) return null
  const rect = mapEl.value.getBoundingClientRect()
  const x = event.clientX - rect.left
  const y = event.clientY - rect.top
  return {
    x: mapLayout.left + (x - mapLayout.ox) / mapLayout.scale,
    y: mapLayout.top + (y - mapLayout.oy) / mapLayout.scale,
  }
}

function moveViewFromMap(event) {
  const point = graphPointFromMap(event)
  if (point) host?.centerOn(point.x, point.y)
}

function onMapPointerDown(event) {
  event.stopPropagation()
  event.preventDefault()
  mapDragging = true
  mapEl.value?.setPointerCapture(event.pointerId)
  moveViewFromMap(event)
}

function onMapPointerMove(event) {
  if (!mapDragging) return
  event.stopPropagation()
  moveViewFromMap(event)
}

function onMapPointerUp(event) {
  if (!mapDragging) return
  mapDragging = false
  event.stopPropagation()
}

function fitView(options) { host?.fitView(options) }
function screenToFlowCoordinate(point) { return host?.screenToFlowCoordinate(point) || { x: 0, y: 0 } }
function findNode(id) { return host?.findNode(id) || null }
defineExpose({ fitView, screenToFlowCoordinate, findNode, viewport })

function scanUploads() {
  for (const node of props.nodes) {
    const file = node.data?.initialAsset
    if (file instanceof File && !consumedAssets.has(file)) {
      consumedAssets.add(file)
      uploadAsset(node.id, file)
    }
  }
}

function onFilePicked(event) {
  const input = event.target
  const [file] = [...(input.files || [])]
  input.value = ''
  if (file && uploadNodeId) uploadAsset(uploadNodeId, file)
}

async function uploadAsset(id, file) {
  const node = props.nodes.find((item) => item.id === id)
  const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])
  const modelExtensions = new Set(['glb', 'gltf', 'fbx', 'usdz', 'obj', 'stl', '3mf'])
  const extension = file.name.split('.').pop()?.toLowerCase() || ''
  const isImage = allowedTypes.has(file.type) || /\.(jpe?g|png|webp)$/i.test(extension)
  const isModel = modelExtensions.has(extension)
  if ((!isImage && !isModel) || file.size > 100 * 1024 * 1024) return
  const response = await fetch('/api/assets', {
    method: 'POST',
    headers: { 'content-type': file.type || 'application/octet-stream', 'x-file-name': file.name },
    body: file,
  })
  const result = await response.json().catch(() => null)
  if (!response.ok || typeof result?.url !== 'string') return
  let thumbnailUrl = ''
  if (isModel && ['glb', 'gltf'].includes(extension)) {
    try {
      const thumbnail = await createModelThumbnail(file)
      const thumbnailResponse = await fetch('/api/assets', {
        method: 'POST',
        headers: { 'content-type': 'image/png', 'x-file-name': `${file.name}.thumbnail.png` },
        body: thumbnail,
      })
      const thumbnailResult = await thumbnailResponse.json().catch(() => null)
      if (thumbnailResponse.ok && typeof thumbnailResult?.url === 'string') thumbnailUrl = thumbnailResult.url
    } catch {
      // The model is still usable when the thumbnail render fails.
    }
  }
  const current = node?.data?.uploadAssets || {}
  emit('update-uploads', {
    id,
    uploadAssets: {
      ...current,
      reference: file.name,
      assetType: isModel ? 'model' : 'image',
      assetUrl: result.url,
      ...(isModel ? { modelUrl: result.url, ...(thumbnailUrl ? { thumbnailUrl } : {}) } : {}),
    },
  })
}
</script>

<template>
  <div ref="root" class="forge3d-litegraph forge3d-flow-canvas" :class="`forge3d-canvas-mode-${canvasMode}`">
    <canvas ref="canvasEl" class="forge3d-litegraph-surface" />
    <div v-if="frameDrawRect" class="forge3d-frame-draw-layer" :style="{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }">
      <div
        class="forge3d-frame-draw-rect"
        :style="{
          left: `${frameDrawRect.left}px`,
          top: `${frameDrawRect.top}px`,
          width: `${frameDrawRect.right - frameDrawRect.left}px`,
          height: `${frameDrawRect.bottom - frameDrawRect.top}px`,
          borderWidth: `${1 / viewport.zoom}px`,
          borderRadius: `${15 / viewport.zoom}px`,
        }"
      >
        <span class="forge3d-frame-draw-size" :style="{ transform: `translateY(${-6 / viewport.zoom}px) scale(${1 / viewport.zoom})` }">
          {{ Math.round(frameDrawRect.right - frameDrawRect.left) }} × {{ Math.round(frameDrawRect.bottom - frameDrawRect.top) }}
        </span>
      </div>
    </div>
    <div class="forge3d-node-actions" :style="{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }">
      <button
        v-for="well in uploadWells"
        :key="well.key"
        type="button"
        class="forge3d-upload-well"
        :style="{ left: `${well.x}px`, top: `${well.y}px`, width: `${well.w}px`, height: `${well.h}px` }"
        @pointerdown.stop
        @click.stop="onNodeAction({ nodeId: well.nodeId, id: 'upload' })"
        @dragover.prevent.stop
        @drop.prevent.stop="onUploadWellDrop($event, well)"
      >
        <strong>Drop or choose asset</strong>
        <small>JPG, PNG, WEBP or 3D model · max 100 MB</small>
      </button>
      <button
        v-for="action in nodeActions"
        :key="action.key"
        type="button"
        class="forge3d-node-action"
        :class="[action.kind === 'icon' ? 'forge3d-node-action-icon' : 'forge3d-node-action-text', action.icon === 'remove' ? 'forge3d-node-action-remove' : '']"
        :style="{ left: `${action.x}px`, top: `${action.y}px`, width: `${action.w}px`, height: `${action.h}px` }"
        :title="action.label"
        :aria-label="action.label"
        @pointerdown.stop
        @click.stop="onNodeAction(action)"
      >
        <svg v-if="action.icon === 'replace'" viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M13.2 8A5.2 5.2 0 1 1 11 3.6M13.2 2.2v3.2H10" /></svg>
        <svg v-else-if="action.icon === 'remove'" viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M3.2 4.2h9.6M6.2 4.2V3h3.6v1.2M4.4 4.2l.6 8.2h5.9l.6-8.2" /></svg>
        <svg v-else-if="action.icon === 'download'" viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M8 2.5v7M5.2 7.2 8 10l2.8-2.8M3.2 13.2h9.6" /></svg>
        <svg v-else-if="action.icon === 'model'" viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" d="m8 2.2 5 2.8v5.6l-5 2.8-5-2.8V5z" /><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" d="M3 5.1 8 8l5-2.9M8 8v5.4" /></svg>
        <span v-else>{{ action.label }}</span>
      </button>
      <form
        v-if="renameField"
        class="forge3d-node-rename"
        :style="{ left: `${renameField.x}px`, top: `${renameField.y}px`, width: `${renameField.w}px`, height: `${renameField.h}px` }"
        @submit.prevent="commitRename"
      >
        <input
          ref="renameInput"
          v-model="renameDraft"
          aria-label="Node name"
          spellcheck="false"
          :style="{ left: `${renameField.textX}px`, width: `calc(100% - ${renameField.textX}px)`, color: renameField.color }"
          @pointerdown.stop
          @keydown.stop
          @keydown.enter.prevent="commitRename"
          @keydown.esc.prevent="cancelRename"
          @blur="commitRename"
        />
      </form>
    </div>
    <button
      v-if="frameButton"
      class="forge3d-frame-run"
      type="button"
      :style="{ left: `${frameButton.left}px`, top: `${frameButton.top}px` }"
      @pointerdown.stop
      @click="sectionRunning(frameButton.id) ? emit('stop-run') : emit('run-section', frameButton.id)"
    >{{ sectionRunning(frameButton.id) ? 'Stop' : 'Run' }}</button>
    <canvas
      ref="mapEl"
      class="forge3d-minimap"
      width="220"
      height="140"
      aria-label="Canvas map"
      @pointerdown="onMapPointerDown"
      @pointermove="onMapPointerMove"
      @pointerup="onMapPointerUp"
      @pointercancel="onMapPointerUp"
      @contextmenu.prevent
    />
    <input ref="fileInput" class="forge3d-litegraph-file" type="file" accept="image/jpeg,image/png,image/webp,.glb,.gltf,.fbx,.usdz,.obj,.stl,.3mf" @change="onFilePicked" />
  </div>
</template>

<style scoped>
.forge3d-litegraph { position: relative; width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: hidden; background: var(--bg-primary); }
.forge3d-litegraph-surface { display: block; width: 100%; height: 100%; outline: none; }
.forge3d-litegraph :deep(canvas) { display: block; }
.forge3d-frame-draw-layer { position: absolute; inset: 0; z-index: 4; pointer-events: none; transform-origin: 0 0; }
.forge3d-frame-draw-rect { position: absolute; border-style: dashed; border-color: var(--acid); background: color-mix(in srgb, var(--acid) 5%, transparent); }
.forge3d-frame-draw-size { position: absolute; bottom: 100%; left: 0; transform-origin: bottom left; border-radius: 5px; background: color-mix(in srgb, var(--acid) 16%, var(--bg-input)); padding: 3px 6px; font-family: var(--font-mono, monospace); font-size: 10px; font-weight: 600; line-height: 1; color: var(--text-primary); white-space: nowrap; }
.forge3d-node-actions { position: absolute; inset: 0; z-index: 5; pointer-events: none; transform-origin: 0 0; }
.forge3d-upload-well { position: absolute; pointer-events: auto; display: grid; place-content: center; gap: 4px; margin: 0; padding: 12px; border: 1.5px dashed var(--line-strong); border-radius: 8px; background: var(--bg-input); color: var(--text-primary); text-align: center; cursor: pointer; }
.forge3d-upload-well:hover { border-color: var(--acid); background: color-mix(in srgb, var(--acid) 8%, var(--bg-input)); }
.forge3d-upload-well strong { font: 600 12px/1.2 var(--font-sans, sans-serif); }
.forge3d-upload-well small { font: 11px/1.3 var(--font-sans, sans-serif); color: var(--text-muted); }
.forge3d-node-action { position: absolute; pointer-events: auto; display: grid; place-items: center; margin: 0; padding: 0; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--bg-card); color: var(--text-primary); box-shadow: 0 1px 2px rgb(0 0 0 / 12%); cursor: pointer; }
.forge3d-node-action:hover { background: var(--bg-input); border-color: var(--node-accent, var(--acid)); }
.forge3d-node-action:focus-visible { outline: 2px solid var(--acid); outline-offset: 1px; }
.forge3d-node-action-icon svg { width: 16px; height: 16px; }
.forge3d-node-action-text { padding: 0 10px; font: 500 12px/1 var(--font-sans, sans-serif); white-space: nowrap; }
.forge3d-node-action-remove:hover { color: #c24545; border-color: #c24545; }
.forge3d-frame-run { position: absolute; z-index: 5; height: 22px; padding: 0 8px; border: 1px solid var(--line-strong); border-radius: 6px; background: var(--bg-card); color: var(--acid); font: 600 10px/1 var(--font-mono, monospace); letter-spacing: .04em; text-transform: uppercase; }
.forge3d-minimap { position: absolute; z-index: 6; right: 12px; bottom: 12px; width: 220px; height: 140px; border-radius: 8px; box-shadow: var(--shadow-md); cursor: pointer; touch-action: none; }
.forge3d-litegraph-file { display: none; }
.forge3d-canvas-mode-frame .forge3d-litegraph-surface { cursor: crosshair; }
.forge3d-node-rename { position: absolute; pointer-events: none; margin: 0; padding: 0; background: transparent; border: 0; }
.forge3d-node-rename input { position: absolute; pointer-events: auto; top: 0; height: 100%; margin: 0; padding: 0; border: 0; background: transparent; font: 14px Arial; line-height: 14px; outline: none; caret-color: #fff; box-sizing: border-box; }
.forge3d-node-rename input::selection { background: rgb(255 255 255 / 22%); }
</style>
