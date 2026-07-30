import { computed, nextTick, ref } from 'vue'
import { request } from '../api'
import { buildFragment, remapFragment } from '../canvas-fragment'

// Everything derived from, or acting on, the current canvas selection: the
// selection computeds, deletion, and the fragment clipboard (copy/paste/duplicate).
export function useCanvasSelection({ nodes, edges, activeCanvas, error, scheduleSave, fromCanvas, toCanvas, loadCanvass }) {
  const clipboardFragment = ref(null)
  const selectedNodes = computed(() => nodes.value.filter((node) => node.selected))
  const selectedEdges = computed(() => edges.value.filter((edge) => edge.selected))
  const frameableSelectedNodes = computed(() => selectedNodes.value.filter((node) => node.type !== 'frame' && !node.parentNode))
  const canFrameSelection = computed(() => frameableSelectedNodes.value.length > 0)
  const canDissolveSelection = computed(() => selectedNodes.value.some((node) => node.type === 'frame'))
  const selectedCount = computed(() => selectedNodes.value.length + selectedEdges.value.length)
  const hasSelectedNode = computed(() => selectedNodes.value.length > 0)
  const hasSelection = computed(() => selectedCount.value > 0)

  function deleteSelected({ preserveFrameChildren = true } = {}) {
    const selectedFrameIds = new Set(selectedNodes.value.filter((node) => node.type === 'frame').map((node) => node.id))
    const nodeIds = new Set(selectedNodes.value
      .filter((node) => node.type !== 'frame' && (!preserveFrameChildren || !selectedFrameIds.has(node.parentNode)))
      .map((node) => node.id))
    const edgeIds = new Set(selectedEdges.value.map((edge) => edge.id))
    const frames = new Map(nodes.value.filter((node) => selectedFrameIds.has(node.id)).map((node) => [node.id, node]))
    nodes.value = nodes.value
      .filter((node) => !selectedFrameIds.has(node.id) && !nodeIds.has(node.id))
      .map((node) => {
        const frame = frames.get(node.parentNode)
        if (!frame) return node
        return {
          ...node,
          parentNode: undefined,
          extent: undefined,
          expandParent: false,
          position: { x: frame.position.x + node.position.x, y: frame.position.y + node.position.y },
        }
      })
    edges.value = edges.value.filter((edge) =>
      !edgeIds.has(edge.id) &&
      !nodeIds.has(edge.source) &&
      !nodeIds.has(edge.target)
    )
    scheduleSave()
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
    clipboardFragment.value = fragment
    try {
      await navigator.clipboard.writeText(JSON.stringify(fragment, null, 2))
    } catch {
      // The in-app clipboard still works when browser clipboard permission is unavailable.
    }
  }

  async function pasteFragment(fragment = clipboardFragment.value, options: any = {}) {
    if (!fragment?.nodes?.length) return
    const maxX = nodes.value.length ? Math.max(...nodes.value.map((node) => node.position.x)) : 0
    const { nodes: domainNodes, edges: domainEdges } = remapFragment(fragment, {
      offset: options.offset || { x: maxX + 310, y: 120 },
      translateRoots: options.translateRoots,
    })
    activeCanvas.value = {
      ...fromCanvas(),
      nodes: [...fromCanvas().nodes, ...domainNodes],
      edges: [...fromCanvas().edges, ...domainEdges],
    }
    toCanvas(activeCanvas.value)
    await nextTick()
    if (options.selectInserted) {
      const insertedIds = new Set(domainNodes.map((node) => node.id))
      nodes.value = nodes.value.map((node) => ({ ...node, selected: insertedIds.has(node.id) }))
    }
    scheduleSave()
  }

  async function duplicateSelected() {
    const selected = selectedNodes.value
    const fragment = selectedFragmentData('Duplicated selection')
    if (!fragment || !selected.length) return
    const minX = Math.min(...selected.map((node) => node.position.x))
    const minY = Math.min(...selected.map((node) => node.position.y))
    await pasteFragment(fragment, { offset: { x: minX + 24, y: minY + 24 }, selectInserted: true })
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
      const canvas = await request('/api/canvases', {
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
    clipboardFragment,
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
