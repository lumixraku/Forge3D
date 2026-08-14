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
  busy: boolean
  saving: boolean
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
  'add-frame': []
  'fit-view': []
  'auto-layout': []
}>()
</script>

<template>
  <div class="relative z-[5] flex items-center justify-between bg-bg-secondary px-4 shadow-[inset_0_-1px_0_var(--line)] [&>div:last-child]:flex [&>div:last-child]:gap-[5px] max-[1200px]:[&>div:first-child]:hidden">
    <div>
      <span class="font-mono text-[9px] font-medium tracking-[.12em] text-text-muted">{{ canvasView === 'assets' ? 'ASSET LIBRARY' : 'CANVAS' }}</span>
      <b v-if="canvasView === 'assets'" class="mt-[3px] block font-mono text-[10px] font-medium text-text-secondary">{{ assetLibrary.total }} assets · {{ assetLibrary.reference.length }} reference · {{ assetLibrary.images.length }} 2D · {{ assetLibrary.models.length }} 3D</b>
      <b v-else class="mt-[3px] block font-mono text-[10px] font-medium text-text-secondary">{{ nodeCount }} nodes · {{ edgeCount }} connections · {{ selectedCount }} selected</b>
    </div>
    <div>
      <div class="hidden h-[30px] overflow-hidden rounded-md border border-line-subtle bg-bg-input p-0" role="group" aria-label="Canvas view">
        <button type="button" :class="{ active: canvasView === 'canvas' }" :aria-pressed="canvasView === 'canvas'" title="Canvas canvas" @click="emit('update:canvasView', 'canvas')"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="5.2" height="5.2" rx="1.2" /><rect x="8.8" y="2" width="5.2" height="5.2" rx="1.2" /><rect x="2" y="8.8" width="5.2" height="5.2" rx="1.2" /><rect x="8.8" y="8.8" width="5.2" height="5.2" rx="1.2" /></svg><span>Canvas</span></button>
        <button type="button" :class="{ active: canvasView === 'assets' }" :aria-pressed="canvasView === 'assets'" title="Asset library" @click="emit('update:canvasView', 'assets')"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3.5" width="9" height="7" rx="1.4" /><rect x="5" y="6" width="9" height="7" rx="1.4" opacity=".5" /></svg><span>Assets</span></button>
      </div>
      <template v-if="canvasView === 'canvas'">
        <div class="flex h-[30px] overflow-hidden rounded-md border border-line-subtle bg-bg-input p-0 [&_button]:flex [&_button]:h-full [&_button]:min-w-[58px] [&_button]:items-center [&_button]:justify-center [&_button]:gap-[5px] [&_button]:border-0 [&_button]:bg-transparent [&_button]:px-[11px] [&_button]:text-text-muted [&_button]:hover:bg-bg-input-hover [&_button]:hover:text-acid [&_button:first-child]:border-r [&_button:first-child]:border-line-subtle [&_button.active]:bg-[color-mix(in_srgb,var(--acid)_12%,var(--bg-input))] [&_button.active]:text-acid [&_svg]:size-3 [&_svg]:fill-current [&_span]:font-mono [&_span]:text-[9px] [&_span]:font-semibold [&_span]:uppercase [&_span]:tracking-[.04em]" role="group" aria-label="Canvas interaction mode">
          <button type="button" :class="{ active: canvasMode === 'select' }" :aria-pressed="canvasMode === 'select'" title="Select and marquee" @click="emit('update:canvasMode', 'select')"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 1.8 12.3 9l-4.1.7 2.2 3.7-2.1 1.2-2.1-3.7L3 13.5Z" /></svg><span>Select</span></button>
          <button type="button" :class="{ active: canvasMode === 'move' }" :aria-pressed="canvasMode === 'move'" title="Move canvas" @click="emit('update:canvasMode', 'move')"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.8 7V3.4a1 1 0 0 1 2 0V6h.4V2.8a1 1 0 0 1 2 0V6h.4V4a1 1 0 0 1 2 0v4.5l.5-.8a1 1 0 0 1 1.7 1l-2 3.5a3.3 3.3 0 0 1-2.9 1.7H8.3a3.3 3.3 0 0 1-2.8-1.6L3.2 8.5a1 1 0 0 1 1.7-1Z" /></svg><span>Move</span></button>
        </div>
        <div class="relative">
          <button class="h-[30px] min-w-[30px] rounded-md border border-[color-mix(in_srgb,var(--acid)_60%,var(--line-subtle))] bg-bg-input px-[9px] font-mono text-[10px] font-medium text-acid transition-colors hover:bg-bg-input-hover" :disabled="!hasCanvas" @click="emit('toggle-menu')">+ Add node</button>
          <div v-if="menuOpen" class="absolute left-0 top-[calc(100%+8px)] z-30 grid max-h-[min(510px,calc(100vh-180px))] w-[236px] gap-[3px] overflow-y-auto rounded-lg border border-line-strong bg-bg-input p-[5px] shadow-popover animate-[popover-in_.12s_ease-out]" @pointerdown.stop>
            <NodeCatalogMenu :catalog="catalog" :categories="categories" @select="emit('select-node-type', $event)" @dragstart="emit('drag-node-type', $event)" />
          </div>
        </div>
        <button class="h-[30px] min-w-[30px] rounded-md border border-line-subtle bg-bg-input px-[9px] font-mono text-[10px] font-medium text-text-muted transition-colors hover:border-line-strong hover:bg-bg-input-hover hover:text-acid" :disabled="!hasCanvas" @click="emit('add-frame')">Section</button>
        <button class="h-[30px] min-w-[30px] rounded-md border border-line-subtle bg-bg-input px-[9px] font-mono text-[10px] font-medium text-text-muted transition-colors hover:border-line-strong hover:bg-bg-input-hover hover:text-acid" @click="emit('fit-view')">Fit</button>
        <button class="h-[30px] min-w-[30px] rounded-md border border-line-subtle bg-bg-input px-[9px] font-mono text-[10px] font-medium text-text-muted transition-colors hover:border-line-strong hover:bg-bg-input-hover hover:text-acid" :disabled="busy || saving || !nodeCount" @click="emit('auto-layout')">Auto layout</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
@keyframes popover-in { from { opacity: 0; transform: translateY(-3px) scale(.98); } }
</style>
