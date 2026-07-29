export type NodeRunMap = Record<string, NodeRun>

export interface NodeRun {
  status: string
  durationMs?: number | null
  error?: string | null
  output?: {
    message?: string
    preview?: string
    previews?: string[]
    viewPreviews?: Record<string, string>
    [key: string]: unknown
  } | null
  [key: string]: unknown
}

export function mergeNodeRuns(current: NodeRunMap, incoming: NodeRunMap): NodeRunMap {
  return { ...current, ...incoming }
}
