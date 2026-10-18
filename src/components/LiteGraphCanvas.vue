<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
const viewport = ref({ x: 0, y: 0, zoom: 1 })
const frameButton = ref(null)
const fileInput = ref(null)
let uploadNodeId = ''
let host = null
let observer = null
const consumedAssets = new WeakSet()

function refreshFrameButton() {
  frameButton.value = host?.selectedFrameButton() || null
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
  observer = new ResizeObserver(() => host?.resize())
  observer.observe(root.value)
  scanUploads()
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

watch(() => props.theme, (theme) => host?.setTheme(theme))
watch(() => props.canvasMode, (mode) => host?.setMode(mode))

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
    <button
      v-if="frameButton"
      class="forge3d-frame-run"
      type="button"
      :style="{ left: `${frameButton.left}px`, top: `${frameButton.top}px` }"
      @pointerdown.stop
      @click="sectionRunning(frameButton.id) ? emit('stop-run') : emit('run-section', frameButton.id)"
    >{{ sectionRunning(frameButton.id) ? 'Stop' : 'Run' }}</button>
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
.forge3d-frame-run { position: absolute; z-index: 5; height: 22px; padding: 0 8px; border: 1px solid var(--line-strong); border-radius: 6px; background: var(--bg-card); color: var(--acid); font: 600 10px/1 var(--font-mono, monospace); letter-spacing: .04em; text-transform: uppercase; }
.forge3d-litegraph-file { display: none; }
.forge3d-canvas-mode-frame .forge3d-litegraph-surface { cursor: crosshair; }
:deep(.graphdialog) { position: absolute; z-index: 20; display: flex; gap: 6px; align-items: center; padding: 8px; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--bg-card); color: var(--text-primary); }
:deep(.graphdialog .value) { min-width: 180px; border: 1px solid var(--line-strong); border-radius: 6px; background: var(--bg-input); color: inherit; padding: 4px 6px; }
:deep(.graphdialog button) { border: 1px solid var(--line-strong); border-radius: 6px; background: var(--bg-input); color: inherit; padding: 4px 8px; }
</style>
