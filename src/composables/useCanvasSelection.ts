import { computed, nextTick } from 'vue'
import { request } from '../api'
import { buildFragment, CLIPBOARD_MIME, remapFragment, serializeFragment } from '../canvas-fragment'
import { toCanvasGraph } from '../canvas-graph'
import { removeSelectedElements } from '../canvas-selection'

// Everything derived from, or acting on, the current canvas selection: the
// selection computeds, deletion, and fragment copy/paste/duplicate.
export function useCanvasSelection({ nodes, edges, activeCanvas, error, saveCanvas, fromCanvas, toCanvas, loadCanvass, focusNodes }) {
  const selectedNodes = computed(() => nodes.value.filter((node) => node.selected))
  const selectedEdges = computed(() => edges.value.filter((edge) => edge.selected))
  const frameableSelectedNodes = computed(() => selectedNodes.value.filter((node) => node.type !== 'frame' && !node.parentNode))
  const canFrameSelection = computed(() => frameableSelectedNodes.value.length > 0)
  const canDissolveSelection = computed(() => selectedNodes.value.some((node) => node.type === 'frame'))
  const selectedCount = computed(() => selectedNodes.value.length + selectedEdges.value.length)
  const hasSelectedNode = computed(() => selectedNodes.value.length > 0)
  const hasSelection = computed(() => selectedCount.value > 0)

  function deleteSelected(options = {}) {
    const next = removeSelectedElements(nodes.value, edges.value, options)
    nodes.value = next.nodes
    edges.value = next.edges
    saveCanvas()
  }

  function dissolveSelectedFrames() {
    if (!canDissolveSelection.value) return
    deleteSelected({ preserveFrameChildren: true })
  }

  function selectAll() {
    nodes.value = nodes.value.map((node) => ({ ...node, selected: true }))
  }

  function onEdgeClick({ edge, event }) {
    const extendSelection = event?.shiftKey
    nodes.value = nodes.value.map((node) => extendSelection ? node : { ...node, selected: false })
    edges.value = edges.value.map((item) => ({
      ...item,
      selected: item.id === edge.id || (extendSelection && item.selected),
    }))
  }

  // Vue Flow's native @edge-click is unreliable here (pane selection intercepts it),
  // so detect edge hits ourselves on the capture-phase pointerdown.
  function selectCanvasEdge(event) {
    const edgeElement = event.target.closest?.('.vue-flow__edge')
    if (!edgeElement) return
    const edge = edges.value.find((item) => item.id === edgeElement.dataset.id)
    if (edge) onEdgeClick({ edge, event })
  }

  function selectedFragmentData(name = 'Untitled block') {
    const selected = selectedNodes.value
    if (!selected.length) return null
    return buildFragment(fromCanvas(), new Set(selected.map((node) => node.id)), name)
  }

  async function copySelected() {
    const fragment = selectedFragmentData('Copied selection')
    if (!fragment) return
    try {
      const bytes = serializeFragment(fragment)
      const blob = new Blob([bytes], { type: CLIPBOARD_MIME.slice(4) })
      await navigator.clipboard.write([new ClipboardItem({ [CLIPBOARD_MIME]: blob })])
    } catch {
      error.value = 'Could not copy the selection to the system clipboard'
    }
  }

  async function pasteFragment(fragment, options: any = {}) {
    if (!fragment?.nodes?.length) return
    const maxX = nodes.value.length ? Math.max(...nodes.value.map((node) => node.position.x)) : 0
    const { nodes: domainNodes, edges: domainEdges } = remapFragment(fragment, {
      offset: options.offset || { x: maxX + 310, y: 120 },
      translateRoots: options.translateRoots,
    })
    const nextCanvas = {
      ...fromCanvas(),
      nodes: [...fromCanvas().nodes, ...domainNodes],
      edges: [...fromCanvas().edges, ...domainEdges],
    }
    activeCanvas.value = nextCanvas
    if (options.preserveLayout) {
      const insertedGraph = toCanvasGraph({ ...nextCanvas, nodes: domainNodes, edges: domainEdges })
      nodes.value = [
        ...nodes.value.map((node) => ({ ...node, selected: false })),
        ...insertedGraph.nodes.map((node) => ({ ...node, selected: Boolean(options.selectInserted) })),
      ]
      edges.value = [...edges.value.map((edge) => ({ ...edge, selected: false })), ...insertedGraph.edges]
    } else {
      await toCanvas(activeCanvas.value)
      await nextTick()
    }
    if (options.selectInserted) {
      const insertedIds = new Set(domainNodes.map((node) => node.id))
      nodes.value = nodes.value.map((node) => ({ ...node, selected: insertedIds.has(node.id) }))
    }
    saveCanvas()
    focusNodes(domainNodes.map((node) => node.id))
  }

  async function duplicateSelected() {
    const selected = selectedNodes.value
    const fragment = selectedFragmentData('Duplicated selection')
    if (!fragment || !selected.length) return
    const minX = Math.min(...selected.map((node) => node.position.x))
    const minY = Math.min(...selected.map((node) => node.position.y))
    await pasteFragment(fragment, { offset: { x: minX + 24, y: minY + 24 }, selectInserted: true, preserveLayout: true })
  }

  async function createCanvasFromSelection() {
    if (!selectedNodes.value.length) return
    const name = window.prompt('Name this canvas', 'Canvas from selection')?.trim()
    if (!name) return
    const selection = selectedFragmentData(name)
    if (!selection) return
    const payload = {
      name,
      description: `${selection.nodes.length} selected steps from ${activeCanvas.value.name}`,
      nodes: selection.nodes,
      edges: selection.edges,
    }
    try {
      const canvas = await request('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      await loadCanvass(canvas.id)
    } catch (caught) {
      error.value = caught.message
    }
  }

  return {
    selectedNodes,
    frameableSelectedNodes,
    canFrameSelection,
    canDissolveSelection,
    selectedCount,
    hasSelectedNode,
    hasSelection,
    deleteSelected,
    dissolveSelectedFrames,
    selectAll,
    selectCanvasEdge,
    copySelected,
    pasteFragment,
    duplicateSelected,
    createCanvasFromSelection,
  }
}
