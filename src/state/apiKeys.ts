import { derived, state } from '../store'

// The visitor's own API keys live in cookies so every request to this site
// carries them, including <img> and model loads that cannot set headers. The
// server reads them per request (server/user-keys.ts) and never stores them.
const COOKIES = { deepseek: 'forge3d_deepseek_key', meshy: 'forge3d_meshy_key' } as const
// Set once the dialog has been answered, saved or dismissed, so it only opens
// by itself on the first visit.
const PROMPTED_KEY = 'forge3d-api-keys-prompted'
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

function wasPrompted() {
  try {
    return localStorage.getItem(PROMPTED_KEY) === '1'
  } catch {
    return true
  }
}

function markPrompted() {
  try {
    localStorage.setItem(PROMPTED_KEY, '1')
  } catch {
    // Private mode: the dialog may open again next visit, which is harmless.
  }
}

export function createApiKeys() {
  const deepseekKey = state(readCookie(COOKIES.deepseek))
  const meshyKey = state(readCookie(COOKIES.meshy))
  const usingOwnKeys = derived(() => Boolean(deepseekKey.value || meshyKey.value))
  const apiKeysOpen = state(!usingOwnKeys.value && !wasPrompted())

  function saveApiKeys(keys: { deepseek: string; meshy: string }) {
    deepseekKey.value = keys.deepseek.trim()
    meshyKey.value = keys.meshy.trim()
    writeCookie(COOKIES.deepseek, deepseekKey.value)
    writeCookie(COOKIES.meshy, meshyKey.value)
    markPrompted()
    apiKeysOpen.value = false
  }

  // Closing without saving keeps whatever keys are already set; with none set,
  // the deployment's built-in keys are used.
  function dismissApiKeys() {
    markPrompted()
    apiKeysOpen.value = false
  }

  return { deepseekKey, meshyKey, usingOwnKeys, apiKeysOpen, saveApiKeys, dismissApiKeys }
}
