import { computed, onUnmounted, ref } from 'vue'
import { request } from '../api'

const HEARTBEAT_MS = 10000
const EDIT_IDLE_MS = 30000

export function useCanvasPresence({ activeCanvas, error }) {
  const clientId = sessionStorage.getItem('forge3d-client-id') || crypto.randomUUID()
  sessionStorage.setItem('forge3d-client-id', clientId)
  const displayName = sessionStorage.getItem('forge3d-display-name') || `Guest ${clientId.slice(0, 4).toUpperCase()}`
  sessionStorage.setItem('forge3d-display-name', displayName)
  const lease = ref(null)
  let heartbeatTimer
  let idleTimer
  let leasedCanvasId = null
  let lastEditAt = 0
  let flushBeforeRelease = async () => {}
  let editingIsBusy = () => false

  const canEdit = computed(() => Boolean(lease.value?.clientId === clientId))
  const editorName = computed(() => canEdit.value ? '' : lease.value?.displayName || '')

  async function acquire(canvasId = activeCanvas.value?.id) {
    if (!canvasId) return false
    try {
      const result = await request(`/api/canvases/${canvasId}/presence`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId, displayName }),
      })
      lease.value = result.lease
      leasedCanvasId = canvasId
      if (!lastEditAt) lastEditAt = Date.now()
      scheduleIdleRelease(Math.max(0, EDIT_IDLE_MS - (Date.now() - lastEditAt)))
      return true
    } catch (caught) {
      if (caught.status === 423) lease.value = caught.data.lease
      else error.value = caught.message
      return false
    }
  }

  function scheduleIdleRelease(delay = EDIT_IDLE_MS) {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(releaseWhenIdle, delay)
  }

  function markEditActivity() {
    lastEditAt = Date.now()
    if (canEdit.value) scheduleIdleRelease()
  }

  async function releaseWhenIdle() {
    if (!canEdit.value) return
    const remaining = EDIT_IDLE_MS - (Date.now() - lastEditAt)
    if (remaining > 0) {
      scheduleIdleRelease(remaining)
      return
    }
    if (editingIsBusy()) {
      scheduleIdleRelease(1000)
      return
    }
    const activityAtStart = lastEditAt
    await flushBeforeRelease()
    if (lastEditAt !== activityAtStart || editingIsBusy()) {
      scheduleIdleRelease()
      return
    }
    await release()
  }

  function configureIdleRelease({ flush, isBusy }) {
    flushBeforeRelease = flush
    editingIsBusy = isBusy
  }

  async function release(canvasId = leasedCanvasId, { keepalive = false } = {}) {
    if (!canvasId) return
    clearTimeout(idleTimer)
    if (leasedCanvasId === canvasId) {
      await fetch(`/api/canvases/${canvasId}/presence?clientId=${encodeURIComponent(clientId)}`, { method: 'DELETE', keepalive }).catch(() => {})
      lease.value = null
    }
    if (leasedCanvasId === canvasId) leasedCanvasId = null
    if (!leasedCanvasId) lastEditAt = 0
  }

  function applyPresenceEvent(event) {
    if (event.type === 'presence' && event.canvas_id === activeCanvas.value?.id) lease.value = event.lease
  }

  async function canvasOpened(canvasId, previousId) {
    if (previousId && previousId !== canvasId) await release(previousId)
    lease.value = null
    if (!canvasId) return
    const result = await request(`/api/canvases/${canvasId}/presence`).catch(() => ({ lease: null }))
    if (activeCanvas.value?.id === canvasId) lease.value = result.lease
  }

  heartbeatTimer = setInterval(() => {
    if (activeCanvas.value?.id && canEdit.value) acquire(activeCanvas.value.id)
  }, HEARTBEAT_MS)

  onUnmounted(() => {
    clearInterval(heartbeatTimer)
    clearTimeout(idleTimer)
    release(leasedCanvasId, { keepalive: true })
  })

  return {
    clientId, canEdit, editorName, acquireEditLease: acquire, markEditActivity, configureIdleRelease,
    applyPresenceEvent, canvasOpened, releasePresence: release,
  }
}
