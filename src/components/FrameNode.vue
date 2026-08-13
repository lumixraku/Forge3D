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
  <section class="canvas-frame relative h-full min-h-full w-full min-w-full rounded-[15px] border border-[color-mix(in_srgb,var(--acid)_44%,transparent)] bg-[color-mix(in_srgb,var(--acid)_4.5%,transparent)] px-5 py-[17px] transition-[border-color,box-shadow] [&.selected]:border-acid [&.selected]:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--acid)_25%,transparent)]">
    <NodeResizeControl v-for="position in resizeCorners" :key="position" class="frame-resize-handle nodrag nopan" :node-id="id" :position="position" :min-width="260" :min-height="180" :auto-scale="false" :style="resizeHandleStyle" @resize-start="emit('resize-start')" @resize-end="emit('resize-end')" />
    <header class="absolute bottom-full left-0 inline-flex h-[34px] w-max max-w-full origin-bottom-left cursor-pointer items-center gap-[10px] rounded-lg border border-[color-mix(in_srgb,var(--acid)_48%,var(--line-strong))] bg-[color-mix(in_srgb,var(--acid)_16%,var(--bg-input))] px-2 py-[5px] shadow-sm pointer-events-auto" :style="headerStyle">
      <span class="grid size-5 flex-none place-items-center rounded-[5px] border border-[color-mix(in_srgb,var(--acid)_65%,var(--line-strong))] bg-[color-mix(in_srgb,var(--acid)_10%,var(--bg-input))] font-mono text-[9px] font-semibold text-acid">S</span>
      <input v-if="editingName" ref="nameInput" v-model="draftName" class="nodrag nopan h-4 w-[min(260px,calc(100%-58px))] min-w-0 border-0 bg-transparent p-0 text-[13px] font-semibold leading-4 text-text-primary caret-acid outline-0" aria-label="Section name" @click.stop @dblclick.stop @pointerdown.stop @keydown.enter.prevent="saveName" @keydown.esc.prevent="cancelNameEdit" @blur="saveName" />
      <strong v-else class="h-4 min-w-0 max-w-[300px] overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-semibold leading-4 text-text-primary" title="Double-click to rename" @dblclick.stop="startNameEdit">{{ data.label }}</strong>
      <button v-if="running" type="button" class="nodrag nopan ml-0.5 grid size-6 place-items-center rounded-[5px] border-0 bg-transparent p-0 text-[#d94a4a] transition-colors hover:bg-[color-mix(in_srgb,#e05d5d_15%,transparent)] focus-visible:bg-[color-mix(in_srgb,#e05d5d_15%,transparent)] focus-visible:outline-0 [&_svg]:size-3.5 [&_svg]:fill-none [&_svg]:stroke-current [&_svg]:stroke-[1.8]" title="Stop" aria-label="Stop" @click.stop="emit('stop-run')"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1" /></svg></button>
      <button v-else type="button" class="nodrag nopan ml-0.5 grid size-6 place-items-center rounded-[5px] border-0 bg-transparent p-0 text-[var(--node-accent,#6f8e1f)] transition-colors hover:bg-[color-mix(in_srgb,var(--node-accent,#86a72d)_15%,transparent)] focus-visible:bg-[color-mix(in_srgb,var(--node-accent,#86a72d)_15%,transparent)] focus-visible:outline-0 [&_svg]:size-3.5 [&_svg]:fill-none [&_svg]:stroke-current [&_svg]:stroke-[1.8]" title="Run" aria-label="Run" @click.stop="emit('run')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7Z" /></svg></button>
    </header>
    <p v-if="data.description" class="ml-[55px] mt-[5px] text-[10px] text-text-muted">{{ data.description }}</p>
  </section>
</template>

<style scoped>
:deep(.frame-resize-handle.vue-flow__resize-control) { z-index: 8; width: 28px; height: 28px; border: 0; background: transparent; pointer-events: auto; }
:deep(.frame-resize-handle.vue-flow__resize-control::after) { position: absolute; inset: 7px; border: 2px solid var(--bg-input); border-radius: 50%; background: var(--acid); box-shadow: 0 0 0 1px color-mix(in srgb, var(--acid) 65%, transparent); content: ''; opacity: 0; transition: opacity .12s ease; }
:deep(.frame-resize-handle.vue-flow__resize-control:hover::after), :deep(.frame-resize-handle.vue-flow__resize-control:active::after) { opacity: 1; }
</style>
