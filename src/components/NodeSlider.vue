<script setup lang="ts">
import { SliderRange, SliderRoot, SliderThumb, SliderTrack } from 'reka-ui'

const props = withDefaults(defineProps<{ modelValue: number; min: number; max: number; step?: number }>(), { step: 1 })
const emit = defineEmits<{ 'update:model-value': [value: number] }>()
</script>

<template>
  <SliderRoot class="nodrag forge:relative forge:flex forge:h-[18px] forge:w-full forge:touch-none forge:select-none forge:items-center forge:px-1.5" :model-value="[props.modelValue]" :min="min" :max="max" :step="step" @update:model-value="emit('update:model-value', $event?.[0] ?? props.modelValue)">
    <SliderTrack class="forge:relative forge:h-0.5 forge:flex-1 forge:overflow-visible forge:bg-[#aeb4b0]"><SliderRange class="forge:absolute forge:h-full forge:bg-[var(--node-accent)]" /></SliderTrack>
    <SliderThumb class="forge:block forge:size-3 forge:rounded-full forge:border-2 forge:border-[var(--node-accent)] forge:bg-white forge:outline-0 forge:transition-[box-shadow,transform] forge:duration-150 forge:hover:scale-110 forge:hover:shadow-[0_0_0_3px_color-mix(in_srgb,var(--node-accent)_18%,transparent)] forge:focus-visible:scale-110 forge:focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--node-accent)_18%,transparent)]" />
  </SliderRoot>
</template>
