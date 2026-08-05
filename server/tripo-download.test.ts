import assert from 'node:assert/strict'
import test from 'node:test'
import { createApi } from './api-core.js'

function context(overrides = {}) {
  const state = {
    canvases: [],
    sessions: [],
    turns: [],
    agentTraces: [],
    runs: [{ id: 'run-1', nodeRuns: { export: { tripoTaskId: 'task-owned' } } }],
  }
  return {
    store: { state, persist: async () => {}, reload: async () => {}, removeCanvas: async () => {} },
    config: {
      deepseek: {},
      createTripoProvider: null,
      readAsset: null,
      getTripoTask: async () => ({ output: { model_url: 'https://cdn.tripo3d.ai/fresh.glb?expires=later' } }),
      ...overrides,
    },
    waitUntil: () => {},
    recoverAgentTurns: false,
  }
}

test('refreshes an owned Tripo task and redirects to its latest model url', async () => {
  const seen = []
  const handle = createApi({ createContext: () => context({
    getTripoTask: async (taskId) => {
      seen.push(taskId)
      return { output: { model_url: 'https://cdn.tripo3d.ai/fresh.glb?expires=later' } }
    },
  }) })

  const response = await handle(new Request('https://forge.test/api/tripo/tasks/task-owned/download', { redirect: 'manual' }), {})

  assert.equal(response.status, 302)
  assert.equal(response.headers.get('location'), 'https://cdn.tripo3d.ai/fresh.glb?expires=later')
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(seen, ['task-owned'])
})

test('does not query arbitrary Tripo task ids', async () => {
  const handle = createApi({ createContext: () => context({
    getTripoTask: async () => assert.fail('unowned task must not be queried'),
  }) })

  const response = await handle(new Request('https://forge.test/api/tripo/tasks/task-other/download'), {})

  assert.equal(response.status, 404)
})
