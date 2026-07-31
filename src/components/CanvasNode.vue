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

const props = withDefaults(defineProps<{ id: string; data: CanvasNodeData; selected?: boolean; nodeRun?: NodeRun | null; runId?: string | null; inboundType?: string | null; inboundImage?: string | null; nodeCatalog?: NodeDefinition[]; viewportDismissVersion?: number }>(), { selected: false, nodeRun: null, runId: null, inboundType: null, inboundImage: null, nodeCatalog: () => [], viewportDismissVersion: 0 })
const emit = defineEmits<{
  'update-config': [config: NodeConfig]
  'update-name': [name: string]
  'open-model-editor': []
  'preview-image': [preview: { src: string; alt: string }]
  'add-next': [payload: unknown]
  'run-canvas': []
  'run-downstream': [id: string]
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
const showResult = computed(() => !isExecutableNode.value || runtimeStatus.value === 'succeeded')
// Only a real backend reports progress; a simulated node finishes too fast to
// have any.
const runProgress = computed(() => (typeof props.nodeRun?.progress === 'number' ? props.nodeRun.progress : null))
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
const runtimePreview = computed(() => props.nodeRun?.output?.preview || props.data.config.preview)
// The run downloads the export once as it finishes, which is no help after a
// reload, so a finished export also offers the file directly.
const exportDownloads = computed(() => {
  const output = props.nodeRun?.output
  if (!output) return []
  return (output.outputs || (output.downloadUrl ? [output] : [])).filter((item) => item.downloadUrl)
})
const reviewImage = computed(() => props.inboundImage || props.nodeRun?.output?.preview || props.data.config.preview)
const runtimePreviews = computed(() => props.nodeRun?.output?.previews || props.data.config.previews || [])
const runtimeViewPreviews = computed(() => props.nodeRun?.output?.viewPreviews || props.data.config.viewPreviews || {})
const viewPorts = ['front', 'back', 'left', 'right']
const densePorts = computed(() => Math.max(props.data.inputPorts?.length || 0, props.data.outputPorts?.length || 0) > 2)
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
  <article class="canvas-node" :class="[`tone-${data.tone}`, `is-${runtimeStatus}`, { selected, 'dense-ports': densePorts }]">
    <div class="node-external-title">
      <span class="node-icon">{{ data.kind.slice(0, 1) }}</span>
      <input v-if="editingName" ref="nameInput" v-model="draftName" class="node-name-input nodrag nopan" aria-label="Node name" @click.stop @dblclick.stop @pointerdown.stop @keydown.enter.prevent="saveName" @keydown.esc.prevent="cancelNameEdit" @blur="saveName" />
      <h3 v-else title="Double-click to rename" @dblclick.stop="startNameEdit">{{ data.label }}</h3>
      <span class="node-status" :class="runtimeStatus" role="status" :aria-label="runtimeStatus" :title="runtimeStatus" />
    </div>
    <template v-for="(port, index) in data.inputPorts" :key="`input-${port.id}`">
      <Handle :id="port.id" class="canvas-handle input-handle" type="target" :position="Position.Left" :style="{ top: `${28 + (index + 1) * 52}px` }" :title="`Accepts ${port.type}`" />
    </template>
    <p class="node-detail">{{ data.detail }}</p>

    <div v-if="['generate-image', 'image-decomposition'].includes(data.canvasType) && showResult" class="node-output image-grid" :aria-label="data.canvasType === 'image-decomposition' ? 'Extracted image assets' : 'Generated image candidates'">
      <button v-for="(image, index) in runtimePreviews" :key="`${image}-${index}`" type="button" class="image-candidate nodrag nopan" :class="{ selected: data.config.selectedPreview === image }" :aria-label="`Select and preview generated concept ${index + 1}`" :aria-pressed="data.config.selectedPreview === image" @click.stop="selectGeneratedImage(image, index)">
        <img :src="image" :alt="`Generated concept ${index + 1}`" />
      </button>
      <span class="output-badge">{{ runtimePreviews.length }} {{ data.canvasType === 'image-decomposition' ? 'assets' : 'candidates' }}</span>
    </div>
    <div v-else-if="data.canvasType === 'generate-multiview-images' && showResult" class="node-output image-grid" aria-label="Generated multi-view images">
      <button v-for="view in viewPorts" :key="view" type="button" class="image-candidate nodrag nopan" :aria-label="`Preview ${view} view`" @click.stop="emit('preview-image', { src: runtimeViewPreviews[view], alt: `${view} view` })">
        <img :src="runtimeViewPreviews[view]" :alt="`${view} view`" />
      </button>
    </div>
    <button v-else-if="['reference-image', 'generated-image', 'generate-model', 'smart-mesh', 'multiview-to-3d', 'text-to-3d', 'retopology', 'bake', 'texture', 'rigging', 'segments', 'model-preview'].includes(data.canvasType) && showResult" type="button" class="node-output nodrag nopan" :class="{ 'model-output': !['reference-image', 'generated-image'].includes(data.canvasType) }" :aria-label="['reference-image', 'generated-image'].includes(data.canvasType) ? `Preview ${data.label} image` : `Open ${data.label} in Model Editor`" @click.stop="['reference-image', 'generated-image'].includes(data.canvasType) ? emit('preview-image', { src: runtimePreview, alt: `${data.label} result` }) : emit('open-model-editor')">
      <img :src="runtimePreview" :alt="`${data.label} result`" />
      <div v-if="!['reference-image', 'generated-image', 'image-decomposition'].includes(data.canvasType)" class="model-orbit"><span /><span /><span /></div>
       <span class="output-badge">{{ data.canvasType === 'reference-image' ? 'Input image' : data.canvasType === 'generated-image' ? 'Generated view' : data.canvasType === 'retopology' ? `${Number(data.config.faceLimit).toLocaleString()} faces` : data.canvasType === 'texture' ? `${data.config.textureQuality}` : data.canvasType === 'rigging' ? 'Rigged' : data.canvasType === 'segments' ? `Segments · ${data.config.detailLevel}` : data.canvasType === 'smart-mesh' ? 'Smart mesh' : data.canvasType === 'bake' ? 'Baked' : '3D result' }}</span>
    </button>
    <button v-else-if="data.canvasType === 'export-model' && showResult" type="button" class="node-output model-output nodrag nopan" :aria-label="`Open ${data.label} in Model Editor`" @click.stop="emit('open-model-editor')">
      <img :src="runtimePreview" :alt="`${data.label} asset`" />
      <div class="model-orbit"><span /><span /><span /></div>
        <span class="output-badge">{{ nodeRun?.output?.format || exportFormat }}</span>
    </button>
    <div v-else-if="data.canvasType === 'review'" class="node-review-state" :class="runtimeStatus">
      <strong>{{ data.config.approved ? 'Approved' : runtimeStatus === 'waiting_review' ? 'Awaiting approval' : 'Checkpoint' }}</strong>
      <small>{{ data.config.instruction }}</small>
      <button type="button" class="node-output nodrag nopan" :aria-label="`Preview ${data.label} image`" @click.stop="emit('preview-image', { src: reviewImage, alt: `${data.label} image` })"><img :src="reviewImage" :alt="`${data.label} image`" /></button>
      <button type="button" class="approve-check nodrag" :class="{ approved: data.config.approved }" @click.stop="toggleApprove">{{ data.config.approved ? '✓ Approved — continue' : 'Approve & continue' }}</button>
    </div>
    <div v-else-if="isExecutableNode && (data.canvasType !== 'text-to-3d' || runtimeStatus !== 'ready')" class="node-run-state" :class="runtimeStatus">
      <span class="node-run-indicator" />
      <strong>{{ runStateTitle }}</strong>
      <small>{{ runStateDetail }}</small>
    </div>

    <button v-if="data.canvasType === 'reference-image'" type="button" class="image-dropzone nodrag nopan" :class="{ dragging: imageDragging }" @click.stop="imageInput?.click()" @pointerdown.stop @dragenter.prevent.stop="imageDragging = true" @dragover.prevent.stop="imageDragging = true" @dragleave.prevent.stop="imageDragging = false" @drop.prevent.stop="dropImage">
      <strong>{{ imageDragging ? 'Drop image here' : 'Drop or choose image' }}</strong>
      <small>{{ data.config.reference || 'JPG, PNG or WEBP · max 20 MB' }}</small>
    </button>
    <input v-if="data.canvasType === 'reference-image'" ref="imageInput" class="file-input" type="file" accept="image/jpeg,image/png,image/webp" @change="selectImageFile" />
    <p v-if="imageUploadError" class="image-upload-error" role="alert">{{ imageUploadError }}</p>

    <button v-if="data.canvasType === 'text-to-3d'" type="button" class="node-parameters-toggle nodrag" :aria-expanded="parametersOpen" @click.stop="parametersOpen = !parametersOpen"><span>Parameters</span><b :class="{ open: parametersOpen }"><svg class="chevron-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg></b></button>
    <div v-if="hasEditor" v-show="data.canvasType !== 'text-to-3d' || parametersOpen" class="node-editor nodrag">
      <template v-for="parameter in visibleParameters" :key="parameter.key">
        <label v-if="parameter.control === 'text'">{{ parameter.label }}<input :value="data.config[parameter.key]" :placeholder="parameter.placeholder" @input="update(parameter.key, $event.target.value)" /></label>
        <label v-else-if="parameter.control === 'textarea'">{{ parameter.label }}<textarea :value="data.config[parameter.key]" rows="3" :placeholder="parameter.placeholder" @input="update(parameter.key, $event.target.value)" /></label>
        <label v-else-if="parameter.control === 'select'">{{ parameter.label }}<NodeSelect :model-value="data.config[parameter.key]" :options="parameter.options || []" :dismiss-version="viewportDismissVersion" @update:model-value="update(parameter.key, $event)" /></label>
        <fieldset v-else-if="parameter.control === 'segmented'"><legend>{{ parameter.label }}</legend><div class="segmented"><button v-for="option in parameter.options" :key="String(option.value)" type="button" :class="{ active: data.config[parameter.key] === option.value }" @click="update(parameter.key, option.value)">{{ option.label }}</button></div></fieldset>
        <label v-else-if="parameter.control === 'slider'">{{ parameter.label }}<div class="range-row"><NodeSlider :model-value="data.config[parameter.key]" :min="range(parameter).min" :max="range(parameter).max" :step="range(parameter).step" @update:model-value="update(parameter.key, $event)" /><output>{{ Number(data.config[parameter.key]).toLocaleString() }}</output></div></label>
        <label v-else-if="parameter.control === 'toggle'" class="toggle-row"><span>{{ parameter.label }}</span><input type="checkbox" :checked="Boolean(data.config[parameter.key])" @change="update(parameter.key, $event.target.checked)" /></label>
      </template>
    </div>

    <div v-if="data.canvasType === 'export-model'" class="node-run-actions nodrag" :class="{ single: !exportDownloads.length }">
      <button type="button" class="generate-node" :disabled="['queued', 'running'].includes(runtimeStatus)" @click.stop="emit('run-canvas', props.id)">{{ ['queued', 'running'].includes(runtimeStatus) ? 'Preparing…' : 'Export' }}</button>
      <a v-for="download in exportDownloads" :key="download.downloadUrl" class="run-downstream download-export" :href="download.downloadUrl" :download="download.filename" @click.stop>Download {{ download.filename }}</a>
    </div>
    <div v-else-if="isExecutableNode" class="node-run-actions nodrag">
      <button type="button" class="generate-node" :disabled="['queued', 'running'].includes(runtimeStatus)" @click.stop="emit('run-canvas', props.id)">{{ actionLabel }}</button>
      <button type="button" class="run-downstream" :disabled="['queued', 'running'].includes(runtimeStatus)" @click.stop="emit('run-downstream', props.id)">Run downstream</button>
    </div>
    <button v-if="['generate-model', 'smart-mesh', 'multiview-to-3d', 'text-to-3d', 'retopology', 'bake', 'texture', 'rigging', 'segments', 'model-preview'].includes(data.canvasType) && showResult" type="button" class="open-model-editor nodrag" @click.stop="emit('open-model-editor')"><span>Open in Model Editor</span><b>↗</b></button>
    <section v-if="nodeRun" class="node-run-details nodrag">
      <button type="button" :aria-expanded="runDetailsOpen" @click.stop="runDetailsOpen = !runDetailsOpen"><span>Run details</span><b :class="{ open: runDetailsOpen }"><svg class="chevron-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg></b></button>
      <div v-if="runDetailsOpen" class="node-run-detail-content">
        <small>Run {{ runId || 'previous run' }}</small>
        <dl><div><dt>Node</dt><dd>{{ id }}</dd></div><div><dt>Type</dt><dd>{{ data.canvasType }}</dd></div><div><dt>Status</dt><dd>{{ nodeRun.status }}</dd></div><div><dt>Duration</dt><dd>{{ nodeRun.durationMs === null ? 'Pending' : `${nodeRun.durationMs} ms` }}</dd></div></dl>
        <!-- Present only for a node a real backend produced. -->
        <dl v-if="nodeRun.tripoTaskId"><div><dt>Tripo task</dt><dd>{{ nodeRun.tripoTaskId }}</dd></div><div v-if="nodeRun.creditsConsumed !== null && nodeRun.creditsConsumed !== undefined"><dt>Credits</dt><dd>{{ nodeRun.creditsConsumed }}</dd></div></dl>
        <dl v-if="runConfig.length" class="node-run-config"><div v-for="[key, value] in runConfig" :key="key"><dt>{{ key }}</dt><dd>{{ value }}</dd></div></dl>
        <p>{{ nodeRun.error || nodeRun.output?.message || 'Waiting for output' }}</p>
      </div>
    </section>
    <footer><span>{{ nodeRun?.output?.message || nodeRun?.error || 'Editable parameters' }}</span><span v-if="nodeRun?.durationMs !== null && nodeRun?.durationMs !== undefined">{{ nodeRun.durationMs }} ms</span><span v-else class="node-pulse" /></footer>
    <template v-for="(port, index) in data.outputPorts" :key="`output-${port.id}`">
      <Handle :id="port.id" class="canvas-handle output-handle" type="source" :position="Position.Right" :style="{ top: `${28 + (index + 1) * 52}px` }" :title="`Outputs ${port.type}`" />
    </template>
    <div class="node-next-control nodrag nopan" :class="{ open: nextMenuOpen }">
      <button type="button" class="node-next-button" aria-label="Add and connect next node" :aria-expanded="nextMenuOpen" @click.stop="nextMenuOpen = !nextMenuOpen">+</button>
      <div v-if="nextMenuOpen" class="node-next-menu">
        <button v-for="item in nodeCatalog" :key="item.type" type="button" @click.stop="emit('add-next', item.type); nextMenuOpen = false">
          <span>{{ item.label }}</span><small>{{ item.description }}</small>
        </button>
      </div>
    </div>
  </article>
</template>
