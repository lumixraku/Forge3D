// Builds the per-run provider that `executeExecution` calls for each node.
// Returns null when Meshy is not configured, which leaves the whole canvas on
// the simulated producer.

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
