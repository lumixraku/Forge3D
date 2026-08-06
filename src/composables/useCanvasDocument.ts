import { nextTick, ref } from 'vue'
import { request } from '../api'
import { reconcileCanvasGraph, toCanvasGraph, toDomainCanvas } from '../canvas-graph'
import { importPlacementOffset, validateImportedCanvas } from '../canvas-fragment'
import { deleteWorkflowDraft, readWorkflowDraft, writeWorkflowDraft } from '../workflow-draft'

const WORKFLOW_SAVE_DELAY_MS = 700
const LAYOUT_SAVE_DELAY_MS = 10000

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
  let workflowSaveTimer
  let layoutSaveTimer
  let savePromise = null
  let pendingSaveSnapshot = null
  let localSequence = 0
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

  async function restoreWorkflowDraft(remoteCanvas) {
    const draft = await readWorkflowDraft(remoteCanvas.id).catch(() => null)
    if (!draft) return remoteCanvas
    if (draft.baseRevision !== remoteCanvas.revision) {
      await deleteWorkflowDraft(remoteCanvas.id).catch(() => {})
      return remoteCanvas
    }
    localSequence = Math.max(localSequence, draft.localSequence || 0)
    workflowDirty.value = true
    pendingSaveSnapshot = { ...draft.canvas, revision: remoteCanvas.revision }
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
    if (activeCanvas.value && activeCanvas.value.id !== id) {
      await flushPendingSave()
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
    activeCanvas.value = await restoreWorkflowDraft(data.canvas)
    await canvasOpened(id)
    activeSession.value = session
    run.value = null
    nodeRuns.value = data.nodeRuns || {}
    await toCanvas(activeCanvas.value)
    if (workflowDirty.value) {
      acquireEditLease()
      await flushPendingSave()
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
    pendingSaveSnapshot = { ...fromCanvas(), revision: activeCanvas.value.revision }
    writeWorkflowDraft({
      schemaVersion: 1,
      canvasId: activeCanvas.value.id,
      baseRevision: activeCanvas.value.revision,
      localSequence: ++localSequence,
      updatedAt: new Date().toISOString(),
      canvas: pendingSaveSnapshot,
    }).catch(() => {})
    return true
  }

  function scheduleWorkflowSave() {
    if (!markWorkflowDirty()) return
    clearTimeout(workflowSaveTimer)
    workflowSaveTimer = setTimeout(() => {
      workflowSaveTimer = null
      saveCanvas()
    }, WORKFLOW_SAVE_DELAY_MS)
  }

  function scheduleLayoutSave() {
    // A layout save is only ours to make when local geometry actually differs from
    // the document we loaded. Applying a collaborator's canvas re-measures the DOM
    // and can queue a fit; without this check that fit would save and broadcast a
    // canvas we only received, and the two clients would trade revisions forever.
    if (!hasUnsavedCanvasChanges()) return
    if (!markWorkflowDirty() || layoutSaveTimer) return
    layoutSaveTimer = setTimeout(() => {
      layoutSaveTimer = null
      saveCanvas()
    }, LAYOUT_SAVE_DELAY_MS)
  }

  function hasUnsavedCanvasChanges() {
    if (!activeCanvas.value || hydrating.value) return false
    const current = fromCanvas()
    return JSON.stringify(current.nodes) !== JSON.stringify(activeCanvas.value.nodes)
      || JSON.stringify(current.edges) !== JSON.stringify(activeCanvas.value.edges)
      || JSON.stringify(current.viewport) !== JSON.stringify(activeCanvas.value.viewport)
  }

  async function flushPendingSave({ detectChanges = false, keepalive = false } = {}) {
    if (detectChanges && !workflowDirty.value && hasUnsavedCanvasChanges()) markWorkflowDirty()
    if (!workflowDirty.value && !savePromise) return
    clearTimeout(workflowSaveTimer)
    clearTimeout(layoutSaveTimer)
    workflowSaveTimer = null
    layoutSaveTimer = null
    if (workflowDirty.value) pendingSaveSnapshot = { ...fromCanvas(), revision: activeCanvas.value.revision }
    await saveCanvas({ keepalive })
  }

  async function saveCanvas({ keepalive = false } = {}) {
    if (!workflowDirty.value) return savePromise
    if (saving.value) {
      return savePromise
    }
    acquireEditLease()
    saving.value = true
    savedState.value = 'Saving…'
    savePromise = (async () => {
      while (workflowDirty.value && pendingSaveSnapshot) {
        const savingCanvas = pendingSaveSnapshot
        const savingSequence = localSequence
        const savedCanvas = await request(`/api/canvases/${savingCanvas.id}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ clientId, baseRevision: activeCanvas.value.revision, canvas: savingCanvas }),
          keepalive,
        })
        if (activeCanvas.value?.id !== savedCanvas.id) return
        activeCanvas.value = savedCanvas
        syncCanvasSummary(savedCanvas)
        if (savingSequence === localSequence) {
          workflowDirty.value = false
          pendingSaveSnapshot = null
          await deleteWorkflowDraft(savedCanvas.id).catch(() => {})
        } else {
          pendingSaveSnapshot = { ...fromCanvas(), revision: savedCanvas.revision }
          await writeWorkflowDraft({
            schemaVersion: 1,
            canvasId: savedCanvas.id,
            baseRevision: savedCanvas.revision,
            localSequence,
            updatedAt: new Date().toISOString(),
            canvas: pendingSaveSnapshot,
          }).catch(() => {})
        }
      }
    })()
    try {
      await savePromise
      if (!workflowDirty.value) savedState.value = 'Saved'
    } catch (caught) {
      if (caught.status === 409 && caught.data?.canvas && activeCanvas.value?.id === caught.data.canvas.id) {
        await deleteWorkflowDraft(caught.data.canvas.id).catch(() => {})
        workflowDirty.value = false
        pendingSaveSnapshot = null
        activeCanvas.value = caught.data.canvas
        await toCanvas(caught.data.canvas, { repairFrames: false, reconcile: true, suppressLayout: true })
        syncCanvasSummary(caught.data.canvas)
        savedState.value = 'Updated elsewhere'
      } else {
        error.value = caught.message
        savedState.value = 'Save failed'
      }
    } finally {
      saving.value = false
      savePromise = null
    }
  }

  function stopPendingSave() {
    clearTimeout(workflowSaveTimer)
    clearTimeout(layoutSaveTimer)
  }

  async function refreshCanvasFromServer() {
    const canvasId = activeCanvas.value?.id
    if (!canvasId) return
    if (savePromise) await savePromise
    const { canvas: remoteCanvas } = await request(`/api/canvases/${canvasId}`)
    if (activeCanvas.value?.id !== canvasId) return
    if (remoteCanvas.revision === activeCanvas.value.revision) {
      if (workflowDirty.value) await flushPendingSave()
      return
    }
    if (workflowDirty.value) {
      await deleteWorkflowDraft(canvasId).catch(() => {})
      workflowDirty.value = false
      pendingSaveSnapshot = null
      clearTimeout(workflowSaveTimer)
      clearTimeout(layoutSaveTimer)
      workflowSaveTimer = null
      layoutSaveTimer = null
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
        await flushPendingSave()
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
    scheduleSave: scheduleWorkflowSave,
    scheduleWorkflowSave,
    scheduleLayoutSave,
    workflowDirty,
    flushPendingSave,
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
