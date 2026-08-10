import { onMounted, onUnmounted } from 'vue'
import { parseFragment } from '../canvas-fragment'

// Global canvas shortcuts. Registered in the capture phase so an open overlay can
// claim Escape before the canvas sees it.
export function useKeyboardShortcuts({
  imagePreview,
  workspaceMode,
  canvasSwitcherOpen,
  nodeMenuOpen,
  canvasMenu,
  hasSelection,
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
  pasteFragment,
  duplicateSelected,
  deleteSelected,
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
    if (event.key === 'Escape' && (nodeMenuOpen.value || canvasMenu.value)) {
      closeContextMenu()
      closeCanvasMenu()
      return
    }
    if (modifier && event.code === 'KeyD') {
      event.preventDefault()
      if (hasSelection.value) duplicateSelected()
      return
    }
    if (isEditing(event.target)) return
    if (modifier && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
      return
    }
    if (modifier && event.key.toLowerCase() === 'y') {
      event.preventDefault()
      redo()
      return
    }
    if (['Backspace', 'Delete'].includes(event.key) && hasSelection.value) {
      event.preventDefault()
      deleteSelected()
      return
    }
    if (event.key === '/') {
      event.preventDefault()
      const canvas = document.querySelector('.flow-canvas')?.getBoundingClientRect()
      if (canvas) openNodeMenuAt(canvas.left + canvas.width / 2, canvas.top + canvas.height / 2)
      return
    }
    if (modifier && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      selectAll()
    }
    if (modifier && event.key.toLowerCase() === 'c' && hasSelection.value) {
      event.preventDefault()
      copySelected()
    }
  }

  function handlePaste(event: ClipboardEvent) {
    if (isEditing(event.target) || workspaceMode.value !== 'canvas') return
    const fragment = parseFragment(event.clipboardData?.getData('text/plain'))
    if (!fragment) return
    event.preventDefault()
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
