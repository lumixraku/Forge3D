<script setup lang="ts">
import { SliderRange, SliderRoot, SliderThumb, SliderTrack } from 'reka-ui'

const props = withDefaults(defineProps<{ modelValue: number; min: number; max: number; step?: number }>(), { step: 1 })
const emit = defineEmits<{ 'update:model-value': [value: number] }>()
</script>

<template>
  <SliderRoot class="nodrag relative flex h-[18px] w-full touch-none select-none items-center px-1.5" :model-value="[props.modelValue]" :min="min" :max="max" :step="step" @update:model-value="emit('update:model-value', $event?.[0] ?? props.modelValue)">
    <SliderTrack class="relative h-0.5 flex-1 overflow-visible bg-[#aeb4b0]"><SliderRange class="absolute h-full bg-[var(--node-accent)]" /></SliderTrack>
    <SliderThumb class="block size-3 rounded-full border-2 border-[var(--node-accent)] bg-white outline-0 transition-[box-shadow,transform] duration-150 hover:scale-110 hover:shadow-[0_0_0_3px_color-mix(in_srgb,var(--node-accent)_18%,transparent)] focus-visible:scale-110 focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--node-accent)_18%,transparent)]" />
  </SliderRoot>
</template>
