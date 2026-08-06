<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ executions: any[]; loading: boolean }>()

const outputRuns = computed(() => props.executions.map((execution) => ({
  ...execution,
  outputs: Object.entries(execution.nodeExecutions || {}).flatMap(([nodeId, nodeRun]: [string, any]) => {
    const output = nodeRun.output || {}
    const files = output.outputs || (output.downloadUrl ? [output] : [])
    return files.filter((file: any) => file.downloadUrl).map((file: any) => ({ ...file, nodeId, nodeName: nodeRun.nodeName || nodeId }))
  }),
})).filter((execution) => execution.outputs.length))

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
</script>

<template>
  <aside class="execution-output-panel" aria-label="Workflow outputs">
    <header>
      <div><span>WORKFLOW OUTPUTS</span><b>{{ outputRuns.length }} run{{ outputRuns.length === 1 ? '' : 's' }}</b></div>
    </header>
    <div v-if="loading" class="execution-output-empty">Loading outputs...</div>
    <div v-else-if="!outputRuns.length" class="execution-output-empty">Generated files from this workflow will appear here.</div>
    <div v-else class="execution-output-list">
      <section v-for="execution in outputRuns" :key="execution.id" class="execution-output-run">
        <div class="execution-output-run-head"><strong>{{ execution.entryNodeName || 'Workflow run' }}</strong><time :datetime="execution.createdAt">{{ runLabel(execution) }}</time></div>
        <button v-for="output in execution.outputs" :key="`${output.nodeId}-${output.downloadUrl}`" type="button" class="execution-output-file" @click="download(output)">
          <span><b>{{ output.filename || 'Generated output' }}</b><small>{{ output.nodeName }} · {{ String(output.format || 'file').toUpperCase() }}</small></span><i aria-hidden="true">↓</i>
        </button>
      </section>
    </div>
  </aside>
</template>
