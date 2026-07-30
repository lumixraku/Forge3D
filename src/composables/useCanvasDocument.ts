import { ref } from 'vue'
import { request } from '../api'
import { toCanvasGraph, toDomainCanvas } from '../canvas-graph'
import { importPlacementOffset, validateImportedCanvas } from '../canvas-fragment'

// Owns the loaded canvas document: hydrating it onto the canvas, folding the
// canvas back into it, the debounced save queue, and the canvas library CRUD.
export function useCanvasDocument({
  canvases,
  activeCanvas,
  conversation,
  nodes,
  edges,
  run,
  nodeRuns,
  busy,
  error,
  saving,
  savedState,
  runToken,
  fitView,
  recordHistory,
  syncHistoryCanvas,
  fitFramesAfterRender,
  loadConversation,
  restoreTurns,
  pasteFragment,
  resetWorkspace,
  closeCanvasSwitcher,
}) {
  const hydrating = ref(false)
  let saveTimer
  let savePromise = null
  let pendingSaveSnapshot = null

  async function toCanvas(canvas) {
    hydrating.value = true
    const graph = toCanvasGraph(canvas)
    nodes.value = graph.nodes
    edges.value = graph.edges
    // Repair canvases whose views were materialized before they were wired to the model node.
    await fitFramesAfterRender({ persist: true })
    hydrating.value = false
    syncHistoryCanvas(canvas.id)
  }

  function fromCanvas() {
    return toDomainCanvas(activeCanvas.value, nodes.value, edges.value)
  }

  async function loadCanvasList() {
    canvases.value = await request('/api/canvases')
  }

  // The switcher only shows each canvas's name, node count and revision, so a
  // canvas we just fetched can refresh its own row. Saving or an Agent turn
  // cannot change any other row, and re-fetching the whole list would.
  function syncCanvasSummary(canvas) {
    const summary = { ...canvas, nodeCount: canvas.nodes.length, edgeCount: canvas.edges.length }
    delete summary.nodes
    delete summary.edges
    const index = canvases.value.findIndex((item) => item.id === canvas.id)
    if (index < 0) canvases.value = [...canvases.value, summary]
    else canvases.value = canvases.value.map((item, at) => (at === index ? summary : item))
  }

  async function loadCanvass(preferredId?: string) {
    await loadCanvasList()
    const id = preferredId || activeCanvas.value?.id || canvases.value[0]?.id
    if (id) await openCanvas(id)
  }

  async function openCanvas(id) {
    resetWorkspace()
    if (activeCanvas.value && activeCanvas.value.id !== id) await flushPendingSave()
    runToken.value += 1
    error.value = ''
    const data = await request(`/api/canvases/${id}`)
    activeCanvas.value = data.canvas
    run.value = null
    nodeRuns.value = data.nodeRuns || {}
    await toCanvas(data.canvas)
    await loadConversation(id)
    await restoreTurns(id)
    fitView({ padding: 0.18, duration: 500 })
  }

  function scheduleSave() {
    if (!activeCanvas.value || busy.value || hydrating.value) return
    recordHistory()
    savedState.value = 'Unsaved changes'
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      saveCanvas(fromCanvas())
    }, 700)
  }

  async function flushPendingSave() {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
      await saveCanvas(fromCanvas())
    } else if (savePromise) {
      await savePromise
    }
  }

  async function saveCanvas(canvas = fromCanvas()) {
    if (!canvas) return
    if (saving.value) {
      pendingSaveSnapshot = canvas
      return savePromise
    }
    saving.value = true
    savedState.value = 'Saving…'
    savePromise = (async () => {
      let nextCanvas = canvas
      while (nextCanvas) {
        const savingCanvas = nextCanvas
        pendingSaveSnapshot = null
        const savedCanvas = await request(`/api/canvases/${savingCanvas.id}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(savingCanvas),
        })
        if (activeCanvas.value?.id === savedCanvas.id) activeCanvas.value = savedCanvas
        syncCanvasSummary(savedCanvas)
        nextCanvas = pendingSaveSnapshot
      }
    })()
    try {
      await savePromise
      savedState.value = 'Saved'
    } catch (caught) {
      error.value = caught.message
      savedState.value = 'Save failed'
    } finally {
      saving.value = false
      savePromise = null
    }
  }

  function stopPendingSave() {
    clearTimeout(saveTimer)
  }

  async function duplicateCanvas(canvasId = activeCanvas.value?.id) {
    if (!canvasId) return
    try {
      const canvas = await request(`/api/canvases/${canvasId}/duplicate`, { method: 'POST' })
      await loadCanvass(canvas.id)
    } catch (caught) {
      error.value = caught.message
    }
  }

  async function deleteCanvas(canvasId) {
    const canvas = canvases.value.find((item) => item.id === canvasId)
    if (!canvas || !window.confirm(`Delete "${canvas.name}"? This cannot be undone.`)) return

    try {
      const deletingActiveCanvas = activeCanvas.value?.id === canvasId
      if (deletingActiveCanvas) await flushPendingSave()
      await request(`/api/canvases/${canvasId}`, { method: 'DELETE' })
      await loadCanvasList()
      if (!deletingActiveCanvas) return

      activeCanvas.value = null
      conversation.value = null
      nodes.value = []
      edges.value = []
      run.value = null
      nodeRuns.value = {}
      if (canvases.value[0]) await openCanvas(canvases.value[0].id)
    } catch (caught) {
      error.value = caught.message
    }
  }

  async function createCanvas() {
    const name = window.prompt('Name this canvas', 'New 3D canvas')?.trim()
    if (!name) return

    try {
      const canvas = await request('/api/canvases', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          description: 'A new 3D production canvas ready to customize.',
          nodes: [],
          edges: [],
          viewport: { x: 80, y: 160, zoom: 0.72 },
        }),
      })
      await loadCanvass(canvas.id)
    } catch (caught) {
      error.value = caught.message
    }
  }

  async function renameCanvas(name) {
    activeCanvas.value = { ...activeCanvas.value, name }
    await saveCanvas()
  }

  async function exportCanvas(canvasId) {
    try {
      const { canvas } = await request(`/api/canvases/${canvasId}`)
      const blob = new Blob([`${JSON.stringify(canvas, null, 2)}\n`], { type: 'application/json' })
      const anchor = document.createElement('a')
      anchor.href = URL.createObjectURL(blob)
      anchor.download = `${canvas.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.canvas.json`
      anchor.click()
      URL.revokeObjectURL(anchor.href)
    } catch (caught) {
      error.value = `Canvas export failed: ${caught.message}`
    }
  }

  // An imported document is merged into the open canvas as a pasted fragment.
  async function importCanvasFile(file) {
    if (!file) return

    try {
      const input = JSON.parse(await file.text())
      if (!activeCanvas.value) throw new Error('Open a canvas before importing')
      validateImportedCanvas(input)
      await pasteFragment(
        { nodes: input.nodes, edges: input.edges || [] },
        { offset: importPlacementOffset(nodes.value, input.nodes), translateRoots: true },
      )
      closeCanvasSwitcher()
    } catch (caught) {
      error.value = `Canvas import failed: ${caught.message}`
    }
  }

  return {
    hydrating,
    toCanvas,
    fromCanvas,
    syncCanvasSummary,
    loadCanvass,
    openCanvas,
    scheduleSave,
    flushPendingSave,
    saveCanvas,
    stopPendingSave,
    duplicateCanvas,
    deleteCanvas,
    createCanvas,
    renameCanvas,
    exportCanvas,
    importCanvasFile,
  }
}
