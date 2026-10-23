<script setup lang="ts">
import { computed, ref } from 'vue'
import NodeSelect from './NodeSelect.vue'
import Model3D from './Model3D.vue'
import { meshyAssetHref } from '../meshy-asset'
import type { NodeRun } from '../node-runs'

type ModelConfig = Record<string, unknown> & { wireframe?: boolean; autoRotate?: boolean; preview?: string; environment?: string }
type ModelUploadAssets = Record<string, unknown> & { assetType?: string; modelUrl?: string }
type ModelGeneratedAssets = Record<string, unknown> & { modelUrl?: string; preview?: string; resultOf?: { runId?: string; sourceId?: string; sourceType?: string } }
interface ModelNode { data: { label: string; canvasType: string; config: ModelConfig; uploadAssets?: ModelUploadAssets; generatedAssets?: ModelGeneratedAssets } }

const props = defineProps<{ node: ModelNode; nodeRun?: NodeRun | null }>()
const emit = defineEmits<{ back: []; 'update-config': [config: ModelConfig] }>()
const modelUrl = computed(() => {
  const output = props.nodeRun?.output
  if (typeof output?.modelUrl === 'string') return output.modelUrl
  const download = Array.isArray(output?.outputs) ? output.outputs.find((item) => item?.downloadUrl) : null
  if (typeof download?.downloadUrl === 'string') return download.downloadUrl
  // A model result node carries its file in generatedAssets; it was never run.
  const generated = props.node.data.generatedAssets
  if (typeof generated?.modelUrl === 'string') return generated.modelUrl
  const uploads = props.node.data.uploadAssets
  return props.node.data.canvasType === 'reference-image' && uploads?.assetType === 'model' && typeof uploads.modelUrl === 'string' ? uploads.modelUrl : ''
})
const previewModelUrl = computed(() => meshyAssetHref(props.node.data.generatedAssets, 'model', modelUrl.value) || modelUrl.value)
const downloadName = computed(() => modelUrl.value.split('/').pop()?.split('?')[0] || 'model.glb')
const downloadUrl = computed(() => previewModelUrl.value)
const canPreviewModel = computed(() => /\.(glb|gltf)(?:$|[?#])/i.test(modelUrl.value))
const previewImage = computed(() => {
  const generated = props.node.data.generatedAssets
  const raw = props.nodeRun?.output?.preview || generated?.preview || ''
  return meshyAssetHref(generated, 'preview', raw) || raw
})
// Names the provider that actually produced the file, so a simulated result is
// not passed off as a real one.
const assetSummary = computed(() => {
  if (props.node.data.canvasType === 'reference-image') return 'Uploaded asset'
  if (props.node.data.canvasType === 'generated-model') return 'Generated model · GLB'
  const backend = props.nodeRun?.tripoTaskId ? 'Tripo' : props.nodeRun?.meshyTaskId ? 'Meshy' : 'Mock'
  return `${backend} result · GLB`
})

const viewer = ref<{ snapshot: () => string } | null>(null)

function snapshot() {
  const url = viewer.value?.snapshot()
  if (!url) return
  const name = props.node.data.label.replace(/[^\w.-]+/g, '-').replace(/^-|-$/g, '') || 'model'
  const link = document.createElement('a')
  link.href = url
  link.download = `${name}.png`
  link.click()
}

const editorMode = computed(() => {
  const type = props.node.data.generatedAssets?.resultOf?.sourceType || props.node.data.canvasType
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
  <section class="forge:grid forge:min-h-0 forge:min-w-0 forge:grid-cols-[minmax(0,1fr)_300px] forge:bg-bg-primary forge:transition-colors forge:duration-200 forge:max-[1200px]:grid-cols-[minmax(0,1fr)_260px] forge:max-[760px]:grid-cols-1 forge:max-[760px]:grid-rows-[650px_auto]">
    <section class="forge:grid forge:min-h-0 forge:min-w-0 forge:grid-rows-[61px_minmax(0,1fr)_54px] forge:max-[760px]:grid-rows-[60px_540px_50px]">
      <header class="forge:flex forge:items-center forge:justify-between forge:gap-5 forge:border-b forge:border-line forge:bg-bg-tertiary forge:px-4 forge:transition-colors forge:duration-200 forge:max-[760px]:px-[10px]">
        <div class="forge:grid forge:grid-cols-[auto_auto] forge:items-center forge:gap-x-3 forge:gap-y-[3px]">
          <button class="forge:[--btn-shadow:var(--acid-shadow)] forge:row-span-2 forge:min-h-8 forge:rounded-md forge:border forge:border-acid-line forge:bg-bg-input forge:px-[10px] forge:font-mono forge:text-[11px] forge:font-medium forge:text-acid-dim forge:transition-colors forge:hover:bg-[color-mix(in_srgb,var(--acid)_10%,var(--bg-input))] forge:hover:text-acid" @click="emit('back')">← Canvas</button>
          <span class="forge:text-[12px] forge:font-semibold forge:text-text-muted forge:max-[760px]:hidden">Model editor</span>
          <strong class="forge:text-xs forge:font-medium forge:max-[760px]:hidden">{{ node.data.label }}</strong>
        </div>
        <div class="forge:flex forge:gap-1.5 forge:[&>*]:inline-flex forge:[&>*]:min-h-[30px] forge:[&>*]:items-center forge:[&>*]:rounded-md forge:[&>*]:border forge:[&>*]:border-line-strong forge:[&>*]:bg-bg-input forge:[&>*]:px-[10px] forge:[&>*]:font-mono forge:[&>*]:text-[10px] forge:[&>*]:font-medium forge:[&>*]:text-text-muted forge:[&>*]:no-underline forge:[&>*]:transition-colors forge:[&>*]:hover:bg-[color-mix(in_srgb,var(--acid)_10%,var(--bg-input))] forge:[&>*]:hover:text-acid forge:[&_.forge3d-primary]:border-acid forge:[&_.forge3d-primary]:bg-acid forge:[&_.forge3d-primary]:text-text-inverse forge:[&_.forge3d-primary]:hover:brightness-108 forge:max-[760px]:[&>*:not(.forge3d-primary)]:hidden">
          <button type="button" :disabled="!canPreviewModel" @click="snapshot">Snapshot</button>
          <a v-if="modelUrl" class="forge3d-primary" :href="downloadUrl" :download="downloadName">Download model</a>
        </div>
      </header>

      <div class="forge:relative forge:min-h-0 forge:min-w-0 forge:overflow-hidden forge:bg-[#202322] forge:bg-[linear-gradient(rgba(255,255,255,.018)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.018)_1px,transparent_1px),radial-gradient(circle_at_50%_45%,rgba(108,122,109,.18),transparent_52%)] forge:bg-[size:32px_32px,32px_32px,auto] forge:light:bg-[linear-gradient(rgba(28,40,31,.035)_1px,transparent_1px),linear-gradient(90deg,rgba(28,40,31,.035)_1px,transparent_1px),radial-gradient(circle_at_50%_45%,rgba(196,207,198,.2),transparent_52%)] forge:after:pointer-events-none forge:after:absolute forge:after:bottom-[15%] forge:after:left-0 forge:after:right-0 forge:after:h-px forge:after:bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--acid)_20%,transparent),transparent)]">
        <Model3D v-if="canPreviewModel" ref="viewer" :mode="editorMode" :src="previewModelUrl" :seg-src="previewModelUrl" :auto-rotate="node.data.config.autoRotate !== false" />
        <div v-else class="forge:absolute forge:inset-0 forge:grid forge:place-items-center forge:px-8 forge:text-center forge:font-mono forge:text-[11px] forge:font-medium forge:text-text-muted">{{ modelUrl ? 'This model format is available for download but cannot be previewed here.' : 'This run did not produce a model file.' }}</div>
        <div class="forge:absolute forge:bottom-[14px] forge:left-4 forge:z-[2] forge:flex forge:items-center forge:gap-[7px] forge:font-mono forge:text-[10px] forge:font-medium forge:text-text-muted forge:pointer-events-none"><i class="forge:size-1.5 forge:rounded-full forge:bg-acid forge:shadow-[0_0_8px_color-mix(in_srgb,var(--acid)_70%,transparent)]" /> REALTIME · GLB · {{ editorMode === 'split' ? 'SEGMENTS' : editorMode === 'rig' ? 'RIG' : 'PBR' }}</div>
        <div class="forge:absolute forge:bottom-[14px] forge:right-4 forge:z-[2] forge:font-mono forge:text-[10px] forge:font-medium forge:text-text-muted forge:pointer-events-none forge:max-[760px]:hidden">Drag to orbit · Scroll to zoom · Double-click to focus</div>
        <div class="forge:absolute forge:left-5 forge:top-5 forge:z-[2] forge:size-[54px] forge:font-mono forge:text-[10px] forge:font-semibold forge:text-[#d2d7d2] forge:pointer-events-none forge:before:absolute forge:before:bottom-3 forge:before:left-[25px] forge:before:h-8 forge:before:w-px forge:before:origin-bottom forge:before:bg-[#e47676] forge:after:absolute forge:after:bottom-3 forge:after:left-[25px] forge:after:h-8 forge:after:w-px forge:after:origin-bottom forge:after:rotate-90 forge:after:bg-[#70afef]"><b class="forge:absolute forge:left-[22px] forge:top-0 forge:text-[#e47676]">Z</b><span class="forge:absolute forge:bottom-2 forge:right-0 forge:text-[#70afef]">X</span><i class="forge:absolute forge:bottom-0 forge:left-[3px] forge:not-italic forge:text-[#7aca8a]">Y</i></div>
        <div class="forge:absolute forge:right-5 forge:top-[18px] forge:z-[2] forge:grid forge:size-12 forge:place-items-center forge:border forge:border-white/15 forge:bg-[rgba(24,29,26,.7)] forge:font-mono forge:text-[10px] forge:font-medium forge:text-[#a7aea8] forge:rotate-[7deg] forge:skew-y-[-5deg] forge:pointer-events-none"><span>FRONT</span></div>
      </div>

      <footer class="forge:grid forge:grid-cols-[260px_minmax(120px,1fr)_auto] forge:items-center forge:gap-4 forge:border-t forge:border-line forge:bg-bg-tertiary forge:px-4 forge:transition-colors forge:duration-200 forge:max-[1200px]:grid-cols-[minmax(150px,1fr)_1fr] forge:max-[760px]:grid-cols-1">
        <div><span class="forge:text-[12px] forge:font-semibold forge:text-text-muted">Version history</span><b class="forge:mt-1 forge:block forge:truncate forge:font-mono forge:text-[10px] forge:font-medium forge:text-text-secondary">Mesh generation → Retopology → Texture pass</b></div>
        <div class="forge:relative forge:flex forge:h-px forge:items-center forge:justify-between forge:bg-line-strong forge:max-[760px]:hidden"><i class="forge:z-[1] forge:size-[7px] forge:rounded-full forge:border forge:border-text-muted forge:bg-bg-input" /><i class="forge:z-[1] forge:size-[7px] forge:rounded-full forge:border forge:border-text-muted forge:bg-bg-input" /><i class="forge:z-[1] forge:size-2.5 forge:rounded-full forge:border forge:border-acid forge:bg-acid forge:shadow-[0_0_9px_color-mix(in_srgb,var(--acid)_50%,transparent)]" /></div>
        <span class="forge:text-[12px] forge:font-semibold forge:text-text-muted forge:max-[1200px]:hidden">v03 · Current</span>
      </footer>
    </section>

    <aside class="forge:relative forge:overflow-y-auto forge:border-l forge:border-line forge:bg-bg-secondary forge:transition-colors forge:duration-200">
      <header class="forge:h-[61px] forge:border-b forge:border-line forge:px-4 forge:py-[15px]"><span class="forge:text-[12px] forge:font-semibold forge:text-text-muted">Inspector</span><b class="forge:mt-1 forge:block forge:text-[11px]">Asset properties</b></header>
      <section class="forge:m-3 forge:flex forge:items-center forge:gap-[11px] forge:rounded-lg forge:border forge:border-line-subtle forge:bg-bg-input forge:p-[9px] forge:transition-[border-color,box-shadow] forge:hover:border-acid forge:hover:shadow-sm">
        <img v-if="previewImage" class="forge:size-[52px] forge:rounded-[5px] forge:bg-[#262b28] forge:object-cover" :src="previewImage" alt="Model preview" />
        <div><strong class="forge:block forge:text-[11px]">{{ node.data.label }}</strong><span class="forge:mt-1 forge:block forge:font-mono forge:text-[10px] forge:font-medium forge:text-text-muted">{{ assetSummary }}</span></div>
      </section>
      <section class="forge:border-t forge:border-line forge:px-[14px] forge:py-[13px]">
        <div class="forge:mb-[10px] forge:flex forge:justify-between"><span class="forge:text-[12px] forge:font-semibold forge:text-text-muted">Scene</span><b class="forge:font-mono forge:text-[10px] forge:font-medium forge:text-text-muted">01 object</b></div>
        <button class="forge:flex forge:h-[31px] forge:w-full forge:items-center forge:gap-2 forge:rounded-[5px] forge:border forge:border-line-strong forge:bg-bg-input forge:px-2 forge:text-left forge:text-[11px] forge:text-text-secondary forge:transition-colors forge:hover:bg-[color-mix(in_srgb,var(--acid)_10%,var(--bg-input))]"><i class="forge:size-2 forge:border forge:border-acid" /> Shark_Gardener <span class="forge:ml-auto forge:text-text-muted">◉</span></button>
      </section>
      <section class="forge:grid forge:gap-[10px] forge:border-t forge:border-line forge:px-[14px] forge:py-[13px] forge:[&_label]:grid forge:[&_label]:gap-[5px] forge:[&_label]:font-mono forge:[&_label]:text-[10px] forge:[&_label]:font-medium forge:[&_label]:text-text-muted forge:[&_label.forge3d-toggle-row]:flex forge:[&_label.forge3d-toggle-row]:items-center forge:[&_label.forge3d-toggle-row]:justify-between forge:[&_label.forge3d-toggle-row_input]:accent-acid">
        <div class="forge:mb-px forge:flex forge:justify-between"><span class="forge:text-[12px] forge:font-semibold forge:text-text-muted">Viewport</span><b class="forge:font-mono forge:text-[10px] forge:font-medium forge:text-text-muted">Live</b></div>
        <label>Environment<NodeSelect :model-value="node.data.config.environment || 'Studio'" :options="['Studio', 'Outdoor', 'Neutral']" @update:model-value="update('environment', $event)" /></label>
        <label class="forge3d-toggle-row"><span>Auto rotate</span><input type="checkbox" :checked="node.data.config.autoRotate !== false" @change="update('autoRotate', $event.target.checked)" /></label>
        <label class="forge3d-toggle-row"><span>Wireframe overlay</span><input type="checkbox" :checked="node.data.config.wireframe" @change="update('wireframe', $event.target.checked)" /></label>
      </section>
      <section class="forge:border-t forge:border-line forge:px-[14px] forge:py-[13px] forge:[&_dl]:grid forge:[&_dl]:grid-cols-2 forge:[&_dl]:gap-[7px] forge:[&_dl]:m-0 forge:[&_dl>div]:rounded-[5px] forge:[&_dl>div]:border forge:[&_dl>div]:border-line forge:[&_dl>div]:bg-bg-input forge:[&_dl>div]:p-2 forge:[&_dt]:font-mono forge:[&_dt]:text-[10px] forge:[&_dt]:font-medium forge:[&_dt]:text-text-muted forge:[&_dd]:mb-0 forge:[&_dd]:ml-0 forge:[&_dd]:mr-0 forge:[&_dd]:mt-1 forge:[&_dd]:font-mono forge:[&_dd]:text-[12px] forge:[&_dd]:font-medium forge:[&_dd]:text-text-secondary">
        <div class="forge:mb-[10px] forge:flex forge:justify-between"><span class="forge:text-[12px] forge:font-semibold forge:text-text-muted">Geometry</span><b class="forge:font-mono forge:text-[10px] forge:font-medium forge:text-text-muted">Optimized</b></div>
        <dl><div><dt>Triangles</dt><dd>38,420</dd></div><div><dt>Vertices</dt><dd>19,776</dd></div><div><dt>Materials</dt><dd>4</dd></div><div><dt>Textures</dt><dd>2K PBR</dd></div></dl>
      </section>
      <div class="forge:m-3 forge:rounded-lg forge:border forge:border-[color-mix(in_srgb,var(--acid)_20%,var(--line-strong))] forge:bg-[color-mix(in_srgb,var(--acid)_5%,var(--bg-input))] forge:p-3 forge:transition-[border-color,box-shadow] forge:hover:border-acid forge:hover:shadow-[0_0_12px_color-mix(in_srgb,var(--acid)_12%,transparent)]"><span class="forge:text-[12px] forge:font-semibold forge:text-acid">Canvas linked</span><p class="forge:mb-0 forge:mt-1.5 forge:text-[11px] forge:leading-[1.45] forge:text-text-muted">Viewport changes save back to the selected canvas node automatically.</p></div>
    </aside>
  </section>
</template>
