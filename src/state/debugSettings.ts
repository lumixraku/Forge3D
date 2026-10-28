import { derived, onMounted, state } from '../store'
import { request } from '../api'

export type RunProvider = 'mock' | 'tripo' | 'meshy'

const DEBUG_KEY = 'forge3d.debug'

// Off for the community build. `?debug=1` turns the panel on and remembers it;
// `?debug=0` turns it off again.
function readDebugMode() {
  try {
    const params = new URLSearchParams(window.location.search)
    const query = params.get('debug')
    if (query === '0') {
      localStorage.removeItem(DEBUG_KEY)
      return false
    }
    if (query === '1' || query === 'true') {
      localStorage.setItem(DEBUG_KEY, '1')
      return true
    }
    return localStorage.getItem(DEBUG_KEY) === '1'
  } catch {
    return false
  }
}

export function createDebugSettings() {
  const capabilities = state<{ providers: { mock: boolean; tripo: boolean; meshy: boolean }; defaultProvider: RunProvider; tripoNodeTypes: string[]; meshyNodeTypes: string[] } | null>(null)
  const debugMode = state(readDebugMode())
  const debugPanelOpen = state(false)
  const capabilitiesError = state('')

  const tripoAvailable = derived(() => Boolean(capabilities.value?.providers.tripo))
  const meshyAvailable = derived(() => Boolean(capabilities.value?.providers.meshy))
  const tripoNodeTypes = derived(() => capabilities.value?.tripoNodeTypes || [])
  const meshyNodeTypes = derived(() => capabilities.value?.meshyNodeTypes || [])

  onMounted(async () => {
    if (!debugMode.value) return
    try {
      capabilities.value = await request('/api/capabilities')
    } catch (error) {
      capabilitiesError.value = (error as Error).message
    }
  })

  return { capabilities, capabilitiesError, debugMode, debugPanelOpen, tripoAvailable, meshyAvailable, tripoNodeTypes, meshyNodeTypes }
}
