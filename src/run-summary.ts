import type { NodeRunMap } from './node-runs'

interface SummaryNode {
  id: string
  data: { label: string }
}

interface CanvasRun {
  id: string
  status: string
  nodeRuns: NodeRunMap
}

export function formatDuration(durationMs: number) {
  return durationMs >= 1000 ? `${(durationMs / 1000).toFixed(2)} s` : `${durationMs} ms`
}

export function summarizeRun(run: CanvasRun | null, nodes: SummaryNode[]) {
  if (!run) return null
  const nodeRuns = run.nodeRuns || {}
  const steps = nodes
    .filter((node) => nodeRuns[node.id])
    .map((node) => ({
      id: node.id,
      label: node.data.label,
      status: nodeRuns[node.id].status,
      durationMs: nodeRuns[node.id].durationMs,
      message: nodeRuns[node.id].error || nodeRuns[node.id].output?.message || '',
    }))
  const completed = steps.filter((step) => ['succeeded', 'failed'].includes(step.status)).length
  return {
    id: run.id,
    status: run.status,
    completed,
    total: steps.length,
    totalDurationMs: steps.reduce((total, step) => total + (step.durationMs || 0), 0),
    steps,
  }
}
