import { computed } from 'vue'
import { request } from '../api'
import { mergeNodeRuns } from '../node-runs'
import { formatDuration, summarizeRun } from '../run-summary'

export function useWorkflowRun({ activeWorkflow, nodes, run, nodeRuns, busy, error, runToken, saveWorkflow, materializeRunBatch }) {
  const downloadedExportRuns = new Set()
  const isRunning = computed(() => run.value?.status === 'running')
  const runDetails = computed(() => summarizeRun(run.value, nodes.value))
  const runSummary = computed(() => {
    if (!run.value) return 'Ready to run'
    const runs = Object.values(run.value.nodeRuns)
    const completed = runs.filter((nodeRun) => ['succeeded', 'failed'].includes(nodeRun.status)).length
    const totalDurationMs = runs.reduce((total, nodeRun) => total + (nodeRun.durationMs || 0), 0)
    const duration = totalDurationMs ? ` · ${formatDuration(totalDurationMs)}` : ''
    return run.value.status === 'running' ? `Running · ${completed}/${runs.length} steps${duration}` : `${runs.length} steps · ${run.value.status}${duration}`
  })

  // Image batches land on the canvas as soon as their node succeeds, so a long
  // run reveals results progressively instead of all at the end.
  function materializeImageBatches(currentRun) {
    for (const [nodeId, nodeRun] of Object.entries(currentRun.nodeRuns)) {
      if (nodeRun.status !== 'succeeded') continue
      if (nodes.value.find((node) => node.id === nodeId)?.data.workflowType !== 'generate-image') continue
      const previews = nodeRun.output?.previews
      if (Array.isArray(previews) && previews.length) materializeRunBatch(nodeId, currentRun.id, previews)
    }
  }

  function downloadExport(nodeRun) {
    const outputs = nodeRun?.output?.outputs || (nodeRun?.output?.downloadUrl ? [nodeRun.output] : [])
    for (const output of outputs) {
      if (!output.downloadUrl) continue
      const anchor = document.createElement('a')
      anchor.href = output.downloadUrl
      anchor.download = output.filename || `shark-gardener.${String(output.format || 'GLB').toLowerCase()}`
      anchor.click()
    }
  }

  async function runWorkflow(targetNodeId?: string, scope = 'node') {
    if (!activeWorkflow.value || busy.value || isRunning.value) return
    busy.value = true
    error.value = ''
    const pollToken = ++runToken.value
    try {
      await saveWorkflow()
      const workflowId = activeWorkflow.value.id
      const startedRun = await request(`/api/workflows/${workflowId}/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetNodeId, scope }),
      })
      run.value = startedRun
      nodeRuns.value = targetNodeId ? mergeNodeRuns(nodeRuns.value, startedRun.nodeRuns) : startedRun.nodeRuns
      materializeImageBatches(startedRun)
      const runId = run.value.id
      busy.value = false

      while (run.value?.status === 'running' && runToken.value === pollToken) {
        await new Promise((resolve) => setTimeout(resolve, 250))
        const nextRun = await request(`/api/workflows/${workflowId}/runs/${runId}`)
        if (runToken.value !== pollToken || activeWorkflow.value?.id !== workflowId) return
        run.value = nextRun
        nodeRuns.value = targetNodeId ? mergeNodeRuns(nodeRuns.value, nextRun.nodeRuns) : nextRun.nodeRuns
        materializeImageBatches(nextRun)
        if (nextRun.status === 'succeeded' && !downloadedExportRuns.has(nextRun.id)) {
          downloadedExportRuns.add(nextRun.id)
          for (const [nodeId, nodeRun] of Object.entries(nextRun.nodeRuns)) {
            if (nodes.value.find((node) => node.id === nodeId)?.data.workflowType === 'export-model') downloadExport(nodeRun)
          }
        }
      }
    } catch (caught) {
      error.value = caught.message
    } finally {
      busy.value = false
    }
  }

  return { isRunning, runDetails, runSummary, runWorkflow }
}
