<script setup lang="ts">
import { formatDuration } from '../run-summary'

defineProps<{ details: any }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <aside class="row-start-3 grid max-h-[210px] grid-rows-[38px_minmax(0,1fr)] border-t border-line-strong bg-bg-card transition-colors duration-200">
    <header class="flex items-center justify-between border-b border-line py-0 pl-4 pr-3"><div><span class="font-mono text-[8px] font-semibold tracking-[.12em] text-acid">RUN LOG</span><b class="ml-[10px] font-mono text-[8px] font-normal text-text-muted max-[900px]:hidden">{{ details.id }} · {{ details.completed }}/{{ details.total }} steps · {{ formatDuration(details.totalDurationMs) }}</b></div><button class="size-[26px] rounded border-0 bg-transparent text-base text-text-muted transition-colors hover:bg-bg-input-hover hover:text-text-primary" type="button" aria-label="Close run log" @click="emit('close')">×</button></header>
    <div class="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-px overflow-auto bg-line max-[900px]:block">
      <article v-for="step in details.steps" :key="step.id" class="grid min-w-0 grid-cols-[7px_minmax(0,1fr)_auto] grid-rows-[auto_auto] gap-x-2 gap-y-0.5 bg-bg-input px-3 py-[10px] transition-colors max-[900px]:border-b max-[900px]:border-line [&>i]:row-span-2 [&>i]:self-center [&>i]:size-1.5 [&>i]:rounded-full [&>i]:bg-text-muted [&>div]:min-w-0 [&_strong]:block [&_strong]:overflow-hidden [&_strong]:text-ellipsis [&_strong]:whitespace-nowrap [&_strong]:text-[9px] [&_strong]:text-text-secondary [&_small]:mt-[3px] [&_small]:block [&_small]:overflow-hidden [&_small]:text-ellipsis [&_small]:whitespace-nowrap [&_small]:font-mono [&_small]:text-[7px] [&_small]:text-text-muted [&>span]:font-mono [&>span]:text-[7px] [&>span]:font-medium [&>span]:uppercase [&>span]:text-text-muted [&>b]:col-start-3 [&>b]:text-right [&>b]:font-mono [&>b]:text-[8px] [&>b]:font-normal [&>b]:text-text-secondary [&.succeeded>i]:bg-acid [&.running>i]:bg-status-running [&.failed>i]:bg-status-failed [&.failed>span]:text-status-failed [&.failed>b]:text-status-failed" :class="step.status"><i /><div><strong>{{ step.label }}</strong><small>{{ step.message }}</small></div><span>{{ step.status }}</span><b>{{ step.durationMs === null ? 'Pending' : formatDuration(step.durationMs) }}</b></article>
    </div>
  </aside>
</template>
