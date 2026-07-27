<script setup>
import { nextTick, ref } from 'vue'

const props = defineProps({ data: { type: Object, required: true }, selected: Boolean, running: Boolean })
const emit = defineEmits(['update-name', 'run-workflow'])
const editingName = ref(false)
const draftName = ref('')
const nameInput = ref(null)

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
    <header>
      <span>SECTION</span>
      <input v-if="editingName" ref="nameInput" v-model="draftName" class="frame-name-input nodrag nopan" aria-label="Section name" @click.stop @dblclick.stop @pointerdown.stop @keydown.enter.prevent="saveName" @keydown.esc.prevent="cancelNameEdit" @blur="saveName" />
      <strong v-else title="Double-click to rename" @dblclick.stop="startNameEdit">{{ data.label }}</strong>
      <button type="button" class="section-run-button nodrag nopan" :disabled="running" @pointerdown.stop @click.stop="emit('run-workflow')">{{ running ? 'Running…' : 'Run workflow' }}</button>
    </header>
    <p v-if="data.description">{{ data.description }}</p>
  </section>
</template>
