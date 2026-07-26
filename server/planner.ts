import { describeWorkflowParameters, workflowParameters } from './workflow-parameters.js'
import { randomUUID } from './ids.js'

export const nodeDefaults = {
  'reference-image': { name: 'Image Upload', config: { sourceType: 'Upload', reference: '', background: 'Keep', preview: '/shark-reference.png' } },
  prompt: { name: 'Text Prompt', config: { prompt: 'Production-ready stylized 3D asset', strength: 80 } },
  'generate-image': { name: 'Gen Image', config: { model: 'GPT Image 2', count: 4, aspectRatio: '1:1', referenceMode: 'Image + Prompt', previews: ['/shark-concept-front.png', '/shark-concept-left.png', '/shark-concept-right.png', '/shark-concept-back.png'] } },
  'generate-multiview-images': { name: 'Generate Multi-view Images', config: { model: 'GPT Image 2', aspectRatio: '1:1', referenceMode: 'Image + Prompt', viewPreviews: { front: '/shark-concept-front.png', back: '/shark-concept-back.png', left: '/shark-concept-left.png', right: '/shark-concept-right.png' } } },
  'generate-model': { name: 'Gen HD Model', config: { modelVersion: 'Smart Mesh', textureMode: 'PBR', faceType: 'Triangle', faceCount: 20000, preview: '/shark-model.png' } },
  'smart-mesh': { name: 'Smart Mesh', config: { faceType: 'Triangle', faceCount: 20000, textureQuality: 'No texture', pbr: true, preview: '/shark-model.png' } },
  'multiview-to-3d': { name: 'Multi-view to 3D', config: { modelVersion: 'Smart Mesh', textureMode: 'PBR', faceType: 'Triangle', faceCount: 20000, preview: '/shark-model.png' } },
  review: { name: 'Check', config: { instruction: 'Check the generated image before continuing.', preview: '/shark-concept-front.png', approved: false } },
  'text-to-3d': { name: 'Text to 3D', config: { modelVersion: 'Smart Mesh', textureMode: 'PBR', faceType: 'Triangle', faceCount: 20000, preview: '/shark-model.png' } },
  retopology: { name: 'Retopology', config: { modelVersion: 'v2.0', faceType: 'Triangle', faceLimit: 10000, bakeTextures: true, preview: '/shark-retopology.png' } },
  bake: { name: 'Bake', config: { preview: '/shark-model.png' } },
  texture: { name: 'UV Texture', config: { textureQuality: '2K', pbr: true, preview: '/shark-textured.png' } },
  rigging: { name: 'Rigging', config: { preview: '/shark-model.png' } },
  split: { name: 'Split', config: { subdivision: 'Medium', complete: true, preview: '/shark-model.png' } },
  'model-preview': { name: 'Review 3D Result', config: { environment: 'Studio', autoRotate: true, wireframe: false, preview: '/shark-review.png' } },
  'export-model': { name: 'Export', config: { modelFormat: 'GLB', exportTargets: ['dcc'] } },
}

function frameName(message) {
  if (/blahaj|鲨鱼/i.test(message)) return 'Blahaj 3D Reconstruction'
  return '3D Asset Reconstruction'
}

function createFrame(message, nodes = []) {
  return {
    id: slug('frame-main', nodes),
    type: 'frame',
    name: frameName(message),
    config: {},
    ui: { position: { x: 40, y: 80 }, size: { width: 1640, height: 650 } },
  }
}

function slug(type, nodes) {
  let id = type
  let index = 2
  while (nodes.some((node) => node.id === id)) id = `${type}-${index++}`
  return id
}

function createNode(type, nodes) {
  const id = slug(type, nodes)
  const previous = nodes.filter((node) => node.type !== 'frame').at(-1)
  const frame = nodes.find((node) => node.type === 'frame')
  return {
    id,
    type,
    name: nodeDefaults[type].name,
    config: structuredClone(nodeDefaults[type].config),
    ui: { position: { x: previous ? previous.ui.position.x + 340 : 100, y: previous?.ui.position.y ?? 150 }, ...(frame ? { parentFrameId: frame.id } : {}) },
  }
}

