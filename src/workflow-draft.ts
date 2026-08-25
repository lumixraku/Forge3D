// A canvas draft is only crash-recovery cover; the real archive is the server's
// saved canvas. It lives in localStorage rather than IndexedDB because writes are
// synchronous, so they land even as the page is closing, and one storage layer
// means never comparing which of two drafts is newer. Graph data is node config
// and URLs, no binaries, well inside the 5MB quota.
const LOCAL_STORAGE_PREFIX = 'forge3d-workflow-draft:'

function localStorageKey(canvasId: string) {
  return `${LOCAL_STORAGE_PREFIX}${canvasId}`
}

export function readWorkflowDraft(canvasId: string) {
  try {
    return JSON.parse(localStorage.getItem(localStorageKey(canvasId)) || 'null')
  } catch {
    return null
  }
}

// A draft is a fallback, so failing to write one (quota, private mode) must not
// disturb editing.
export function writeWorkflowDraft(draft: any) {
  try {
    localStorage.setItem(localStorageKey(draft.canvasId), JSON.stringify(draft))
  } catch {
    // Ignored: the canvas still saves to the server.
  }
}

export function deleteWorkflowDraft(canvasId: string) {
  try {
    localStorage.removeItem(localStorageKey(canvasId))
  } catch {
    // As above.
  }
}
