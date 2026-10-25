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
  'toggle-tie-mode': []
  'fit-view': []
  'auto-layout': []
}>()
</script>

<template>
  <div class="forge:relative forge:z-[7] forge:row-start-3 forge:flex forge:min-h-0 forge:items-center forge:justify-between forge:gap-3 forge:border-t forge:border-line forge:bg-bg-secondary forge:px-[13px] forge:[&>div:last-child]:flex forge:[&>div:last-child]:items-center forge:[&>div:last-child]:gap-[5px]">
    <div class="forge:flex forge:h-full forge:min-w-0 forge:items-center forge:gap-[9px] forge:whitespace-nowrap forge:font-mono forge:text-[10px] forge:font-medium forge:leading-none forge:text-text-muted">
      <slot />
      <b v-if="canvasView === 'assets'" class="forge:block forge:max-[1200px]:hidden forge:font-mono forge:text-[10px] forge:font-medium forge:text-text-muted">{{ assetLibrary.total }} assets · {{ assetLibrary.reference.length }} reference · {{ assetLibrary.images.length }} 2D · {{ assetLibrary.models.length }} 3D</b>
      <b v-else class="forge:block forge:max-[1200px]:hidden forge:font-mono forge:text-[10px] forge:font-medium forge:text-text-muted">{{ nodeCount }} nodes · {{ edgeCount }} connections · {{ selectedCount }} selected</b>
    </div>
    <div>
      <template v-if="canvasView === 'canvas'">
        <div class="forge:flex forge:h-[28px] forge:items-center forge:gap-1 forge:rounded-full forge:border-0 forge:bg-[color-mix(in_srgb,var(--acid)_10%,var(--bg-input))] forge:p-1 forge3d-bare forge3d-flat forge:[&_button]:flex forge:[&_button]:h-full forge:[&_button]:min-w-[58px] forge:[&_button]:items-center forge:[&_button]:justify-center forge:[&_button]:gap-[5px] forge:[&_button]:border-0 forge:[&_button]:bg-transparent forge:[&_button]:[--btn-shadow:transparent] forge:[&_button]:px-[11px] forge:[&_button]:text-acid-dim forge:[&_button]:hover:bg-[color-mix(in_srgb,var(--acid)_16%,var(--bg-input))] forge:[&_button]:hover:text-acid forge:[&_button.forge3d-active]:bg-acid forge:[&_button.forge3d-active]:text-text-inverse forge:[&_button.forge3d-active]:shadow-[0_2px_0_0_var(--acid-dim,var(--acid))] forge:[&_svg]:size-3 forge:[&_svg]:fill-current forge:[&_span]:text-[11px] forge:[&_span]:font-semibold" role="group" aria-label="Canvas interaction mode">
          <button type="button" :class="{ 'forge3d-active': canvasMode === 'select' }" :aria-pressed="canvasMode === 'select'" title="Select and marquee (V)" @click="emit('update:canvasMode', 'select')"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 1.8 12.3 9l-4.1.7 2.2 3.7-2.1 1.2-2.1-3.7L3 13.5Z" /></svg><span>Select</span></button>
          <button type="button" :class="{ 'forge3d-active': canvasMode === 'move' }" :aria-pressed="canvasMode === 'move'" title="Move canvas (H)" @click="emit('update:canvasMode', 'move')"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.8 7V3.4a1 1 0 0 1 2 0V6h.4V2.8a1 1 0 0 1 2 0V6h.4V4a1 1 0 0 1 2 0v4.5l.5-.8a1 1 0 0 1 1.7 1l-2 3.5a3.3 3.3 0 0 1-2.9 1.7H8.3a3.3 3.3 0 0 1-2.8-1.6L3.2 8.5a1 1 0 0 1 1.7-1Z" /></svg><span>Move</span></button>
        </div>
        <div class="forge:relative">
          <button class="forge:[--btn-shadow:var(--acid-shadow)] forge:h-[26px] forge:min-w-[26px] forge:rounded-full forge:border forge:border-acid-line forge:bg-bg-input forge:px-[12px] forge:text-[12px] forge:font-medium forge:text-acid-dim forge:transition-colors forge:hover:border-acid forge:hover:text-acid" :disabled="!hasCanvas" @click="emit('toggle-menu')">+ Add node</button>
          <div v-if="menuOpen" class="forge:absolute forge:right-0 forge:bottom-[calc(100%+8px)] forge:z-30 forge:grid forge:max-h-[min(510px,calc(100vh-180px))] forge:w-[236px] forge:gap-[3px] forge:overflow-y-auto forge:rounded-lg forge:border forge:border-line-strong forge:bg-bg-input forge:p-[5px] forge:shadow-popover forge:animate-[popover-in_.12s_ease-out]" @pointerdown.stop>
            <NodeCatalogMenu :catalog="catalog" :categories="categories" @select="emit('select-node-type', $event)" @dragstart="emit('drag-node-type', $event)" />
          </div>
        </div>
        <button class="forge:[--btn-shadow:var(--acid-shadow)] forge:h-[26px] forge:min-w-[26px] forge:rounded-full forge:border forge:border-acid-line forge:bg-bg-input forge:px-[12px] forge:text-[12px] forge:font-medium forge:text-acid-dim forge:transition-colors forge:hover:border-acid forge:hover:bg-[color-mix(in_srgb,var(--acid)_10%,var(--bg-input))] forge:hover:text-acid forge:aria-pressed:border-acid forge:aria-pressed:bg-[color-mix(in_srgb,var(--acid)_12%,var(--bg-input))] forge:aria-pressed:text-acid" :disabled="!hasCanvas" :aria-pressed="canvasMode === 'frame'" title="Draw a section on the canvas" @click="emit('toggle-frame-mode')">Section</button>
        <button class="forge:[--btn-shadow:var(--acid-shadow)] forge:h-[26px] forge:min-w-[26px] forge:rounded-full forge:border forge:border-acid-line forge:bg-bg-input forge:px-[12px] forge:text-[12px] forge:font-medium forge:text-acid-dim forge:transition-colors forge:hover:border-acid forge:hover:bg-[color-mix(in_srgb,var(--acid)_10%,var(--bg-input))] forge:hover:text-acid forge:aria-pressed:border-acid forge:aria-pressed:bg-[color-mix(in_srgb,var(--acid)_12%,var(--bg-input))] forge:aria-pressed:text-acid" :disabled="!hasCanvas || !edgeCount" :aria-pressed="canvasMode === 'tie'" title="Cut across wires to tie them together" @click="emit('toggle-tie-mode')">Tie</button>
        <button class="forge:[--btn-shadow:var(--acid-shadow)] forge:h-[26px] forge:min-w-[26px] forge:rounded-full forge:border forge:border-acid-line forge:bg-bg-input forge:px-[12px] forge:text-[12px] forge:font-medium forge:text-acid-dim forge:transition-colors forge:hover:border-acid forge:hover:bg-[color-mix(in_srgb,var(--acid)_10%,var(--bg-input))] forge:hover:text-acid" @click="emit('fit-view')">Fit</button>
        <button class="forge:[--btn-shadow:var(--acid-shadow)] forge:h-[26px] forge:min-w-[26px] forge:rounded-full forge:border forge:border-acid-line forge:bg-bg-input forge:px-[12px] forge:text-[12px] forge:font-medium forge:text-acid-dim forge:transition-colors forge:hover:border-acid forge:hover:bg-[color-mix(in_srgb,var(--acid)_10%,var(--bg-input))] forge:hover:text-acid" :disabled="!nodeCount" @click="emit('auto-layout')">Auto layout</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
@keyframes popover-in { from { opacity: 0; transform: translateY(-3px) scale(.98); } }
</style>
