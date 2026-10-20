export type PortType = 'image' | 'text' | 'model' | 'any'
export type ParameterValue = string | number | boolean
export type CanvasProvider = 'mock' | 'tripo' | 'meshy'

/** Canvas-level default. Node schemas stay on the Tripo shape until a caller passes `meshy`. */
export const defaultCanvasProvider: CanvasProvider = 'meshy'

/**
 * What part a node plays in the canvas. Every node is exactly one of these:
 * input carries what the user gave, execution runs and is configured, result
 * presents what a run produced. A frame is a container and plays no role in the
 * data flow.
 */
export type NodeRole = 'input' | 'execution' | 'result' | 'container'

/**
 * One port as declared on a node schema. The port id is the key it is declared
 * under, so `inputs`/`outputs` cannot drift from the ids edges reference.
 */
export interface NodePortSpec {
  type: PortType
  /** Defaults to the key, title-cased. */
  label?: string
  /** Accepts several inbound edges; the resolved value is a list. */
  multiple?: boolean
  /** Read this config field when nothing is connected. */
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
  /** Controls that exist only while this option is selected. ComfyUI DynamicCombo stores the same relationship on the option. */
  inputs?: NodeParameter[]
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
}

export interface NodeEffect {
  when: ParameterCondition
  set: Record<string, ParameterValue>
}

/**
 * Parameter keys this node cannot run without, as the execution API sees them.
 * A plain key must have a value; a nested array is a set of alternatives, of
 * which one suffices.
 *
 * This is about the parameter set, not the wiring: a key that an input port
 * carries is satisfied by that connection, and a key with no port at all is
 * satisfied by the node's own config. Ports declare how data flows; this
 * declares what the run needs.
 */
export type NodeRequirement = string | string[]

