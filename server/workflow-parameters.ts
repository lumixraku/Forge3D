export const workflowParameters = {
  'reference-image': {
    label: 'Image Upload',
    fields: {
      sourceType: { label: 'source type', kind: 'enum', values: ['Upload', 'Asset Library', 'URL'] },
      reference: { label: 'reference', kind: 'string' },
      background: { label: 'background', kind: 'enum', values: ['Keep', 'Remove'] },
    },
  },
  prompt: {
    label: 'Text Prompt',
    fields: {
      prompt: { label: 'prompt', kind: 'string' },
      strength: { label: 'prompt strength', kind: 'number', min: 0, max: 100, step: 1, unit: '%' },
    },
  },
  'generate-image': {
    label: 'Image to Image',
    fields: {
      model: { label: 'image model', kind: 'enum', values: ['GPT Image 2', 'Flux 1.1 Pro', 'Stable Diffusion 3.5'] },
      count: { label: 'image count', kind: 'number', min: 1, max: 4, step: 1 },
      aspectRatio: { label: 'aspect ratio', kind: 'enum', values: ['1:1', '4:3', '3:4', '16:9'] },
      referenceMode: { label: 'reference mode', kind: 'enum', values: ['Image + Prompt', 'Prompt only', 'Image variation'] },
    },
  },
  'generate-multiview-images': {
    label: 'Generate Multi-view Images',
    fields: {
      model: { label: 'image model', kind: 'enum', values: ['GPT Image 2', 'Flux 1.1 Pro', 'Stable Diffusion 3.5'] },
      aspectRatio: { label: 'aspect ratio', kind: 'enum', values: ['1:1', '4:3', '3:4', '16:9'] },
      referenceMode: { label: 'reference mode', kind: 'enum', values: ['Image + Prompt', 'Prompt only', 'Image variation'] },
    },
  },
  'generate-model': {
    label: 'Gen HD Model',
    fields: {
      faceCount: { label: 'generated face count', kind: 'number', min: 1000, max: 50000, step: 1000 },
      modelVersion: { label: 'model version', kind: 'enum', values: ['Smart Mesh', 'v2.5', 'v2.0'] },
      textureMode: { label: 'texture mode', kind: 'enum', values: ['None', 'HD', 'PBR'] },
      faceType: { label: 'face type', kind: 'enum', values: ['Triangle', 'Quad'] },
    },
  },
  'smart-mesh': {
    label: 'Smart Mesh',
    fields: {
      faceCount: { label: 'generated face count', kind: 'number', min: 1000, max: 50000, step: 1000 },
      faceType: { label: 'face type', kind: 'enum', values: ['Triangle', 'Quad'] },
      textureQuality: { label: 'texture quality', kind: 'enum', values: ['No texture', 'Standard', 'HD'] },
      pbr: { label: 'generate PBR maps', kind: 'boolean' },
    },
  },
  'multiview-to-3d': {
    label: 'Multi-view to 3D',
    fields: {
      faceCount: { label: 'generated face count', kind: 'number', min: 1000, max: 50000, step: 1000 },
      modelVersion: { label: 'model version', kind: 'enum', values: ['Smart Mesh', 'v2.5', 'v2.0'] },
      textureMode: { label: 'texture mode', kind: 'enum', values: ['None', 'HD', 'PBR'] },
      faceType: { label: 'face type', kind: 'enum', values: ['Triangle', 'Quad'] },
    },
  },
  'text-to-3d': {
    label: 'Text to 3D',
    fields: {
      faceCount: { label: 'generated face count', kind: 'number', min: 1000, max: 50000, step: 1000 },
      modelVersion: { label: 'model version', kind: 'enum', values: ['Smart Mesh', 'v2.5', 'v2.0'] },
      textureMode: { label: 'texture mode', kind: 'enum', values: ['None', 'HD', 'PBR'] },
      faceType: { label: 'face type', kind: 'enum', values: ['Triangle', 'Quad'] },
    },
  },
  retopology: {
    label: 'Retopology',
    fields: {
      faceLimit: { label: 'target face count', kind: 'number', min: 500, max: 20000, step: 500 },
      modelVersion: { label: 'model version', kind: 'enum', values: ['v2.0', 'v1.0'] },
      faceType: { label: 'face type', kind: 'enum', values: ['Triangle', 'Quad'] },
      bakeTextures: { label: 'bake textures', kind: 'boolean' },
    },
  },
  texture: {
    label: 'UV Texture',
    fields: {
      textureQuality: { label: 'texture quality', kind: 'enum', values: ['2K', '4K', '8K'] },
      pbr: { label: 'generate PBR maps', kind: 'boolean' },
    },
  },
  split: {
    label: 'Split',
    fields: {
      subdivision: { label: 'subdivision', kind: 'enum', values: ['Low', 'Medium', 'High'] },
      complete: { label: 'complete segmentation', kind: 'boolean' },
    },
  },
  'model-preview': {
    label: 'Model Preview',
    fields: {
      environment: { label: 'environment', kind: 'enum', values: ['Studio', 'Outdoor', 'Neutral'] },
      autoRotate: { label: 'auto rotate', kind: 'boolean' },
      wireframe: { label: 'wireframe', kind: 'boolean' },
    },
  },
  'export-model': {
    label: 'Export',
    fields: {
      modelFormat: { label: 'model format', kind: 'enum', values: ['GLB', 'OBJ', 'FBX', 'STL'] },
      exportTargets: { label: 'export outputs', kind: 'array', values: ['dcc', 'texture', 'bambu'] },
    },
  },
}

