export type PortType = 'image' | 'text' | 'model' | 'any'
export type ParameterValue = string | number | boolean

export interface NodePort {
  id: string
  label: string
  type: PortType
  required?: boolean
}

export interface ParameterOption {
  value: string | number
  label: string
}

export interface ParameterCondition {
  field: string
  equals: ParameterValue
}

export interface ParameterRange {
  min: number
  max: number
  step: number
  rules?: Array<{ when: ParameterCondition[]; min?: number; max?: number }>
}

export interface NodeParameter {
  key: string
  label: string
  control: 'text' | 'textarea' | 'select' | 'segmented' | 'slider' | 'toggle'
  options?: ParameterOption[]
  range?: ParameterRange
  placeholder?: string
  visibleWhen?: ParameterCondition[]
}

export interface NodeEffect {
  when: ParameterCondition
  set: Record<string, ParameterValue>
}

export interface WorkflowNodeSchema {
  type: string
  category: string
  label: string
  description: string
  presentation: { kind: string; detail: string; tone: string }
  inputTypes: PortType[]
  outputType: PortType | null
  inputPorts?: NodePort[]
  outputPorts?: NodePort[]
  hidden?: boolean
  executable?: boolean
  modelEditor?: boolean
  defaults: Record<string, unknown>
  parameters: NodeParameter[]
  effects?: NodeEffect[]
}

const options = (entries: Array<[string | number, string]>): ParameterOption[] => entries.map(([value, label]) => ({ value, label }))
const imageModels = options([
  ['gemini_3.1_flash_image_preview', 'Nano Banana 2'], ['gemini_2.5_flash_image_preview', 'Nano Banana'],
  ['gemini_3_pro_image_preview', 'Nano Banana Pro'], ['gpt_image_2', 'GPT Image 2'],
  ['gpt_image_1.5', 'GPT Image 1.5'], ['midjourney', 'Midjourney'],
])
const modelVersions = options([['v3.1-20260211', 'v3.1 · Best Quality'], ['v3.0-20250812', 'v3.0 · Fast & Balanced'], ['v2.5-20250123', 'v2.5 · Legacy']])
const textureQualities = options([['standard', '2K'], ['detailed', '4K'], ['extreme', '8K']])
const topology = options([['triangle', 'Triangle'], ['quad', 'Quad']])
const retopologyTopology = options([['quad', 'Quad'], ['triangle', 'Triangle']])
const detailLevels = options([['low', 'Simple · 3-6 parts'], ['medium', 'Balanced · 6-15 parts'], ['high', 'Detailed · 15+ parts']])
const imageAmounts = options([[1, '1'], [2, '2'], [3, '3'], [4, '4']])
const scales = options([['1:1', '1:1'], ['3:4', '3:4'], ['4:3', '4:3'], ['9:16', '9:16'], ['16:9', '16:9']])
const multiViewPorts = ['front', 'back', 'left', 'right'].map((id): NodePort => ({ id, label: id[0].toUpperCase() + id.slice(1), type: 'image' }))
const modelDefaults = { modelVersion: 'v3.1-20260211', geometryQuality: 'detailed', topology: 'triangle', faceCount: 2000000, texture: true, pbr: true, generateParts: false, texture8k: true, privacy: 'sharing-only', preview: '/shark-model.png' }
const modelParameters: NodeParameter[] = [
  { key: 'modelVersion', label: 'AI Model', control: 'select', options: modelVersions },
  { key: 'geometryQuality', label: 'Ultra Mesh Quality', control: 'segmented', options: options([['standard', 'Standard'], ['detailed', 'Detailed']]), visibleWhen: [{ field: 'modelVersion', equals: 'v3.1-20260211' }] },
  { key: 'topology', label: 'Topology', control: 'segmented', options: topology },
  { key: 'faceCount', label: 'Polycount', control: 'slider', range: { min: 500, max: 1000000, step: 500, rules: [{ when: [{ field: 'geometryQuality', equals: 'detailed' }], max: 2000000 }, { when: [{ field: 'topology', equals: 'quad' }], max: 50000 }, { when: [{ field: 'generateParts', equals: true }], min: 10000 }] } },
  { key: 'texture', label: 'Texture', control: 'toggle' },
  { key: 'pbr', label: 'PBR', control: 'toggle', visibleWhen: [{ field: 'texture', equals: true }] },
  { key: 'generateParts', label: 'Generate in Parts', control: 'toggle' },
  { key: 'texture8k', label: '8K Texture', control: 'toggle', visibleWhen: [{ field: 'texture', equals: true }] },
  { key: 'privacy', label: 'Privacy', control: 'select', options: options([['sharing-only', 'Sharing Only'], ['private', 'Private']]) },
]
const modelEffects: NodeEffect[] = [{ when: { field: 'generateParts', equals: true }, set: { topology: 'triangle', texture: false, pbr: false } }]

