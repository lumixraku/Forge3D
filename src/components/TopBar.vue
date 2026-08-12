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
  <header class="topbar">
    <div class="brand-lockup flex items-center gap-3 h-full px-[18px] border-r border-line">
      <span class="brand-mark grid place-items-center w-[35px] h-[35px] rounded-[10px] bg-acid text-text-inverse font-mono font-semibold text-xs transition-all duration-150 hover:scale-105 hover:shadow-[0_0_0_3px] hover:shadow-acid/20">F3</span>
      <div><strong class="block font-mono font-semibold text-sm tracking-[-0.03em]">Forge3D</strong><small class="block mt-[2px] text-text-muted text-[11px]">Conversational canvas studio</small></div>
    </div>
    <!-- No canvas yet: the switcher and New still have to be reachable, or the
         first canvas can never be created. -->
    <div v-if="!activeCanvas" class="canvas-title min-w-0 px-6" @pointerdown.stop>
      <span class="label-mono">NO CANVAS</span>
      <div class="canvas-title-bar">
        <div ref="switcherAnchor" class="canvas-switcher-anchor">
          <div class="canvas-button-group" :class="{ open: switcherOpen }">
            <button type="button" class="wbg-label" :aria-expanded="switcherOpen" @click="emit('update:switcherOpen', !switcherOpen)">
              <span>Canvass</span>
              <svg class="chevron-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </button>
            <button type="button" class="wbg-new" :disabled="busy" @click="emit('create-canvas')">New</button>
          </div>
          <div v-if="switcherOpen" class="canvas-switcher-panel">
            <div class="canvas-switcher-head"><span>CANVASS · {{ canvases.length }}</span></div>
            <div class="canvas-switcher-list">
              <button v-for="canvas in canvases" :key="canvas.id" class="canvas-list-item" @click="emit('open-canvas', canvas.id)" @contextmenu="emit('canvas-context-menu', { event: $event, canvas })">
                <span>{{ canvas.name }}</span><small>{{ canvas.nodeCount }} nodes · v{{ canvas.revision }}</small>
              </button>
              <p v-if="!canvases.length" class="canvas-switcher-note">No canvases yet. Press New to create one.</p>
            </div>
          </div>
        </div>
        <button class="wbg-import" :class="{ dragging: importDragging }" type="button" :disabled="busy" @click="importInput.click()" @dragover="onImportDragOver" @dragleave="importDragging = false" @drop="onImportDrop">{{ importDragging ? 'Drop JSON' : 'Import JSON' }}</button>
        <input ref="importInput" class="file-input" type="file" accept="application/json,.json" @change="importCanvas" />
      </div>
    </div>
    <div v-else class="canvas-title min-w-0 px-6" @pointerdown.stop>
      <span class="label-mono">{{ workspaceMode === 'canvas' ? 'CANVAS' : 'MODEL EDITOR' }} / {{ activeCanvas.revision.toString().padStart(2, '0') }}</span>
      <input v-if="renaming" ref="nameInput" v-model="nameDraft" class="canvas-title-input" type="text" @keydown.enter.prevent="commitRename" @keydown.esc.prevent="cancelRename" @blur="commitRename" />
      <template v-else-if="workspaceMode === 'canvas'">
        <div class="canvas-title-bar">
          <strong class="canvas-title-name truncate" title="Double-click to rename" @dblclick="startRename">{{ activeCanvas.name }}</strong>
          <div class="canvas-title-actions">
            <div ref="switcherAnchor" class="canvas-switcher-anchor">
              <div class="canvas-button-group" :class="{ open: switcherOpen }">
                <button type="button" class="wbg-label" :aria-expanded="switcherOpen" @click="emit('update:switcherOpen', !switcherOpen)">
                  <span>Canvass</span>
                  <svg class="chevron-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
                </button>
                <button type="button" class="wbg-new" :disabled="busy" @click="emit('create-canvas')">New</button>
              </div>
              <div v-if="switcherOpen" class="canvas-switcher-panel">
                <div class="canvas-switcher-head"><span>CANVASS · {{ canvases.length }}</span></div>
                <div class="canvas-switcher-list">
                  <button v-for="canvas in canvases" :key="canvas.id" class="canvas-list-item" :class="{ active: activeCanvas?.id === canvas.id }" @click="emit('open-canvas', canvas.id)" @contextmenu="emit('canvas-context-menu', { event: $event, canvas })">
                    <span>{{ canvas.name }}</span><small>{{ canvas.nodeCount }} nodes · v{{ canvas.revision }}</small>
                  </button>
                </div>
                <p class="canvas-switcher-note">Right-click a canvas for export, duplicate, or delete.</p>
              </div>
            </div>
            <button class="wbg-import" :class="{ dragging: importDragging }" type="button" :disabled="busy" @click="importInput.click()" @dragover="onImportDragOver" @dragleave="importDragging = false" @drop="onImportDrop">{{ importDragging ? 'Drop JSON' : 'Import JSON' }}</button>
            <input ref="importInput" class="file-input" type="file" accept="application/json,.json" @change="importCanvas" />
          </div>
        </div>
      </template>
      <strong v-else class="block mt-[3px] text-sm truncate">{{ activeCanvas.name }}</strong>
    </div>
    <div class="topbar-actions flex items-center gap-2 pr-4">
      <div v-if="workspaceMode === 'canvas'" class="workspace-view-switch" role="group" aria-label="Workspace view">
        <button type="button" :class="{ active: canvasView === 'canvas' }" :aria-pressed="canvasView === 'canvas'" title="Canvas canvas" @click="emit('update:canvasView', 'canvas')"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="5.2" height="5.2" rx="1.2" /><rect x="8.8" y="2" width="5.2" height="5.2" rx="1.2" /><rect x="2" y="8.8" width="5.2" height="5.2" rx="1.2" /><rect x="8.8" y="8.8" width="5.2" height="5.2" rx="1.2" /></svg><span>Canvas</span></button>
        <button type="button" :class="{ active: canvasView === 'assets' }" :aria-pressed="canvasView === 'assets'" title="Asset library" @click="emit('update:canvasView', 'assets')"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3.5" width="9" height="7" rx="1.4" /><rect x="5" y="6" width="9" height="7" rx="1.4" opacity=".5" /></svg><span>Assets</span></button>
      </div>
      <span class="save-state w-[15ch] truncate text-right text-text-muted font-mono text-[9px]" :title="editorName ? `${editorName} is editing` : savedState">{{ editorName ? `${editorName} editing` : canEdit ? `Editing · ${savedState}` : savedState }}</span>
      <div class="theme-switcher" aria-label="Theme">
        <button v-for="option in ['light', 'dark', 'system']" :key="option" :class="{ active: theme === option }" :aria-pressed="theme === option" @click="emit('set-theme', option)">{{ option }}</button>
      </div>
      <div v-if="account" class="account-summary" :title="`${account.name} · ${account.balance} credits`">
        <span class="account-avatar" aria-hidden="true">{{ account.name.slice(0, 1).toUpperCase() }}</span>
        <span class="account-name">{{ account.name }}</span>
        <span class="account-balance"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.2 1.5 3.8 8.6h3.5L6.8 14.5l5.4-7.1H8.7l.5-5.9Z" fill="currentColor" /></svg>{{ account.balance }}</span>
      </div>
    </div>
  </header>
</template>
