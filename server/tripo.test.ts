import test from 'node:test'
import assert from 'node:assert/strict'
import { createTripoClient, isTripoConfigured, TripoError } from './tripo.js'

function envelope(data, status = 200, headers = {}) {
  return new Response(JSON.stringify({ code: 0, data }), { status, headers: { 'content-type': 'application/json', ...headers } })
}

// `wait` is stubbed everywhere so backoff is asserted rather than slept through.
function client(fetchImpl, waited = []) {
  return createTripoClient({ apiKey: 'test-key', fetchImpl, wait: async (duration) => { waited.push(duration) } })
}

test('reports whether a key is configured', () => {
  assert.equal(isTripoConfigured({}), false)
  assert.equal(isTripoConfigured({ TRIPO_API_KEY: '' }), false)
  assert.equal(isTripoConfigured({ TRIPO_API_KEY: 'k' }), true)
})

test('refuses to build a client without a key', () => {
  assert.throws(() => createTripoClient({ apiKey: '' }), (error) => error instanceof TripoError && error.status === 503)
})

test('sends a bearer token against the configured base url', async () => {
  const calls = []
  const tripo = createTripoClient({
    apiKey: 'test-key',
    // A trailing slash must not produce a double slash in the path.
    baseUrl: 'https://example.test/v3/',
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      return envelope({ task_id: 'task_abc' })
    },
  })

  await tripo.createTask('/generation/image-to-model', { input: 'file_abc' })
  assert.equal(calls[0].url, 'https://example.test/v3/generation/image-to-model')
  assert.equal(calls[0].options.headers.authorization, 'Bearer test-key')
  assert.equal(calls[0].options.headers['content-type'], 'application/json')
  assert.deepEqual(JSON.parse(calls[0].options.body), { input: 'file_abc' })
})

test('unwraps the envelope and returns the task id', async () => {
  const tripo = client(async () => envelope({ task_id: 'task_abc' }))
  assert.equal(await tripo.createTask('/generation/text-to-model', { prompt: 'a shark' }), 'task_abc')
})

test('treats a non-zero code as an error even on HTTP 200', async () => {
  const tripo = client(async () => new Response(JSON.stringify({ code: 2002, message: 'insufficient credits' }), { status: 200, headers: { 'content-type': 'application/json' } }))
  await assert.rejects(tripo.createTask('/generation/text-to-model', {}), /insufficient credits/)
})

test('never leaks the api key in an error message', async () => {
  const tripo = createTripoClient({
    apiKey: 'super-secret',
    fetchImpl: async () => new Response(JSON.stringify({ code: 1001, message: 'invalid token' }), { status: 401, headers: { 'content-type': 'application/json' } }),
    wait: async () => {},
  })
  await assert.rejects(tripo.balance(), (error) => !error.message.includes('super-secret') && error.status === 503)
})

test('retries a 429 with exponential backoff and then succeeds', async () => {
  const waited = []
  let attempts = 0
  const tripo = client(async () => {
    attempts += 1
    if (attempts <= 3) return new Response('{}', { status: 429, headers: { 'content-type': 'application/json' } })
    return envelope({ task_id: 'task_abc' })
  }, waited)

  assert.equal(await tripo.createTask('/mesh/segment', { input: 'task_x' }), 'task_abc')
  assert.equal(attempts, 4)
  assert.deepEqual(waited, [1000, 2000, 4000])
})

test('prefers the Retry-After header over its own backoff', async () => {
  const waited = []
  let attempts = 0
  const tripo = client(async () => {
    attempts += 1
    if (attempts === 1) return new Response('{}', { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '7' } })
    return envelope({ task_id: 'task_abc' })
  }, waited)

  await tripo.createTask('/mesh/decimate', {})
  assert.deepEqual(waited, [7000])
})

test('caps the backoff and gives up as a retryable error', async () => {
  const waited = []
  const tripo = client(async () => new Response('{}', { status: 429, headers: { 'content-type': 'application/json' } }), waited)
  await assert.rejects(tripo.createTask('/models/texture', {}), (error) => error.status === 503)
  // Five retries: 1s, 2s, 4s, 8s, 16s. The cap only binds beyond that.
  assert.deepEqual(waited, [1000, 2000, 4000, 8000, 16000])
})

test('retries a 5xx but not a 4xx', async () => {
  const waited = []
  let attempts = 0
  const retried = client(async () => {
    attempts += 1
    return attempts === 1 ? new Response('{}', { status: 502, headers: { 'content-type': 'application/json' } }) : envelope({ task_id: 'task_ok' })
  }, waited)
  assert.equal(await retried.createTask('/models/convert', {}), 'task_ok')
  assert.equal(attempts, 2)

  let badRequests = 0
  const notRetried = client(async () => {
    badRequests += 1
    return new Response(JSON.stringify({ code: 1000, message: 'bad params' }), { status: 400, headers: { 'content-type': 'application/json' } })
  })
  await assert.rejects(notRetried.createTask('/models/convert', {}), /bad params/)
  assert.equal(badRequests, 1)
})

