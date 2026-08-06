// Tripo v3 HTTP client. Every response is wrapped in a `{ code, data }`
// envelope; this unwraps it and raises anything non-zero as an error. `fetchImpl`
// is injectable so the tests never touch the network.

const DEFAULT_BASE_URL = 'https://openapi.tripo3d.ai/v3'
// Tripo has no queue: a full concurrency pool is rejected outright with 429.
// Their guidance is exponential backoff from 1s, doubling, capped at 32s.
const RETRY_BASE_MS = 1000
const RETRY_CAP_MS = 32000
const MAX_RETRIES = 5
const TERMINAL_FAILURES = new Set(['failed', 'banned', 'expired', 'cancelled'])

export class TripoError extends Error {
  constructor(message, status = 502) {
    super(message)
    this.status = status
  }
}

export function isTripoConfigured(env = process.env) {
  return Boolean(env.TRIPO_API_KEY)
}

// A 429 carries `Retry-After` in seconds; prefer it over our own backoff so we
// wait exactly as long as Tripo asked.
function retryDelay(response, attempt) {
  const header = Number(response?.headers?.get?.('retry-after'))
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, RETRY_CAP_MS)
  return Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_CAP_MS)
}

export function createTripoClient({
  apiKey = process.env.TRIPO_API_KEY,
  baseUrl = process.env.TRIPO_BASE_URL,
  fetchImpl = fetch,
  wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration)),
} = {}) {
  if (!apiKey) throw new TripoError('Tripo is not configured. Set TRIPO_API_KEY.', 503)
  const root = (baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '')

  async function send(path, { method = 'GET', body = null, headers = {} } = {}) {
    let lastResponse = null
    let lastFailure = null
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      let response
      try {
        response = await fetchImpl(`${root}${path}`, {
          method,
          headers: { authorization: `Bearer ${apiKey}`, ...headers },
          ...(body ? { body } : {}),
          signal: AbortSignal.timeout(60000),
        })
      } catch (failure) {
        // A dropped connection is as transient as a 5xx, and losing one costs a
        // whole node run, so it gets the same backoff rather than failing outright.
        if (attempt === MAX_RETRIES) throw new TripoError('The Tripo service is unavailable.', 503)
        lastFailure = failure
        await wait(Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_CAP_MS))
        continue
      }
      // 429 is a full pool or a rate limit; both are worth retrying. 5xx is
      // transient too. Everything else is final.
      if (response.status !== 429 && response.status < 500) return unwrap(response, path)
      lastResponse = response
      if (attempt === MAX_RETRIES) break
      await wait(retryDelay(response, attempt))
    }
    // The key must never reach the message: these errors surface in the UI.
    if (!lastResponse) throw new TripoError('The Tripo service is unavailable.', 503)
    throw new TripoError(`Tripo request to ${path} failed with status ${lastResponse.status}.`, lastResponse.status === 429 ? 503 : 502)
  }

  async function unwrap(response, path) {
    let payload
    try {
      payload = await response.json()
    } catch {
      throw new TripoError(`Tripo returned an invalid response for ${path}.`)
    }
    if (!response.ok) {
      const detail = payload?.message || payload?.error || `status ${response.status}`
      throw new TripoError(`Tripo request to ${path} failed: ${detail}.`, response.status === 401 || response.status === 403 ? 503 : 502)
    }
    if (payload?.code !== 0) throw new TripoError(`Tripo rejected ${path}: ${payload?.message || `code ${payload?.code}`}.`)
    return payload.data
  }

  return {
    /** Uploads bytes and returns a `file_token` usable as any endpoint's `input`. */
    async uploadFile(bytes, filename = 'upload', contentType = 'application/octet-stream') {
      const form = new FormData()
      form.append('file', new Blob([bytes], { type: contentType }), filename)
      const data = await send('/files', { method: 'POST', body: form })
      if (!data?.file_token) throw new TripoError('Tripo did not return a file token.')
      return data.file_token
    },

    /** Creates a task and returns its id. */
    async createTask(endpoint, body) {
      const data = await send(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!data?.task_id) throw new TripoError(`Tripo did not return a task id for ${endpoint}.`)
      return data.task_id
    },

    async getTask(taskId) {
      return send(`/tasks/${encodeURIComponent(taskId)}`)
    },

    async balance() {
      return send('/account/balance')
    },

    /**
     * Polls until Tripo itself reports a terminal state. Tripo recommends 1-2s
     * intervals.
     *
     * A status request that fails tells us nothing about the task, so it is
     * retried rather than treated as a failed generation: the submitted task is
     * still running on Tripo's side and only Tripo can say it failed. This polls
     * for as long as it takes; a lost status endpoint never turns into a
     * generation failure.
     */
    async awaitTask(taskId, { intervalMs = 2000, onProgress = () => {} } = {}) {
      for (;;) {
        let task
        try {
          task = await this.getTask(taskId)
        } catch (failure) {
          // `send` already backed off across several attempts before giving up.
          console.warn(`[tripo] status lookup for task ${taskId} failed, still polling: ${failure.message}`)
          await wait(intervalMs)
          continue
        }
        await onProgress(task)
        if (task.status === 'success') return task
        if (TERMINAL_FAILURES.has(task.status)) {
          // Tripo's own reason if it gave one, then the task id: without it a
          // failure cannot be looked up against the API afterwards.
          const reason = task.status === 'banned'
            ? ': the input violates the content policy'
            : task.message || task.error ? `: ${task.message || task.error}` : ''
          throw new TripoError(`Tripo task ${task.status}${reason} (task ${taskId}).`, 422)
        }
        await wait(intervalMs)
      }
    },
  }
}
