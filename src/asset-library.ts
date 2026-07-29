// Aggregate every produced asset from a workflow's nodes into the three library
// buckets (reference / 2D / 3D). Purely derived — the canvas data is untouched.
const MODEL_ASSET_TYPES = new Set(['generate-model', 'text-to-3d', 'multiview-to-3d', 'smart-mesh', 'texture', 'retopology', 'bake', 'rigging', 'segments', 'model-preview', 'export-model'])

interface AssetNode {
  id: string
  type?: string
  data?: { label?: string; workflowType?: string; config?: Record<string, any> }
}

export function buildAssetLibrary(nodes: AssetNode[]) {
  const reference = [], images = [], models = []
  for (const node of nodes) {
    if (node.type !== 'workflow') continue
    const type = node.data?.workflowType
    const config = node.data?.config || {}
    const label = node.data?.label || type
    if (type === 'reference-image') {
      const src = config.selectedPreview || config.preview
      if (src) reference.push({ id: node.id, src, label, nodeId: node.id })
    } else if (type === 'generate-image' || type === 'generated-image') {
      const previews = Array.isArray(config.previews) && config.previews.length ? config.previews : [config.selectedPreview || config.preview].filter(Boolean)
      previews.forEach((src, i) => src && images.push({ id: `${node.id}-${i}`, src, label, nodeId: node.id }))
    } else if (MODEL_ASSET_TYPES.has(type)) {
      const src = config.selectedPreview || config.preview
      if (src) models.push({ id: node.id, src, label, nodeId: node.id })
    }
  }
  return { reference, images, models, total: reference.length + images.length + models.length }
}

export function buildAssetRails(library: ReturnType<typeof buildAssetLibrary>) {
  return [
    { key: 'reference', title: 'Reference', badge: 'REF', items: library.reference },
    { key: 'images', title: '2D Assets', badge: '2D', items: library.images },
    { key: 'models', title: '3D Assets', badge: '3D', items: library.models },
  ]
}
