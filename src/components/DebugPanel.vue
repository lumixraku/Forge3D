<script setup lang="ts">
import { bizClass } from '../class-prefix'
import { computed, ref, watch } from 'vue'
import type { RunProvider } from '../composables/useDebugSettings'

const props = defineProps<{
  open: boolean
  activeProvider: RunProvider
  tripoAvailable: boolean
  meshyAvailable: boolean
  tripoNodeTypes: string[]
  meshyNodeTypes: string[]
  error: string
  // A getter rather than the document itself: serializing the canvas on every
  // node edit to fill a prop nobody reads until the button is pressed would be
  // wasted work.
  readCanvasJson: () => string | null
}>()
const emit = defineEmits<{ 'update:open': [boolean]; 'set-provider': [RunProvider] }>()

const PROVIDER_LABELS: Record<RunProvider, string> = { mock: 'Mock', tripo: 'Tripo API', meshy: 'Meshy API' }
// Null for the simulation; the bare name otherwise, for "Backed by …" copy.
const activeProviderName = computed(() => (props.activeProvider === 'tripo' ? 'Tripo' : props.activeProvider === 'meshy' ? 'Meshy' : null))
// The node types the active real backend actually executes; everything else
// stays simulated even when a real provider is selected.
const activeNodeTypes = computed(() => (props.activeProvider === 'tripo' ? props.tripoNodeTypes : props.activeProvider === 'meshy' ? props.meshyNodeTypes : []))

type Corner = 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right'

const CORNERS: Corner[] = ['bottom-left', 'bottom-right', 'top-left', 'top-right']
const STORAGE_KEY = 'forge3d.debugBallCorner'
const MARGIN = 18
const BALL = 52
// Below this the gesture is a click, above it a drag, so a slightly unsteady
// press still opens the panel.
const DRAG_THRESHOLD = 4

function storedCorner(): Corner {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return CORNERS.includes(value as Corner) ? (value as Corner) : 'bottom-left'
  } catch {
    // Private browsing or a blocked store; the default corner is fine.
    return 'bottom-left'
  }
}

const corner = ref<Corner>(storedCorner())
// Non-null only while dragging: the ball's top-left in viewport coordinates.
const dragAt = ref<{ x: number; y: number } | null>(null)
const dragging = ref(false)

// While dragging the ball follows the pointer; otherwise it sits in its corner.
// The panel opens away from the edges the ball is pinned to, so it stays on
// screen in all four corners.
// All four edges are always set, because Vue merges style objects rather than
// replacing them: returning only `left`/`top` while dragging would leave the
// docked `right`/`bottom` in place and pin the ball to two opposite edges.
const dockStyle = computed(() => {
  if (dragAt.value) {
    return { left: `${dragAt.value.x}px`, top: `${dragAt.value.y}px`, right: 'auto', bottom: 'auto' }
  }
  const [edgeY, edgeX] = corner.value.split('-')
  return {
    left: edgeX === 'left' ? `${MARGIN}px` : 'auto',
    right: edgeX === 'right' ? `${MARGIN}px` : 'auto',
    top: edgeY === 'top' ? `${MARGIN}px` : 'auto',
    bottom: edgeY === 'bottom' ? `${MARGIN}px` : 'auto',
  }
})

const atTop = computed(() => corner.value.startsWith('top'))
const atLeft = computed(() => corner.value.endsWith('left'))

function nearestCorner(x: number, y: number): Corner {
  const vertical = y + BALL / 2 < window.innerHeight / 2 ? 'top' : 'bottom'
  const horizontal = x + BALL / 2 < window.innerWidth / 2 ? 'left' : 'right'
  return `${vertical}-${horizontal}` as Corner
}

function onPointerDown(event: PointerEvent) {
  // Only a primary press drags; let anything else fall through to the click.
  if (event.button !== 0) return
  const ball = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const grabX = event.clientX - ball.left
  const grabY = event.clientY - ball.top
  const startX = event.clientX
  const startY = event.clientY
  let moved = false

  const onMove = (move: PointerEvent) => {
    if (!moved && Math.hypot(move.clientX - startX, move.clientY - startY) < DRAG_THRESHOLD) return
    moved = true
    dragging.value = true
    // Clamped so the ball cannot be dropped past an edge and stranded.
    dragAt.value = {
      x: Math.min(Math.max(move.clientX - grabX, MARGIN), window.innerWidth - BALL - MARGIN),
      y: Math.min(Math.max(move.clientY - grabY, MARGIN), window.innerHeight - BALL - MARGIN),
    }
  }

  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
    if (dragAt.value) setCorner(nearestCorner(dragAt.value.x, dragAt.value.y))
    dragAt.value = null
    // Cleared after the click handler runs, so a drag does not toggle the panel.
    requestAnimationFrame(() => { dragging.value = false })
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
}

