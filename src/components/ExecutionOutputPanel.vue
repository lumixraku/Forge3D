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

// 把后端状态值转成带前缀的状态 class（前缀口径见 src/class-prefix.ts）
function statusClass(status: string) {
  return bizClass(`is-${status}`)
}

function progress(execution: any) {
  const steps = Object.values(execution.nodeExecutions || {}) as any[]
  if (!steps.length) return 0
  return Math.round((steps.filter((step) => ['succeeded', 'failed', 'waiting_review'].includes(step.status)).length / steps.length) * 100)
}

function parameterText(execution: any) {
  return Object.entries(execution.parameters || {}).flatMap(([nodeId, parameters]: [string, any]) =>
    Object.entries(parameters || {})
      .filter(([key, value]) => key !== 'result' && value != null && ['string', 'number', 'boolean'].includes(typeof value))
      .map(([key, value]) => `${nodeId}.${key}: ${value}`),
  ).join(' · ')
}
</script>

<template>
  <aside class="forge3d-execution-output-panel forge:absolute forge:inset-y-0 forge:right-0 forge:z-20 forge:grid forge:w-[300px] forge:min-w-0 forge:translate-x-full forge:grid-rows-[58px_minmax(0,1fr)] forge:overflow-hidden forge:border-l forge:border-line forge:bg-bg-secondary forge:shadow-[-14px_0_30px_rgba(20,26,22,.12)] forge:transition-transform forge:duration-200 forge:[&.forge3d-is-open]:translate-x-0 forge:max-[1200px]:w-[270px] forge:max-[760px]:w-[min(300px,90vw)]" aria-label="Workflow tasks">
    <header class="forge:flex forge:items-center forge:border-b forge:border-line forge:px-4">
      <div class="forge:grid forge:gap-1"><span class="forge:font-mono forge:text-[8px] forge:font-semibold forge:tracking-[.12em] forge:text-acid">QUEUE</span><b class="forge:font-mono forge:text-[8px] forge:font-normal forge:text-text-muted">{{ taskRuns.length }} task{{ taskRuns.length === 1 ? '' : 's' }}</b></div>
    </header>
    <div v-if="loading" class="forge:m-3 forge:self-start forge:rounded-lg forge:border forge:border-dashed forge:border-line-strong forge:p-3.5 forge:font-mono forge:text-[9px] forge:leading-normal forge:text-text-muted">Loading outputs...</div>
    <div v-else-if="!taskRuns.length" class="forge:m-3 forge:self-start forge:rounded-lg forge:border forge:border-dashed forge:border-line-strong forge:p-3.5 forge:font-mono forge:text-[9px] forge:leading-normal forge:text-text-muted">Run a node to add a task here.</div>
    <div v-else class="forge:grid forge:content-start forge:gap-3 forge:overflow-auto forge:p-3">
      <section v-for="execution in taskRuns" :key="execution.id" class="forge:grid forge:gap-[7px] forge:rounded-lg forge:border forge:border-line forge:bg-bg-card forge:p-[10px]">
        <div class="forge:flex forge:items-baseline forge:justify-between forge:gap-2"><strong class="forge:overflow-hidden forge:text-ellipsis forge:whitespace-nowrap forge:text-[10px] forge:text-text-secondary">{{ execution.entryNodeName || 'Workflow run' }}</strong><time class="forge:flex-none forge:font-mono forge:text-[7px] forge:text-text-muted" :datetime="execution.createdAt">{{ runLabel(execution) }}</time></div>
        <code class="forge:overflow-hidden forge:text-ellipsis forge:whitespace-nowrap forge:font-mono forge:text-[7px] forge:text-text-muted" :title="execution.id">Task ID: {{ execution.id }}</code>
        <p v-if="parameterText(execution)" class="forge:m-0 forge:line-clamp-3 forge:font-mono forge:text-[7px] forge:leading-[1.45] forge:text-text-muted" :title="parameterText(execution)">{{ parameterText(execution) }}</p>
        <div class="forge:flex forge:items-center forge:gap-1.5 forge:font-mono forge:text-[8px] forge:font-medium forge:tracking-[.06em] forge:text-text-muted forge:[&>i]:size-[7px] forge:[&>i]:rounded-full forge:[&>i]:bg-text-muted forge:[&>b]:ml-auto forge:[&>b]:font-medium forge:[&>b]:text-text-secondary forge:[&.forge3d-is-running>i]:animate-[execution-pulse_1.2s_ease-in-out_infinite] forge:[&.forge3d-is-running>i]:bg-acid forge:[&.forge3d-is-running>i]:shadow-[0_0_8px_color-mix(in_srgb,var(--acid)_70%,transparent)] forge:[&.forge3d-is-succeeded>i]:bg-[#68c987] forge:[&.forge3d-is-failed>i]:bg-[#e2746b]" :class="statusClass(execution.status)"><i aria-hidden="true" /><span>{{ statusLabel(execution.status) }}</span><b>{{ progress(execution) }}%</b></div>
        <div class="forge:mt-[7px] forge:h-[3px] forge:overflow-hidden forge:rounded-sm forge:bg-line"><span class="forge:block forge:h-full forge:bg-acid forge:transition-[width] forge:duration-250" :style="{ width: `${progress(execution)}%` }" /></div>
        <p v-if="execution.status === 'failed'" class="forge:m-0 forge:font-mono forge:text-[8px] forge:font-normal forge:leading-[1.4] forge:text-[#e2746b]">{{ Object.values(execution.nodeExecutions || {}).find((nodeRun: any) => nodeRun.error)?.error || 'Task failed' }}</p>
        <div v-if="execution.outputs.length" class="forge:mt-2 forge:font-mono forge:text-[7px] forge:font-semibold forge:tracking-[.12em] forge:text-text-muted">OUTPUTS</div>
        <button v-for="output in execution.outputs" :key="`${output.nodeId}-${output.downloadUrl}`" type="button" class="forge:flex forge:w-full forge:items-center forge:justify-between forge:gap-2 forge:rounded-[5px] forge:border forge:border-line forge:bg-bg-input forge:p-2 forge:text-left forge:text-text-primary forge:transition-colors forge:hover:border-acid forge:hover:bg-bg-input-hover" @click="download(output)">
          <span class="forge:grid forge:min-w-0 forge:gap-[3px]"><b class="forge:overflow-hidden forge:text-ellipsis forge:whitespace-nowrap forge:font-mono forge:text-[9px] forge:font-medium">{{ output.filename || 'Generated output' }}</b><small class="forge:overflow-hidden forge:text-ellipsis forge:whitespace-nowrap forge:font-mono forge:text-[7px] forge:font-normal forge:text-text-muted">{{ output.nodeName }} · {{ String(output.format || 'file').toUpperCase() }}</small></span><i class="forge:font-mono forge:text-base forge:font-semibold forge:not-italic forge:leading-none forge:text-acid" aria-hidden="true">↓</i>
        </button>
      </section>
    </div>
  </aside>
</template>

<style scoped>
@keyframes execution-pulse { 50% { opacity: .45; transform: scale(.78); } }
</style>
