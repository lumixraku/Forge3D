// The plugin build runs inside the DSH page, where `/api` is the harness's own
// API. Its canvas API lives under the plugin's route instead.
import { userKeyHeaders } from './state/apiKeys'

const API_BASE = __FORGE3D_EMBED__ ? '/forge3d' : ''

/** Map an app URL (`/api/...`, as the server also hands them out) to where it is served. */
export function apiUrl<T>(url: T): T {
  return (typeof url === 'string' && url.startsWith('/api/') ? API_BASE + url : url) as T
}

export async function request(url: string, options?: RequestInit) {
  // The harness page has no cookies, so the visitor's keys travel as headers.
  const headers = { ...userKeyHeaders(), ...((options?.headers as Record<string, string>) ?? {}) }
  const response = await fetch(apiUrl(url), { ...options, headers })
  const text = response.status === 204 ? '' : await response.text()
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error(`Invalid JSON response (${response.status}) from ${url}`)
    }
  }
  if (!response.ok) {
    const error = new Error(data?.error || `Request failed (${response.status}) for ${url}`)
    Object.assign(error, { status: response.status, data })
    throw error
  }
  return data
}
