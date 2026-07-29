<script setup lang="ts">
import NodeCatalogMenu from './NodeCatalogMenu.vue'

defineProps<{
  canvasView: string
  canvasMode: string
  nodeCount: number
  edgeCount: number
  selectedCount: number
  assetLibrary: { total: number; reference: any[]; images: any[]; models: any[] }
  hasWorkflow: boolean
  busy: boolean
  saving: boolean
  isRunning: boolean
  hasSelectedNode: boolean
  menuOpen: boolean
  catalog: any[]
  categories: string[]
}>()
const emit = defineEmits<{
  'update:canvasView': [view: string]
  'update:canvasMode': [mode: string]
  'toggle-menu': []
  'select-node-type': [type: string]
  'drag-node-type': [payload: { event: DragEvent; type: string }]
  'add-frame': []
  'fit-view': []
  'auto-layout': []
  run: []
}>()
</script>

<template>
  <div class="canvas-toolbar">
    <div>
      <span>{{ canvasView === 'assets' ? 'ASSET LIBRARY' : 'CANVAS' }}</span>
      <b v-if="canvasView === 'assets'">{{ assetLibrary.total }} assets · {{ assetLibrary.reference.length }} reference · {{ assetLibrary.images.length }} 2D · {{ assetLibrary.models.length }} 3D</b>
      <b v-else>{{ nodeCount }} nodes · {{ edgeCount }} connections · {{ selectedCount }} selected</b>
    </div>
    <div>
      <div class="canvas-view-switch" role="group" aria-label="Canvas view">
        <button type="button" :class="{ active: canvasView === 'canvas' }" :aria-pressed="canvasView === 'canvas'" title="Workflow canvas" @click="emit('update:canvasView', 'canvas')"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="5.2" height="5.2" rx="1.2" /><rect x="8.8" y="2" width="5.2" height="5.2" rx="1.2" /><rect x="2" y="8.8" width="5.2" height="5.2" rx="1.2" /><rect x="8.8" y="8.8" width="5.2" height="5.2" rx="1.2" /></svg><span>Canvas</span></button>
        <button type="button" :class="{ active: canvasView === 'assets' }" :aria-pressed="canvasView === 'assets'" title="Asset library" @click="emit('update:canvasView', 'assets')"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3.5" width="9" height="7" rx="1.4" /><rect x="5" y="6" width="9" height="7" rx="1.4" opacity=".5" /></svg><span>Assets</span></button>
      </div>
      <template v-if="canvasView === 'canvas'">
        <div class="canvas-mode-switch" role="group" aria-label="Canvas interaction mode">
          <button type="button" :class="{ active: canvasMode === 'select' }" :aria-pressed="canvasMode === 'select'" title="Select and marquee" @click="emit('update:canvasMode', 'select')"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 1.8 12.3 9l-4.1.7 2.2 3.7-2.1 1.2-2.1-3.7L3 13.5Z" /></svg><span>Select</span></button>
          <button type="button" :class="{ active: canvasMode === 'move' }" :aria-pressed="canvasMode === 'move'" title="Move canvas" @click="emit('update:canvasMode', 'move')"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.8 7V3.4a1 1 0 0 1 2 0V6h.4V2.8a1 1 0 0 1 2 0V6h.4V4a1 1 0 0 1 2 0v4.5l.5-.8a1 1 0 0 1 1.7 1l-2 3.5a3.3 3.3 0 0 1-2.9 1.7H8.3a3.3 3.3 0 0 1-2.8-1.6L3.2 8.5a1 1 0 0 1 1.7-1Z" /></svg><span>Move</span></button>
        </div>
        <div class="node-menu">
          <button class="add-node-button" :disabled="!hasWorkflow" @click="emit('toggle-menu')">+ Add node</button>
          <div v-if="menuOpen" class="node-menu-popover canvas-node-menu" @pointerdown.stop>
            <NodeCatalogMenu :catalog="catalog" :categories="categories" @select="emit('select-node-type', $event)" @dragstart="emit('drag-node-type', $event)" />
          </div>
        </div>
        <button :disabled="!hasWorkflow" @click="emit('add-frame')">Section</button>
        <button @click="emit('fit-view')">Fit</button>
        <button :disabled="busy || saving || !nodeCount" @click="emit('auto-layout')">Auto layout</button>
      </template>
      <button class="run-button" :disabled="busy || isRunning || !hasWorkflow || !hasSelectedNode" @click="emit('run')">{{ isRunning ? 'Running current workflow…' : 'Run current workflow' }}</button>
    </div>
  </div>
</template>