function setCorner(next: Corner) {
  corner.value = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // Not remembering the corner does not stop it applying now.
  }
}

function onBallClick() {
  if (dragging.value) return
  emit('update:open', !props.open)
}

const copyState = ref<'idle' | 'copied' | 'failed'>('idle')
// Reopening the panel should not show the outcome of a copy from a canvas that
// may no longer be the open one.
watch(() => props.open, () => { copyState.value = 'idle' })

// Plain text, not the binary fragment format the canvas copy uses: this is for
// reading and pasting elsewhere, so it has to arrive as JSON.
async function copyCanvasJson() {
  const json = props.readCanvasJson()
  if (!json) {
    copyState.value = 'failed'
    return
  }
  try {
    await navigator.clipboard.writeText(json)
    copyState.value = 'copied'
  } catch {
    copyState.value = 'failed'
  }
}
</script>

<template>
  <div class="forge:fixed forge:z-[60] forge:flex forge:flex-col forge:items-start forge:gap-2.5 forge:pointer-events-none forge:[&.forge3d-at-top]:flex-col-reverse forge:[&:not(.forge3d-at-left)]:items-end forge:[&>*]:pointer-events-auto forge:[&.forge3d-dragging_.forge3d-debug-ball]:cursor-grabbing forge:[&.forge3d-dragging_.forge3d-debug-ball]:transform-none" :class="{ 'forge3d-at-top': atTop, 'forge3d-at-left': atLeft, 'forge3d-dragging': dragging }" :style="dockStyle">
    <aside v-if="props.open" class="forge:w-[268px] forge:overflow-hidden forge:rounded-[10px] forge:border forge:border-line-strong forge:bg-bg-card forge:font-sans forge:shadow-popover" role="dialog" aria-label="Debug settings">
      <header class="forge:flex forge:items-center forge:justify-between forge:border-b forge:border-line forge:px-3 forge:py-[9px] forge:font-mono forge:text-[10px] forge:font-semibold forge:tracking-[.08em] forge:text-text-secondary">
        <span>DEBUG</span>
        <button class="forge:border-0 forge:bg-transparent forge:text-[15px] forge:leading-none forge:text-text-muted forge:hover:text-text-primary" type="button" aria-label="Close debug panel" @click="emit('update:open', false)">×</button>
      </header>

      <section class="forge:p-3 forge:[&_h3]:mb-2 forge:[&_h3]:mt-0 forge:[&_h3]:font-mono forge:[&_h3]:text-[9px] forge:[&_h3]:font-semibold forge:[&_h3]:uppercase forge:[&_h3]:tracking-[.07em] forge:[&_h3]:text-text-muted">
        <h3>Node execution</h3>
        <div class="forge:flex forge:flex-col forge:gap-[5px] forge:[&_button]:flex forge:[&_button]:flex-col forge:[&_button]:gap-px forge:[&_button]:rounded-md forge:[&_button]:border forge:[&_button]:border-line forge:[&_button]:bg-bg-input forge:[&_button]:px-[9px] forge:[&_button]:py-[7px] forge:[&_button]:text-left forge:[&_button]:hover:bg-bg-input-hover forge:[&_button.forge3d-selected]:border-acid forge:[&_button.forge3d-selected]:bg-bg-active forge:[&_strong]:text-xs forge:[&_strong]:font-medium forge:[&_strong]:text-text-primary forge:[&_small]:text-[10px] forge:[&_small]:text-text-muted" role="radiogroup" aria-label="Execution provider">
          <button
            type="button"
            role="radio"
            :aria-checked="props.activeProvider === 'mock'"
            :class="{ 'forge3d-selected': props.activeProvider === 'mock' }"
            @click="emit('set-provider', 'mock')"
          >
            <strong>Mock</strong>
            <small>Simulated · no credits</small>
          </button>
          <button
            type="button"
            role="radio"
            :aria-checked="props.activeProvider === 'tripo'"
            :disabled="!props.tripoAvailable"
            :class="{ 'forge3d-selected': props.activeProvider === 'tripo' }"
            :title="props.tripoAvailable ? '' : 'Set TRIPO_API_KEY and restart the API server'"
            @click="emit('set-provider', 'tripo')"
          >
            <strong>Tripo API</strong>
            <small>{{ props.tripoAvailable ? 'Real 3D · spends credits' : 'No API key' }}</small>
          </button>
          <button
            type="button"
            role="radio"
            :aria-checked="props.activeProvider === 'meshy'"
            :disabled="!props.meshyAvailable"
            :class="{ 'forge3d-selected': props.activeProvider === 'meshy' }"
            :title="props.meshyAvailable ? '' : 'Set MESHY_API_KEY and restart the API server'"
            @click="emit('set-provider', 'meshy')"
          >
            <strong>Meshy API</strong>
            <small>{{ props.meshyAvailable ? 'Real 3D · spends credits' : 'No API key' }}</small>
          </button>
        </div>
      </section>

      <section class="forge:border-t forge:border-line-subtle forge:p-3 forge:[&_h3]:mb-2 forge:[&_h3]:mt-0 forge:[&_h3]:font-mono forge:[&_h3]:text-[9px] forge:[&_h3]:font-semibold forge:[&_h3]:uppercase forge:[&_h3]:tracking-[.07em] forge:[&_h3]:text-text-muted">
        <h3>Active</h3>
        <p class="forge:m-0 forge:flex forge:items-center forge:gap-[7px] forge:text-xs forge:text-text-primary forge:[&_i]:size-[7px] forge:[&_i]:rounded-full forge:[&_i]:bg-text-muted forge:[&.forge3d-tripo_i]:bg-acid forge:[&.forge3d-tripo_i]:shadow-[0_0_6px_var(--acid)] forge:[&.forge3d-meshy_i]:bg-acid forge:[&.forge3d-meshy_i]:shadow-[0_0_6px_var(--acid)] forge:[&_b]:ml-auto forge:[&_b]:font-mono forge:[&_b]:text-[9px] forge:[&_b]:font-medium forge:[&_b]:tracking-[.04em] forge:[&_b]:text-acid" :class="bizClass(props.activeProvider)">
          <i />
          <span>{{ PROVIDER_LABELS[props.activeProvider] }}</span>
          <b v-if="activeProviderName">spends credits</b>
        </p>
        <p v-if="activeProviderName" class="forge:mb-0 forge:mt-[7px] forge:text-[10px] forge:leading-[1.45] forge:text-text-muted">
          Backed by {{ activeProviderName }}: {{ activeNodeTypes.join(', ') }}. Other node types stay simulated.
        </p>
        <p v-if="props.error" class="forge:mb-0 forge:mt-[7px] forge:text-[10px] forge:leading-[1.45] forge:text-status-failed">{{ props.error }}</p>
      </section>

      <section class="forge:border-t forge:border-line-subtle forge:p-3 forge:[&_h3]:mb-2 forge:[&_h3]:mt-0 forge:[&_h3]:font-mono forge:[&_h3]:text-[9px] forge:[&_h3]:font-semibold forge:[&_h3]:uppercase forge:[&_h3]:tracking-[.07em] forge:[&_h3]:text-text-muted">
        <h3>Canvas</h3>
        <button
          class="forge:flex forge:w-full forge:flex-col forge:gap-px forge:rounded-md forge:border forge:border-line forge:bg-bg-input forge:px-[9px] forge:py-[7px] forge:text-left forge:hover:bg-bg-input-hover forge:[&_strong]:text-xs forge:[&_strong]:font-medium forge:[&_strong]:text-text-primary forge:[&_small]:text-[10px] forge:[&_small]:text-text-muted"
          type="button"
          @click="copyCanvasJson"
        >
          <strong>Copy canvas JSON</strong>
          <small>{{ copyState === 'copied' ? 'Copied to clipboard' : copyState === 'failed' ? 'Could not copy this canvas' : 'The open canvas document as text' }}</small>
        </button>
      </section>
    </aside>

    <button
      type="button"
      class="forge3d-debug-ball forge:flex forge:size-[52px] forge:cursor-pointer forge:flex-col forge:items-center forge:justify-center forge:gap-0.5 forge:rounded-full forge:border forge:border-line-strong forge:bg-bg-card forge:font-mono forge:text-[9px] forge:font-semibold forge:tracking-[.04em] forge:text-text-secondary forge:shadow-md forge:transition-[transform,border-color,color] forge:hover:-translate-y-px forge:hover:border-acid forge:hover:text-text-primary forge:[&.forge3d-open]:border-acid forge:[&.forge3d-open]:text-text-primary forge:[&_i]:size-[7px] forge:[&_i]:rounded-full forge:[&_i]:bg-text-muted forge:[&.forge3d-tripo_i]:bg-acid forge:[&.forge3d-tripo_i]:shadow-[0_0_6px_var(--acid)] forge:[&.forge3d-tripo]:text-text-primary forge:[&.forge3d-meshy_i]:bg-acid forge:[&.forge3d-meshy_i]:shadow-[0_0_6px_var(--acid)] forge:[&.forge3d-meshy]:text-text-primary"
      :class="[bizClass(props.activeProvider), { 'forge3d-open': props.open }]"
      :aria-expanded="props.open"
      :aria-label="`Debug settings · running on ${PROVIDER_LABELS[props.activeProvider]} · drag to move`"
      @pointerdown="onPointerDown"
      @click="onBallClick"
    >
      <i />
      <span>{{ activeProviderName ? 'API' : 'MOCK' }}</span>
    </button>
  </div>
</template>
