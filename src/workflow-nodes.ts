export type PortType = 'image' | 'text' | 'model' | 'any'

export interface NodePort {
  id: string
  label: string
  type: PortType
  required?: boolean
}

export interface NodeDefinition {
  category: string
  type: string
  label: string
  description: string
  inputTypes: PortType[]
  outputType: PortType | null
  inputPorts?: NodePort[]
  outputPorts?: NodePort[]
  hidden?: boolean
}

export const nodeCatalog: NodeDefinition[] = [
  { category: 'Annotate', type: 'frame', label: 'Section', description: 'Group related workflow steps', inputTypes: [], outputType: null },
  { category: 'Input', type: 'reference-image', label: 'Image Upload', description: 'Add an image or asset input', inputTypes: [], outputType: 'image' },
  { category: 'Output', type: 'generated-image', label: 'Image', description: 'An image created by a workflow step', inputTypes: ['image'], outputType: 'image', hidden: true },
  { category: 'Input', type: 'prompt', label: 'Text Prompt', description: 'Set creative direction', inputTypes: [], outputType: 'text' },
  { category: '2D', type: 'generate-image', label: 'Gen Image', description: 'Create concept images', inputTypes: ['image', 'text'], outputType: 'image' },
  { category: '2D', type: 'image-decomposition', label: 'Image Decomposition', description: 'Break an image into editable visual parts', inputTypes: ['image'], outputType: 'image' },
  {
    category: '2D',
    type: 'generate-multiview-images',
    label: 'Generate Multi-view Images',
    description: 'Create front, back, left, and right views from references',
    inputTypes: ['image', 'text'],
    outputType: null,
    outputPorts: multiViewPorts(),
  },
  { category: 'Annotate', type: 'review', label: 'Check', description: 'Pause to check the image before continuing', inputTypes: ['image'], outputType: 'image' },
  { category: '3D', type: 'generate-model', label: 'Gen HD Model', description: 'Turn an image or text prompt into a model', inputTypes: ['image', 'text'], outputType: 'model' },
  { category: '3D', type: 'smart-mesh', label: 'Smart Mesh', description: 'Generate a mesh from an image or text prompt', inputTypes: ['image', 'text'], outputType: 'model' },
  {
    category: '3D',
    type: 'multiview-to-3d',
    label: 'Multi-view to 3D',
    description: 'Turn four labeled image views into a 3D model',
    inputTypes: [],
    outputType: 'model',
    inputPorts: multiViewPorts(),
    hidden: true,
  },
  { category: '3D', type: 'text-to-3d', label: 'Text to 3D', description: 'Turn a text prompt into a model', inputTypes: ['text'], outputType: 'model', hidden: true },
  { category: '3D', type: 'retopology', label: 'Retopology', description: 'Optimize model geometry', inputTypes: ['model'], outputType: 'model' },
  {
    category: '3D',
    type: 'bake',
    label: 'Bake',
    description: 'Bake detail from one model onto another',
    inputTypes: [],
    outputType: 'model',
    inputPorts: bakePorts(),
  },
  { category: '3D', type: 'texture', label: 'UV Texture', description: 'Create UV textures from a model, image, or text', inputTypes: [], outputType: 'model', inputPorts: texturePorts() },
  { category: '3D', type: 'rigging', label: 'Rigging', description: 'Add a skeleton to a model', inputTypes: ['model'], outputType: 'model' },
  { category: '3D', type: 'split', label: 'Split', description: 'Split a model into parts', inputTypes: ['model'], outputType: 'model' },
  { category: '3D', type: 'model-preview', label: 'Model preview', description: 'Review the 3D result', inputTypes: ['model'], outputType: 'model' },
  { category: 'Output', type: 'export-model', label: 'Export', description: 'Export an image or 3D model', inputTypes: ['image', 'model'], outputType: null },
]

function multiViewPorts(): NodePort[] {
  return ['front', 'back', 'left', 'right'].map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1), type: 'image' }))
}

function bakePorts(): NodePort[] {
  return [
    { id: 'model-a', label: 'Model A', type: 'model' },
    { id: 'model-b', label: 'Model B', type: 'model' },
  ]
}

function texturePorts(): NodePort[] {
  return [
    { id: 'model', label: 'Model', type: 'model', required: true },
    { id: 'image', label: 'Image', type: 'image' },
    { id: 'text', label: 'Text', type: 'text' },
  ]
}

const lycheeNodeNames = new Map([
  ['reference-image', 'Image Upload'],
  ['generated-image', 'Image'],
  ['prompt', 'Text Prompt'],
  ['generate-image', 'Gen Image'],
  ['image-decomposition', 'Image Decomposition'],
  ['generate-multiview-images', 'Generate Multi-view Images'],
  ['generate-model', 'Gen HD Model'],
  ['smart-mesh', 'Smart Mesh'],
  ['multiview-to-3d', 'Multi-view to 3D'],
  ['review', 'Check'],
  ['text-to-3d', 'Text to 3D'],
  ['retopology', 'Retopology'],
  ['bake', 'Bake'],
  ['texture', 'UV Texture'],
  ['rigging', 'Rigging'],
  ['split', 'Split'],
  ['export-model', 'Export'],
])

export const nodeCategories = ['Annotate', 'Input', '2D', '3D', 'Output', 'Video']

export function nodeDefinition(type: string) {
  return nodeCatalog.find((item) => item.type === type)
}

export function nodeDisplayName(type: string, fallback?: string) {
  return lycheeNodeNames.get(type) || fallback || type
}

export function canConnectNodeTypes(sourceType: string, targetType: string) {
  return nodeOutputPorts(sourceType).length > 0 && nodeInputPorts(targetType).length > 0
}

// Each node exposes at most one connection handle per side: a single universal
// input (accepts image/text/model from any number of upstream nodes) and a
// single output carrying its result type.
export function nodeInputPorts(type: string): NodePort[] {
  const definition = nodeDefinition(type)
  return definition?.inputPorts?.length || definition?.inputTypes?.length ? [{ id: 'input', label: 'Input', type: 'any' }] : []
}

export function nodeOutputPorts(type: string): NodePort[] {
  const definition = nodeDefinition(type)
  const outputType = definition?.outputType || definition?.outputPorts?.[0]?.type
  return outputType ? [{ id: 'output', label: 'Output', type: outputType }] : []
}

export function canConnectPorts(sourceType: string, sourcePortId: string, targetType: string, targetPortId: string) {
  const sourcePort = nodeOutputPorts(sourceType).find((port) => port.id === sourcePortId)
  const targetPort = nodeInputPorts(targetType).find((port) => port.id === targetPortId)
  return Boolean(sourcePort && targetPort)
}

export function compatibleNodeTypes(sourceType: string) {
  return nodeCatalog.filter((item) => !item.hidden && canConnectNodeTypes(sourceType, item.type))
}
