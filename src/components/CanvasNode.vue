<script setup lang="ts">
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

const props = withDefaults(defineProps<{ id: string; data: CanvasNodeData; selected?: boolean; nodeRun?: NodeRun | null; runId?: string | null; runEntryNodeId?: string | null; runMode?: string | null; runStatus?: string | null; inboundType?: string | null; inboundImage?: string | null; nodeCatalog?: NodeDefinition[]; viewportDismissVersion?: number }>(), { selected: false, nodeRun: null, runId: null, runEntryNodeId: null, runMode: null, runStatus: null, inboundType: null, inboundImage: null, nodeCatalog: () => [], viewportDismissVersion: 0 })
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
const hasEditor = computed(() => visibleParameters.value.length > 0)
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
  <article class="canvas-node group relative w-[260px] rounded-[10px] border border-[var(--node-accent)] bg-[color-mix(in_srgb,var(--bg-input)_97%,transparent)] px-[14px] pb-[11px] pt-[13px] shadow-lg transition-[border-color,box-shadow] hover:border-[color-mix(in_srgb,var(--node-accent)_72%,var(--line-strong))] [&.selected]:shadow-[inset_0_0_0_1px_var(--node-accent),var(--shadow-lg)] [&.is-running]:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--node-accent)_45%,transparent),var(--shadow-lg)] [&.is-executing]:border-transparent [&.is-executing]:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--node-accent)_18%,transparent),0_0_12px_color-mix(in_srgb,var(--node-accent)_18%,transparent),var(--shadow-lg)] [&.is-failed]:border-status-failed [&.is-failed]:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--status-failed)_30%,transparent),var(--shadow-lg),0_0_22px_color-mix(in_srgb,var(--status-failed)_14%,transparent)]" :class="[`tone-${data.tone}`, `is-${runtimeStatus}`, { selected, 'is-executing': isExecuting }]">
    <svg v-if="isExecuting" class="node-execution-border" aria-hidden="true">
      <rect class="node-execution-border-base" pathLength="200" />
      <rect class="node-execution-border-glow" pathLength="200" />
      <rect class="node-execution-border-point" pathLength="200" />
    </svg>
    <div class="absolute bottom-[calc(100%+7px)] left-0 z-[7] inline-flex h-[34px] w-max max-w-full items-center gap-2 rounded-lg border border-[color-mix(in_srgb,var(--node-accent)_48%,var(--line-strong))] bg-[color-mix(in_srgb,var(--node-accent)_16%,var(--bg-input))] px-2 py-[5px] shadow-sm">
      <span class="grid size-5 flex-none place-items-center rounded-[5px] border border-[color-mix(in_srgb,var(--node-accent)_65%,var(--line-strong))] bg-[color-mix(in_srgb,var(--node-accent)_10%,var(--bg-input))] font-mono text-[9px] font-semibold text-[var(--node-accent)] transition-[box-shadow,transform] group-hover:scale-105">{{ data.kind.slice(0, 1) }}</span>
      <input v-if="editingName" ref="nameInput" v-model="draftName" class="nodrag nopan block h-4 w-full min-w-0 max-w-[210px] border-0 bg-transparent p-0 text-[13px] font-semibold leading-4 caret-acid outline-0" aria-label="Node name" @click.stop @dblclick.stop @pointerdown.stop @keydown.enter.prevent="saveName" @keydown.esc.prevent="cancelNameEdit" @blur="saveName" />
      <h3 v-else class="h-4 min-w-0 max-w-[210px] cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-semibold leading-4" title="Double-click to rename" @dblclick.stop="startNameEdit">{{ data.label }}</h3>
      <span class="node-status size-2 flex-none rounded-full border border-[color-mix(in_srgb,var(--text-muted)_72%,transparent)] bg-text-muted shadow-[0_0_0_3px_color-mix(in_srgb,var(--text-muted)_12%,transparent)]" :class="runtimeStatus" role="status" :aria-label="runtimeStatus" :title="runtimeStatus" />
    </div>
    <template v-for="(port, index) in visibleInputPorts" :key="`input-${port.id}`">
      <Handle :id="port.id" class="canvas-handle input-handle" type="target" :position="Position.Left" :style="{ top: `${28 + (index + 1) * 52}px` }" title="Input" />
    </template>
    <p class="mb-3 mt-0 text-[9px] text-text-muted">{{ data.detail }}</p>

    <div v-if="['generate-image', 'image-decomposition'].includes(data.canvasType) && showResult" class="node-output relative mb-[11px] grid h-[146px] w-full grid-cols-2 gap-0.5 overflow-hidden rounded-lg border border-line-subtle bg-[radial-gradient(circle_at_50%_45%,#edf1ed,#dfe5e0_72%)] p-0.5 text-left dark:bg-[radial-gradient(circle_at_50%_45%,#30352f,#111412_72%)]" :aria-label="data.canvasType === 'image-decomposition' ? 'Extracted image assets' : 'Generated image candidates'">
      <button v-for="(image, index) in runtimePreviews" :key="`${image}-${index}`" type="button" class="nodrag nopan relative min-h-0 min-w-0 overflow-hidden rounded-[3px] border-0 bg-transparent p-0 transition-transform after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--node-accent)] [&.selected]:after:border-2 [&.selected]:after:border-[var(--node-accent)] [&_img]:block [&_img]:size-full [&_img]:object-cover [&_img]:transition-[filter] hover:[&_img]:brightness-108" :class="{ selected: data.config.selectedPreview === image }" :aria-label="`Select and preview generated concept ${index + 1}`" :aria-pressed="data.config.selectedPreview === image" @click.stop="selectGeneratedImage(image, index)">
        <img :src="image" :alt="`Generated concept ${index + 1}`" />
      </button>
      <span class="pointer-events-none absolute bottom-[7px] right-[7px] z-[3] rounded border border-white/15 bg-[rgba(12,15,13,.76)] px-1.5 py-1 font-mono text-[7px] font-medium uppercase text-[#dce2dd] backdrop-blur-[5px]">{{ runtimePreviews.length }} {{ data.canvasType === 'image-decomposition' ? 'assets' : 'candidates' }}</span>
      <div v-if="isExecuting" class="node-output-loading absolute inset-0 z-[5] grid place-content-center justify-items-center gap-[9px] bg-[color-mix(in_srgb,var(--bg-input)_76%,transparent)] text-center text-text-primary backdrop-blur-[3px]" role="status"><span class="node-run-indicator" /><strong>{{ runtimeStatus === 'queued' ? 'Queued' : runtimeStatus === 'cancelling' ? 'Stopping' : 'Generating' }}</strong><div v-if="runtimeStatus === 'running'" class="node-progress" :class="{ indeterminate: runProgress === null }" :style="progressStyle"><span /><b>{{ runProgress === null ? 'Working' : `${runProgress}%` }}</b></div></div>
    </div>
    <div v-else-if="data.canvasType === 'generate-multiview-images' && showResult" class="node-output relative mb-[11px] grid h-[146px] w-full grid-cols-2 gap-0.5 overflow-hidden rounded-lg border border-line-subtle bg-[radial-gradient(circle_at_50%_45%,#edf1ed,#dfe5e0_72%)] p-0.5 text-left dark:bg-[radial-gradient(circle_at_50%_45%,#30352f,#111412_72%)]" aria-label="Generated multi-view images">
      <button v-for="view in viewPorts" :key="view" type="button" class="nodrag nopan relative min-h-0 min-w-0 overflow-hidden rounded-[3px] border-0 bg-transparent p-0 transition-transform focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--node-accent)] [&_img]:block [&_img]:size-full [&_img]:object-cover [&_img]:transition-[filter] hover:[&_img]:brightness-108" :aria-label="`Preview ${view} view`" @click.stop="emit('preview-image', { src: runtimeViewPreviews[view], alt: `${view} view` })">
        <img :src="runtimeViewPreviews[view]" :alt="`${view} view`" />
      </button>
      <div v-if="isExecuting" class="node-output-loading absolute inset-0 z-[5] grid place-content-center justify-items-center gap-[9px] bg-[color-mix(in_srgb,var(--bg-input)_76%,transparent)] text-center text-text-primary backdrop-blur-[3px]" role="status"><span class="node-run-indicator" /><strong>{{ runtimeStatus === 'queued' ? 'Queued' : runtimeStatus === 'cancelling' ? 'Stopping' : 'Generating' }}</strong><div v-if="runtimeStatus === 'running'" class="node-progress" :class="{ indeterminate: runProgress === null }" :style="progressStyle"><span /><b>{{ runProgress === null ? 'Working' : `${runProgress}%` }}</b></div></div>
    </div>
    <button v-else-if="['reference-image', 'generated-image', 'generate-model', 'smart-mesh', 'multiview-to-3d', 'text-to-3d', 'retopology', 'texture', 'rigging', 'segments', 'model-preview'].includes(data.canvasType) && showResult" type="button" class="node-output nodrag nopan relative mb-[11px] block h-[146px] w-full overflow-hidden rounded-lg border border-line-subtle bg-[radial-gradient(circle_at_50%_45%,#edf1ed,#dfe5e0_72%)] p-0 text-left transition-[border-color,box-shadow] hover:border-[var(--node-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--node-accent)] dark:bg-[radial-gradient(circle_at_50%_45%,#30352f,#111412_72%)] [&>img]:size-full [&>img]:object-cover [&.model-output>img]:relative [&.model-output>img]:z-[1] [&.model-output>img]:object-contain [&.model-output>img]:drop-shadow-[0_12px_12px_rgba(0,0,0,.45)] [&.model-output>img]:transition-[filter] [&.model-output:hover>img]:drop-shadow-[0_16px_16px_rgba(0,0,0,.5)]" :class="{ 'model-output': !['reference-image', 'generated-image'].includes(data.canvasType) }" :aria-label="['reference-image', 'generated-image'].includes(data.canvasType) ? `Preview ${data.label} image` : `Open ${data.label} in Model Editor`" @click.stop="['reference-image', 'generated-image'].includes(data.canvasType) ? emit('preview-image', { src: runtimePreview, alt: `${data.label} result` }) : emit('open-model-editor')">
      <img :src="runtimePreview" :alt="`${data.label} result`" />
      <div v-if="!['reference-image', 'generated-image', 'image-decomposition'].includes(data.canvasType)" class="absolute inset-[16px_30px_25px] z-0 rotate-[-12deg] rounded-[50%] border border-[color-mix(in_srgb,var(--node-accent)_24%,transparent)] [&_span]:absolute [&_span]:size-1 [&_span]:rounded-full [&_span]:bg-[var(--node-accent)] [&_span]:shadow-[0_0_8px_var(--node-accent)] [&_span:nth-child(1)]:left-[21px] [&_span:nth-child(1)]:top-2 [&_span:nth-child(2)]:bottom-7 [&_span:nth-child(2)]:right-0.5 [&_span:nth-child(3)]:bottom-[-2px] [&_span:nth-child(3)]:left-[44%]"><span /><span /><span /></div>
      <span class="pointer-events-none absolute bottom-[7px] right-[7px] z-[3] rounded border border-white/15 bg-[rgba(12,15,13,.76)] px-1.5 py-1 font-mono text-[7px] font-medium uppercase text-[#dce2dd] backdrop-blur-[5px]">{{ data.canvasType === 'reference-image' ? 'Input image' : data.canvasType === 'generated-image' ? 'Generated view' : data.canvasType === 'retopology' ? `${Number(data.config.faceLimit).toLocaleString()} faces` : data.canvasType === 'texture' ? `${data.config.textureQuality}` : data.canvasType === 'rigging' ? 'Rigged' : data.canvasType === 'segments' ? `Segments · ${data.config.detailLevel}` : data.canvasType === 'smart-mesh' ? 'Smart mesh' : '3D result' }}</span>
      <span v-if="isExecuting" class="node-output-loading absolute inset-0 z-[5] grid place-content-center justify-items-center gap-[9px] bg-[color-mix(in_srgb,var(--bg-input)_76%,transparent)] text-center text-text-primary backdrop-blur-[3px]" role="status"><span class="node-run-indicator" /><strong>{{ runtimeStatus === 'queued' ? 'Queued' : runtimeStatus === 'cancelling' ? 'Stopping' : 'Generating' }}</strong><span v-if="runtimeStatus === 'running'" class="node-progress" :class="{ indeterminate: runProgress === null }" :style="progressStyle"><span /><b>{{ runProgress === null ? 'Working' : `${runProgress}%` }}</b></span></span>
    </button>
    <button v-else-if="data.canvasType === 'export-model' && showResult" type="button" class="node-output model-output nodrag nopan relative mb-[11px] block h-[146px] w-full overflow-hidden rounded-lg border border-line-subtle bg-[radial-gradient(circle_at_50%_45%,#edf1ed,#dfe5e0_72%)] p-0 text-left transition-[border-color,box-shadow] hover:border-[var(--node-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--node-accent)] dark:bg-[radial-gradient(circle_at_50%_45%,#30352f,#111412_72%)] [&>img]:relative [&>img]:z-[1] [&>img]:size-full [&>img]:object-contain [&>img]:drop-shadow-[0_12px_12px_rgba(0,0,0,.45)] [&>img]:transition-[filter] hover:[&>img]:drop-shadow-[0_16px_16px_rgba(0,0,0,.5)]" :aria-label="`Open ${data.label} in Model Editor`" @click.stop="emit('open-model-editor')">
      <img :src="runtimePreview" :alt="`${data.label} asset`" />
      <div class="absolute inset-[16px_30px_25px] z-0 rotate-[-12deg] rounded-[50%] border border-[color-mix(in_srgb,var(--node-accent)_24%,transparent)] [&_span]:absolute [&_span]:size-1 [&_span]:rounded-full [&_span]:bg-[var(--node-accent)] [&_span]:shadow-[0_0_8px_var(--node-accent)] [&_span:nth-child(1)]:left-[21px] [&_span:nth-child(1)]:top-2 [&_span:nth-child(2)]:bottom-7 [&_span:nth-child(2)]:right-0.5 [&_span:nth-child(3)]:bottom-[-2px] [&_span:nth-child(3)]:left-[44%]"><span /><span /><span /></div>
      <span class="pointer-events-none absolute bottom-[7px] right-[7px] z-[3] rounded border border-white/15 bg-[rgba(12,15,13,.76)] px-1.5 py-1 font-mono text-[7px] font-medium uppercase text-[#dce2dd] backdrop-blur-[5px]">{{ nodeRun?.output?.format || exportFormat }}</span>
      <span v-if="isExecuting" class="node-output-loading absolute inset-0 z-[5] grid place-content-center justify-items-center gap-[9px] bg-[color-mix(in_srgb,var(--bg-input)_76%,transparent)] text-center text-text-primary backdrop-blur-[3px]" role="status"><span class="node-run-indicator" /><strong>{{ runtimeStatus === 'queued' ? 'Queued' : runtimeStatus === 'cancelling' ? 'Stopping' : 'Exporting' }}</strong><span v-if="runtimeStatus === 'running'" class="node-progress" :class="{ indeterminate: runProgress === null }" :style="progressStyle"><span /><b>{{ runProgress === null ? 'Working' : `${runProgress}%` }}</b></span></span>
    </button>
    <div v-else-if="data.canvasType === 'review'" class="mb-[11px] flex flex-col rounded-lg border border-dashed border-line-strong bg-bg-input p-3 [&>strong]:text-[10px] [&>strong]:font-medium [&>strong]:text-text-secondary [&>small]:mt-1 [&>small]:font-mono [&>small]:text-[8px] [&>small]:text-text-muted" :class="runtimeStatus">
      <strong>{{ data.config.approved ? 'Approved' : runtimeStatus === 'waiting_review' ? 'Awaiting approval' : 'Checkpoint' }}</strong>
      <small>{{ data.config.instruction }}</small>
      <button type="button" class="node-output nodrag nopan relative mt-[10px] block h-[146px] w-full overflow-hidden rounded-lg border border-line-subtle bg-[radial-gradient(circle_at_50%_45%,#edf1ed,#dfe5e0_72%)] p-0 text-left transition-[border-color,box-shadow] hover:border-[var(--node-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--node-accent)] dark:bg-[radial-gradient(circle_at_50%_45%,#30352f,#111412_72%)] [&>img]:size-full [&>img]:object-cover" :aria-label="`Preview ${data.label} image`" @click.stop="emit('preview-image', { src: reviewImage, alt: `${data.label} image` })"><img :src="reviewImage" :alt="`${data.label} image`" /></button>
      <button type="button" class="nodrag mt-[10px] h-8 w-full rounded-md border border-[var(--node-accent)] bg-[var(--node-accent)] font-mono text-[8px] font-medium uppercase text-text-inverse transition-[filter,background,color,border-color] hover:brightness-108 [&.approved]:border-acid [&.approved]:bg-[color-mix(in_srgb,var(--acid)_14%,var(--bg-input))] [&.approved]:text-acid" :class="{ approved: data.config.approved }" @click.stop="toggleApprove">{{ data.config.approved ? '✓ Approved — continue' : 'Approve & continue' }}</button>
    </div>
    <div v-else-if="isExecutableNode && (data.canvasType !== 'text-to-3d' || runtimeStatus !== 'ready')" class="node-run-state mb-[11px] grid h-[148px] place-content-center justify-items-center rounded-lg border border-dashed border-line-strong bg-bg-input p-5 text-center [&>strong]:mt-[10px] [&>strong]:text-[10px] [&>strong]:font-medium [&>strong]:text-text-secondary [&>small]:mt-[5px] [&>small]:font-mono [&>small]:text-[8px] [&>small]:text-text-muted" :class="runtimeStatus">
      <span class="node-run-indicator" />
      <strong>{{ runStateTitle }}</strong>
      <small>{{ runStateDetail }}</small>
      <div v-if="runtimeStatus === 'running'" class="node-progress" :class="{ indeterminate: runProgress === null }" :style="progressStyle"><span /><b>{{ runProgress === null ? 'Working' : `${runProgress}%` }}</b></div>
    </div>

    <button v-if="data.canvasType === 'reference-image'" type="button" class="nodrag nopan mb-3 grid min-h-16 w-full place-content-center gap-[5px] rounded-lg border border-dashed border-line-strong bg-bg-input p-3 text-center text-text-primary outline-none transition-[border-color,background,box-shadow] hover:border-[var(--node-accent)] hover:bg-[color-mix(in_srgb,var(--node-accent)_8%,var(--bg-input))] hover:shadow-[0_0_0_3px_color-mix(in_srgb,var(--node-accent)_10%,transparent)] [&.dragging]:border-[var(--node-accent)] [&.dragging]:bg-[color-mix(in_srgb,var(--node-accent)_8%,var(--bg-input))] [&_strong]:font-mono [&_strong]:text-[9px] [&_strong]:font-semibold [&_strong]:uppercase [&_small]:overflow-hidden [&_small]:text-ellipsis [&_small]:whitespace-nowrap [&_small]:font-mono [&_small]:text-[8px] [&_small]:text-text-muted" :class="{ dragging: imageDragging }" @click.stop="imageInput?.click()" @pointerdown.stop @dragenter.prevent.stop="imageDragging = true" @dragover.prevent.stop="imageDragging = true" @dragleave.prevent.stop="imageDragging = false" @drop.prevent.stop="dropImage">
      <strong>{{ imageDragging ? 'Drop image here' : 'Drop or choose image' }}</strong>
      <small>{{ data.config.reference || 'JPG, PNG or WEBP · max 20 MB' }}</small>
    </button>
    <input v-if="data.canvasType === 'reference-image'" ref="imageInput" class="hidden" type="file" accept="image/jpeg,image/png,image/webp" @change="selectImageFile" />
    <p v-if="imageUploadError" class="-mt-[5px] mb-3 font-mono text-[8px] font-medium text-status-failed" role="alert">{{ imageUploadError }}</p>

    <button v-if="data.canvasType === 'text-to-3d'" type="button" class="nodrag mb-3 flex h-[38px] w-full items-center justify-between border-0 border-t border-line-subtle bg-transparent p-0 font-mono text-[9px] font-medium text-text-muted text-left transition-colors hover:text-text-primary [&_b]:inline-flex [&_b]:text-sm [&_b]:font-normal [&_b]:transition-transform [&_b.open]:rotate-180 [&_svg]:size-[1em]" :aria-expanded="parametersOpen" @click.stop="parametersOpen = !parametersOpen"><span>Parameters</span><b :class="{ open: parametersOpen }"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg></b></button>
    <div v-if="hasEditor" v-show="data.canvasType !== 'text-to-3d' || parametersOpen" class="nodrag mb-3 grid gap-[9px] rounded-lg border border-line-subtle bg-bg-input p-[10px] transition-colors focus-within:border-line-strong [&_label]:grid [&_label]:gap-[5px] [&_label]:font-mono [&_label]:text-[8px] [&_label]:font-medium [&_label]:uppercase [&_label]:text-text-muted [&_legend]:font-mono [&_legend]:text-[8px] [&_legend]:font-medium [&_legend]:uppercase [&_legend]:text-text-muted [&_fieldset]:m-0 [&_fieldset]:min-w-0 [&_fieldset]:border-0 [&_fieldset]:p-0 [&_input:not([type=checkbox])]:h-7 [&_input:not([type=checkbox])]:w-full [&_input:not([type=checkbox])]:min-w-0 [&_input:not([type=checkbox])]:rounded-[5px] [&_input:not([type=checkbox])]:border [&_input:not([type=checkbox])]:border-line-strong [&_input:not([type=checkbox])]:bg-bg-input-hover [&_input:not([type=checkbox])]:px-[7px] [&_input:not([type=checkbox])]:font-mono [&_input:not([type=checkbox])]:text-[9px] [&_input:not([type=checkbox])]:text-text-primary [&_textarea]:w-full [&_textarea]:min-w-0 [&_textarea]:resize-y [&_textarea]:rounded-[5px] [&_textarea]:border [&_textarea]:border-line-strong [&_textarea]:bg-bg-input-hover [&_textarea]:p-[7px] [&_textarea]:font-mono [&_textarea]:text-[9px] [&_textarea]:normal-case [&_textarea]:leading-[1.45] [&_textarea]:text-text-primary">
      <template v-for="parameter in visibleParameters" :key="parameter.key">
        <label v-if="parameter.control === 'text'">{{ parameter.label }}<input :value="data.config[parameter.key]" :placeholder="parameter.placeholder" @input="update(parameter.key, $event.target.value)" /></label>
        <label v-else-if="parameter.control === 'textarea'">{{ parameter.label }}<textarea :value="data.config[parameter.key]" rows="3" :placeholder="parameter.placeholder" @input="update(parameter.key, $event.target.value)" /></label>
        <label v-else-if="parameter.control === 'select'">{{ parameter.label }}<NodeSelect :model-value="data.config[parameter.key]" :options="parameter.options || []" :dismiss-version="viewportDismissVersion" @update:model-value="update(parameter.key, $event)" /></label>
        <fieldset v-else-if="parameter.control === 'segmented'"><legend class="mb-[5px]">{{ parameter.label }}</legend><div class="grid grid-flow-col auto-cols-fr overflow-hidden rounded-[5px] border border-line-strong [&_button]:h-[26px] [&_button]:border-0 [&_button]:border-r [&_button]:border-line-strong [&_button]:bg-bg-input [&_button]:px-1 [&_button]:font-mono [&_button]:text-[8px] [&_button]:font-medium [&_button]:text-text-secondary [&_button]:transition-colors [&_button:last-child]:border-r-0 [&_button]:hover:bg-[color-mix(in_srgb,var(--node-accent)_10%,var(--bg-input-hover))] [&_button]:hover:text-text-primary [&_button.active]:bg-[var(--node-accent)] [&_button.active]:text-text-inverse"><button v-for="option in parameter.options" :key="String(option.value)" type="button" :class="{ active: data.config[parameter.key] === option.value }" @click="update(parameter.key, option.value)">{{ option.label }}</button></div></fieldset>
        <label v-else-if="parameter.control === 'slider'">{{ parameter.label }}<div class="grid grid-cols-[1fr_48px] items-center gap-[7px] [&_output]:text-right [&_output]:font-mono [&_output]:text-[8px] [&_output]:font-medium [&_output]:text-text-secondary"><NodeSlider :model-value="data.config[parameter.key]" :min="range(parameter).min" :max="range(parameter).max" :step="range(parameter).step" @update:model-value="update(parameter.key, $event)" /><output>{{ Number(data.config[parameter.key]).toLocaleString() }}</output></div></label>
        <label v-else-if="parameter.control === 'toggle'" class="!flex items-center justify-between [&_input]:accent-[var(--node-accent)]"><span>{{ parameter.label }}</span><input type="checkbox" :checked="Boolean(data.config[parameter.key])" @change="update(parameter.key, $event.target.checked)" /></label>
      </template>
    </div>

    <div v-if="data.canvasType === 'export-model'" class="nodrag mb-[10px] grid grid-cols-2 gap-1.5 [&.single]:grid-cols-1 [&>button]:min-w-0 [&>*]:h-8 [&>*]:w-full [&>*]:rounded-md [&>*]:font-mono [&>*]:text-[8px] [&>*]:font-medium [&>*]:uppercase" :class="{ single: !exportDownloads.length }">
      <button type="button" class="flex items-center justify-center gap-[7px] border transition-[filter,background,box-shadow]" :class="stopsNodeRun ? 'border-[#e05d5d] bg-[color-mix(in_srgb,#e05d5d_12%,var(--bg-input))] text-[#d94a4a] hover:bg-[color-mix(in_srgb,#e05d5d_22%,var(--bg-input))] hover:shadow-[0_0_0_3px_color-mix(in_srgb,#e05d5d_15%,transparent)]' : 'border-[var(--node-accent)] bg-[var(--node-accent)] text-text-inverse hover:brightness-108 hover:shadow-[0_0_0_3px_color-mix(in_srgb,var(--node-accent)_18%,transparent)]'" :disabled="isActiveEntry && !stopsNodeRun" @click.stop="stopsNodeRun ? emit('stop-run') : emit('run-canvas', props.id)"><span>{{ stopsNodeRun ? 'Stop' : ['queued', 'running'].includes(runtimeStatus) ? 'Preparing…' : 'Export' }}</span><span v-if="!stopsNodeRun && !['queued', 'running'].includes(runtimeStatus)" class="inline-flex items-center gap-[3px] font-mono text-[9px] font-semibold [&_svg]:size-[11px] [&_svg]:fill-current"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13 2-9 12h7l-1 8 9-12h-7Z" /></svg>{{ EXECUTION_CREDIT_COST }}</span></button>
      <a v-for="download in exportDownloads" :key="download.downloadUrl" class="flex items-center justify-center overflow-hidden whitespace-nowrap border border-[color-mix(in_srgb,var(--node-accent)_45%,var(--line-strong))] bg-[color-mix(in_srgb,var(--node-accent)_9%,var(--bg-input))] px-2 text-[var(--node-accent)] no-underline transition-colors hover:bg-[color-mix(in_srgb,var(--node-accent)_16%,var(--bg-input))]" :href="download.downloadUrl" :download="download.filename" @click.stop>Download {{ download.filename }}</a>
    </div>
    <div v-else-if="isExecutableNode" class="nodrag mb-[10px] grid grid-cols-2 gap-1.5 [&>button]:min-w-0 [&>*]:h-8 [&>*]:w-full [&>*]:rounded-md [&>*]:font-mono [&>*]:text-[8px] [&>*]:font-medium [&>*]:uppercase">
      <button type="button" class="flex items-center justify-center gap-[7px] border transition-[filter,background,box-shadow]" :class="stopsNodeRun ? 'border-[#e05d5d] bg-[color-mix(in_srgb,#e05d5d_12%,var(--bg-input))] text-[#d94a4a] hover:bg-[color-mix(in_srgb,#e05d5d_22%,var(--bg-input))] hover:shadow-[0_0_0_3px_color-mix(in_srgb,#e05d5d_15%,transparent)]' : 'border-[var(--node-accent)] bg-[var(--node-accent)] text-text-inverse hover:brightness-108 hover:shadow-[0_0_0_3px_color-mix(in_srgb,var(--node-accent)_18%,transparent)]'" :disabled="isActiveEntry && !stopsNodeRun" @click.stop="stopsNodeRun ? emit('stop-run') : emit('run-canvas', props.id)"><span>{{ stopsNodeRun ? 'Stop' : actionLabel }}</span><span v-if="!stopsNodeRun && !['queued', 'running'].includes(runtimeStatus)" class="inline-flex items-center gap-[3px] font-mono text-[9px] font-semibold [&_svg]:size-[11px] [&_svg]:fill-current"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13 2-9 12h7l-1 8 9-12h-7Z" /></svg>{{ EXECUTION_CREDIT_COST }}</span></button>
      <button type="button" class="border transition-[background,box-shadow]" :class="stopsDownstreamRun ? 'border-[#e05d5d] bg-[color-mix(in_srgb,#e05d5d_12%,var(--bg-input))] text-[#d94a4a] hover:bg-[color-mix(in_srgb,#e05d5d_22%,var(--bg-input))] hover:shadow-[0_0_0_3px_color-mix(in_srgb,#e05d5d_15%,transparent)]' : 'border-[color-mix(in_srgb,var(--node-accent)_45%,var(--line-strong))] bg-[color-mix(in_srgb,var(--node-accent)_9%,var(--bg-input))] text-[var(--node-accent)] hover:bg-[color-mix(in_srgb,var(--node-accent)_16%,var(--bg-input))]'" :disabled="isActiveEntry && !stopsDownstreamRun" @click.stop="stopsDownstreamRun ? emit('stop-run') : emit('run-downstream', props.id)">{{ stopsDownstreamRun ? 'Stop' : 'Run downstream' }}</button>
    </div>
    <section v-if="isExecutableNode" class="nodrag mb-[10px] border-y border-line-subtle">
      <button class="flex h-[31px] w-full items-center justify-between border-0 bg-transparent p-0 font-mono text-[8px] font-medium uppercase text-text-muted transition-colors hover:text-text-primary [&_b]:inline-flex [&_b]:text-xs [&_b]:font-normal [&_b]:transition-transform [&_b.open]:rotate-180 [&_svg]:size-[1em]" type="button" :disabled="!nodeRun" :aria-expanded="Boolean(nodeRun && runDetailsOpen)" @click.stop="runDetailsOpen = !runDetailsOpen"><span>Run details</span><b :class="{ open: nodeRun && runDetailsOpen }"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg></b></button>
      <div v-if="runDetailsOpen" class="max-h-[165px] overflow-auto pb-[9px] text-text-secondary [&>small]:block [&>small]:overflow-hidden [&>small]:text-ellipsis [&>small]:whitespace-nowrap [&>small]:font-mono [&>small]:text-[7px] [&>small]:text-text-muted [&_dl]:my-2 [&_dl]:grid [&_dl]:grid-cols-2 [&_dl]:gap-x-[9px] [&_dl]:gap-y-[5px] [&_dl>div]:min-w-0 [&_dt]:font-mono [&_dt]:text-[7px] [&_dt]:font-medium [&_dt]:uppercase [&_dt]:text-text-muted [&_dd]:mt-0.5 [&_dd]:overflow-hidden [&_dd]:text-ellipsis [&_dd]:whitespace-nowrap [&_dd]:font-mono [&_dd]:text-[8px] [&_dd]:text-text-secondary [&_p]:m-0 [&_p]:text-[8px] [&_p]:leading-[1.4] [&_p]:text-text-muted">
        <small>Run {{ runId || 'previous run' }}</small>
        <dl><div><dt>Node</dt><dd>{{ id }}</dd></div><div><dt>Type</dt><dd>{{ data.canvasType }}</dd></div><div><dt>Status</dt><dd>{{ nodeRun.status }}</dd></div><div><dt>Duration</dt><dd>{{ nodeRun.durationMs === null ? 'Pending' : `${nodeRun.durationMs} ms` }}</dd></div></dl>
        <!-- Present only for a node a real backend produced. -->
        <dl v-if="nodeRun.tripoTaskId"><div><dt>Tripo task</dt><dd>{{ nodeRun.tripoTaskId }}</dd></div><div v-if="nodeRun.creditsConsumed !== null && nodeRun.creditsConsumed !== undefined"><dt>Credits</dt><dd>{{ nodeRun.creditsConsumed }}</dd></div></dl>
        <dl v-if="runConfig.length" class="node-run-config"><div v-for="[key, value] in runConfig" :key="key"><dt>{{ key }}</dt><dd>{{ value }}</dd></div></dl>
        <p>{{ nodeRun.error || nodeRun.output?.message || 'Waiting for output' }}</p>
      </div>
    </section>
    <template v-for="(port, index) in visibleOutputPorts" :key="`output-${port.id}`">
      <Handle :id="port.id" class="canvas-handle output-handle" type="source" :position="Position.Right" :style="{ top: `${28 + (index + 1) * 52}px` }" title="Output" />
    </template>
    <div class="nodrag nopan absolute right-[-43px] top-1/2 z-[4] size-[30px] -translate-y-1/2 [&.open_.node-next-button]:scale-100 [&.open_.node-next-button]:opacity-100" :class="{ open: nextMenuOpen }">
      <button type="button" class="node-next-button grid size-[30px] place-items-center rounded-full border-2 border-[var(--node-ring)] bg-[var(--node-accent)] p-0 font-mono text-[21px] font-semibold leading-none text-[#111313] opacity-0 shadow-[0_0_0_3px_color-mix(in_srgb,var(--node-accent)_18%,transparent)] scale-[.72] transition-[opacity,transform,box-shadow] hover:brightness-110 hover:shadow-[0_0_0_5px_color-mix(in_srgb,var(--node-accent)_25%,transparent)] group-hover:scale-100 group-hover:opacity-100" aria-label="Add and connect next node" :aria-expanded="nextMenuOpen" @click.stop="nextMenuOpen = !nextMenuOpen">+</button>
      <div v-if="nextMenuOpen" class="absolute left-[-3px] top-[38px] z-10 grid max-h-[300px] w-[220px] gap-[3px] overflow-y-auto rounded-lg border border-line-strong bg-bg-input p-[5px] shadow-popover animate-[popover-in_.12s_ease-out] [&_button]:grid [&_button]:min-h-[39px] [&_button]:rounded-[5px] [&_button]:border [&_button]:border-transparent [&_button]:bg-transparent [&_button]:px-2 [&_button]:py-1.5 [&_button]:text-left [&_button]:transition-colors [&_button]:hover:border-line-strong [&_button]:hover:bg-bg-input-hover [&_span]:text-[10px] [&_span]:font-medium [&_small]:mt-0.5 [&_small]:font-mono [&_small]:text-[8px] [&_small]:text-text-muted">
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
.tone-cyan { --node-accent: #68d9d0; }
.tone-violet { --node-accent: #a78bfa; }
.tone-amber { --node-accent: #f0ba62; }
.tone-green { --node-accent: #82d68c; }
.tone-rose { --node-accent: #ef8290; }
.node-status.queued, .node-status.running, .node-status.cancelling { border-color: var(--status-running); background: var(--status-running); box-shadow: 0 0 0 3px color-mix(in srgb, var(--status-running) 16%, transparent); }
.node-status.succeeded { border-color: var(--acid); background: var(--acid); box-shadow: 0 0 0 3px color-mix(in srgb, var(--acid) 16%, transparent); }
.node-status.failed { border-color: var(--status-failed); background: var(--status-failed); box-shadow: 0 0 0 3px color-mix(in srgb, var(--status-failed) 16%, transparent); }
.node-status.waiting_review { border-color: #a78bfa; background: #a78bfa; box-shadow: 0 0 0 3px color-mix(in srgb, #a78bfa 16%, transparent); }
.node-execution-border { position: absolute; z-index: 8; inset: -7px; width: calc(100% + 14px); height: calc(100% + 14px); overflow: visible; pointer-events: none; }
.node-execution-border rect { x: 7px; y: 7px; width: calc(100% - 14px); height: calc(100% - 14px); rx: 10px; fill: none; stroke: var(--node-accent); stroke-linecap: round; vector-effect: non-scaling-stroke; }
.node-execution-border-base { stroke: color-mix(in srgb, var(--node-accent) 48%, white 52%) !important; stroke-width: 1.5; opacity: .72; filter: drop-shadow(0 0 3px color-mix(in srgb, var(--node-accent) 30%, transparent)); }
.node-execution-border-glow { stroke: white !important; stroke-width: 9; stroke-dasharray: 2.5 197.5; opacity: .55; filter: blur(5px); animation: node-execution-border 2.4s linear infinite; }
.node-execution-border-point { stroke: white !important; stroke-width: 4; stroke-dasharray: 1.2 198.8; filter: drop-shadow(0 0 2px white) drop-shadow(0 0 6px white) drop-shadow(0 0 10px var(--node-accent)); animation: node-execution-border 2.4s linear infinite; }
.canvas-node.is-executing .node-status { animation: node-executing-pulse 1s ease-in-out infinite; }
.canvas-node.is-failed::after { position: absolute; z-index: 3; top: -7px; right: -7px; display: grid; width: 18px; height: 18px; place-items: center; border: 2px solid var(--bg-primary); border-radius: 50%; background: var(--status-failed); color: var(--bg-primary); content: '!'; font: 700 11px/1 var(--font-mono); }
.node-output-loading::before { position: absolute; inset: 8px; border: 1px solid color-mix(in srgb, var(--node-accent) 76%, transparent); border-radius: 5px; box-shadow: inset 0 0 24px color-mix(in srgb, var(--node-accent) 14%, transparent); content: ''; animation: node-output-scan 1.4s ease-in-out infinite; }
.node-output-loading .node-run-indicator, .node-output-loading strong, .node-output-loading .node-progress { position: relative; z-index: 1; }
.node-output-loading .node-run-indicator { width: 22px; height: 22px; border-width: 3px; border-color: color-mix(in srgb, var(--node-accent) 25%, transparent); border-top-color: var(--node-accent); animation: node-running .8s linear infinite; }
.node-output-loading strong { color: var(--node-accent); font: 600 9px var(--font-mono); letter-spacing: .08em; text-transform: uppercase; }
.node-progress { display: grid; grid-template-columns: minmax(0, 1fr) 30px; width: 150px; margin-top: 12px; align-items: center; gap: 8px; }
.node-progress > span { position: relative; height: 4px; overflow: hidden; border-radius: 999px; background: color-mix(in srgb, var(--node-accent) 18%, var(--line-subtle)); }
.node-progress > span::after { position: absolute; inset: 0; width: var(--run-progress); border-radius: inherit; background: var(--node-accent); box-shadow: 0 0 10px color-mix(in srgb, var(--node-accent) 72%, transparent); content: ''; transition: width .35s ease; }
.node-progress > b { color: var(--node-accent); font: 600 8px var(--font-mono); text-align: right; }
.node-progress.indeterminate > span::after { width: 42%; animation: node-progress-indeterminate 1.1s ease-in-out infinite; }
.node-output-loading .node-progress { margin-top: 1px; }
.node-run-indicator { width: 18px; height: 18px; border: 2px solid var(--line-strong); border-top-color: var(--node-accent); border-radius: 50%; }
.node-run-state.running .node-run-indicator { animation: node-running .8s linear infinite; }
.node-run-state.ready .node-run-indicator { border-color: var(--line-strong); }
.node-run-state.failed .node-run-indicator { border-color: var(--status-failed); }
:deep(.vue-flow__handle.canvas-handle) { z-index: 6; width: 36px; height: 36px; border: 0; background: transparent; }
:deep(.vue-flow__handle.canvas-handle.input-handle) { left: 0; right: auto; transform: translateY(-50%); }
:deep(.vue-flow__handle.canvas-handle.output-handle) { left: auto; right: 0; transform: translateY(-50%); }
:deep(.vue-flow__handle.canvas-handle::after) { position: absolute; top: 50%; width: 20px; height: 20px; border: 3px solid var(--node-ring); border-radius: 50%; background: var(--node-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--node-accent) 22%, transparent); content: ''; transition: box-shadow .12s ease; }
:deep(.vue-flow__handle.canvas-handle.input-handle::after) { left: 0; transform: translate(-50%, -50%); }
:deep(.vue-flow__handle.canvas-handle.output-handle::after) { right: 0; transform: translate(50%, -50%); }
:deep(.vue-flow__handle.canvas-handle:hover::after) { box-shadow: 0 0 0 5px color-mix(in srgb, var(--node-accent) 28%, transparent); }
.canvas-node.is-executing :deep(.vue-flow__handle.canvas-handle.output-handle::before) { position: absolute; top: 50%; right: 0; width: 20px; height: 20px; border-radius: 50%; background: color-mix(in srgb, var(--node-accent) 48%, transparent); content: ''; transform: translate(50%, -50%); animation: node-port-halo 1.5s ease-out infinite; }
.canvas-node.is-executing :deep(.vue-flow__handle.canvas-handle.output-handle::after) { animation: node-port-breathe 1.5s ease-in-out infinite; }
@keyframes node-running { to { transform: rotate(360deg); } }
@keyframes node-executing-pulse { 50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--status-running) 4%, transparent); transform: scale(1.1); } }
@keyframes node-execution-border { to { stroke-dashoffset: -200; } }
@keyframes node-output-scan { 50% { inset: 15px; opacity: .45; } }
@keyframes node-progress-indeterminate { from { transform: translateX(-110%); } to { transform: translateX(340%); } }
@keyframes node-port-halo { 0% { opacity: .9; box-shadow: 0 0 10px var(--node-accent); transform: translate(50%, -50%) scale(.75); } 75%, 100% { opacity: 0; box-shadow: 0 0 22px color-mix(in srgb, var(--node-accent) 45%, transparent); transform: translate(50%, -50%) scale(2.25); } }
@keyframes node-port-breathe { 0%, 100% { background: var(--node-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--node-accent) 24%, transparent), 0 0 8px color-mix(in srgb, var(--node-accent) 35%, transparent); } 50% { background: color-mix(in srgb, var(--node-accent) 76%, white); box-shadow: 0 0 0 6px color-mix(in srgb, var(--node-accent) 28%, transparent), 0 0 20px var(--node-accent); } }
@keyframes popover-in { from { opacity: 0; transform: translateY(-3px) scale(.98); } }
@media (prefers-reduced-motion: reduce) { .node-run-state.running .node-run-indicator, .node-progress.indeterminate > span::after, .node-execution-border rect, .canvas-node.is-executing :deep(.vue-flow__handle.canvas-handle.output-handle::before), .canvas-node.is-executing :deep(.vue-flow__handle.canvas-handle.output-handle::after) { animation: none; } }
</style>