export interface CanvasNodeSchema {
  type: string
  category: string
  label: string
  description: string
  /** The forced part this node plays: input, execution, result, or container. */
  role: NodeRole
  presentation: { kind: string; detail: string; tone: string }
  inputs: NodePorts
  outputs: NodePorts
  /** Parameters that must have a value before this node can be run. */
  requires?: NodeRequirement[]
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
const viewKeys = Object.keys(multiViewImages)
// A text port doubles as the node's own prompt field when nothing is connected.
const promptText: NodePortSpec = { type: 'text', fallbackConfig: 'prompt' }
// Reconstruction reads however many views it is given, so a single multi-view or
// candidate-list upstream feeds every image it produced into this one port.
const multiImage: NodePortSpec = { type: 'image', multiple: true }
const modelDefaults = { modelVersion: 'v3.1-20260211', geometryQuality: true, aiComplete: false, texture: true, textureQuality: 'extreme', pbr: true, topology: 'triangle', faceCount: 2000000, generateParts: false, texture8k: true, privacy: 'sharing-only' }
const modelParameters: NodeParameter[] = [
  { key: 'modelVersion', label: 'AI Model', control: 'select', options: modelVersions.map((option) => option.value === 'v3.1-20260211' ? { ...option, inputs: [{ key: 'geometryQuality', label: 'Ultra Mesh Quality', control: 'toggle' }] } : option) },
  { key: 'aiComplete', label: 'AI Complete', control: 'toggle', advanced: true },
  { key: 'texture', label: 'Texture', control: 'toggle', options: [{ value: true, label: 'On', inputs: [
    { key: 'textureQuality', label: 'Texture Quality', control: 'segmented', options: textureQualities },
    { key: 'pbr', label: 'PBR', control: 'toggle', advanced: true },
    { key: 'texture8k', label: '8K Texture', control: 'toggle', advanced: true },
  ] }] },
  { key: 'topology', label: 'Topology', control: 'segmented', advanced: true, options: topology },
  { key: 'faceCount', label: 'Polycount', control: 'slider', advanced: true, range: { min: 500, max: 1000000, step: 500, rules: [{ when: [{ field: 'geometryQuality', equals: true }], max: 2000000 }, { when: [{ field: 'topology', equals: 'quad' }], max: 50000 }, { when: [{ field: 'generateParts', equals: true }], min: 10000 }] } },
  { key: 'generateParts', label: 'Generate in Parts', control: 'toggle', advanced: true },
  { key: 'privacy', label: 'Privacy', control: 'select', advanced: true, options: options([['sharing-only', 'Sharing Only'], ['private', 'Private']]) },
]
const modelEffects: NodeEffect[] = [{ when: { field: 'generateParts', equals: true }, set: { topology: 'triangle', texture: false, pbr: false } }]
const meshyPolycount = (max: number): NodeParameter => ({ key: 'faceCount', label: 'Target Polycount', control: 'slider', range: { min: 100, max, step: 100 } })
const meshyGeometryResolution: NodeParameter = { key: 'geometryResolution', label: 'Geometry Resolution', control: 'segmented', options: options([['standard', 'Standard'], ['2k', '2K'], ['4k', '4K']]) }
const meshyModelDefaults = { modelType: 'standard', aiModel: 'latest', geometryResolution: 'standard', texture: true, textureQuality: 'standard', pbr: true, topology: 'triangle', faceCount: 0, shouldRemesh: false, poseMode: '' }
const meshyModelParameters: NodeParameter[] = [
  { key: 'modelType', label: 'Mesh Type', control: 'select', options: [
    { value: 'standard', label: 'Standard', inputs: [
      { key: 'aiModel', label: 'Meshy Model', control: 'select', options: [
        { value: 'latest', label: 'Latest', inputs: [meshyGeometryResolution] },
        { value: 'meshy-7.1', label: 'Meshy 7.1', inputs: [meshyGeometryResolution] },
        { value: 'meshy-7', label: 'Meshy 7' },
        { value: 'meshy-6', label: 'Meshy 6' },
        { value: 'meshy-6-lite', label: 'Meshy 6 Lite' },
      ] },
      { key: 'shouldRemesh', label: 'Remesh', control: 'toggle', options: [{ value: true, label: 'On', inputs: [
        { key: 'topology', label: 'Topology', control: 'segmented', options: topology },
        meshyPolycount(300000),
      ] }] },
    ] },
    { value: 'smart-topology', label: 'Smart Topology', inputs: [
      { key: 'aiModel', label: 'Meshy Model', control: 'select', options: [
        { value: 'meshy-t2.5', label: 'Meshy T2.5', inputs: [meshyPolycount(30000)] },
        { value: 'meshy-t2', label: 'Meshy T2', inputs: [meshyPolycount(15000)] },
      ] },
    ] },
  ] },
  { key: 'texture', label: 'Texture', control: 'toggle', options: [{ value: true, label: 'On', inputs: [
    { key: 'textureQuality', label: 'Texture Resolution', control: 'segmented', options: options([['standard', '2K'], ['detailed', '4K'], ['extreme', '8K']]) },
    { key: 'pbr', label: 'PBR', control: 'toggle', advanced: true },
  ] }] },
  { key: 'poseMode', label: 'Pose', control: 'select', options: options([['', 'None'], ['a-pose', 'A-Pose'], ['t-pose', 'T-Pose']]) },
]
const meshyRigParameters: NodeParameter[] = [
  { key: 'heightMeters', label: 'Height (m)', control: 'slider', range: { min: 0.5, max: 2.5, step: 0.1 } },
]
const imageAiModels = options([
  ['nano-banana', 'Nano Banana'], ['nano-banana-2', 'Nano Banana 2'], ['nano-banana-2-lite', 'Nano Banana 2 Lite'],
  ['nano-banana-pro', 'Nano Banana Pro'], ['gpt-image-2', 'GPT Image 2'],
  ['gpt-image-2-5-flare', 'GPT Image 2.5 Flare'], ['gpt-image-2-5-sunburst', 'GPT Image 2.5 Sunburst'],
])
const imageAspects = options([['1:1', '1:1'], ['16:9', '16:9'], ['9:16', '9:16'], ['4:3', '4:3'], ['3:4', '3:4'], ['3:2', '3:2'], ['2:3', '2:3']])
const imageStepParameters: NodeParameter[] = [
  { key: 'aiModel', label: 'Image Model', control: 'select', options: imageAiModels },
  { key: 'generateMultiView', label: 'Multi-view', control: 'toggle', options: [{ value: false, label: 'Off', inputs: [{ key: 'aspectRatio', label: 'Aspect Ratio', control: 'select', options: imageAspects }] }] },
  { key: 'poseMode', label: 'Pose', control: 'select', options: options([['', 'None'], ['a-pose', 'A-Pose'], ['t-pose', 'T-Pose']]) },
  { key: 'removeBackground', label: 'Remove Background', control: 'toggle' },
]
const imageStepDefaults = { aiModel: 'nano-banana', generateMultiView: false, aspectRatio: '1:1', poseMode: '', removeBackground: false, prompt: '' }
const printerBrands = options([['bambu', 'Bambu'], ['anycubic', 'Anycubic'], ['creality', 'Creality'], ['elegoo', 'Elegoo'], ['flashforge', 'Flashforge'], ['prusa', 'Prusa'], ['qidi', 'Qidi'], ['snapmaker', 'Snapmaker'], ['ankermake', 'Ankermake']])
const meshyApiNodes: Array<Omit<CanvasNodeSchema, 'role'>> = [
  { type: 'text-to-image', category: '2D', label: 'Text to Image', description: 'Meshy text-to-image. Multi-view returns three angles.', presentation: { kind: 'IMAGE', detail: 'Text to image', tone: 'amber' }, inputs: { text: promptText }, outputs: { image: { type: 'image' }, front: { type: 'image' }, side: { type: 'image' }, back: { type: 'image' } }, requires: ['text'], executable: true, defaults: { ...imageStepDefaults }, parameters: imageStepParameters },
  { type: 'image-to-image', category: '2D', label: 'Image to Image', description: 'Edit a reference image with a Meshy prompt', presentation: { kind: 'IMAGE', detail: 'Image edit', tone: 'amber' }, inputs: { image: multiImage, text: promptText }, outputs: { image: { type: 'image' }, front: { type: 'image' }, side: { type: 'image' }, back: { type: 'image' } }, requires: ['image', 'text'], executable: true, defaults: { ...imageStepDefaults, prompt: 'Keep the subject and change the style' }, parameters: [...imageStepParameters, { key: 'prompt', label: 'Prompt', control: 'textarea' }] },
  { type: 'remesh', category: '3D', label: 'Remesh', description: 'Retopologize a model with Meshy', presentation: { kind: 'MESH', detail: 'Remesh', tone: 'rose' }, inputs: { model: { type: 'model' } }, outputs: { model: { type: 'model' } }, requires: ['model'], executable: true, modelEditor: true, defaults: { topology: 'triangle', faceCount: 30000 }, parameters: [{ key: 'topology', label: 'Topology', control: 'segmented', options: topology }, { key: 'faceCount', label: 'Target Polycount', control: 'slider', range: { min: 100, max: 300000, step: 100 } }] },
  { type: 'retexture', category: '3D', label: 'Retexture', description: 'Paint a new texture from text or a style image', presentation: { kind: 'MATERIAL', detail: 'Retexture', tone: 'violet' }, inputs: { model: { type: 'model' }, image: { type: 'image' }, text: promptText }, outputs: { model: { type: 'model' } }, requires: ['model'], executable: true, modelEditor: true, defaults: { styleMode: 'text', prompt: '', aiModel: 'latest', textureQuality: 'standard', pbr: true, enableOriginalUv: false }, parameters: [{ key: 'styleMode', label: 'Style', control: 'segmented', options: [{ value: 'text', label: 'Text', inputs: [{ key: 'prompt', label: 'Style Prompt', control: 'textarea' }] }, { value: 'image', label: 'Image' }] }, { key: 'aiModel', label: 'Meshy Model', control: 'select', options: options([['latest', 'Latest'], ['meshy-6', 'Meshy 6'], ['meshy-7', 'Meshy 7'], ['meshy-6-lite', 'Meshy 6 Lite']]) }, { key: 'textureQuality', label: 'Texture Resolution', control: 'segmented', options: options([['standard', '2K'], ['detailed', '4K'], ['extreme', '8K']]) }, { key: 'pbr', label: 'PBR', control: 'toggle' }, { key: 'enableOriginalUv', label: 'Keep Original UVs', control: 'toggle' }] },
  { type: 'animation', category: '3D', label: 'Animation', description: 'Apply a library animation or a text-to-motion clip to a rig', presentation: { kind: 'RIG', detail: 'Animation', tone: 'violet' }, inputs: { model: { type: 'model', label: 'Rig' }, motion: { type: 'model', label: 'Motion' } }, outputs: { model: { type: 'model' } }, requires: ['model'], executable: true, modelEditor: true, defaults: { actionId: 0, postProcess: '', fps: 30 }, parameters: [{ key: 'actionId', label: 'Animation', control: 'select', options: options([[0, 'Idle'], [-2, 'Walking'], [-1, 'Running'], [4, 'Attack'], [25, 'Agree']]) }, { key: 'postProcess', label: 'Post Process', control: 'select', options: [{ value: '', label: 'None' }, { value: 'change_fps', label: 'Change FPS', inputs: [{ key: 'fps', label: 'FPS', control: 'select', options: options([[24, '24'], [25, '25'], [30, '30'], [60, '60']]) }] }, { value: 'fbx2usdz', label: 'FBX to USDZ' }, { value: 'extract_armature', label: 'Extract Armature' }] }] },
  { type: 'text-to-motion', category: '3D', label: 'Text to Motion', description: 'Generate a motion clip from a description', presentation: { kind: 'RIG', detail: 'Text to motion', tone: 'violet' }, inputs: { text: promptText }, outputs: { model: { type: 'model', label: 'Motion' } }, requires: ['text'], executable: true, defaults: { prompt: '', mode: 'prime', duration: 3 }, parameters: [{ key: 'prompt', label: 'Prompt', control: 'textarea' }, { key: 'mode', label: 'Mode', control: 'segmented', options: options([['prime', 'Prime'], ['swift', 'Swift']]) }, { key: 'duration', label: 'Duration (s)', control: 'slider', range: { min: 2, max: 10, step: 0.5 } }] },
  { type: 'convert-model', category: 'Output', label: 'Convert', description: 'Convert a model to another format', presentation: { kind: 'EXPORT', detail: 'Format conversion', tone: 'amber' }, inputs: { model: { type: 'model' } }, outputs: { model: { type: 'model' } }, requires: ['model'], executable: true, modelEditor: true, defaults: { targetFormat: 'fbx' }, parameters: [{ key: 'targetFormat', label: 'Format', control: 'select', options: options([['glb', 'GLB'], ['fbx', 'FBX'], ['obj', 'OBJ'], ['usdz', 'USDZ'], ['blend', 'BLEND'], ['stl', 'STL'], ['3mf', '3MF']]) }] },
  { type: 'resize-model', category: '3D', label: 'Resize', description: 'Scale a model to a real-world size', presentation: { kind: 'MESH', detail: 'Resize', tone: 'cyan' }, inputs: { model: { type: 'model' } }, outputs: { model: { type: 'model' } }, requires: ['model'], executable: true, modelEditor: true, defaults: { resizeMode: 'height', resizeHeight: 1, resizeLength: 1, originAt: 'bottom' }, parameters: [{ key: 'resizeMode', label: 'Mode', control: 'select', options: [{ value: 'height', label: 'Height', inputs: [{ key: 'resizeHeight', label: 'Height (m)', control: 'slider', range: { min: 0.1, max: 5, step: 0.1 } }] }, { value: 'longest', label: 'Longest Side', inputs: [{ key: 'resizeLength', label: 'Length (m)', control: 'slider', range: { min: 0.1, max: 5, step: 0.1 } }] }, { value: 'auto', label: 'Auto Size', inputs: [{ key: 'originAt', label: 'Origin', control: 'select', options: options([['bottom', 'Bottom'], ['center', 'Center']]) }] }] }] },
  { type: 'uv-unwrap', category: '3D', label: 'UV Unwrap', description: 'Build a clean UV layout for a GLB', presentation: { kind: 'MATERIAL', detail: 'UV unwrap', tone: 'violet' }, inputs: { model: { type: 'model' } }, outputs: { model: { type: 'model' } }, requires: ['model'], executable: true, modelEditor: true, defaults: {}, parameters: [] },
  { type: 'print-analyze', category: 'Print', label: 'Print Check', description: 'Check a model for FDM printability', presentation: { kind: 'CHECK', detail: 'Print analysis', tone: 'cyan' }, inputs: { model: { type: 'model' } }, outputs: { model: { type: 'model' } }, requires: ['model'], executable: true, defaults: {}, parameters: [] },
  { type: 'print-repair', category: 'Print', label: 'Print Repair', description: 'Repair a mesh for FDM printing', presentation: { kind: 'MESH', detail: 'Print repair', tone: 'rose' }, inputs: { model: { type: 'model' } }, outputs: { model: { type: 'model' } }, requires: ['model'], executable: true, modelEditor: true, defaults: {}, parameters: [] },
  { type: 'multi-color-print', category: 'Print', label: 'Multi-color Print', description: 'Export a multi-color 3MF for a slicer', presentation: { kind: 'EXPORT', detail: 'Multi-color 3MF', tone: 'amber' }, inputs: { model: { type: 'model' } }, outputs: { model: { type: 'model' } }, requires: ['model'], executable: true, modelEditor: true, defaults: { printerBrand: 'bambu' }, parameters: [{ key: 'printerBrand', label: 'Printer', control: 'select', options: printerBrands }] },
  { type: 'auto-split', category: 'Print', label: 'Auto Split', description: 'Split a Meshy 6 or 7 model into printable parts', presentation: { kind: 'SEGMENTS', detail: 'Auto split', tone: 'cyan' }, inputs: { model: { type: 'model' }, text: promptText }, outputs: { model: { type: 'model' } }, requires: ['model'], executable: true, modelEditor: true, defaults: { splitMode: 'auto', prompt: '', layout: 'assembled', connectors: false, connectorType: 'cube' }, parameters: [{ key: 'splitMode', label: 'Split', control: 'select', options: [{ value: 'auto', label: 'Auto' }, { value: 'by_parts', label: 'By Parts', inputs: [{ key: 'prompt', label: 'Parts', control: 'textarea' }] }, { value: 'by_color', label: 'By Color', inputs: [{ key: 'prompt', label: 'Colors', control: 'textarea' }] }] }, { key: 'layout', label: 'Layout', control: 'segmented', options: options([['assembled', 'Assembled'], ['on_plate', 'On Plate']]) }, { key: 'connectors', label: 'Connectors', control: 'toggle', options: [{ value: true, label: 'On', inputs: [{ key: 'connectorType', label: 'Connector', control: 'segmented', options: options([['cube', 'Cube'], ['cylinder', 'Cylinder']]) }] }] }] },
  { type: 'creative-lab', category: '3D', label: 'Creative Lab', description: 'Turn a photo into a printable product', presentation: { kind: '3D MODEL', detail: 'Creative Lab', tone: 'green' }, inputs: { image: { type: 'image' } }, outputs: { model: { type: 'model' } }, requires: ['image'], executable: true, modelEditor: true, defaults: { product: 'keychain', nameText: '' }, parameters: [{ key: 'product', label: 'Product', control: 'select', options: [{ value: 'keychain', label: 'Keychain', inputs: [{ key: 'nameText', label: 'Engraving', control: 'text', placeholder: 'Up to 10 characters' }] }, { value: 'fridge-magnet', label: 'Fridge Magnet' }, { value: 'figure', label: 'Figure' }, { value: 'vinyl-figure', label: 'Vinyl Figure' }, { value: 'brick-figure', label: 'Brick Figure' }, { value: 'lamp', label: 'Lamp' }, { value: 'keycap', label: 'Keycap' }, { value: 'fidget-pixel', label: 'Fidget Pixel' }, { value: 'fidget-collapsible', label: 'Collapsible Fidget' }] }] },
]

const canvasNodeDefinitions: Array<Omit<CanvasNodeSchema, 'role'>> = [
  { type: 'frame', category: 'Annotate', label: 'Section', description: 'Group related canvas steps', presentation: { kind: 'SECTION', detail: 'Canvas group', tone: 'slate' }, inputs: {}, outputs: {}, defaults: {}, parameters: [] },
  // No upload defaults: what the user uploaded lives in `uploadAssets`, not in
  // config (see UPLOAD_KEYS). An empty default would only migrate back into it.
  { type: 'reference-image', category: 'Input', label: 'Asset Upload', description: 'Add an image or 3D model input', presentation: { kind: 'INPUT', detail: 'Reference asset', tone: 'cyan' }, inputs: {}, outputs: { image: { type: 'image', label: 'Image' }, model: { type: 'model', label: 'Model' } }, modelEditor: true, defaults: {}, parameters: [] },
  // Result nodes present what a run produced. They are hidden from Add node:
  // a run creates them, and they carry the artifact in generatedAssets.
  { type: 'generated-image', category: 'Output', label: 'Asset Preview', description: 'Preview an image created by a canvas step', presentation: { kind: 'OUTPUT', detail: 'Generated asset', tone: 'amber' }, inputs: { image: { type: 'image' } }, outputs: { image: { type: 'image' } }, hidden: true, defaults: {}, parameters: [] },
  { type: 'generated-model', category: 'Output', label: 'Asset Preview', description: 'Preview a 3D model created by a canvas step', presentation: { kind: 'OUTPUT', detail: 'Generated asset', tone: 'green' }, inputs: { model: { type: 'model' } }, outputs: { model: { type: 'model' } }, hidden: true, modelEditor: true, defaults: {}, parameters: [] },
  { type: 'generated-export', category: 'Output', label: 'Asset Preview', description: 'Preview an exported asset from a canvas step', presentation: { kind: 'OUTPUT', detail: 'Generated asset', tone: 'amber' }, inputs: {}, outputs: {}, hidden: true, defaults: {}, parameters: [] },
  { type: 'prompt', category: 'Input', label: 'Text Prompt', description: 'Set creative direction', presentation: { kind: 'PROMPT', detail: 'Creative direction', tone: 'violet' }, inputs: {}, outputs: { text: { type: 'text' } }, defaults: { prompt: 'Production-ready stylized 3D asset' }, parameters: [{ key: 'prompt', label: 'Prompt', control: 'textarea' }] },
  { type: 'generate-image', category: '2D', label: 'Gen Image', description: 'Create concept images', presentation: { kind: 'IMAGE', detail: 'Concept generation', tone: 'amber' }, inputs: { image: { type: 'image' }, text: promptText }, outputs: { image: { type: 'image' } }, requires: [['image', 'text']], executable: true, defaults: { modelVersion: 'gemini_2.5_flash_image_preview', amount: 4, scale: '1:1', tPose: false }, parameters: [{ key: 'modelVersion', label: 'Image Model', control: 'select', options: imageModels }, { key: 'amount', label: 'Images', control: 'select', options: imageAmounts }, { key: 'scale', label: 'Aspect Ratio', control: 'select', options: scales }, { key: 'tPose', label: 'T-Pose', control: 'toggle' }] },
  { type: 'image-decomposition', category: '2D', label: 'Image Decomposition', description: 'Break an image into editable visual parts', presentation: { kind: 'DECOMPOSE', detail: 'Image parts', tone: 'cyan' }, inputs: { image: { type: 'image' } }, outputs: { image: { type: 'image' } }, requires: ['image'], executable: true, defaults: { modelVersion: 'gemini_2.5_flash_image_preview', prompt: '', amount: 4, scale: '1:1', resolution: '1K', templateKey: 'asset_extraction' }, parameters: [{ key: 'modelVersion', label: 'Image Model', control: 'select', options: imageModels }, { key: 'prompt', label: 'Prompt', control: 'textarea', placeholder: 'Optional extraction instructions' }, { key: 'amount', label: 'Outputs', control: 'select', options: imageAmounts }, { key: 'scale', label: 'Aspect Ratio', control: 'select', options: scales }, { key: 'resolution', label: 'Resolution', control: 'select', options: options([['1K', '1K'], ['2K', '2K'], ['4K', '4K']]) }] },
  { type: 'generate-multiview-images', category: '2D', label: 'Generate Multi-view Images', description: 'Create front, back, left, and right views from references', presentation: { kind: 'MULTI-VIEW', detail: 'Four-view generation', tone: 'amber' }, inputs: { image: { type: 'image' }, text: promptText }, outputs: multiViewImages, requires: [['image', 'text']], executable: true, defaults: {}, parameters: [] },
  // `approved` is not a default: it records that this run was let through by
  // hand, which makes it a result and puts it in generatedAssets (see OUTPUT_KEYS).
  { type: 'review', category: 'Annotate', label: 'Check', description: 'Pause to check the image before continuing', presentation: { kind: 'CHECK', detail: 'Approval gate', tone: 'rose' }, inputs: { image: { type: 'image' } }, outputs: { image: { type: 'image' } }, requires: ['image'], executable: true, defaults: { instruction: 'Review the generated image before continuing.' }, parameters: [] },
  ...['generate-model', 'multiview-to-3d', 'text-to-3d'].map((type): Omit<CanvasNodeSchema, 'role'> => ({ type, category: '3D', label: type === 'generate-model' ? 'Gen HD Model' : type === 'multiview-to-3d' ? 'Multi-view to 3D' : 'Text to 3D', description: type === 'generate-model' ? 'Turn an image or text prompt into a model' : type === 'multiview-to-3d' ? 'Turn four labeled image views into a 3D model' : 'Turn a text prompt into a model', presentation: { kind: '3D MODEL', detail: type === 'generate-model' ? 'Image or text to 3D' : type === 'multiview-to-3d' ? 'Four-view reconstruction' : 'Text to 3D', tone: 'green' }, inputs: type === 'text-to-3d' ? { text: promptText } : type === 'multiview-to-3d' ? multiViewImages : { image: multiImage, ...multiViewImages, text: promptText }, outputs: { model: { type: 'model' } }, requires: type === 'text-to-3d' ? ['text'] : type === 'multiview-to-3d' ? viewKeys : [['image', ...viewKeys, 'text']], executable: true, modelEditor: true, defaults: { ...modelDefaults }, parameters: modelParameters, effects: modelEffects })),
  { type: 'smart-mesh', category: '3D', label: 'Smart Mesh', description: 'Generate a mesh from an image or text prompt', presentation: { kind: '3D MODEL', detail: 'Smart mesh generation', tone: 'green' }, inputs: { image: multiImage, text: promptText }, outputs: { model: { type: 'model' } }, requires: [['image', 'text']], executable: true, modelEditor: true, defaults: { topology: 'triangle', faceCount: 5000 }, parameters: [{ key: 'faceCount', label: 'Polycount', control: 'slider', range: { min: 500, max: 20000, step: 500 } }] },
  { type: 'retopology', category: '3D', label: 'Retopology', description: 'Optimize model geometry', presentation: { kind: 'MESH', detail: 'Geometry optimization', tone: 'rose' }, inputs: { model: { type: 'model' } }, outputs: { model: { type: 'model' } }, requires: ['model'], executable: true, modelEditor: true, defaults: { topology: 'quad', smartPoly: false, faceLimit: 10000 }, parameters: [{ key: 'topology', label: 'Topology', control: 'segmented', options: retopologyTopology }, { key: 'smartPoly', label: 'Smart Low Poly v2', control: 'toggle' }, { key: 'faceLimit', label: 'Polygon Count', control: 'slider', range: { min: 500, max: 50000, step: 500 } }] },
  { type: 'texture', category: '3D', label: 'UV Texture', description: 'Create UV textures from a model, image, or text', presentation: { kind: 'MATERIAL', detail: 'UV texture generation', tone: 'violet' }, inputs: { model: { type: 'model' }, image: { type: 'image' }, text: promptText }, outputs: { model: { type: 'model' } }, requires: ['model'], executable: true, modelEditor: true, defaults: { inputMode: 'imageGenerate', prompt: '', textureQuality: 'extreme', textureStyle: 'None' }, parameters: [{ key: 'inputMode', label: 'Input', control: 'segmented', options: [{ value: 'imageGenerate', label: 'Image' }, { value: 'multiViewGenerate', label: 'Model' }, { value: 'textGenerate', label: 'Text', inputs: [{ key: 'prompt', label: 'Prompt', control: 'textarea' }] }] }, { key: 'textureStyle', label: 'Create Your Own Texture Style', control: 'select', options: options(['None', 'Mecha Pop', 'Heritage', 'Mecha', 'Wood', 'Custom'].map((value) => [value, value])) }, { key: 'textureQuality', label: 'Texture Resolution', control: 'segmented', options: textureQualities }] },
  { type: 'rigging', category: '3D', label: 'Rigging', description: 'Add a skeleton to a model', presentation: { kind: 'RIG', detail: 'Auto rigging', tone: 'violet' }, inputs: { model: { type: 'model' } }, outputs: { model: { type: 'model' } }, requires: ['model'], executable: true, modelEditor: true, defaults: { modelVersion: 'v2.5-20260210' }, parameters: [{ key: 'modelVersion', label: 'AI Model', control: 'select', options: options([['v2.5-20260210', 'v2.5 · Good for Animals'], ['v1.0-20240301', 'v1.0 · Good for Humanoid']]) }] },
  { type: 'segments', category: '3D', label: 'Segments', description: 'Segment a model into parts', presentation: { kind: 'SEGMENTS', detail: 'Part segmentation', tone: 'cyan' }, inputs: { model: { type: 'model' } }, outputs: { model: { type: 'model' } }, requires: ['model'], executable: true, modelEditor: true, defaults: { detailLevel: 'low' }, parameters: [{ key: 'detailLevel', label: 'Detail Level', control: 'segmented', options: detailLevels }] },
  { type: 'model-preview', category: '3D', label: 'Asset Preview', description: 'Review a 3D asset', presentation: { kind: 'REVIEW', detail: 'Interactive preview', tone: 'cyan' }, inputs: { model: { type: 'model' } }, outputs: { model: { type: 'model' } }, requires: ['model'], executable: true, modelEditor: true, defaults: { materialMode: 'standard', shading: 'smooth', pbrPreview: false, metallic: 0, roughness: 1, wireframe: false }, parameters: [{ key: 'materialMode', label: 'View Mode', control: 'select', options: [{ value: 'matcap', label: 'Solid View' }, { value: 'standard', label: 'Textured View', inputs: [{ key: 'pbrPreview', label: 'PBR', control: 'toggle', options: [{ value: true, label: 'On', inputs: [{ key: 'metallic', label: 'Metallic', control: 'slider', range: { min: 0, max: 1, step: 0.01 } }, { key: 'roughness', label: 'Roughness', control: 'slider', range: { min: 0, max: 1, step: 0.01 } }] }] }] }, { value: 'normal', label: 'Normal' }, { value: 'unlit', label: 'Unlit' }, { value: 'cartoon', label: 'Cartoon Style' }, { value: 'sketch', label: 'Sketch Style' }, { value: 'hologram', label: 'Hologram Style' }] }, { key: 'shading', label: 'Shading', control: 'select', options: options([['flat', 'Flat'], ['smooth', 'Smooth']]) }, { key: 'wireframe', label: 'Wireframe', control: 'toggle' }] },
  { type: 'export-model', category: 'Output', label: 'Export', description: 'Export an image or 3D model', presentation: { kind: 'EXPORT', detail: 'Export image or 3D model', tone: 'amber' }, inputs: { image: { type: 'image' }, model: { type: 'model' } }, outputs: {}, requires: [['image', 'model']], executable: true, modelEditor: true, defaults: { fileName: 'shark-gardener', modelFormat: 'gltf', fbxPreset: 'blender', textureSize: 2048, withAnimation: false, packUV: false, animateInPlace: false, exportVertexColors: false }, parameters: [{ key: 'fileName', label: 'File Name', control: 'text' }, { key: 'modelFormat', label: 'Format', control: 'select', options: [{ value: 'usdz', label: 'USD' }, { value: 'fbx', label: 'FBX', inputs: [{ key: 'fbxPreset', label: 'FBX Preset', control: 'select', options: options([['blender', 'Blender'], ['mixamo', 'Mixamo'], ['3dsmax', '3ds Max']]) }] }, { value: 'obj', label: 'OBJ', inputs: [{ key: 'exportVertexColors', label: 'Export Vertex Colors', control: 'toggle' }] }, { value: 'stl', label: 'STL' }, { value: 'gltf', label: 'GLB' }, { value: '3mf', label: '3MF' }] }, { key: 'textureSize', label: 'Texture Resolution', control: 'select', options: options([[512, '512'], [1024, '1K'], [2048, '2K'], [4096, '4K'], [8192, '8K']]) }, { key: 'withAnimation', label: 'Export Skeleton', control: 'toggle', options: [{ value: true, label: 'On', inputs: [{ key: 'animateInPlace', label: 'Animation Stay in Place', control: 'toggle' }] }] }, { key: 'packUV', label: 'Pack UV', control: 'toggle' }] },
  ...meshyApiNodes,
]

// Result nodes are created by runs, never picked from Add node. Input nodes are
// the two that carry only user-given data. Everything else runs and is configured.
const RESULT_NODE_TYPES = new Set(['generated-image', 'generated-model', 'generated-export'])
const INPUT_NODE_TYPES = new Set(['reference-image', 'prompt'])

function nodeRoleFor(node: Omit<CanvasNodeSchema, 'role'>): NodeRole {
  if (node.type === 'frame') return 'container'
  if (RESULT_NODE_TYPES.has(node.type)) return 'result'
  if (INPUT_NODE_TYPES.has(node.type)) return 'input'
  return 'execution'
}

export const canvasNodeSchema: CanvasNodeSchema[] = canvasNodeDefinitions.map((node) => ({ ...node, role: nodeRoleFor(node) }))

export const canvasNodeSchemas = Object.fromEntries(canvasNodeSchema.map((node) => [node.type, node])) as Record<string, CanvasNodeSchema>

// Gen HD Model has two exclusive ways in. Images takes any loose pictures.
// Views takes the labeled front / back / left / right ports. Text stays in both.
const modelInputModeParameter: NodeParameter = {
  key: 'inputMode',
  label: 'Mode',
  control: 'segmented',
  options: [
    { value: 'images', label: 'Images' },
    { value: 'views', label: 'Views' },
  ],
}

export function nodeSchema(type: string, provider: CanvasProvider = 'tripo') {
  const schema = canvasNodeSchemas[type]
  if (!schema) return schema
  let next = schema
  if (provider === 'meshy' && (type === 'generate-model' || type === 'multiview-to-3d' || type === 'text-to-3d')) {
    next = { ...schema, defaults: meshyModelDefaults, parameters: meshyModelParameters, effects: undefined }
  } else if (provider === 'meshy' && type === 'rigging') {
    next = { ...schema, defaults: { heightMeters: 1.7 }, parameters: meshyRigParameters, effects: undefined }
  }
  if (type !== 'generate-model') return next
  return {
    ...next,
    defaults: { ...next.defaults, inputMode: 'images' },
    parameters: [modelInputModeParameter, ...next.parameters],
  }
}

export function nodeDefaults(type: string, provider: CanvasProvider = 'tripo') {
  return structuredClone(nodeSchema(type, provider)?.defaults || {})
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

/** The forced part a node type plays, or undefined for an unknown type. */
export function nodeRole(type: string): NodeRole | undefined {
  return nodeSchema(type)?.role
}

/** Whether a run materializes this node type as a produced artifact. */
export function isResultNodeType(type: string) {
  return nodeRole(type) === 'result'
}

/** Whether this node type only carries user-given data and never runs. */
export function isInputNodeType(type: string) {
  return nodeRole(type) === 'input'
}

/**
 * A node keeps what it shows in three sibling trees, none of them nested in
 * another:
 *
 *   config          parameters the user filled in
 *   uploadAssets    what the user uploaded to this node
 *   generatedAssets what the node produced by running
 *
 * Copying a node carries `config` and `uploadAssets` — both are the user's own
 * input — but never `generatedAssets`. Node-to-node wiring does not read these:
 * that goes through the declared input/output ports. All three used to share one
 * `config`; `splitNodeTrees` migrates older canvases.
 */
const GENERATED_KEYS = new Set(['approved', 'preview', 'previews', 'result', 'runBatch', 'selectedPreview', 'viewPreviews'])

/**
 * The upload's own fields. `assetType` and `reference` (the original file name)
 * describe the uploaded thing as much as its URL does, so they travel with it
 * rather than staying behind in `config`.
 */
const UPLOAD_KEYS = new Set(['assetType', 'assetUrl', 'modelUrl', 'reference', 'thumbnailUrl'])

/**
 * Lifts the upload and result fields still mixed into `config` out into their own
 * trees, folding them together with the already-separated copies. This is where an
 * older canvas migrates.
 *
 * `outputResult` is what the result tree was called before it became
 * `generatedAssets`; canvases were saved under that name, so it is read here and
 * folded in. Without this the rename would strip a saved canvas of its results.
 */
export function splitNodeTrees(config: Record<string, unknown> = {}, uploadAssets: Record<string, unknown> = {}, generatedAssets: Record<string, unknown> = {}, outputResult: Record<string, unknown> = {}) {
  const nextConfig: Record<string, unknown> = {}
  const nextUploads: Record<string, unknown> = { ...uploadAssets }
  const nextGenerated: Record<string, unknown> = { ...outputResult, ...generatedAssets }
  for (const [key, value] of Object.entries(config)) {
    // A separated copy is authoritative: a same-named leftover in the old config
    // does not overwrite it.
    const target = GENERATED_KEYS.has(key) ? nextGenerated : UPLOAD_KEYS.has(key) ? nextUploads : null
    if (target) {
      if (!(key in target)) target[key] = value
      continue
    }
    nextConfig[key] = value
  }
  return { config: nextConfig, uploadAssets: nextUploads, generatedAssets: nextGenerated }
}

/**
 * Normalization on the generated side: drop the retired demo placeholders and
 * keep a candidate list's selection inside that list.
 */
export function normalizeGeneratedAssets(type: string, generatedAssets: Record<string, unknown> = {}) {
  const normalized = { ...generatedAssets }

  // These were formerly saved as node defaults. Results now exist only on a run,
  // so remove the old bundled placeholders when a canvas is loaded.
  if (typeof normalized.preview === 'string' && legacyPreviewPaths.has(normalized.preview)) delete normalized.preview
  if (Array.isArray(normalized.previews) && normalized.previews.every((preview) => typeof preview === 'string' && legacyPreviewPaths.has(preview))) delete normalized.previews
  if (normalized.viewPreviews && typeof normalized.viewPreviews === 'object' && Object.values(normalized.viewPreviews).every((preview) => typeof preview === 'string' && legacyPreviewPaths.has(preview))) delete normalized.viewPreviews

  if (type === 'generate-image' && Array.isArray(normalized.previews) && !normalized.previews.includes(normalized.selectedPreview)) normalized.selectedPreview = normalized.previews[0] || null
  return normalized
}

export function normalizeNodeConfig(type: string, config: Record<string, unknown> = {}, provider: CanvasProvider = 'tripo') {
  const normalized = { ...nodeDefaults(type, provider), ...config }
  const schema = nodeSchema(type, provider)

  if (provider === 'meshy' && type === 'generate-model') {
    if (!config.modelType) normalized.modelType = config.aiModel === 'meshy-t2' || config.aiModel === 'meshy-t2.5' ? 'smart-topology' : 'standard'
    if (config.shouldRemesh === undefined && normalized.modelType === 'standard') {
      const faceCount = Number(config.faceCount)
      normalized.shouldRemesh = config.topology === 'quad' || (faceCount >= 100 && faceCount <= 300000)
    }
    if (normalized.modelType === 'smart-topology' && normalized.aiModel !== 'meshy-t2' && normalized.aiModel !== 'meshy-t2.5') normalized.aiModel = 'meshy-t2.5'
  }

  for (const parameter of visibleParameters(schema?.parameters, normalized)) {
    if (parameter.control !== 'select' || !parameter.options?.length) continue
    if (!parameter.options.some((option) => option.value === normalized[parameter.key])) normalized[parameter.key] = schema.defaults[parameter.key] ?? parameter.options[0].value
  }

  if (provider !== 'meshy' && ['generate-model', 'multiview-to-3d', 'text-to-3d'].includes(type)) {
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

/** Every parameter, including inputs owned by a menu option. */
export function allParameters(parameters: NodeParameter[] | undefined): NodeParameter[] {
  const list: NodeParameter[] = []
  const walk = (items: NodeParameter[]) => {
    for (const parameter of items) {
      list.push(parameter)
      for (const option of parameter.options || []) if (option.inputs?.length) walk(option.inputs)
    }
  }
  if (parameters) walk(parameters)
  return list
}

/**
 * Parameters to draw. Whichever option is selected contributes its inputs,
 * directly under that control. A toggle uses the option whose value is true.
 */
export function visibleParameters(parameters: NodeParameter[] | undefined, config: Record<string, unknown>): NodeParameter[] {
  const list: NodeParameter[] = []
  const walk = (items: NodeParameter[]) => {
    for (const parameter of items) {
      list.push(parameter)
      const selected = parameter.options?.find((option) => option.value === config[parameter.key])
      if (selected?.inputs?.length) walk(selected.inputs)
    }
  }
  if (parameters) walk(parameters)
  return list
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

export function applyNodeParameter(type: string, config: Record<string, unknown>, key: string, value: unknown, provider: CanvasProvider = 'tripo') {
  const next = { ...config, [key]: value }
  for (const effect of nodeSchema(type, provider)?.effects || []) {
    if (effect.when.field === key && value === effect.when.equals) Object.assign(next, effect.set)
  }
  return next
}
