<script setup lang="ts">
import NodeCatalogMenu from './NodeCatalogMenu.vue'

defineProps<{
  context: any
  catalog: any[]
  categories: string[]
  canFrameSelection: boolean
  canDissolveSelection: boolean
  hasClipboard: boolean
}>()
const emit = defineEmits<{
  'frame-selection': []
  'dissolve-selection': []
  rename: []
  'create-canvas': []
  copy: []
  cut: []
  paste: []
  duplicate: []
  delete: []
  'select-node-type': [type: string]
  'drag-node-type': [payload: { event: DragEvent; type: string }]
}>()
</script>

<template>
  <div class="forge:fixed forge:left-0 forge:top-0 forge:z-30 forge:grid forge:max-h-[calc(100vh-16px)] forge:w-[260px] forge:gap-1.5 forge:overflow-y-auto forge:rounded-xl forge:border forge:border-line-strong forge:bg-bg-input forge:p-2 forge:shadow-popover forge:animate-[popover-in_.12s_ease-out] forge:[&>strong]:px-2.5 forge:[&>strong]:pb-0.5 forge:[&>strong]:pt-2 forge:[&>strong]:text-[12px] forge:[&>strong]:font-semibold forge:[&>strong]:text-text-muted forge:[&>button]:w-full forge:[&>button]:rounded-lg forge:[&>button]:border-0 forge:[&>button]:bg-transparent forge:[&>button]:px-2.5 forge:[&>button]:py-2 forge:[&>button]:text-left forge:[&>button]:text-xs forge:[&>button]:text-text-primary forge:[&>button]:transition-colors forge:[&>button]:hover:bg-[color-mix(in_srgb,var(--acid)_6%,var(--bg-input))]" :style="{ left: `${context.left}px`, top: `${context.top}px`, maxWidth: `${context.maxWidth}px`, maxHeight: `${context.maxHeight}px` }" @pointerdown.stop>
    <template v-if="context.kind === 'selection'">
      <strong>Selection</strong>
      <button type="button" class="forge3d-flat" :disabled="!canFrameSelection" @click="emit('frame-selection')"><span>Make as a section</span></button>
      <button type="button" class="forge3d-flat" :disabled="!canDissolveSelection" @click="emit('dissolve-selection')"><span>Dissolve section</span></button>
      <button type="button" class="forge3d-flat" @click="emit('create-canvas')"><span>Create canvas</span></button>
      <button type="button" class="forge3d-flat" @click="emit('copy')"><span>Copy</span></button>
      <button type="button" class="forge3d-flat" @click="emit('cut')"><span>Cut</span></button>
      <button type="button" class="forge3d-flat" :disabled="!hasClipboard" @click="emit('paste')"><span>Paste</span></button>
      <button type="button" class="forge3d-flat" @click="emit('duplicate')"><span>Duplicate selected</span></button>
      <button type="button" class="forge3d-flat" @click="emit('delete')"><span>Delete</span></button>
    </template>
    <template v-else-if="context.kind === 'section'">
      <strong>Section</strong>
      <button type="button" class="forge3d-flat" @click="emit('rename')"><span>Rename</span></button>
      <button type="button" class="forge3d-flat" @click="emit('dissolve-selection')"><span>Dissolve section</span></button>
      <button type="button" class="forge3d-flat" @click="emit('copy')"><span>Copy</span></button>
      <button type="button" class="forge3d-flat" @click="emit('cut')"><span>Cut</span></button>
      <button type="button" class="forge3d-flat" @click="emit('duplicate')"><span>Duplicate</span></button>
      <button type="button" class="forge3d-flat" @click="emit('create-canvas')"><span>Create canvas</span></button>
      <button type="button" class="forge3d-flat" @click="emit('delete')"><span>Delete section</span></button>
    </template>
    <template v-else>
      <strong>Canvas</strong>
      <button type="button" class="forge3d-flat" :disabled="!hasClipboard" @click="emit('paste')"><span>Paste</span></button>
      <NodeCatalogMenu :catalog="catalog" :categories="categories" @select="emit('select-node-type', $event)" @dragstart="emit('drag-node-type', $event)" />
      <small v-if="!catalog.length" class="forge:px-[9px] forge:py-3 forge:text-text-muted">No compatible node types</small>
    </template>
  </div>
</template>

<style scoped>
@keyframes popover-in { from { opacity: 0; transform: translateY(-3px) scale(.98); } }
</style>
