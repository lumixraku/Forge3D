import { nextTick, ref } from 'vue'
import { request } from '../api'
import { reconcileCanvasGraph, toCanvasGraph, toDomainCanvas } from '../canvas-graph'
import { importPlacementOffset, validateImportedCanvas } from '../canvas-fragment'
import { deleteWorkflowDraft, readWorkflowDraft, writeWorkflowDraft } from '../workflow-draft'

const SAVE_INTERVAL_MS = 2000

// Owns the loaded canvas document: hydrating it onto the canvas, folding the
// canvas back into it, the debounced save queue, and the canvas library CRUD.
export function useCanvasDocument({
  canvases,
  activeCanvas,
  activeSession,
  nodes,
  edges,
  run,
  nodeRuns,
  error,
  saving,
  savedState,
  agentToken,
  canvasRunToken,
  fitView,
  recordHistory,
  syncHistoryCanvas,
  fitFramesAfterRender,
  suppressFrameFit,
  loadSessions,
  restoreTurns,
  subscribeCanvasEvents,
  closeCanvasEvents,
  pasteFragment,
  resetWorkspace,
  closeCanvasSwitcher,
  clientId,
  canvasOpened,
  releasePresence,
  acquireEditLease,
  markEditActivity,
}) {
  const hydrating = ref(false)
  const workflowDirty = ref(false)
  let saveTimer
  let savePromise = null
  let openToken = 0

  async function toCanvas(canvas, { repairFrames = true, reconcile = false, suppressLayout = false } = {}) {
    hydrating.value = true
    const graph = toCanvasGraph(canvas)
    if (suppressLayout) suppressFrameFit(true)
    if (reconcile) {
      const reconciled = reconcileCanvasGraph(nodes.value, edges.value, graph)
      nodes.value = reconciled.nodes
      edges.value = reconciled.edges
      await nextTick()
      await new Promise((resolve) => requestAnimationFrame(resolve))
      await nextTick()
      hydrating.value = false
      suppressFrameFit(false)
      syncHistoryCanvas(canvas.id)
      return
    }
    nodes.value = graph.nodes
    edges.value = graph.edges
    // Repair canvases whose views were materialized before they were wired to the model node.
    if (repairFrames) await fitFramesAfterRender({ persist: true })
    else {
      await nextTick()
      await new Promise((resolve) => requestAnimationFrame(resolve))
      await nextTick()
    }
    hydrating.value = false
    if (suppressLayout) suppressFrameFit(false)
    syncHistoryCanvas(canvas.id)
  }

  function fromCanvas() {
    return toDomainCanvas(activeCanvas.value, nodes.value, edges.value)
  }

  function restoreWorkflowDraft(remoteCanvas) {
    const draft = readWorkflowDraft(remoteCanvas.id)
    if (!draft) return remoteCanvas
    if (draft.baseRevision !== remoteCanvas.revision) {
      deleteWorkflowDraft(remoteCanvas.id)
      return remoteCanvas
    }
    workflowDirty.value = true
    savedState.value = 'Unsaved changes'
    return { ...draft.canvas, revision: remoteCanvas.revision }
  }

  async function loadCanvasList() {
    canvases.value = await request('/api/projects')
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
    const projectId = window.location.pathname.match(/^\/projects\/([^/]+)\/?$/)?.[1]
    const id = preferredId || projectId || activeCanvas.value?.id || canvases.value[0]?.id
    if (id) await openCanvas(id, { replaceHistory: true })
  }

  async function openCanvas(id, { replaceHistory = false } = {}) {
    const token = ++openToken
    const previousCanvasId = activeCanvas.value?.id
    // Land the previous canvas's pending edits before resetWorkspace drops them.
    if (activeCanvas.value && activeCanvas.value.id !== id) {
      await saveCanvas({ immediate: true })
      await releasePresence(previousCanvasId)
    }
    if (token !== openToken) return
    resetWorkspace()
    closeCanvasEvents()
    agentToken.value += 1
    canvasRunToken.value += 1
    error.value = ''
    activeSession.value = null
    const [data, session] = await Promise.all([
      request(`/api/canvases/${id}`),
      loadSessions(id),
    ])
    if (token !== openToken) return
    activeCanvas.value = restoreWorkflowDraft(data.canvas)
    await canvasOpened(id)
    activeSession.value = session
    run.value = null
    nodeRuns.value = data.nodeRuns || {}
    await toCanvas(activeCanvas.value)
    if (workflowDirty.value) {
      acquireEditLease()
      await saveCanvas({ immediate: true })
    }
    if (token !== openToken) return
    await restoreTurns()
    if (token !== openToken) return
    // Subscribe after the REST reads, so the channel only has to carry what
    // happens from here on; an interrupted turn was already restored above.
    subscribeCanvasEvents(id)
    fitView({ padding: 0.18, duration: 500 })

    const path = `/projects/${encodeURIComponent(id)}`
    window.history[replaceHistory ? 'replaceState' : 'pushState']({}, '', path)
  }

  function markWorkflowDirty() {
    if (!activeCanvas.value || hydrating.value) return false
    markEditActivity()
    recordHistory()
    workflowDirty.value = true
    savedState.value = 'Unsaved changes'
    writeWorkflowDraft({
      schemaVersion: 1,
      canvasId: activeCanvas.value.id,
      baseRevision: activeCanvas.value.revision,
      updatedAt: new Date().toISOString(),
      canvas: fromCanvas(),
    })
    return true
  }

  // The queued path stands for "an edit just happened", so it always goes through
  // markWorkflowDirty and records one undo step. Leaving a running timer alone
  // throttles rather than debounces: a burst of edits sends at most one request
  // per SAVE_INTERVAL_MS, and the first edit of a burst lands one interval later
  // instead of waiting for the user to stop. Debouncing would mean a long drag
  // saves nothing until it ends, so a crash mid-drag loses the whole thing. Only
  // save what actually differs from the document we loaded: applying a
  // collaborator's canvas re-measures the DOM and can queue a fit, and without
  // this check that fit would broadcast a canvas we only received, leaving the two
  // clients trading revisions forever.
  function queueSave() {
    if (!hasUnsavedCanvasChanges()) return
    if (!markWorkflowDirty()) return
    if (saveTimer) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      saveCanvas({ immediate: true })
    }, SAVE_INTERVAL_MS)
  }

  function hasUnsavedCanvasChanges() {
    if (!activeCanvas.value || hydrating.value) return false
    const current = fromCanvas()
    return JSON.stringify(current.nodes) !== JSON.stringify(activeCanvas.value.nodes)
      || JSON.stringify(current.edges) !== JSON.stringify(activeCanvas.value.edges)
      || JSON.stringify(current.viewport) !== JSON.stringify(activeCanvas.value.viewport)
  }

  // The canvas has exactly one save gate: anyone may call it, throttling is its own
  // business. By default the edit joins the queue (see queueSave); `immediate` means
  // "cannot wait out the throttle interval" — a run needs the server to read a saved
  // canvas, and leaving the page has no 2s to spare. Awaiting an immediate call means
  // the canvas is on the server.
  async function saveCanvas({ immediate = false, keepalive = false } = {}) {
    if (!immediate) return queueSave()
    // An immediate save is not a new edit, so an already-dirty canvas must not get
    // a second undo step.
    if (!workflowDirty.value && hasUnsavedCanvasChanges()) markWorkflowDirty()
    if (!workflowDirty.value) return savePromise
    // Drop the queued send: its canvas is older than the one going out below.
    clearTimeout(saveTimer)
    saveTimer = null
    acquireEditLease()
    // Saves go out one at a time. The server accepts a canvas only against the
    // revision it currently holds, so two requests in flight means the second is
    // rejected and its edits are replaced by the server's copy. Chaining rather
    // than dropping is what keeps this call's edits: it sends once the save ahead
    // of it lands, against the revision that save produced.
    saving.value = true
    savePromise = Promise.resolve(savePromise).then(() => workflowDirty.value && putCanvas(keepalive))
    const queued = savePromise
    try {
      await queued
    } finally {
      // Only the last link clears the flag; an earlier one still has a request
      // behind it and the canvas is still saving.
      if (savePromise === queued) {
        saving.value = false
        savePromise = null
      }
    }
  }

  // Sends the canvas and folds the server's reply back in. The snapshot is taken
  // here rather than by the caller, so what goes out is the canvas at send time.
  async function putCanvas(keepalive) {
    const savingCanvas = fromCanvas()
    workflowDirty.value = false
    savedState.value = 'Saving…'
    try {
      const savedCanvas = await request(`/api/canvases/${savingCanvas.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId, baseRevision: activeCanvas.value.revision, canvas: savingCanvas }),
        keepalive,
      })
      if (activeCanvas.value?.id !== savedCanvas.id) return
      activeCanvas.value = savedCanvas
      syncCanvasSummary(savedCanvas)
      if (!workflowDirty.value) {
        deleteWorkflowDraft(savedCanvas.id)
        savedState.value = 'Saved'
      }
    } catch (caught) {
      if (caught.status === 409 && caught.data?.canvas && activeCanvas.value?.id === caught.data.canvas.id) {
        deleteWorkflowDraft(caught.data.canvas.id)
        workflowDirty.value = false
        activeCanvas.value = caught.data.canvas
        await toCanvas(caught.data.canvas, { repairFrames: false, reconcile: true, suppressLayout: true })
        syncCanvasSummary(caught.data.canvas)
        savedState.value = 'Updated elsewhere'
      } else {
        error.value = caught.message
        savedState.value = 'Save failed'
      }
    }
  }

  function stopPendingSave() {
    clearTimeout(saveTimer)
  }

  async function refreshCanvasFromServer() {
    const canvasId = activeCanvas.value?.id
    if (!canvasId) return
    if (savePromise) await savePromise
    const { canvas: remoteCanvas } = await request(`/api/canvases/${canvasId}`)
    if (activeCanvas.value?.id !== canvasId) return
    if (remoteCanvas.revision === activeCanvas.value.revision) {
      if (workflowDirty.value) await saveCanvas({ immediate: true })
      return
    }
    if (workflowDirty.value) {
      deleteWorkflowDraft(canvasId)
      workflowDirty.value = false
      clearTimeout(saveTimer)
      saveTimer = null
      savedState.value = 'Updated elsewhere'
    }
    activeCanvas.value = remoteCanvas
    await toCanvas(remoteCanvas, { repairFrames: false, reconcile: true, suppressLayout: true })
    syncCanvasSummary(remoteCanvas)
  }

  async function duplicateCanvas(canvasId = activeCanvas.value?.id) {
    if (!canvasId) return
    try {
      const canvas = await request(`/api/projects/${canvasId}/duplicate`, { method: 'POST' })
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
      if (deletingActiveCanvas) {
        await saveCanvas({ immediate: true })
        closeCanvasEvents()
      }
      await request(`/api/projects/${canvasId}`, { method: 'DELETE' })
      await loadCanvasList()
      if (!deletingActiveCanvas) return

      activeCanvas.value = null
      activeSession.value = null
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
      const canvas = await request('/api/projects', {
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
    const project = await request(`/api/projects/${activeCanvas.value.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    activeCanvas.value = { ...activeCanvas.value, name: project.name, updatedAt: project.updatedAt }
    syncCanvasSummary(activeCanvas.value)
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
        { offset: importPlacementOffset(nodes.value, input.nodes) },
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
    workflowDirty,
    saveCanvas,
    stopPendingSave,
    refreshCanvasFromServer,
    duplicateCanvas,
    deleteCanvas,
    createCanvas,
    renameCanvas,
    exportCanvas,
    importCanvasFile,
  }
}
