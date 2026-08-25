import { nextTick } from 'vue'
import { adoptNodesCoveredByDraggedFrames, buildSelectionFrame, fitFrameNodes, pointInAnyFrame, reparentDraggedNodes } from '../frame-geometry'
import { frameComponentGap, frameInsets, layoutSelection } from '../canvas-layout'

// Frames (sections) are plain Vue Flow parent nodes, so their size and their
// children's parentage are maintained here in response to canvas interaction.
export function useCanvasFrames({ nodes, edges, screenToFlowCoordinate, updateNodeInternals, saveCanvas, frameableSelectedNodes, nextNodeId, focusNode }) {
  let frameFitQueued = false
  let frameFitSuppressed = false
  let dragging = false
  let marqueeSelecting = false
  let marqueeStartedInFrame = false

  function fitFrames() {
    const fitted = fitFrameNodes(nodes.value, frameInsets())
    if (fitted.changed) nodes.value = fitted.nodes
    return fitted.changed
  }

  // Visual-only: the callers that own a frame's persisted size save it themselves.
  function queueFrameFit() {
    if (frameFitQueued) return
    frameFitQueued = true
    nextTick(async () => {
      frameFitQueued = false
      await fitFramesAfterRender()
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
    if (changed && persist) saveCanvas()
    return changed
  }

  function makeSelectionFrame() {
    const selected = frameableSelectedNodes.value
    if (!selected.length) return

    const frameId = nextNodeId('frame')
    nodes.value = buildSelectionFrame(nodes.value, selected, { insets: frameInsets(), frameId })
    edges.value = edges.value.map((edge) => ({ ...edge, selected: false }))
    saveCanvas()
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
    if (frameFitSuppressed) return
    // A frame's size follows its children only on the three actions that own it:
    // resizing it by hand, nodes entering or leaving it, and auto layout. A node's
    // own measured height is NOT one of them — run states and expanding controls
    // re-measure constantly, and refitting on that would resize (and save) the
    // frame behind the user's back. Position changes still refit, but only once
    // settled: while the mouse is down we leave the frame alone and onNodeDragStop
    // refits on release.
    if (!dragging && changes.some((change) => change.type === 'position')) {
      queueFrameFit()
    }
    if (changes.some((change) => change.type === 'remove')) saveCanvas()
  }

  function suppressFrameFit(value) {
    frameFitSuppressed = value
    if (value) frameFitQueued = false
  }

  function onFrameResizeEnd() {
    saveCanvas()
  }

  function onNodeDragStart() {
    dragging = true
  }

  async function onNodeDragStop({ nodes: draggedNodes = [] } = {}) {
    const reparented = reparentDraggedNodes(nodes.value, draggedNodes)
    if (reparented.changed) nodes.value = reparented.nodes
    const adopted = adoptNodesCoveredByDraggedFrames(nodes.value, draggedNodes)
    if (adopted.changed) nodes.value = adopted.nodes
    dragging = false
    // Vue Flow stretches a frame's rendered box to cover its children as they are
    // reparented, so the fit has to run after that render and re-measure, or the
    // frame keeps the size Vue Flow gave it while our state holds the fitted one.
    await fitFramesAfterRender()
    saveCanvas()
  }

  async function autoLayout({ persist = true } = {}) {
    const { positions, fitFrameIds } = await layoutSelection(nodes.value, edges.value, {
      componentGap: frameComponentGap(),
    })
    nodes.value = nodes.value.map((node) => positions.has(node.id) ? { ...node, position: positions.get(node.id) } : node)
    if (fitFrameIds.size) {
      const fitted = fitFrameNodes(nodes.value, frameInsets(), fitFrameIds)
      if (fitted.changed) nodes.value = fitted.nodes
    }
    await nextTick()
    updateNodeInternals()
    if (persist) saveCanvas()
  }

  return {
    fitFramesAfterRender,
    suppressFrameFit,
    makeSelectionFrame,
    onCanvasPointerDown,
    onSelectionStart,
    onSelectionEnd,
    onElementsChange,
    onFrameResizeEnd,
    onNodeDragStart,
    onNodeDragStop,
    autoLayout,
  }
}