function fieldJsonSchema(field) {
  if (field.kind === 'enum') return { type: 'string', enum: field.values }
  if (field.kind === 'boolean') return { type: 'boolean' }
  if (field.kind === 'array') return { type: 'array', items: { type: 'string', enum: field.values }, uniqueItems: true }
  if (field.kind === 'string') return { type: 'string' }
  return { type: 'number', minimum: field.min, maximum: field.max, multipleOf: field.step }
}

export function workflowParameterJsonSchema() {
  const fields = new Map()
  for (const definition of Object.values(workflowParameters)) {
    for (const [name, field] of Object.entries(definition.fields)) {
      const existing = fields.get(name)
      if (!existing) {
        fields.set(name, { ...fieldJsonSchema(field), description: field.label })
      } else if (existing.enum && field.kind === 'enum') {
        existing.enum = [...new Set([...existing.enum, ...field.values])]
      }
    }
  }
  return {
    type: 'object',
    description: 'Include every parameter explicitly requested for this node, using these canonical property names.',
    properties: Object.fromEntries(fields),
    additionalProperties: false,
  }
}

function fieldDescription(field) {
  if (field.kind === 'enum') return `${field.label} (${field.values.join(', ')})`
  if (field.kind === 'boolean') return `${field.label} (on/off)`
  if (field.kind === 'array') return `${field.label} (${field.values.join(', ')}, multiple allowed)`
  if (field.kind === 'string') return field.label
  return `${field.label} (${field.min.toLocaleString()}-${field.max.toLocaleString()}${field.unit || ''})`
}

export function describeWorkflowParameters(workflow, requestedType) {
  const entries = Object.entries(workflowParameters).filter(([type]) =>
    workflow.nodes.some((node) => node.type === type) && (!requestedType || type === requestedType),
  )
  return entries.map(([, definition]) =>
    `${definition.label}: ${Object.values(definition.fields).map(fieldDescription).join(', ')}`,
  ).join('\n')
}

export function updateNodeParameters(workflow, nodeId, parameters) {
  const node = workflow.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) throw new Error(`Node "${nodeId}" was not found.`)
  const definition = workflowParameters[node.type]
  if (!definition) throw new Error(`${node.name} has no adjustable parameters.`)
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) throw new Error('Parameters must be an object.')

  const changes = []
  for (const [inputField, input] of Object.entries(parameters)) {
    const normalizedField = inputField.toLowerCase().replaceAll(/[^a-z0-9]/g, '')
    const field = Object.keys(definition.fields).find((key) =>
      key.toLowerCase() === normalizedField
      || definition.fields[key].label.toLowerCase().replaceAll(/[^a-z0-9]/g, '') === normalizedField,
    )
    const fieldDefinition = definition.fields[field]
    if (!fieldDefinition) throw new Error(`${definition.label} does not support parameter "${inputField}".`)
    let value = input
    if (fieldDefinition.kind === 'number') {
      value = Number(input)
      if (!Number.isFinite(value) || value < fieldDefinition.min || value > fieldDefinition.max || value % fieldDefinition.step !== 0) {
        throw new Error(`${fieldDefinition.label} must be ${fieldDefinition.min}-${fieldDefinition.max} in steps of ${fieldDefinition.step}.`)
      }
    } else if (fieldDefinition.kind === 'boolean') {
      if (typeof input !== 'boolean') throw new Error(`${fieldDefinition.label} must be true or false.`)
    } else if (fieldDefinition.kind === 'string') {
      if (typeof input !== 'string') throw new Error(`${fieldDefinition.label} must be text.`)
    } else if (fieldDefinition.kind === 'array') {
      if (!Array.isArray(input) || input.some((entry) => !fieldDefinition.values.includes(entry))) throw new Error(`${fieldDefinition.label} must contain only: ${fieldDefinition.values.join(', ')}.`)
      value = [...new Set(input)]
    } else {
      value = fieldDefinition.values.find((candidate) => candidate.toLowerCase() === String(input).toLowerCase())
      if (!value) throw new Error(`${fieldDefinition.label} must be one of: ${fieldDefinition.values.join(', ')}.`)
    }
    if (node.config[field] === value) continue
    changes.push({ nodeId, nodeLabel: definition.label, fieldLabel: fieldDefinition.label, previousValue: node.config[field], value })
    node.config = { ...node.config, [field]: value }
  }
  return changes
}
