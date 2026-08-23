import { ref } from 'vue'
import { buildDrawnFrame } from '../frame-geometry'

// Below this much pointer travel the gesture reads as a click, not a drag.
const DRAW_THRESHOLD = 4

// Drawing a section: the toolbar arms 'frame' mode, then a drag on the canvas
// draws the rectangle that becomes the frame. The anchor is kept in flow space so
// the rectangle stays glued to canvas content if the view pans mid-drag.
export function useFrameDraw({ nodes, edges, canvasMode, activeCanvas, screenToFlowCoordinate, nextNodeId, scheduleSave, createDefaultFrame }) {
  const drawRect = ref(null)
  const drawing = ref(false)
  let anchor = null
  let anchorScreen = null
  let moved = false

  function shouldStartDraw(event) {
    if (event.button !== 0) return false
    const target = event.target
    if (!(target instanceof Element)) return false
    // The MiniMap and Controls are siblings of the viewport, so this one test
    // keeps them clickable while the draw tool is armed.
    if (!target.closest('.vue-flow__viewport')) return false
    // Resize handles run their own drag; let them keep resizing their frame.
    if (target.closest('.vue-flow__resize-control')) return false
    if (target.closest('input, textarea, [contenteditable="true"]')) return false
    return true
  }

  function detach() {
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', cancelFrameDraw)
    window.removeEventListener('blur', cancelFrameDraw)
  }

  function reset() {
    detach()
    drawRect.value = null
    drawing.value = false
    anchor = null
    anchorScreen = null
    moved = false
  }

  function onFrameDrawPointerDown(event) {
    if (canvasMode.value !== 'frame' || !shouldStartDraw(event)) return
    anchor = screenToFlowCoordinate({ x: event.clientX, y: event.clientY })
    anchorScreen = { x: event.clientX, y: event.clientY }
    moved = false
    drawing.value = true
    // The section appears under the cursor the moment the drag starts and grows
    // with it; the threshold below only decides what release commits.
    drawRect.value = { left: anchor.x, top: anchor.y, right: anchor.x, bottom: anchor.y }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', cancelFrameDraw)
    window.addEventListener('blur', cancelFrameDraw)
  }

  function onPointerMove(event) {
    if (!anchor) return
    if (Math.hypot(event.clientX - anchorScreen.x, event.clientY - anchorScreen.y) >= DRAW_THRESHOLD) moved = true
    const point = screenToFlowCoordinate({ x: event.clientX, y: event.clientY })
    drawRect.value = {
      left: Math.min(anchor.x, point.x),
      top: Math.min(anchor.y, point.y),
      right: Math.max(anchor.x, point.x),
      bottom: Math.max(anchor.y, point.y),
    }
  }

  function onPointerUp() {
    const bounds = drawRect.value
    const point = anchor
    const wasDrag = moved
    reset()
    canvasMode.value = 'select'
    // Releasing over the pane emits a trailing click, and Vue Flow answers that
    // by clearing the selection — including the section just created.
    window.addEventListener('click', swallowClick, { capture: true, once: true })
    if (wasDrag && bounds) commitFrame(bounds)
    else if (point) createDefaultFrame(point)
  }

  function swallowClick(event) {
    event.stopPropagation()
  }

  function commitFrame(bounds) {
    if (!activeCanvas.value) return
    nodes.value = buildDrawnFrame(nodes.value, bounds, { frameId: nextNodeId('frame') })
    edges.value = edges.value.map((edge) => ({ ...edge, selected: false }))
    scheduleSave()
  }

  function cancelFrameDraw() {
    reset()
  }

  return { drawRect, drawing, onFrameDrawPointerDown, cancelFrameDraw }
}
