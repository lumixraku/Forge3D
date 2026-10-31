import { nodeDefaults, nodeSchema } from './canvas-schema'

/**
 * Common workflows placed on every new project. They are ordinary nodes, so a
 * user can delete any section. Nothing here is a previous run.
 */
const COL = [48, 360, 672]
const TOP = 56
// Each stage gets an Asset Preview column after it, which pushes Export right,
// so a fitted section ends up about 1720 wide. Sized for that, plus a clear
// gap, so the Text to 3D section never lands on top of Image to 3D.
const FRAME_W = 1720
const FRAME_GAP = 200
const SINGLE_H = 720
const MULTI_H = 1180
const ROW = 270

function imageAsset(path) {
  return { assetType: 'image', assetUrl: path, reference: path.slice(1) }
}

function step(id, type, x, y, frameId, config = {}, name = '', uploadAssets = null) {
  return {
    id,
    type,
    name: name || nodeSchema(type, 'meshy')?.label || type,
    config: { ...nodeDefaults(type, 'meshy'), ...config },
    ...(uploadAssets ? { uploadAssets } : {}),
    ui: { position: { x, y }, parentFrameId: frameId },
  }
}

function frame(id, name, description, x, y, width, height) {
  return {
    id,
    type: 'frame',
    name,
    config: { description },
    ui: { position: { x, y }, size: { width, height } },
  }
}

function link(id, sourceId, sourcePort, targetId, targetPort) {
  return {
    id,
    source: { nodeId: sourceId, port: sourcePort },
    target: { nodeId: targetId, port: targetPort },
  }
}

export function starterCanvasGraph() {
  const nodes = [
    frame('starter-image', 'Image to 3D', 'One reference image becomes a textured model.', 0, 0, FRAME_W, SINGLE_H),
    step('starter-image-upload', 'reference-image', COL[0], TOP, 'starter-image', {}, 'Reference image', imageAsset('/shark-reference.png')),
    step('starter-image-model', 'generate-model', COL[1], TOP, 'starter-image'),
    step('starter-image-export', 'export-model', COL[2], TOP, 'starter-image', { fileName: 'image-to-3d' }),

    frame('starter-text', 'Text to 3D', 'A text prompt becomes a textured model.', FRAME_W + FRAME_GAP, 0, FRAME_W, SINGLE_H),
    step('starter-text-prompt', 'prompt', COL[0], TOP, 'starter-text'),
    step('starter-text-model', 'text-to-3d', COL[1], TOP, 'starter-text'),
    step('starter-text-export', 'export-model', COL[2], TOP, 'starter-text', { fileName: 'text-to-3d' }),

    frame('starter-multiview', 'Multi-view to 3D', 'Front, back, left, and right views of the same object become a model.', 0, SINGLE_H + FRAME_GAP, FRAME_W, MULTI_H),
    step('starter-mv-front', 'reference-image', COL[0], TOP, 'starter-multiview', {}, 'Front', imageAsset('/shark-concept-front.png')),
    step('starter-mv-back', 'reference-image', COL[0], TOP + ROW, 'starter-multiview', {}, 'Back', imageAsset('/shark-concept-back.png')),
    step('starter-mv-left', 'reference-image', COL[0], TOP + ROW * 2, 'starter-multiview', {}, 'Left', imageAsset('/shark-concept-left.png')),
    step('starter-mv-right', 'reference-image', COL[0], TOP + ROW * 3, 'starter-multiview', {}, 'Right', imageAsset('/shark-concept-right.png')),
    step('starter-mv-model', 'multiview-to-3d', COL[1], TOP + ROW, 'starter-multiview'),
    step('starter-mv-export', 'export-model', COL[2], TOP + ROW, 'starter-multiview', { fileName: 'multiview' }),
  ]

  const edges = [
    link('starter-edge-image', 'starter-image-upload', 'image', 'starter-image-model', 'image'),
    link('starter-edge-image-export', 'starter-image-model', 'model', 'starter-image-export', 'model'),
    link('starter-edge-text', 'starter-text-prompt', 'text', 'starter-text-model', 'text'),
    link('starter-edge-text-export', 'starter-text-model', 'model', 'starter-text-export', 'model'),
    link('starter-edge-mv-front', 'starter-mv-front', 'image', 'starter-mv-model', 'front'),
    link('starter-edge-mv-back', 'starter-mv-back', 'image', 'starter-mv-model', 'back'),
    link('starter-edge-mv-left', 'starter-mv-left', 'image', 'starter-mv-model', 'left'),
    link('starter-edge-mv-right', 'starter-mv-right', 'image', 'starter-mv-model', 'right'),
    link('starter-edge-mv-export', 'starter-mv-model', 'model', 'starter-mv-export', 'model'),
  ]

  return { nodes, edges }
}

export const starterCanvasViewport = { x: 48, y: 36, zoom: 0.6 }
