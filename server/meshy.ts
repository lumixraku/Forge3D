// Meshy HTTP client. Unlike Tripo there is no `{ code, data }` envelope: task
// creation answers `{ result: taskId }` and a task lookup returns the task
// object directly. `fetchImpl` is injectable so the tests never touch the
// network.

const DEFAULT_BASE_URL = 'https://api.meshy.ai'
// Meshy answers an exhausted rate limit with 429 and `Retry-After` in seconds;
// the same exponential backoff Tripo gets is applied here, capped at 32s.
const RETRY_BASE_MS = 1000
const RETRY_CAP_MS = 32000
const MAX_RETRIES = 5
const TERMINAL_FAILURES = new Set(['FAILED', 'CANCELED'])

export class MeshyError extends Error {
  constructor(message, status = 502) {
    super(message)
    this.status = status
  }
}

export function isMeshyConfigured(env = process.env) {
  return Boolean(env.MESHY_API_KEY)
}

// A 429 carries `Retry-After` in seconds; prefer it over our own backoff so we
// wait exactly as long as Meshy asked.
function retryDelay(response, attempt) {
  const header = Number(response?.headers?.get?.('retry-after'))
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, RETRY_CAP_MS)
  return Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_CAP_MS)
}

export function createMeshyClient({
  apiKey = process.env.MESHY_API_KEY,
  baseUrl = process.env.MESHY_BASE_URL,
  fetchImpl = fetch,
  wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration)),
} = {}) {
  if (!apiKey) throw new MeshyError('Meshy is not configured. Set MESHY_API_KEY.', 503)
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
        if (attempt === MAX_RETRIES) throw new MeshyError('The Meshy service is unavailable.', 503)
        lastFailure = failure
        await wait(Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_CAP_MS))
        continue
      }
      // 429 is a rate limit; 5xx is transient too. Everything else is final.
      if (response.status !== 429 && response.status < 500) return unwrap(response, path)
      lastResponse = response
      if (attempt === MAX_RETRIES) break
      await wait(retryDelay(response, attempt))
    }
    // The key must never reach the message: these errors surface in the UI.
    if (!lastResponse) throw new MeshyError('The Meshy service is unavailable.', 503)
    throw new MeshyError(`Meshy request to ${path} failed with status ${lastResponse.status}.`, lastResponse.status === 429 ? 503 : 502)
  }

  async function unwrap(response, path) {
    let payload
    try {
      payload = await response.json()
    } catch {
      throw new MeshyError(`Meshy returned an invalid response for ${path}.`)
    }
    if (!response.ok) {
      const detail = payload?.message || payload?.error || `status ${response.status}`
      throw new MeshyError(`Meshy request to ${path} failed: ${detail}.`, response.status === 401 || response.status === 403 ? 503 : 502)
    }
    return payload
  }

  return {
    /**
     * Creates a task and returns its id. `endpoint` is the task family's path
     * (`/openapi/v1/image-to-3d` and the like); it doubles as the polling path,
     * so the caller keeps it for `awaitTask`.
     */
    async createTask(endpoint, body) {
      const data = await send(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!data?.result) throw new MeshyError(`Meshy did not return a task id for ${endpoint}.`)
      return data.result
    },

    async getTask(endpoint, taskId) {
      return send(`${endpoint}/${encodeURIComponent(taskId)}`)
    },

    /**
     * Polls until Meshy itself reports a terminal state.
     *
     * A status request that fails tells us nothing about the task, so it is
     * retried rather than treated as a failed generation: the submitted task is
     * still running on Meshy's side and only Meshy can say it failed.
     */
    async awaitTask(endpoint, taskId, { intervalMs = 2000, onProgress = () => {} } = {}) {
      for (;;) {
        let task
        try {
          task = await this.getTask(endpoint, taskId)
        } catch (failure) {
          // `send` already backed off across several attempts before giving up.
          console.warn(`[meshy] status lookup for task ${taskId} failed, still polling: ${failure.message}`)
          await wait(intervalMs)
          continue
        }
        await onProgress(task)
        if (task.status === 'SUCCEEDED') return task
        if (TERMINAL_FAILURES.has(task.status)) {
          // Meshy's own reason if it gave one, then the task id: without it a
          // failure cannot be looked up against the API afterwards.
          const reason = task.task_error?.message ? `: ${task.task_error.message}` : ''
          throw new MeshyError(`Meshy task ${task.status}${reason} (task ${taskId}).`, 422)
        }
        await wait(intervalMs)
      }
    },
  }
}
