// Group the execution-history assets returned by `GET /api/canvases/:id/assets` into
// the three library rails. The server already ordered them newest run first.
export interface RunAsset {
  id: string
  runId: string
  executionId: string
  nodeId: string
  nodeType: string
  label: string
  kind: 'reference' | 'image' | 'model'
  src: string
  downloads?: { downloadUrl?: string; filename?: string; format?: string }[]
  createdAt: string
}

export function buildAssetLibrary(assets: RunAsset[]) {
  const reference = assets.filter((asset) => asset.kind === 'reference')
  const images = assets.filter((asset) => asset.kind === 'image')
  const models = assets.filter((asset) => asset.kind === 'model')
  return { reference, images, models, total: reference.length + images.length + models.length }
}

export function buildAssetRails(library: ReturnType<typeof buildAssetLibrary>) {
  return [
    { key: 'reference', title: 'Reference', badge: 'REF', items: library.reference },
    { key: 'images', title: '2D Assets', badge: '2D', items: library.images },
    { key: 'models', title: '3D Assets', badge: '3D', items: library.models },
  ]
}

// Runs are labelled by recency so repeated runs of one canvas stay tellable
// apart on the cards: the newest is "Latest", then "Run -1", "Run -2"...
export function buildRunLabels(assets: RunAsset[]) {
  const labels = new Map<string, string>()
  for (const asset of assets) {
    if (labels.has(asset.runId)) continue
    labels.set(asset.runId, labels.size === 0 ? 'Latest' : `Run -${labels.size}`)
  }
  return labels
}
