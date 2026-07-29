<script setup lang="ts">
import { SelectContent, SelectIcon, SelectItem, SelectItemIndicator, SelectItemText, SelectPortal, SelectRoot, SelectTrigger, SelectValue, SelectViewport } from 'reka-ui'

type SelectValue = string | number
type SelectOption = SelectValue | { value: SelectValue; label: string }

defineProps<{ modelValue: SelectValue; options: SelectOption[] }>()

const emit = defineEmits<{ 'update:modelValue': [value: SelectValue] }>()

function optionValue(option: SelectOption): SelectValue {
  return typeof option === 'object' ? option.value : option
}

function optionLabel(option: SelectOption): string {
  return typeof option === 'object' ? option.label : option
}
</script>

<template>
  <SelectRoot :model-value="modelValue" @update:model-value="emit('update:modelValue', $event)">
    <SelectTrigger class="node-select-trigger" @pointerdown.stop>
      <SelectValue />
      <SelectIcon class="node-select-icon"><svg class="chevron-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg></SelectIcon>
    </SelectTrigger>
    <SelectPortal>
      <SelectContent class="node-select-content" position="popper" :side-offset="5" :collision-padding="8">
        <SelectViewport class="node-select-viewport">
          <SelectItem v-for="option in options" :key="optionValue(option)" class="node-select-item" :value="optionValue(option)">
            <SelectItemIndicator class="node-select-check">✓</SelectItemIndicator>
            <SelectItemText>{{ optionLabel(option) }}</SelectItemText>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>
