<script setup lang="ts">
import { bizClass } from '../class-prefix'
import { computed, nextTick, ref, watch } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import NodeSelect from './NodeSelect.vue'
import NodeSlider from './NodeSlider.vue'

import type { NodeRun } from '../node-runs'
import { applyNodeParameter, conditionsMatch, nodeSchema, parameterRange } from '../canvas-nodes'
import type { NodeDefinition, NodeParameter, NodePort } from '../canvas-nodes'

type NodeConfig = Record<string, unknown> & { preview?: string; previews?: string[]; viewPreviews?: Record<string, string>; exportTargets?: string[]; modelFormat?: string; approved?: boolean }
interface CanvasNodeData { label: string; status?: string; canvasType: string; config: NodeConfig; inputPorts?: NodePort[]; outputPorts?: NodePort[] }
const EXECUTION_CREDIT_COST = 10

const props = withDefaults(defineProps<{ id: string; data: CanvasNodeData; selected?: boolean; nodeRun?: NodeRun | null; runId?: string | null; runEntryNodeId?: string | null; runMode?: string | null; runStatus?: string | null; inboundType?: string | null; inboundImage?: string | null; nodeCatalog?: NodeDefinition[]; viewportDismissVersion?: number; connectionInvalid?: boolean }>(), { selected: false, nodeRun: null, runId: null, runEntryNodeId: null, runMode: null, runStatus: null, inboundType: null, inboundImage: null, nodeCatalog: () => [], viewportDismissVersion: 0, connectionInvalid: false })
const emit = defineEmits<{
  'update-config': [config: NodeConfig]
  'update-name': [name: string]
  'open-model-editor': []
  'preview-image': [preview: { src: string; alt: string }]
  'add-next': [payload: unknown]
  'run-canvas': [id: string]
  'run-downstream': [id: string]
  'stop-run': []
}>()
const nextMenuOpen = ref(false)
const parametersOpen = ref(false)
const advancedParametersOpen = ref(false)
const runDetailsOpen = ref(false)
const editingName = ref(false)
const draftName = ref('')
const nameInput = ref<HTMLInputElement | null>(null)
const imageInput = ref<HTMLInputElement | null>(null)
const imageDragging = ref(false)
const imageUploadError = ref('')
watch(() => props.viewportDismissVersion, () => { nextMenuOpen.value = false })
const runtimeStatus = computed(() => props.nodeRun?.status || props.data.status)
const schema = computed(() => nodeSchema(props.data.canvasType))
const isExecutableNode = computed(() => Boolean(schema.value?.executable))
const visibleParameters = computed(() => (schema.value?.parameters || []).filter((parameter) => conditionsMatch(parameter.visibleWhen, props.data.config)))
const renderParameters = computed(() => [
  ...visibleParameters.value.filter((parameter) => !parameter.advanced),
  ...visibleParameters.value.filter((parameter) => parameter.advanced),
])
const hasEditor = computed(() => visibleParameters.value.length > 0)
const hasAdvancedParameters = computed(() => renderParameters.value.some((parameter) => parameter.advanced))
const firstAdvancedParameter = computed(() => renderParameters.value.find((parameter) => parameter.advanced))
const showResult = computed(() => Boolean(
  runtimePreview.value || runtimePreviews.value.length || Object.keys(runtimeViewPreviews.value).length,
))
const isExecuting = computed(() => ['queued', 'running', 'cancelling'].includes(runtimeStatus.value || ''))
const isActiveEntry = computed(() => props.runEntryNodeId === props.id
  && ['queued', 'running', 'cancelling'].includes(props.runStatus || ''))
const stopsNodeRun = computed(() => isActiveEntry.value && props.runMode === 'node')
const stopsDownstreamRun = computed(() => isActiveEntry.value && props.runMode === 'downstream')
// Only a real backend reports progress; a simulated node finishes too fast to
// have any.
const runProgress = computed(() => (typeof props.nodeRun?.progress === 'number' ? Math.round(Math.min(100, Math.max(0, props.nodeRun.progress))) : null))
const progressStyle = computed(() => ({ '--run-progress': `${runProgress.value ?? 0}%` }))
const actionLabel = computed(() => {
  if (runtimeStatus.value === 'running') return runProgress.value === null ? 'Generating…' : `Generating… ${runProgress.value}%`
  if (runtimeStatus.value === 'queued') return 'Queued'
  if (runtimeStatus.value === 'failed') return 'Try again'
  return runtimeStatus.value === 'succeeded' ? 'Regenerate' : 'Generate'
})
const runStateTitle = computed(() => {
  if (runtimeStatus.value === 'running') return 'Generating result'
  if (runtimeStatus.value === 'queued') return 'Waiting to run'
  if (runtimeStatus.value === 'failed') return 'Generation failed'
  if (runtimeStatus.value === 'succeeded') return 'Result ready'
  return 'Ready to run'
})
const runStateDetail = computed(() => {
  if (props.nodeRun?.error) return props.nodeRun.error
  if (props.nodeRun?.output?.message) return props.nodeRun.output.message
  if (runtimeStatus.value !== 'running') return 'Run this node to create its output'
  // A real task reports progress and can take tens of seconds; a simulated one cannot.
  return runProgress.value === null ? 'Execution is in progress' : `Tripo task in progress · ${runProgress.value}%`
})
const runtimePreview = computed(() => props.nodeRun?.output?.preview || (!isExecutableNode.value ? props.data.config.preview : ''))
// The run downloads the export once as it finishes, which is no help after a
// reload, so a finished export also offers the file directly.
const exportDownloads = computed(() => {
  const output = props.nodeRun?.output
  if (!output) return []
  return (output.outputs || (output.downloadUrl ? [output] : [])).filter((item) => item.downloadUrl)
})
const reviewImage = computed(() => props.nodeRun?.output?.preview || '')
const runtimePreviews = computed(() => props.nodeRun?.output?.previews || (!isExecutableNode.value ? props.data.config.previews : []) || [])
const runtimeViewPreviews = computed(() => props.nodeRun?.output?.viewPreviews || (!isExecutableNode.value ? props.data.config.viewPreviews : {}) || {})
const viewPorts = ['front', 'back', 'left', 'right']
const visibleInputPorts = computed(() => props.data.inputPorts?.length ? [{ id: 'input', label: 'Input' }] : [])
const visibleOutputPorts = computed(() => props.data.outputPorts?.length ? [{ id: 'output', label: 'Output' }] : [])
const exportTarget = computed(() => props.inboundType || '3D Model')
const exportFormat = computed(() => props.data.config.modelFormat || 'GLB')
const runConfig = computed(() => {
  if (props.data.canvasType === 'export-model') return [['target', exportTarget.value], ['format', exportFormat.value]]
  return visibleParameters.value.map((parameter) => [parameter.key, props.data.config[parameter.key]])
})

function toggleApprove() {
  const next = !props.data.config.approved
  update('approved', next)
  if (next) emit('run-downstream', props.id)
}

function update(key: string, value: unknown) {
  emit('update-config', applyNodeParameter(props.data.canvasType, props.data.config, key, value))
}

function range(parameter: NodeParameter) {
  return parameterRange(parameter, props.data.config)
}

function startNameEdit() {
  draftName.value = props.data.label
  editingName.value = true
  nextTick(() => {
    nameInput.value?.focus()
    nameInput.value?.select()
  })
}

function saveName() {
  if (!editingName.value) return
  const name = draftName.value.trim()
  editingName.value = false
  if (name && name !== props.data.label) emit('update-name', name)
}

function cancelNameEdit() {
  editingName.value = false
  draftName.value = props.data.label
}

function selectGeneratedImage(image: string, index: number) {
  update('selectedPreview', image)
  emit('preview-image', { src: image, alt: `Generated concept ${index + 1}` })
}

