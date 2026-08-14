<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ executions: any[]; loading: boolean; activeExecution?: any; activeExecutions?: Record<string, any> }>()

const taskRuns = computed(() => [
  ...Object.values(props.activeExecutions || {}),
  ...(props.activeExecution?.id && !props.executions.some((execution) => execution.id === props.activeExecution.id) ? [props.activeExecution] : []),
  ...props.executions,
].map((execution) => ({
  ...execution,
  nodeExecutions: execution.nodeExecutions || execution.nodeRuns || {},
  outputs: Object.entries(execution.nodeExecutions || execution.nodeRuns || {}).flatMap(([nodeId, nodeRun]: [string, any]) => {
    const output = nodeRun.output || {}
    const files = output.outputs || (output.downloadUrl ? [output] : [])
    return files.filter((file: any) => file.downloadUrl).map((file: any) => ({ ...file, nodeId, nodeName: nodeRun.nodeName || nodeId }))
  }),
})))

function download(output: any) {
  const anchor = document.createElement('a')
  anchor.href = output.downloadUrl
  anchor.download = output.filename || `output.${String(output.format || 'glb').toLowerCase()}`
  anchor.style.display = 'none'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
}

function runLabel(execution: any) {
  return new Date(execution.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function statusLabel(status: string) {
  return ({ queued: 'QUEUED', running: 'RUNNING', cancelling: 'STOPPING', cancelled: 'CANCELLED', succeeded: 'COMPLETED', failed: 'FAILED' } as Record<string, string>)[status] || status.toUpperCase()
}

function statusClass(status: string) {
  return `is-${status}`
}

function progress(execution: any) {
  const steps = Object.values(execution.nodeExecutions || {}) as any[]
  if (!steps.length) return 0
  return Math.round((steps.filter((step) => ['succeeded', 'failed', 'waiting_review'].includes(step.status)).length / steps.length) * 100)
}
</script>

<template>
  <aside class="execution-output-panel absolute inset-y-0 right-0 z-20 grid w-[300px] min-w-0 translate-x-full grid-rows-[58px_minmax(0,1fr)] overflow-hidden border-l border-line bg-bg-secondary shadow-[-14px_0_30px_rgba(20,26,22,.12)] transition-transform duration-200 [&.is-open]:translate-x-0 max-[1200px]:w-[270px] max-[760px]:w-[min(300px,90vw)]" aria-label="Workflow tasks">
    <header class="flex items-center border-b border-line px-4">
      <div class="grid gap-1"><span class="font-mono text-[8px] font-semibold tracking-[.12em] text-acid">QUEUE</span><b class="font-mono text-[8px] font-normal text-text-muted">{{ taskRuns.length }} task{{ taskRuns.length === 1 ? '' : 's' }}</b></div>
    </header>
    <div v-if="loading" class="m-3 self-start rounded-lg border border-dashed border-line-strong p-3.5 font-mono text-[9px] leading-normal text-text-muted">Loading outputs...</div>
    <div v-else-if="!taskRuns.length" class="m-3 self-start rounded-lg border border-dashed border-line-strong p-3.5 font-mono text-[9px] leading-normal text-text-muted">Run a node to add a task here.</div>
    <div v-else class="grid content-start gap-3 overflow-auto p-3">
      <section v-for="execution in taskRuns" :key="execution.id" class="grid gap-[7px] rounded-lg border border-line bg-bg-card p-[10px]">
        <div class="flex items-baseline justify-between gap-2"><strong class="overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-text-secondary">{{ execution.entryNodeName || 'Workflow run' }}</strong><time class="flex-none font-mono text-[7px] text-text-muted" :datetime="execution.createdAt">{{ runLabel(execution) }}</time></div>
        <code class="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[7px] text-text-muted" :title="execution.id">Task ID: {{ execution.id }}</code>
        <div class="flex items-center gap-1.5 font-mono text-[8px] font-medium tracking-[.06em] text-text-muted [&>i]:size-[7px] [&>i]:rounded-full [&>i]:bg-text-muted [&>b]:ml-auto [&>b]:font-medium [&>b]:text-text-secondary [&.is-running>i]:animate-[execution-pulse_1.2s_ease-in-out_infinite] [&.is-running>i]:bg-acid [&.is-running>i]:shadow-[0_0_8px_color-mix(in_srgb,var(--acid)_70%,transparent)] [&.is-succeeded>i]:bg-[#68c987] [&.is-failed>i]:bg-[#e2746b]" :class="statusClass(execution.status)"><i aria-hidden="true" /><span>{{ statusLabel(execution.status) }}</span><b>{{ progress(execution) }}%</b></div>
        <div class="mt-[7px] h-[3px] overflow-hidden rounded-sm bg-line"><span class="block h-full bg-acid transition-[width] duration-250" :style="{ width: `${progress(execution)}%` }" /></div>
        <p v-if="execution.status === 'failed'" class="m-0 font-mono text-[8px] font-normal leading-[1.4] text-[#e2746b]">{{ Object.values(execution.nodeExecutions || {}).find((nodeRun: any) => nodeRun.error)?.error || 'Task failed' }}</p>
        <div v-if="execution.outputs.length" class="mt-2 font-mono text-[7px] font-semibold tracking-[.12em] text-text-muted">OUTPUTS</div>
        <button v-for="output in execution.outputs" :key="`${output.nodeId}-${output.downloadUrl}`" type="button" class="flex w-full items-center justify-between gap-2 rounded-[5px] border border-line bg-bg-input p-2 text-left text-text-primary transition-colors hover:border-acid hover:bg-bg-input-hover" @click="download(output)">
          <span class="grid min-w-0 gap-[3px]"><b class="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[9px] font-medium">{{ output.filename || 'Generated output' }}</b><small class="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[7px] font-normal text-text-muted">{{ output.nodeName }} · {{ String(output.format || 'file').toUpperCase() }}</small></span><i class="font-mono text-base font-semibold not-italic leading-none text-acid" aria-hidden="true">↓</i>
        </button>
      </section>
    </div>
  </aside>
</template>

<style scoped>
@keyframes execution-pulse { 50% { opacity: .45; transform: scale(.78); } }
</style>
