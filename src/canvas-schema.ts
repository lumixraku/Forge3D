export type PortType = 'image' | 'text' | 'model' | 'any'
export type ParameterValue = string | number | boolean

/**
 * One port as declared on a node schema. The port id is the key it is declared
 * under, so `inputs`/`outputs` cannot drift from the ids edges reference.
 */
export interface NodePortSpec {
  type: PortType
  /** Defaults to the key, title-cased. */
  label?: string
  required?: boolean
  /** Accepts several inbound edges; the resolved value is a list. */
  multiple?: boolean
  /** Read this config field when nothing is connected, satisfying `required`. */
  fallbackConfig?: string
}

/** Declared ports, keyed by port id. */
export type NodePorts = Record<string, NodePortSpec>

/** A declared port with its key attached, as the graph helpers consume it. */
export interface NodePort extends NodePortSpec {
  id: string
  label: string
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
  advanced?: boolean
  options?: ParameterOption[]
  range?: ParameterRange
  placeholder?: string
  visibleWhen?: ParameterCondition[]
}

export interface NodeEffect {
  when: ParameterCondition
  set: Record<string, ParameterValue>
}

export interface CanvasNodeSchema {
  type: string
  category: string
  label: string
  description: string
  presentation: { kind: string; detail: string; tone: string }
  inputs: NodePorts
  outputs: NodePorts
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
const legacyPreviewPaths = new Set([
  '/shark-reference.png', '/shark-concept-front.png', '/shark-concept-left.png', '/shark-concept-right.png', '/shark-concept-back.png',
  '/shark-model.png', '/shark-retopology.png', '/shark-textured.png', '/shark-review.png',
])
// Both sides of the multi-view pair share these keys, so one visual edge between
// them pairs up per view rather than collapsing onto a single port.
const multiViewImages: NodePorts = { front: { type: 'image' }, back: { type: 'image' }, left: { type: 'image' }, right: { type: 'image' } }
const allRequired = (ports: NodePorts): NodePorts => Object.fromEntries(Object.entries(ports).map(([key, port]) => [key, { ...port, required: true }]))
// A text port doubles as the node's own prompt field when nothing is connected.
const promptText: NodePortSpec = { type: 'text', fallbackConfig: 'prompt' }
// Reconstruction reads however many views it is given, so a single multi-view or
// candidate-list upstream feeds every image it produced into this one port.
const multiImage: NodePortSpec = { type: 'image', multiple: true }
const modelDefaults = { modelVersion: 'v3.1-20260211', geometryQuality: true, aiComplete: false, texture: true, textureQuality: 'extreme', pbr: true, topology: 'triangle', faceCount: 2000000, generateParts: false, texture8k: true, privacy: 'sharing-only' }
const modelParameters: NodeParameter[] = [
  { key: 'modelVersion', label: 'AI Model', control: 'select', options: modelVersions },
  { key: 'geometryQuality', label: 'Ultra Mesh Quality', control: 'toggle', visibleWhen: [{ field: 'modelVersion', equals: 'v3.1-20260211' }] },
  { key: 'aiComplete', label: 'AI Complete', control: 'toggle', advanced: true },
  { key: 'texture', label: 'Texture', control: 'toggle' },
  { key: 'textureQuality', label: 'Texture Quality', control: 'segmented', options: textureQualities, visibleWhen: [{ field: 'texture', equals: true }] },
  { key: 'pbr', label: 'PBR', control: 'toggle', advanced: true, visibleWhen: [{ field: 'texture', equals: true }] },
  { key: 'topology', label: 'Topology', control: 'segmented', advanced: true, options: topology },
  { key: 'faceCount', label: 'Polycount', control: 'slider', advanced: true, range: { min: 500, max: 1000000, step: 500, rules: [{ when: [{ field: 'geometryQuality', equals: true }], max: 2000000 }, { when: [{ field: 'topology', equals: 'quad' }], max: 50000 }, { when: [{ field: 'generateParts', equals: true }], min: 10000 }] } },
  { key: 'generateParts', label: 'Generate in Parts', control: 'toggle', advanced: true },
  { key: 'texture8k', label: '8K Texture', control: 'toggle', advanced: true, visibleWhen: [{ field: 'texture', equals: true }] },
  { key: 'privacy', label: 'Privacy', control: 'select', advanced: true, options: options([['sharing-only', 'Sharing Only'], ['private', 'Private']]) },
]
const modelEffects: NodeEffect[] = [{ when: { field: 'generateParts', equals: true }, set: { topology: 'triangle', texture: false, pbr: false } }]

export const canvasNodeSchema: CanvasNodeSchema[] = [
  { type: 'frame', category: 'Annotate', label: 'Section', description: 'Group related canvas steps', presentation: { kind: 'SECTION', detail: 'Canvas group', tone: 'slate' }, inputs: {}, outputs: {}, defaults: {}, parameters: [] },
  { type: 'reference-image', category: 'Input', label: 'Asset Upload', description: 'Add an image or 3D model input', presentation: { kind: 'INPUT', detail: 'Reference asset', tone: 'cyan' }, inputs: {}, outputs: { image: { type: 'any', label: 'Asset' } }, modelEditor: true, defaults: { reference: '', assetType: 'image' }, parameters: [] },
  { type: 'generated-image', category: 'Output', label: 'Image', description: 'An image created by a canvas step', presentation: { kind: 'OUTPUT', detail: 'Generated view', tone: 'amber' }, inputs: { image: { type: 'image' } }, outputs: { image: { type: 'image' } }, hidden: true, defaults: {}, parameters: [] },
  { type: 'prompt', category: 'Input', label: 'Text Prompt', description: 'Set creative direction', presentation: { kind: 'PROMPT', detail: 'Creative direction', tone: 'violet' }, inputs: {}, outputs: { text: { type: 'text' } }, defaults: { prompt: 'Production-ready stylized 3D asset' }, parameters: [{ key: 'prompt', label: 'Prompt', control: 'textarea' }] },
  { type: 'generate-image', category: '2D', label: 'Gen Image', description: 'Create concept images', presentation: { kind: 'IMAGE', detail: 'Concept generation', tone: 'amber' }, inputs: { image: { type: 'image' }, text: promptText }, outputs: { image: { type: 'image' } }, executable: true, defaults: { modelVersion: 'gemini_2.5_flash_image_preview', amount: 4, scale: '1:1', tPose: false }, parameters: [{ key: 'modelVersion', label: 'Image Model', control: 'select', options: imageModels }, { key: 'amount', label: 'Images', control: 'select', options: imageAmounts }, { key: 'scale', label: 'Aspect Ratio', control: 'select', options: scales }, { key: 'tPose', label: 'T-Pose', control: 'toggle' }] },
  { type: 'image-decomposition', category: '2D', label: 'Image Decomposition', description: 'Break an image into editable visual parts', presentation: { kind: 'DECOMPOSE', detail: 'Image parts', tone: 'cyan' }, inputs: { image: { type: 'image' } }, outputs: { image: { type: 'image' } }, executable: true, defaults: { modelVersion: 'gemini_2.5_flash_image_preview', prompt: '', amount: 4, scale: '1:1', resolution: '1K', templateKey: 'asset_extraction' }, parameters: [{ key: 'modelVersion', label: 'Image Model', control: 'select', options: imageModels }, { key: 'prompt', label: 'Prompt', control: 'textarea', placeholder: 'Optional extraction instructions' }, { key: 'amount', label: 'Outputs', control: 'select', options: imageAmounts }, { key: 'scale', label: 'Aspect Ratio', control: 'select', options: scales }, { key: 'resolution', label: 'Resolution', control: 'select', options: options([['1K', '1K'], ['2K', '2K'], ['4K', '4K']]) }] },
  { type: 'generate-multiview-images', category: '2D', label: 'Generate Multi-view Images', description: 'Create front, back, left, and right views from references', presentation: { kind: 'MULTI-VIEW', detail: 'Four-view generation', tone: 'amber' }, inputs: { image: { type: 'image' }, text: promptText }, outputs: multiViewImages, executable: true, defaults: {}, parameters: [] },
  { type: 'review', category: 'Annotate', label: 'Check', description: 'Pause to check the image before continuing', presentation: { kind: 'CHECK', detail: 'Approval gate', tone: 'rose' }, inputs: { image: { type: 'image' } }, outputs: { image: { type: 'image' } }, executable: true, defaults: { instruction: 'Review the generated image before continuing.', approved: false }, parameters: [] },
  ...['generate-model', 'multiview-to-3d', 'text-to-3d'].map((type): CanvasNodeSchema => ({ type, category: '3D', label: type === 'generate-model' ? 'Gen HD Model' : type === 'multiview-to-3d' ? 'Multi-view to 3D' : 'Text to 3D', description: type === 'generate-model' ? 'Turn an image or text prompt into a model' : type === 'multiview-to-3d' ? 'Turn four labeled image views into a 3D model' : 'Turn a text prompt into a model', presentation: { kind: '3D MODEL', detail: type === 'generate-model' ? 'Image or text to 3D' : type === 'multiview-to-3d' ? 'Four-view reconstruction' : 'Text to 3D', tone: 'green' }, inputs: type === 'text-to-3d' ? { text: promptText } : type === 'multiview-to-3d' ? allRequired(multiViewImages) : { image: multiImage, ...multiViewImages, text: promptText }, outputs: { model: { type: 'model' } }, hidden: type !== 'generate-model', executable: true, modelEditor: true, defaults: { ...modelDefaults }, parameters: modelParameters, effects: modelEffects })),
  { type: 'smart-mesh', category: '3D', label: 'Smart Mesh', description: 'Generate a mesh from an image or text prompt', presentation: { kind: '3D MODEL', detail: 'Smart mesh generation', tone: 'green' }, inputs: { image: multiImage, text: promptText }, outputs: { model: { type: 'model' } }, executable: true, modelEditor: true, defaults: { topology: 'triangle', faceCount: 5000 }, parameters: [{ key: 'faceCount', label: 'Polycount', control: 'slider', range: { min: 500, max: 20000, step: 500 } }] },
  { type: 'retopology', category: '3D', label: 'Retopology', description: 'Optimize model geometry', presentation: { kind: 'MESH', detail: 'Geometry optimization', tone: 'rose' }, inputs: { model: { type: 'model' } }, outputs: { model: { type: 'model' } }, executable: true, modelEditor: true, defaults: { topology: 'quad', smartPoly: false, faceLimit: 10000 }, parameters: [{ key: 'topology', label: 'Topology', control: 'segmented', options: retopologyTopology }, { key: 'smartPoly', label: 'Smart Low Poly v2', control: 'toggle' }, { key: 'faceLimit', label: 'Polygon Count', control: 'slider', range: { min: 500, max: 50000, step: 500 } }] },
  { type: 'texture', category: '3D', label: 'UV Texture', description: 'Create UV textures from a model, image, or text', presentation: { kind: 'MATERIAL', detail: 'UV texture generation', tone: 'violet' }, inputs: { model: { type: 'model', required: true }, image: { type: 'image' }, text: promptText }, outputs: { model: { type: 'model' } }, executable: true, modelEditor: true, defaults: { inputMode: 'imageGenerate', prompt: '', textureQuality: 'extreme', textureStyle: 'None' }, parameters: [{ key: 'inputMode', label: 'Input', control: 'segmented', options: options([['imageGenerate', 'Image'], ['multiViewGenerate', 'Model'], ['textGenerate', 'Text']]) }, { key: 'prompt', label: 'Prompt', control: 'textarea', visibleWhen: [{ field: 'inputMode', equals: 'textGenerate' }] }, { key: 'textureStyle', label: 'Create Your Own Texture Style', control: 'select', options: options(['None', 'Mecha Pop', 'Heritage', 'Mecha', 'Wood', 'Custom'].map((value) => [value, value])) }, { key: 'textureQuality', label: 'Texture Resolution', control: 'segmented', options: textureQualities }] },
  { type: 'rigging', category: '3D', label: 'Rigging', description: 'Add a skeleton to a model', presentation: { kind: 'RIG', detail: 'Auto rigging', tone: 'violet' }, inputs: { model: { type: 'model' } }, outputs: { model: { type: 'model' } }, executable: true, modelEditor: true, defaults: { modelVersion: 'v2.5-20260210' }, parameters: [{ key: 'modelVersion', label: 'AI Model', control: 'select', options: options([['v2.5-20260210', 'v2.5 · Good for Animals'], ['v1.0-20240301', 'v1.0 · Good for Humanoid']]) }] },
  { type: 'segments', category: '3D', label: 'Segments', description: 'Segment a model into parts', presentation: { kind: 'SEGMENTS', detail: 'Part segmentation', tone: 'cyan' }, inputs: { model: { type: 'model' } }, outputs: { model: { type: 'model' } }, executable: true, modelEditor: true, defaults: { detailLevel: 'low' }, parameters: [{ key: 'detailLevel', label: 'Detail Level', control: 'segmented', options: detailLevels }] },
  { type: 'model-preview', category: '3D', label: 'Model Preview', description: 'Review the 3D result', presentation: { kind: 'REVIEW', detail: 'Interactive preview', tone: 'cyan' }, inputs: { model: { type: 'model' } }, outputs: { model: { type: 'model' } }, executable: true, modelEditor: true, defaults: { materialMode: 'standard', shading: 'smooth', pbrPreview: false, metallic: 0, roughness: 1, wireframe: false }, parameters: [{ key: 'materialMode', label: 'View Mode', control: 'select', options: options([['matcap', 'Solid View'], ['standard', 'Textured View'], ['normal', 'Normal'], ['unlit', 'Unlit'], ['cartoon', 'Cartoon Style'], ['sketch', 'Sketch Style'], ['hologram', 'Hologram Style']]) }, { key: 'shading', label: 'Shading', control: 'select', options: options([['flat', 'Flat'], ['smooth', 'Smooth']]) }, { key: 'pbrPreview', label: 'PBR', control: 'toggle', visibleWhen: [{ field: 'materialMode', equals: 'standard' }] }, { key: 'metallic', label: 'Metallic', control: 'slider', range: { min: 0, max: 1, step: 0.01 }, visibleWhen: [{ field: 'materialMode', equals: 'standard' }, { field: 'pbrPreview', equals: true }] }, { key: 'roughness', label: 'Roughness', control: 'slider', range: { min: 0, max: 1, step: 0.01 }, visibleWhen: [{ field: 'materialMode', equals: 'standard' }, { field: 'pbrPreview', equals: true }] }, { key: 'wireframe', label: 'Wireframe', control: 'toggle' }] },
  { type: 'export-model', category: 'Output', label: 'Export', description: 'Export an image or 3D model', presentation: { kind: 'EXPORT', detail: 'Export image or 3D model', tone: 'amber' }, inputs: { image: { type: 'image' }, model: { type: 'model' } }, outputs: {}, executable: true, modelEditor: true, defaults: { fileName: 'shark-gardener', modelFormat: 'gltf', fbxPreset: 'blender', textureSize: 2048, withAnimation: false, packUV: false, animateInPlace: false, exportVertexColors: false }, parameters: [{ key: 'fileName', label: 'File Name', control: 'text' }, { key: 'modelFormat', label: 'Format', control: 'select', options: options([['usdz', 'USD'], ['fbx', 'FBX'], ['obj', 'OBJ'], ['stl', 'STL'], ['gltf', 'GLB'], ['3mf', '3MF']]) }, { key: 'fbxPreset', label: 'FBX Preset', control: 'select', options: options([['blender', 'Blender'], ['mixamo', 'Mixamo'], ['3dsmax', '3ds Max']]), visibleWhen: [{ field: 'modelFormat', equals: 'fbx' }] }, { key: 'textureSize', label: 'Texture Resolution', control: 'select', options: options([[512, '512'], [1024, '1K'], [2048, '2K'], [4096, '4K'], [8192, '8K']]) }, { key: 'withAnimation', label: 'Export Skeleton', control: 'toggle' }, { key: 'packUV', label: 'Pack UV', control: 'toggle' }, { key: 'animateInPlace', label: 'Animation Stay in Place', control: 'toggle', visibleWhen: [{ field: 'withAnimation', equals: true }] }, { key: 'exportVertexColors', label: 'Export Vertex Colors', control: 'toggle', visibleWhen: [{ field: 'modelFormat', equals: 'obj' }] }] },
]

export const canvasNodeSchemas = Object.fromEntries(canvasNodeSchema.map((node) => [node.type, node])) as Record<string, CanvasNodeSchema>

export function nodeSchema(type: string) {
  return canvasNodeSchemas[type]
}

export function nodeDefaults(type: string) {
  return structuredClone(nodeSchema(type)?.defaults || {})
}

/**
 * Whether a run includes this node type. Frames and the input/output-only types
 * carry no work of their own, so they are planned around rather than executed.
 */
export function isExecutableNodeType(type: string) {
  return Boolean(nodeSchema(type)?.executable)
}

/** Whether this node type's result can be opened in the Model Editor. */
export function hasModelEditor(type: string) {
  return Boolean(nodeSchema(type)?.modelEditor)
}

export function normalizeNodeConfig(type: string, config: Record<string, unknown> = {}) {
  const normalized = { ...nodeDefaults(type), ...config }
  const schema = nodeSchema(type)

  // These were formerly saved as node defaults. Results now exist only on a run,
  // so remove the old bundled placeholders when a canvas is loaded.
  if (typeof normalized.preview === 'string' && legacyPreviewPaths.has(normalized.preview)) delete normalized.preview
  if (Array.isArray(normalized.previews) && normalized.previews.every((preview) => typeof preview === 'string' && legacyPreviewPaths.has(preview))) delete normalized.previews
  if (normalized.viewPreviews && typeof normalized.viewPreviews === 'object' && Object.values(normalized.viewPreviews).every((preview) => typeof preview === 'string' && legacyPreviewPaths.has(preview))) delete normalized.viewPreviews

  for (const parameter of schema?.parameters || []) {
    if (parameter.control !== 'select' || !parameter.options?.length) continue
    if (!parameter.options.some((option) => option.value === normalized[parameter.key])) normalized[parameter.key] = schema.defaults[parameter.key] ?? parameter.options[0].value
  }

  if (type === 'generate-image' && Array.isArray(normalized.previews) && !normalized.previews.includes(normalized.selectedPreview)) normalized.selectedPreview = normalized.previews[0] || null
  if (['generate-model', 'multiview-to-3d', 'text-to-3d'].includes(type)) {
    if (config.quality && !config.modelVersion) normalized.modelVersion = config.quality === 'standard' ? 'v3.0-20250812' : config.quality
    if (config.modelVersion === 'Smart Mesh') normalized.modelVersion = modelDefaults.modelVersion
    if (typeof config.geometryQuality === 'string') normalized.geometryQuality = config.geometryQuality === 'detailed'
    if (config.faceType && !config.topology) normalized.topology = String(config.faceType).toLowerCase() === 'quad' ? 'quad' : 'triangle'
  }
  if (type === 'retopology') {
    if (config.targetFaces && !config.faceLimit) normalized.faceLimit = config.targetFaces
    if (config.faceType && !config.topology) normalized.topology = String(config.faceType).toLowerCase() === 'quad' ? 'quad' : 'triangle'
  }
  if (type === 'texture') {
    if (!config.textureQuality && typeof config.resolution === 'string') normalized.textureQuality = { '2K': 'standard', '4K': 'detailed', '8K': 'extreme' }[config.resolution.toUpperCase()] || 'standard'
    delete normalized.model
    delete normalized.resolution
    delete normalized.style
  }
  if (type === 'model-preview') delete normalized.background
  if (type === 'export-model') {
    if (config.format && !config.modelFormat) normalized.modelFormat = String(config.format).toLowerCase() === 'glb' ? 'gltf' : String(config.format).toLowerCase()
    if (String(config.modelFormat).toLowerCase() === 'glb') normalized.modelFormat = 'gltf'
  }
  return normalized
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
