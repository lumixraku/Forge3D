import { isExecutableNodeType, nodeRole } from './canvas-schema'
import { canConnectPorts, nodeOutputPorts } from './canvas-nodes'

/**
 * Every execution node owns a fixed set of result nodes from the moment the
 * canvas is built, so a workflow looks the same before and after it runs: the
 * nodes are there, only their contents are empty. A run fills them in; it never
 * creates or removes one.
 *
 * The count follows what the stage can produce: a model stage yields one model
 * result, a multi-view stage one result per view, an image stage as many as its
 * `Images` parameter asks for.
 */
const MULTI_VIEW_KEYS = ['front', 'back', 'left', 'right']
const VIEW_LABELS: Record<string, string> = { front: 'Front', back: 'Back', left: 'Left', right: 'Right' }
const DEFAULT_IMAGE_COUNT = 1
const EXPORT_RESULT = 'Export file'

export interface ResultSpec {
  type: 'generated-image' | 'generated-model' | 'generated-export'
  /** Names the slot; a re-count keeps the slots that keep their name. */
  slot: string
  name: string
  /** The input port this result feeds on the downstream node slot. */
  produces: 'image' | 'model'
  /** A multi-view stage labels each result with the port it carries. */
  view?: string
}

function mediaPorts(type: string) {
  return nodeOutputPorts(type).filter((port) => port.type === 'image' || port.type === 'model')
}

function imageSpec(index: number, count: number, view?: string): ResultSpec {
  return {
    type: 'generated-image',
    slot: view ? `view:${view}` : `image:${index}`,
    name: view ? `${VIEW_LABELS[view]} view` : count > 1 ? `Image ${index + 1}` : 'Image',
    produces: 'image',
    ...(view ? { view } : {}),
  }
}

function imageCount(config: Record<string, unknown> | null | undefined) {
  const amount = Number(config?.amount)
  return Number.isInteger(amount) && amount > 0 ? amount : DEFAULT_IMAGE_COUNT
}

/**
 * The result nodes an execution node owns. Empty for inputs, containers and the
 * result nodes themselves.
 */
export function resultSpecs(type: string, config: Record<string, unknown> | null | undefined): ResultSpec[] {
  if (!isExecutableNodeType(type)) return []
  const views = MULTI_VIEW_KEYS.filter((key) => nodeOutputPorts(type).some((port) => port.id === key))

  if (type === 'export-model') {
    return [{ type: 'generated-export', slot: 'export', name: EXPORT_RESULT, produces: 'model' }]
  }
  if (views.length) return views.map((view) => imageSpec(0, 1, view))

  const media = mediaPorts(type)
  if (media.some((port) => port.type === 'model')) {
    return [{ type: 'generated-model', slot: 'model', name: 'Model', produces: 'model' }]
  }
  if (!media.length) return []
  const count = imageCount(config)
  return Array.from({ length: count }, (_, index) => imageSpec(index, count))
}

export function isResultType(type: string) {
  return nodeRole(type) === 'result'
}

/** The output port a result node of this type forwards its value on. */
export function resultOutputPort(type: string) {
  return nodeOutputPorts(type)[0]?.id || null
}

/** Whether a result of `resultType` can be wired into this input port. */
export function resultFitsPort(resultType: string, targetType: string, targetPortId: string) {
  const port = resultOutputPort(resultType)
  return Boolean(port) && canConnectPorts(resultType, port, targetType, targetPortId)
}
