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
  parameters?: Record<string, Record<string, unknown>>
  createdAt?: string
  completedAt?: string | null
}

interface CanvasRun {
  id: string | null
  entryNodeId: string | null
  mode: ExecutionMode
  status: ExecutionStatus
  nodeRuns: Record<string, NodeExecution>
  parameters?: Record<string, Record<string, unknown>>
  createdAt?: string
  completedAt?: string | null
}

function toCanvasRun(execution: ExecutionDto): CanvasRun {
  return {
    id: execution.id,
    entryNodeId: execution.entryNodeId,
    mode: execution.mode,
    status: execution.status,
    nodeRuns: execution.nodeExecutions,
    parameters: execution.parameters,
    createdAt: execution.createdAt,
    completedAt: execution.completedAt,
  }
}

export function useCanvasRun({ activeCanvas, nodes, edges, run, nodeRuns, canvasBusy, error, runToken, flushPendingSave, materializeRunBatch, onAccountChanged = async () => {}, provider = { value: null } }) {
  const activeExecutions = ref<Record<string, CanvasRun>>({})
  const executions = ref([])
  const executionsLoading = ref(false)
  const isRunning = computed(() => Object.values(activeExecutions.value).some((execution) => ['queued', 'running', 'cancelling'].includes(execution.status)))
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

  async function loadExecutions(canvasId = activeCanvas.value?.id) {
    if (!canvasId) {
      executions.value = []
      return
    }
    executionsLoading.value = true
    try {
      executions.value = await request(`/api/canvases/${canvasId}/executions`)
    } catch (caught) {
      error.value = caught.message
    } finally {
      executionsLoading.value = false
    }
  }

  async function runCanvas(targetNodeId?: string, scope: ExecutionMode = 'node') {
    if (!activeCanvas.value || !targetNodeId || canvasBusy.value) return
    canvasBusy.value = true
    error.value = ''
    const pollToken = ++runToken.value
    try {
      const plan = planNodes(nodes.value, edges.value, targetNodeId, scope)
      if (!plan.length) return
      const parameters = Object.fromEntries(plan.map((node) => [node.id, JSON.parse(JSON.stringify(node.data?.config || {}))]))

      // Queue the whole plan up front so the canvas shows what is pending.
      const planned: Record<string, NodeExecution> = Object.fromEntries(plan.map((node, index) => [node.id, { status: index === 0 ? 'running' : 'queued', durationMs: null, output: null, error: null }]))
      run.value = { id: null, entryNodeId: targetNodeId, mode: scope, status: 'running', nodeRuns: planned, parameters }
      nodeRuns.value = targetNodeId ? { ...nodeRuns.value, ...planned } : planned
      canvasBusy.value = false

      const canvasId = activeCanvas.value.id
      const createRun = request(`/api/projects/${encodeURIComponent(canvasId)}/executions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          canvasId,
          entryNodeId: targetNodeId,
          nodeIds: plan.map((node) => node.id),
          mode: scope === 'downstream' ? 'downstream' : 'node',
          idempotencyKey: crypto.randomUUID(),
          parameters,
          // Omitted entirely when no override is set, so the server keeps deciding.
          ...(provider.value ? { provider: provider.value } : {}),
        }),
      }) as Promise<ExecutionDto>
      // A run executes the canvas as it stands, so the queued save cannot be left
      // waiting out its debounce behind the request that reads the saved document.
      const [, execution] = await Promise.all([flushPendingSave({ detectChanges: true }), createRun])
      run.value = toCanvasRun(execution)
      await onAccountChanged()
      if (runToken.value !== pollToken || activeCanvas.value?.id !== canvasId) return
      const pollInterval = POLL_INTERVAL_MS[provider.value === 'mock' ? 'mock' : 'tripo']
      activeExecutions.value = { ...activeExecutions.value, [execution.id]: run.value }
      void pollExecution(execution, plan, canvasId, pollToken, pollInterval)
      await loadExecutions(canvasId)
    } catch (caught) {
      error.value = caught.message
      if (!run.value?.id && runToken.value === pollToken) {
        run.value = { ...run.value, status: 'failed', nodeRuns: Object.fromEntries(Object.entries(run.value?.nodeRuns || {}).map(([nodeId, nodeRun]) => [nodeId, { ...nodeRun, status: 'failed', error: caught.message }])) }
        nodeRuns.value = { ...nodeRuns.value, ...run.value.nodeRuns }
      }
      // Mark whichever node was mid-flight as failed so the canvas stops spinning.
      if (run.value) {
        const nodeRunEntries = Object.entries(run.value.nodeRuns).map(([id, nodeRun]) => (
          ['running', 'queued'].includes(nodeRun.status) ? [id, { ...nodeRun, status: 'failed', error: caught.message }] : [id, nodeRun]
        ))
        run.value = { ...run.value, status: 'failed', nodeRuns: Object.fromEntries(nodeRunEntries) }
        nodeRuns.value = { ...nodeRuns.value, ...run.value.nodeRuns }
      }
    } finally {
      canvasBusy.value = false
    }
  }

  async function pollExecution(execution: ExecutionDto, plan: any[], canvasId: string, pollToken: number, pollInterval: number) {
    try {
      let current = toCanvasRun(execution)
      while (['queued', 'running', 'cancelling'].includes(current.status) && activeCanvas.value?.id === canvasId) {
        await new Promise((resolve) => setTimeout(resolve, pollInterval))
        current = toCanvasRun(await request(`/api/executions/${execution.id}`) as ExecutionDto)
        activeExecutions.value = { ...activeExecutions.value, [execution.id]: current }
        run.value = current
        nodeRuns.value = { ...nodeRuns.value, ...current.nodeRuns }
      }
      for (const node of plan) {
        const nodeRun = current.nodeRuns[node.id]
        if (!nodeRun) continue
        const previews = nodeRun.output?.previews
        if (node.data?.canvasType === 'generate-image' && Array.isArray(previews) && previews.length) materializeRunBatch(node.id, current.id, previews)
        if (node.data?.canvasType === 'export-model') downloadExport(nodeRun)
      }
      await loadExecutions(canvasId)
      await onAccountChanged()
    } catch (caught) {
      error.value = caught.message
    } finally {
      const { [execution.id]: _, ...remaining } = activeExecutions.value
      activeExecutions.value = remaining
    }
  }

  async function cancelRun(executionId = run.value?.id) {
    if (!executionId) return
    const active = activeExecutions.value[executionId]
    if (!active || !['queued', 'running', 'cancelling'].includes(active.status)) return
    error.value = ''
    try {
      const cancelled = toCanvasRun(await request(`/api/executions/${executionId}/cancel`, { method: 'POST' }) as ExecutionDto)
      activeExecutions.value = { ...activeExecutions.value, [executionId]: cancelled }
      run.value = cancelled
      nodeRuns.value = { ...nodeRuns.value, ...cancelled.nodeRuns }
      await onAccountChanged()
    } catch (caught) {
      error.value = caught.message
    }
  }

  return { isRunning, runDetails, runSummary, runCanvas, cancelRun, executions, executionsLoading, loadExecutions, activeExecutions }
}
