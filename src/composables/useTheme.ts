import { computed, onMounted, onUnmounted, ref } from 'vue'

export function useTheme() {
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
  const theme = ref(localStorage.getItem('forge3d-theme') || 'system')
  const resolvedTheme = computed(() => theme.value === 'system' ? (systemTheme.matches ? 'dark' : 'light') : theme.value)

  function applyTheme() {
    document.documentElement.dataset.theme = resolvedTheme.value
    document.documentElement.style.colorScheme = resolvedTheme.value
  }

  function setTheme(value: string) {
    theme.value = value
    localStorage.setItem('forge3d-theme', value)
    applyTheme()
  }

  function handleSystemThemeChange() {
    if (theme.value === 'system') applyTheme()
  }

  applyTheme()

  onMounted(() => {
    systemTheme.addEventListener('change', handleSystemThemeChange)
  })
  onUnmounted(() => systemTheme.removeEventListener('change', handleSystemThemeChange))

  return { theme, resolvedTheme, setTheme }
}
