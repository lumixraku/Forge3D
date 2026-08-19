<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { NodeResizeControl, type ControlPosition } from '@vue-flow/node-resizer'

interface FrameData { label: string; description?: string }

const props = withDefaults(defineProps<{ id: string; data: FrameData; selected?: boolean; zoom?: number; running?: boolean }>(), { selected: false, zoom: 1, running: false })
const emit = defineEmits<{ 'update-name': [name: string]; 'resize-start': []; 'resize-end': []; 'run': []; 'stop-run': [] }>()
const editingName = ref(false)
const draftName = ref('')
const nameInput = ref<HTMLInputElement | null>(null)
const resizeCorners: ControlPosition[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
const headerStyle = computed(() => ({
  transform: `translateY(${-8 / props.zoom}px) scale(${1 / props.zoom})`,
}))
const resizeHandleStyle = computed(() => ({
  transform: `translate(-50%, -50%) scale(${1 / props.zoom})`,
}))

function startNameEdit() {
  draftName.value = props.data.label
  editingName.value = true
  nextTick(() => {
    nameInput.value?.focus()
    nameInput.value?.select()
  })
}

function saveName() {
  if (!editingName.value) return
  const name = draftName.value.trim()
  editingName.value = false
  if (name && name !== props.data.label) emit('update-name', name)
}

function cancelNameEdit() {
  editingName.value = false
  draftName.value = props.data.label
}
</script>

<template>
  <section class="forge3d-canvas-frame forge:relative forge:h-full forge:min-h-full forge:w-full forge:min-w-full forge:rounded-[15px] forge:border forge:border-[color-mix(in_srgb,var(--acid)_44%,transparent)] forge:bg-[color-mix(in_srgb,var(--acid)_4.5%,transparent)] forge:px-5 forge:py-[17px] forge:transition-[border-color,box-shadow] forge:[&.forge3d-selected]:border-acid forge:[&.forge3d-selected]:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--acid)_25%,transparent)]">
    <NodeResizeControl v-for="position in resizeCorners" :key="position" class="forge3d-frame-resize-handle nodrag nopan" :node-id="id" :position="position" :min-width="260" :min-height="180" :auto-scale="false" :style="resizeHandleStyle" @resize-start="emit('resize-start')" @resize-end="emit('resize-end')" />
    <header class="forge:absolute forge:bottom-full forge:left-0 forge:inline-flex forge:h-[34px] forge:w-max forge:max-w-full forge:origin-bottom-left forge:cursor-pointer forge:items-center forge:gap-[10px] forge:rounded-lg forge:border forge:border-[color-mix(in_srgb,var(--acid)_48%,var(--line-strong))] forge:bg-[color-mix(in_srgb,var(--acid)_16%,var(--bg-input))] forge:px-2 forge:py-[5px] forge:shadow-sm forge:pointer-events-auto" :style="headerStyle">
      <span class="forge:grid forge:size-5 forge:flex-none forge:place-items-center forge:rounded-[5px] forge:border forge:border-[color-mix(in_srgb,var(--acid)_65%,var(--line-strong))] forge:bg-[color-mix(in_srgb,var(--acid)_10%,var(--bg-input))] forge:font-mono forge:text-[9px] forge:font-semibold forge:text-acid">S</span>
      <input v-if="editingName" ref="nameInput" v-model="draftName" class="nodrag nopan forge:h-4 forge:w-[min(260px,calc(100%-58px))] forge:min-w-0 forge:border-0 forge:bg-transparent forge:p-0 forge:text-[13px] forge:font-semibold forge:leading-4 forge:text-text-primary forge:caret-acid forge:outline-0" aria-label="Section name" @click.stop @dblclick.stop @pointerdown.stop @keydown.enter.prevent="saveName" @keydown.esc.prevent="cancelNameEdit" @blur="saveName" />
      <strong v-else class="forge:h-4 forge:min-w-0 forge:max-w-[300px] forge:overflow-hidden forge:text-ellipsis forge:whitespace-nowrap forge:text-[13px] forge:font-semibold forge:leading-4 forge:text-text-primary" title="Double-click to rename" @dblclick.stop="startNameEdit">{{ data.label }}</strong>
      <button v-if="running" type="button" class="nodrag nopan forge:ml-0.5 forge:grid forge:size-6 forge:place-items-center forge:rounded-[5px] forge:border-0 forge:bg-transparent forge:p-0 forge:text-[#d94a4a] forge:transition-colors forge:hover:bg-[color-mix(in_srgb,#e05d5d_15%,transparent)] forge:focus-visible:bg-[color-mix(in_srgb,#e05d5d_15%,transparent)] forge:focus-visible:outline-0 forge:[&_svg]:size-3.5 forge:[&_svg]:fill-none forge:[&_svg]:stroke-current forge:[&_svg]:stroke-[1.8]" title="Stop" aria-label="Stop" @click.stop="emit('stop-run')"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1" /></svg></button>
      <button v-else type="button" class="nodrag nopan forge:ml-0.5 forge:grid forge:size-6 forge:place-items-center forge:rounded-[5px] forge:border-0 forge:bg-transparent forge:p-0 forge:text-[var(--node-accent,#6f8e1f)] forge:transition-colors forge:hover:bg-[color-mix(in_srgb,var(--node-accent,#86a72d)_15%,transparent)] forge:focus-visible:bg-[color-mix(in_srgb,var(--node-accent,#86a72d)_15%,transparent)] forge:focus-visible:outline-0 forge:[&_svg]:size-3.5 forge:[&_svg]:fill-none forge:[&_svg]:stroke-current forge:[&_svg]:stroke-[1.8]" title="Run" aria-label="Run" @click.stop="emit('run')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7Z" /></svg></button>
    </header>
    <p v-if="data.description" class="forge:ml-[55px] forge:mt-[5px] forge:text-[10px] forge:text-text-muted">{{ data.description }}</p>
  </section>
</template>

<style scoped>
:deep(.forge3d-frame-resize-handle.vue-flow__resize-control) { z-index: 8; width: 28px; height: 28px; border: 0; background: transparent; pointer-events: auto; }
:deep(.forge3d-frame-resize-handle.vue-flow__resize-control::after) { position: absolute; inset: 7px; border: 2px solid var(--bg-input); border-radius: 50%; background: var(--acid); box-shadow: 0 0 0 1px color-mix(in srgb, var(--acid) 65%, transparent); content: ''; opacity: 0; transition: opacity .12s ease; }
:deep(.forge3d-frame-resize-handle.vue-flow__resize-control:hover::after), :deep(.forge3d-frame-resize-handle.vue-flow__resize-control:active::after) { opacity: 1; }
</style>
