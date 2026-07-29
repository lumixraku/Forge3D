<script setup lang="ts">
import { formatDuration } from '../run-summary'

defineProps<{ details: any }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <aside class="run-log-panel bg-bg-card border-t border-line-strong">
    <header><div><span>RUN LOG</span><b>{{ details.id }} · {{ details.completed }}/{{ details.total }} steps · {{ formatDuration(details.totalDurationMs) }}</b></div><button type="button" aria-label="Close run log" @click="emit('close')">×</button></header>
    <div class="run-log-steps">
      <article v-for="step in details.steps" :key="step.id" class="run-log-step" :class="step.status"><i /><div><strong>{{ step.label }}</strong><small>{{ step.message }}</small></div><span>{{ step.status }}</span><b>{{ step.durationMs === null ? 'Pending' : formatDuration(step.durationMs) }}</b></article>
    </div>
  </aside>
</template>
