import { nodeOutputPorts } from './canvas-nodes'

/**
 * One artifact a successful run produced, as a result node to materialize.
 *
 * `generatedAssets` is what the result node shows and what a downstream node
 * reads when it is wired off the result. `resultOf` records which node and run
 * made it, which is how a rerun finds and replaces the previous batch.
 */
export interface ResultArtifact {
  type: string
  generatedAssets: Record<string, unknown>
}

interface NodeRunOutput {
  preview?: unknown
  previews?: unknown
  viewPreviews?: unknown
  modelUrl?: unknown
  outputs?: unknown
  downloadUrl?: unknown
  [key: string]: unknown
}

/**
 * Splits one node's run output into the result nodes it should produce.
 *
 * Which result kind a stage yields follows its declared output ports rather than
 * a list repeated here: a model output becomes a model result, image outputs
 * become image results (one per view or candidate), and export becomes a
 * downloadable file result. Inputs, containers, and gates produce nothing.
 */
export function resultArtifacts(
  sourceType: string,
  output: NodeRunOutput | null | undefined,
  resultOf: { runId: string; sourceId: string },
  { allowEmpty = false } = {},
): ResultArtifact[] {
  if (!output) {
    if (!allowEmpty) return []
    output = {}
  }
  // A review node passes an image through; the image is already the upstream
  // result, so materializing another would only duplicate it.
  if (sourceType === 'review') return []
  // The stage that made the artifact travels with it, so the Model Editor can
  // still open a rig or segmented result in the right visualization mode.
  const origin = { ...resultOf, sourceType }

  if (sourceType === 'export-model') {
    const downloads = Array.isArray(output.outputs)
      ? output.outputs
      : output.downloadUrl ? [{ downloadUrl: output.downloadUrl, filename: output.filename, format: output.format }] : []
    return [{
      type: 'generated-export',
      generatedAssets: { preview: output.preview, modelUrl: output.modelUrl, outputs: downloads, resultOf: origin },
    }]
  }

  const outputPorts = nodeOutputPorts(sourceType)
  if (outputPorts.some((port) => port.type === 'model')) {
    return [{
      type: 'generated-model',
      generatedAssets: { preview: output.preview, modelUrl: output.modelUrl, resultOf: origin },
    }]
  }
  // Only a stage that declares an image output yields image results; a text-only
  // node with a stray preview must not gain one.
  if (!outputPorts.some((port) => port.type === 'image' || port.type === 'any')) return []

  const viewPreviews = output.viewPreviews
  if (viewPreviews && typeof viewPreviews === 'object' && !Array.isArray(viewPreviews) && Object.keys(viewPreviews).length) {
    return Object.entries(viewPreviews as Record<string, unknown>)
      .filter(([, preview]) => typeof preview === 'string' && preview)
      .map(([view, preview], index) => ({ type: 'generated-image', generatedAssets: { preview, view, index, resultOf: origin } }))
  }

  const previews = Array.isArray(output.previews) ? output.previews.filter((preview): preview is string => typeof preview === 'string' && preview.length > 0) : []
  if (previews.length) {
    return previews.map((preview, index) => ({ type: 'generated-image', generatedAssets: { preview, index, resultOf: origin } }))
  }

  if (typeof output.preview === 'string' && output.preview) {
    return [{ type: 'generated-image', generatedAssets: { preview: output.preview, resultOf: origin } }]
  }
  if (allowEmpty) {
    // A successful provider may omit a preview URL. The successful run still
    // needs a visible result node so the result can be inspected or re-run.
    return [{ type: 'generated-image', generatedAssets: { resultOf: origin } }]
  }
  return []
}