test('surfaces an unreachable service as retryable', async () => {
  const waited = []
  const tripo = client(async () => { throw new TypeError('network down') }, waited)
  await assert.rejects(tripo.getTask('task_abc'), (error) => error.status === 503 && /unavailable/.test(error.message))
  // A dropped connection costs a whole node run, so it backs off like a 5xx.
  assert.deepEqual(waited, [1000, 2000, 4000, 8000, 16000])
})

test('recovers from a dropped connection instead of failing the node', async () => {
  const waited = []
  let attempts = 0
  const tripo = client(async () => {
    attempts += 1
    // A transient proxy blip on the first call, as seen against the live API.
    if (attempts === 1) throw new TypeError('fetch failed')
    return envelope({ task_id: 'task_abc' })
  }, waited)

  assert.equal(await tripo.createTask('/generation/image-to-model', { input: 'file_abc' }), 'task_abc')
  assert.equal(attempts, 2)
  assert.deepEqual(waited, [1000])
})

test('uploads a file and returns its token', async () => {
  let request
  const tripo = client(async (url, options) => {
    request = { url, options }
    return envelope({ file_token: 'file_abc' })
  })

  const token = await tripo.uploadFile(new Uint8Array([1, 2, 3]), 'shark.png', 'image/png')
  assert.equal(token, 'file_abc')
  assert.match(request.url, /\/files$/)
  assert.ok(request.options.body instanceof FormData)
  // multipart boundary is set by FormData; forcing a content-type would break it.
  assert.equal(request.options.headers['content-type'], undefined)
  const file = request.options.body.get('file')
  assert.equal(file.type, 'image/png')
  assert.equal(file.size, 3)
})

test('polls until the task succeeds and reports progress', async () => {
  const statuses = [
    { task_id: 'task_abc', status: 'queued', progress: 0 },
    { task_id: 'task_abc', status: 'running', progress: 40 },
    { task_id: 'task_abc', status: 'success', progress: 100, output: { model_url: 'https://cdn/m.glb' } },
  ]
  const waited = []
  const seen = []
  const tripo = client(async () => envelope(statuses.shift()), waited)

  const task = await tripo.awaitTask('task_abc', { onProgress: (current) => seen.push(current.progress) })
  assert.equal(task.output.model_url, 'https://cdn/m.glb')
  assert.deepEqual(seen, [0, 40, 100])
  // No sleep after the terminal poll.
  assert.deepEqual(waited, [2000, 2000])
})

test('raises each terminal failure status', async () => {
  for (const status of ['failed', 'cancelled', 'expired']) {
    const tripo = client(async () => envelope({ task_id: 'task_abc', status }))
    await assert.rejects(tripo.awaitTask('task_abc'), (error) => error.status === 422 && error.message.includes(status), status)
  }
})

test('a failed task names the task id so it can be looked up afterwards', async () => {
  const tripo = client(async () => envelope({ task_id: 'task_abc', status: 'failed' }))
  await assert.rejects(tripo.awaitTask('task_abc'), /task task_abc/)
})

test('a failed task passes through the reason Tripo gave', async () => {
  const tripo = client(async () => envelope({ task_id: 'task_abc', status: 'failed', message: 'unsupported mesh topology' }))
  await assert.rejects(tripo.awaitTask('task_abc'), /unsupported mesh topology/)
})

test('explains a banned task as a content policy rejection', async () => {
  const tripo = client(async () => envelope({ task_id: 'task_abc', status: 'banned' }))
  await assert.rejects(tripo.awaitTask('task_abc'), /content policy/)
})

// A status lookup that cannot be answered says nothing about the task, so the
// only correct reading of it is "not known yet". Only Tripo can report a failure.
test('keeps polling when the status lookup itself fails', async () => {
  let calls = 0
  const tripo = client(async () => {
    calls += 1
    // Enough consecutive outages to exhaust `send`'s own retries twice over.
    if (calls <= 14) return new Response('gateway down', { status: 502 })
    return envelope({ task_id: 'task_abc', status: 'success', output: { model_url: 'https://cdn/m.glb' } })
  })

  const task = await tripo.awaitTask('task_abc')
  assert.equal(task.output.model_url, 'https://cdn/m.glb')
})

test('keeps polling a task that stays running', async () => {
  let calls = 0
  const tripo = client(async () => {
    calls += 1
    return calls <= 30
      ? envelope({ task_id: 'task_abc', status: 'running', progress: 10 })
      : envelope({ task_id: 'task_abc', status: 'success', output: { model_url: 'https://cdn/m.glb' } })
  })

  const task = await tripo.awaitTask('task_abc')
  assert.equal(task.status, 'success')
  assert.equal(calls, 31)
})
