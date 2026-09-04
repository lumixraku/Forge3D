// Which execution backend node runs go to. The server decides on its own when no
// provider is sent, so this only exists to let a developer force one side while
// comparing behaviour or avoiding credit spend.

import { computed, onMounted, ref } from 'vue'
import { request } from '../api'

export type RunProvider = 'mock' | 'tripo' | 'meshy'

const STORAGE_KEY = 'forge3d.runProvider'
const RUN_PROVIDERS: RunProvider[] = ['mock', 'tripo', 'meshy']

function storedProvider(): RunProvider | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return RUN_PROVIDERS.includes(value as RunProvider) ? (value as RunProvider) : null
  } catch {
    // Private browsing or a blocked store; the session default is fine.
    return null
  }
}

export function useDebugSettings() {
  const capabilities = ref<{ providers: Record<RunProvider, boolean>; defaultProvider: RunProvider; tripoNodeTypes: string[]; meshyNodeTypes: string[] } | null>(null)
  const debugPanelOpen = ref(false)
  // Null means "let the server choose", which is the behaviour before anyone
  // touches the panel.
  const selectedProvider = ref<RunProvider | null>(storedProvider())
  const capabilitiesError = ref('')

  const tripoAvailable = computed(() => Boolean(capabilities.value?.providers.tripo))
  const meshyAvailable = computed(() => Boolean(capabilities.value?.providers.meshy))
  // What a run started right now would actually use.
  const activeProvider = computed<RunProvider>(() => {
    if (selectedProvider.value && capabilities.value?.providers[selectedProvider.value]) return selectedProvider.value
    return capabilities.value?.defaultProvider || 'mock'
  })
  const tripoNodeTypes = computed(() => capabilities.value?.tripoNodeTypes || [])
  const meshyNodeTypes = computed(() => capabilities.value?.meshyNodeTypes || [])

  function setProvider(provider: RunProvider) {
    selectedProvider.value = provider
    try {
      localStorage.setItem(STORAGE_KEY, provider)
    } catch {
      // Not being able to remember the choice does not stop it applying now.
    }
  }

  onMounted(async () => {
    try {
      capabilities.value = await request('/api/capabilities')
    } catch (error) {
      capabilitiesError.value = (error as Error).message
    }
  })

  return { capabilities, capabilitiesError, debugPanelOpen, selectedProvider, activeProvider, tripoAvailable, meshyAvailable, tripoNodeTypes, meshyNodeTypes, setProvider }
}
