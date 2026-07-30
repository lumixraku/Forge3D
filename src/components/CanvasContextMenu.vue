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
  <div class="node-menu-popover canvas-node-menu contextual" :class="{ 'selection-menu': context.kind === 'selection' }" :style="{ left: `${context.left}px`, top: `${context.top}px`, maxWidth: `${context.maxWidth}px`, maxHeight: `${context.maxHeight}px` }" @pointerdown.stop>
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
      <small v-if="!catalog.length" class="node-menu-empty">No compatible node types</small>
    </template>
  </div>
</template>
