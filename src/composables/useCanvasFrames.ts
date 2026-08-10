import { nextTick } from 'vue'
import { adoptNodesCoveredByDraggedFrames, buildSelectionFrame, fitFrameNodes, pointInAnyFrame, reparentDraggedNodes } from '../frame-geometry'
import { frameComponentGap, frameInsets, layoutSelection } from '../canvas-layout'

// Frames (sections) are plain Vue Flow parent nodes, so their size and their
// children's parentage are maintained here in response to canvas interaction.
export function useCanvasFrames({ nodes, edges, viewport, fitView, screenToFlowCoordinate, updateNodeInternals, scheduleSave, scheduleLayoutSave, frameableSelectedNodes, nextNodeId, focusNode }) {
  let frameFitQueued = false
  let frameFitShouldSave = false
  let dragging = false
  let resizingFrameId = null
  let marqueeSelecting = false
  let marqueeStartedInFrame = false

  function fitFrames() {
    const fitted = fitFrameNodes(nodes.value, frameInsets(viewport.value.zoom))
    if (fitted.changed) nodes.value = fitted.nodes
    return fitted.changed
  }

  function queueFrameFit({ persist = false } = {}) {
    frameFitShouldSave ||= persist
    if (frameFitQueued) return
    frameFitQueued = true
    nextTick(async () => {
      frameFitQueued = false
      const shouldSave = frameFitShouldSave
      frameFitShouldSave = false
      await new Promise((resolve) => requestAnimationFrame(resolve))
      await nextTick()
      if (fitFrames() && shouldSave) scheduleLayoutSave()
    })
  }

  async function fitFramesAfterRender({ persist = false } = {}) {
    await nextTick()
    await new Promise((resolve) => requestAnimationFrame(resolve))
    await nextTick()
    const changed = fitFrames()
    // Handles use dynamic per-port positions, so refresh their measured bounds
    // after the DOM settles or edges connect to stale points.
    updateNodeInternals()
    if (changed && persist) scheduleLayoutSave()
    return changed
  }

  function makeSelectionFrame() {
    const selected = frameableSelectedNodes.value
    if (!selected.length) return

    const frameId = nextNodeId('frame')
    nodes.value = buildSelectionFrame(nodes.value, selected, { insets: frameInsets(viewport.value.zoom), frameId })
    edges.value = edges.value.map((edge) => ({ ...edge, selected: false }))
    scheduleSave()
    focusNode(frameId)
  }

  function onCanvasPointerDown(event) {
    marqueeStartedInFrame = pointInAnyFrame(screenToFlowCoordinate({ x: event.clientX, y: event.clientY }), nodes.value)
  }

  function onSelectionStart() {
    marqueeSelecting = true
  }

  function onSelectionEnd() {
    marqueeSelecting = false
    marqueeStartedInFrame = false
  }

  function onElementsChange(changes) {
    // A marquee that begins inside a section selects its contents. A marquee that
    // begins outside keeps the section selected along with anything it overlaps.
    if (marqueeSelecting && marqueeStartedInFrame) {
      const frameIds = new Set(nodes.value.filter((node) => node.type === 'frame').map((node) => node.id))
      if (changes.some((change) => change.type === 'select' && change.selected && frameIds.has(change.id))) {
        // Vue Flow applies its selection change around this callback; enforce the
        // inside-section exception after that update without disturbing children.
        queueMicrotask(() => {
          nodes.value = nodes.value.map((node) => node.type === 'frame' && node.selected ? { ...node, selected: false } : node)
        })
      }
    }
    const hasDimensions = changes.some((change) => change.type === 'dimensions' && change.id !== resizingFrameId)
    // Resize frames to their children only once settled: on a node's own size change,
    // or on a position change that is NOT part of an in-flight drag. While the mouse is
    // down we leave the frame untouched; onNodeDragStop refits on release.
    if (hasDimensions || (!dragging && changes.some((change) => change.type === 'position'))) {
      queueFrameFit({ persist: hasDimensions })
    }
    if (changes.some((change) => change.type === 'remove')) scheduleSave()
  }

  function onFrameResizeStart(id) {
    resizingFrameId = id
    nodes.value = nodes.value.map((node) => node.id === id ? { ...node, data: { ...node.data, manualSize: true } } : node)
  }

  function onFrameResizeEnd() {
    resizingFrameId = null
    scheduleLayoutSave()
  }

  function onNodeDragStart() {
    dragging = true
  }

  function onNodeDragStop({ nodes: draggedNodes = [] } = {}) {
    const reparented = reparentDraggedNodes(nodes.value, draggedNodes)
    if (reparented.changed) nodes.value = reparented.nodes
    const adopted = adoptNodesCoveredByDraggedFrames(nodes.value, draggedNodes)
    if (adopted.changed) nodes.value = adopted.nodes
    dragging = false
    fitFrames()
    if (reparented.changed || adopted.changed) scheduleSave()
    else scheduleLayoutSave()
  }

  async function autoLayout({ persist = true } = {}) {
    const { positions, fitFrameIds } = await layoutSelection(nodes.value, edges.value, {
      componentGap: frameComponentGap(viewport.value.zoom),
    })
    nodes.value = nodes.value.map((node) => positions.has(node.id) ? { ...node, position: positions.get(node.id) } : node)
    if (fitFrameIds.size) {
      const fitted = fitFrameNodes(nodes.value, frameInsets(viewport.value.zoom), fitFrameIds)
      if (fitted.changed) nodes.value = fitted.nodes
    }
    await nextTick()
    updateNodeInternals()
    fitView({ padding: 0.18, duration: 500 })
    if (persist) scheduleLayoutSave()
  }

  return {
    fitFramesAfterRender,
    makeSelectionFrame,
    onCanvasPointerDown,
    onSelectionStart,
    onSelectionEnd,
    onElementsChange,
    onFrameResizeStart,
    onFrameResizeEnd,
    onNodeDragStart,
    onNodeDragStop,
    autoLayout,
  }
}
