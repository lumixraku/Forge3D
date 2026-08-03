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
  <div class="debug-dock" :class="{ 'at-top': atTop, 'at-left': atLeft, dragging }" :style="dockStyle">
    <aside v-if="props.open" class="debug-panel bg-bg-card border border-line-strong" role="dialog" aria-label="Debug settings">
      <header>
        <span>DEBUG</span>
        <button type="button" aria-label="Close debug panel" @click="emit('update:open', false)">×</button>
      </header>

      <section>
        <h3>Node execution</h3>
        <div class="debug-options" role="radiogroup" aria-label="Execution provider">
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

      <section>
        <h3>Active</h3>
        <p class="debug-active" :class="props.activeProvider">
          <i />
          <span>{{ props.activeProvider === 'tripo' ? 'Tripo API' : 'Mock' }}</span>
          <b v-if="props.activeProvider === 'tripo'">spends credits</b>
        </p>
        <p v-if="props.activeProvider === 'tripo'" class="debug-note">
          Backed by Tripo: {{ props.tripoNodeTypes.join(', ') }}. Other node types stay simulated.
        </p>
        <p v-if="props.error" class="debug-note error">{{ props.error }}</p>
      </section>
    </aside>

    <button
      type="button"
      class="debug-ball"
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

<style scoped>
/* Position comes from the inline style: a corner while docked, pointer
   coordinates while dragging. The panel precedes the ball in the DOM, so
   `column` puts the ball last (nearest a bottom edge) and `column-reverse` puts
   it first (nearest a top edge). Either way the ball stays pinned to its corner
   and the panel grows toward the middle of the screen, instead of the ball
   jumping when the panel opens. */
.debug-dock {
  position: fixed;
  z-index: 60;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  pointer-events: none;
}
.debug-dock.at-top { flex-direction: column-reverse; }
.debug-dock:not(.at-left) { align-items: flex-end; }
.debug-dock > * { pointer-events: auto; }
.debug-dock.dragging { transition: none; }
.debug-dock.dragging .debug-ball { cursor: grabbing; transform: none; }

.debug-ball {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: 1px solid var(--line-strong);
  background: var(--bg-card);
  box-shadow: var(--shadow-md);
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: .04em;
  cursor: pointer;
  transition: transform .15s ease, border-color .15s ease, color .15s ease;
}
.debug-ball:hover { transform: translateY(-1px); border-color: var(--acid); color: var(--text-primary); }
.debug-ball.open { border-color: var(--acid); color: var(--text-primary); }
.debug-ball i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-muted);
}
/* A live backend that costs money reads differently from a simulation. */
.debug-ball.tripo i { background: var(--acid); box-shadow: 0 0 6px var(--acid); }
.debug-ball.tripo { color: var(--text-primary); }

.debug-panel {
  width: 268px;
  border-radius: 10px;
  box-shadow: var(--shadow-popover);
  overflow: hidden;
  font-family: var(--font-sans);
}
.debug-panel header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 12px;
  border-bottom: 1px solid var(--line);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: .08em;
  color: var(--text-secondary);
}
.debug-panel header button {
  border: 0;
  background: none;
  color: var(--text-muted);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
}
.debug-panel header button:hover { color: var(--text-primary); }
.debug-panel section { padding: 11px 12px; }
.debug-panel section + section { border-top: 1px solid var(--line-subtle); }
.debug-panel h3 {
  margin: 0 0 8px;
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: .07em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.debug-options { display: flex; flex-direction: column; gap: 5px; }
.debug-options button {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 7px 9px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--bg-input);
  text-align: left;
  cursor: pointer;
}
.debug-options button:hover:not(:disabled) { background: var(--bg-input-hover); }
.debug-options button.selected { border-color: var(--acid); background: var(--bg-active); }
.debug-options button:disabled { opacity: .45; cursor: not-allowed; }
.debug-options strong { font-size: 12px; font-weight: 500; color: var(--text-primary); }
.debug-options small { font-size: 10px; color: var(--text-muted); }

.debug-active {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0;
  font-size: 12px;
  color: var(--text-primary);
}
.debug-active i { width: 7px; height: 7px; border-radius: 50%; background: var(--text-muted); }
.debug-active.tripo i { background: var(--acid); box-shadow: 0 0 6px var(--acid); }
.debug-active b {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 500;
  letter-spacing: .04em;
  color: var(--acid);
}
.debug-note { margin: 7px 0 0; font-size: 10px; line-height: 1.45; color: var(--text-muted); }
.debug-note.error { color: var(--status-failed); }
</style>
