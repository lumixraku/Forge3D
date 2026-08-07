import { computed, ref } from 'vue'
import { request } from '../api'
import { planNodes } from '../run-plan'
import { formatDuration, summarizeRun } from '../run-summary'

// A simulated node settles in well under a second, but a real Tripo task takes
// tens of seconds and Tripo asks for 1-2s polling, so the interval follows
// whichever backend the run is actually using.
const POLL_INTERVAL_MS = { mock: 250, tripo: 1500 }

type ExecutionMode = 'node' | 'downstream'
type ExecutionStatus = 'queued' | 'running' | 'cancelling' | 'cancelled' | 'succeeded' | 'failed'
type NodeExecutionStatus = ExecutionStatus | 'skipped' | 'waiting_review'

interface ExecutionOutput {
  outputs?: { downloadUrl?: string; filename?: string; format?: string }[]
  downloadUrl?: string
  filename?: string
  format?: string
  previews?: string[]
}

interface NodeExecution {
  status: NodeExecutionStatus
  durationMs: number | null
  output: ExecutionOutput | null
  error: string | null
  progress?: number
}

interface ExecutionDto {
  id: string
  entryNodeId: string | null
  mode: ExecutionMode
  status: ExecutionStatus
  nodeExecutions: Record<string, NodeExecution>
}

interface CanvasRun {
  id: string | null
  entryNodeId: string | null
  mode: ExecutionMode
  status: ExecutionStatus
  nodeRuns: Record<string, NodeExecution>
}

function toCanvasRun(execution: ExecutionDto): CanvasRun {
  return {
    id: execution.id,
    entryNodeId: execution.entryNodeId,
    mode: execution.mode,
    status: execution.status,
    nodeRuns: execution.nodeExecutions,
  }
}

export function useCanvasRun({ activeCanvas, nodes, edges, run, nodeRuns, busy, error, runToken, saveCanvas, materializeRunBatch, provider = { value: null } }) {
  const cancelRequested = ref(false)
  const isRunning = computed(() => ['running', 'cancelling'].includes(run.value?.status))
  const runDetails = computed(() => summarizeRun(run.value, nodes.value))
  const runSummary = computed(() => {
    if (!run.value) return 'Ready to run'
    const steps = Object.values(run.value.nodeRuns)
    const completed = steps.filter((nodeRun) => ['succeeded', 'failed'].includes(nodeRun.status)).length
    const totalDurationMs = steps.reduce((total, nodeRun) => total + (nodeRun.durationMs || 0), 0)
    const duration = totalDurationMs ? ` · ${formatDuration(totalDurationMs)}` : ''
    return ['running', 'cancelling'].includes(run.value.status) ? `Running · ${completed}/${steps.length} steps${duration}` : `${steps.length} steps · ${run.value.status}${duration}`
  })

  function downloadExport(nodeRun) {
    const outputs = nodeRun?.output?.outputs || (nodeRun?.output?.downloadUrl ? [nodeRun.output] : [])
    for (const output of outputs) {
      if (!output.downloadUrl) continue
      const anchor = document.createElement('a')
      anchor.href = output.downloadUrl
      anchor.download = output.filename || `model.${String(output.format || 'glb').toLowerCase()}`
      // Chrome ignores a download click from an anchor that is not in the
      // document, so it has to be attached for the duration of the click.
      anchor.style.display = 'none'
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
    }
  }

  async function runCanvas(targetNodeId?: string, scope: ExecutionMode = 'node') {
    if (!activeCanvas.value || !targetNodeId || busy.value || isRunning.value) return
    busy.value = true
    cancelRequested.value = false
    error.value = ''
    const pollToken = ++runToken.value
    try {
      await saveCanvas()
      const plan = planNodes(nodes.value, edges.value, targetNodeId, scope)
      if (!plan.length) return

      // Queue the whole plan up front so the canvas shows what is pending.
      const planned: Record<string, NodeExecution> = Object.fromEntries(plan.map((node, index) => [node.id, { status: index === 0 ? 'running' : 'queued', durationMs: null, output: null, error: null }]))
      run.value = { id: null, entryNodeId: targetNodeId, mode: scope, status: 'running', nodeRuns: planned }
      nodeRuns.value = targetNodeId ? { ...nodeRuns.value, ...planned } : planned
      busy.value = false

      const canvasId = activeCanvas.value.id
      const execution = await request(`/api/nodes/${targetNodeId}/executions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: scope === 'downstream' ? 'downstream' : 'node',
          // Omitted entirely when no override is set, so the server keeps deciding.
          ...(provider.value ? { provider: provider.value } : {}),
        }),
      }) as ExecutionDto
      if (runToken.value !== pollToken || activeCanvas.value?.id !== canvasId) return
      const pollInterval = POLL_INTERVAL_MS[provider.value === 'mock' ? 'mock' : 'tripo']
      run.value = toCanvasRun(execution)
      if (cancelRequested.value) await cancelRun()
      while (['queued', 'running', 'cancelling'].includes(run.value.status) && runToken.value === pollToken) {
        await new Promise((resolve) => setTimeout(resolve, pollInterval))
        const current = await request(`/api/executions/${execution.id}`) as ExecutionDto
        if (runToken.value !== pollToken || activeCanvas.value?.id !== canvasId) return
        run.value = toCanvasRun(current)
        nodeRuns.value = { ...nodeRuns.value, ...current.nodeExecutions }
      }
      for (const node of plan) {
        const nodeRun = run.value.nodeRuns[node.id]
        if (!nodeRun) continue
        const previews = nodeRun.output?.previews
        if (node.data?.canvasType === 'generate-image' && Array.isArray(previews) && previews.length) materializeRunBatch(node.id, run.value.id, previews)
        if (node.data?.canvasType === 'export-model') downloadExport(nodeRun)
      }
    } catch (caught) {
      error.value = caught.message
      // Mark whichever node was mid-flight as failed so the canvas stops spinning.
      if (run.value) {
        const nodeRunEntries = Object.entries(run.value.nodeRuns).map(([id, nodeRun]) => (
          ['running', 'queued'].includes(nodeRun.status) ? [id, { ...nodeRun, status: 'failed', error: caught.message }] : [id, nodeRun]
        ))
        run.value = { ...run.value, status: 'failed', nodeRuns: Object.fromEntries(nodeRunEntries) }
        nodeRuns.value = { ...nodeRuns.value, ...run.value.nodeRuns }
      }
    } finally {
      busy.value = false
    }
  }

  async function cancelRun() {
    if (!isRunning.value) return
    cancelRequested.value = true
    if (!run.value?.id) return
    error.value = ''
    try {
      const cancelled = await request(`/api/executions/${run.value.id}/cancel`, { method: 'POST' }) as ExecutionDto
      run.value = toCanvasRun(cancelled)
      nodeRuns.value = { ...nodeRuns.value, ...cancelled.nodeExecutions }
    } catch (caught) {
      error.value = caught.message
    }
  }

  return { isRunning, runDetails, runSummary, runCanvas, cancelRun }
}
