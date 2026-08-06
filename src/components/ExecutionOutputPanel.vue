<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ executions: any[]; loading: boolean; activeExecution?: any }>()

const taskRuns = computed(() => [
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
  <aside class="execution-output-panel" aria-label="Workflow tasks">
    <header>
      <div><span>QUEUE</span><b>{{ taskRuns.length }} task{{ taskRuns.length === 1 ? '' : 's' }}</b></div>
    </header>
    <div v-if="loading" class="execution-output-empty">Loading outputs...</div>
    <div v-else-if="!taskRuns.length" class="execution-output-empty">Run a node to add a task here.</div>
    <div v-else class="execution-output-list">
      <section v-for="execution in taskRuns" :key="execution.id" class="execution-output-run">
        <div class="execution-output-run-head"><strong>{{ execution.entryNodeName || 'Workflow run' }}</strong><time :datetime="execution.createdAt">{{ runLabel(execution) }}</time></div>
        <div class="execution-task-status" :class="statusClass(execution.status)"><i aria-hidden="true" /><span>{{ statusLabel(execution.status) }}</span><b>{{ progress(execution) }}%</b></div>
        <div class="execution-task-progress"><span :style="{ width: `${progress(execution)}%` }" /></div>
        <p v-if="execution.status === 'failed'" class="execution-task-error">{{ Object.values(execution.nodeExecutions || {}).find((nodeRun: any) => nodeRun.error)?.error || 'Task failed' }}</p>
        <div v-if="execution.outputs.length" class="execution-output-files-label">OUTPUTS</div>
        <button v-for="output in execution.outputs" :key="`${output.nodeId}-${output.downloadUrl}`" type="button" class="execution-output-file" @click="download(output)">
          <span><b>{{ output.filename || 'Generated output' }}</b><small>{{ output.nodeName }} · {{ String(output.format || 'file').toUpperCase() }}</small></span><i aria-hidden="true">↓</i>
        </button>
      </section>
    </div>
  </aside>
</template>
