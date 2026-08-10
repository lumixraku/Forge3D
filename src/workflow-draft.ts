const DATABASE_NAME = 'forge3d-workflow-drafts'
const STORE_NAME = 'drafts'
const LOCAL_STORAGE_PREFIX = 'forge3d-workflow-draft:'

function localStorageKey(canvasId: string) {
  return `${LOCAL_STORAGE_PREFIX}${canvasId}`
}

function readLocalDraft(canvasId: string) {
  try {
    return JSON.parse(localStorage.getItem(localStorageKey(canvasId)) || 'null')
  } catch {
    return null
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: 'canvasId' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function readWorkflowDraft(canvasId: string) {
  const localDraft = readLocalDraft(canvasId)
  const indexedDraft = await openDatabase().then((database) => new Promise<any>((resolve, reject) => {
    const request = database.transaction(STORE_NAME).objectStore(STORE_NAME).get(canvasId)
    request.onsuccess = () => resolve(request.result || null)
    request.onerror = () => reject(request.error)
  }).finally(() => database.close())).catch(() => null)
  return (localDraft?.localSequence || 0) >= (indexedDraft?.localSequence || 0) ? localDraft : indexedDraft
}

export async function writeWorkflowDraft(draft: any) {
  const storedDraft = JSON.parse(JSON.stringify(draft))
  try {
    const current = readLocalDraft(storedDraft.canvasId)
    if (!current || current.localSequence <= storedDraft.localSequence) {
      localStorage.setItem(localStorageKey(storedDraft.canvasId), JSON.stringify(storedDraft))
    }
  } catch {
    // IndexedDB remains the fallback when the synchronous mirror exceeds quota.
  }
  const database = await openDatabase()
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.get(storedDraft.canvasId)
    request.onsuccess = () => {
      if (!request.result || request.result.localSequence <= storedDraft.localSequence) store.put(storedDraft)
    }
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  }).finally(() => database.close())
}

export async function deleteWorkflowDraft(canvasId: string) {
  localStorage.removeItem(localStorageKey(canvasId))
  const database = await openDatabase()
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).delete(canvasId)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  }).finally(() => database.close())
}
