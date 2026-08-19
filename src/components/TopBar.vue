<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue'

const props = defineProps<{
  activeCanvas: any
  canvases: any[]
  workspaceMode: string
  canvasView: string
  savedState: string
  theme: string
  busy: boolean
  switcherOpen: boolean
  editorName?: string
  canEdit?: boolean
  account?: { name: string; balance: number } | null
}>()
const emit = defineEmits<{
  rename: [name: string]
  'open-canvas': [id: string]
  'create-canvas': []
  'canvas-context-menu': [payload: { event: MouseEvent; canvas: any }]
  'import-file': [file: File]
  'set-theme': [theme: string]
  'update:canvasView': [view: string]
  'update:switcherOpen': [open: boolean]
}>()

const renaming = ref(false)
const nameDraft = ref('')
const nameInput = ref<HTMLInputElement | null>(null)
const importInput = ref<HTMLInputElement | null>(null)
const importDragging = ref(false)
const switcherAnchor = ref<HTMLElement | null>(null)

function startRename() {
  if (!props.activeCanvas || props.busy || props.workspaceMode !== 'canvas') return
  nameDraft.value = props.activeCanvas.name
  renaming.value = true
  nextTick(() => {
    nameInput.value?.focus()
    nameInput.value?.select()
  })
}

function commitRename() {
  if (!renaming.value) return
  renaming.value = false
  const name = nameDraft.value.trim()
  if (!props.activeCanvas || !name || name === props.activeCanvas.name) return
  emit('rename', name)
}

function cancelRename() {
  renaming.value = false
}

function importCanvas(event) {
  const [file] = event.target.files
  event.target.value = ''
  if (file) emit('import-file', file)
}

function onImportDragOver(event: DragEvent) {
  event.preventDefault()
  importDragging.value = true
}

function onImportDrop(event: DragEvent) {
  event.preventDefault()
  importDragging.value = false
  const [file] = event.dataTransfer.files
  if (file) emit('import-file', file)
}

function dismissSwitcher(event: PointerEvent) {
  if (!props.switcherOpen || switcherAnchor.value?.contains(event.target as Node)) return
  emit('update:switcherOpen', false)
}

onMounted(() => window.addEventListener('pointerdown', dismissSwitcher, true))
onUnmounted(() => window.removeEventListener('pointerdown', dismissSwitcher, true))
</script>

