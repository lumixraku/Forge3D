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