function fitFrame(nodes, options = {}) {
  const padding = options.padding ?? 70
  const nodeWidth = options.nodeWidth ?? 260
  const nodeHeight = options.nodeHeight ?? 430
  for (const frame of nodes.filter((node) => node.type === 'frame')) {
    const children = nodes.filter((node) => node.ui.parentFrameId === frame.id)
    if (!children.length) continue

    const minX = Math.min(...children.map((node) => node.ui.position.x))
    const minY = Math.min(...children.map((node) => node.ui.position.y))
    const maxX = Math.max(...children.map((node) => node.ui.position.x + nodeWidth))
    const maxY = Math.max(...children.map((node) => node.ui.position.y + nodeHeight))

    frame.ui.size = { width: maxX - minX + padding * 2, height: maxY - minY + padding * 2 }
    for (const child of children) {
      child.ui.position.x += padding - minX
      child.ui.position.y += padding - minY
    }
  }
  return nodes
}

export function rebuildDagEdges(nodes) {
  const byType = new Map(nodes.map((node) => [node.type, node]))
  const edges = []
  const connect = (sourceType, sourcePort, targetType, targetPort) => {
    const source = byType.get(sourceType)
    const target = byType.get(targetType)
    if (!source || !target) return
    edges.push({
      id: sourcePort === targetPort && sourcePort !== 'front' && sourcePort !== 'back' && sourcePort !== 'left' && sourcePort !== 'right'
        ? `${source.id}-${target.id}`
        : `${source.id}-${sourcePort}-${target.id}-${targetPort}`,
      source: { nodeId: source.id, port: sourcePort },
      target: { nodeId: target.id, port: targetPort },
    })
  }

  connect('reference-image', 'image', 'generate-image', 'image')
  connect('prompt', 'prompt', 'generate-image', 'prompt')
  connect('generate-image', 'image', 'generate-model', 'image')
  connect('reference-image', 'image', 'generate-multiview-images', 'image')
  connect('prompt', 'text', 'generate-multiview-images', 'text')
  connect('prompt', 'text', 'text-to-3d', 'text')
  connect('generate-image', 'image', 'smart-mesh', 'image')
  connect('prompt', 'text', 'smart-mesh', 'text')
  // Multi-view images feed the 3D reconstruction stage. Without this the
  // generate-multiview-images node is left dangling before the model node.
  connect('generate-multiview-images', 'image', 'multiview-to-3d', 'image')
  connect('generate-multiview-images', 'image', 'generate-model', 'image')
  connect('generate-multiview-images', 'image', 'smart-mesh', 'image')

  const modelSource = byType.has('text-to-3d')
    ? 'text-to-3d'
    : byType.has('multiview-to-3d')
      ? 'multiview-to-3d'
      : byType.has('smart-mesh')
        ? 'smart-mesh'
        : 'generate-model'
  const modelChain = [modelSource, 'retopology', 'texture', 'rigging', 'split'].filter((type) => byType.has(type))
  modelChain.slice(1).forEach((type, index) => connect(modelChain[index], 'model', type, 'model'))
  const finalModelType = modelChain.at(-1)
  const finalNodeType = byType.has('export-model') ? 'export-model' : 'model-preview'
  connect(finalModelType, 'model', finalNodeType, 'model')

  return edges
}

export function buildWorkflowStructure(message, types, existingWorkflow = null) {
  const normalizedTypes = [...new Set(types)].filter((type) => nodeDefaults[type])
  if (!normalizedTypes.length) return existingWorkflow ? structuredClone(existingWorkflow) : baseWorkflow(message)

  const nodes = [createFrame(message)]
  for (const type of normalizedTypes) nodes.push(createNode(type, nodes))
  fitFrame(nodes)
  const now = new Date().toISOString()
  const workflow = existingWorkflow ? structuredClone(existingWorkflow) : {
    schemaVersion: '1.0',
    id: `wf-${randomUUID()}`,
    revision: 0,
    createdAt: now,
  }
  const textTo3d = normalizedTypes.includes('text-to-3d')
  return {
    ...workflow,
    name: existingWorkflow?.name || (textTo3d ? 'Text to 3D Pipeline' : '3D Asset Pipeline'),
    description: existingWorkflow?.description || 'A reusable 3D production workflow created through conversation.',
    revision: existingWorkflow ? existingWorkflow.revision + 1 : 1,
    updatedAt: now,
    nodes,
    edges: rebuildDagEdges(nodes),
    viewport: { x: 80, y: 160, zoom: 0.72 },
  }
}

