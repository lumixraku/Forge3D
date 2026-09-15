import test from 'node:test'
import assert from 'node:assert/strict'
import { ref } from 'vue'

// Covers picking a run back up after a reload: the composable only ever sees the
// two reads a freshly opened canvas makes, so both are stubbed here.
let executionsResponse = []
const executionReads = []
let executionById = {}

globalThis.fetch = async (url) => {
  if (url.endsWith('/executions')) {
    return { ok: true, status: 200, text: async () => JSON.stringify(executionsResponse) }
  }
  const id = url.split('/').pop()
  executionReads.push(id)
  return { ok: true, status: 200, text: async () => JSON.stringify(executionById[id]) }
}

const { useCanvasRun } = await import('./composables/useCanvasRun.ts')

function harness() {
  const run = ref(null)
  const nodeRuns = ref({})
  const canvas = useCanvasRun({
    activeCanvas: ref({ id: 'c1' }),
    nodes: ref([{ id: 'n1', type: 'canvas', data: { canvasType: 'generate-image' } }]),
    edges: ref([]),
    run,
    nodeRuns,
    canvasBusy: ref(false),
    error: ref(''),
    runToken: ref(0),
    saveCanvas: async () => {},
    materializeRunBatch: () => {},
    provider: ref('mock'),
  })
  return { canvas, run, nodeRuns }
}

async function settle(isDone) {
  for (let attempt = 0; attempt < 100 && !isDone(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

test('a task still running when the canvas opens is polled through to its output', async () => {
  const running = { id: 'run-1', entryNodeId: 'n1', mode: 'node', status: 'running', nodeExecutions: { n1: { status: 'running', durationMs: null, output: null, error: null } } }
  const finished = { ...running, status: 'succeeded', nodeExecutions: { n1: { status: 'succeeded', durationMs: 10, output: { preview: '/model.png' }, error: null } } }
  executionsResponse = [running]
  executionById = { 'run-1': finished }
  executionReads.length = 0

  const { canvas, run, nodeRuns } = harness()
  await canvas.loadExecutions('c1')

  // Restored before the first poll answers, so the canvas shows the task as
  // running rather than idle.
  assert.equal(canvas.isRunning.value, true)
  assert.equal(run.value.id, 'run-1')
  assert.equal(nodeRuns.value.n1.status, 'running')

  await settle(() => !canvas.isRunning.value)
  assert.deepEqual(executionReads, ['run-1'])
  assert.equal(nodeRuns.value.n1.status, 'succeeded')
  assert.deepEqual(nodeRuns.value.n1.output, { preview: '/model.png' })
})

test('a settled task is listed without being polled again', async () => {
  executionsResponse = [{ id: 'run-2', entryNodeId: 'n1', mode: 'node', status: 'succeeded', nodeExecutions: {} }]
  executionById = {}
  executionReads.length = 0

  const { canvas, run } = harness()
  await canvas.loadExecutions('c1')

  assert.equal(canvas.executions.value.length, 1)
  assert.equal(canvas.isRunning.value, false)
  assert.equal(run.value, null)
  assert.deepEqual(executionReads, [])
})
