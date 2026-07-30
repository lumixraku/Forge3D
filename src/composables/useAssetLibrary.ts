import { computed, ref } from 'vue'
import { request } from '../api'
import { buildAssetLibrary, buildAssetRails, buildRunLabels } from '../asset-library'

// Assets come from the persisted run history, so the library keeps every past
// run's output instead of only what the current canvas nodes carry.
export function useAssetLibrary({ activeCanvas, error }) {
  const assets = ref([])
  const loading = ref(false)
  const library = computed(() => buildAssetLibrary(assets.value))
  const runLabels = computed(() => buildRunLabels(assets.value))
  const rails = computed(() => buildAssetRails(library.value).map((rail) => ({
    ...rail,
    items: rail.items.map((item) => ({ ...item, runLabel: runLabels.value.get(item.runId) || '' })),
  })))

  async function loadAssets() {
    const canvasId = activeCanvas.value?.id
    if (!canvasId) {
      assets.value = []
      return
    }
    loading.value = true
    try {
      const data = await request(`/api/canvases/${canvasId}/assets?limit=200`)
      // A canvas switch mid-request must not overwrite the new one's assets.
      if (activeCanvas.value?.id !== canvasId) return
      assets.value = data.items
    } catch (caught) {
      error.value = caught.message
    } finally {
      loading.value = false
    }
  }

  return { assets, rails, library, loading, loadAssets }
}