function requestedStructure(message) {
  const lower = message.toLowerCase()
  const imageFirst = /图生|文字.*生成图片|图片.*(?:生成|转).*3d|根据图片.*3d|image.*(?:to|into).*3d|reference.*3d/i.test(message)
  const textFirst = /文生|文字.*(?:生成|转).*3d|text.*(?:to|into).*3d/i.test(message)
  if (!/创建|新建|构建|搭建|设计|重建|build|create|construct|workflow|流程/i.test(message) || (!imageFirst && !textFirst)) return null
  if (imageFirst) return ['reference-image', 'prompt', 'generate-image', 'generate-model', 'export-model']
  return ['prompt', 'text-to-3d', 'export-model']
}

function baseWorkflow(message) {
  const lower = message.toLowerCase()
  const name = lower.includes('prop') || message.includes('道具') ? 'Game Prop Pipeline' : '3D Asset Pipeline'
  const textTo3d = /text[ -]?to[ -]?3d|generate (?:a )?(?:3d )?model from (?:text|a prompt|a description)|文生3d|文字生成3d|文本生成3d|提示词生成3d|根据描述生成3d/i.test(message)
  const types = textTo3d
    ? ['prompt', 'text-to-3d', 'export-model']
    : ['reference-image', 'prompt', 'generate-image', 'generate-model', 'export-model']
  const nodes = [createFrame(message)]
  for (const type of types) nodes.push(createNode(type, nodes))
  fitFrame(nodes)
  return {
    schemaVersion: '1.0',
    id: `wf-${randomUUID()}`,
    name,
    description: 'A reusable 3D production workflow created through conversation.',
    revision: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    nodes,
    edges: rebuildDagEdges(nodes),
    viewport: { x: 80, y: 160, zoom: 0.72 },
  }
}

function insertBefore(workflow, type, beforeTypes) {
  if (workflow.nodes.some((node) => node.type === type)) return false
  const node = createNode(type, workflow.nodes)
  const index = workflow.nodes.findIndex((candidate) => beforeTypes.includes(candidate.type))
  workflow.nodes.splice(index < 0 ? workflow.nodes.length : index, 0, node)
  return true
}

export function addWorkflowStage(workflow, type, message = '') {
  const nextWorkflow = structuredClone(workflow)
  const allowedTypes = new Set(['frame', ...Object.keys(nodeDefaults)])
  if (!allowedTypes.has(type)) throw new Error(`Unsupported workflow stage: ${type}`)

  const changedNodeIds = []
  if (type === 'frame') {
    const frame = createFrame(message, nextWorkflow.nodes)
    nextWorkflow.nodes.push(frame)
    changedNodeIds.push(frame.id)
  } else if (insertBefore(nextWorkflow, type, type === 'review' ? ['generate-model', 'multiview-to-3d'] : ['export-model', 'model-preview'])) {
    changedNodeIds.push(nextWorkflow.nodes.find((node) => node.type === type).id)
  }

  if (!changedNodeIds.length) {
    return { workflow: nextWorkflow, changedNodeIds, structureChanged: false }
  }

  nextWorkflow.edges = rebuildDagEdges(nextWorkflow.nodes)
  fitFrame(nextWorkflow.nodes)
  nextWorkflow.revision += 1
  nextWorkflow.updatedAt = new Date().toISOString()
  return { workflow: nextWorkflow, changedNodeIds, structureChanged: true }
}

