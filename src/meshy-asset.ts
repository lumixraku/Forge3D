// Meshy hands back a signed assets.meshy.ai URL. It stops working at the task's
// expires_at. The execution still has the task id, and these routes ask Meshy
// for the file again while the task is retained.

export function isMeshyAssetUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false
  try {
    return new URL(value).hostname === 'assets.meshy.ai'
  } catch {
    return false
  }
}

export function meshyAssetHref(generated: { resultOf?: { runId?: string; sourceId?: string } } | null | undefined, kind: 'model' | 'preview', raw: unknown) {
  if (typeof raw !== 'string' || !raw) return ''
  const runId = generated?.resultOf?.runId
  const nodeId = generated?.resultOf?.sourceId
  if (!runId || !nodeId || !isMeshyAssetUrl(raw)) return raw
  return `/api/executions/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/${kind}`
}
