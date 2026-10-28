import { derived, onMounted, onUnmounted, portalTarget, state } from '../store'

export function createTheme() {
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
  const theme = state(localStorage.getItem('forge3d-theme') || 'system')
  const resolvedTheme = derived(() => theme.value === 'system' ? (systemTheme.matches ? 'dark' : 'light') : theme.value)

  function applyTheme() {
    // Inside the harness page the theme belongs to the app's own container.
    const root = __FORGE3D_EMBED__ ? portalTarget() : document.documentElement
    root.dataset.theme = resolvedTheme.value
    root.style.colorScheme = resolvedTheme.value
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
