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
  <section class="canvas-frame" :class="{ selected }">
    <NodeResizeControl v-for="position in resizeCorners" :key="position" class="frame-resize-handle nodrag nopan" :node-id="id" :position="position" :min-width="260" :min-height="180" :auto-scale="false" :style="resizeHandleStyle" @resize-start="emit('resize-start')" @resize-end="emit('resize-end')" />
    <header :style="headerStyle">
      <span class="frame-icon">S</span>
      <input v-if="editingName" ref="nameInput" v-model="draftName" class="frame-name-input nodrag nopan" aria-label="Section name" @click.stop @dblclick.stop @pointerdown.stop @keydown.enter.prevent="saveName" @keydown.esc.prevent="cancelNameEdit" @blur="saveName" />
      <strong v-else title="Double-click to rename" @dblclick.stop="startNameEdit">{{ data.label }}</strong>
      <button v-if="running" type="button" class="frame-stop nodrag nopan" title="Stop" aria-label="Stop" @click.stop="emit('stop-run')"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1" /></svg></button>
      <button v-else type="button" class="frame-run nodrag nopan" title="Run" aria-label="Run" @click.stop="emit('run')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7Z" /></svg></button>
    </header>
    <p v-if="data.description">{{ data.description }}</p>
  </section>
</template>
