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
  <section class="grid min-h-0 min-w-0 grid-cols-[58px_minmax(0,1fr)_300px] bg-bg-primary transition-colors duration-200 max-[1200px]:grid-cols-[52px_minmax(0,1fr)_260px] max-[760px]:grid-cols-1 max-[760px]:grid-rows-[52px_650px_auto]">
    <aside class="z-[3] flex flex-col items-center gap-1.5 border-r border-line bg-bg-secondary px-[7px] py-[13px] transition-colors duration-200 max-[760px]:flex-row max-[760px]:justify-center max-[760px]:border-b max-[760px]:border-r-0 max-[760px]:p-1.5 [&_button]:relative [&_button]:grid [&_button]:size-[39px] [&_button]:place-items-center [&_button]:rounded-[7px] [&_button]:border [&_button]:border-transparent [&_button]:bg-transparent [&_button]:font-mono [&_button]:text-base [&_button]:font-medium [&_button]:text-text-muted [&_button]:transition-[transform,border-color,background,color] [&_button]:hover:-translate-y-px [&_button]:hover:border-line-strong [&_button]:hover:bg-bg-input-hover [&_button]:hover:text-acid [&_button.active]:border-line-strong [&_button.active]:bg-bg-input-hover [&_button.active]:text-acid [&_button>span]:absolute [&_button>span]:left-[46px] [&_button>span]:top-[7px] [&_button>span]:z-20 [&_button>span]:hidden [&_button>span]:whitespace-nowrap [&_button>span]:rounded-[5px] [&_button>span]:border [&_button>span]:border-line-strong [&_button>span]:bg-bg-input [&_button>span]:px-2 [&_button>span]:py-1.5 [&_button>span]:text-[8px] [&_button>span]:uppercase [&_button>span]:text-text-secondary [&_button>span]:shadow-md [&_button:hover>span]:block max-[760px]:[&_button]:size-9 max-[760px]:[&_button>span]:hidden">
      <button class="active" title="Select">↖<span>Select</span></button>
      <button title="Move">✣<span>Move</span></button>
      <button title="Rotate">↻<span>Rotate</span></button>
      <button title="Scale">⌗<span>Scale</span></button>
      <span class="mx-0 my-1 h-px w-6 bg-line max-[760px]:mx-1 max-[760px]:my-0 max-[760px]:h-6 max-[760px]:w-px" />
      <button title="Sculpt">◒<span>Sculpt</span></button>
      <button title="Paint">◩<span>Paint</span></button>
    </aside>

    <section class="grid min-h-0 min-w-0 grid-rows-[61px_minmax(0,1fr)_54px] max-[760px]:grid-rows-[60px_540px_50px]">
      <header class="flex items-center justify-between gap-5 border-b border-line bg-bg-tertiary px-4 transition-colors duration-200 max-[760px]:px-[10px]">
        <div class="grid grid-cols-[auto_auto] items-center gap-x-3 gap-y-[3px]">
          <button class="row-span-2 min-h-8 rounded-md border border-line-strong bg-bg-input px-[10px] font-mono text-[9px] font-medium text-text-secondary transition-colors hover:bg-bg-input-hover hover:text-acid" @click="emit('back')">← Canvas</button>
          <span class="font-mono text-[8px] font-medium tracking-[.12em] text-text-muted max-[760px]:hidden">MODEL EDITOR</span>
          <strong class="text-xs font-medium max-[760px]:hidden">{{ node.data.label }}</strong>
        </div>
        <div class="flex gap-1.5 [&>*]:inline-flex [&>*]:min-h-[30px] [&>*]:items-center [&>*]:rounded-md [&>*]:border [&>*]:border-line-strong [&>*]:bg-bg-input [&>*]:px-[10px] [&>*]:font-mono [&>*]:text-[8px] [&>*]:font-medium [&>*]:text-text-muted [&>*]:no-underline [&>*]:transition-colors [&>*]:hover:bg-bg-input-hover [&>*]:hover:text-text-primary [&_.primary]:border-acid [&_.primary]:bg-acid [&_.primary]:text-text-inverse [&_.primary]:hover:brightness-108 max-[760px]:[&>*:not(.primary)]:hidden">
          <button>Compare</button>
          <button>Snapshot</button>
          <a v-if="modelUrl" class="primary" :href="modelUrl" :download="downloadName">Download GLB</a>
        </div>
      </header>

      <div class="relative min-h-0 min-w-0 overflow-hidden bg-[#202322] bg-[linear-gradient(rgba(255,255,255,.018)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.018)_1px,transparent_1px),radial-gradient(circle_at_50%_45%,rgba(108,122,109,.18),transparent_52%)] bg-[size:32px_32px,32px_32px,auto] light:bg-[linear-gradient(rgba(28,40,31,.035)_1px,transparent_1px),linear-gradient(90deg,rgba(28,40,31,.035)_1px,transparent_1px),radial-gradient(circle_at_50%_45%,rgba(196,207,198,.2),transparent_52%)] after:pointer-events-none after:absolute after:bottom-[15%] after:left-0 after:right-0 after:h-px after:bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--acid)_20%,transparent),transparent)]">
        <Model3D v-if="modelUrl" :mode="editorMode" :src="modelUrl" :seg-src="segmentedUrl" :auto-rotate="node.data.config.autoRotate !== false" />
        <div v-else class="absolute inset-0 grid place-items-center font-mono text-[9px] font-medium text-text-muted">This run did not produce a model file.</div>
        <div class="absolute bottom-[14px] left-4 z-[2] flex items-center gap-[7px] font-mono text-[8px] font-medium text-text-muted pointer-events-none"><i class="size-1.5 rounded-full bg-acid shadow-[0_0_8px_color-mix(in_srgb,var(--acid)_70%,transparent)]" /> REALTIME · GLB · {{ editorMode === 'split' ? 'SEGMENTS' : editorMode === 'rig' ? 'RIG' : 'PBR' }}</div>
        <div class="absolute bottom-[14px] right-4 z-[2] font-mono text-[8px] font-medium text-text-muted pointer-events-none max-[760px]:hidden">Drag to orbit · Scroll to zoom · Double-click to focus</div>
        <div class="absolute left-5 top-5 z-[2] size-[54px] font-mono text-[8px] font-semibold text-[#d2d7d2] pointer-events-none before:absolute before:bottom-3 before:left-[25px] before:h-8 before:w-px before:origin-bottom before:bg-[#e47676] after:absolute after:bottom-3 after:left-[25px] after:h-8 after:w-px after:origin-bottom after:rotate-90 after:bg-[#70afef]"><b class="absolute left-[22px] top-0 text-[#e47676]">Z</b><span class="absolute bottom-2 right-0 text-[#70afef]">X</span><i class="absolute bottom-0 left-[3px] not-italic text-[#7aca8a]">Y</i></div>
        <div class="absolute right-5 top-[18px] z-[2] grid size-12 place-items-center border border-white/15 bg-[rgba(24,29,26,.7)] font-mono text-[6px] font-medium text-[#a7aea8] rotate-[7deg] skew-y-[-5deg] pointer-events-none"><span>FRONT</span></div>
      </div>

      <footer class="grid grid-cols-[260px_minmax(120px,1fr)_auto] items-center gap-4 border-t border-line bg-bg-tertiary px-4 transition-colors duration-200 max-[1200px]:grid-cols-[minmax(150px,1fr)_1fr] max-[760px]:grid-cols-1">
        <div><span class="font-mono text-[8px] font-medium tracking-[.12em] text-text-muted">VERSION HISTORY</span><b class="mt-1 block truncate font-mono text-[8px] font-medium text-text-secondary">Mesh generation → Retopology → Texture pass</b></div>
        <div class="relative flex h-px items-center justify-between bg-line-strong max-[760px]:hidden"><i class="z-[1] size-[7px] rounded-full border border-text-muted bg-bg-input" /><i class="z-[1] size-[7px] rounded-full border border-text-muted bg-bg-input" /><i class="z-[1] size-2.5 rounded-full border border-acid bg-acid shadow-[0_0_9px_color-mix(in_srgb,var(--acid)_50%,transparent)]" /></div>
        <span class="font-mono text-[8px] font-medium tracking-[.12em] text-text-muted max-[1200px]:hidden">v03 · Current</span>
      </footer>
    </section>

    <aside class="relative overflow-y-auto border-l border-line bg-bg-secondary transition-colors duration-200">
      <header class="h-[61px] border-b border-line px-4 py-[15px]"><span class="font-mono text-[8px] font-medium tracking-[.12em] text-text-muted">INSPECTOR</span><b class="mt-1 block text-[11px]">Asset properties</b></header>
      <section class="m-3 flex items-center gap-[11px] rounded-lg border border-line-subtle bg-bg-input p-[9px] transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-sm">
        <img v-if="previewImage" class="size-[52px] rounded-[5px] bg-[#262b28] object-cover" :src="previewImage" alt="Model preview" />
        <div><strong class="block text-[11px]">{{ node.data.label }}</strong><span class="mt-1 block font-mono text-[8px] font-medium text-text-muted">{{ assetSummary }}</span></div>
      </section>
      <section class="border-t border-line px-[14px] py-[13px]">
        <div class="mb-[10px] flex justify-between"><span class="font-mono text-[8px] font-medium tracking-[.12em] text-text-muted">SCENE</span><b class="font-mono text-[8px] font-medium text-text-muted">01 object</b></div>
        <button class="flex h-[31px] w-full items-center gap-2 rounded-[5px] border border-line-strong bg-bg-input px-2 text-left text-[9px] text-text-secondary transition-colors hover:bg-bg-input-hover"><i class="size-2 border border-acid" /> Shark_Gardener <span class="ml-auto text-text-muted">◉</span></button>
      </section>
      <section class="grid gap-[10px] border-t border-line px-[14px] py-[13px] [&_label]:grid [&_label]:gap-[5px] [&_label]:font-mono [&_label]:text-[8px] [&_label]:font-medium [&_label]:uppercase [&_label]:text-text-muted [&_label.toggle-row]:flex [&_label.toggle-row]:items-center [&_label.toggle-row]:justify-between [&_label.toggle-row_input]:accent-acid">
        <div class="mb-px flex justify-between"><span class="font-mono text-[8px] font-medium tracking-[.12em] text-text-muted">VIEWPORT</span><b class="font-mono text-[8px] font-medium text-text-muted">Live</b></div>
        <label>Environment<NodeSelect :model-value="node.data.config.environment || 'Studio'" :options="['Studio', 'Outdoor', 'Neutral']" @update:model-value="update('environment', $event)" /></label>
        <label class="toggle-row"><span>Auto rotate</span><input type="checkbox" :checked="node.data.config.autoRotate !== false" @change="update('autoRotate', $event.target.checked)" /></label>
        <label class="toggle-row"><span>Wireframe overlay</span><input type="checkbox" :checked="node.data.config.wireframe" @change="update('wireframe', $event.target.checked)" /></label>
      </section>
      <section class="border-t border-line px-[14px] py-[13px] [&_dl]:grid [&_dl]:grid-cols-2 [&_dl]:gap-[7px] [&_dl]:m-0 [&_dl>div]:rounded-[5px] [&_dl>div]:border [&_dl>div]:border-line [&_dl>div]:bg-bg-input [&_dl>div]:p-2 [&_dt]:font-mono [&_dt]:text-[7px] [&_dt]:font-medium [&_dt]:uppercase [&_dt]:text-text-muted [&_dd]:mb-0 [&_dd]:ml-0 [&_dd]:mr-0 [&_dd]:mt-1 [&_dd]:font-mono [&_dd]:text-[10px] [&_dd]:font-medium [&_dd]:text-text-secondary">
        <div class="mb-[10px] flex justify-between"><span class="font-mono text-[8px] font-medium tracking-[.12em] text-text-muted">GEOMETRY</span><b class="font-mono text-[8px] font-medium text-text-muted">Optimized</b></div>
        <dl><div><dt>Triangles</dt><dd>38,420</dd></div><div><dt>Vertices</dt><dd>19,776</dd></div><div><dt>Materials</dt><dd>4</dd></div><div><dt>Textures</dt><dd>2K PBR</dd></div></dl>
      </section>
      <div class="m-3 rounded-lg border border-[color-mix(in_srgb,var(--acid)_20%,var(--line-strong))] bg-[color-mix(in_srgb,var(--acid)_5%,var(--bg-input))] p-3 transition-[border-color,box-shadow] hover:border-acid hover:shadow-[0_0_12px_color-mix(in_srgb,var(--acid)_12%,transparent)]"><span class="font-mono text-[8px] font-medium tracking-[.12em] text-acid">CANVAS LINKED</span><p class="mb-0 mt-1.5 text-[9px] leading-[1.45] text-text-muted">Viewport changes save back to the selected canvas node automatically.</p></div>
    </aside>
  </section>
</template>
