// Keys a visitor typed into the API keys dialog. The browser keeps them in
// cookies so every request carries them, including <img> and model loads that
// cannot set headers. They are used for that request only and never persisted;
// an empty or missing cookie falls back to the deployment's own key.

export const USER_KEY_COOKIES = {
  deepseek: 'forge3d_deepseek_key',
  meshy: 'forge3d_meshy_key',
} as const

// The harness page runs on a custom scheme, where cookies do not exist, so the
// same keys also arrive as headers. Header first: it is the source a client can
// always set.
export const USER_KEY_HEADERS = {
  deepseek: 'x-forge3d-deepseek-key',
  meshy: 'x-forge3d-meshy-key',
} as const

// Real keys are well under this. A longer value is not a key.
const MAX_KEY_LENGTH = 256

export function readUserKeys(request: Request) {
  const cookies = new Map<string, string>()
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    try {
      cookies.set(part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim()))
    } catch {
      // A malformed cookie is ignored, not fatal.
    }
  }
  const value = (cookie: string, header: string) => {
    const key = (request.headers.get(header) || cookies.get(cookie) || '').trim()
    return key.length <= MAX_KEY_LENGTH ? key : ''
  }
  return {
    deepseek: value(USER_KEY_COOKIES.deepseek, USER_KEY_HEADERS.deepseek),
    meshy: value(USER_KEY_COOKIES.meshy, USER_KEY_HEADERS.meshy),
  }
}

/**
 * Overlays the visitor's keys on the runtime config. `createMeshy(apiKey)`
 * returns the three Meshy ports built with that key.
 */
export function applyUserKeys(config, keys: { deepseek: string; meshy: string }, createMeshy: (apiKey: string) => object) {
  if (!keys.deepseek && !keys.meshy) return config
  return {
    ...config,
    deepseek: { ...config.deepseek, apiKey: keys.deepseek || config.deepseek?.apiKey },
    ...(keys.meshy ? withBuiltInTaskReads(createMeshy(keys.meshy), config.getMeshyTask) : {}),
  }
}

// Shared canvases hold results made with the deployment's key, which the
// visitor's key cannot read. Reading a task is free, so a failed lookup retries
// with the built-in reader before giving up.
function withBuiltInTaskReads(ports, builtInRead) {
  if (!builtInRead || !ports.getMeshyTask) return ports
  const ownRead = ports.getMeshyTask
  return {
    ...ports,
    getMeshyTask: async (taskId, endpoint) => {
      try {
        return await ownRead(taskId, endpoint)
      } catch {
        return builtInRead(taskId, endpoint)
      }
    },
  }
}
