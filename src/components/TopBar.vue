<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue'

const props = defineProps<{
  activeWorkflow: any
  workflows: any[]
  workspaceMode: string
  canvasView: string
  savedState: string
  theme: string
  busy: boolean
  switcherOpen: boolean
}>()
const emit = defineEmits<{
  rename: [name: string]
  'open-workflow': [id: string]
  'create-workflow': []
  'workflow-context-menu': [payload: { event: MouseEvent; workflow: any }]
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
  if (!props.activeWorkflow || props.busy || props.workspaceMode !== 'workflow') return
  nameDraft.value = props.activeWorkflow.name
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
  if (!props.activeWorkflow || !name || name === props.activeWorkflow.name) return
  emit('rename', name)
}

function cancelRename() {
  renaming.value = false
}

function importWorkflow(event) {
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
      <div><strong class="block font-mono font-semibold text-sm tracking-[-0.03em]">Forge3D</strong><small class="block mt-[2px] text-text-muted text-[11px]">Conversational workflow studio</small></div>
    </div>
    <div v-if="activeWorkflow" class="workflow-title min-w-0 px-6" @pointerdown.stop>
      <span class="label-mono">{{ workspaceMode === 'workflow' ? 'WORKFLOW' : 'MODEL EDITOR' }} / {{ activeWorkflow.revision.toString().padStart(2, '0') }}</span>
      <input v-if="renaming" ref="nameInput" v-model="nameDraft" class="workflow-title-input" type="text" @keydown.enter.prevent="commitRename" @keydown.esc.prevent="cancelRename" @blur="commitRename" />
      <template v-else-if="workspaceMode === 'workflow'">
        <div class="workflow-title-bar">
          <strong class="workflow-title-name truncate" title="Double-click to rename" @dblclick="startRename">{{ activeWorkflow.name }}</strong>
          <div class="workflow-title-actions">
            <div ref="switcherAnchor" class="workflow-switcher-anchor">
              <div class="workflow-button-group" :class="{ open: switcherOpen }">
                <button type="button" class="wbg-label" :aria-expanded="switcherOpen" @click="emit('update:switcherOpen', !switcherOpen)">
                  <span>Workflows</span>
                  <svg class="chevron-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
                </button>
                <button type="button" class="wbg-new" :disabled="busy" @click="emit('create-workflow')">New</button>
              </div>
              <div v-if="switcherOpen" class="workflow-switcher-panel">
                <div class="workflow-switcher-head"><span>WORKFLOWS · {{ workflows.length }}</span></div>
                <div class="workflow-switcher-list">
                  <button v-for="workflow in workflows" :key="workflow.id" class="workflow-list-item" :class="{ active: activeWorkflow?.id === workflow.id }" @click="emit('open-workflow', workflow.id)" @contextmenu="emit('workflow-context-menu', { event: $event, workflow })">
                    <span>{{ workflow.name }}</span><small>{{ workflow.nodeCount }} nodes · v{{ workflow.revision }}</small>
                  </button>
                </div>
                <p class="workflow-switcher-note">Right-click a workflow for export, duplicate, or delete.</p>
              </div>
            </div>
            <button class="wbg-import" :class="{ dragging: importDragging }" type="button" :disabled="busy" @click="importInput.click()" @dragover="onImportDragOver" @dragleave="importDragging = false" @drop="onImportDrop">{{ importDragging ? 'Drop JSON' : 'Import JSON' }}</button>
            <input ref="importInput" class="file-input" type="file" accept="application/json,.json" @change="importWorkflow" />
          </div>
        </div>
      </template>
      <strong v-else class="block mt-[3px] text-sm truncate">{{ activeWorkflow.name }}</strong>
    </div>
    <div class="topbar-actions flex items-center gap-2 pr-4">
      <div v-if="workspaceMode === 'workflow'" class="workspace-view-switch" role="group" aria-label="Workspace view">
        <button type="button" :class="{ active: canvasView === 'canvas' }" :aria-pressed="canvasView === 'canvas'" title="Workflow canvas" @click="emit('update:canvasView', 'canvas')"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="5.2" height="5.2" rx="1.2" /><rect x="8.8" y="2" width="5.2" height="5.2" rx="1.2" /><rect x="2" y="8.8" width="5.2" height="5.2" rx="1.2" /><rect x="8.8" y="8.8" width="5.2" height="5.2" rx="1.2" /></svg><span>Canvas</span></button>
        <button type="button" :class="{ active: canvasView === 'assets' }" :aria-pressed="canvasView === 'assets'" title="Asset library" @click="emit('update:canvasView', 'assets')"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3.5" width="9" height="7" rx="1.4" /><rect x="5" y="6" width="9" height="7" rx="1.4" opacity=".5" /></svg><span>Assets</span></button>
      </div>
      <span class="save-state w-[15ch] truncate text-right text-text-muted font-mono text-[9px]">{{ savedState }}</span>
      <div class="theme-switcher" aria-label="Theme">
        <button v-for="option in ['light', 'dark', 'system']" :key="option" :class="{ active: theme === option }" :aria-pressed="theme === option" @click="emit('set-theme', option)">{{ option }}</button>
      </div>
    </div>
  </header>
</template>
