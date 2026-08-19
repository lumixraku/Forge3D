<script setup lang="ts">
import { bizClass } from '../class-prefix'
import { formatDuration } from '../run-summary'

defineProps<{ details: any }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <aside class="forge:row-start-3 forge:grid forge:max-h-[210px] forge:grid-rows-[38px_minmax(0,1fr)] forge:border-t forge:border-line-strong forge:bg-bg-card forge:transition-colors forge:duration-200">
    <header class="forge:flex forge:items-center forge:justify-between forge:border-b forge:border-line forge:py-0 forge:pl-4 forge:pr-3"><div><span class="forge:font-mono forge:text-[8px] forge:font-semibold forge:tracking-[.12em] forge:text-acid">RUN LOG</span><b class="forge:ml-[10px] forge:font-mono forge:text-[8px] forge:font-normal forge:text-text-muted forge:max-[900px]:hidden">{{ details.id }} · {{ details.completed }}/{{ details.total }} steps · {{ formatDuration(details.totalDurationMs) }}</b></div><button class="forge:size-[26px] forge:rounded forge:border-0 forge:bg-transparent forge:text-base forge:text-text-muted forge:transition-colors forge:hover:bg-bg-input-hover forge:hover:text-text-primary" type="button" aria-label="Close run log" @click="emit('close')">×</button></header>
    <div class="forge:grid forge:grid-cols-[repeat(auto-fit,minmax(180px,1fr))] forge:gap-px forge:overflow-auto forge:bg-line forge:max-[900px]:block">
      <article v-for="step in details.steps" :key="step.id" class="forge:grid forge:min-w-0 forge:grid-cols-[7px_minmax(0,1fr)_auto] forge:grid-rows-[auto_auto] forge:gap-x-2 forge:gap-y-0.5 forge:bg-bg-input forge:px-3 forge:py-[10px] forge:transition-colors forge:max-[900px]:border-b forge:max-[900px]:border-line forge:[&>i]:row-span-2 forge:[&>i]:self-center forge:[&>i]:size-1.5 forge:[&>i]:rounded-full forge:[&>i]:bg-text-muted forge:[&>div]:min-w-0 forge:[&_strong]:block forge:[&_strong]:overflow-hidden forge:[&_strong]:text-ellipsis forge:[&_strong]:whitespace-nowrap forge:[&_strong]:text-[9px] forge:[&_strong]:text-text-secondary forge:[&_small]:mt-[3px] forge:[&_small]:block forge:[&_small]:overflow-hidden forge:[&_small]:text-ellipsis forge:[&_small]:whitespace-nowrap forge:[&_small]:font-mono forge:[&_small]:text-[7px] forge:[&_small]:text-text-muted forge:[&>span]:font-mono forge:[&>span]:text-[7px] forge:[&>span]:font-medium forge:[&>span]:uppercase forge:[&>span]:text-text-muted forge:[&>b]:col-start-3 forge:[&>b]:text-right forge:[&>b]:font-mono forge:[&>b]:text-[8px] forge:[&>b]:font-normal forge:[&>b]:text-text-secondary forge:[&.forge3d-succeeded>i]:bg-acid forge:[&.forge3d-running>i]:bg-status-running forge:[&.forge3d-failed>i]:bg-status-failed forge:[&.forge3d-failed>span]:text-status-failed forge:[&.forge3d-failed>b]:text-status-failed" :class="bizClass(step.status)"><i /><div><strong>{{ step.label }}</strong><small>{{ step.message }}</small></div><span>{{ step.status }}</span><b>{{ step.durationMs === null ? 'Pending' : formatDuration(step.durationMs) }}</b></article>
    </div>
  </aside>
</template>
