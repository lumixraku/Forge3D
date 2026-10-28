import { computed, nextTick } from 'vue'
import { request } from '../api'
import { defaultCanvasProvider } from '../canvas-schema'
import { absoluteNodePosition, indexNodes } from '../frame-geometry'
import { buildFragment, fragmentToClipboardText, rememberFragment, remapFragment } from '../canvas-fragment'
import { toCanvasGraph } from '../canvas-graph'
import { removeSelectedElements } from '../canvas-selection'

// Everything derived from, or acting on, the current canvas selection: the
// selection computeds, deletion, and fragment copy/paste/duplicate.
export function useCanvasSelection({ nodes, edges, activeCanvas, error, saveCanvas, fromCanvas, toCanvas, loadCanvass, focusNodes, askName = async () => '' }) {
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

  function pasteOffset() {
    const map = indexNodes(nodes.value)
    const selected = nodes.value.filter((node) => node.selected)
    const anchor = selected.length ? selected : nodes.value
    const roots = anchor.filter((node) => !node.parentNode || !anchor.some((item) => item.id === node.parentNode))
    const placed = roots.length ? roots : anchor
    if (!placed.length) return { x: 120, y: 120 }
    const boxes = placed.map((node) => absoluteNodePosition(node, map))
    const minY = Math.min(...boxes.map((point) => point.y))
    const maxX = Math.max(...placed.map((node, index) => boxes[index].x + (node.width || node.dimensions?.width || 260)))
    return { x: maxX + 48, y: minY }
  }

  async function copySelected() {
    const fragment = selectedFragmentData('Copied selection')
    if (!fragment) return false
    rememberFragment(fragment)
    try {
      await navigator.clipboard.writeText(fragmentToClipboardText(fragment))
    } catch {
      error.value = 'Could not copy the selection to the system clipboard'
      return false
    }
    return true
  }

  async function cutSelected() {
    if (!await copySelected()) return
    deleteSelected()
  }

  async function pasteFragment(fragment, options: any = {}) {
    if (!fragment?.nodes?.length) return
    const { nodes: domainNodes, edges: domainEdges } = remapFragment(fragment, {
      offset: options.offset || pasteOffset(),
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
    const name = (await askName('Name this canvas', 'Canvas from selection'))?.trim()
    if (!name) return
    const selection = selectedFragmentData(name)
    if (!selection) return
    const payload = {
      name,
      description: `${selection.nodes.length} selected steps from ${activeCanvas.value.name}`,
      provider: activeCanvas.value.provider || defaultCanvasProvider,
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
    onEdgeClick,
    copySelected,
    cutSelected,
    pasteFragment,
    duplicateSelected,
    createCanvasFromSelection,
  }
}
