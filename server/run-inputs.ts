// Shared input resolution for Tripo and Meshy. This file stays free of Node
// built-ins so the Cloudflare Worker can import the Meshy runner.

import { nodeOutputPortValues, resolveInputSources, resolveNodeInputs } from '@forge3d/canvas-core'

function inboundSources(node, canvas) {
  const nodesById = new Map(canvas.nodes.map((item) => [item.id, item]))
  return (canvas.edges || [])
    .filter((edge) => edge.target?.nodeId === node.id)
    .map((edge) => nodesById.get(edge.source?.nodeId))
    .filter(Boolean)
}

export { inboundSources }

/**
 * The prompt this node runs with: its own field first, then whatever text its
 * declared text ports carry.
 */
export function resolvePrompt(node, canvas) {
  const own = typeof node.config?.prompt === 'string' ? node.config.prompt.trim() : ''
  if (own) return own
  const text = resolveNodeInputs(node, canvas).text
  return typeof text === 'string' ? text.trim() : ''
}

/**
 * The thumbnail of the nearest upstream node that produced one this run.
 */
export function resolveUpstreamPreview(node, canvas, context) {
  const seen = new Set([node.id])
  let frontier = inboundSources(node, canvas)
  while (frontier.length) {
    const next = []
    for (const source of frontier) {
      if (seen.has(source.id)) continue
      seen.add(source.id)
      const produced = context.get(source.id)
      if (produced?.preview) return produced.preview
      next.push(...inboundSources(source, canvas))
    }
    frontier = next
  }
  return null
}

/**
 * Resolves generate-model's image inputs for this run. Returns `{ input }` for
 * one image, `{ multiview }` for several, or `{}` when nothing came in so the
 * node falls back to text.
 *
 * `toInput` turns a reference into whatever the provider accepts. With
 * `labeledViews` the multiview result is a list of view-key objects; without it
 * the views come back as a plain ordered list, front first.
 */
export async function resolveGenerateModelImages(node, canvas, context, { toInput, labeledViews = true }) {
  const sources = resolveInputSources(node, canvas)
  const views = {}
  for (const key of ['front', 'back', 'left', 'right']) {
    const source = (sources[key] || [])[0]
    if (!source) continue
    const value = nodeOutputPortValues(source.node, context.get(source.node.id))[source.portId]
    if (value) views[key] = value
  }
  const viewKeys = Object.keys(views)
  if (viewKeys.length >= 2 && views.front) {
    const inputs = []
    for (const key of viewKeys) {
      const resolved = await toInput(views[key])
      inputs.push(labeledViews ? { [key]: resolved } : resolved)
    }
    return { multiview: inputs }
  }
  const loose = (sources.image || [])
    .map((source) => nodeOutputPortValues(source.node, context.get(source.node.id))[source.portId])
    .filter(Boolean)
  if (loose.length > 1) {
    const inputs = []
    for (const url of loose) inputs.push(await toInput(url))
    return { multiview: inputs }
  }
  if (loose.length === 1) return { input: await toInput(loose[0]) }
  return {}
}
