import { computed, onMounted, ref } from 'vue'
import { request } from '../api'

export type RunProvider = 'mock' | 'tripo' | 'meshy'

export function useDebugSettings() {
  const capabilities = ref<{ providers: { mock: boolean; tripo: boolean; meshy: boolean }; defaultProvider: RunProvider; tripoNodeTypes: string[]; meshyNodeTypes: string[] } | null>(null)
  const debugPanelOpen = ref(false)
  const capabilitiesError = ref('')

  const tripoAvailable = computed(() => Boolean(capabilities.value?.providers.tripo))
  const meshyAvailable = computed(() => Boolean(capabilities.value?.providers.meshy))
  const tripoNodeTypes = computed(() => capabilities.value?.tripoNodeTypes || [])
  const meshyNodeTypes = computed(() => capabilities.value?.meshyNodeTypes || [])

  onMounted(async () => {
    try {
      capabilities.value = await request('/api/capabilities')
    } catch (error) {
      capabilitiesError.value = (error as Error).message
    }
  })

  return { capabilities, capabilitiesError, debugPanelOpen, tripoAvailable, meshyAvailable, tripoNodeTypes, meshyNodeTypes }
}
