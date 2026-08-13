<script setup lang="ts">
import { computed } from 'vue'
import { BaseEdge, getBezierPath, type EdgeProps } from '@vue-flow/core'

const props = defineProps<EdgeProps<{ running?: boolean }>>()

const edgePath = computed(() => getBezierPath({
  sourceX: props.sourceX,
  sourceY: props.sourceY,
  sourcePosition: props.sourcePosition,
  targetX: props.targetX,
  targetY: props.targetY,
  targetPosition: props.targetPosition,
})[0])
</script>

<template>
  <BaseEdge :path="edgePath" :marker-end="markerEnd" class="execution-edge-base" />
  <path
    v-if="data?.running"
    :d="edgePath"
    class="execution-edge-flow"
  />
</template>

<style scoped>
.execution-edge-flow { fill: none; stroke: var(--acid); stroke-width: 3; stroke-linecap: round; stroke-dasharray: 10 58; filter: drop-shadow(0 0 4px var(--acid)) drop-shadow(0 0 9px color-mix(in srgb, var(--acid) 65%, transparent)); animation: execution-edge-flow 1.05s linear infinite; pointer-events: none; }
@keyframes execution-edge-flow { to { stroke-dashoffset: -68; } }
@media (prefers-reduced-motion: reduce) { .execution-edge-flow { animation: none; } }
</style>
