<script setup lang="ts">
import { SliderRange, SliderRoot, SliderThumb, SliderTrack } from 'reka-ui'

const props = withDefaults(defineProps<{ modelValue: number; min: number; max: number; step?: number }>(), { step: 1 })
const emit = defineEmits<{ 'update:model-value': [value: number] }>()
</script>

<template>
  <SliderRoot class="node-slider nodrag" :model-value="[props.modelValue]" :min="min" :max="max" :step="step" @update:model-value="emit('update:model-value', $event?.[0] ?? props.modelValue)">
    <SliderTrack class="node-slider-track"><SliderRange class="node-slider-range" /></SliderTrack>
    <SliderThumb class="node-slider-thumb" />
  </SliderRoot>
</template>
