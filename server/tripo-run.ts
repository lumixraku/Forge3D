// Builds the per-run provider that `executeExecution` calls for each node.
// Returns null when Tripo is not configured, which leaves the whole canvas on
// the simulated producer.

import { createTripoClient, isTripoConfigured } from './tripo.js'
import { executeTripoNode } from './tripo-provider.js'

export function createTripoRunner(env = process.env) {
  if (!isTripoConfigured(env)) return null
  const client = createTripoClient({ apiKey: env.TRIPO_API_KEY, baseUrl: env.TRIPO_BASE_URL })

  return function createProvider({ context, run, onUpdate, canvas: fullCanvas = null }) {
    // File tokens are cached for the whole run, so a reference image feeding two
    // nodes is uploaded once.
    const uploads = new Map()
    return async function provider(node, executionCanvas) {
      // A single-node run prunes every edge, so inputs are resolved against the
      // full canvas when the caller supplied it.
      return executeTripoNode(node, fullCanvas || executionCanvas, {
        client,
        context,
        uploads,
        // Progress is written onto the node run so the canvas can show a percentage
        // while a task that takes minutes is still running.
        onProgress: async ({ tripoTaskId, progress }) => {
          const nodeRun = run.nodeRuns?.[node.id]
          if (!nodeRun) return
          nodeRun.tripoTaskId = tripoTaskId
          nodeRun.progress = progress
          await onUpdate()
        },
      })
    }
  }
}