export const workflowNodeSchema: WorkflowNodeSchema[] = [
  { type: 'frame', category: 'Annotate', label: 'Section', description: 'Group related workflow steps', presentation: { kind: 'SECTION', detail: 'Workflow group', tone: 'slate' }, inputTypes: [], outputType: null, defaults: {}, parameters: [] },
  { type: 'reference-image', category: 'Input', label: 'Image Upload', description: 'Add an image or asset input', presentation: { kind: 'INPUT', detail: 'Reference source', tone: 'cyan' }, inputTypes: [], outputType: 'image', defaults: { reference: '', preview: '/shark-reference.png' }, parameters: [] },
  { type: 'generated-image', category: 'Output', label: 'Image', description: 'An image created by a workflow step', presentation: { kind: 'OUTPUT', detail: 'Generated view', tone: 'amber' }, inputTypes: ['image'], outputType: 'image', hidden: true, defaults: { preview: '/shark-concept-front.png' }, parameters: [] },
  { type: 'prompt', category: 'Input', label: 'Text Prompt', description: 'Set creative direction', presentation: { kind: 'PROMPT', detail: 'Creative direction', tone: 'violet' }, inputTypes: [], outputType: 'text', defaults: { prompt: 'Production-ready stylized 3D asset', tPose: false }, parameters: [{ key: 'prompt', label: 'Prompt', control: 'textarea' }, { key: 'tPose', label: 'T-Pose', control: 'toggle' }] },
  { type: 'generate-image', category: '2D', label: 'Gen Image', description: 'Create concept images', presentation: { kind: 'IMAGE', detail: 'Concept generation', tone: 'amber' }, inputTypes: ['image', 'text'], outputType: 'image', executable: true, defaults: { modelVersion: 'gemini_2.5_flash_image_preview', amount: 4, scale: '1:1', previews: ['/shark-concept-front.png', '/shark-concept-left.png', '/shark-concept-right.png', '/shark-concept-back.png'] }, parameters: [{ key: 'modelVersion', label: 'Image Model', control: 'select', options: imageModels }, { key: 'amount', label: 'Images', control: 'select', options: imageAmounts }, { key: 'scale', label: 'Aspect Ratio', control: 'select', options: scales }] },
  { type: 'image-decomposition', category: '2D', label: 'Image Decomposition', description: 'Break an image into editable visual parts', presentation: { kind: 'DECOMPOSE', detail: 'Image parts', tone: 'cyan' }, inputTypes: ['image'], outputType: 'image', executable: true, defaults: { modelVersion: 'gemini_2.5_flash_image_preview', prompt: '', amount: 4, scale: '1:1', resolution: '1K', templateKey: 'asset_extraction', previews: [] }, parameters: [{ key: 'modelVersion', label: 'Image Model', control: 'select', options: imageModels }, { key: 'prompt', label: 'Prompt', control: 'textarea', placeholder: 'Optional extraction instructions' }, { key: 'amount', label: 'Outputs', control: 'select', options: imageAmounts }, { key: 'scale', label: 'Aspect Ratio', control: 'select', options: scales }, { key: 'resolution', label: 'Resolution', control: 'select', options: options([['1K', '1K'], ['2K', '2K'], ['4K', '4K']]) }] },
  { type: 'generate-multiview-images', category: '2D', label: 'Generate Multi-view Images', description: 'Create front, back, left, and right views from references', presentation: { kind: 'MULTI-VIEW', detail: 'Four-view generation', tone: 'amber' }, inputTypes: ['image', 'text'], outputType: null, outputPorts: multiViewPorts, executable: true, defaults: { viewPreviews: { front: '/shark-concept-front.png', back: '/shark-concept-back.png', left: '/shark-concept-left.png', right: '/shark-concept-right.png' } }, parameters: [] },
  { type: 'review', category: 'Annotate', label: 'Check', description: 'Pause to check the image before continuing', presentation: { kind: 'CHECK', detail: 'Approval gate', tone: 'rose' }, inputTypes: ['image'], outputType: 'image', defaults: { instruction: 'Review the generated image before continuing.', preview: '/shark-concept-front.png', approved: false }, parameters: [] },
  ...['generate-model', 'multiview-to-3d', 'text-to-3d'].map((type): WorkflowNodeSchema => ({ type, category: '3D', label: type === 'generate-model' ? 'Gen HD Model' : type === 'multiview-to-3d' ? 'Multi-view to 3D' : 'Text to 3D', description: type === 'generate-model' ? 'Turn an image or text prompt into a model' : type === 'multiview-to-3d' ? 'Turn four labeled image views into a 3D model' : 'Turn a text prompt into a model', presentation: { kind: '3D MODEL', detail: type === 'generate-model' ? 'Image or text to 3D' : type === 'multiview-to-3d' ? 'Four-view reconstruction' : 'Text to 3D', tone: 'green' }, inputTypes: type === 'text-to-3d' ? ['text'] : type === 'multiview-to-3d' ? [] : ['image', 'text'], inputPorts: type === 'multiview-to-3d' ? multiViewPorts : undefined, outputType: 'model', hidden: type !== 'generate-model', executable: true, modelEditor: true, defaults: { ...modelDefaults }, parameters: modelParameters, effects: modelEffects })),
  { type: 'smart-mesh', category: '3D', label: 'Smart Mesh', description: 'Generate a mesh from an image or text prompt', presentation: { kind: '3D MODEL', detail: 'Smart mesh generation', tone: 'green' }, inputTypes: ['image', 'text'], outputType: 'model', executable: true, modelEditor: true, defaults: { topology: 'triangle', faceCount: 5000, preview: '/shark-model.png' }, parameters: [{ key: 'faceCount', label: 'Polycount', control: 'slider', range: { min: 500, max: 20000, step: 500 } }] },
  { type: 'retopology', category: '3D', label: 'Retopology', description: 'Optimize model geometry', presentation: { kind: 'MESH', detail: 'Geometry optimization', tone: 'rose' }, inputTypes: ['model'], outputType: 'model', executable: true, modelEditor: true, defaults: { topology: 'quad', smartPoly: false, faceLimit: 10000, preview: '/shark-retopology.png' }, parameters: [{ key: 'topology', label: 'Topology', control: 'segmented', options: retopologyTopology }, { key: 'smartPoly', label: 'Smart Low Poly v2', control: 'toggle' }, { key: 'faceLimit', label: 'Polygon Count', control: 'slider', range: { min: 500, max: 50000, step: 500 } }] },
  { type: 'bake', category: '3D', label: 'Bake', description: 'Bake detail from one model onto another', presentation: { kind: 'BAKE', detail: 'Bake two models', tone: 'rose' }, inputTypes: [], inputPorts: [{ id: 'model-a', label: 'Model A', type: 'model' }, { id: 'model-b', label: 'Model B', type: 'model' }], outputType: 'model', executable: true, modelEditor: true, defaults: { preview: '/shark-model.png' }, parameters: [] },
  { type: 'texture', category: '3D', label: 'UV Texture', description: 'Create UV textures from a model, image, or text', presentation: { kind: 'MATERIAL', detail: 'UV texture generation', tone: 'violet' }, inputTypes: [], inputPorts: [{ id: 'model', label: 'Model', type: 'model', required: true }, { id: 'image', label: 'Image', type: 'image' }, { id: 'text', label: 'Text', type: 'text' }], outputType: 'model', executable: true, modelEditor: true, defaults: { inputMode: 'imageGenerate', prompt: '', textureQuality: 'extreme', textureStyle: 'None', preview: '/shark-textured.png' }, parameters: [{ key: 'inputMode', label: 'Input', control: 'segmented', options: options([['imageGenerate', 'Image'], ['multiViewGenerate', 'Model'], ['textGenerate', 'Text']]) }, { key: 'prompt', label: 'Prompt', control: 'textarea', visibleWhen: [{ field: 'inputMode', equals: 'textGenerate' }] }, { key: 'textureStyle', label: 'Create Your Own Texture Style', control: 'select', options: options(['None', 'Mecha Pop', 'Heritage', 'Mecha', 'Wood', 'Custom'].map((value) => [value, value])) }, { key: 'textureQuality', label: 'Texture Resolution', control: 'segmented', options: textureQualities }] },
  { type: 'rigging', category: '3D', label: 'Rigging', description: 'Add a skeleton to a model', presentation: { kind: 'RIG', detail: 'Auto rigging', tone: 'violet' }, inputTypes: ['model'], outputType: 'model', executable: true, modelEditor: true, defaults: { modelVersion: 'v2.5-20260210', preview: '/shark-model.png' }, parameters: [{ key: 'modelVersion', label: 'AI Model', control: 'select', options: options([['v2.5-20260210', 'v2.5 · Good for Animals'], ['v1.0-20240301', 'v1.0 · Good for Humanoid']]) }] },
  { type: 'segments', category: '3D', label: 'Segments', description: 'Segment a model into parts', presentation: { kind: 'SEGMENTS', detail: 'Part segmentation', tone: 'cyan' }, inputTypes: ['model'], outputType: 'model', executable: true, modelEditor: true, defaults: { detailLevel: 'low', preview: '/shark-model.png' }, parameters: [{ key: 'detailLevel', label: 'Detail Level', control: 'segmented', options: detailLevels }] },
  { type: 'model-preview', category: '3D', label: 'Model Preview', description: 'Review the 3D result', presentation: { kind: 'REVIEW', detail: 'Interactive preview', tone: 'cyan' }, inputTypes: ['model'], outputType: 'model', executable: true, modelEditor: true, defaults: { materialMode: 'standard', shading: 'smooth', pbrPreview: false, metallic: 0, roughness: 1, wireframe: false, preview: '/shark-review.png' }, parameters: [{ key: 'materialMode', label: 'View Mode', control: 'select', options: options([['matcap', 'Solid View'], ['standard', 'Textured View'], ['normal', 'Normal'], ['unlit', 'Unlit'], ['cartoon', 'Cartoon Style'], ['sketch', 'Sketch Style'], ['hologram', 'Hologram Style']]) }, { key: 'shading', label: 'Shading', control: 'select', options: options([['flat', 'Flat'], ['smooth', 'Smooth']]) }, { key: 'pbrPreview', label: 'PBR', control: 'toggle', visibleWhen: [{ field: 'materialMode', equals: 'standard' }] }, { key: 'metallic', label: 'Metallic', control: 'slider', range: { min: 0, max: 1, step: 0.01 }, visibleWhen: [{ field: 'materialMode', equals: 'standard' }, { field: 'pbrPreview', equals: true }] }, { key: 'roughness', label: 'Roughness', control: 'slider', range: { min: 0, max: 1, step: 0.01 }, visibleWhen: [{ field: 'materialMode', equals: 'standard' }, { field: 'pbrPreview', equals: true }] }, { key: 'wireframe', label: 'Wireframe', control: 'toggle' }] },
  { type: 'export-model', category: 'Output', label: 'Export', description: 'Export an image or 3D model', presentation: { kind: 'EXPORT', detail: 'Export image or 3D model', tone: 'amber' }, inputTypes: ['image', 'model'], outputType: null, executable: true, modelEditor: true, defaults: { fileName: 'shark-gardener', modelFormat: 'gltf', fbxPreset: 'blender', textureSize: 2048, withAnimation: false, packUV: false, animateInPlace: false, exportVertexColors: false, preview: '/shark-model.png' }, parameters: [{ key: 'fileName', label: 'File Name', control: 'text' }, { key: 'modelFormat', label: 'Format', control: 'select', options: options([['usdz', 'USD'], ['fbx', 'FBX'], ['obj', 'OBJ'], ['stl', 'STL'], ['gltf', 'GLB'], ['3mf', '3MF']]) }, { key: 'fbxPreset', label: 'FBX Preset', control: 'select', options: options([['blender', 'Blender'], ['mixamo', 'Mixamo'], ['3dsmax', '3ds Max']]), visibleWhen: [{ field: 'modelFormat', equals: 'fbx' }] }, { key: 'textureSize', label: 'Texture Resolution', control: 'select', options: options([[512, '512'], [1024, '1K'], [2048, '2K'], [4096, '4K'], [8192, '8K']]) }, { key: 'withAnimation', label: 'Export Skeleton', control: 'toggle' }, { key: 'packUV', label: 'Pack UV', control: 'toggle' }, { key: 'animateInPlace', label: 'Animation Stay in Place', control: 'toggle', visibleWhen: [{ field: 'withAnimation', equals: true }] }, { key: 'exportVertexColors', label: 'Export Vertex Colors', control: 'toggle', visibleWhen: [{ field: 'modelFormat', equals: 'obj' }] }] },
]