function selectImageFile(event: Event) {
  const input = event.target as HTMLInputElement
  const [file] = [...(input.files || [])]
  input.value = ''
  if (file) loadMockImage(file)
}

function dropImage(event: DragEvent) {
  imageDragging.value = false
  const [file] = [...(event.dataTransfer?.files || [])]
  if (file) loadMockImage(file)
}

function loadMockImage(file: File) {
  const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])
  imageUploadError.value = ''
  if (!allowedTypes.has(file.type)) {
    imageUploadError.value = 'Use JPG, PNG or WEBP'
    return
  }
  if (file.size > 20 * 1024 * 1024) {
    imageUploadError.value = 'Image must be 20 MB or smaller'
    return
  }

  const reader = new FileReader()
  reader.addEventListener('load', () => {
    if (typeof reader.result !== 'string') return
    emit('update-config', { ...props.data.config, reference: file.name, preview: reader.result })
  }, { once: true })
  reader.addEventListener('error', () => {
    imageUploadError.value = 'Could not read this image'
  }, { once: true })
  reader.readAsDataURL(file)
}

</script>

<template>
  <article class="forge3d-canvas-node forge:group forge:relative forge:w-[260px] forge:rounded-[10px] forge:border forge:border-[var(--node-accent)] forge:bg-[color-mix(in_srgb,var(--bg-input)_97%,transparent)] forge:px-[14px] forge:pb-[11px] forge:pt-[13px] forge:shadow-lg forge:transition-[border-color,box-shadow,filter,opacity] forge:hover:border-[color-mix(in_srgb,var(--node-accent)_72%,var(--line-strong))] forge:[&.forge3d-selected]:shadow-[inset_0_0_0_1px_var(--node-accent),var(--shadow-lg)] forge:[&.forge3d-is-running]:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--node-accent)_45%,transparent),var(--shadow-lg)] forge:[&.forge3d-is-executing]:border-transparent forge:[&.forge3d-is-executing]:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--node-accent)_18%,transparent),0_0_12px_color-mix(in_srgb,var(--node-accent)_18%,transparent),var(--shadow-lg)] forge:[&.forge3d-is-failed]:border-status-failed forge:[&.forge3d-is-failed]:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--status-failed)_30%,transparent),var(--shadow-lg),0_0_22px_color-mix(in_srgb,var(--status-failed)_14%,transparent)]" :class="[`forge3d-tone-${data.tone}`, `forge3d-is-${runtimeStatus}`, { 'forge3d-selected': selected, 'forge3d-is-executing': isExecuting, 'forge3d-connection-invalid': connectionInvalid }]">
    <svg v-if="isExecuting" class="forge3d-node-execution-border" aria-hidden="true">
      <rect class="forge3d-node-execution-border-base" pathLength="200" />
      <rect class="forge3d-node-execution-border-glow" pathLength="200" />
      <rect class="forge3d-node-execution-border-point" pathLength="200" />
    </svg>
    <div class="forge:absolute forge:bottom-[calc(100%+7px)] forge:left-0 forge:z-[7] forge:inline-flex forge:h-[34px] forge:w-max forge:max-w-full forge:items-center forge:gap-2 forge:rounded-lg forge:border forge:border-[color-mix(in_srgb,var(--node-accent)_48%,var(--line-strong))] forge:bg-[color-mix(in_srgb,var(--node-accent)_16%,var(--bg-input))] forge:px-2 forge:py-[5px] forge:shadow-sm">
      <span class="forge:grid forge:size-5 forge:flex-none forge:place-items-center forge:rounded-[5px] forge:border forge:border-[color-mix(in_srgb,var(--node-accent)_65%,var(--line-strong))] forge:bg-[color-mix(in_srgb,var(--node-accent)_10%,var(--bg-input))] forge:font-mono forge:text-[9px] forge:font-semibold forge:text-[var(--node-accent)] forge:transition-[box-shadow,transform] forge:group-hover:scale-105">{{ data.kind.slice(0, 1) }}</span>
      <input v-if="editingName" ref="nameInput" v-model="draftName" class="nodrag nopan forge:block forge:h-4 forge:w-full forge:min-w-0 forge:max-w-[210px] forge:border-0 forge:bg-transparent forge:p-0 forge:text-[13px] forge:font-semibold forge:leading-4 forge:caret-acid forge:outline-0" aria-label="Node name" @click.stop @dblclick.stop @pointerdown.stop @keydown.enter.prevent="saveName" @keydown.esc.prevent="cancelNameEdit" @blur="saveName" />
      <h3 v-else class="forge:h-4 forge:min-w-0 forge:max-w-[210px] forge:cursor-pointer forge:overflow-hidden forge:text-ellipsis forge:whitespace-nowrap forge:text-[13px] forge:font-semibold forge:leading-4" title="Double-click to rename" @dblclick.stop="startNameEdit">{{ data.label }}</h3>
      <span class="forge3d-node-status forge:size-2 forge:flex-none forge:rounded-full forge:border forge:border-[color-mix(in_srgb,var(--text-muted)_72%,transparent)] forge:bg-text-muted forge:shadow-[0_0_0_3px_color-mix(in_srgb,var(--text-muted)_12%,transparent)]" :class="bizClass(runtimeStatus)" role="status" :aria-label="runtimeStatus" :title="runtimeStatus" />
    </div>
    <template v-for="(port, index) in visibleInputPorts" :key="`input-${port.id}`">
      <Handle :id="port.id" class="forge3d-canvas-handle forge3d-input-handle" type="target" :position="Position.Left" :style="{ top: `${28 + (index + 1) * 52}px` }" title="Input" />
    </template>
    <p class="forge:mb-3 forge:mt-0 forge:text-[9px] forge:text-text-muted">{{ data.detail }}</p>

    <div v-if="['generate-image', 'image-decomposition'].includes(data.canvasType) && showResult" class="forge3d-node-output forge:relative forge:mb-[11px] forge:grid forge:h-[146px] forge:w-full forge:grid-cols-2 forge:gap-0.5 forge:overflow-hidden forge:rounded-lg forge:border forge:border-line-subtle forge:bg-[radial-gradient(circle_at_50%_45%,#edf1ed,#dfe5e0_72%)] forge:p-0.5 forge:text-left forge:dark:bg-[radial-gradient(circle_at_50%_45%,#30352f,#111412_72%)]" :aria-label="data.canvasType === 'image-decomposition' ? 'Extracted image assets' : 'Generated image candidates'">
      <button v-for="(image, index) in runtimePreviews" :key="`${image}-${index}`" type="button" class="nodrag nopan forge:relative forge:min-h-0 forge:min-w-0 forge:overflow-hidden forge:rounded-[3px] forge:border-0 forge:bg-transparent forge:p-0 forge:transition-transform forge:after:pointer-events-none forge:after:absolute forge:after:inset-0 forge:after:rounded-[inherit] forge:focus-visible:outline forge:focus-visible:outline-2 forge:focus-visible:-outline-offset-2 forge:focus-visible:outline-[var(--node-accent)] forge:[&.forge3d-selected]:after:border-2 forge:[&.forge3d-selected]:after:border-[var(--node-accent)] forge:[&_img]:block forge:[&_img]:size-full forge:[&_img]:object-cover forge:[&_img]:transition-[filter] forge:hover:[&_img]:brightness-108" :class="{ 'forge3d-selected': data.config.selectedPreview === image }" :aria-label="`Select and preview generated concept ${index + 1}`" :aria-pressed="data.config.selectedPreview === image" @click.stop="selectGeneratedImage(image, index)">
        <img :src="image" :alt="`Generated concept ${index + 1}`" />
      </button>
      <span class="forge:pointer-events-none forge:absolute forge:bottom-[7px] forge:right-[7px] forge:z-[3] forge:rounded forge:border forge:border-white/15 forge:bg-[rgba(12,15,13,.76)] forge:px-1.5 forge:py-1 forge:font-mono forge:text-[7px] forge:font-medium forge:uppercase forge:text-[#dce2dd] forge:backdrop-blur-[5px]">{{ runtimePreviews.length }} {{ data.canvasType === 'image-decomposition' ? 'assets' : 'candidates' }}</span>
      <div v-if="isExecuting" class="forge3d-node-output-loading forge:absolute forge:inset-0 forge:z-[5] forge:grid forge:place-content-center forge:justify-items-center forge:gap-[9px] forge:bg-[color-mix(in_srgb,var(--bg-input)_76%,transparent)] forge:text-center forge:text-text-primary forge:backdrop-blur-[3px]" role="status"><span class="forge3d-node-run-indicator" /><strong>{{ runtimeStatus === 'queued' ? 'Queued' : runtimeStatus === 'cancelling' ? 'Stopping' : 'Generating' }}</strong><div v-if="runtimeStatus === 'running'" class="forge3d-node-progress" :class="{ 'forge3d-indeterminate': runProgress === null }" :style="progressStyle"><span /><b>{{ runProgress === null ? 'Working' : `${runProgress}%` }}</b></div></div>
    </div>
    <div v-else-if="data.canvasType === 'generate-multiview-images' && showResult" class="forge3d-node-output forge:relative forge:mb-[11px] forge:grid forge:h-[146px] forge:w-full forge:grid-cols-2 forge:gap-0.5 forge:overflow-hidden forge:rounded-lg forge:border forge:border-line-subtle forge:bg-[radial-gradient(circle_at_50%_45%,#edf1ed,#dfe5e0_72%)] forge:p-0.5 forge:text-left forge:dark:bg-[radial-gradient(circle_at_50%_45%,#30352f,#111412_72%)]" aria-label="Generated multi-view images">
      <button v-for="view in viewPorts" :key="view" type="button" class="nodrag nopan forge:relative forge:min-h-0 forge:min-w-0 forge:overflow-hidden forge:rounded-[3px] forge:border-0 forge:bg-transparent forge:p-0 forge:transition-transform forge:focus-visible:outline forge:focus-visible:outline-2 forge:focus-visible:-outline-offset-2 forge:focus-visible:outline-[var(--node-accent)] forge:[&_img]:block forge:[&_img]:size-full forge:[&_img]:object-cover forge:[&_img]:transition-[filter] forge:hover:[&_img]:brightness-108" :aria-label="`Preview ${view} view`" @click.stop="emit('preview-image', { src: runtimeViewPreviews[view], alt: `${view} view` })">
        <img :src="runtimeViewPreviews[view]" :alt="`${view} view`" />
      </button>
      <div v-if="isExecuting" class="forge3d-node-output-loading forge:absolute forge:inset-0 forge:z-[5] forge:grid forge:place-content-center forge:justify-items-center forge:gap-[9px] forge:bg-[color-mix(in_srgb,var(--bg-input)_76%,transparent)] forge:text-center forge:text-text-primary forge:backdrop-blur-[3px]" role="status"><span class="forge3d-node-run-indicator" /><strong>{{ runtimeStatus === 'queued' ? 'Queued' : runtimeStatus === 'cancelling' ? 'Stopping' : 'Generating' }}</strong><div v-if="runtimeStatus === 'running'" class="forge3d-node-progress" :class="{ 'forge3d-indeterminate': runProgress === null }" :style="progressStyle"><span /><b>{{ runProgress === null ? 'Working' : `${runProgress}%` }}</b></div></div>
    </div>
    <button v-else-if="['reference-image', 'generated-image', 'generate-model', 'smart-mesh', 'multiview-to-3d', 'text-to-3d', 'retopology', 'texture', 'rigging', 'segments', 'model-preview'].includes(data.canvasType) && showResult" type="button" class="forge3d-node-output nodrag nopan forge:relative forge:mb-[11px] forge:block forge:h-[146px] forge:w-full forge:overflow-hidden forge:rounded-lg forge:border forge:border-line-subtle forge:bg-[radial-gradient(circle_at_50%_45%,#edf1ed,#dfe5e0_72%)] forge:p-0 forge:text-left forge:transition-[border-color,box-shadow] forge:hover:border-[var(--node-accent)] forge:focus-visible:outline forge:focus-visible:outline-2 forge:focus-visible:outline-offset-2 forge:focus-visible:outline-[var(--node-accent)] forge:dark:bg-[radial-gradient(circle_at_50%_45%,#30352f,#111412_72%)] forge:[&>img]:size-full forge:[&>img]:object-cover forge:[&.forge3d-model-output>img]:relative forge:[&.forge3d-model-output>img]:z-[1] forge:[&.forge3d-model-output>img]:object-contain forge:[&.forge3d-model-output>img]:drop-shadow-[0_12px_12px_rgba(0,0,0,.45)] forge:[&.forge3d-model-output>img]:transition-[filter] forge:[&.forge3d-model-output:hover>img]:drop-shadow-[0_16px_16px_rgba(0,0,0,.5)]" :class="{ 'forge3d-model-output': !['reference-image', 'generated-image'].includes(data.canvasType) }" :aria-label="['reference-image', 'generated-image'].includes(data.canvasType) ? `Preview ${data.label} image` : `Open ${data.label} in Model Editor`" @click.stop="['reference-image', 'generated-image'].includes(data.canvasType) ? emit('preview-image', { src: runtimePreview, alt: `${data.label} result` }) : emit('open-model-editor')">
      <img :src="runtimePreview" :alt="`${data.label} result`" />
      <div v-if="!['reference-image', 'generated-image', 'image-decomposition'].includes(data.canvasType)" class="forge:absolute forge:inset-[16px_30px_25px] forge:z-0 forge:rotate-[-12deg] forge:rounded-[50%] forge:border forge:border-[color-mix(in_srgb,var(--node-accent)_24%,transparent)] forge:[&_span]:absolute forge:[&_span]:size-1 forge:[&_span]:rounded-full forge:[&_span]:bg-[var(--node-accent)] forge:[&_span]:shadow-[0_0_8px_var(--node-accent)] forge:[&_span:nth-child(1)]:left-[21px] forge:[&_span:nth-child(1)]:top-2 forge:[&_span:nth-child(2)]:bottom-7 forge:[&_span:nth-child(2)]:right-0.5 forge:[&_span:nth-child(3)]:bottom-[-2px] forge:[&_span:nth-child(3)]:left-[44%]"><span /><span /><span /></div>
      <span class="forge:pointer-events-none forge:absolute forge:bottom-[7px] forge:right-[7px] forge:z-[3] forge:rounded forge:border forge:border-white/15 forge:bg-[rgba(12,15,13,.76)] forge:px-1.5 forge:py-1 forge:font-mono forge:text-[7px] forge:font-medium forge:uppercase forge:text-[#dce2dd] forge:backdrop-blur-[5px]">{{ data.canvasType === 'reference-image' ? 'Input image' : data.canvasType === 'generated-image' ? 'Generated view' : data.canvasType === 'retopology' ? `${Number(data.config.faceLimit).toLocaleString()} faces` : data.canvasType === 'texture' ? `${data.config.textureQuality}` : data.canvasType === 'rigging' ? 'Rigged' : data.canvasType === 'segments' ? `Segments · ${data.config.detailLevel}` : data.canvasType === 'smart-mesh' ? 'Smart mesh' : '3D result' }}</span>
      <span v-if="isExecuting" class="forge3d-node-output-loading forge:absolute forge:inset-0 forge:z-[5] forge:grid forge:place-content-center forge:justify-items-center forge:gap-[9px] forge:bg-[color-mix(in_srgb,var(--bg-input)_76%,transparent)] forge:text-center forge:text-text-primary forge:backdrop-blur-[3px]" role="status"><span class="forge3d-node-run-indicator" /><strong>{{ runtimeStatus === 'queued' ? 'Queued' : runtimeStatus === 'cancelling' ? 'Stopping' : 'Generating' }}</strong><span v-if="runtimeStatus === 'running'" class="forge3d-node-progress" :class="{ 'forge3d-indeterminate': runProgress === null }" :style="progressStyle"><span /><b>{{ runProgress === null ? 'Working' : `${runProgress}%` }}</b></span></span>
    </button>
    <button v-else-if="data.canvasType === 'export-model' && showResult" type="button" class="forge3d-node-output forge3d-model-output nodrag nopan forge:relative forge:mb-[11px] forge:block forge:h-[146px] forge:w-full forge:overflow-hidden forge:rounded-lg forge:border forge:border-line-subtle forge:bg-[radial-gradient(circle_at_50%_45%,#edf1ed,#dfe5e0_72%)] forge:p-0 forge:text-left forge:transition-[border-color,box-shadow] forge:hover:border-[var(--node-accent)] forge:focus-visible:outline forge:focus-visible:outline-2 forge:focus-visible:outline-offset-2 forge:focus-visible:outline-[var(--node-accent)] forge:dark:bg-[radial-gradient(circle_at_50%_45%,#30352f,#111412_72%)] forge:[&>img]:relative forge:[&>img]:z-[1] forge:[&>img]:size-full forge:[&>img]:object-contain forge:[&>img]:drop-shadow-[0_12px_12px_rgba(0,0,0,.45)] forge:[&>img]:transition-[filter] forge:hover:[&>img]:drop-shadow-[0_16px_16px_rgba(0,0,0,.5)]" :aria-label="`Open ${data.label} in Model Editor`" @click.stop="emit('open-model-editor')">
      <img :src="runtimePreview" :alt="`${data.label} asset`" />
      <div class="forge:absolute forge:inset-[16px_30px_25px] forge:z-0 forge:rotate-[-12deg] forge:rounded-[50%] forge:border forge:border-[color-mix(in_srgb,var(--node-accent)_24%,transparent)] forge:[&_span]:absolute forge:[&_span]:size-1 forge:[&_span]:rounded-full forge:[&_span]:bg-[var(--node-accent)] forge:[&_span]:shadow-[0_0_8px_var(--node-accent)] forge:[&_span:nth-child(1)]:left-[21px] forge:[&_span:nth-child(1)]:top-2 forge:[&_span:nth-child(2)]:bottom-7 forge:[&_span:nth-child(2)]:right-0.5 forge:[&_span:nth-child(3)]:bottom-[-2px] forge:[&_span:nth-child(3)]:left-[44%]"><span /><span /><span /></div>
      <span class="forge:pointer-events-none forge:absolute forge:bottom-[7px] forge:right-[7px] forge:z-[3] forge:rounded forge:border forge:border-white/15 forge:bg-[rgba(12,15,13,.76)] forge:px-1.5 forge:py-1 forge:font-mono forge:text-[7px] forge:font-medium forge:uppercase forge:text-[#dce2dd] forge:backdrop-blur-[5px]">{{ nodeRun?.output?.format || exportFormat }}</span>
      <span v-if="isExecuting" class="forge3d-node-output-loading forge:absolute forge:inset-0 forge:z-[5] forge:grid forge:place-content-center forge:justify-items-center forge:gap-[9px] forge:bg-[color-mix(in_srgb,var(--bg-input)_76%,transparent)] forge:text-center forge:text-text-primary forge:backdrop-blur-[3px]" role="status"><span class="forge3d-node-run-indicator" /><strong>{{ runtimeStatus === 'queued' ? 'Queued' : runtimeStatus === 'cancelling' ? 'Stopping' : 'Exporting' }}</strong><span v-if="runtimeStatus === 'running'" class="forge3d-node-progress" :class="{ 'forge3d-indeterminate': runProgress === null }" :style="progressStyle"><span /><b>{{ runProgress === null ? 'Working' : `${runProgress}%` }}</b></span></span>
    </button>
    <div v-else-if="data.canvasType === 'review'" class="forge:mb-[11px] forge:flex forge:flex-col forge:rounded-lg forge:border forge:border-dashed forge:border-line-strong forge:bg-bg-input forge:p-3 forge:[&>strong]:text-[10px] forge:[&>strong]:font-medium forge:[&>strong]:text-text-secondary forge:[&>small]:mt-1 forge:[&>small]:font-mono forge:[&>small]:text-[8px] forge:[&>small]:text-text-muted" :class="bizClass(runtimeStatus)">
      <strong>{{ data.config.approved ? 'Approved' : runtimeStatus === 'waiting_review' ? 'Awaiting approval' : 'Checkpoint' }}</strong>
      <small>{{ data.config.instruction }}</small>
      <button type="button" class="forge3d-node-output nodrag nopan forge:relative forge:mt-[10px] forge:block forge:h-[146px] forge:w-full forge:overflow-hidden forge:rounded-lg forge:border forge:border-line-subtle forge:bg-[radial-gradient(circle_at_50%_45%,#edf1ed,#dfe5e0_72%)] forge:p-0 forge:text-left forge:transition-[border-color,box-shadow] forge:hover:border-[var(--node-accent)] forge:focus-visible:outline forge:focus-visible:outline-2 forge:focus-visible:outline-offset-2 forge:focus-visible:outline-[var(--node-accent)] forge:dark:bg-[radial-gradient(circle_at_50%_45%,#30352f,#111412_72%)] forge:[&>img]:size-full forge:[&>img]:object-cover" :aria-label="`Preview ${data.label} image`" @click.stop="emit('preview-image', { src: reviewImage, alt: `${data.label} image` })"><img :src="reviewImage" :alt="`${data.label} image`" /></button>
      <button type="button" class="nodrag forge:mt-[10px] forge:h-8 forge:w-full forge:rounded-md forge:border forge:border-[var(--node-accent)] forge:bg-[var(--node-accent)] forge:font-mono forge:text-[8px] forge:font-medium forge:uppercase forge:text-text-inverse forge:transition-[filter,background,color,border-color] forge:hover:brightness-108 forge:[&.forge3d-approved]:border-acid forge:[&.forge3d-approved]:bg-[color-mix(in_srgb,var(--acid)_14%,var(--bg-input))] forge:[&.forge3d-approved]:text-acid" :class="{ 'forge3d-approved': data.config.approved }" @click.stop="toggleApprove">{{ data.config.approved ? '✓ Approved — continue' : 'Approve & continue' }}</button>
    </div>
    <div v-else-if="isExecutableNode && (data.canvasType !== 'text-to-3d' || runtimeStatus !== 'ready')" class="forge3d-node-run-state forge:mb-[11px] forge:grid forge:h-[148px] forge:place-content-center forge:justify-items-center forge:rounded-lg forge:border forge:border-dashed forge:border-line-strong forge:bg-bg-input forge:p-5 forge:text-center forge:[&>strong]:mt-[10px] forge:[&>strong]:text-[10px] forge:[&>strong]:font-medium forge:[&>strong]:text-text-secondary forge:[&>small]:mt-[5px] forge:[&>small]:font-mono forge:[&>small]:text-[8px] forge:[&>small]:text-text-muted" :class="bizClass(runtimeStatus)">
      <span class="forge3d-node-run-indicator" />
      <strong>{{ runStateTitle }}</strong>
      <small>{{ runStateDetail }}</small>
      <div v-if="runtimeStatus === 'running'" class="forge3d-node-progress" :class="{ 'forge3d-indeterminate': runProgress === null }" :style="progressStyle"><span /><b>{{ runProgress === null ? 'Working' : `${runProgress}%` }}</b></div>
    </div>

    <button v-if="data.canvasType === 'reference-image'" type="button" class="nodrag nopan forge:mb-3 forge:grid forge:min-h-16 forge:w-full forge:place-content-center forge:gap-[5px] forge:rounded-lg forge:border forge:border-dashed forge:border-line-strong forge:bg-bg-input forge:p-3 forge:text-center forge:text-text-primary forge:outline-none forge:transition-[border-color,background,box-shadow] forge:hover:border-[var(--node-accent)] forge:hover:bg-[color-mix(in_srgb,var(--node-accent)_8%,var(--bg-input))] forge:hover:shadow-[0_0_0_3px_color-mix(in_srgb,var(--node-accent)_10%,transparent)] forge:[&.forge3d-dragging]:border-[var(--node-accent)] forge:[&.forge3d-dragging]:bg-[color-mix(in_srgb,var(--node-accent)_8%,var(--bg-input))] forge:[&_strong]:font-mono forge:[&_strong]:text-[9px] forge:[&_strong]:font-semibold forge:[&_strong]:uppercase forge:[&_small]:overflow-hidden forge:[&_small]:text-ellipsis forge:[&_small]:whitespace-nowrap forge:[&_small]:font-mono forge:[&_small]:text-[8px] forge:[&_small]:text-text-muted" :class="{ 'forge3d-dragging': imageDragging }" @click.stop="imageInput?.click()" @pointerdown.stop @dragenter.prevent.stop="imageDragging = true" @dragover.prevent.stop="imageDragging = true" @dragleave.prevent.stop="imageDragging = false" @drop.prevent.stop="dropImage">
      <strong>{{ imageDragging ? 'Drop image here' : 'Drop or choose image' }}</strong>
      <small>{{ data.config.reference || 'JPG, PNG or WEBP · max 20 MB' }}</small>
    </button>
    <input v-if="data.canvasType === 'reference-image'" ref="imageInput" class="forge:hidden" type="file" accept="image/jpeg,image/png,image/webp" @change="selectImageFile" />
    <p v-if="imageUploadError" class="forge:-mt-[5px] forge:mb-3 forge:font-mono forge:text-[8px] forge:font-medium forge:text-status-failed" role="alert">{{ imageUploadError }}</p>

    <button v-if="data.canvasType === 'text-to-3d'" type="button" class="nodrag forge:mb-3 forge:flex forge:h-[38px] forge:w-full forge:items-center forge:justify-between forge:border-0 forge:border-t forge:border-line-subtle forge:bg-transparent forge:p-0 forge:font-mono forge:text-[9px] forge:font-medium forge:text-text-muted forge:text-left forge:transition-colors forge:hover:text-text-primary forge:[&_b]:inline-flex forge:[&_b]:text-sm forge:[&_b]:font-normal forge:[&_b]:transition-transform forge:[&_b.forge3d-open]:rotate-180 forge:[&_svg]:size-[1em]" :aria-expanded="parametersOpen" @click.stop="parametersOpen = !parametersOpen"><span>Parameters</span><b :class="{ 'forge3d-open': parametersOpen }"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg></b></button>
    <div v-if="hasEditor" v-show="data.canvasType !== 'text-to-3d' || parametersOpen" class="nodrag forge:mb-3 forge:grid forge:gap-[9px] forge:[&_label]:grid forge:[&_label]:gap-[5px] forge:[&_label]:font-mono forge:[&_label]:text-[8px] forge:[&_label]:font-medium forge:[&_label]:uppercase forge:[&_label]:text-text-muted forge:[&_legend]:font-mono forge:[&_legend]:text-[8px] forge:[&_legend]:font-medium forge:[&_legend]:uppercase forge:[&_legend]:text-text-muted forge:[&_fieldset]:m-0 forge:[&_fieldset]:min-w-0 forge:[&_fieldset]:border-0 forge:[&_fieldset]:p-0 forge:[&_input:not([type=checkbox])]:h-7 forge:[&_input:not([type=checkbox])]:w-full forge:[&_input:not([type=checkbox])]:min-w-0 forge:[&_input:not([type=checkbox])]:rounded-[5px] forge:[&_input:not([type=checkbox])]:border forge:[&_input:not([type=checkbox])]:border-line-strong forge:[&_input:not([type=checkbox])]:bg-bg-input-hover forge:[&_input:not([type=checkbox])]:px-[7px] forge:[&_input:not([type=checkbox])]:font-mono forge:[&_input:not([type=checkbox])]:text-[9px] forge:[&_input:not([type=checkbox])]:text-text-primary forge:[&_textarea]:w-full forge:[&_textarea]:min-w-0 forge:[&_textarea]:resize-y forge:[&_textarea]:rounded-[5px] forge:[&_textarea]:border forge:[&_textarea]:border-line-strong forge:[&_textarea]:bg-bg-input-hover forge:[&_textarea]:p-[7px] forge:[&_textarea]:font-mono forge:[&_textarea]:text-[9px] forge:[&_textarea]:normal-case forge:[&_textarea]:leading-[1.45] forge:[&_textarea]:text-text-primary">
      <template v-for="parameter in renderParameters" :key="parameter.key">
        <button v-if="parameter === firstAdvancedParameter && hasAdvancedParameters" type="button" class="nodrag forge:flex forge:h-7 forge:items-center forge:justify-between forge:border-0 forge:border-t forge:border-line-subtle forge:bg-transparent forge:px-0 forge:font-mono forge:text-[8px] forge:font-medium forge:uppercase forge:text-text-muted forge:transition-colors forge:hover:text-text-primary forge:[&_svg]:size-[1em] forge:[&_svg]:transition-transform" :aria-expanded="advancedParametersOpen" @click.stop="advancedParametersOpen = !advancedParametersOpen"><span>Advanced</span><svg :class="{ 'forge:rotate-180': advancedParametersOpen }" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg></button>
        <template v-if="!parameter.advanced || advancedParametersOpen">
          <label v-if="parameter.control === 'text'">{{ parameter.label }}<input :value="data.config[parameter.key]" :placeholder="parameter.placeholder" @input="update(parameter.key, $event.target.value)" /></label>
          <label v-else-if="parameter.control === 'textarea'">{{ parameter.label }}<textarea :value="data.config[parameter.key]" rows="3" :placeholder="parameter.placeholder" @input="update(parameter.key, $event.target.value)" /></label>
          <label v-else-if="parameter.control === 'select'">{{ parameter.label }}<NodeSelect :model-value="data.config[parameter.key]" :options="parameter.options || []" :dismiss-version="viewportDismissVersion" @update:model-value="update(parameter.key, $event)" /></label>
          <fieldset v-else-if="parameter.control === 'segmented'"><legend class="forge:mb-[5px]">{{ parameter.label }}</legend><div class="forge:grid forge:grid-flow-col forge:auto-cols-fr forge:overflow-hidden forge:rounded-[5px] forge:border forge:border-line-strong forge:[&_button]:h-[26px] forge:[&_button]:border-0 forge:[&_button]:border-r forge:[&_button]:border-line-strong forge:[&_button]:bg-bg-input forge:[&_button]:px-1 forge:[&_button]:font-mono forge:[&_button]:text-[8px] forge:[&_button]:font-medium forge:[&_button]:text-text-secondary forge:[&_button]:transition-colors forge:[&_button:last-child]:border-r-0 forge:[&_button]:hover:bg-[color-mix(in_srgb,var(--node-accent)_10%,var(--bg-input-hover))] forge:[&_button]:hover:text-text-primary forge:[&_button.forge3d-active]:bg-[var(--node-accent)] forge:[&_button.forge3d-active]:text-text-inverse"><button v-for="option in parameter.options" :key="String(option.value)" type="button" :class="{ 'forge3d-active': data.config[parameter.key] === option.value }" @click="update(parameter.key, option.value)">{{ option.label }}</button></div></fieldset>
          <label v-else-if="parameter.control === 'slider'">{{ parameter.label }}<div class="forge:grid forge:grid-cols-[1fr_48px] forge:items-center forge:gap-[7px] forge:[&_output]:text-right forge:[&_output]:font-mono forge:[&_output]:text-[8px] forge:[&_output]:font-medium forge:[&_output]:text-text-secondary"><NodeSlider :model-value="data.config[parameter.key]" :min="range(parameter).min" :max="range(parameter).max" :step="range(parameter).step" @update:model-value="update(parameter.key, $event)" /><output>{{ Number(data.config[parameter.key]).toLocaleString() }}</output></div></label>
          <label v-else-if="parameter.control === 'toggle'" class="forge:!flex forge:items-center forge:justify-between"><span>{{ parameter.label }}</span><input class="forge:peer forge:sr-only" type="checkbox" :checked="Boolean(data.config[parameter.key])" @change="update(parameter.key, $event.target.checked)" /><span class="forge:grid forge:size-[13px] forge:place-items-center forge:rounded-[2px] forge:border forge:border-line-strong forge:bg-bg-input-hover forge:transition-colors forge:peer-checked:border-[var(--node-accent)] forge:peer-checked:bg-[var(--node-accent)] forge:peer-focus-visible:shadow-[0_0_0_2px_color-mix(in_srgb,var(--node-accent)_35%,transparent)] forge:[&_svg]:opacity-0 forge:peer-checked:[&_svg]:opacity-100" aria-hidden="true"><svg class="forge:size-[10px] forge:transition-opacity" viewBox="0 0 12 12" fill="none"><path d="M2.25 6.25 4.75 8.75 9.75 3.25" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg></span></label>
        </template>
      </template>
    </div>

    <div v-if="data.canvasType === 'export-model'" class="nodrag forge:mb-[10px] forge:grid forge:grid-cols-2 forge:gap-1.5 forge:[&.forge3d-single]:grid-cols-1 forge:[&>button]:min-w-0 forge:[&>*]:h-8 forge:[&>*]:w-full forge:[&>*]:rounded-md forge:[&>*]:font-mono forge:[&>*]:text-[8px] forge:[&>*]:font-medium forge:[&>*]:uppercase" :class="{ 'forge3d-single': !exportDownloads.length }">
      <button type="button" class="forge:flex forge:items-center forge:justify-center forge:gap-[7px] forge:border forge:transition-[filter,background,box-shadow]" :class="stopsNodeRun ? 'forge:border-[#e05d5d] forge:bg-[color-mix(in_srgb,#e05d5d_12%,var(--bg-input))] forge:text-[#d94a4a] forge:hover:bg-[color-mix(in_srgb,#e05d5d_22%,var(--bg-input))] forge:hover:shadow-[0_0_0_3px_color-mix(in_srgb,#e05d5d_15%,transparent)]' : 'forge:border-[var(--node-accent)] forge:bg-[var(--node-accent)] forge:text-text-inverse forge:hover:brightness-108 forge:hover:shadow-[0_0_0_3px_color-mix(in_srgb,var(--node-accent)_18%,transparent)]'" :disabled="isActiveEntry && !stopsNodeRun" @click.stop="stopsNodeRun ? emit('stop-run') : emit('run-canvas', props.id)"><span>{{ stopsNodeRun ? 'Stop' : ['queued', 'running'].includes(runtimeStatus) ? 'Preparing…' : 'Export' }}</span><span v-if="!stopsNodeRun && !['queued', 'running'].includes(runtimeStatus)" class="forge:inline-flex forge:items-center forge:gap-[3px] forge:font-mono forge:text-[9px] forge:font-semibold forge:[&_svg]:size-[11px] forge:[&_svg]:fill-current"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13 2-9 12h7l-1 8 9-12h-7Z" /></svg>{{ EXECUTION_CREDIT_COST }}</span></button>
      <a v-for="download in exportDownloads" :key="download.downloadUrl" class="forge:flex forge:items-center forge:justify-center forge:overflow-hidden forge:whitespace-nowrap forge:border forge:border-[color-mix(in_srgb,var(--node-accent)_45%,var(--line-strong))] forge:bg-[color-mix(in_srgb,var(--node-accent)_9%,var(--bg-input))] forge:px-2 forge:text-[var(--node-accent)] forge:no-underline forge:transition-colors forge:hover:bg-[color-mix(in_srgb,var(--node-accent)_16%,var(--bg-input))]" :href="download.downloadUrl" :download="download.filename" @click.stop>Download {{ download.filename }}</a>
    </div>
    <div v-else-if="isExecutableNode" class="nodrag forge:mb-[10px] forge:grid forge:grid-cols-2 forge:gap-1.5 forge:[&>button]:min-w-0 forge:[&>*]:h-8 forge:[&>*]:w-full forge:[&>*]:rounded-md forge:[&>*]:font-mono forge:[&>*]:text-[8px] forge:[&>*]:font-medium forge:[&>*]:uppercase">
      <button type="button" class="forge:flex forge:items-center forge:justify-center forge:gap-[7px] forge:border forge:transition-[filter,background,box-shadow]" :class="stopsNodeRun ? 'forge:border-[#e05d5d] forge:bg-[color-mix(in_srgb,#e05d5d_12%,var(--bg-input))] forge:text-[#d94a4a] forge:hover:bg-[color-mix(in_srgb,#e05d5d_22%,var(--bg-input))] forge:hover:shadow-[0_0_0_3px_color-mix(in_srgb,#e05d5d_15%,transparent)]' : 'forge:border-[var(--node-accent)] forge:bg-[var(--node-accent)] forge:text-text-inverse forge:hover:brightness-108 forge:hover:shadow-[0_0_0_3px_color-mix(in_srgb,var(--node-accent)_18%,transparent)]'" :disabled="isActiveEntry && !stopsNodeRun" @click.stop="stopsNodeRun ? emit('stop-run') : emit('run-canvas', props.id)"><span>{{ stopsNodeRun ? 'Stop' : actionLabel }}</span><span v-if="!stopsNodeRun && !['queued', 'running'].includes(runtimeStatus)" class="forge:inline-flex forge:items-center forge:gap-[3px] forge:font-mono forge:text-[9px] forge:font-semibold forge:[&_svg]:size-[11px] forge:[&_svg]:fill-current"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13 2-9 12h7l-1 8 9-12h-7Z" /></svg>{{ EXECUTION_CREDIT_COST }}</span></button>
      <button type="button" class="forge:border forge:transition-[background,box-shadow]" :class="stopsDownstreamRun ? 'forge:border-[#e05d5d] forge:bg-[color-mix(in_srgb,#e05d5d_12%,var(--bg-input))] forge:text-[#d94a4a] forge:hover:bg-[color-mix(in_srgb,#e05d5d_22%,var(--bg-input))] forge:hover:shadow-[0_0_0_3px_color-mix(in_srgb,#e05d5d_15%,transparent)]' : 'forge:border-[color-mix(in_srgb,var(--node-accent)_45%,var(--line-strong))] forge:bg-[color-mix(in_srgb,var(--node-accent)_9%,var(--bg-input))] forge:text-[var(--node-accent)] forge:hover:bg-[color-mix(in_srgb,var(--node-accent)_16%,var(--bg-input))]'" :disabled="isActiveEntry && !stopsDownstreamRun" @click.stop="stopsDownstreamRun ? emit('stop-run') : emit('run-downstream', props.id)">{{ stopsDownstreamRun ? 'Stop' : 'Run downstream' }}</button>
    </div>
    <section v-if="isExecutableNode" class="nodrag forge:mb-[10px] forge:border-y forge:border-line-subtle">
      <button class="forge:flex forge:h-[31px] forge:w-full forge:items-center forge:justify-between forge:border-0 forge:bg-transparent forge:p-0 forge:font-mono forge:text-[8px] forge:font-medium forge:uppercase forge:text-text-muted forge:transition-colors forge:hover:text-text-primary forge:[&_b]:inline-flex forge:[&_b]:text-xs forge:[&_b]:font-normal forge:[&_b]:transition-transform forge:[&_b.forge3d-open]:rotate-180 forge:[&_svg]:size-[1em]" type="button" :disabled="!nodeRun" :aria-expanded="Boolean(nodeRun && runDetailsOpen)" @click.stop="runDetailsOpen = !runDetailsOpen"><span>Run details</span><b :class="{ 'forge3d-open': nodeRun && runDetailsOpen }"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg></b></button>
      <div v-if="runDetailsOpen" class="forge:max-h-[165px] forge:overflow-auto forge:pb-[9px] forge:text-text-secondary forge:[&>small]:block forge:[&>small]:overflow-hidden forge:[&>small]:text-ellipsis forge:[&>small]:whitespace-nowrap forge:[&>small]:font-mono forge:[&>small]:text-[7px] forge:[&>small]:text-text-muted forge:[&_dl]:my-2 forge:[&_dl]:grid forge:[&_dl]:grid-cols-2 forge:[&_dl]:gap-x-[9px] forge:[&_dl]:gap-y-[5px] forge:[&_dl>div]:min-w-0 forge:[&_dt]:font-mono forge:[&_dt]:text-[7px] forge:[&_dt]:font-medium forge:[&_dt]:uppercase forge:[&_dt]:text-text-muted forge:[&_dd]:mt-0.5 forge:[&_dd]:overflow-hidden forge:[&_dd]:text-ellipsis forge:[&_dd]:whitespace-nowrap forge:[&_dd]:font-mono forge:[&_dd]:text-[8px] forge:[&_dd]:text-text-secondary forge:[&_p]:m-0 forge:[&_p]:text-[8px] forge:[&_p]:leading-[1.4] forge:[&_p]:text-text-muted">
        <small>Run {{ runId || 'previous run' }}</small>
        <dl><div><dt>Node</dt><dd>{{ id }}</dd></div><div><dt>Type</dt><dd>{{ data.canvasType }}</dd></div><div><dt>Status</dt><dd>{{ nodeRun.status }}</dd></div><div><dt>Duration</dt><dd>{{ nodeRun.durationMs === null ? 'Pending' : `${nodeRun.durationMs} ms` }}</dd></div></dl>
        <!-- Present only for a node a real backend produced. -->
        <dl v-if="nodeRun.tripoTaskId"><div><dt>Tripo task</dt><dd>{{ nodeRun.tripoTaskId }}</dd></div><div v-if="nodeRun.creditsConsumed !== null && nodeRun.creditsConsumed !== undefined"><dt>Credits</dt><dd>{{ nodeRun.creditsConsumed }}</dd></div></dl>
        <dl v-if="runConfig.length" class="forge3d-node-run-config"><div v-for="[key, value] in runConfig" :key="key"><dt>{{ key }}</dt><dd>{{ value }}</dd></div></dl>
        <p>{{ nodeRun.error || nodeRun.output?.message || 'Waiting for output' }}</p>
      </div>
    </section>
    <template v-for="(port, index) in visibleOutputPorts" :key="`output-${port.id}`">
      <Handle :id="port.id" class="forge3d-canvas-handle forge3d-output-handle" type="source" :position="Position.Right" :style="{ top: `${28 + (index + 1) * 52}px` }" title="Output" />
    </template>
    <div class="nodrag nopan forge:absolute forge:right-[-43px] forge:top-1/2 forge:z-[4] forge:size-[30px] forge:-translate-y-1/2 forge:[&.forge3d-open_.forge3d-node-next-button]:scale-100 forge:[&.forge3d-open_.forge3d-node-next-button]:opacity-100" :class="{ 'forge3d-open': nextMenuOpen }">
      <button type="button" class="forge3d-node-next-button forge:grid forge:size-[30px] forge:place-items-center forge:rounded-full forge:border-2 forge:border-[var(--node-ring)] forge:bg-[var(--node-accent)] forge:p-0 forge:font-mono forge:text-[21px] forge:font-semibold forge:leading-none forge:text-[#111313] forge:opacity-0 forge:shadow-[0_0_0_3px_color-mix(in_srgb,var(--node-accent)_18%,transparent)] forge:scale-[.72] forge:transition-[opacity,transform,box-shadow] forge:hover:brightness-110 forge:hover:shadow-[0_0_0_5px_color-mix(in_srgb,var(--node-accent)_25%,transparent)] forge:group-hover:scale-100 forge:group-hover:opacity-100" aria-label="Add and connect next node" :aria-expanded="nextMenuOpen" @click.stop="nextMenuOpen = !nextMenuOpen">+</button>
      <div v-if="nextMenuOpen" class="forge:absolute forge:left-[-3px] forge:top-[38px] forge:z-10 forge:grid forge:max-h-[300px] forge:w-[220px] forge:gap-[3px] forge:overflow-y-auto forge:rounded-lg forge:border forge:border-line-strong forge:bg-bg-input forge:p-[5px] forge:shadow-popover forge:animate-[popover-in_.12s_ease-out] forge:[&_button]:grid forge:[&_button]:min-h-[39px] forge:[&_button]:rounded-[5px] forge:[&_button]:border forge:[&_button]:border-transparent forge:[&_button]:bg-transparent forge:[&_button]:px-2 forge:[&_button]:py-1.5 forge:[&_button]:text-left forge:[&_button]:transition-colors forge:[&_button]:hover:border-line-strong forge:[&_button]:hover:bg-bg-input-hover forge:[&_span]:text-[10px] forge:[&_span]:font-medium forge:[&_small]:mt-0.5 forge:[&_small]:font-mono forge:[&_small]:text-[8px] forge:[&_small]:text-text-muted">
        <button v-for="item in nodeCatalog" :key="item.type" type="button" @click.stop="emit('add-next', item.type); nextMenuOpen = false">
          <span>{{ item.label }}</span><small>{{ item.description }}</small>
        </button>
      </div>
    </div>
  </article>
