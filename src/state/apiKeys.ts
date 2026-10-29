import { derived, state } from '../store'

// The visitor's own API keys live in cookies so every request to this site
// carries them, including <img> and model loads that cannot set headers. The
// server reads them per request (server/user-keys.ts) and never stores them.
const COOKIES = { deepseek: 'forge3d_deepseek_key', meshy: 'forge3d_meshy_key' } as const
const ONE_YEAR = 60 * 60 * 24 * 365

function readCookie(name: string) {
  for (const part of document.cookie.split(';')) {
    const index = part.indexOf('=')
    if (index >= 0 && part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim())
      } catch {
        return ''
      }
    }
  }
  return ''
}

function writeCookie(name: string, value: string) {
  const secure = location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = value
    ? `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${ONE_YEAR}; SameSite=Strict${secure}`
    : `${name}=; Path=/; Max-Age=0; SameSite=Strict${secure}`
}

export function createApiKeys() {
  const deepseekKey = state(readCookie(COOKIES.deepseek))
  const meshyKey = state(readCookie(COOKIES.meshy))
  const usingOwnKeys = derived(() => Boolean(deepseekKey.value || meshyKey.value))
  // Never opens by itself: visitors use the demo keys unless they choose to
  // open this from the top bar and add their own.
  const apiKeysOpen = state(false)

  function saveApiKeys(keys: { deepseek: string; meshy: string }) {
    deepseekKey.value = keys.deepseek.trim()
    meshyKey.value = keys.meshy.trim()
    writeCookie(COOKIES.deepseek, deepseekKey.value)
    writeCookie(COOKIES.meshy, meshyKey.value)
    apiKeysOpen.value = false
  }

  // Closing without saving keeps whatever keys are already set; with none set,
  // the deployment's built-in keys are used.
  function dismissApiKeys() {
    apiKeysOpen.value = false
  }

  return { deepseekKey, meshyKey, usingOwnKeys, apiKeysOpen, saveApiKeys, dismissApiKeys }
}