export const workflowNodeSchemas = Object.fromEntries(workflowNodeSchema.map((node) => [node.type, node])) as Record<string, WorkflowNodeSchema>

export function nodeSchema(type: string) {
  return workflowNodeSchemas[type]
}

export function nodeDefaults(type: string) {
  return structuredClone(nodeSchema(type)?.defaults || {})
}

export function conditionsMatch(conditions: ParameterCondition[] | undefined, config: Record<string, unknown>) {
  return !conditions || conditions.every((condition) => config[condition.field] === condition.equals)
}

export function parameterRange(parameter: NodeParameter, config: Record<string, unknown>) {
  if (!parameter.range) return undefined
  const range = { min: parameter.range.min, max: parameter.range.max, step: parameter.range.step }
  for (const rule of parameter.range.rules || []) {
    if (!conditionsMatch(rule.when, config)) continue
    if (rule.min !== undefined) range.min = rule.min
    if (rule.max !== undefined) range.max = rule.max
  }
  return range
}

export function applyNodeParameter(type: string, config: Record<string, unknown>, key: string, value: unknown) {
  const next = { ...config, [key]: value }
  for (const effect of nodeSchema(type)?.effects || []) {
    if (effect.when.field === key && value === effect.when.equals) Object.assign(next, effect.set)
  }
  return next
}
