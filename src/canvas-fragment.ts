import { decode, encode } from '@msgpack/msgpack'
import { nodeSize } from './frame-geometry'

export const CLIPBOARD_MIME = 'web application/vnd.forge3d.canvas-fragment+msgpack'

export function serializeFragment(fragment) {
  return encode(fragment)
}

export function parseFragment(bytes) {
  try {
    const fragment = decode(bytes)
    if (fragment?.kind !== 'canvas-fragment' || fragment?.schemaVersion !== '1.0' || !Array.isArray(fragment.nodes) || !Array.isArray(fragment.edges)) return null
    validateImportedCanvas(fragment)
    return fragment.nodes.length ? fragment : null
  } catch {
    return null
  }
}

// A fragment is a self-contained, position-normalized slice of a canvas: the
// selected nodes, the edges between them, and the ports that crossed the cut.
export function buildFragment(canvas, selectedIds: Set<string>, name = 'Untitled block') {
  const includedIds = new Set(selectedIds)
  let addedDescendant = true
  while (addedDescendant) {
    addedDescendant = false
    for (const node of canvas.nodes) {
      if (node.ui?.parentFrameId && includedIds.has(node.ui.parentFrameId) && !includedIds.has(node.id)) {
        includedIds.add(node.id)
        addedDescendant = true
      }
    }
  }
  const fragmentNodes = canvas.nodes.filter((node) => includedIds.has(node.id))
  if (!fragmentNodes.length) return null
  const roots = fragmentNodes.filter((node) => !node.ui?.parentFrameId || !includedIds.has(node.ui.parentFrameId))
  const minX = Math.min(...roots.map((node) => node.ui.position.x))
  const minY = Math.min(...roots.map((node) => node.ui.position.y))
  const internalEdges = canvas.edges.filter((edge) => includedIds.has(edge.source.nodeId) && includedIds.has(edge.target.nodeId))
  const inputs = canvas.edges
    .filter((edge) => !includedIds.has(edge.source.nodeId) && includedIds.has(edge.target.nodeId))
    .map((edge) => ({ nodeId: edge.target.nodeId, port: edge.target.port }))
  const outputs = canvas.edges
    .filter((edge) => includedIds.has(edge.source.nodeId) && !includedIds.has(edge.target.nodeId))
    .map((edge) => ({ nodeId: edge.source.nodeId, port: edge.source.port }))

  return {
    schemaVersion: '1.0',
    kind: 'canvas-fragment',
    name,
    description: `${fragmentNodes.length}-step reusable block from ${canvas.name}`,
    source: { canvasId: canvas.id, canvasRevision: canvas.revision },
    // Results stay out of a fragment: copying a node takes its configuration and
    // the assets the user uploaded to it, not what it last produced. `uploadAssets`
    // rides along for that reason — it is the user's own input. Copy, duplicate and
    // new-canvas-from-selection all come through here, so this one filter covers
    // every one of them.
    nodes: fragmentNodes.map((node) => {
      // `roots` holds the source nodes themselves, so the membership test has to
      // run against `node` rather than the copy built from it.
      const { generatedAssets, ...fragmentNode } = node
      return {
        ...fragmentNode,
        ui: {
          ...node.ui,
          position: roots.includes(node)
            ? { x: node.ui.position.x - minX, y: node.ui.position.y - minY }
            : { ...node.ui.position },
        },
      }
    }),
    edges: internalEdges,
    interface: { inputs, outputs },
  }
}

// Give a fragment fresh ids so it can be inserted alongside its source, and shift
// it into place. `translateRoots` moves every node without a parent frame (used by
// import); otherwise only frames move and their children ride along.
export function remapFragment(fragment, { offset, suffix = crypto.randomUUID() }) {
  const idMap = new Map(fragment.nodes.map((node, index) => [node.id, `${node.id}-${suffix}-${index}`]))
  const nodes = fragment.nodes.map((node) => ({
    ...JSON.parse(JSON.stringify(node)),
    id: idMap.get(node.id),
    ui: {
      ...node.ui,
      position: {
        x: node.ui.position.x + (!node.ui.parentFrameId ? offset.x : 0),
        y: node.ui.position.y + (!node.ui.parentFrameId ? offset.y : 0),
      },
      ...(node.ui.parentFrameId ? { parentFrameId: idMap.get(node.ui.parentFrameId) } : {}),
    },
  }))
  const edges = (fragment.edges || [])
    .filter((edge) => idMap.has(edge.source?.nodeId) && idMap.has(edge.target?.nodeId))
    .map((edge, index) => ({
      ...JSON.parse(JSON.stringify(edge)),
      id: `${edge.id || 'edge'}-${suffix}-${index}`,
      source: { ...edge.source, nodeId: idMap.get(edge.source.nodeId) },
      target: { ...edge.target, nodeId: idMap.get(edge.target.nodeId) },
    }))

  return { nodes, edges }
}

export function validateImportedCanvas(input) {
  if (!Array.isArray(input.nodes) || !Array.isArray(input.edges || [])) {
    throw new Error('Canvas JSON must include nodes and edges arrays')
  }
  if (input.nodes.some((node) => (
    typeof node?.id !== 'string'
    || !node.id
    || !Number.isFinite(node.ui?.position?.x)
    || !Number.isFinite(node.ui?.position?.y)
  ))) {
    throw new Error('Imported nodes must have IDs and valid positions')
  }
  const nodeIds = new Set(input.nodes.map((node) => node.id))
  if (nodeIds.size !== input.nodes.length) {
    throw new Error('Imported nodes must have unique IDs')
  }
  if (input.nodes.some((node) => node.ui?.parentFrameId && !nodeIds.has(node.ui.parentFrameId))) {
    throw new Error('Imported nodes must include their parent frames')
  }
  if ((input.edges || []).some((edge) => !nodeIds.has(edge.source?.nodeId) || !nodeIds.has(edge.target?.nodeId))) {
    throw new Error('Imported edges must connect imported nodes')
  }
}

// Drop an imported canvas to the right of everything already on the canvas.
export function importPlacementOffset(canvasNodes, importedNodes) {
  const currentRoots = canvasNodes.filter((node) => !node.parentNode)
  const currentRight = currentRoots.length
    ? Math.max(...currentRoots.map((node) => node.position.x + nodeSize(node).width))
    : 0
  const importedRoots = importedNodes.filter((node) => !node.ui?.parentFrameId)
  const importedLeft = importedRoots.length
    ? Math.min(...importedRoots.map((node) => Number(node.ui?.position?.x) || 0))
    : 0
  return { x: currentRight + 80 - importedLeft, y: 0 }
}