</template>

<style scoped>
:global(:root) { --node-ring: #111313; }
:global(:root[data-theme='light']) { --node-ring: #fff; }
.forge3d-tone-cyan { --node-accent: #68d9d0; }
.forge3d-tone-violet { --node-accent: #a78bfa; }
.forge3d-tone-amber { --node-accent: #f0ba62; }
.forge3d-tone-green { --node-accent: #82d68c; }
.forge3d-tone-rose { --node-accent: #ef8290; }
.forge3d-node-status.queued, .forge3d-node-status.forge3d-running, .forge3d-node-status.cancelling { border-color: var(--status-running); background: var(--status-running); box-shadow: 0 0 0 3px color-mix(in srgb, var(--status-running) 16%, transparent); }
.forge3d-node-status.forge3d-succeeded { border-color: var(--acid); background: var(--acid); box-shadow: 0 0 0 3px color-mix(in srgb, var(--acid) 16%, transparent); }
.forge3d-node-status.forge3d-failed { border-color: var(--status-failed); background: var(--status-failed); box-shadow: 0 0 0 3px color-mix(in srgb, var(--status-failed) 16%, transparent); }
.forge3d-node-status.waiting_review { border-color: #a78bfa; background: #a78bfa; box-shadow: 0 0 0 3px color-mix(in srgb, #a78bfa 16%, transparent); }
.forge3d-node-execution-border { position: absolute; z-index: 8; inset: -7px; width: calc(100% + 14px); height: calc(100% + 14px); overflow: visible; pointer-events: none; }
.forge3d-node-execution-border rect { x: 7px; y: 7px; width: calc(100% - 14px); height: calc(100% - 14px); rx: 10px; fill: none; stroke: var(--node-accent); stroke-linecap: round; vector-effect: non-scaling-stroke; }
.forge3d-node-execution-border-base { stroke: color-mix(in srgb, var(--node-accent) 48%, white 52%) !important; stroke-width: 1.5; opacity: .72; filter: drop-shadow(0 0 3px color-mix(in srgb, var(--node-accent) 30%, transparent)); }
.forge3d-node-execution-border-glow { stroke: white !important; stroke-width: 9; stroke-dasharray: 2.5 197.5; opacity: .55; filter: blur(5px); animation: node-execution-border 2.4s linear infinite; }
.forge3d-node-execution-border-point { stroke: white !important; stroke-width: 4; stroke-dasharray: 1.2 198.8; filter: drop-shadow(0 0 2px white) drop-shadow(0 0 6px white) drop-shadow(0 0 10px var(--node-accent)); animation: node-execution-border 2.4s linear infinite; }
.forge3d-canvas-node.forge3d-is-executing .forge3d-node-status { animation: node-executing-pulse 1s ease-in-out infinite; }
.forge3d-canvas-node.forge3d-is-failed::after { position: absolute; z-index: 3; top: -7px; right: -7px; display: grid; width: 18px; height: 18px; place-items: center; border: 2px solid var(--bg-primary); border-radius: 50%; background: var(--status-failed); color: var(--bg-primary); content: '!'; font: 700 11px/1 var(--font-mono); }
.forge3d-node-output-loading::before { position: absolute; inset: 8px; border: 1px solid color-mix(in srgb, var(--node-accent) 76%, transparent); border-radius: 5px; box-shadow: inset 0 0 24px color-mix(in srgb, var(--node-accent) 14%, transparent); content: ''; animation: node-output-scan 1.4s ease-in-out infinite; }
.forge3d-node-output-loading .forge3d-node-run-indicator, .forge3d-node-output-loading strong, .forge3d-node-output-loading .forge3d-node-progress { position: relative; z-index: 1; }
.forge3d-node-output-loading .forge3d-node-run-indicator { width: 22px; height: 22px; border-width: 3px; border-color: color-mix(in srgb, var(--node-accent) 25%, transparent); border-top-color: var(--node-accent); animation: node-running .8s linear infinite; }
.forge3d-node-output-loading strong { color: var(--node-accent); font: 600 9px var(--font-mono); letter-spacing: .08em; text-transform: uppercase; }
.forge3d-node-progress { display: grid; grid-template-columns: minmax(0, 1fr) 30px; width: 150px; margin-top: 12px; align-items: center; gap: 8px; }
.forge3d-node-progress > span { position: relative; height: 4px; overflow: hidden; border-radius: 999px; background: color-mix(in srgb, var(--node-accent) 18%, var(--line-subtle)); }
.forge3d-node-progress > span::after { position: absolute; inset: 0; width: var(--run-progress); border-radius: inherit; background: var(--node-accent); box-shadow: 0 0 10px color-mix(in srgb, var(--node-accent) 72%, transparent); content: ''; transition: width .35s ease; }
.forge3d-node-progress > b { color: var(--node-accent); font: 600 8px var(--font-mono); text-align: right; }
.forge3d-node-progress.forge3d-indeterminate > span::after { width: 42%; animation: node-progress-indeterminate 1.1s ease-in-out infinite; }
.forge3d-node-output-loading .forge3d-node-progress { margin-top: 1px; }
.forge3d-node-run-indicator { width: 18px; height: 18px; border: 2px solid var(--line-strong); border-top-color: var(--node-accent); border-radius: 50%; }
.forge3d-node-run-state.forge3d-running .forge3d-node-run-indicator { animation: node-running .8s linear infinite; }
.forge3d-node-run-state.forge3d-ready .forge3d-node-run-indicator { border-color: var(--line-strong); }
.forge3d-node-run-state.forge3d-failed .forge3d-node-run-indicator { border-color: var(--status-failed); }
:deep(.vue-flow__handle.forge3d-canvas-handle) { z-index: 6; width: 36px; height: 36px; border: 0; background: transparent; }
:deep(.vue-flow__handle.forge3d-canvas-handle.forge3d-input-handle) { left: 0; right: auto; transform: translateY(-50%); }
:deep(.vue-flow__handle.forge3d-canvas-handle.forge3d-output-handle) { left: auto; right: 0; transform: translateY(-50%); }
:deep(.vue-flow__handle.forge3d-canvas-handle::after) { position: absolute; top: 50%; width: 20px; height: 20px; border: 3px solid var(--node-ring); border-radius: 50%; background: var(--node-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--node-accent) 22%, transparent); content: ''; transition: box-shadow .12s ease; }
:deep(.vue-flow__handle.forge3d-canvas-handle.forge3d-input-handle::after) { left: 0; transform: translate(-50%, -50%); }
:deep(.vue-flow__handle.forge3d-canvas-handle.forge3d-output-handle::after) { right: 0; transform: translate(50%, -50%); }
:deep(.vue-flow__handle.forge3d-canvas-handle:hover::after) { box-shadow: 0 0 0 5px color-mix(in srgb, var(--node-accent) 28%, transparent); }
.forge3d-canvas-node.forge3d-connection-invalid { opacity: .52; filter: saturate(.45) brightness(.78); }
.forge3d-canvas-node.forge3d-connection-invalid :deep(.vue-flow__handle.forge3d-input-handle::after) { border-color: #ef5b5b; background: #ef5b5b; box-shadow: 0 0 0 3px color-mix(in srgb, #ef5b5b 24%, transparent), 0 0 12px color-mix(in srgb, #ef5b5b 55%, transparent); }
.forge3d-canvas-node.forge3d-is-executing :deep(.vue-flow__handle.forge3d-canvas-handle.forge3d-output-handle::before) { position: absolute; top: 50%; right: 0; width: 20px; height: 20px; border-radius: 50%; background: color-mix(in srgb, var(--node-accent) 48%, transparent); content: ''; transform: translate(50%, -50%); animation: node-port-halo 1.5s ease-out infinite; }
.forge3d-canvas-node.forge3d-is-executing :deep(.vue-flow__handle.forge3d-canvas-handle.forge3d-output-handle::after) { animation: node-port-breathe 1.5s ease-in-out infinite; }
@keyframes node-running { to { transform: rotate(360deg); } }
@keyframes node-executing-pulse { 50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--status-running) 4%, transparent); transform: scale(1.1); } }
@keyframes node-execution-border { to { stroke-dashoffset: -200; } }
@keyframes node-output-scan { 50% { inset: 15px; opacity: .45; } }
@keyframes node-progress-indeterminate { from { transform: translateX(-110%); } to { transform: translateX(340%); } }
@keyframes node-port-halo { 0% { opacity: .9; box-shadow: 0 0 10px var(--node-accent); transform: translate(50%, -50%) scale(.75); } 75%, 100% { opacity: 0; box-shadow: 0 0 22px color-mix(in srgb, var(--node-accent) 45%, transparent); transform: translate(50%, -50%) scale(2.25); } }
@keyframes node-port-breathe { 0%, 100% { background: var(--node-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--node-accent) 24%, transparent), 0 0 8px color-mix(in srgb, var(--node-accent) 35%, transparent); } 50% { background: color-mix(in srgb, var(--node-accent) 76%, white); box-shadow: 0 0 0 6px color-mix(in srgb, var(--node-accent) 28%, transparent), 0 0 20px var(--node-accent); } }
@keyframes popover-in { from { opacity: 0; transform: translateY(-3px) scale(.98); } }
@media (prefers-reduced-motion: reduce) { .forge3d-node-run-state.forge3d-running .forge3d-node-run-indicator, .forge3d-node-progress.forge3d-indeterminate > span::after, .forge3d-node-execution-border rect, .forge3d-canvas-node.forge3d-is-executing :deep(.vue-flow__handle.forge3d-canvas-handle.forge3d-output-handle::before), .forge3d-canvas-node.forge3d-is-executing :deep(.vue-flow__handle.forge3d-canvas-handle.forge3d-output-handle::after) { animation: none; } }
</style>