function parameterHelpType(message) {
  if (/split|拆件|拆分|分件/i.test(message)) return 'split'
  if (/smart[ -]?mesh|智能网格/i.test(message)) return 'smart-mesh'
  if (/retopo|拓扑|减面/i.test(message)) return 'retopology'
  if (/texture|贴图|纹理/i.test(message)) return 'texture'
  if (/text[ -]?to[ -]?3d|文生3d/i.test(message)) return 'text-to-3d'
  if (/multi[ -]?view|多视角|四视图/i.test(message)) return 'multiview-to-3d'
  if (/image[ -]?to[ -]?3d|图生3d/i.test(message)) return 'generate-model'
  if (/prompt|提示词/i.test(message)) return 'prompt'
  return null
}

function numberFrom(match) {
  if (!match) return null
  const value = Number(match[1].replaceAll(',', ''))
  return Number.isFinite(value) ? value : null
}

function setParameter(workflow, changes, type, field, value) {
  const node = workflow.nodes.find((candidate) => candidate.type === type)
  const definition = workflowParameters[type]?.fields[field]
  if (!node || !definition) return false
  if (definition.kind === 'number' && (value < definition.min || value > definition.max || value % definition.step !== 0)) return false
  if (definition.kind === 'enum' && !definition.values.includes(value)) return false
  const previousValue = node.config[field]
  if (previousValue === value) return true
  node.config = { ...node.config, [field]: value }
  changes.push({ nodeId: node.id, nodeLabel: workflowParameters[type].label, fieldLabel: definition.label, previousValue, value })
  return true
}

export function applyParameterChanges(message, workflow, changes) {
  const lower = message.toLowerCase()
  const retopoFaces = numberFrom(lower.match(/(?:retopo(?:logy)?|拓扑|减面)[^\d]{0,30}(\d[\d,]*)\s*(?:faces?|面)?/))
    ?? numberFrom(lower.match(/(?:face limit|target faces?|目标面数)[^\d]{0,12}(\d[\d,]*)/))
  if (retopoFaces !== null) setParameter(workflow, changes, 'retopology', 'faceLimit', retopoFaces)

  const retopoFaceType = lower.match(/(?:retopo(?:logy)?|拓扑|减面)[^.;；。]{0,50}(triangle|quad|三角面|四边面)/)?.[1]
    ?? lower.match(/(?:face type|面类型)[^.;；。]{0,12}(triangle|quad|三角面|四边面)/)?.[1]
  if (retopoFaceType) {
    setParameter(workflow, changes, 'retopology', 'faceType', /quad|四边面/.test(retopoFaceType) ? 'Quad' : 'Triangle')
  }

  const generatedFaces = numberFrom(lower.match(/(?:text[ -]?to[ -]?3d|image[ -]?to[ -]?3d|generate(?:d)?|生成)[^\d]{0,30}(\d[\d,]*)\s*(?:faces?|面)/))
    ?? numberFrom(lower.match(/(?:face count|生成面数)[^\d]{0,12}(\d[\d,]*)/))
  if (generatedFaces !== null) {
    const type = workflow.nodes.some((node) => node.type === 'text-to-3d') ? 'text-to-3d' : workflow.nodes.some((node) => node.type === 'multiview-to-3d') ? 'multiview-to-3d' : 'generate-model'
    setParameter(workflow, changes, type, 'faceCount', generatedFaces)
  }

  const resolution = lower.match(/\b(1k|2k|4k)\b/)?.[1]?.toUpperCase()
  if (resolution && /texture|uv|resolution|贴图|纹理|分辨率/i.test(message)) setParameter(workflow, changes, 'texture', 'textureQuality', resolution)

  const strength = numberFrom(lower.match(/(?:prompt strength|提示词强度)[^\d]{0,12}(\d{1,3})\s*%?/))
  if (strength !== null) setParameter(workflow, changes, 'prompt', 'strength', strength)

  const version = lower.match(/\b(v(?:1\.0|2\.0|2\.5))\b/)?.[1]
  if (version) {
    const canonical = `v${version.slice(1)}`
    const type = /retopo|拓扑|减面/i.test(message)
      ? 'retopology'
      : workflow.nodes.some((node) => node.type === 'text-to-3d') ? 'text-to-3d' : workflow.nodes.some((node) => node.type === 'multiview-to-3d') ? 'multiview-to-3d' : 'generate-model'
    setParameter(workflow, changes, type, 'modelVersion', canonical)
  }
}

