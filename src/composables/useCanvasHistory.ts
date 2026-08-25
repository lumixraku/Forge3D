import { nextTick, ref } from 'vue'

// Canvas undo/redo history: each entry is a JSON snapshot of { nodes, edges }.
const HISTORY_LIMIT = 100

export function useCanvasHistory({ nodes, edges, activeCanvas, hydrating, updateNodeInternals, saveCanvas }) {
  let historyPast = []
  let historyFuture = []
  let historyPresent = null
  let historyPendingPrev = null
  let historyTimer = null
  let historyCanvasId = null
  let restoringHistory = false
  let historySettling = false
  let historySettleTimer = null
  const canUndo = ref(false)
  const canRedo = ref(false)

  function snapshotCanvas() {
    return JSON.stringify({ nodes: nodes.value, edges: edges.value })
  }

  function updateHistoryFlags() {
    canUndo.value = historyPast.length > 0
    canRedo.value = historyFuture.length > 0
  }

  // Point the history at a canvas. Switching to a different canvas starts a
  // fresh stack; re-hydrating the same one (e.g. after a paste) keeps it.
  function syncHistoryCanvas(canvasId) {
    if (canvasId === historyCanvasId) return
    historyCanvasId = canvasId
    historyPast = []
    historyFuture = []
    historyPendingPrev = null
    clearTimeout(historyTimer)
    historyTimer = null
    historyPresent = canvasId ? snapshotCanvas() : null
    updateHistoryFlags()
    // The canvas emits a persisted frame-fit as node dimensions settle after a
    // load; absorb that into the baseline so undo doesn't begin with a stray step.
    historySettling = true
    clearTimeout(historySettleTimer)
    historySettleTimer = setTimeout(() => { historySettling = false }, 400)
  }

  // Record a history step for the change that just scheduled a save. Rapid bursts
  // (dragging, typing) coalesce into one step via a short debounce.
  function recordHistory() {
    if (restoringHistory || hydrating.value || !activeCanvas.value) return
    if (historySettling) {
      historyPresent = snapshotCanvas()
      return
    }
    if (historyPresent === null) historyPresent = snapshotCanvas()
    if (historyPendingPrev === null) historyPendingPrev = historyPresent
    clearTimeout(historyTimer)
    historyTimer = setTimeout(() => {
      historyTimer = null
      const next = snapshotCanvas()
      const previous = historyPendingPrev
      historyPendingPrev = null
      if (next === previous) return
      historyPast.push(previous)
      if (historyPast.length > HISTORY_LIMIT) historyPast.shift()
      historyFuture = []
      historyPresent = next
      updateHistoryFlags()
    }, 400)
  }

  // Fold any in-flight (debounced) change into the past so undo can revert it.
  function flushHistory() {
    if (!historyTimer) return
    clearTimeout(historyTimer)
    historyTimer = null
    const next = snapshotCanvas()
    const previous = historyPendingPrev
    historyPendingPrev = null
    if (previous !== null && next !== previous) {
      historyPast.push(previous)
      if (historyPast.length > HISTORY_LIMIT) historyPast.shift()
      historyFuture = []
      historyPresent = next
      updateHistoryFlags()
    }
  }

  async function restoreSnapshot(snapshot) {
    const parsed = JSON.parse(snapshot)
    restoringHistory = true
    nodes.value = parsed.nodes
    edges.value = parsed.edges
    saveCanvas()
    await nextTick()
    parsed.nodes.forEach((node) => updateNodeInternals(node.id))
    restoringHistory = false
  }

  function undo() {
    flushHistory()
    if (!historyPast.length) return
    historyFuture.push(historyPresent)
    historyPresent = historyPast.pop()
    updateHistoryFlags()
    restoreSnapshot(historyPresent)
  }

  function redo() {
    if (!historyFuture.length) return
    historyPast.push(historyPresent)
    historyPresent = historyFuture.pop()
    updateHistoryFlags()
    restoreSnapshot(historyPresent)
  }

  return { canUndo, canRedo, syncHistoryCanvas, recordHistory, undo, redo }
}
