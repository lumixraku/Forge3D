import { onMounted, onUnmounted } from 'vue'
import { CLIPBOARD_MIME, parseFragmentText, readClipboardFragment, rememberedFragmentData } from '../canvas-fragment'

// Global canvas shortcuts. Registered in the capture phase so an open overlay can
// claim Escape before the canvas sees it.
export function useKeyboardShortcuts({
  imagePreview,
  workspaceMode,
  canvasSwitcherOpen,
  nodeMenuOpen,
  canvasMenu,
  hasSelection,
  canvasMode,
  frameDrawing,
  cancelFrameDraw,
  closeImagePreview,
  closeModelEditor,
  closeCanvasSwitcher,
  closeContextMenu,
  closeCanvasMenu,
  openNodeMenuAt,
  undo,
  redo,
  selectAll,
  copySelected,
  cutSelected,
  pasteFragment,
  duplicateSelected,
  deleteSelected,
  ensureEditAccess,
}) {
  function isEditing(target: EventTarget | null) {
    return target instanceof Element && Boolean(target.closest('input, textarea, [contenteditable="true"]'))
  }

  function handleKeyboard(event: KeyboardEvent) {
    if (imagePreview.value) {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeImagePreview()
      }
      return
    }
    if (event.key === 'Escape' && workspaceMode.value === 'model-editor') {
      event.preventDefault()
      closeModelEditor()
      return
    }
    if (event.key === 'Escape' && canvasSwitcherOpen.value) {
      event.preventDefault()
      closeCanvasSwitcher()
      return
    }
    const modifier = event.metaKey || event.ctrlKey
    // An in-flight section rectangle outranks the menus; an armed-but-idle draw
    // tool does not, so a menu still closes first while the tool stays armed.
    if (event.key === 'Escape' && frameDrawing.value) {
      event.preventDefault()
      cancelFrameDraw()
      canvasMode.value = 'select'
      return
    }
    if (event.key === 'Escape' && (nodeMenuOpen.value || canvasMenu.value)) {
      closeContextMenu()
      closeCanvasMenu()
      return
    }
    if (event.key === 'Escape' && (canvasMode.value === 'frame' || canvasMode.value === 'tie')) {
      event.preventDefault()
      canvasMode.value = 'select'
      return
    }
    if (modifier && event.code === 'KeyD') {
      event.preventDefault()
      if (!ensureEditAccess()) return
      if (hasSelection.value) duplicateSelected()
      return
    }
    if (isEditing(event.target)) return
    if (modifier && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      if (!ensureEditAccess()) return
      if (event.shiftKey) redo()
      else undo()
      return
    }
    if (modifier && event.key.toLowerCase() === 'y') {
      event.preventDefault()
      if (!ensureEditAccess()) return
      redo()
      return
    }
    if (['Backspace', 'Delete'].includes(event.key) && hasSelection.value) {
      event.preventDefault()
      if (!ensureEditAccess()) return
      deleteSelected()
      return
    }
    // V selects, H pans (the hand), as in most canvas tools.
    if (!modifier && !event.altKey && (event.code === 'KeyV' || event.code === 'KeyH')) {
      event.preventDefault()
      if (frameDrawing.value) cancelFrameDraw()
      canvasMode.value = event.code === 'KeyV' ? 'select' : 'move'
      return
    }
    if (event.key === '/') {
      event.preventDefault()
      const canvas = document.querySelector('.forge3d-flow-canvas')?.getBoundingClientRect()
      if (canvas) openNodeMenuAt(canvas.left + canvas.width / 2, canvas.top + canvas.height / 2)
      return
    }
    if (modifier && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      selectAll()
    }
    if (modifier && event.key.toLowerCase() === 'c' && hasSelection.value) {
      event.preventDefault()
      if (!ensureEditAccess()) return
      copySelected()
      return
    }
    if (modifier && event.key.toLowerCase() === 'x' && hasSelection.value) {
      event.preventDefault()
      if (!ensureEditAccess()) return
      cutSelected()
    }
  }

  function clipboardIsForeign(event: ClipboardEvent) {
    const text = event.clipboardData?.getData('text/plain') || ''
    if (parseFragmentText(text)) return false
    const types = event.clipboardData ? [...event.clipboardData.types] : []
    return Boolean(text.trim()) || types.some((type) => type !== 'text/plain' && type !== CLIPBOARD_MIME)
  }

  async function handlePaste(event: ClipboardEvent) {
    if (isEditing(event.target) || workspaceMode.value !== 'canvas') return
    // Text from another app, or an image, is not a canvas fragment.
    if (clipboardIsForeign(event)) return
    const text = event.clipboardData?.getData('text/plain') || ''
    // An empty clipboard means this tab's copy never left the page.
    let fragment = parseFragmentText(text) || rememberedFragmentData()
    if (!fragment) {
      try {
        fragment = await readClipboardFragment()
      } catch {
        fragment = null
      }
    }
    if (!fragment) return
    event.preventDefault()
    if (!ensureEditAccess()) return
    pasteFragment(fragment, { selectInserted: true })
  }

  onMounted(() => {
    window.addEventListener('keydown', handleKeyboard, true)
    window.addEventListener('paste', handlePaste, true)
  })
  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeyboard, true)
    window.removeEventListener('paste', handlePaste, true)
  })
}
