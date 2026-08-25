import test from 'node:test'
import assert from 'node:assert/strict'
import { ref } from 'vue'

// This file only covers the save path. The document also reaches for fetch and the
// localStorage draft; both are stubbed here so a save is observable as one PUT.
const saveCalls = []
// Holds the first PUT at "request sent, response not back" to test edits that land
// while a save is in flight.
let holdFirstSave = false
let releaseFirstSave = null

globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
}

globalThis.fetch = async (url, options = {}) => {
  if (options.method !== 'PUT') throw new Error(`unexpected request in this test: ${options.method} ${url}`)
  const body = JSON.parse(options.body)
  saveCalls.push(body)
  if (holdFirstSave && saveCalls.length === 1) {
    await new Promise((resolve) => { releaseFirstSave = resolve })
  }
  const canvas = { ...body.canvas, revision: body.baseRevision + 1 }
  return { ok: true, status: 200, text: async () => JSON.stringify(canvas) }
}

const { useCanvasDocument } = await import('./composables/useCanvasDocument.ts')

// A canvas the server already holds, matching the local nodes, so the starting
// state is clean.
function harness() {
  const storedNode = { id: 'n1', name: 'n1', type: 'generate-image', config: {}, ui: { position: { x: 0, y: 0 } } }
  const activeCanvas = ref({ id: 'c1', revision: 7, nodes: [storedNode], edges: [] })
  const nodes = ref([{ id: 'n1', type: 'canvas', position: { x: 0, y: 0 }, data: { label: 'n1', canvasType: 'generate-image', config: {} } }])
  const savedState = ref('')
  const saving = ref(false)
  const noop = () => {}
  const document = useCanvasDocument({
    canvases: ref([]),
    activeCanvas,
    activeSession: ref(null),
    nodes,
    edges: ref([]),
    run: ref(null),
    nodeRuns: ref({}),
    error: ref(''),
    saving,
    savedState,
    agentToken: ref(0),
    canvasRunToken: ref(0),
    fitView: noop,
    recordHistory: noop,
    syncHistoryCanvas: noop,
    fitFramesAfterRender: async () => false,
    suppressFrameFit: noop,
    loadSessions: async () => {},
    restoreTurns: async () => {},
    subscribeCanvasEvents: noop,
    closeCanvasEvents: noop,
    pasteFragment: async () => {},
    resetWorkspace: noop,
    closeCanvasSwitcher: noop,
    clientId: 'client-a',
    canvasOpened: async () => {},
    releasePresence: async () => {},
    acquireEditLease: noop,
    markEditActivity: noop,
  })
  // Move a node: the change hasUnsavedCanvasChanges recognizes. The x distinguishes
  // one edit from the next.
  const editNode = (x = 99) => {
    nodes.value = [{ ...nodes.value[0], position: { x, y: 99 } }]
  }
  return { activeCanvas, document, editNode, savedState }
}

function reset() {
  saveCalls.length = 0
  holdFirstSave = false
  releaseFirstSave = null
}

const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('saveCanvas queues by default: no request until the debounce elapses', async () => {
  reset()
  const { document, editNode } = harness()

  editNode()
  document.saveCanvas()
  assert.equal(saveCalls.length, 0)

  await tick(400)
  assert.equal(saveCalls.length, 0)
  await tick(500)
  assert.equal(saveCalls.length, 1)
})

test('saveCanvas debounces rather than throttles: a burst of edits sends one request', async () => {
  reset()
  const { document, editNode } = harness()

  for (let index = 0; index < 5; index++) {
    editNode(index + 1)
    document.saveCanvas()
    await tick(100)
  }
  assert.equal(saveCalls.length, 0)

  await tick(800)
  assert.equal(saveCalls.length, 1)
})

test('no graph difference means no request: DOM re-measurement must not save', async () => {
  reset()
  const { document, savedState } = harness()

  document.saveCanvas()

  await tick(900)
  assert.equal(saveCalls.length, 0)
  assert.equal(savedState.value, '')
})

test('immediate sends now, and the caller need not mark the canvas dirty first', async () => {
  reset()
  const { activeCanvas, document, editNode } = harness()

  editNode()
  await document.saveCanvas({ immediate: true })

  assert.equal(saveCalls.length, 1)
  assert.deepEqual(saveCalls[0].canvas.nodes[0].ui.position, { x: 99, y: 99 })
  assert.equal(activeCanvas.value.revision, 8)
})

test('immediate cancels the queued timer instead of sending twice', async () => {
  reset()
  const { document, editNode } = harness()

  editNode()
  document.saveCanvas()
  await document.saveCanvas({ immediate: true })
  assert.equal(saveCalls.length, 1)

  await tick(900)
  assert.equal(saveCalls.length, 1)
})

// An edit that lands while a request is outstanding only sets workflowDirty again;
// the loop's next pass carries the final state. Were the loop to exit after one
// send, that edit would live only in the draft and never reach the server.
test('an edit while the request is in flight is not dropped', async () => {
  reset()
  holdFirstSave = true
  const { document, editNode } = harness()

  editNode(11)
  const first = document.saveCanvas({ immediate: true })
  await tick(0)
  assert.equal(saveCalls.length, 1)
  assert.equal(saveCalls[0].canvas.nodes[0].ui.position.x, 11)

  editNode(22)
  const second = document.saveCanvas({ immediate: true })

  releaseFirstSave()
  await Promise.all([first, second])

  assert.equal(saveCalls.length, 2)
  assert.equal(saveCalls[1].canvas.nodes[0].ui.position.x, 22)
  // The second request waited for the first: it carries the revision that one
  // produced. Sent concurrently it would reuse revision 7 and the server, which
  // only accepts the revision it currently holds, would reject it.
  assert.equal(saveCalls[0].baseRevision, 7)
  assert.equal(saveCalls[1].baseRevision, 8)
})

test('immediate on an already-clean canvas sends nothing', async () => {
  reset()
  const { document } = harness()

  await document.saveCanvas({ immediate: true })

  assert.equal(saveCalls.length, 0)
})
