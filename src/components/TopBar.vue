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
  <header class="relative z-10 grid grid-cols-[350px_1fr_auto] items-center border-b border-line bg-bg-tertiary transition-colors duration-200 max-[1200px]:grid-cols-[310px_1fr_auto] max-[760px]:sticky max-[760px]:top-0 max-[760px]:grid-cols-[auto_1fr]">
    <div class="flex h-full items-center gap-3 border-r border-line px-[18px] max-[760px]:border-r-0">
      <span class="brand-mark grid place-items-center w-[35px] h-[35px] rounded-[10px] bg-acid text-text-inverse font-mono font-semibold text-xs transition-all duration-150 hover:scale-105 hover:shadow-[0_0_0_3px] hover:shadow-acid/20">F3</span>
      <div><strong class="block font-mono font-semibold text-sm tracking-[-0.03em]">Forge3D</strong><small class="block mt-[2px] text-text-muted text-[11px]">Conversational canvas studio</small></div>
    </div>
    <!-- No canvas yet: the switcher and New still have to be reachable, or the
         first canvas can never be created. -->
    <div v-if="!activeCanvas" class="relative flex min-w-0 items-center gap-3 px-6" @pointerdown.stop>
      <span class="flex-none font-mono text-[9px] font-medium uppercase tracking-[.12em] text-text-muted">NO CANVAS</span>
      <div class="flex min-w-0 flex-[0_1_auto] items-center gap-3">
        <div ref="switcherAnchor" class="relative flex-none">
          <div class="flex h-9 flex-none items-stretch overflow-hidden rounded-lg border border-line-strong bg-bg-input transition-colors [&_button]:flex [&_button]:h-full [&_button]:items-center [&_button]:gap-1.5 [&_button]:border-0 [&_button]:border-l [&_button]:border-line [&_button]:bg-transparent [&_button]:px-3 [&_button]:text-[11px] [&_button]:font-medium [&_button]:leading-none [&_button]:text-text-secondary [&_button]:transition-colors [&_button]:hover:bg-bg-input-hover [&_button]:hover:text-text-primary [&_button:first-child]:border-l-0 [&.open_.wbg-label]:bg-bg-input-hover [&.open_.wbg-label]:text-text-primary [&.open_.chevron-icon]:rotate-180" :class="{ open: switcherOpen }">
            <button type="button" class="wbg-label" :aria-expanded="switcherOpen" @click="emit('update:switcherOpen', !switcherOpen)">
              <span>Canvass</span>
              <svg class="chevron-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </button>
            <button type="button" class="!font-semibold !text-acid hover:!bg-[color-mix(in_srgb,var(--acid)_12%,transparent)] hover:!text-acid" :disabled="busy" @click="emit('create-canvas')">New</button>
          </div>
          <div v-if="switcherOpen" class="absolute left-0 top-[calc(100%+8px)] z-30 flex max-h-[min(70vh,520px)] w-[300px] flex-col gap-1.5 overflow-hidden overflow-y-auto rounded-xl border border-line-strong bg-bg-input p-2 shadow-popover">
            <div class="flex items-center justify-between px-1.5 pb-0.5 pt-1"><span class="font-mono text-[9px] font-medium tracking-[.12em] text-text-muted">CANVASS · {{ canvases.length }}</span></div>
            <div class="flex flex-col gap-[3px] overflow-auto">
              <button v-for="canvas in canvases" :key="canvas.id" class="w-full rounded-[9px] border border-transparent bg-transparent p-3 text-left transition-colors hover:border-line hover:bg-bg-input-hover [&_small]:mt-[5px] [&_small]:block [&_small]:font-mono [&_small]:text-[9px] [&_small]:text-text-muted [&_span]:text-xs" @click="emit('open-canvas', canvas.id)" @contextmenu="emit('canvas-context-menu', { event: $event, canvas })">
                <span>{{ canvas.name }}</span><small>{{ canvas.nodeCount }} nodes · v{{ canvas.revision }}</small>
              </button>
              <p v-if="!canvases.length" class="mx-1 mb-0 mt-0.5 font-mono text-[9px] leading-[1.5] text-text-muted">No canvases yet. Press New to create one.</p>
            </div>
          </div>
        </div>
        <button class="h-[34px] rounded-lg border border-line-strong bg-bg-input px-3 font-mono text-[10px] font-medium text-text-secondary transition-colors hover:border-acid hover:bg-[color-mix(in_srgb,var(--acid)_8%,var(--bg-input))] hover:text-acid [&.dragging]:border-acid [&.dragging]:bg-[color-mix(in_srgb,var(--acid)_8%,var(--bg-input))] [&.dragging]:text-acid" :class="{ dragging: importDragging }" type="button" :disabled="busy" @click="importInput.click()" @dragover="onImportDragOver" @dragleave="importDragging = false" @drop="onImportDrop">{{ importDragging ? 'Drop JSON' : 'Import JSON' }}</button>
        <input ref="importInput" class="hidden" type="file" accept="application/json,.json" @change="importCanvas" />
      </div>
    </div>
    <div v-else class="relative flex min-w-0 items-center gap-3 px-6" @pointerdown.stop>
      <span class="flex-none font-mono text-[9px] font-medium uppercase tracking-[.12em] text-text-muted">{{ workspaceMode === 'canvas' ? 'CANVAS' : 'MODEL EDITOR' }} / {{ activeCanvas.revision.toString().padStart(2, '0') }}</span>
      <input v-if="renaming" ref="nameInput" v-model="nameDraft" class="mt-[3px] block w-full border-0 bg-transparent p-0 text-sm font-bold leading-5 shadow-[inset_0_-1px_0_var(--acid)] outline-none" type="text" @keydown.enter.prevent="commitRename" @keydown.esc.prevent="cancelRename" @blur="commitRename" />
      <template v-else-if="workspaceMode === 'canvas'">
        <div class="flex min-w-0 flex-[0_1_auto] items-center gap-3">
          <strong class="min-w-0 flex-[0_1_auto] cursor-text truncate text-sm font-bold" title="Double-click to rename" @dblclick="startRename">{{ activeCanvas.name }}</strong>
          <div class="flex flex-none items-center gap-2">
            <div ref="switcherAnchor" class="relative flex-none">
              <div class="flex h-9 flex-none items-stretch overflow-hidden rounded-lg border border-line-strong bg-bg-input transition-colors [&_button]:flex [&_button]:h-full [&_button]:items-center [&_button]:gap-1.5 [&_button]:border-0 [&_button]:border-l [&_button]:border-line [&_button]:bg-transparent [&_button]:px-3 [&_button]:text-[11px] [&_button]:font-medium [&_button]:leading-none [&_button]:text-text-secondary [&_button]:transition-colors [&_button]:hover:bg-bg-input-hover [&_button]:hover:text-text-primary [&_button:first-child]:border-l-0 [&.open_.wbg-label]:bg-bg-input-hover [&.open_.wbg-label]:text-text-primary [&.open_.chevron-icon]:rotate-180" :class="{ open: switcherOpen }">
                <button type="button" class="wbg-label" :aria-expanded="switcherOpen" @click="emit('update:switcherOpen', !switcherOpen)">
                  <span>Canvass</span>
                  <svg class="chevron-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
                </button>
                <button type="button" class="!font-semibold !text-acid hover:!bg-[color-mix(in_srgb,var(--acid)_12%,transparent)] hover:!text-acid" :disabled="busy" @click="emit('create-canvas')">New</button>
              </div>
              <div v-if="switcherOpen" class="absolute left-0 top-[calc(100%+8px)] z-30 flex max-h-[min(70vh,520px)] w-[300px] flex-col gap-1.5 overflow-hidden overflow-y-auto rounded-xl border border-line-strong bg-bg-input p-2 shadow-popover">
                <div class="flex items-center justify-between px-1.5 pb-0.5 pt-1"><span class="font-mono text-[9px] font-medium tracking-[.12em] text-text-muted">CANVASS · {{ canvases.length }}</span></div>
                <div class="flex flex-col gap-[3px] overflow-auto">
                  <button v-for="canvas in canvases" :key="canvas.id" class="w-full rounded-[9px] border border-transparent bg-transparent p-3 text-left transition-colors hover:border-line hover:bg-bg-input-hover [&.active]:border-line-strong [&.active]:bg-bg-input-hover [&_small]:mt-[5px] [&_small]:block [&_small]:font-mono [&_small]:text-[9px] [&_small]:text-text-muted [&_span]:text-xs" :class="{ active: activeCanvas?.id === canvas.id }" @click="emit('open-canvas', canvas.id)" @contextmenu="emit('canvas-context-menu', { event: $event, canvas })">
                    <span>{{ canvas.name }}</span><small>{{ canvas.nodeCount }} nodes · v{{ canvas.revision }}</small>
                  </button>
                </div>
                <p class="mx-1 mb-0 mt-0.5 font-mono text-[9px] leading-[1.5] text-text-muted">Right-click a canvas for export, duplicate, or delete.</p>
              </div>
            </div>
            <button class="h-[34px] rounded-lg border border-line-strong bg-bg-input px-3 font-mono text-[10px] font-medium text-text-secondary transition-colors hover:border-acid hover:bg-[color-mix(in_srgb,var(--acid)_8%,var(--bg-input))] hover:text-acid [&.dragging]:border-acid [&.dragging]:bg-[color-mix(in_srgb,var(--acid)_8%,var(--bg-input))] [&.dragging]:text-acid" :class="{ dragging: importDragging }" type="button" :disabled="busy" @click="importInput.click()" @dragover="onImportDragOver" @dragleave="importDragging = false" @drop="onImportDrop">{{ importDragging ? 'Drop JSON' : 'Import JSON' }}</button>
            <input ref="importInput" class="hidden" type="file" accept="application/json,.json" @change="importCanvas" />
          </div>
        </div>
      </template>
      <strong v-else class="block mt-[3px] text-sm truncate">{{ activeCanvas.name }}</strong>
    </div>
    <div class="col-start-3 flex items-center gap-2 pr-4 max-[760px]:col-start-auto max-[760px]:justify-end max-[760px]:pr-2">
      <div v-if="workspaceMode === 'canvas'" class="flex h-[30px] overflow-hidden rounded-md border border-line-subtle bg-bg-input [&_button]:flex [&_button]:h-full [&_button]:min-w-[58px] [&_button]:items-center [&_button]:justify-center [&_button]:gap-[5px] [&_button]:border-0 [&_button]:bg-transparent [&_button]:px-[11px] [&_button]:font-mono [&_button]:text-[9px] [&_button]:font-semibold [&_button]:uppercase [&_button]:tracking-[.04em] [&_button]:text-text-muted [&_button]:transition-colors [&_button]:hover:bg-[color-mix(in_srgb,var(--acid)_12%,var(--bg-input))] [&_button]:hover:text-acid [&_button.active]:bg-[color-mix(in_srgb,var(--acid)_12%,var(--bg-input))] [&_button.active]:text-acid [&_button:first-child]:border-r [&_button:first-child]:border-line-subtle [&_svg]:size-3 [&_svg]:fill-current" role="group" aria-label="Workspace view">
        <button type="button" :class="{ active: canvasView === 'canvas' }" :aria-pressed="canvasView === 'canvas'" title="Canvas canvas" @click="emit('update:canvasView', 'canvas')"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="5.2" height="5.2" rx="1.2" /><rect x="8.8" y="2" width="5.2" height="5.2" rx="1.2" /><rect x="2" y="8.8" width="5.2" height="5.2" rx="1.2" /><rect x="8.8" y="8.8" width="5.2" height="5.2" rx="1.2" /></svg><span>Canvas</span></button>
        <button type="button" :class="{ active: canvasView === 'assets' }" :aria-pressed="canvasView === 'assets'" title="Asset library" @click="emit('update:canvasView', 'assets')"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3.5" width="9" height="7" rx="1.4" /><rect x="5" y="6" width="9" height="7" rx="1.4" opacity=".5" /></svg><span>Assets</span></button>
      </div>
      <span class="w-[15ch] truncate text-right font-mono text-[9px] text-text-muted max-[1200px]:hidden" :title="editorName ? `${editorName} is editing` : savedState">{{ editorName ? `${editorName} editing` : canEdit ? `Editing · ${savedState}` : savedState }}</span>
      <div class="flex h-9 gap-0.5 rounded-lg border border-line-strong bg-bg-primary p-[3px] max-[1200px]:hidden [&_button]:h-7 [&_button]:min-w-11 [&_button]:rounded [&_button]:border-0 [&_button]:bg-transparent [&_button]:px-[7px] [&_button]:font-mono [&_button]:text-[8px] [&_button]:font-medium [&_button]:uppercase [&_button]:text-text-muted [&_button]:transition-colors [&_button]:hover:bg-bg-input-hover [&_button]:hover:text-text-primary [&_button.active]:bg-bg-active [&_button.active]:text-acid" aria-label="Theme">
        <button v-for="option in ['light', 'dark', 'system']" :key="option" :class="{ active: theme === option }" :aria-pressed="theme === option" @click="emit('set-theme', option)">{{ option }}</button>
      </div>
      <div v-if="account" class="flex h-9 items-center gap-2 whitespace-nowrap rounded-[9px] border border-line-strong bg-bg-input py-0 pl-[5px] pr-[10px] max-[760px]:pr-[7px]" :title="`${account.name} · ${account.balance} credits`">
        <span class="grid size-[26px] place-items-center rounded-[7px] bg-acid font-mono text-[10px] font-semibold leading-none text-text-inverse" aria-hidden="true">{{ account.name.slice(0, 1).toUpperCase() }}</span>
        <span class="max-w-[120px] truncate text-[10px] font-semibold leading-none max-[760px]:hidden">{{ account.name }}</span>
        <span class="flex items-center gap-[3px] font-mono text-[10px] font-semibold leading-none text-acid [&_svg]:size-3"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.2 1.5 3.8 8.6h3.5L6.8 14.5l5.4-7.1H8.7l.5-5.9Z" fill="currentColor" /></svg>{{ account.balance }}</span>
      </div>
    </div>
  </header>
</template>
