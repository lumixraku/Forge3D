import { derived, state } from '../store'

// The visitor's own API keys live in cookies so every request to this site
// carries them, including <img> and model loads that cannot set headers. The
// server reads them per request (server/user-keys.ts) and never stores them.
const COOKIES = { deepseek: 'forge3d_deepseek_key', meshy: 'forge3d_meshy_key' } as const
const ONE_YEAR = 60 * 60 * 24 * 365

// The harness page runs on its own scheme (`dsh-app://`), where `document.cookie`
// is empty: keys saved there never left the dialog. localStorage is the store
// that survives, and `userKeyHeaders()` carries them on every request.
const STORAGE = { deepseek: 'forge3d.key.deepseek', meshy: 'forge3d.key.meshy' } as const

function readStored(name: string) {
  try {
    return localStorage.getItem(name) || ''
  } catch {
    return ''
  }
}

function writeStored(name: string, value: string) {
  try {
    if (value) localStorage.setItem(name, value)
    else localStorage.removeItem(name)
  } catch {
    /* private mode */
  }
}

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
  const deepseekKey = state(readCookie(COOKIES.deepseek) || readStored(STORAGE.deepseek))
  const meshyKey = state(readCookie(COOKIES.meshy) || readStored(STORAGE.meshy))
  const usingOwnKeys = derived(() => Boolean(deepseekKey.value || meshyKey.value))
  // Never opens by itself: visitors use the demo keys unless they choose to
  // open this from the top bar and add their own.
  const apiKeysOpen = state(false)

  function saveApiKeys(keys: { deepseek: string; meshy: string }) {
    deepseekKey.value = keys.deepseek.trim()
    meshyKey.value = keys.meshy.trim()
    writeCookie(COOKIES.deepseek, deepseekKey.value)
    writeStored(STORAGE.deepseek, deepseekKey.value)
    writeCookie(COOKIES.meshy, meshyKey.value)
    writeStored(STORAGE.meshy, meshyKey.value)
    apiKeysOpen.value = false
  }

  // Closing without saving keeps whatever keys are already set; with none set,
  // the deployment's built-in keys are used.
  function dismissApiKeys() {
    apiKeysOpen.value = false
  }

  return { deepseekKey, meshyKey, usingOwnKeys, apiKeysOpen, saveApiKeys, dismissApiKeys }
}

/**
 * The visitor's keys as request headers.
 *
 * Cookies do not exist on the harness page's origin (`dsh-app://app`), so a key
 * saved there never reached the server. Headers travel with every `request()`
 * call, and `server/user-keys.ts` reads them before the cookies.
 */
export function userKeyHeaders(): Record<string, string> {
  const deepseek = readCookie(COOKIES.deepseek) || readStored(STORAGE.deepseek)
  const meshy = readCookie(COOKIES.meshy) || readStored(STORAGE.meshy)
  return {
    ...(deepseek ? { 'x-forge3d-deepseek-key': deepseek } : {}),
    ...(meshy ? { 'x-forge3d-meshy-key': meshy } : {}),
  }
}
