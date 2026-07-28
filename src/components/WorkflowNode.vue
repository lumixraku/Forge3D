<script setup>
import { computed, nextTick, ref } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import NodeSelect from './NodeSelect.vue'
import NodeSlider from './NodeSlider.vue'

const props = defineProps({ id: { type: String, required: true }, data: { type: Object, required: true }, selected: Boolean, nodeRun: { type: Object, default: null }, runId: { type: String, default: null }, inboundType: { type: String, default: null }, inboundImage: { type: String, default: null }, nodeCatalog: { type: Array, default: () => [] } })
const emit = defineEmits(['update-config', 'update-name', 'open-model-editor', 'preview-image', 'add-next', 'run-workflow', 'run-downstream'])
const nextMenuOpen = ref(false)
const parametersOpen = ref(false)
const runDetailsOpen = ref(false)
const editingName = ref(false)
const draftName = ref('')
const nameInput = ref(null)
const runtimeStatus = computed(() => props.nodeRun?.status || props.data.status)
const executableTypes = ['generate-image', 'generate-multiview-images', 'generate-model', 'smart-mesh', 'multiview-to-3d', 'text-to-3d', 'retopology', 'bake', 'texture', 'rigging', 'split', 'model-preview', 'export-model']
const isExecutableNode = computed(() => executableTypes.includes(props.data.workflowType))
const editorTypes = ['reference-image', 'prompt', 'generate-image', 'generate-multiview-images', 'generate-model', 'smart-mesh', 'multiview-to-3d', 'text-to-3d', 'retopology', 'texture', 'split', 'model-preview', 'export-model']
const hasEditor = computed(() => editorTypes.includes(props.data.workflowType))
const showResult = computed(() => !isExecutableNode.value || runtimeStatus.value === 'succeeded')
const actionLabel = computed(() => {
  if (runtimeStatus.value === 'running') return 'Generating…'
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
const runStateDetail = computed(() => props.nodeRun?.error || props.nodeRun?.output?.message || (runtimeStatus.value === 'running' ? 'Mock execution is in progress' : 'Run this node to create its output'))
const runtimePreview = computed(() => props.nodeRun?.output?.preview || props.data.config.preview)
const reviewImage = computed(() => props.inboundImage || props.nodeRun?.output?.preview || props.data.config.preview)
const runtimePreviews = computed(() => props.nodeRun?.output?.previews || props.data.config.previews || [])
const runtimeViewPreviews = computed(() => props.nodeRun?.output?.viewPreviews || props.data.config.viewPreviews || {})
const viewPorts = ['front', 'back', 'left', 'right']
const densePorts = computed(() => Math.max(props.data.inputPorts?.length || 0, props.data.outputPorts?.length || 0) > 2)
const exportTarget = computed(() => props.inboundType || '3D Model')
const exportFormat = computed(() => props.data.config.modelFormat || 'GLB')
const exportTargets = computed(() => props.data.config.exportTargets || ['dcc'])
const runConfig = computed(() => {
  if (props.data.workflowType === 'export-model') return [['target', exportTarget.value], ['format', exportFormat.value], ['outputs', exportTargets.value.join(', ')]]
  const keys = {
    'generate-image': ['model', 'count', 'aspectRatio'],
    'generate-multiview-images': ['model', 'aspectRatio'],
    'generate-model': ['modelVersion', 'textureMode', 'faceCount'],
    'smart-mesh': ['faceType', 'faceCount', 'textureQuality'],
    'multiview-to-3d': ['modelVersion', 'textureMode', 'faceCount'],
    'text-to-3d': ['modelVersion', 'textureMode', 'faceCount'],
    retopology: ['modelVersion', 'faceType', 'faceLimit'],
    texture: ['textureQuality', 'pbr'],
    split: ['subdivision', 'complete'],
    'model-preview': ['environment', 'autoRotate', 'wireframe'],
  }[props.data.workflowType] || []
  return keys.map((key) => [key, props.data.config[key]])
})

function toggleApprove() {
  const next = !props.data.config.approved
  update('approved', next)
  if (next) emit('run-downstream', props.id)
}

function update(key, value) {
  emit('update-config', { ...props.data.config, [key]: value })
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

function selectGeneratedImage(image, index) {
  update('selectedPreview', image)
  emit('preview-image', { src: image, alt: `Generated concept ${index + 1}` })
}

const countOptions = [1, 2, 4].map((value) => ({ value, label: String(value) }))
</script>

<template>
  <article class="workflow-node" :class="[`tone-${data.tone}`, `is-${runtimeStatus}`, { selected, 'dense-ports': densePorts }]">
    <div class="node-external-title">
      <input v-if="editingName" ref="nameInput" v-model="draftName" class="node-name-input nodrag nopan" aria-label="Node name" @click.stop @dblclick.stop @pointerdown.stop @keydown.enter.prevent="saveName" @keydown.esc.prevent="cancelNameEdit" @blur="saveName" />
      <h3 v-else title="Double-click to rename" @dblclick.stop="startNameEdit">{{ data.label }}</h3>
    </div>
    <template v-for="(port, index) in data.inputPorts" :key="`input-${port.id}`">
      <span class="port-label input-port-label" :style="{ top: `${28 + (index + 1) * 52}px` }">{{ port.label }}</span>
      <Handle :id="port.id" class="workflow-handle input-handle" type="target" :position="Position.Left" :style="{ top: `${28 + (index + 1) * 52}px` }" :title="`Accepts ${port.type}`" />
    </template>
    <header><span class="node-kind">{{ data.kind }}</span><span class="node-status" :class="runtimeStatus">{{ runtimeStatus }}</span></header>
    <div class="node-title">
      <span class="node-icon">{{ data.kind.slice(0, 1) }}</span>
      <div class="node-title-copy">
        <p>{{ data.detail }}</p>
      </div>
    </div>

    <div v-if="data.workflowType === 'generate-image' && showResult" class="node-output image-grid" aria-label="Generated image candidates">
      <button v-for="(image, index) in runtimePreviews" :key="`${image}-${index}`" type="button" class="image-candidate nodrag nopan" :class="{ selected: data.config.selectedPreview === image }" :aria-label="`Select and preview generated concept ${index + 1}`" :aria-pressed="data.config.selectedPreview === image" @click.stop="selectGeneratedImage(image, index)">
        <img :src="image" :alt="`Generated concept ${index + 1}`" />
      </button>
      <span class="output-badge">{{ runtimePreviews.length }} candidates</span>
    </div>
    <div v-else-if="data.workflowType === 'generate-multiview-images' && showResult" class="node-output image-grid" aria-label="Generated multi-view images">
      <button v-for="view in viewPorts" :key="view" type="button" class="image-candidate nodrag nopan" :aria-label="`Preview ${view} view`" @click.stop="emit('preview-image', { src: runtimeViewPreviews[view], alt: `${view} view` })">
        <img :src="runtimeViewPreviews[view]" :alt="`${view} view`" />
      </button>
    </div>
    <button v-else-if="['reference-image', 'generated-image', 'generate-model', 'smart-mesh', 'multiview-to-3d', 'text-to-3d', 'retopology', 'bake', 'texture', 'rigging', 'split', 'model-preview'].includes(data.workflowType) && showResult" type="button" class="node-output nodrag nopan" :class="{ 'model-output': !['reference-image', 'generated-image'].includes(data.workflowType) }" :aria-label="['reference-image', 'generated-image'].includes(data.workflowType) ? `Preview ${data.label} image` : `Open ${data.label} in Model Editor`" @click.stop="['reference-image', 'generated-image'].includes(data.workflowType) ? emit('preview-image', { src: runtimePreview, alt: `${data.label} result` }) : emit('open-model-editor')">
      <img :src="runtimePreview" :alt="`${data.label} result`" />
      <div v-if="!['reference-image', 'generated-image'].includes(data.workflowType)" class="model-orbit"><span /><span /><span /></div>
       <span class="output-badge">{{ data.workflowType === 'reference-image' ? 'Input image' : data.workflowType === 'generated-image' ? 'Generated view' : data.workflowType === 'retopology' ? `${Number(data.config.faceLimit).toLocaleString()} faces` : data.workflowType === 'texture' ? `${data.config.textureQuality}${data.config.pbr ? ' PBR' : ''}` : data.workflowType === 'rigging' ? 'Rigged' : data.workflowType === 'split' ? `Split · ${data.config.subdivision}` : data.workflowType === 'smart-mesh' ? 'Smart mesh' : data.workflowType === 'bake' ? 'Baked' : '3D result' }}</span>
    </button>
    <button v-else-if="data.workflowType === 'export-model' && showResult" type="button" class="node-output model-output nodrag nopan" :aria-label="`Open ${data.label} in Model Editor`" @click.stop="emit('open-model-editor')">
      <img :src="runtimePreview" :alt="`${data.label} asset`" />
      <div class="model-orbit"><span /><span /><span /></div>
       <span class="output-badge">{{ exportTargets.join(' + ') }} · {{ nodeRun?.output?.format || exportFormat }}</span>
    </button>
    <div v-else-if="data.workflowType === 'review'" class="node-review-state" :class="runtimeStatus">
      <strong>{{ data.config.approved ? 'Approved' : runtimeStatus === 'waiting_review' ? 'Awaiting approval' : 'Checkpoint' }}</strong>
      <small>{{ data.config.instruction }}</small>
      <button type="button" class="node-output nodrag nopan" :aria-label="`Preview ${data.label} image`" @click.stop="emit('preview-image', { src: reviewImage, alt: `${data.label} image` })"><img :src="reviewImage" :alt="`${data.label} image`" /></button>
      <button type="button" class="approve-check nodrag" :class="{ approved: data.config.approved }" @click.stop="toggleApprove">{{ data.config.approved ? '✓ Approved — continue' : 'Approve & continue' }}</button>
    </div>
    <div v-else-if="isExecutableNode && (data.workflowType !== 'text-to-3d' || runtimeStatus !== 'ready')" class="node-run-state" :class="runtimeStatus">
      <span class="node-run-indicator" />
      <strong>{{ runStateTitle }}</strong>
      <small>{{ runStateDetail }}</small>
    </div>

    <button v-if="data.workflowType === 'text-to-3d'" type="button" class="node-parameters-toggle nodrag" :aria-expanded="parametersOpen" @click.stop="parametersOpen = !parametersOpen"><span>Parameters</span><b :class="{ open: parametersOpen }"><svg class="chevron-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg></b></button>
    <div v-if="hasEditor" v-show="data.workflowType !== 'text-to-3d' || parametersOpen" class="node-editor nodrag">
      <template v-if="data.workflowType === 'reference-image'">
        <label>Source<NodeSelect :model-value="data.config.sourceType" :options="['Upload', 'Asset Library', 'URL']" @update:model-value="update('sourceType', $event)" /></label>
        <label>Image reference<input :value="data.config.reference" placeholder="Select image or paste URL" @input="update('reference', $event.target.value)" /></label>
        <label>Background<NodeSelect :model-value="data.config.background" :options="['Keep', 'Remove']" @update:model-value="update('background', $event)" /></label>
      </template>

      <template v-else-if="data.workflowType === 'prompt'">
        <label>Prompt<textarea :value="data.config.prompt" rows="4" @input="update('prompt', $event.target.value)" /></label>
        <label>Prompt strength<div class="range-row"><NodeSlider :model-value="data.config.strength" :min="0" :max="100" @update:model-value="update('strength', $event)" /><output>{{ data.config.strength }}%</output></div></label>
      </template>

      <template v-else-if="['generate-image', 'generate-multiview-images'].includes(data.workflowType)">
        <label>Image model<NodeSelect :model-value="data.config.model" :options="['GPT Image 2', 'Flux 1.1 Pro', 'Stable Diffusion 3.5']" @update:model-value="update('model', $event)" /></label>
        <div class="field-grid"><label v-if="data.workflowType === 'generate-image'">Count<NodeSelect :model-value="data.config.count" :options="countOptions" @update:model-value="update('count', $event)" /></label><label>Aspect ratio<NodeSelect :model-value="data.config.aspectRatio" :options="['1:1', '4:3', '3:4', '16:9']" @update:model-value="update('aspectRatio', $event)" /></label></div>
        <label>Reference mode<NodeSelect :model-value="data.config.referenceMode" :options="['Image + Prompt', 'Prompt only', 'Image variation']" @update:model-value="update('referenceMode', $event)" /></label>
      </template>

      <template v-else-if="['generate-model', 'multiview-to-3d', 'text-to-3d'].includes(data.workflowType)">
        <label>Model version<NodeSelect :model-value="data.config.modelVersion" :options="['Smart Mesh', 'v2.5', 'v2.0']" @update:model-value="update('modelVersion', $event)" /></label>
        <fieldset><legend>Texture</legend><div class="segmented"><button v-for="option in ['None', 'HD', 'PBR']" :key="option" type="button" :class="{ active: data.config.textureMode === option }" @click="update('textureMode', option)">{{ option }}</button></div></fieldset>
        <fieldset><legend>Face type</legend><div class="segmented"><button v-for="option in ['Triangle', 'Quad']" :key="option" type="button" :class="{ active: data.config.faceType === option }" @click="update('faceType', option)">{{ option }}</button></div></fieldset>
        <label>Face count<div class="range-row"><NodeSlider :model-value="data.config.faceCount" :min="1000" :max="50000" :step="1000" @update:model-value="update('faceCount', $event)" /><output>{{ Number(data.config.faceCount).toLocaleString() }}</output></div></label>
      </template>

      <template v-else-if="data.workflowType === 'retopology'">
        <label>Model version<NodeSelect :model-value="data.config.modelVersion" :options="['v2.0', 'v1.0']" @update:model-value="update('modelVersion', $event)" /></label>
        <label>Face type<NodeSelect :model-value="data.config.faceType" :options="['Triangle', 'Quad']" @update:model-value="update('faceType', $event)" /></label>
        <label>Face limit<div class="range-row"><NodeSlider :model-value="data.config.faceLimit" :min="500" :max="20000" :step="500" @update:model-value="update('faceLimit', $event)" /><output>{{ Number(data.config.faceLimit).toLocaleString() }}</output></div></label>
        <label class="toggle-row"><span>Bake textures</span><input type="checkbox" :checked="data.config.bakeTextures" @change="update('bakeTextures', $event.target.checked)" /></label>
      </template>

      <template v-else-if="data.workflowType === 'texture'">
        <label>Texture quality<NodeSelect :model-value="data.config.textureQuality" :options="['2K', '4K', '8K']" @update:model-value="update('textureQuality', $event)" /></label>
        <label class="toggle-row"><span>Generate PBR maps</span><input type="checkbox" :checked="data.config.pbr" @change="update('pbr', $event.target.checked)" /></label>
      </template>

      <template v-else-if="data.workflowType === 'smart-mesh'">
        <fieldset><legend>Face type</legend><div class="segmented"><button v-for="option in ['Triangle', 'Quad']" :key="option" type="button" :class="{ active: data.config.faceType === option }" @click="update('faceType', option)">{{ option }}</button></div></fieldset>
        <label>Face count<div class="range-row"><NodeSlider :model-value="data.config.faceCount" :min="1000" :max="50000" :step="1000" @update:model-value="update('faceCount', $event)" /><output>{{ Number(data.config.faceCount).toLocaleString() }}</output></div></label>
        <label>Texture quality<NodeSelect :model-value="data.config.textureQuality" :options="['No texture', '2K', '4K', '8K']" @update:model-value="update('textureQuality', $event)" /></label>
        <label class="toggle-row"><span>Generate PBR maps</span><input type="checkbox" :checked="data.config.pbr" @change="update('pbr', $event.target.checked)" /></label>
      </template>

      <template v-else-if="data.workflowType === 'split'">
        <label>Subdivision<NodeSelect :model-value="data.config.subdivision" :options="['Low', 'Medium', 'High']" @update:model-value="update('subdivision', $event)" /></label>
        <label class="toggle-row"><span>Complete parts</span><input type="checkbox" :checked="data.config.complete" @change="update('complete', $event.target.checked)" /></label>
      </template>

      <template v-else-if="data.workflowType === 'model-preview'">
        <label>Environment<NodeSelect :model-value="data.config.environment" :options="['Studio', 'Outdoor', 'Neutral']" @update:model-value="update('environment', $event)" /></label>
        <label class="toggle-row"><span>Auto rotate</span><input type="checkbox" :checked="data.config.autoRotate" @change="update('autoRotate', $event.target.checked)" /></label>
        <label class="toggle-row"><span>Wireframe</span><input type="checkbox" :checked="data.config.wireframe" @change="update('wireframe', $event.target.checked)" /></label>
      </template>
      <template v-else-if="data.workflowType === 'export-model'">
        <label>Model format<NodeSelect :model-value="data.config.modelFormat" :options="['GLB', 'OBJ', 'FBX', 'STL']" @update:model-value="update('modelFormat', $event)" /></label>
        <fieldset class="export-outputs"><legend>Export outputs</legend><label class="toggle-row"><span>DCC</span><input type="checkbox" :checked="exportTargets.includes('dcc')" @change="update('exportTargets', $event.target.checked ? [...exportTargets, 'dcc'] : exportTargets.filter((target) => target !== 'dcc'))" /></label><label class="toggle-row"><span>Texture</span><input type="checkbox" :checked="exportTargets.includes('texture')" @change="update('exportTargets', $event.target.checked ? [...exportTargets, 'texture'] : exportTargets.filter((target) => target !== 'texture'))" /></label><label class="toggle-row"><span>Send to Bambu</span><input type="checkbox" :checked="exportTargets.includes('bambu')" @change="update('exportTargets', $event.target.checked ? [...exportTargets, 'bambu'] : exportTargets.filter((target) => target !== 'bambu'))" /></label></fieldset>
        <small>{{ inboundType ? `Connected ${exportTarget} input` : 'Connect a 3D model — defaults to 3D Model' }} · demo only.</small>
      </template>
    </div>

    <div v-if="data.workflowType === 'export-model'" class="node-run-actions single nodrag">
      <button type="button" class="generate-node" :disabled="['queued', 'running'].includes(runtimeStatus)" @click.stop="emit('run-workflow', props.id)">{{ ['queued', 'running'].includes(runtimeStatus) ? 'Preparing…' : `Export ${exportTargets.join(' + ')}` }}</button>
    </div>
    <div v-else-if="isExecutableNode" class="node-run-actions nodrag">
      <button type="button" class="generate-node" :disabled="['queued', 'running'].includes(runtimeStatus)" @click.stop="emit('run-workflow', props.id)">{{ actionLabel }}</button>
      <button type="button" class="run-downstream" :disabled="['queued', 'running'].includes(runtimeStatus)" @click.stop="emit('run-downstream', props.id)">Run downstream</button>
    </div>
    <button v-if="['generate-model', 'smart-mesh', 'multiview-to-3d', 'text-to-3d', 'retopology', 'bake', 'texture', 'rigging', 'split', 'model-preview'].includes(data.workflowType) && showResult" type="button" class="open-model-editor nodrag" @click.stop="emit('open-model-editor')"><span>Open in Model Editor</span><b>↗</b></button>
    <section v-if="nodeRun" class="node-run-details nodrag">
      <button type="button" :aria-expanded="runDetailsOpen" @click.stop="runDetailsOpen = !runDetailsOpen"><span>Run details</span><b :class="{ open: runDetailsOpen }"><svg class="chevron-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg></b></button>
      <div v-if="runDetailsOpen" class="node-run-detail-content">
        <small>Run {{ runId || 'previous run' }}</small>
        <dl><div><dt>Node</dt><dd>{{ id }}</dd></div><div><dt>Type</dt><dd>{{ data.workflowType }}</dd></div><div><dt>Status</dt><dd>{{ nodeRun.status }}</dd></div><div><dt>Duration</dt><dd>{{ nodeRun.durationMs === null ? 'Pending' : `${nodeRun.durationMs} ms` }}</dd></div></dl>
        <dl v-if="runConfig.length" class="node-run-config"><div v-for="[key, value] in runConfig" :key="key"><dt>{{ key }}</dt><dd>{{ value }}</dd></div></dl>
        <p>{{ nodeRun.error || nodeRun.output?.message || 'Waiting for output' }}</p>
      </div>
    </section>
    <footer><span>{{ nodeRun?.output?.message || nodeRun?.error || 'Editable parameters' }}</span><span v-if="nodeRun?.durationMs !== null && nodeRun?.durationMs !== undefined">{{ nodeRun.durationMs }} ms</span><span v-else class="node-pulse" /></footer>
    <template v-for="(port, index) in data.outputPorts" :key="`output-${port.id}`">
      <span class="port-label output-port-label" :style="{ top: `${28 + (index + 1) * 52}px` }">{{ port.label }}</span>
      <Handle :id="port.id" class="workflow-handle output-handle" type="source" :position="Position.Right" :style="{ top: `${28 + (index + 1) * 52}px` }" :title="`Outputs ${port.type}`" />
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
