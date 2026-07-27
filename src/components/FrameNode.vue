<script setup>
import { computed, nextTick, ref } from 'vue'

const props = defineProps({ data: { type: Object, required: true }, selected: Boolean, running: Boolean, zoom: { type: Number, default: 1 } })
const emit = defineEmits(['update-name', 'run-workflow'])
const editingName = ref(false)
const draftName = ref('')
const nameInput = ref(null)
const headerStyle = computed(() => ({
  transform: `translateY(${-8 / props.zoom}px) scale(${1 / props.zoom})`,
  width: `${props.zoom * 100}%`,
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
    <header :style="headerStyle">
      <span>SECTION</span>
      <input v-if="editingName" ref="nameInput" v-model="draftName" class="frame-name-input nodrag nopan" aria-label="Section name" @click.stop @dblclick.stop @pointerdown.stop @keydown.enter.prevent="saveName" @keydown.esc.prevent="cancelNameEdit" @blur="saveName" />
      <strong v-else title="Double-click to rename" @dblclick.stop="startNameEdit">{{ data.label }}</strong>
      <button type="button" class="section-run-button nodrag nopan" :disabled="running" :aria-label="running ? 'Running workflow' : 'Run workflow'" :title="running ? 'Running workflow' : 'Run workflow'" @pointerdown.stop @click.stop="emit('run-workflow')">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.75v10.5L13 8z" /></svg>
      </button>
    </header>
    <p v-if="data.description">{{ data.description }}</p>
  </section>
</template>
