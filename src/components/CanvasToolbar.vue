<script setup lang="ts">
import NodeCatalogMenu from './NodeCatalogMenu.vue'

defineProps<{
  canvasView: string
  canvasMode: string
  nodeCount: number
  edgeCount: number
  selectedCount: number
  assetLibrary: { total: number; reference: any[]; images: any[]; models: any[] }
  hasCanvas: boolean
  isRunning: boolean
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
  'toggle-frame-mode': []
  'fit-view': []
  'auto-layout': []
}>()
</script>

<template>
  <div class="forge:relative forge:z-[5] forge:flex forge:items-center forge:justify-between forge:bg-bg-secondary forge:px-4 forge:shadow-[inset_0_-1px_0_var(--line)] forge:[&>div:last-child]:flex forge:[&>div:last-child]:gap-[5px] forge:max-[1200px]:[&>div:first-child]:hidden">
    <div>
      <span class="forge:font-mono forge:text-[9px] forge:font-medium forge:tracking-[.12em] forge:text-text-muted">{{ canvasView === 'assets' ? 'ASSET LIBRARY' : 'CANVAS' }}</span>
      <b v-if="canvasView === 'assets'" class="forge:mt-[3px] forge:block forge:font-mono forge:text-[10px] forge:font-medium forge:text-text-secondary">{{ assetLibrary.total }} assets · {{ assetLibrary.reference.length }} reference · {{ assetLibrary.images.length }} 2D · {{ assetLibrary.models.length }} 3D</b>
      <b v-else class="forge:mt-[3px] forge:block forge:font-mono forge:text-[10px] forge:font-medium forge:text-text-secondary">{{ nodeCount }} nodes · {{ edgeCount }} connections · {{ selectedCount }} selected</b>
    </div>
    <div>
      <div class="forge:hidden forge:h-[30px] forge:overflow-hidden forge:rounded-md forge:border forge:border-line-subtle forge:bg-bg-input forge:p-0" role="group" aria-label="Canvas view">
        <button type="button" :class="{ 'forge3d-active': canvasView === 'canvas' }" :aria-pressed="canvasView === 'canvas'" title="Canvas canvas" @click="emit('update:canvasView', 'canvas')"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="5.2" height="5.2" rx="1.2" /><rect x="8.8" y="2" width="5.2" height="5.2" rx="1.2" /><rect x="2" y="8.8" width="5.2" height="5.2" rx="1.2" /><rect x="8.8" y="8.8" width="5.2" height="5.2" rx="1.2" /></svg><span>Canvas</span></button>
        <button type="button" :class="{ 'forge3d-active': canvasView === 'assets' }" :aria-pressed="canvasView === 'assets'" title="Asset library" @click="emit('update:canvasView', 'assets')"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3.5" width="9" height="7" rx="1.4" /><rect x="5" y="6" width="9" height="7" rx="1.4" opacity=".5" /></svg><span>Assets</span></button>
      </div>
      <template v-if="canvasView === 'canvas'">
        <div class="forge:flex forge:h-[30px] forge:overflow-hidden forge:rounded-md forge:border forge:border-line-subtle forge:bg-bg-input forge:p-0 forge:[&_button]:flex forge:[&_button]:h-full forge:[&_button]:min-w-[58px] forge:[&_button]:items-center forge:[&_button]:justify-center forge:[&_button]:gap-[5px] forge:[&_button]:border-0 forge:[&_button]:bg-transparent forge:[&_button]:px-[11px] forge:[&_button]:text-text-muted forge:[&_button]:hover:bg-bg-input-hover forge:[&_button]:hover:text-acid forge:[&_button:first-child]:border-r forge:[&_button:first-child]:border-line-subtle forge:[&_button.forge3d-active]:bg-[color-mix(in_srgb,var(--acid)_12%,var(--bg-input))] forge:[&_button.forge3d-active]:text-acid forge:[&_svg]:size-3 forge:[&_svg]:fill-current forge:[&_span]:font-mono forge:[&_span]:text-[9px] forge:[&_span]:font-semibold forge:[&_span]:uppercase forge:[&_span]:tracking-[.04em]" role="group" aria-label="Canvas interaction mode">
          <button type="button" :class="{ 'forge3d-active': canvasMode === 'select' }" :aria-pressed="canvasMode === 'select'" title="Select and marquee" @click="emit('update:canvasMode', 'select')"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 1.8 12.3 9l-4.1.7 2.2 3.7-2.1 1.2-2.1-3.7L3 13.5Z" /></svg><span>Select</span></button>
          <button type="button" :class="{ 'forge3d-active': canvasMode === 'move' }" :aria-pressed="canvasMode === 'move'" title="Move canvas" @click="emit('update:canvasMode', 'move')"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.8 7V3.4a1 1 0 0 1 2 0V6h.4V2.8a1 1 0 0 1 2 0V6h.4V4a1 1 0 0 1 2 0v4.5l.5-.8a1 1 0 0 1 1.7 1l-2 3.5a3.3 3.3 0 0 1-2.9 1.7H8.3a3.3 3.3 0 0 1-2.8-1.6L3.2 8.5a1 1 0 0 1 1.7-1Z" /></svg><span>Move</span></button>
        </div>
        <div class="forge:relative">
          <button class="forge:h-[30px] forge:min-w-[30px] forge:rounded-md forge:border forge:border-[color-mix(in_srgb,var(--acid)_60%,var(--line-subtle))] forge:bg-bg-input forge:px-[9px] forge:font-mono forge:text-[10px] forge:font-medium forge:text-acid forge:transition-colors forge:hover:bg-bg-input-hover" :disabled="!hasCanvas" @click="emit('toggle-menu')">+ Add node</button>
          <div v-if="menuOpen" class="forge:absolute forge:left-0 forge:top-[calc(100%+8px)] forge:z-30 forge:grid forge:max-h-[min(510px,calc(100vh-180px))] forge:w-[236px] forge:gap-[3px] forge:overflow-y-auto forge:rounded-lg forge:border forge:border-line-strong forge:bg-bg-input forge:p-[5px] forge:shadow-popover forge:animate-[popover-in_.12s_ease-out]" @pointerdown.stop>
            <NodeCatalogMenu :catalog="catalog" :categories="categories" @select="emit('select-node-type', $event)" @dragstart="emit('drag-node-type', $event)" />
          </div>
        </div>
        <button class="forge:h-[30px] forge:min-w-[30px] forge:rounded-md forge:border forge:border-line-subtle forge:bg-bg-input forge:px-[9px] forge:font-mono forge:text-[10px] forge:font-medium forge:text-text-muted forge:transition-colors forge:hover:border-line-strong forge:hover:bg-bg-input-hover forge:hover:text-acid forge:aria-pressed:border-acid forge:aria-pressed:bg-[color-mix(in_srgb,var(--acid)_12%,var(--bg-input))] forge:aria-pressed:text-acid" :disabled="!hasCanvas" :aria-pressed="canvasMode === 'frame'" title="Draw a section on the canvas" @click="emit('toggle-frame-mode')">Section</button>
        <button class="forge:h-[30px] forge:min-w-[30px] forge:rounded-md forge:border forge:border-line-subtle forge:bg-bg-input forge:px-[9px] forge:font-mono forge:text-[10px] forge:font-medium forge:text-text-muted forge:transition-colors forge:hover:border-line-strong forge:hover:bg-bg-input-hover forge:hover:text-acid" @click="emit('fit-view')">Fit</button>
        <button class="forge:h-[30px] forge:min-w-[30px] forge:rounded-md forge:border forge:border-line-subtle forge:bg-bg-input forge:px-[9px] forge:font-mono forge:text-[10px] forge:font-medium forge:text-text-muted forge:transition-colors forge:hover:border-line-strong forge:hover:bg-bg-input-hover forge:hover:text-acid" :disabled="!nodeCount" @click="emit('auto-layout')">Auto layout</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
@keyframes popover-in { from { opacity: 0; transform: translateY(-3px) scale(.98); } }
</style>