export function planWorkflow(message, existingWorkflow) {
  const lower = message.toLowerCase()
  const requestedTypes = requestedStructure(message)
  if (requestedTypes && existingWorkflow) {
    const workflow = buildWorkflowStructure(message, requestedTypes, existingWorkflow)
    return {
      workflow,
      reply: `I built a ${requestedTypes.includes('text-to-3d') ? 'text-to-3D' : 'image-first 3D'} workflow with ${requestedTypes.length} stages inside one frame.`,
      changedNodeIds: workflow.nodes.map((node) => node.id),
      structureChanged: true,
    }
  }
  const workflow = existingWorkflow ? structuredClone(existingWorkflow) : baseWorkflow(message)
  const changes = []
  const structuralChanges = []
  const helpRequest = existingWorkflow && /(?:what|which|show|list).*(?:parameters?|settings?)|(?:parameters?|settings?).*(?:available|adjust|change)|哪些?参数|参数.*(?:可以|能).*(?:调|改)|有什么.*参数/i.test(message)

  if (helpRequest) {
    const description = describeWorkflowParameters(workflow, parameterHelpType(message))
    return { workflow, reply: description || 'This workflow has no adjustable parameters.', changedNodeIds: [], structureChanged: false }
  }

  if (/审核|审查|确认|review|approval|approve/i.test(message)) {
    if (insertBefore(workflow, 'review', ['generate-model', 'multiview-to-3d'])) structuralChanges.push(workflow.nodes.find((node) => node.type === 'review').id)
  }
  if (/低模|low[ -]?poly|retopo/.test(lower)) {
    if (insertBefore(workflow, 'retopology', ['texture', 'export-model', 'model-preview'])) structuralChanges.push(workflow.nodes.find((node) => node.type === 'retopology').id)
  }
  if (/贴图|texture|pbr/.test(lower)) {
    if (insertBefore(workflow, 'texture', ['export-model', 'model-preview'])) structuralChanges.push(workflow.nodes.find((node) => node.type === 'texture').id)
  }
  if (/rigging|rig|骨骼|绑定/.test(lower)) {
    if (insertBefore(workflow, 'rigging', ['split', 'export-model', 'model-preview'])) structuralChanges.push(workflow.nodes.find((node) => node.type === 'rigging').id)
  }
  if (/split|拆件|拆分|分件/.test(lower)) {
    if (insertBefore(workflow, 'split', ['export-model', 'model-preview'])) structuralChanges.push(workflow.nodes.find((node) => node.type === 'split').id)
  }

  if (existingWorkflow) applyParameterChanges(message, workflow, changes)

  if (structuralChanges.length) {
    workflow.edges = rebuildDagEdges(workflow.nodes)
    fitFrame(workflow.nodes)
  }
  const didChange = !existingWorkflow || structuralChanges.length || changes.length
  if (existingWorkflow && didChange) workflow.revision += 1
  if (didChange) workflow.updatedAt = new Date().toISOString()

  const reply = existingWorkflow
    ? changes.length
      ? changes.map((change) => `${change.nodeLabel}: ${change.fieldLabel} ${change.previousValue} → ${change.value}`).join('\n')
      : structuralChanges.length
        ? `I added ${structuralChanges.length} requested workflow stage${structuralChanges.length === 1 ? '' : 's'}.`
        : 'I could not find a supported parameter change. Ask “What parameters can I adjust?” to see the available controls.'
    : `I created “${workflow.name}” as a reusable workflow. You can move nodes freely, edit the structure, and continue refining it through conversation.`

  return {
    workflow,
    reply,
    changedNodeIds: [...new Set([...structuralChanges, ...changes.map((change) => change.nodeId)])],
    structureChanged: !existingWorkflow || structuralChanges.length > 0,
  }
}
