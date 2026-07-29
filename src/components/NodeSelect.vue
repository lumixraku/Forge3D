<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'

type SelectValue = string | number
type SelectOption = SelectValue | { value: SelectValue; label: string }

const props = withDefaults(defineProps<{ modelValue: SelectValue; options: SelectOption[]; dismissVersion?: number }>(), { dismissVersion: 0 })

const emit = defineEmits<{ 'update:modelValue': [value: SelectValue] }>()
const open = ref(false)
const root = ref<HTMLElement | null>(null)

watch(() => props.dismissVersion, () => { open.value = false })

function closeOnOutsidePointerDown(event: PointerEvent) {
  if (open.value && !root.value?.contains(event.target as Node)) open.value = false
}

watch(open, (isOpen) => {
  window[isOpen ? 'addEventListener' : 'removeEventListener']('pointerdown', closeOnOutsidePointerDown, true)
})

onBeforeUnmount(() => window.removeEventListener('pointerdown', closeOnOutsidePointerDown, true))

function optionValue(option: SelectOption): SelectValue {
  return typeof option === 'object' ? option.value : option
}

function optionLabel(option: SelectOption): string {
  return typeof option === 'object' ? option.label : option
}

function select(option: SelectOption) {
  emit('update:modelValue', optionValue(option))
  open.value = false
}
</script>

<template>
  <div ref="root" class="node-select">
    <button type="button" class="node-select-trigger" :aria-expanded="open" aria-haspopup="listbox" @click.stop="open = !open" @pointerdown.stop>
      <span>{{ optionLabel(options.find(option => optionValue(option) === modelValue) ?? modelValue) }}</span>
      <span class="node-select-icon" :class="{ open }"><svg class="chevron-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg></span>
    </button>
    <div v-if="open" class="node-select-content" role="listbox" @pointerdown.stop>
      <button v-for="option in options" :key="optionValue(option)" type="button" class="node-select-item" :class="{ selected: optionValue(option) === modelValue }" role="option" :aria-selected="optionValue(option) === modelValue" @click="select(option)">
        <span class="node-select-check">{{ optionValue(option) === modelValue ? '✓' : '' }}</span>
        <span>{{ optionLabel(option) }}</span>
      </button>
    </div>
  </div>
</template>
