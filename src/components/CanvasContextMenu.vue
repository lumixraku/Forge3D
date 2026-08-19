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
  'create-canvas': []
  copy: []
  paste: []
  duplicate: []
  delete: []
  'select-node-type': [type: string]
  'drag-node-type': [payload: { event: DragEvent; type: string }]
}>()
</script>

<template>
  <div class="forge:fixed forge:left-0 forge:top-0 forge:z-30 forge:grid forge:max-h-[calc(100vh-16px)] forge:w-[236px] forge:gap-[3px] forge:overflow-y-auto forge:rounded-lg forge:border forge:border-line-strong forge:bg-bg-input forge:p-[5px] forge:shadow-popover forge:animate-[popover-in_.12s_ease-out] forge:[&>strong]:px-[9px] forge:[&>strong]:pb-1 forge:[&>strong]:pt-2 forge:[&>strong]:font-mono forge:[&>strong]:text-[8px] forge:[&>strong]:font-semibold forge:[&>strong]:uppercase forge:[&>strong]:tracking-[.12em] forge:[&>strong]:text-text-muted forge:[&>button]:grid forge:[&>button]:min-h-[34px] forge:[&>button]:w-full forge:[&>button]:rounded-md forge:[&>button]:border forge:[&>button]:border-transparent forge:[&>button]:bg-transparent forge:[&>button]:px-[9px] forge:[&>button]:py-[7px] forge:[&>button]:text-left forge:[&>button]:transition-colors forge:[&>button]:hover:border-line-strong forge:[&>button]:hover:bg-bg-input-hover forge:[&>button_span]:font-sans forge:[&>button_span]:text-[10px] forge:[&>button_span]:font-medium forge:[&>button_span]:text-text-primary" :style="{ left: `${context.left}px`, top: `${context.top}px`, maxWidth: `${context.maxWidth}px`, maxHeight: `${context.maxHeight}px` }" @pointerdown.stop>
    <template v-if="context.kind === 'selection'">
      <strong>Selection</strong>
      <button type="button" :disabled="!canFrameSelection" @click="emit('frame-selection')"><span>Make as a section</span></button>
      <button type="button" :disabled="!canDissolveSelection" @click="emit('dissolve-selection')"><span>Dissolve section</span></button>
      <button type="button" @click="emit('create-canvas')"><span>Create canvas</span></button>
      <button type="button" @click="emit('copy')"><span>Copy</span></button>
      <button type="button" :disabled="!hasClipboard" @click="emit('paste')"><span>Paste</span></button>
      <button type="button" @click="emit('duplicate')"><span>Duplicate selected</span></button>
      <button type="button" @click="emit('delete')"><span>Delete</span></button>
    </template>
    <template v-else>
      <strong>Canvas</strong>
      <button type="button" :disabled="!hasClipboard" @click="emit('paste')"><span>Paste</span></button>
      <NodeCatalogMenu :catalog="catalog" :categories="categories" @select="emit('select-node-type', $event)" @dragstart="emit('drag-node-type', $event)" />
      <small v-if="!catalog.length" class="forge:px-[9px] forge:py-3 forge:text-text-muted">No compatible node types</small>
    </template>
  </div>
</template>

<style scoped>
@keyframes popover-in { from { opacity: 0; transform: translateY(-3px) scale(.98); } }
</style>
