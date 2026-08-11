<script setup lang="ts">
import { computed } from 'vue'
import NodeSelect from './NodeSelect.vue'
import Model3D from './Model3D.vue'
import type { NodeRun } from '../node-runs'

type ModelConfig = Record<string, unknown> & { wireframe?: boolean; autoRotate?: boolean; preview?: string; environment?: string }
interface ModelNode { data: { label: string; canvasType: string; config: ModelConfig } }

const props = defineProps<{ node: ModelNode; nodeRun?: NodeRun | null }>()
const emit = defineEmits<{ back: []; 'update-config': [config: ModelConfig] }>()
const modelUrl = computed(() => {
  const output = props.nodeRun?.output
  if (typeof output?.modelUrl === 'string') return output.modelUrl
  const download = Array.isArray(output?.outputs) ? output.outputs.find((item) => item?.downloadUrl) : null
  return typeof download?.downloadUrl === 'string' ? download.downloadUrl : ''
})
const segmentedUrl = computed(() => modelUrl.value)
const downloadName = computed(() => modelUrl.value.split('/').pop()?.split('?')[0] || 'model.glb')
const previewImage = computed(() => props.nodeRun?.output?.preview || '')
// Names the provider that actually produced the file, so a simulated result is
// not passed off as a real one.
const assetSummary = computed(() => `${props.nodeRun?.tripoTaskId ? 'Tripo' : 'Mock'} result · GLB`)

const editorMode = computed(() => {
  const type = props.node.data.canvasType
  if (type === 'segments') return 'split'
  if (type === 'rigging') return 'rig'
  if (props.node.data.config.wireframe) return 'wireframe'
  return 'model'
})

function update(key: string, value: unknown) {
  emit('update-config', { ...props.node.data.config, [key]: value })
}
</script>

<template>
  <section class="model-editor-workspace">
    <aside class="model-tools" aria-label="Model tools">
      <button class="active" title="Select">↖<span>Select</span></button>
      <button title="Move">✣<span>Move</span></button>
      <button title="Rotate">↻<span>Rotate</span></button>
      <button title="Scale">⌗<span>Scale</span></button>
      <span class="tool-divider" />
      <button title="Sculpt">◒<span>Sculpt</span></button>
      <button title="Paint">◩<span>Paint</span></button>
    </aside>

    <section class="model-stage">
      <header class="model-stage-header">
        <div>
          <button class="back-to-canvas" @click="emit('back')">← Canvas</button>
          <span>MODEL EDITOR</span>
          <strong>{{ node.data.label }}</strong>
        </div>
        <div class="stage-actions">
          <button>Compare</button>
          <button>Snapshot</button>
          <a v-if="modelUrl" class="button primary" :href="modelUrl" :download="downloadName">Download GLB</a>
        </div>
      </header>

      <div class="model-viewport">
        <Model3D v-if="modelUrl" :mode="editorMode" :src="modelUrl" :seg-src="segmentedUrl" :auto-rotate="node.data.config.autoRotate !== false" />
        <div v-else class="model-viewport-empty">This run did not produce a model file.</div>
        <div class="viewport-status"><i /> REALTIME · GLB · {{ editorMode === 'split' ? 'SEGMENTS' : editorMode === 'rig' ? 'RIG' : 'PBR' }}</div>
        <div class="viewport-hint">Drag to orbit · Scroll to zoom · Double-click to focus</div>
        <div class="axis-widget"><b>Z</b><span>X</span><i>Y</i></div>
        <div class="view-cube"><span>FRONT</span></div>
      </div>

      <footer class="model-timeline">
        <div><span>VERSION HISTORY</span><b>Mesh generation → Retopology → Texture pass</b></div>
        <div class="version-track"><i /><i /><i class="active" /></div>
        <span>v03 · Current</span>
      </footer>
    </section>

    <aside class="model-inspector">
      <header><span>INSPECTOR</span><b>Asset properties</b></header>
      <section class="asset-summary">
        <img v-if="previewImage" :src="previewImage" alt="Model preview" />
        <div><strong>{{ node.data.label }}</strong><span>{{ assetSummary }}</span></div>
      </section>
      <section class="inspector-section">
        <div class="section-heading"><span>SCENE</span><b>01 object</b></div>
        <button class="scene-item active"><i /> Shark_Gardener <span>◉</span></button>
      </section>
      <section class="inspector-section inspector-fields">
        <div class="section-heading"><span>VIEWPORT</span><b>Live</b></div>
        <label>Environment<NodeSelect :model-value="node.data.config.environment || 'Studio'" :options="['Studio', 'Outdoor', 'Neutral']" @update:model-value="update('environment', $event)" /></label>
        <label class="toggle-row"><span>Auto rotate</span><input type="checkbox" :checked="node.data.config.autoRotate !== false" @change="update('autoRotate', $event.target.checked)" /></label>
        <label class="toggle-row"><span>Wireframe overlay</span><input type="checkbox" :checked="node.data.config.wireframe" @change="update('wireframe', $event.target.checked)" /></label>
      </section>
      <section class="inspector-section model-stats">
        <div class="section-heading"><span>GEOMETRY</span><b>Optimized</b></div>
        <dl><div><dt>Triangles</dt><dd>38,420</dd></div><div><dt>Vertices</dt><dd>19,776</dd></div><div><dt>Materials</dt><dd>4</dd></div><div><dt>Textures</dt><dd>2K PBR</dd></div></dl>
      </section>
      <div class="inspector-note"><span>CANVAS LINKED</span><p>Viewport changes save back to the selected canvas node automatically.</p></div>
    </aside>
  </section>
</template>
