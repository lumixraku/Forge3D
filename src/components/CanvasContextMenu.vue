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
  <div class="fixed left-0 top-0 z-30 grid max-h-[calc(100vh-16px)] w-[236px] gap-[3px] overflow-y-auto rounded-lg border border-line-strong bg-bg-input p-[5px] shadow-popover animate-[popover-in_.12s_ease-out] [&>strong]:px-[9px] [&>strong]:pb-1 [&>strong]:pt-2 [&>strong]:font-mono [&>strong]:text-[8px] [&>strong]:font-semibold [&>strong]:uppercase [&>strong]:tracking-[.12em] [&>strong]:text-text-muted [&>button]:grid [&>button]:min-h-[34px] [&>button]:w-full [&>button]:rounded-md [&>button]:border [&>button]:border-transparent [&>button]:bg-transparent [&>button]:px-[9px] [&>button]:py-[7px] [&>button]:text-left [&>button]:transition-colors [&>button]:hover:border-line-strong [&>button]:hover:bg-bg-input-hover [&>button_span]:font-sans [&>button_span]:text-[10px] [&>button_span]:font-medium [&>button_span]:text-text-primary" :style="{ left: `${context.left}px`, top: `${context.top}px`, maxWidth: `${context.maxWidth}px`, maxHeight: `${context.maxHeight}px` }" @pointerdown.stop>
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
      <small v-if="!catalog.length" class="px-[9px] py-3 text-text-muted">No compatible node types</small>
    </template>
  </div>
</template>

<style scoped>
@keyframes popover-in { from { opacity: 0; transform: translateY(-3px) scale(.98); } }
</style>
