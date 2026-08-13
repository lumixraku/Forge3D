<script setup lang="ts">
import { computed, ref } from 'vue'
import type { RunProvider } from '../composables/useDebugSettings'

const props = defineProps<{
  open: boolean
  selectedProvider: RunProvider | null
  activeProvider: RunProvider
  tripoAvailable: boolean
  tripoNodeTypes: string[]
  error: string
}>()
const emit = defineEmits<{ 'update:open': [boolean]; 'set-provider': [RunProvider | null] }>()

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
</script>

<template>
  <div class="fixed z-[60] flex flex-col items-start gap-2.5 pointer-events-none [&.at-top]:flex-col-reverse [&:not(.at-left)]:items-end [&>*]:pointer-events-auto [&.dragging_.debug-ball]:cursor-grabbing [&.dragging_.debug-ball]:transform-none" :class="{ 'at-top': atTop, 'at-left': atLeft, dragging }" :style="dockStyle">
    <aside v-if="props.open" class="w-[268px] overflow-hidden rounded-[10px] border border-line-strong bg-bg-card font-sans shadow-popover" role="dialog" aria-label="Debug settings">
      <header class="flex items-center justify-between border-b border-line px-3 py-[9px] font-mono text-[10px] font-semibold tracking-[.08em] text-text-secondary">
        <span>DEBUG</span>
        <button class="border-0 bg-transparent text-[15px] leading-none text-text-muted hover:text-text-primary" type="button" aria-label="Close debug panel" @click="emit('update:open', false)">×</button>
      </header>

      <section class="p-3 [&_h3]:mb-2 [&_h3]:mt-0 [&_h3]:font-mono [&_h3]:text-[9px] [&_h3]:font-semibold [&_h3]:uppercase [&_h3]:tracking-[.07em] [&_h3]:text-text-muted">
        <h3>Node execution</h3>
        <div class="flex flex-col gap-[5px] [&_button]:flex [&_button]:flex-col [&_button]:gap-px [&_button]:rounded-md [&_button]:border [&_button]:border-line [&_button]:bg-bg-input [&_button]:px-[9px] [&_button]:py-[7px] [&_button]:text-left [&_button]:hover:bg-bg-input-hover [&_button.selected]:border-acid [&_button.selected]:bg-bg-active [&_strong]:text-xs [&_strong]:font-medium [&_strong]:text-text-primary [&_small]:text-[10px] [&_small]:text-text-muted" role="radiogroup" aria-label="Execution provider">
          <button
            type="button"
            role="radio"
            :aria-checked="props.selectedProvider === null"
            :class="{ selected: props.selectedProvider === null }"
            @click="emit('set-provider', null)"
          >
            <strong>Auto</strong>
            <small>Server default · {{ props.tripoAvailable ? 'Tripo' : 'Mock' }}</small>
          </button>
          <button
            type="button"
            role="radio"
            :aria-checked="props.selectedProvider === 'mock'"
            :class="{ selected: props.selectedProvider === 'mock' }"
            @click="emit('set-provider', 'mock')"
          >
            <strong>Mock</strong>
            <small>Simulated · no credits</small>
          </button>
          <button
            type="button"
            role="radio"
            :aria-checked="props.selectedProvider === 'tripo'"
            :disabled="!props.tripoAvailable"
            :class="{ selected: props.selectedProvider === 'tripo' }"
            :title="props.tripoAvailable ? '' : 'Set TRIPO_API_KEY and restart the API server'"
            @click="emit('set-provider', 'tripo')"
          >
            <strong>Tripo API</strong>
            <small>{{ props.tripoAvailable ? 'Real 3D · spends credits' : 'No API key' }}</small>
          </button>
        </div>
      </section>

      <section class="border-t border-line-subtle p-3 [&_h3]:mb-2 [&_h3]:mt-0 [&_h3]:font-mono [&_h3]:text-[9px] [&_h3]:font-semibold [&_h3]:uppercase [&_h3]:tracking-[.07em] [&_h3]:text-text-muted">
        <h3>Active</h3>
        <p class="m-0 flex items-center gap-[7px] text-xs text-text-primary [&_i]:size-[7px] [&_i]:rounded-full [&_i]:bg-text-muted [&.tripo_i]:bg-acid [&.tripo_i]:shadow-[0_0_6px_var(--acid)] [&_b]:ml-auto [&_b]:font-mono [&_b]:text-[9px] [&_b]:font-medium [&_b]:tracking-[.04em] [&_b]:text-acid" :class="props.activeProvider">
          <i />
          <span>{{ props.activeProvider === 'tripo' ? 'Tripo API' : 'Mock' }}</span>
          <b v-if="props.activeProvider === 'tripo'">spends credits</b>
        </p>
        <p v-if="props.activeProvider === 'tripo'" class="mb-0 mt-[7px] text-[10px] leading-[1.45] text-text-muted">
          Backed by Tripo: {{ props.tripoNodeTypes.join(', ') }}. Other node types stay simulated.
        </p>
        <p v-if="props.error" class="mb-0 mt-[7px] text-[10px] leading-[1.45] text-status-failed">{{ props.error }}</p>
      </section>
    </aside>

    <button
      type="button"
      class="debug-ball flex size-[52px] cursor-pointer flex-col items-center justify-center gap-0.5 rounded-full border border-line-strong bg-bg-card font-mono text-[9px] font-semibold tracking-[.04em] text-text-secondary shadow-md transition-[transform,border-color,color] hover:-translate-y-px hover:border-acid hover:text-text-primary [&.open]:border-acid [&.open]:text-text-primary [&_i]:size-[7px] [&_i]:rounded-full [&_i]:bg-text-muted [&.tripo_i]:bg-acid [&.tripo_i]:shadow-[0_0_6px_var(--acid)] [&.tripo]:text-text-primary"
      :class="[props.activeProvider, { open: props.open }]"
      :aria-expanded="props.open"
      :aria-label="`Debug settings · running on ${props.activeProvider === 'tripo' ? 'Tripo API' : 'Mock'} · drag to move`"
      @pointerdown="onPointerDown"
      @click="onBallClick"
    >
      <i />
      <span>{{ props.activeProvider === 'tripo' ? 'API' : 'MOCK' }}</span>
    </button>
  </div>
</template>
