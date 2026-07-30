import { applyNodeParameter, nodeSchema, parameterRange, canvasNodeSchema } from '../src/canvas-schema.js'

function parameterKind(parameter) {
  if (parameter.control === 'toggle') return 'boolean'
  if (parameter.control === 'slider') return 'number'
  if (parameter.control === 'text' || parameter.control === 'textarea') return 'string'
  return 'enum'
}

export const canvasParameters = Object.fromEntries(canvasNodeSchema
  .filter((node) => node.parameters.length)
  .map((node) => [node.type, {
    label: node.label,
    fields: Object.fromEntries(node.parameters.map((parameter) => {
      const range = parameterRange(parameter, node.defaults)
      return [parameter.key, {
        label: parameter.label,
        kind: parameterKind(parameter),
        ...(parameter.options ? { values: parameter.options.map((option) => option.value) } : {}),
        ...(range ? range : {}),
      }]
    })),
  }]))

function fieldJsonSchema(field) {
  if (field.kind === 'enum') {
    const types = [...new Set(field.values.map((value) => typeof value))]
    return { type: types.length === 1 ? types[0] : types, enum: field.values }
  }
  if (field.kind === 'boolean') return { type: 'boolean' }
  if (field.kind === 'string') return { type: 'string' }
  return { type: 'number', minimum: field.min, maximum: field.max, multipleOf: field.step }
}

export function canvasParameterJsonSchema() {
  const fields = new Map()
  for (const definition of Object.values(canvasParameters)) {
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
  if (field.kind === 'string') return field.label
  return `${field.label} (${field.min.toLocaleString()}-${field.max.toLocaleString()})`
}

export function describeCanvasParameters(canvas, requestedType) {
  const entries = Object.entries(canvasParameters).filter(([type]) =>
    canvas.nodes.some((node) => node.type === type) && (!requestedType || type === requestedType),
  )
  return entries.map(([, definition]) =>
    `${definition.label}: ${Object.values(definition.fields).map(fieldDescription).join(', ')}`,
  ).join('\n')
}

export function updateNodeParameters(canvas, nodeId, parameters) {
  const node = canvas.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) throw new Error(`Node "${nodeId}" was not found.`)
  const schema = nodeSchema(node.type)
  if (!schema?.parameters.length) throw new Error(`${node.name} has no adjustable parameters.`)
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) throw new Error('Parameters must be an object.')

  const changes = []
  for (const [inputField, input] of Object.entries(parameters)) {
    const normalizedField = inputField.toLowerCase().replaceAll(/[^a-z0-9]/g, '')
    const parameter = schema.parameters.find((candidate) =>
      candidate.key.toLowerCase() === normalizedField
      || candidate.label.toLowerCase().replaceAll(/[^a-z0-9]/g, '') === normalizedField,
    )
    if (!parameter) throw new Error(`${schema.label} does not support parameter "${inputField}".`)

    const kind = parameterKind(parameter)
    let value = input
    if (kind === 'number') {
      value = Number(input)
      const range = parameterRange(parameter, { ...node.config, [parameter.key]: value })
      if (!Number.isFinite(value) || value < range.min || value > range.max || value % range.step !== 0) {
        throw new Error(`${parameter.label} must be ${range.min}-${range.max} in steps of ${range.step}.`)
      }
    } else if (kind === 'boolean') {
      if (typeof input !== 'boolean') throw new Error(`${parameter.label} must be true or false.`)
    } else if (kind === 'string') {
      if (typeof input !== 'string') throw new Error(`${parameter.label} must be text.`)
    } else {
      value = parameter.options.find((option) => String(option.value).toLowerCase() === String(input).toLowerCase())?.value
      if (value === undefined) throw new Error(`${parameter.label} must be one of: ${parameter.options.map((option) => option.value).join(', ')}.`)
    }
    if (node.config[parameter.key] === value) continue
    changes.push({ nodeId, nodeLabel: schema.label, fieldLabel: parameter.label, previousValue: node.config[parameter.key], value })
    node.config = applyNodeParameter(node.type, node.config, parameter.key, value)
  }
  return changes
}
