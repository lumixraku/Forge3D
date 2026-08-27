<script setup lang="ts">
import { computed } from 'vue'
import NodeSelect from './NodeSelect.vue'
import Model3D from './Model3D.vue'
import type { NodeRun } from '../node-runs'

type ModelConfig = Record<string, unknown> & { wireframe?: boolean; autoRotate?: boolean; preview?: string; environment?: string }
type ModelUploadAssets = Record<string, unknown> & { assetType?: string; modelUrl?: string }
interface ModelNode { data: { label: string; canvasType: string; config: ModelConfig; uploadAssets?: ModelUploadAssets } }

const props = defineProps<{ node: ModelNode; nodeRun?: NodeRun | null }>()
const emit = defineEmits<{ back: []; 'update-config': [config: ModelConfig] }>()
const modelUrl = computed(() => {
  const output = props.nodeRun?.output
  if (typeof output?.modelUrl === 'string') return output.modelUrl
  const download = Array.isArray(output?.outputs) ? output.outputs.find((item) => item?.downloadUrl) : null
  if (typeof download?.downloadUrl === 'string') return download.downloadUrl
  const uploads = props.node.data.uploadAssets
  return props.node.data.canvasType === 'reference-image' && uploads?.assetType === 'model' && typeof uploads.modelUrl === 'string' ? uploads.modelUrl : ''
})
const segmentedUrl = computed(() => modelUrl.value)
const downloadName = computed(() => modelUrl.value.split('/').pop()?.split('?')[0] || 'model.glb')
const canPreviewModel = computed(() => /\.(glb|gltf)(?:$|[?#])/i.test(modelUrl.value))
const previewImage = computed(() => props.nodeRun?.output?.preview || '')
// Names the provider that actually produced the file, so a simulated result is
// not passed off as a real one.
const assetSummary = computed(() => props.node.data.canvasType === 'reference-image' ? 'Uploaded asset' : `${props.nodeRun?.tripoTaskId ? 'Tripo' : 'Mock'} result · GLB`)

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
  <section class="forge:grid forge:min-h-0 forge:min-w-0 forge:grid-cols-[58px_minmax(0,1fr)_300px] forge:bg-bg-primary forge:transition-colors forge:duration-200 forge:max-[1200px]:grid-cols-[52px_minmax(0,1fr)_260px] forge:max-[760px]:grid-cols-1 forge:max-[760px]:grid-rows-[52px_650px_auto]">
    <aside class="forge:z-[3] forge:flex forge:flex-col forge:items-center forge:gap-1.5 forge:border-r forge:border-line forge:bg-bg-secondary forge:px-[7px] forge:py-[13px] forge:transition-colors forge:duration-200 forge:max-[760px]:flex-row forge:max-[760px]:justify-center forge:max-[760px]:border-b forge:max-[760px]:border-r-0 forge:max-[760px]:p-1.5 forge:[&_button]:relative forge:[&_button]:grid forge:[&_button]:size-[39px] forge:[&_button]:place-items-center forge:[&_button]:rounded-[7px] forge:[&_button]:border forge:[&_button]:border-transparent forge:[&_button]:bg-transparent forge:[&_button]:font-mono forge:[&_button]:text-base forge:[&_button]:font-medium forge:[&_button]:text-text-muted forge:[&_button]:transition-[transform,border-color,background,color] forge:[&_button]:hover:-translate-y-px forge:[&_button]:hover:border-line-strong forge:[&_button]:hover:bg-bg-input-hover forge:[&_button]:hover:text-acid forge:[&_button.forge3d-active]:border-line-strong forge:[&_button.forge3d-active]:bg-bg-input-hover forge:[&_button.forge3d-active]:text-acid forge:[&_button>span]:absolute forge:[&_button>span]:left-[46px] forge:[&_button>span]:top-[7px] forge:[&_button>span]:z-20 forge:[&_button>span]:hidden forge:[&_button>span]:whitespace-nowrap forge:[&_button>span]:rounded-[5px] forge:[&_button>span]:border forge:[&_button>span]:border-line-strong forge:[&_button>span]:bg-bg-input forge:[&_button>span]:px-2 forge:[&_button>span]:py-1.5 forge:[&_button>span]:text-[8px] forge:[&_button>span]:uppercase forge:[&_button>span]:text-text-secondary forge:[&_button>span]:shadow-md forge:[&_button:hover>span]:block forge:max-[760px]:[&_button]:size-9 forge:max-[760px]:[&_button>span]:hidden">
      <button class="forge3d-active" title="Select">↖<span>Select</span></button>
      <button title="Move">✣<span>Move</span></button>
      <button title="Rotate">↻<span>Rotate</span></button>
      <button title="Scale">⌗<span>Scale</span></button>
      <span class="forge:mx-0 forge:my-1 forge:h-px forge:w-6 forge:bg-line forge:max-[760px]:mx-1 forge:max-[760px]:my-0 forge:max-[760px]:h-6 forge:max-[760px]:w-px" />
      <button title="Sculpt">◒<span>Sculpt</span></button>
      <button title="Paint">◩<span>Paint</span></button>
    </aside>

    <section class="forge:grid forge:min-h-0 forge:min-w-0 forge:grid-rows-[61px_minmax(0,1fr)_54px] forge:max-[760px]:grid-rows-[60px_540px_50px]">
      <header class="forge:flex forge:items-center forge:justify-between forge:gap-5 forge:border-b forge:border-line forge:bg-bg-tertiary forge:px-4 forge:transition-colors forge:duration-200 forge:max-[760px]:px-[10px]">
        <div class="forge:grid forge:grid-cols-[auto_auto] forge:items-center forge:gap-x-3 forge:gap-y-[3px]">
          <button class="forge:row-span-2 forge:min-h-8 forge:rounded-md forge:border forge:border-line-strong forge:bg-bg-input forge:px-[10px] forge:font-mono forge:text-[9px] forge:font-medium forge:text-text-secondary forge:transition-colors forge:hover:bg-bg-input-hover forge:hover:text-acid" @click="emit('back')">← Canvas</button>
          <span class="forge:font-mono forge:text-[8px] forge:font-medium forge:tracking-[.12em] forge:text-text-muted forge:max-[760px]:hidden">MODEL EDITOR</span>
          <strong class="forge:text-xs forge:font-medium forge:max-[760px]:hidden">{{ node.data.label }}</strong>
        </div>
        <div class="forge:flex forge:gap-1.5 forge:[&>*]:inline-flex forge:[&>*]:min-h-[30px] forge:[&>*]:items-center forge:[&>*]:rounded-md forge:[&>*]:border forge:[&>*]:border-line-strong forge:[&>*]:bg-bg-input forge:[&>*]:px-[10px] forge:[&>*]:font-mono forge:[&>*]:text-[8px] forge:[&>*]:font-medium forge:[&>*]:text-text-muted forge:[&>*]:no-underline forge:[&>*]:transition-colors forge:[&>*]:hover:bg-bg-input-hover forge:[&>*]:hover:text-text-primary forge:[&_.forge3d-primary]:border-acid forge:[&_.forge3d-primary]:bg-acid forge:[&_.forge3d-primary]:text-text-inverse forge:[&_.forge3d-primary]:hover:brightness-108 forge:max-[760px]:[&>*:not(.forge3d-primary)]:hidden">
          <button>Compare</button>
          <button>Snapshot</button>
          <a v-if="modelUrl" class="forge3d-primary" :href="modelUrl" :download="downloadName">Download model</a>
        </div>
      </header>

      <div class="forge:relative forge:min-h-0 forge:min-w-0 forge:overflow-hidden forge:bg-[#202322] forge:bg-[linear-gradient(rgba(255,255,255,.018)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.018)_1px,transparent_1px),radial-gradient(circle_at_50%_45%,rgba(108,122,109,.18),transparent_52%)] forge:bg-[size:32px_32px,32px_32px,auto] forge:light:bg-[linear-gradient(rgba(28,40,31,.035)_1px,transparent_1px),linear-gradient(90deg,rgba(28,40,31,.035)_1px,transparent_1px),radial-gradient(circle_at_50%_45%,rgba(196,207,198,.2),transparent_52%)] forge:after:pointer-events-none forge:after:absolute forge:after:bottom-[15%] forge:after:left-0 forge:after:right-0 forge:after:h-px forge:after:bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--acid)_20%,transparent),transparent)]">
        <Model3D v-if="canPreviewModel" :mode="editorMode" :src="modelUrl" :seg-src="segmentedUrl" :auto-rotate="node.data.config.autoRotate !== false" />
        <div v-else class="forge:absolute forge:inset-0 forge:grid forge:place-items-center forge:px-8 forge:text-center forge:font-mono forge:text-[9px] forge:font-medium forge:text-text-muted">{{ modelUrl ? 'This model format is available for download but cannot be previewed here.' : 'This run did not produce a model file.' }}</div>
        <div class="forge:absolute forge:bottom-[14px] forge:left-4 forge:z-[2] forge:flex forge:items-center forge:gap-[7px] forge:font-mono forge:text-[8px] forge:font-medium forge:text-text-muted forge:pointer-events-none"><i class="forge:size-1.5 forge:rounded-full forge:bg-acid forge:shadow-[0_0_8px_color-mix(in_srgb,var(--acid)_70%,transparent)]" /> REALTIME · GLB · {{ editorMode === 'split' ? 'SEGMENTS' : editorMode === 'rig' ? 'RIG' : 'PBR' }}</div>
        <div class="forge:absolute forge:bottom-[14px] forge:right-4 forge:z-[2] forge:font-mono forge:text-[8px] forge:font-medium forge:text-text-muted forge:pointer-events-none forge:max-[760px]:hidden">Drag to orbit · Scroll to zoom · Double-click to focus</div>
        <div class="forge:absolute forge:left-5 forge:top-5 forge:z-[2] forge:size-[54px] forge:font-mono forge:text-[8px] forge:font-semibold forge:text-[#d2d7d2] forge:pointer-events-none forge:before:absolute forge:before:bottom-3 forge:before:left-[25px] forge:before:h-8 forge:before:w-px forge:before:origin-bottom forge:before:bg-[#e47676] forge:after:absolute forge:after:bottom-3 forge:after:left-[25px] forge:after:h-8 forge:after:w-px forge:after:origin-bottom forge:after:rotate-90 forge:after:bg-[#70afef]"><b class="forge:absolute forge:left-[22px] forge:top-0 forge:text-[#e47676]">Z</b><span class="forge:absolute forge:bottom-2 forge:right-0 forge:text-[#70afef]">X</span><i class="forge:absolute forge:bottom-0 forge:left-[3px] forge:not-italic forge:text-[#7aca8a]">Y</i></div>
        <div class="forge:absolute forge:right-5 forge:top-[18px] forge:z-[2] forge:grid forge:size-12 forge:place-items-center forge:border forge:border-white/15 forge:bg-[rgba(24,29,26,.7)] forge:font-mono forge:text-[6px] forge:font-medium forge:text-[#a7aea8] forge:rotate-[7deg] forge:skew-y-[-5deg] forge:pointer-events-none"><span>FRONT</span></div>
      </div>

      <footer class="forge:grid forge:grid-cols-[260px_minmax(120px,1fr)_auto] forge:items-center forge:gap-4 forge:border-t forge:border-line forge:bg-bg-tertiary forge:px-4 forge:transition-colors forge:duration-200 forge:max-[1200px]:grid-cols-[minmax(150px,1fr)_1fr] forge:max-[760px]:grid-cols-1">
        <div><span class="forge:font-mono forge:text-[8px] forge:font-medium forge:tracking-[.12em] forge:text-text-muted">VERSION HISTORY</span><b class="forge:mt-1 forge:block forge:truncate forge:font-mono forge:text-[8px] forge:font-medium forge:text-text-secondary">Mesh generation → Retopology → Texture pass</b></div>
        <div class="forge:relative forge:flex forge:h-px forge:items-center forge:justify-between forge:bg-line-strong forge:max-[760px]:hidden"><i class="forge:z-[1] forge:size-[7px] forge:rounded-full forge:border forge:border-text-muted forge:bg-bg-input" /><i class="forge:z-[1] forge:size-[7px] forge:rounded-full forge:border forge:border-text-muted forge:bg-bg-input" /><i class="forge:z-[1] forge:size-2.5 forge:rounded-full forge:border forge:border-acid forge:bg-acid forge:shadow-[0_0_9px_color-mix(in_srgb,var(--acid)_50%,transparent)]" /></div>
        <span class="forge:font-mono forge:text-[8px] forge:font-medium forge:tracking-[.12em] forge:text-text-muted forge:max-[1200px]:hidden">v03 · Current</span>
      </footer>
    </section>

    <aside class="forge:relative forge:overflow-y-auto forge:border-l forge:border-line forge:bg-bg-secondary forge:transition-colors forge:duration-200">
      <header class="forge:h-[61px] forge:border-b forge:border-line forge:px-4 forge:py-[15px]"><span class="forge:font-mono forge:text-[8px] forge:font-medium forge:tracking-[.12em] forge:text-text-muted">INSPECTOR</span><b class="forge:mt-1 forge:block forge:text-[11px]">Asset properties</b></header>
      <section class="forge:m-3 forge:flex forge:items-center forge:gap-[11px] forge:rounded-lg forge:border forge:border-line-subtle forge:bg-bg-input forge:p-[9px] forge:transition-[border-color,box-shadow] forge:hover:border-line-strong forge:hover:shadow-sm">
        <img v-if="previewImage" class="forge:size-[52px] forge:rounded-[5px] forge:bg-[#262b28] forge:object-cover" :src="previewImage" alt="Model preview" />
        <div><strong class="forge:block forge:text-[11px]">{{ node.data.label }}</strong><span class="forge:mt-1 forge:block forge:font-mono forge:text-[8px] forge:font-medium forge:text-text-muted">{{ assetSummary }}</span></div>
      </section>
      <section class="forge:border-t forge:border-line forge:px-[14px] forge:py-[13px]">
        <div class="forge:mb-[10px] forge:flex forge:justify-between"><span class="forge:font-mono forge:text-[8px] forge:font-medium forge:tracking-[.12em] forge:text-text-muted">SCENE</span><b class="forge:font-mono forge:text-[8px] forge:font-medium forge:text-text-muted">01 object</b></div>
        <button class="forge:flex forge:h-[31px] forge:w-full forge:items-center forge:gap-2 forge:rounded-[5px] forge:border forge:border-line-strong forge:bg-bg-input forge:px-2 forge:text-left forge:text-[9px] forge:text-text-secondary forge:transition-colors forge:hover:bg-bg-input-hover"><i class="forge:size-2 forge:border forge:border-acid" /> Shark_Gardener <span class="forge:ml-auto forge:text-text-muted">◉</span></button>
      </section>
      <section class="forge:grid forge:gap-[10px] forge:border-t forge:border-line forge:px-[14px] forge:py-[13px] forge:[&_label]:grid forge:[&_label]:gap-[5px] forge:[&_label]:font-mono forge:[&_label]:text-[8px] forge:[&_label]:font-medium forge:[&_label]:uppercase forge:[&_label]:text-text-muted forge:[&_label.forge3d-toggle-row]:flex forge:[&_label.forge3d-toggle-row]:items-center forge:[&_label.forge3d-toggle-row]:justify-between forge:[&_label.forge3d-toggle-row_input]:accent-acid">
        <div class="forge:mb-px forge:flex forge:justify-between"><span class="forge:font-mono forge:text-[8px] forge:font-medium forge:tracking-[.12em] forge:text-text-muted">VIEWPORT</span><b class="forge:font-mono forge:text-[8px] forge:font-medium forge:text-text-muted">Live</b></div>
        <label>Environment<NodeSelect :model-value="node.data.config.environment || 'Studio'" :options="['Studio', 'Outdoor', 'Neutral']" @update:model-value="update('environment', $event)" /></label>
        <label class="forge3d-toggle-row"><span>Auto rotate</span><input type="checkbox" :checked="node.data.config.autoRotate !== false" @change="update('autoRotate', $event.target.checked)" /></label>
        <label class="forge3d-toggle-row"><span>Wireframe overlay</span><input type="checkbox" :checked="node.data.config.wireframe" @change="update('wireframe', $event.target.checked)" /></label>
      </section>
      <section class="forge:border-t forge:border-line forge:px-[14px] forge:py-[13px] forge:[&_dl]:grid forge:[&_dl]:grid-cols-2 forge:[&_dl]:gap-[7px] forge:[&_dl]:m-0 forge:[&_dl>div]:rounded-[5px] forge:[&_dl>div]:border forge:[&_dl>div]:border-line forge:[&_dl>div]:bg-bg-input forge:[&_dl>div]:p-2 forge:[&_dt]:font-mono forge:[&_dt]:text-[7px] forge:[&_dt]:font-medium forge:[&_dt]:uppercase forge:[&_dt]:text-text-muted forge:[&_dd]:mb-0 forge:[&_dd]:ml-0 forge:[&_dd]:mr-0 forge:[&_dd]:mt-1 forge:[&_dd]:font-mono forge:[&_dd]:text-[10px] forge:[&_dd]:font-medium forge:[&_dd]:text-text-secondary">
        <div class="forge:mb-[10px] forge:flex forge:justify-between"><span class="forge:font-mono forge:text-[8px] forge:font-medium forge:tracking-[.12em] forge:text-text-muted">GEOMETRY</span><b class="forge:font-mono forge:text-[8px] forge:font-medium forge:text-text-muted">Optimized</b></div>
        <dl><div><dt>Triangles</dt><dd>38,420</dd></div><div><dt>Vertices</dt><dd>19,776</dd></div><div><dt>Materials</dt><dd>4</dd></div><div><dt>Textures</dt><dd>2K PBR</dd></div></dl>
      </section>
      <div class="forge:m-3 forge:rounded-lg forge:border forge:border-[color-mix(in_srgb,var(--acid)_20%,var(--line-strong))] forge:bg-[color-mix(in_srgb,var(--acid)_5%,var(--bg-input))] forge:p-3 forge:transition-[border-color,box-shadow] forge:hover:border-acid forge:hover:shadow-[0_0_12px_color-mix(in_srgb,var(--acid)_12%,transparent)]"><span class="forge:font-mono forge:text-[8px] forge:font-medium forge:tracking-[.12em] forge:text-acid">CANVAS LINKED</span><p class="forge:mb-0 forge:mt-1.5 forge:text-[9px] forge:leading-[1.45] forge:text-text-muted">Viewport changes save back to the selected canvas node automatically.</p></div>
    </aside>
  </section>
</template>
