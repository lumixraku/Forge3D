// Builds the per-run provider that `executeExecution` calls for each node.
// Returns null when Meshy is not configured; the API rejects that mode before
// creating a run.

import { createMeshyClient, isMeshyConfigured } from './meshy.js'
import { executeMeshyNode } from './meshy-provider.js'

export function createMeshyRunner(env = process.env, { readAsset } = {}) {
  if (!isMeshyConfigured(env)) return null
  const client = createMeshyClient({ apiKey: env.MESHY_API_KEY, baseUrl: env.MESHY_BASE_URL })

  return function createProvider({ context, run, onUpdate, canvas: fullCanvas = null }) {
    return async function provider(node, executionCanvas) {
      // A single-node run prunes every edge, so inputs are resolved against the
      // full canvas when the caller supplied it.
      return executeMeshyNode(node, fullCanvas || executionCanvas, {
        client,
        context,
        readAsset,
        // Progress is written onto the node run so the canvas can show a percentage
        // while a task that takes minutes is still running.
        onProgress: async ({ meshyTaskId, progress }) => {
          const nodeRun = run.nodeRuns?.[node.id]
          if (!nodeRun) return
          nodeRun.meshyTaskId = meshyTaskId
          nodeRun.progress = progress
          await onUpdate()
        },
      })
    }
  }
}

export function createMeshyTaskReader(env = process.env) {
  if (!isMeshyConfigured(env)) return null
  const client = createMeshyClient({ apiKey: env.MESHY_API_KEY, baseUrl: env.MESHY_BASE_URL })
  const endpoints = [
    '/openapi/v2/text-to-3d', '/openapi/v1/image-to-3d', '/openapi/v1/multi-image-to-3d',
    '/openapi/v1/text-to-image', '/openapi/v1/image-to-image', '/openapi/v1/text-to-motion',
    '/openapi/v1/remesh', '/openapi/v1/retexture', '/openapi/v1/rigging', '/openapi/v1/animations',
    '/openapi/v1/convert', '/openapi/v1/resize', '/openapi/v1/uv-unwrap',
    '/openapi/v1/print/analyze', '/openapi/v1/print/repair', '/openapi/v1/print/multi-color', '/openapi/v1/print/split',
    '/openapi/creative-lab/keychain/v1/build', '/openapi/creative-lab/fridge-magnet/v1/build',
    '/openapi/creative-lab/figure/v1/build', '/openapi/creative-lab/vinyl-figure/v1/build',
    '/openapi/creative-lab/brick-figure/v1/build', '/openapi/creative-lab/lamp/v1/build',
    '/openapi/creative-lab/keycap/v1/build', '/openapi/creative-lab/fidget-pixel/v1/build',
    '/openapi/creative-lab/fidget-collapsible/v1',
  ]

  return async (taskId, endpoint = null) => {
    if (endpoint) return client.getTask(endpoint, taskId)
    let lastFailure
    for (const candidate of endpoints) {
      try {
        return await client.getTask(candidate, taskId)
      } catch (failure) {
        lastFailure = failure
      }
    }
    throw lastFailure
  }
}