<template>
  <header class="forge:relative forge:z-10 forge:grid forge:grid-cols-[350px_1fr_auto] forge:items-center forge:border-b forge:border-line forge:bg-bg-tertiary forge:transition-colors forge:duration-200 forge:max-[1200px]:grid-cols-[310px_1fr_auto] forge:max-[760px]:sticky forge:max-[760px]:top-0 forge:max-[760px]:grid-cols-[auto_1fr]">
    <div class="forge:flex forge:h-full forge:items-center forge:gap-3 forge:border-r forge:border-line forge:px-[18px] forge:max-[760px]:border-r-0">
      <span class="forge3d-brand-mark forge:grid forge:place-items-center forge:w-[35px] forge:h-[35px] forge:rounded-[10px] forge:bg-acid forge:text-text-inverse forge:font-mono forge:font-semibold forge:text-xs forge:transition-all forge:duration-150 forge:hover:scale-105 forge:hover:shadow-[0_0_0_3px] forge:hover:shadow-acid/20">F3</span>
      <div><strong class="forge:block forge:font-mono forge:font-semibold forge:text-sm forge:tracking-[-0.03em]">Forge3D</strong><small class="forge:block forge:mt-[2px] forge:text-text-muted forge:text-[11px]">Conversational canvas studio</small></div>
    </div>
    <!-- No canvas yet: the switcher and New still have to be reachable, or the
         first canvas can never be created. -->
    <div v-if="!activeCanvas" class="forge:relative forge:flex forge:min-w-0 forge:items-center forge:gap-3 forge:px-6" @pointerdown.stop>
      <span class="forge:flex-none forge:font-mono forge:text-[9px] forge:font-medium forge:uppercase forge:tracking-[.12em] forge:text-text-muted">NO CANVAS</span>
      <div class="forge:flex forge:min-w-0 forge:flex-[0_1_auto] forge:items-center forge:gap-3">
        <div ref="switcherAnchor" class="forge:relative forge:flex-none">
          <div class="forge:flex forge:h-9 forge:flex-none forge:items-stretch forge:overflow-hidden forge:rounded-lg forge:border forge:border-line-strong forge:bg-bg-input forge:transition-colors forge:[&_button]:flex forge:[&_button]:h-full forge:[&_button]:items-center forge:[&_button]:gap-1.5 forge:[&_button]:border-0 forge:[&_button]:border-l forge:[&_button]:border-line forge:[&_button]:bg-transparent forge:[&_button]:px-3 forge:[&_button]:text-[11px] forge:[&_button]:font-medium forge:[&_button]:leading-none forge:[&_button]:text-text-secondary forge:[&_button]:transition-colors forge:[&_button]:hover:bg-bg-input-hover forge:[&_button]:hover:text-text-primary forge:[&_button:first-child]:border-l-0 forge:[&.forge3d-open_.forge3d-wbg-label]:bg-bg-input-hover forge:[&.forge3d-open_.forge3d-wbg-label]:text-text-primary forge:[&.forge3d-open_.forge3d-chevron-icon]:rotate-180" :class="{ 'forge3d-open': switcherOpen }">
            <button type="button" class="forge3d-wbg-label" :aria-expanded="switcherOpen" @click="emit('update:switcherOpen', !switcherOpen)">
              <span>Canvass</span>
              <svg class="forge3d-chevron-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </button>
            <button type="button" class="forge:!font-semibold forge:!text-acid forge:hover:!bg-[color-mix(in_srgb,var(--acid)_12%,transparent)] forge:hover:!text-acid" :disabled="busy" @click="emit('create-canvas')">New</button>
          </div>
          <div v-if="switcherOpen" class="forge:absolute forge:left-0 forge:top-[calc(100%+8px)] forge:z-30 forge:flex forge:max-h-[min(70vh,520px)] forge:w-[300px] forge:flex-col forge:gap-1.5 forge:overflow-hidden forge:overflow-y-auto forge:rounded-xl forge:border forge:border-line-strong forge:bg-bg-input forge:p-2 forge:shadow-popover">
            <div class="forge:flex forge:items-center forge:justify-between forge:px-1.5 forge:pb-0.5 forge:pt-1"><span class="forge:font-mono forge:text-[9px] forge:font-medium forge:tracking-[.12em] forge:text-text-muted">CANVASS · {{ canvases.length }}</span></div>
            <div class="forge:flex forge:flex-col forge:gap-[3px] forge:overflow-auto">
              <button v-for="canvas in canvases" :key="canvas.id" class="forge:w-full forge:rounded-[9px] forge:border forge:border-transparent forge:bg-transparent forge:p-3 forge:text-left forge:transition-colors forge:hover:border-line forge:hover:bg-bg-input-hover forge:[&_small]:mt-[5px] forge:[&_small]:block forge:[&_small]:font-mono forge:[&_small]:text-[9px] forge:[&_small]:text-text-muted forge:[&_span]:text-xs" @click="emit('open-canvas', canvas.id)" @contextmenu="emit('canvas-context-menu', { event: $event, canvas })">
                <span>{{ canvas.name }}</span><small>{{ canvas.nodeCount }} nodes · v{{ canvas.revision }}</small>
              </button>
              <p v-if="!canvases.length" class="forge:mx-1 forge:mb-0 forge:mt-0.5 forge:font-mono forge:text-[9px] forge:leading-[1.5] forge:text-text-muted">No canvases yet. Press New to create one.</p>
            </div>
          </div>
        </div>
        <button class="forge:h-[34px] forge:rounded-lg forge:border forge:border-line-strong forge:bg-bg-input forge:px-3 forge:font-mono forge:text-[10px] forge:font-medium forge:text-text-secondary forge:transition-colors forge:hover:border-acid forge:hover:bg-[color-mix(in_srgb,var(--acid)_8%,var(--bg-input))] forge:hover:text-acid forge:[&.forge3d-dragging]:border-acid forge:[&.forge3d-dragging]:bg-[color-mix(in_srgb,var(--acid)_8%,var(--bg-input))] forge:[&.forge3d-dragging]:text-acid" :class="{ 'forge3d-dragging': importDragging }" type="button" :disabled="busy" @click="importInput.click()" @dragover="onImportDragOver" @dragleave="importDragging = false" @drop="onImportDrop">{{ importDragging ? 'Drop JSON' : 'Import JSON' }}</button>
        <input ref="importInput" class="forge:hidden" type="file" accept="application/json,.json" @change="importCanvas" />
      </div>
    </div>
    <div v-else class="forge:relative forge:flex forge:min-w-0 forge:items-center forge:gap-3 forge:px-6" @pointerdown.stop>
      <span class="forge:flex-none forge:font-mono forge:text-[9px] forge:font-medium forge:uppercase forge:tracking-[.12em] forge:text-text-muted">{{ workspaceMode === 'canvas' ? 'CANVAS' : 'MODEL EDITOR' }} / {{ activeCanvas.revision.toString().padStart(2, '0') }}</span>
      <input v-if="renaming" ref="nameInput" v-model="nameDraft" class="forge:mt-[3px] forge:block forge:w-full forge:border-0 forge:bg-transparent forge:p-0 forge:text-sm forge:font-bold forge:leading-5 forge:shadow-[inset_0_-1px_0_var(--acid)] forge:outline-none" type="text" @keydown.enter.prevent="commitRename" @keydown.esc.prevent="cancelRename" @blur="commitRename" />
      <template v-else-if="workspaceMode === 'canvas'">
        <div class="forge:flex forge:min-w-0 forge:flex-[0_1_auto] forge:items-center forge:gap-3">
          <strong class="forge:min-w-0 forge:flex-[0_1_auto] forge:cursor-text forge:truncate forge:text-sm forge:font-bold" title="Double-click to rename" @dblclick="startRename">{{ activeCanvas.name }}</strong>
          <div class="forge:flex forge:flex-none forge:items-center forge:gap-2">
            <div ref="switcherAnchor" class="forge:relative forge:flex-none">
              <div class="forge:flex forge:h-9 forge:flex-none forge:items-stretch forge:overflow-hidden forge:rounded-lg forge:border forge:border-line-strong forge:bg-bg-input forge:transition-colors forge:[&_button]:flex forge:[&_button]:h-full forge:[&_button]:items-center forge:[&_button]:gap-1.5 forge:[&_button]:border-0 forge:[&_button]:border-l forge:[&_button]:border-line forge:[&_button]:bg-transparent forge:[&_button]:px-3 forge:[&_button]:text-[11px] forge:[&_button]:font-medium forge:[&_button]:leading-none forge:[&_button]:text-text-secondary forge:[&_button]:transition-colors forge:[&_button]:hover:bg-bg-input-hover forge:[&_button]:hover:text-text-primary forge:[&_button:first-child]:border-l-0 forge:[&.forge3d-open_.forge3d-wbg-label]:bg-bg-input-hover forge:[&.forge3d-open_.forge3d-wbg-label]:text-text-primary forge:[&.forge3d-open_.forge3d-chevron-icon]:rotate-180" :class="{ 'forge3d-open': switcherOpen }">
                <button type="button" class="forge3d-wbg-label" :aria-expanded="switcherOpen" @click="emit('update:switcherOpen', !switcherOpen)">
                  <span>Canvass</span>
                  <svg class="forge3d-chevron-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
                </button>
                <button type="button" class="forge:!font-semibold forge:!text-acid forge:hover:!bg-[color-mix(in_srgb,var(--acid)_12%,transparent)] forge:hover:!text-acid" :disabled="busy" @click="emit('create-canvas')">New</button>
              </div>
              <div v-if="switcherOpen" class="forge:absolute forge:left-0 forge:top-[calc(100%+8px)] forge:z-30 forge:flex forge:max-h-[min(70vh,520px)] forge:w-[300px] forge:flex-col forge:gap-1.5 forge:overflow-hidden forge:overflow-y-auto forge:rounded-xl forge:border forge:border-line-strong forge:bg-bg-input forge:p-2 forge:shadow-popover">
                <div class="forge:flex forge:items-center forge:justify-between forge:px-1.5 forge:pb-0.5 forge:pt-1"><span class="forge:font-mono forge:text-[9px] forge:font-medium forge:tracking-[.12em] forge:text-text-muted">CANVASS · {{ canvases.length }}</span></div>
                <div class="forge:flex forge:flex-col forge:gap-[3px] forge:overflow-auto">
                  <button v-for="canvas in canvases" :key="canvas.id" class="forge:w-full forge:rounded-[9px] forge:border forge:border-transparent forge:bg-transparent forge:p-3 forge:text-left forge:transition-colors forge:hover:border-line forge:hover:bg-bg-input-hover forge:[&.forge3d-active]:border-line-strong forge:[&.forge3d-active]:bg-bg-input-hover forge:[&_small]:mt-[5px] forge:[&_small]:block forge:[&_small]:font-mono forge:[&_small]:text-[9px] forge:[&_small]:text-text-muted forge:[&_span]:text-xs" :class="{ 'forge3d-active': activeCanvas?.id === canvas.id }" @click="emit('open-canvas', canvas.id)" @contextmenu="emit('canvas-context-menu', { event: $event, canvas })">
                    <span>{{ canvas.name }}</span><small>{{ canvas.nodeCount }} nodes · v{{ canvas.revision }}</small>
                  </button>
                </div>
                <p class="forge:mx-1 forge:mb-0 forge:mt-0.5 forge:font-mono forge:text-[9px] forge:leading-[1.5] forge:text-text-muted">Right-click a canvas for export, duplicate, or delete.</p>
              </div>
            </div>
            <button class="forge:h-[34px] forge:rounded-lg forge:border forge:border-line-strong forge:bg-bg-input forge:px-3 forge:font-mono forge:text-[10px] forge:font-medium forge:text-text-secondary forge:transition-colors forge:hover:border-acid forge:hover:bg-[color-mix(in_srgb,var(--acid)_8%,var(--bg-input))] forge:hover:text-acid forge:[&.forge3d-dragging]:border-acid forge:[&.forge3d-dragging]:bg-[color-mix(in_srgb,var(--acid)_8%,var(--bg-input))] forge:[&.forge3d-dragging]:text-acid" :class="{ 'forge3d-dragging': importDragging }" type="button" :disabled="busy" @click="importInput.click()" @dragover="onImportDragOver" @dragleave="importDragging = false" @drop="onImportDrop">{{ importDragging ? 'Drop JSON' : 'Import JSON' }}</button>
            <input ref="importInput" class="forge:hidden" type="file" accept="application/json,.json" @change="importCanvas" />
          </div>
        </div>
      </template>
      <strong v-else class="forge:block forge:mt-[3px] forge:text-sm forge:truncate">{{ activeCanvas.name }}</strong>
    </div>
    <div class="forge:col-start-3 forge:flex forge:items-center forge:gap-2 forge:pr-4 forge:max-[760px]:col-start-auto forge:max-[760px]:justify-end forge:max-[760px]:pr-2">
      <div v-if="workspaceMode === 'canvas'" class="forge:flex forge:h-[30px] forge:overflow-hidden forge:rounded-md forge:border forge:border-line-subtle forge:bg-bg-input forge:[&_button]:flex forge:[&_button]:h-full forge:[&_button]:min-w-[58px] forge:[&_button]:items-center forge:[&_button]:justify-center forge:[&_button]:gap-[5px] forge:[&_button]:border-0 forge:[&_button]:bg-transparent forge:[&_button]:px-[11px] forge:[&_button]:font-mono forge:[&_button]:text-[9px] forge:[&_button]:font-semibold forge:[&_button]:uppercase forge:[&_button]:tracking-[.04em] forge:[&_button]:text-text-muted forge:[&_button]:transition-colors forge:[&_button]:hover:bg-[color-mix(in_srgb,var(--acid)_12%,var(--bg-input))] forge:[&_button]:hover:text-acid forge:[&_button.forge3d-active]:bg-[color-mix(in_srgb,var(--acid)_12%,var(--bg-input))] forge:[&_button.forge3d-active]:text-acid forge:[&_button:first-child]:border-r forge:[&_button:first-child]:border-line-subtle forge:[&_svg]:size-3 forge:[&_svg]:fill-current" role="group" aria-label="Workspace view">
        <button type="button" :class="{ 'forge3d-active': canvasView === 'canvas' }" :aria-pressed="canvasView === 'canvas'" title="Canvas canvas" @click="emit('update:canvasView', 'canvas')"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="5.2" height="5.2" rx="1.2" /><rect x="8.8" y="2" width="5.2" height="5.2" rx="1.2" /><rect x="2" y="8.8" width="5.2" height="5.2" rx="1.2" /><rect x="8.8" y="8.8" width="5.2" height="5.2" rx="1.2" /></svg><span>Canvas</span></button>
        <button type="button" :class="{ 'forge3d-active': canvasView === 'assets' }" :aria-pressed="canvasView === 'assets'" title="Asset library" @click="emit('update:canvasView', 'assets')"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3.5" width="9" height="7" rx="1.4" /><rect x="5" y="6" width="9" height="7" rx="1.4" opacity=".5" /></svg><span>Assets</span></button>
      </div>
      <span class="forge:w-[15ch] forge:truncate forge:text-right forge:font-mono forge:text-[9px] forge:text-text-muted forge:max-[1200px]:hidden" :title="editorName ? `${editorName} is editing` : savedState">{{ editorName ? `${editorName} editing` : canEdit ? `Editing · ${savedState}` : savedState }}</span>
      <div class="forge:flex forge:h-9 forge:gap-0.5 forge:rounded-lg forge:border forge:border-line-strong forge:bg-bg-primary forge:p-[3px] forge:max-[1200px]:hidden forge:[&_button]:h-7 forge:[&_button]:min-w-11 forge:[&_button]:rounded forge:[&_button]:border-0 forge:[&_button]:bg-transparent forge:[&_button]:px-[7px] forge:[&_button]:font-mono forge:[&_button]:text-[8px] forge:[&_button]:font-medium forge:[&_button]:uppercase forge:[&_button]:text-text-muted forge:[&_button]:transition-colors forge:[&_button]:hover:bg-bg-input-hover forge:[&_button]:hover:text-text-primary forge:[&_button.forge3d-active]:bg-bg-active forge:[&_button.forge3d-active]:text-acid" aria-label="Theme">
        <button v-for="option in ['light', 'dark', 'system']" :key="option" :class="{ 'forge3d-active': theme === option }" :aria-pressed="theme === option" @click="emit('set-theme', option)">{{ option }}</button>
      </div>
      <div v-if="account" class="forge:flex forge:h-9 forge:items-center forge:gap-2 forge:whitespace-nowrap forge:rounded-[9px] forge:border forge:border-line-strong forge:bg-bg-input forge:py-0 forge:pl-[5px] forge:pr-[10px] forge:max-[760px]:pr-[7px]" :title="`${account.name} · ${account.balance} credits`">
        <span class="forge:grid forge:size-[26px] forge:place-items-center forge:rounded-[7px] forge:bg-acid forge:font-mono forge:text-[10px] forge:font-semibold forge:leading-none forge:text-text-inverse" aria-hidden="true">{{ account.name.slice(0, 1).toUpperCase() }}</span>
        <span class="forge:max-w-[120px] forge:truncate forge:text-[10px] forge:font-semibold forge:leading-none forge:max-[760px]:hidden">{{ account.name }}</span>
        <span class="forge:flex forge:items-center forge:gap-[3px] forge:font-mono forge:text-[10px] forge:font-semibold forge:leading-none forge:text-acid forge:[&_svg]:size-3"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.2 1.5 3.8 8.6h3.5L6.8 14.5l5.4-7.1H8.7l.5-5.9Z" fill="currentColor" /></svg>{{ account.balance }}</span>
      </div>
    </div>
  </header>
</template>
