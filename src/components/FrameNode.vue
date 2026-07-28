<script setup>
import { computed, nextTick, ref } from 'vue'
import { NodeResizeControl } from '@vue-flow/node-resizer'

const props = defineProps({ id: { type: String, required: true }, data: { type: Object, required: true }, selected: Boolean, running: Boolean, zoom: { type: Number, default: 1 } })
const emit = defineEmits(['update-name', 'run-workflow', 'resize-start', 'resize-end'])
const editingName = ref(false)
const draftName = ref('')
const nameInput = ref(null)
const resizeCorners = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
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
  <section class="workflow-frame" :class="{ selected }">
    <NodeResizeControl v-for="position in resizeCorners" :key="position" class="frame-resize-handle nodrag nopan" :node-id="id" :position="position" :min-width="260" :min-height="180" :auto-scale="false" :style="resizeHandleStyle" @resize-start="emit('resize-start')" @resize-end="emit('resize-end')" />
    <header :style="headerStyle">
      <span class="frame-icon">S</span>
      <input v-if="editingName" ref="nameInput" v-model="draftName" class="frame-name-input nodrag nopan" aria-label="Section name" @click.stop @dblclick.stop @pointerdown.stop @keydown.enter.prevent="saveName" @keydown.esc.prevent="cancelNameEdit" @blur="saveName" />
      <strong v-else title="Double-click to rename" @dblclick.stop="startNameEdit">{{ data.label }}</strong>
      <button type="button" class="section-run-button nodrag nopan" :disabled="running" :aria-label="running ? 'Running workflow' : 'Run workflow'" :title="running ? 'Running workflow' : 'Run workflow'" @pointerdown.stop @click.stop="emit('run-workflow')">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.75v10.5L13 8z" /></svg>
      </button>
    </header>
    <p v-if="data.description">{{ data.description }}</p>
  </section>
</template>
